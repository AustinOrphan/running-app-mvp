// Engine entry points. Pure and deterministic for a given input; `today` arrives in the input.
// buildPlan runs state, zones, goal, feasibility, macro, micro, guards, race day, checklist and
// prediction in that order; replan keeps the past and recomputes the future. The other entry
// points delegate to the module that owns the rule.
import { addDays, mondayOf } from '../dates.ts'
import type { AthleteProfile, Weekday } from '../types.ts'
import { breakRestart } from './adapt.ts'
import { estimateState } from './athlete.ts'
import { runChecklist } from './checklist.ts'
import { feasibility } from './goal.ts'
import { applyGuards } from './guards.ts'
import { heatWarning } from './heat.ts'
import { isDuplicate } from './load.ts'
import { macroPlan } from './macro.ts'
import { placeWeek } from './micro.ts'
import { P, PARAMS_VERSION } from './params/index.ts'
import { predictRace } from './predict.ts'
import { prescribe } from './sessions.ts'
import type {
  AthleteState,
  EngineInput,
  EngineWarning,
  PlanChange,
  PlanDraft,
  SessionSpec,
  WeekDraft,
  ZoneSet,
} from './types.ts'
import { buildZones } from './zones.ts'

export { zoneProposals, weeklyDecision } from './adapt.ts'
export { runChecklist } from './checklist.ts'
export { explain } from './explain.ts'
export { assessExecution, matchSessions } from './execution.ts'
export { PARAMS_VERSION, P } from './params/index.ts'
export { predictRace } from './predict.ts'
export { todayAdvice } from './readiness.ts'

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** A session the plan already holds and keeps as it is (replan): the spec without its row fields. */
type KeptSession = SessionSpec

function bySlot(a: SessionSpec, b: SessionSpec): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  return a.order - b.order
}

/** The profile with the given dates closed to running, so a week is placed on the days left. */
function closeDates(
  profile: AthleteProfile,
  weekStart: string,
  closed: ReadonlySet<string>,
): AthleteProfile {
  const availability = { ...profile.availability }
  WEEKDAYS.forEach((weekday, i) => {
    if (closed.has(addDays(weekStart, i))) availability[weekday] = { available: false, maxMin: 0 }
  })
  return { ...profile, availability }
}

/**
 * The part of the current week still to plan: the target less what was already run, the same
 * share of the climbing, and no more run days than the week has left. Missed volume is never made
 * up [rules g-6]; the minutes already run count toward the week.
 */
function remainingOfCurrentWeek(
  week: WeekDraft,
  state: AthleteState,
  input: EngineInput,
  keptRuns: number,
  cap: number | null,
): WeekDraft {
  const row = state.weeks.find((w) => w.weekStart === week.weekStart)
  const done = row === undefined ? 0 : row.runMin
  const ranDays = new Set(
    input.activities
      .filter(
        (a) =>
          (a.type === 'run' || a.type === 'race') &&
          !isDuplicate(a) &&
          a.date >= week.weekStart &&
          a.date <= input.today,
      )
      .map((a) => a.date),
  ).size
  const left = Math.max(0, Math.floor(week.targetRunMin - done))
  const target = cap === null ? left : Math.min(left, cap)
  const share = week.targetRunMin > 0 ? target / week.targetRunMin : 0
  return {
    ...week,
    targetRunMin: target,
    longRunMin: Math.min(week.longRunMin, target),
    longRunM: week.longRunM === null ? null : Math.round((week.longRunM * share) / 100) * 100,
    gainTargetM:
      week.gainTargetM === null ? null : Math.round((week.gainTargetM * share) / 10) * 10,
    runDays: Math.max(0, week.runDays - ranDays - keptRuns),
  }
}

/**
 * A break of 7 days or more restarts below the volume before it [rules J7]: the typical week the
 * macrocycle grows from is the restart volume, not the pre-break one.
 */
function afterBreak(state: AthleteState): AthleteState {
  if (state.layoffDays < P.j7.tier1Days.value || state.typicalWeekMin <= 0) return state
  const restart = breakRestart(state.layoffDays, state.typicalWeekMin)
  return { ...state, typicalWeekMin: Math.min(state.typicalWeekMin, restart.restartMin) }
}

/**
 * The shared generator. `kept` holds sessions of the existing plan that stay as they are (the
 * past and the finished sessions of the current week); their dates are closed to new sessions.
 * `weekOffset` is the number of weeks of the existing plan before the current one, so a week
 * keeps its index in the plan.
 */
