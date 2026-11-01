// The plan quality checklist, run before a plan is published [rules G1]: progression within the
// limits, recovery cadence, intensity distribution, a strictly decreasing taper, level
// differentiation, the session spike guard, availability, spacing, ultra caps and race day.
// It re-reads the finished plan; it never repairs one. A failed item blocks publishing with its
// detail, so each detail names the week or date at fault.
import { ordinal } from '../copy/quantity.ts'
import { windowCheckLine } from '../copy/revision.ts'
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import type { Weekday } from '../types.ts'
import { afterBreak, breakRestart } from './adapt.ts'
import { estimateState } from './athlete.ts'
import {
  dayRuleOn,
  disruptionPlan,
  disruptionWeekCap,
  holdReference,
  holdRestartWeeks,
  isDisruptedWeek,
  returnWeeks,
  windowedWeeks,
} from './disruption.ts'
import {
  injuryTight,
  rampBasis,
  rampLimits,
  rampSkipWeeks,
  rebuildZoneUsed,
  startLevelMin,
  ultraRunCapMin,
  type RampContext,
  type RebuildZone,
} from './limits.ts'
import { rebuildZone, responseBasis } from './loadSetting.ts'
import { cycleShortReason, cycleWorkWeeks, redsHold } from './macro.ts'
import { intensityMinutes } from './micro.ts'
import { P } from './params/index.ts'
import { postRaceWindows, windowViolations } from './postRace.ts'
import { focalBoneActive } from './readiness.ts'
import { injuryLevel, ladderRung, rungCount, startExemptions } from './startWeeks.ts'
import type {
  AthleteState,
  ChecklistResult,
  EngineInput,
  PlanDraft,
  SessionKind,
  SessionSpec,
  WeekDraft,
} from './types.ts'

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const EPS = 1e-6

/** Sessions that count toward the weekly running minutes (a race and a hike do not). */
const VOLUME_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'b2b',
])
/** Sessions on the road or trail, for availability and run-day counts. */
const RUN_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([...VOLUME_KINDS, 'hike'])
/** Hard sessions: the next day is not hard [rules F1]. */
const HARD_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'long-fast-finish',
  'b2b',
])
/** Quality sessions: the long run does not sit between two of them [rules F3]. */
const QUALITY_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
])

const result = (id: string, ok: boolean, detail: string, rules: string[]): ChecklistResult => ({
  id,
  ok,
  detail,
  rules,
})

const isRecoveryOnly = (w: WeekDraft) => w.flags.includes('post-race')

/** A ladder or injury-return week of a start path [rules E6, g-3]. */
const isStartPathWeek = (w: WeekDraft) =>
  ladderRung(w.flags) !== null || w.flags.includes('injury-return')