function generate(
  input: EngineInput,
  kept: KeptSession[],
  weekOffset: number,
  stillPlannedMin: number | null = null,
): PlanDraft {
  const { today, goal } = input
  const state = afterBreak(estimateState(input))
  const zones = buildZones(input.profile, state, today)
  const feas = feasibility(goal, state, today)
  const macro = macroPlan(input, state, goal, feas).map((w) => ({
    ...w,
    index: w.index + weekOffset,
  }))
  const currentMonday = mondayOf(today)
  const keptDates = new Set(kept.map((s) => s.date))

  // Micro: each week to days; weeks see the sessions placed before them.
  const placed: SessionSpec[] = []
  const history: SessionSpec[] = [...kept]
  for (const week of macro) {
    const isCurrent = week.weekStart === currentMonday
    const closed = new Set<string>()
    let planWeek = week
    if (isCurrent) {
      for (let i = 0; i < 7; i++) {
        const date = addDays(week.weekStart, i)
        if (date < today || keptDates.has(date)) closed.add(date)
      }
      const keptRuns = kept.filter(
        (s) => s.date >= today && mondayOf(s.date) === currentMonday && s.durationMin > 0,
      ).length
      planWeek = remainingOfCurrentWeek(week, state, input, keptRuns, stillPlannedMin)
    }
    const profile =
      closed.size > 0 ? closeDates(input.profile, week.weekStart, closed) : input.profile
    const sessions =
      planWeek.targetRunMin > 0 || planWeek.strengthSessions > 0
        ? placeWeek(planWeek, { profile, zones, state, prevSessions: history })
        : []
    // The race day holds the race and the rest of race week is the start of recovery; the weeks
    // after it keep their own (reduced) sessions.
    const raceMonday = mondayOf(goal.date)
    const inside = sessions.filter((s) => s.date < goal.date || mondayOf(s.date) > raceMonday)
    placed.push(...inside)
    history.push(...inside)
  }

  // Guards over the whole plan.
  const guarded = applyGuards(placed, state, input.activities, {
    ultraRaceDurationSec: goal.isUltra ? goal.expectedDurationSec : null,
  })

  // Race day.
  const raceWeek = macro.find((w) => w.weekStart === mondayOf(goal.date))
  const sessions: SessionSpec[] = [...guarded.sessions]
  if (raceWeek !== undefined && goal.date >= today) {
    sessions.push(raceSession(input, zones, raceWeek))
  }
  const all = [...kept, ...sessions].sort(bySlot)

  const warnings: EngineWarning[] = [...feas.notes, ...guarded.warnings]
  if (goal.raceWbgtC !== null) {
    const heat = heatWarning(goal.raceWbgtC)
    if (heat !== null) warnings.push(heat)
  }
  if (goal.date < today) {
    warnings.push({
      code: 'goal-in-past',
      severity: 'info',
      message: `The goal date ${goal.date} is before ${today}, so there is nothing to plan.`,
      rules: ['E1'],
    })
  }

  return {
    weeks: macro,
    sessions: all,
    feasibility: feas,
    warnings,
    checklist: [],
    prediction: predictRace(input),
    zones,
    paramsVersion: PARAMS_VERSION,
  }
}

function raceSession(input: EngineInput, zones: ZoneSet, week: WeekDraft): SessionSpec {
  const { goal } = input
  const minutes = Math.max(1, Math.round(goal.expectedDurationSec / 60))
  const goalPace =
    goal.goalType === 'time' && goal.targetTimeSec !== null && goal.distanceM > 0
      ? Math.round(goal.targetTimeSec / (goal.distanceM / 1000))
      : null
  const spec = prescribe('race', minutes, zones, week, { goalPaceSecPerKm: goalPace })
  const flags = new Set(spec.flags)
  if (goal.raceWbgtC !== null) flags.add('heat')
  if (goal.crossesDarkness) flags.add('night')
  return {
    ...spec,
    date: goal.date,
    order: 0,
    title: `Race: ${goal.name}`,
    distanceM: goal.distanceM,
    gainM: goal.gainM > 0 ? goal.gainM : null,
    flags: [...flags],
  }
}

/** State, zones, goal, feasibility, macro, micro, guards, checklist and prediction. */
export function buildPlan(input: EngineInput): PlanDraft {
  const draft = generate(input, [], 0)
  return { ...draft, checklist: runChecklist(draft, input) }
}