function sortedWeeks(draft: PlanDraft): WeekDraft[] {
  return [...draft.weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
}

/**
 * A re-plan keeps the sessions of the current week that are finished: done (their running is
 * already in the week's history) or skipped. They add no running still to come.
 */
const FINISHED: ReadonlySet<string> = new Set(['completed', 'partial', 'skipped'])
const slotKey = (s: SessionSpec) => `${s.date}|${s.order}|${s.kind}|${s.title}|${s.durationMin}`

/** The sessions from today on that are still to run. */
function toRun(draft: PlanDraft, input: EngineInput): SessionSpec[] {
  const finished = new Set(
    (input.existing?.sessions ?? [])
      .filter((s) => s.date >= input.today && FINISHED.has(s.status))
      .map(slotKey),
  )
  return draft.sessions.filter((s) => s.date >= input.today && !finished.has(slotKey(s)))
}

/** A run a rest window skipped was not run: the week does not count it [rule J9]. */
const ranOrPlanned = (s: SessionSpec) => !s.flags.includes('rest-window')

function weekMinutes(sessions: SessionSpec[], weekStart: string, from: string): number {
  return sessions
    .filter(
      (s) =>
        mondayOf(s.date) === weekStart &&
        s.date >= from &&
        VOLUME_KINDS.has(s.kind) &&
        ranOrPlanned(s),
    )
    .reduce((sum, s) => sum + s.durationMin, 0)
}

/** The running time of one week of a draft as the progression item counts it. */
export interface DraftWeekTotal {
  weekStart: string
  /** Run already: the current week only. */
  done: number
  /** The sessions still to run in the week. */
  planned: number
  total: number
}

/**
 * The weekly ramp around a draft, as the progression item reads it: the completed weeks of the
 * state, then each week of the draft from the current Monday on that holds a session, at the
 * minutes already run plus the sessions still planned. The limits are the guards' (limits.ts): a
 * recovery or taper week, and the current week when the plan starts after its Monday, set no
 * baseline; the first week of a start path is exempt from G-2 up to its minutes and is a baseline
 * at those minutes, and its later weeks are exempt from the soft ramp only [rules E6]. `rampLimits`
 * of a week reads only the weeks before it, so every week may be asked in any order; a caller that
 * keeps minutes of its own for a week sets them in `ctx.volumes`.
 */
export function draftRamp(
  draft: PlanDraft,
  input: EngineInput,
  state: AthleteState,
): { ctx: RampContext & { volumes: Map<string, number> }; weeks: DraftWeekTotal[] } {
  const volume = new Map<string, number>()
  for (const row of state.weeks) volume.set(row.weekStart, row.runMin)
  const currentMonday = mondayOf(input.today)
  const starts = [...new Set(draft.sessions.map((s) => mondayOf(s.date)))].sort()
  const ahead = toRun(draft, input)
  const floorWeek = sortedWeeks(draft)
    .filter((w) => w.flags.includes('restart-floor'))
    .at(-1)
  const windows = disruptionPlan(input.disruptions ?? [])
  // the post-race weeks are baselines for the weeks after them, and exempt themselves [H12]
  const skip = rampSkipWeeks(
    input.today,
    draft.weeks
      .filter((w) => (w.isRecovery || w.isTaper) && !isRecoveryOnly(w))
      .map((w) => w.weekStart),
  )
  const ctx = {
    volumes: volume,
    skip,
    // a week a window took days from is a part week, a baseline beside another week and never alone
    partial: new Set(windowedWeeks(windows)),
    floor:
      floorWeek === undefined
        ? null
        : { weekStart: floorWeek.weekStart, minutes: floorWeek.targetRunMin },
    exempt: startExemptions(draft.weeks, returnWeeks(windows)),
    ...rampBasis(state, rebuildZone(input, state), responseBasis(input, state)),
  }
  const weeks: DraftWeekTotal[] = []
  for (const weekStart of starts) {
    if (weekStart < currentMonday) continue
    // The current week holds what was already run plus the sessions still planned.
    const done = weekStart === currentMonday ? (volume.get(weekStart) ?? 0) : 0
    const planned = weekMinutes(ahead, weekStart, input.today)
    const total = done + planned
    volume.set(weekStart, total)
    weeks.push({ weekStart, done, planned, total })
  }
  // The restart week after a long hold is a baseline for the weeks after it when the J7 share holds
  // it, a recovery week or not; one the cadence cuts below the share is a recovery week like another
  // [rules J7, J9, E3].
  const rows = new Map(draft.weeks.map((w) => [w.weekStart, w]))
  const restarts = holdRestartWeeks(
    windows,
    (weekStart) => volume.get(weekStart),
    (weekStart) => rows.get(weekStart)?.targetRunMin,
  )
  for (const weekStart of restarts) {
    const row = rows.get(weekStart)
    if (row?.isRecovery === true && !row.isTaper && !isRecoveryOnly(row)) skip.delete(weekStart)
  }
  return { ctx, weeks }
}

/**
 * G-2, G-3: no week above the 2-week ceiling or the tightened ramp; the soft 10% only warns. The
 * minutes already run in the current week are a fact, not a plan: a week run above its limit with
 * nothing more planned in it is taken as run, and fails only if the sessions still to run take it
 * past the limit.
 */
function progression(draft: PlanDraft, input: EngineInput, state: AthleteState): ChecklistResult {
  const rules = ['g-2', 'g-3']
  const failures: string[] = []
  const takenAsRun: string[] = []
  let soft = 0
  // the soft steps, in whole percents, of the weeks that passed them: the usual step, or the zone's
  const softSteps = new Set<number>()
  // the weeks planned above the usual soft step that the rebuild zone allows [rules g-8]
  let zoneWeeks = 0
  let zone: RebuildZone | null = null
  const { ctx, weeks } = draftRamp(draft, input, state)
  for (const { weekStart, planned, total } of weeks) {
    if (total <= 0) continue
    if (
      draft.weeks.some(
        (w) =>
          w.weekStart === weekStart && (isRecoveryOnly(w) || w.flags.includes('post-race-restart')),
      )
    ) {
      continue
    }
    const limits = rampLimits(ctx, weekStart)
    if (limits === null) continue
    if (total > limits.allowed + EPS) {
      if (planned > EPS) {
        failures.push(
          `week of ${weekStart}: ${Math.round(total)} min is above ${Math.round(limits.allowed)} min`,
        )
      } else takenAsRun.push(`${weekStart} (${Math.round(total)} min)`)
    } else if (!limits.exempt && total > limits.soft + EPS) {
      soft += 1
      // in the rebuild zone the soft step is the zone's, as the warning of the week says
      softSteps.add(Math.round((limits.rebuild?.step ?? P.g2.rampSoft.value) * 100))
    } else {
      const used = rebuildZoneUsed(limits, total, EPS)
      if (used !== null) {
        zoneWeeks += 1
        zone = used
      }
    }
  }
  if (failures.length > 0) return result('progression', false, failures.join('; '), rules)
  // the notes follow the weeks: the soft step first, then the rebuild zone when a week used it
  const notes: string[] = []
  if (soft > 0) {
    const steps = [...softSteps].sort((a, b) => a - b).map((pct) => `${pct}%`)
    notes.push(`${soft} week(s) step above the soft ${steps.join(' or ')} and carry a warning`)
  }
  if (zone !== null) {
    notes.push(
      `${zoneWeeks} week(s) use the rebuild step of ${Math.round(zone.step * 100)}% a week, up to ${Math.round(zone.ceilingMin)} min`,
    )
  }
  const withNotes = (clause: string) =>
    notes.length === 0 ? clause : `${clause}; ${notes.join('; ')}`
  let detail: string
  if (takenAsRun.length > 0) {
    detail = `Every planned week is within the ${soft === 0 ? withNotes('weekly ramp') : `ceiling; ${notes.join('; ')}`}; the week of ${takenAsRun.join(', ')} was run above its limit and is taken as run.`
  } else if (soft === 0) detail = `Every week is within the ${withNotes('weekly ramp')}.`
  else detail = `Every week is within the ceiling; ${notes.join('; ')}.`
  // the item that names the zone step answers to g-8 too, so its Why opens the facts of the zone
  return result('progression', true, detail, zone === null ? rules : [...rules, 'g-8'])
}

/** E3: no more than the cycle's loading weeks in a row, and recovery weeks cut the volume. */
function recoveryCadence(
  draft: PlanDraft,
  state: AthleteState,
  input: EngineInput,
): ChecklistResult {
  const rules = ['E3', 'g-3']
  const usual = P.e3.defaultCycleWorkWeeks.value
  // The cycle is the generator's own answer (`cycleShortReason` and `cycleWorkWeeks`, macro.ts), so
  // that a plan and its check cannot disagree about what an absent, chosen or forced option means.
  const cycle = cycleWorkWeeks(input, state)
  // A runner whose logged frequency has just fallen under 2 a week gets the 2:1 cadence from the
  // current week on [rules A5]; the weeks before it were planned, and are checked, at 3:1. A
  // runner who is novice, injured or chose 2:1 has the short cycle throughout.
  const switched = cycleShortReason(input, state) === 'new-runner' && state.experience !== 'novice'
  const currentMonday = mondayOf(input.today)
  const failures: string[] = []
  // The plan never opens with a recovery week, so its first block may run one week longer (macro).
  let first = true
  let run = 0
  let lastLoad: WeekDraft | null = null
  for (const week of sortedWeeks(draft)) {
    if (switched && week.weekStart === currentMonday) {
      run = 0
      first = true
    }
    const limit = switched && week.weekStart < currentMonday ? usual : cycle
    // a taper, race or post-race week, and a week a rest window touched, neither counts as a
    // loading week nor is held to the cut [rules E3, J9]
    if (
      week.isTaper ||
      week.phase === 'taper' ||
      week.phase === 'race' ||
      isRecoveryOnly(week) ||
      isDisruptedWeek(week.flags)
    ) {
      run = 0
      lastLoad = null
      continue
    }
    // The weeks of a start path follow their own steps and repeats [rules E6]: they carry no
    // recovery week, and the weeks after them open a new block.
    if (isStartPathWeek(week)) {
      run = 0
      lastLoad = null
      continue
    }
    if (week.isRecovery) {
      if (lastLoad !== null) {
        const allowed = lastLoad.targetRunMin * (1 - P.e3.recoveryWeekCutPct.range![0] / 100)
        if (week.targetRunMin > allowed + 1) {
          failures.push(
            `recovery week of ${week.weekStart} (${week.targetRunMin} min) is not cut ${P.e3.recoveryWeekCutPct.range![0]}% from ${lastLoad.targetRunMin} min`,
          )
        }
      }
      run = 0
      first = false
      continue
    }
    run += 1
    lastLoad = week
    if (run > limit + (first ? 1 : 0)) {
      failures.push(`${run} loading weeks in a row at ${week.weekStart}; the cycle is ${limit}:1`)
    }
  }
  return result(
    'recovery-cadence',
    failures.length === 0,
    failures.length === 0
      ? `A recovery week at least every ${ordinal(cycle + 1)} week.`
      : failures.join('; '),
    rules,
  )
}

/** E4, F2: the weekly targets hold the Z1 floor, and the planned sessions stay under the cap. */
function tid(draft: PlanDraft): ChecklistResult {
  const rules = ['E4', 'F2']
  const failures: string[] = []
  for (const week of sortedWeeks(draft)) {
    if (week.targetRunMin <= 0) continue
    const { z1, z2, z3 } = week.tid
    if (Math.abs(z1 + z2 + z3 - 100) > 1)
      failures.push(`week of ${week.weekStart}: shares add up to ${z1 + z2 + z3}`)
    else if (z1 < P.e4.z1Floor.value) failures.push(`week of ${week.weekStart}: Z1 is ${z1}%`)
    else if (z2 > z1) failures.push(`week of ${week.weekStart}: Z2 is above Z1`)
    const sessions = draft.sessions.filter(
      (s) => mondayOf(s.date) === week.weekStart && VOLUME_KINDS.has(s.kind) && ranOrPlanned(s),
    )
    const total = sessions.reduce((sum, s) => sum + s.durationMin, 0)
    const hard = sessions.reduce((sum, s) => sum + intensityMinutes(s), 0)
    if (total > 0 && (hard / total) * 100 > P.f2.z2z3ShareMax.value + EPS) {
      failures.push(
        `week of ${week.weekStart}: ${Math.round((hard / total) * 100)}% of the planned time is above zone 1`,
      )
    }
  }
  return result(
    'tid',
    failures.length === 0,
    failures.length === 0
      ? `Zone 1 holds at least ${P.e4.z1Floor.value}% in every week and no week passes ${P.f2.z2z3ShareMax.value}% above it.`
      : failures.join('; '),
    rules,
  )
}

/** K2: the taper weeks fall strictly, from below the last loading week to race week. */
function taper(draft: PlanDraft): ChecklistResult {
  const rules = ['K1', 'K2']
  const weeks = sortedWeeks(draft).filter((w) => !isRecoveryOnly(w))
  const taperWeeks = weeks.filter((w) => w.isTaper)
  if (taperWeeks.length === 0) {
    return result('taper', true, 'The plan has no taper weeks to check.', rules)
  }
  const failures: string[] = []
  const first = taperWeeks[0]!
  const before = weeks.filter((w) => w.weekStart < first.weekStart && !w.isRecovery).slice(-1)[0]
  if (before !== undefined && first.targetRunMin >= before.targetRunMin) {
    failures.push(`taper starts at ${first.targetRunMin} min, not below ${before.targetRunMin} min`)
  }
  for (let i = 1; i < taperWeeks.length; i++) {
    const prev = taperWeeks[i - 1]!
    const week = taperWeeks[i]!
    if (week.targetRunMin >= prev.targetRunMin) {
      failures.push(
        `week of ${week.weekStart} (${week.targetRunMin} min) does not fall from ${prev.targetRunMin} min`,
      )
    }
  }
  // the runs of the race week after the race belong to the return steps, not to the taper [H12]
  const taperSessions = draft.sessions.filter((s) => !s.flags.includes('post-race'))
  for (const week of taperWeeks) {
    const planned = weekMinutes(taperSessions, week.weekStart, week.weekStart)
    if (planned > week.targetRunMin + 1) {
      failures.push(
        `week of ${week.weekStart} holds ${planned} min, above its ${week.targetRunMin} min`,
      )
    }
  }
  return result(
    'taper',
    failures.length === 0,
    failures.length === 0
      ? `The taper falls every week over ${taperWeeks.length} week(s).`
      : failures.join('; '),
    rules,
  )
}

/** Sessions a start-path week never holds: hard work, back-to-back runs and strides. */
const NO_QUALITY_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([...HARD_KINDS, 'strides'])

/**
 * The Mondays within the quiet weeks after the ladder or the injury return ends [rules E6, G-3]:
 * no quality sessions and no strides for `noviceLadder.quietWeeksAfter` weeks after the last such
 * week.
 */
function quietWeeks(weeks: WeekDraft[]): Set<string> {
  const last = weeks
    .filter((w) => ladderRung(w.flags) !== null || injuryLevel(w.flags) !== null)
    .map((w) => w.weekStart)
    .sort()
    .at(-1)
  const out = new Set<string>()
  if (last === undefined) return out
  for (let k = 1; k <= P.noviceLadder.quietWeeksAfter.value; k++) out.add(addDays(last, 7 * k))
  return out
}

/**
 * F5, E1, E6: a novice plan keeps three non-consecutive run days; the ladder, floor and
 * injury-return weeks, and the quiet weeks after the ladder, hold no hard work and no strides.
 */
function levelDifferentiation(
  draft: PlanDraft,
  state: AthleteState,
  today: string,
): ChecklistResult {
  const rules = ['F5', 'G1', 'E6']
  const novice = state.experience === 'novice'
  const fixedWeeks = draft.weeks.filter(
    (w) => isStartPathWeek(w) || w.flags.includes('restart-floor'),
  )
  if (!novice && fixedWeeks.length === 0) {
    return result(
      'level-differentiation',
      true,
      `Plan built for a ${state.experience} runner; the novice limits do not apply.`,
      rules,
    )
  }
  const failures: string[] = []
  const quiet = quietWeeks(draft.weeks)
  const fixed = new Set(fixedWeeks.map((w) => w.weekStart))
  for (const week of sortedWeeks(draft)) {
    if (!novice && !fixed.has(week.weekStart)) continue
    // the days a rest window holds change the run days of the week [rule J9]
    if (isDisruptedWeek(week.flags)) continue
    const days = [
      ...new Set(
        draft.sessions
          .filter(
            (s) =>
              mondayOf(s.date) === week.weekStart && RUN_KINDS.has(s.kind) && s.kind !== 'race',
          )
          .map((s) => s.date),
      ),
    ].sort()
    if (days.length > P.f5.noviceRunDays.value) {
      failures.push(`week of ${week.weekStart}: ${days.length} run days`)
    }
    for (let i = 1; i < days.length; i++) {
      if (daysBetween(days[i - 1]!, days[i]!) === 1) {
        failures.push(
          `week of ${week.weekStart}: run days ${days[i - 1]} and ${days[i]} are consecutive`,
        )
        break
      }
    }
    // a taper or race week keeps its strides: the ladder was cut short by the race
    const afterLadder = quiet.has(week.weekStart) && !week.isTaper && week.phase !== 'race'
    const earlyNovice = novice && week.index < P.flib.runWalkWeeks.value
    if (fixed.has(week.weekStart) || afterLadder || earlyNovice) {
      // a session of the past, kept from the plan a re-plan replaces, is history, not prescription
      const hard = draft.sessions.find(
        (s) =>
          s.date >= today && mondayOf(s.date) === week.weekStart && NO_QUALITY_KINDS.has(s.kind),
      )
      if (hard !== undefined) {
        failures.push(`week of ${week.weekStart}: ${hard.kind} in a week of easy running only`)
      }
    }
  }
  return result(
    'level-differentiation',
    failures.length === 0,
    failures.length === 0
      ? `At most ${P.f5.noviceRunDays.value} non-consecutive run days in a novice or start-path week, and no hard work or strides on the ${rungCount()}-step run-walk ladder, in the starting weeks or in the ${P.noviceLadder.quietWeeksAfter.value} weeks after the ladder or the injury return.`
      : failures.join('; '),
    rules,
  )
}

/**
 * E6, G-3: the ladder rises one rung at most from one week to the next and never past its last
 * rung; the injury-return ladder rises one level at most; no whole ladder or injury-return week
 * from today on is left without a run.
 */
function ladderSteps(draft: PlanDraft, input: EngineInput): ChecklistResult {
  const rules = ['E6', 'g-3']
  const failures: string[] = []
  const weeks = sortedWeeks(draft)
  for (const [i, week] of weeks.entries()) {
    const rung = ladderRung(week.flags)
    const level = injuryLevel(week.flags)
    if (rung !== null && (rung < 1 || rung > rungCount())) {
      failures.push(`week of ${week.weekStart}: rung ${rung} is outside the ${rungCount()} rungs`)
    }
    const before = weeks[i - 1]
    if (before === undefined || daysBetween(before.weekStart, week.weekStart) !== 7) continue
    const rungBefore = ladderRung(before.flags)
    if (rung !== null && rungBefore !== null && rung > rungBefore + 1) {
      failures.push(`week of ${week.weekStart}: rung ${rung} follows rung ${rungBefore}`)
    }
    const levelBefore = injuryLevel(before.flags)
    if (level !== null && levelBefore !== null && level > levelBefore + 1) {
      failures.push(
        `week of ${week.weekStart}: level ${level + 1} follows level ${levelBefore + 1}`,
      )
    }
  }
  for (const week of weeks) {
    // a part week (its Monday has passed) may have no day left to run on
    if (!isStartPathWeek(week) || week.targetRunMin <= 0 || week.weekStart < input.today) continue
    if (isDisruptedWeek(week.flags)) continue
    const runs = draft.sessions.filter(
      (s) => mondayOf(s.date) === week.weekStart && VOLUME_KINDS.has(s.kind) && s.durationMin > 0,
    )
    if (runs.length === 0)
      failures.push(`week of ${week.weekStart}: a start-path week holds no run`)
  }
  return result(
    'ladder-steps',
    failures.length === 0,
    failures.length === 0
      ? `The ladder rises one step a week at most, over ${rungCount()} rungs, and every ladder or injury-return week holds a run.`
      : failures.join('; '),
    rules,
  )
}

/** J7: after a break of `j7.tier1Days` days or more the first weeks start from the restart volume. */
function breakRestartItem(
  draft: PlanDraft,
  input: EngineInput,
  state: AthleteState,
): ChecklistResult {
  const rules = ['J7']
  if (postRaceWindows(input).past !== null) {
    return result(
      'break-restart',
      true,
      'The plan follows the post-race window, which sets the restart (H12).',
      rules,
    )
  }
  if (state.layoffDays < P.j7.tier1Days.value || state.typicalWeekMin <= 0) {
    return result(
      'break-restart',
      true,
      `No break of ${P.j7.tier1Days.value} days or more before the plan.`,
      rules,
    )
  }
  const { restartMin, fraction } = breakRestart(state.layoffDays, state.typicalWeekMin)
  const first = sortedWeeks(draft).find((w) => w.weekStart >= mondayOf(input.today))
  // The first week of a start path, and a ladder week that carries on from the weeks before the
  // break, start above the restart volume by design [rules E6].
  const floorMin =
    first !== undefined && (first.flags.includes('restart-floor') || isStartPathWeek(first))
      ? first.targetRunMin
      : 0
  const limit = Math.max(restartMin * (1 + P.g2.rampSoft.value) + 1, floorMin + 1)
  const done = state.weeks.find((w) => w.weekStart === mondayOf(input.today))?.runMin ?? 0
  const planned =
    first === undefined ? 0 : done + weekMinutes(toRun(draft, input), first.weekStart, input.today)
  return result(
    'break-restart',
    planned <= limit,
    planned <= limit
      ? `After ${state.layoffDays} days off the first week holds ${Math.round(planned)} min, from a restart at ${Math.round(fraction * 100)}% of ${state.typicalWeekMin} min.`
      : `After ${state.layoffDays} days off the first week holds ${Math.round(planned)} min, above ${Math.round(limit)} min (${Math.round(fraction * 100)}% of ${state.typicalWeekMin} min, plus one step).`,
    rules,
  )
}

/** G-1: nothing needs an override, a hard-limit profile has no warn-band run. */
function spikeGuard(draft: PlanDraft, state: AthleteState): ChecklistResult {
  const rules = ['g-1', 'g-3']
  const over = draft.sessions.filter((s) => s.flags.includes('override-required'))
  const failures = over.map((s) => `${s.date} ${s.kind} needs an explicit override`)
  if (injuryTight(state)) {
    for (const s of draft.sessions) {
      if (s.flags.includes('spike-warn'))
        failures.push(`${s.date} ${s.kind} is above the hard limit`)
    }
  }
  const warned = draft.sessions.filter((s) => s.flags.includes('spike-warn')).length
  return result(
    'spike-guard',
    failures.length === 0,
    failures.length === 0
      ? warned === 0
        ? 'No run is above the session spike limit.'
        : `${warned} run(s) are in the warn band and carry a warning.`
      : failures.join('; '),
    rules,
  )
}

/** F5: no run on a day the profile closes, none above the day's limit (the race excepted). */
function availability(draft: PlanDraft, input: EngineInput): ChecklistResult {
  const rules = ['F5']
  const failures: string[] = []
  for (const s of draft.sessions) {
    if (s.kind === 'race' || s.date < input.today) continue
    if (!RUN_KINDS.has(s.kind) && s.kind !== 'strength') continue
    const weekday = WEEKDAYS[daysBetween(mondayOf(s.date), s.date)]!
    const day = input.profile.availability[weekday]
    const cap = day.maxMin ?? Infinity
    if (!day.available || cap <= 0) failures.push(`${s.date} ${s.kind} falls on a closed day`)
    else if (RUN_KINDS.has(s.kind) && s.durationMin > cap + EPS) {
      failures.push(`${s.date} ${s.kind} runs ${s.durationMin} min on a ${cap} min day`)
    }
  }
  return result(
    'availability',
    failures.length === 0,
    failures.length === 0 ? 'Every session is on an available day.' : failures.join('; '),
    rules,
  )
}

/** F1, F3: no hard day after a hard day; the long run is not between two quality days. */
function spacing(draft: PlanDraft, input: EngineInput): ChecklistResult {
  const rules = ['F1', 'F3']
  const failures: string[] = []
  const byDate = new Map<string, SessionSpec[]>()
  for (const s of draft.sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s])
  const has = (date: string, kinds: ReadonlySet<SessionKind>) =>
    (byDate.get(date) ?? []).some((s) => kinds.has(s.kind))
  const hardDays = new Set([...byDate.keys()].filter((d) => has(d, HARD_KINDS)))
  for (const s of draft.sessions) {
    if (s.date < input.today) continue
    const next = addDays(s.date, 1)
    if (HARD_KINDS.has(s.kind) && hardDays.has(next)) {
      // A back-to-back pair is one block [rules H3]
      const pair =
        s.flags.includes('b2b-day1') &&
        (byDate.get(next) ?? []).some((n) => n.flags.includes('b2b-day2'))
      if (!pair) failures.push(`${s.date} and ${next} are both hard days`)
    }
    const neighbours =
      Number(has(addDays(s.date, -1), QUALITY_KINDS)) + Number(has(next, QUALITY_KINDS))
    if (s.kind === 'long' && neighbours > P.f3.maxQualityNeighboursOfLongRun.value) {
      failures.push(`the long run on ${s.date} sits between two quality days`)
    }
  }
  return result(
    'spacing',
    failures.length === 0,
    failures.length === 0
      ? 'Hard days are spaced and the long run is not between quality days.'
      : failures.join('; '),
    rules,
  )
}

/** H2, H3: the longest run, back-to-back pairs and the taper, for ultra goals. */
function ultraCaps(draft: PlanDraft, input: EngineInput): ChecklistResult {
  const rules = ['H2', 'H3']
  if (!input.goal.isUltra) {
    return result('ultra-caps', true, 'Not an ultra goal.', rules)
  }
  const failures: string[] = []
  const cap = ultraRunCapMin(input.goal.expectedDurationSec) ?? Infinity
  for (const s of draft.sessions) {
    if (s.date < input.today || !VOLUME_KINDS.has(s.kind)) continue
    if (s.durationMin > cap + 1)
      failures.push(`${s.date} ${s.kind} runs ${s.durationMin} min, above ${Math.round(cap)} min`)
  }
  const day1 = draft.sessions
    .filter((s) => s.flags.includes('b2b-day1'))
    .map((s) => s.date)
    .sort()
  for (const date of day1) {
    const second = draft.sessions.find(
      (s) => s.date === addDays(date, 1) && s.flags.includes('b2b-day2'),
    )
    const first = draft.sessions.find((s) => s.date === date && s.flags.includes('b2b-day1'))
    if (second === undefined) failures.push(`the pair on ${date} has no second day`)
    else if (first !== undefined && second.durationMin > first.durationMin + EPS) {
      failures.push(`day 2 of the pair on ${date} is longer than day 1`)
    }
    const week = draft.weeks.find((w) => w.weekStart === mondayOf(date))
    if (week !== undefined && (week.isTaper || week.phase === 'taper' || week.phase === 'race')) {
      failures.push(`the pair on ${date} is in the taper`)
    }
  }
  for (let i = 1; i < day1.length; i++) {
    if (daysBetween(day1[i - 1]!, day1[i]!) < P.h3.b2bMinGapWeeks.value * 7) {
      failures.push(
        `pairs on ${day1[i - 1]} and ${day1[i]} are less than ${P.h3.b2bMinGapWeeks.value} weeks apart`,
      )
    }
  }
  return result(
    'ultra-caps',
    failures.length === 0,
    failures.length === 0
      ? `No run is above ${Math.round(cap)} min and the back-to-back pairs keep their limits.`
      : failures.join('; '),
    rules,
  )
}