const SPEC_KEYS = [
  'date',
  'order',
  'kind',
  'title',
  'durationMin',
  'distanceM',
  'gainM',
  'structure',
  'target',
  'purpose',
  'rules',
  'flags',
] as const

function specOf(session: SessionSpec): SessionSpec {
  const out: Record<string, unknown> = {}
  for (const key of SPEC_KEYS) out[key] = session[key]
  return out as unknown as SessionSpec
}

const WEEK_FIELDS: Array<{ field: keyof WeekDraft; rules: string[] }> = [
  { field: 'phase', rules: ['E2'] },
  { field: 'isRecovery', rules: ['E3'] },
  { field: 'targetRunMin', rules: ['g-2', 'g-6'] },
  { field: 'longRunMin', rules: ['g-1', 'F3'] },
  { field: 'runDays', rules: ['F5'] },
  { field: 'qualitySessions', rules: ['F2'] },
  { field: 'strengthSessions', rules: ['E5'] },
  { field: 'gainTargetM', rules: ['H4'] },
]

/** Running minutes planned in a week from `from` on (races and strength are not running time). */
function plannedMinutes(sessions: SessionSpec[], weekStart: string, from: string): number {
  return sessions
    .filter(
      (s) =>
        mondayOf(s.date) === weekStart &&
        s.date >= from &&
        s.kind !== 'race' &&
        s.kind !== 'strength' &&
        s.kind !== 'hike',
    )
    .reduce((sum, s) => sum + s.durationMin, 0)
}

/**
 * Keeps the past and the finished sessions of the current week, recomputes the rest from the
 * updated state within every limit, and lists what changed with the rule ids behind it.
 */
export function replan(input: EngineInput): { draft: PlanDraft; changes: PlanChange[] } {
  const existing = input.existing
  const currentMonday = mondayOf(input.today)
  const oldWeeks = existing?.weeks ?? []
  const oldSessions = existing?.sessions ?? []

  const pastWeeks = oldWeeks.filter((w) => w.weekStart < currentMonday)
  const kept = oldSessions
    .filter(
      (s) =>
        s.date < input.today ||
        (mondayOf(s.date) === currentMonday && s.date >= input.today && s.status !== 'planned'),
    )
    .map(specOf)

  // A re-plan never adds to the current week what an earlier day of it did not hold [rules g-6]:
  // what is still to run is at most what the replaced plan still had for the days from today.
  const hadWeek = oldWeeks.some((w) => w.weekStart === currentMonday)
  const stillPlanned = hadWeek
    ? plannedMinutes(
        oldSessions.filter((s) => s.status === 'planned'),
        currentMonday,
        input.today,
      )
    : null
  const draft = generate(input, kept, pastWeeks.length, stillPlanned)
  const keptSet = new Set<SessionSpec>(kept)
  const weeks = [...pastWeeks, ...draft.weeks]
  const merged: PlanDraft = { ...draft, weeks, checklist: runChecklist({ ...draft, weeks }, input) }

  // Changes: only weeks from the current one on; the past is never rewritten.
  const changes: PlanChange[] = []
  const oldFuture = new Map(
    oldWeeks.filter((w) => w.weekStart >= currentMonday).map((w) => [w.weekStart, w]),
  )
  const newFuture = new Map(draft.weeks.map((w) => [w.weekStart, w]))
  const starts = [...new Set([...oldFuture.keys(), ...newFuture.keys()])].sort()
  for (const weekStart of starts) {
    const before = oldFuture.get(weekStart)
    const after = newFuture.get(weekStart)
    if (before === undefined || after === undefined) {
      changes.push({
        weekStart,
        field: 'week',
        from: before === undefined ? null : before.phase,
        to: after === undefined ? null : after.phase,
        rules: ['E2'],
      })
      continue
    }
    for (const { field, rules } of WEEK_FIELDS) {
      if (before[field] !== after[field]) {
        changes.push({ weekStart, field, from: before[field], to: after[field], rules })
      }
    }
    const oldMin = plannedMinutes(
      oldSessions.filter((s) => s.status === 'planned'),
      weekStart,
      input.today,
    )
    const newMin = plannedMinutes(
      draft.sessions.filter((s) => !keptSet.has(s)),
      weekStart,
      input.today,
    )
    if (oldMin !== newMin) {
      changes.push({
        weekStart,
        field: 'plannedMin',
        from: oldMin,
        to: newMin,
        rules: ['g-2', 'g-6'],
      })
    }
  }
  return { draft: merged, changes }
}