/** The race is on race day and nothing is planned after it until the recovery weeks. */
function raceDay(draft: PlanDraft, input: EngineInput): ChecklistResult {
  const rules = ['K1', 'H12']
  if (input.goal.date < input.today) {
    return result('race-day', true, 'The goal date has passed; nothing to plan.', rules)
  }
  const failures: string[] = []
  const races = draft.sessions.filter((s) => s.kind === 'race')
  if (races.length !== 1 || races[0]!.date !== input.goal.date) {
    failures.push(`expected one race on ${input.goal.date}`)
  }
  const sameDay = draft.sessions.filter(
    (s) => s.date === input.goal.date && s.kind !== 'race' && VOLUME_KINDS.has(s.kind),
  )
  if (sameDay.length > 0) failures.push(`${sameDay.length} run(s) share the race day`)
  // after the race: the hold, the step caps and no quality before the window ends [H12]
  const { own } = postRaceWindows(input)
  failures.push(
    ...windowViolations(
      draft.sessions.filter((s) => s.date > input.goal.date),
      [own],
      addDays(input.goal.date, 1),
    ),
  )
  const holdDays = own.holdUntil > input.goal.date ? daysBetween(input.goal.date, own.holdUntil) : 0
  // the steps start on the day the hold ends, the race week included [H12]
  const hold =
    holdDays === 0
      ? 'no days without running'
      : `${holdDays} day${holdDays === 1 ? '' : 's'} without running, until ${own.holdUntil}`
  return result(
    'race-day',
    failures.length === 0,
    failures.length === 0
      ? `The race is on ${input.goal.date}; after it ${hold}, then easy steps from the day the hold ends, and no quality work before ${own.quietUntil}.`
      : failures.join('; '),
    rules,
  )
}

/**
 * A plan built inside the window of a past race [rules H12]: no run in the hold, runs within the
 * step caps, and no quality session before the window ends.
 */
function postRaceWindowItem(draft: PlanDraft, input: EngineInput): ChecklistResult {
  const rules = ['H12']
  const { past } = postRaceWindows(input)
  if (past === null) {
    return result(
      'post-race-window',
      true,
      'No race of marathon distance or longer in its window.',
      rules,
    )
  }
  const failures = windowViolations(draft.sessions, [past], input.today)
  return result(
    'post-race-window',
    failures.length === 0,
    failures.length === 0
      ? `The ${past.race.date} race is still in its window: no running until ${past.holdUntil}, easy capped runs after it, and no quality work before ${past.quietUntil}.`
      : failures.join('; '),
    rules,
  )
}

/**
 * A held plan: no loading week from today is above the level the hold keeps, its long run and gain
 * target do not grow, and no back-to-back pair is planned. Returns what breaks the hold.
 *
 * The level is the first loading week, or the runner's own level when the first week was capped
 * under it: the macrocycle holds every week at the start level (`startLevelMin`, after the J7
 * restart of a break), the longest run and the climb of the last 30 days, and the weekly decision of
 * a held plan caps the week it covers
 * (after a recovery week, a sleep warning, a week run under the plan). The weeks that climb back by
 * the ramp to the level are the plan returning to it, not progressing beyond it [rules n-4, n-1, J5].
 */
function heldProgression(draft: PlanDraft, input: EngineInput, state: AthleteState): string[] {
  const failures: string[] = []
  const currentMonday = mondayOf(input.today)
  const loading = sortedWeeks(draft).filter(
    (w) =>
      w.weekStart >= currentMonday &&
      !w.isRecovery &&
      !w.isTaper &&
      w.phase !== 'race' &&
      !isRecoveryOnly(w),
  )
  const first = loading[0]
  if (first !== undefined) {
    const floored = (x: number, step = 1) => Math.floor((x + 1e-9) / step) * step
    const held = {
      min: Math.max(first.targetRunMin, startLevelMin(afterBreak(state))),
      long: Math.max(first.longRunMin, floored(state.longest30d.durationSec / 60)),
      gain: Math.max(
        first.gainTargetM ?? 0,
        P.h4.minStepGainM.value,
        floored(state.longest30d.gainM, 10),
      ),
    }
    for (const w of loading.slice(1)) {
      if (w.targetRunMin > held.min) {
        failures.push(
          `week of ${w.weekStart}: ${w.targetRunMin} min is above the held ${held.min} min`,
        )
      }
      if (w.longRunMin > held.long) {
        failures.push(
          `week of ${w.weekStart}: long run ${w.longRunMin} min is above the held ${held.long} min`,
        )
      }
      if ((w.gainTargetM ?? 0) > held.gain) {
        failures.push(`week of ${w.weekStart}: gain target grows`)
      }
    }
  }
  for (const s of draft.sessions) {
    if (s.date >= input.today && (s.flags.includes('b2b-day1') || s.flags.includes('b2b-day2'))) {
      failures.push(`${s.date} plans a back-to-back run`)
    }
  }
  return failures
}

/** N-4: `j5.redsHoldFlags` or more REDs flags hold progression. */
function redsHoldItem(draft: PlanDraft, input: EngineInput, state: AthleteState): ChecklistResult {
  const rules = ['n-4', 'J5']
  if (!redsHold(state)) {
    return result(
      'reds-hold',
      true,
      `No energy-availability hold: fewer than ${P.j5.redsHoldFlags.value} flags.`,
      rules,
    )
  }
  const failures = heldProgression(draft, input, state)
  return result(
    'reds-hold',
    failures.length === 0,
    failures.length === 0
      ? `${state.risk.redsFlags} energy-availability flags: progression holds, with no growth and no back-to-back runs.`
      : failures.join('; '),
    rules,
  )
}

/** N-1: focal bone pain, while it is reported, holds progression. */
function bonePainHoldItem(
  draft: PlanDraft,
  input: EngineInput,
  state: AthleteState,
): ChecklistResult {
  const rules = ['n-1']
  if (!focalBoneActive(input, input.today)) {
    return result('bone-pain-hold', true, 'No focal bone pain reported.', rules)
  }
  const failures = heldProgression(draft, input, state)
  return result(
    'bone-pain-hold',
    failures.length === 0,
    failures.length === 0
      ? 'Focal bone pain reported: progression holds, with no growth and no back-to-back runs.'
      : failures.join('; '),
    rules,
  )
}

/** Statuses of a session the runner edited: the item checks what the engine placed, not these. */
const RUNNER_EDITED: ReadonlySet<string> = new Set(['moved', 'skipped', 'adjusted', 'downgraded'])

/**
 * J9, J7, G-6: the rest windows hold. No run, hike or strength session falls on a held day and each
 * held day from today carries a session (the rest session, or the race), no run is above the cap of
 * its day, no quality session sits on a day a window keeps easy, and a week held to the restart
 * fraction stays within it. Present only when windows exist. A session the runner moved, shortened
 * or eased is theirs and is not checked.
 */
function disruptionWindowItem(
  draft: PlanDraft,
  input: EngineInput,
  state: AthleteState,
): ChecklistResult | null {
  const plan = disruptionPlan(input.disruptions ?? [])
  if (plan.days.length === 0) return null
  const rules = ['J9', 'J7', 'g-6']
  const failures: string[] = []
  const edited = new Set(
    (input.existing?.sessions ?? [])
      .filter((s) => s.date >= input.today && RUNNER_EDITED.has(s.status))
      .map(slotKey),
  )
  const ahead = toRun(draft, input)
  for (const s of ahead) {
    const rule = dayRuleOn(plan, s.date)
    if (rule === null || s.kind === 'race' || edited.has(slotKey(s))) continue
    if (rule.held) {
      if (RUN_KINDS.has(s.kind) || s.kind === 'strength') {
        failures.push(`${s.date} ${s.kind} falls on a day a rest window holds`)
      }
    } else if (VOLUME_KINDS.has(s.kind)) {
      if (rule.maxRunMin !== null && s.durationMin > rule.maxRunMin + EPS) {
        failures.push(
          `${s.date} ${s.kind} runs ${s.durationMin} min on a ${rule.maxRunMin} min day`,
        )
      } else if (!rule.quality && NO_QUALITY_KINDS.has(s.kind)) {
        failures.push(`${s.date} ${s.kind} is hard work on a day windows keep easy`)
      }
    }
  }
  for (const rule of plan.days) {
    if (!rule.held || rule.date < input.today || rule.date >= input.goal.date) continue
    if (!draft.sessions.some((s) => s.date === rule.date)) {
      failures.push(`${rule.date} is a day a rest window holds and carries no rest session`)
    }
  }
  // the weeks held to the restart fraction, against the reference week of the hold
  const volume = new Map<string, number>()
  for (const row of state.weeks) volume.set(row.weekStart, row.runMin)
  const currentMonday = mondayOf(input.today)
  const starts = [...new Set(draft.sessions.map((s) => mondayOf(s.date)))].sort()
  const huge = Number.MAX_SAFE_INTEGER
  for (const weekStart of starts) {
    if (weekStart < currentMonday) continue
    const done = weekStart === currentMonday ? (volume.get(weekStart) ?? 0) : 0
    const total = done + weekMinutes(ahead, weekStart, input.today)
    volume.set(weekStart, total)
    const returning = plan.holds.filter(
      (h) => h.fraction < 1 && (h.returnWeekStart === weekStart || h.fullWeekStart === weekStart),
    )
    // a start-path week is set by its programme, not by the share of the week before [rules J7, E6]
    const week = draft.weeks.find((w) => w.weekStart === weekStart)
    const programme =
      week !== undefined && (isStartPathWeek(week) || week.flags.includes('restart-floor'))
    if (returning.length === 0 || programme) continue
    const reference = Math.min(...returning.map((h) => holdReference(h, (ws) => volume.get(ws))))
    if (!(reference > 0)) continue
    const cap = disruptionWeekCap(plan, weekStart, { referenceMin: reference, baselineMin: huge })
    if (cap?.capMin != null && total > cap.capMin + 1) {
      failures.push(
        `week of ${weekStart}: ${Math.round(total)} min is above ${cap.capMin} min, the share of the week before the break that a return allows`,
      )
    }
  }
  return result(
    'disruption-window',
    failures.length === 0,
    failures.length === 0 ? windowCheckLine(plan.days.length) : failures.join('; '),
    rules,
  )
}

/** The plan quality checklist run before publishing [rules G1]. */
export function runChecklist(draft: PlanDraft, input: EngineInput): ChecklistResult[] {
  const state = estimateState(input)
  const windows = disruptionWindowItem(draft, input, state)
  return [
    progression(draft, input, state),
    recoveryCadence(draft, state, input),
    tid(draft),
    taper(draft),
    levelDifferentiation(draft, state, input.today),
    ladderSteps(draft, input),
    breakRestartItem(draft, input, state),
    spikeGuard(draft, state),
    availability(draft, input),
    spacing(draft, input),
    ultraCaps(draft, input),
    raceDay(draft, input),
    postRaceWindowItem(draft, input),
    redsHoldItem(draft, input, state),
    bonePainHoldItem(draft, input, state),
    ...(windows === null ? [] : [windows]),
  ]
}
