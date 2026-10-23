// Engine entry points. Pure and deterministic for a given input; `today` arrives in the input.
// buildPlan runs state, zones, goal, feasibility, macro, micro, guards, race day, checklist and
// prediction in that order; replan keeps the past and recomputes the future. The other entry
// points delegate to the module that owns the rule.
import { addDays, mondayOf } from '../dates.ts'
import { isToRun } from '../domain/sessionStatus.ts'
import type { AthleteProfile, PlanSessionStatus, Weekday } from '../types.ts'
import { breakRestart, trimQuality } from './adapt.ts'
import { estimateState } from './athlete.ts'
import { runChecklist } from './checklist.ts'
import {
  dayRulesIn,
  disruptionPlan,
  disruptionWeekCap,
  heldDates,
  holdReference,
  restSessions,
  returnWeeks,
  type DayRule,
} from './disruption.ts'
import { feasibility } from './goal.ts'
import { applyGuards } from './guards.ts'
import { heatWarning } from './heat.ts'
import {
  completedReference,
  gainLimit,
  isProgramme,
  noviceRamp,
  rampLimits,
  rampSkipWeeks,
  recordOf,
  referenceAt,
  runCaps,
  runningGain,
  runningMinutes,
  tightRamp,
  VOLUME_KINDS,
  weeklyGain,
  type RampContext,
  type RunRecord,
} from './limits.ts'
import { isDuplicate } from './load.ts'
import { macroPlanDraft, redsHold, startPath } from './macro.ts'
import { holdSessions, placeWeek } from './micro.ts'
import { P, PARAMS_VERSION } from './params/index.ts'
import { planWindows, postRaceWarnings } from './postRace.ts'
import { predictRace } from './predict.ts'
import { focalBoneActive, isQualityKind } from './readiness.ts'
import { prescribe } from './sessions.ts'
import {
  isProgrammeWeek,
  placedFocus,
  startExemptions,
  startKind,
  startSessionMinMin,
} from './startWeeks.ts'
import type {
  AthleteState,
  EngineInput,
  EngineWarning,
  PlanChange,
  PlanDraft,
  SessionKind,
  SessionSpec,
  WeekDraft,
  WeeklyDecision,
  ZoneSet,
} from './types.ts'
import { buildZones } from './zones.ts'

export { zoneProposals, weeklyDecision } from './adapt.ts'
export {
  daysBefore,
  isComparableCourse,
  median,
  scorePredictions,
  scoreRace,
  summariseRecord,
  weeksBefore,
} from './backtest.ts'
export type {
  CourseSnapshot,
  LoggedPrediction,
  RaceOutcome,
  RaceResultInput,
  RaceScore,
  RecordSummary,
  ScoredPrediction,
} from './backtest.ts'
export { adjustCheck, shortenedSession } from './adjust.ts'
export type { AdjustCheck, AdjustContext, AdjustEdit, SessionPatch } from './adjust.ts'
export { runChecklist } from './checklist.ts'
export {
  dayRuleOn,
  dayRulesIn,
  disruptionPlan,
  disruptionWeekCap,
  heldDates,
  holdReference,
  illnessDays,
  illnessGate,
  injuryReportOf,
  injuryReports,
  isDisruptedWeek,
  restartFraction,
  restSessions,
  returnWeeks,
  validateDisruption,
  windowPhase,
} from './disruption.ts'
export type {
  DayRule,
  DisruptionDraft,
  DisruptionIssue,
  DisruptionPlan,
  HoldRun,
  InjuryReport,
  WeekCap,
  WindowPlan,
} from './disruption.ts'
export { explain } from './explain.ts'
export { assessExecution, matchSessions } from './execution.ts'
export {
  ceilingIndex,
  eahCard,
  fuelEligible,
  fuelLineForSession,
  fuelRungs,
  fuelTargetFor,
  fuelTargetsFor,
  fuelWatchLine,
  isBlockRun,
  isHotForFuel,
  replayLadder,
  runIsHot,
  runScore,
} from './fuel.ts'
export type { FuelContext, LadderInput } from './fuel.ts'
export { PARAMS_VERSION, P } from './params/index.ts'
export { predictRace, rangeLabel } from './predict.ts'
export { readinessSignals, readinessVerdict, strongestAdvice, todayAdvice } from './readiness.ts'
export { weeklyRamp } from './macro.ts'

const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
/** Session kinds that make a week's long run, alone or as a back-to-back pair. */
const LONG_RUNS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'long',
  'long-fast-finish',
  'b2b',
])
/** Session kinds that do not use a run day. */
const NOT_RUNS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'strength',
  'mobility',
  'rest',
  'cross',
])

/** A session the plan already holds and keeps as it is (replan): the spec without its row fields. */
type KeptSession = SessionSpec

/** What a re-plan keeps and what it tells the generator. */
interface Keep {
  /** Sessions kept as they are: the past, finished sessions of this week, owner edits ahead. */
  sessions: KeptSession[]
  /** The kept sessions still to run (moved, swapped or trimmed): they count toward their week. */
  toRun: ReadonlySet<KeptSession>
  /** For weeks with kept sessions: the running minutes the replaced plan still had on other days. */
  stillPlanned: ReadonlyMap<string, number>
  /** The kept sessions that a recorded activity stands for; its run is counted from the activity. */
  matched: ReadonlySet<KeptSession>
  decisions: NonNullable<ReplanOptions['decisions']>
}

/** Options of a re-plan beyond the engine input. */
export interface ReplanOptions {
  /**
   * The weekly decision behind each week's cap, by the Monday of the week it applies to [rules J5]:
   * a hold trims the week's next quality session, a reduce makes the week a recovery week.
   */
  decisions?: Record<string, WeeklyDecision['decision']>
}

const OWNER_EDITS: ReadonlySet<string> = new Set(['moved', 'skipped', 'adjusted'])

/** The edits and trims a rest window releases when they fall on a day it holds [rule J9]. */
const RELEASED_ON_HOLD: ReadonlySet<string> = new Set([...OWNER_EDITS, 'downgraded'])

const isTrim = (s: { status: string; rules: string[] }) =>
  s.status === 'downgraded' && s.rules.includes('design-4.3')

/**
 * True for a session a re-plan keeps as it is: the past, the finished sessions of the current
 * week, and in the next 14 days the owner's edits (moved, swapped or skipped sessions) and the
 * trims of the next quality session [design 4.3]. The server keeps the same rows.
 *
 * `holdDates` are the days a rest window holds (`heldDates`): an edit or trim on one of them, from
 * today on, is released, so the re-plan can put a rest session there [rule J9]. A finished session
 * is never released.
 */
export function keptByReplan(
  session: { date: string; status: string; rules: string[] },
  today: string,
  holdDates?: ReadonlySet<string>,
): boolean {
  if (session.date < today) return true
  const released = holdDates?.has(session.date) === true && RELEASED_ON_HOLD.has(session.status)
  if (mondayOf(session.date) === mondayOf(today) && session.status !== 'planned') return !released
  if (session.date >= addDays(today, P.macroDesign.keepOwnerEditsDays.value)) return false
  return !released && (OWNER_EDITS.has(session.status) || isTrim(session))
}

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
 * The part of a week still to plan when some of it is settled: the current week (what was already
 * run) or a week with kept sessions (owner edits still to run, skipped sessions). The target less
 * what was run and what the kept sessions hold, the same share of the climbing, and no more run
 * days than the week has left. It is also held to what the replaced plan still had on the other
 * days (`stillPlanned`), so missed or skipped volume is never made up [rules g-6].
 */
function remainingOfWeek(
  week: WeekDraft,
  done: { minutes: number; runDays: number },
  keptRunDates: ReadonlySet<string>,
  keptMinutes: number,
  stillPlanned: number | null,
): WeekDraft {
  const left = Math.max(0, Math.floor(week.targetRunMin - done.minutes - keptMinutes))
  const runDays = Math.max(0, week.runDays - done.runDays - keptRunDates.size)
  const target = stillPlanned === null ? left : Math.min(left, stillPlanned)
  const share = week.targetRunMin > 0 ? target / week.targetRunMin : 0
  return {
    ...week,
    targetRunMin: target,
    longRunMin: Math.min(week.longRunMin, target),
    longRunM: week.longRunM === null ? null : Math.round((week.longRunM * share) / 100) * 100,
    gainTargetM:
      week.gainTargetM === null ? null : Math.round((week.gainTargetM * share) / 10) * 10,
    runDays,
  }
}

/**
 * The week held to `cap` minutes: the long run and the climbing shrink by the same share, so the
 * sessions are placed against the lower week. A cap above the target changes nothing.
 */
function capWeek(week: WeekDraft, cap: number | undefined): WeekDraft {
  if (cap === undefined || cap >= week.targetRunMin) return week
  const target = Math.max(0, Math.floor(cap))
  const share = week.targetRunMin > 0 ? target / week.targetRunMin : 0
  return {
    ...week,
    targetRunMin: target,
    longRunMin: Math.min(Math.floor(week.longRunMin * share + 1e-9), target),
    longRunM: week.longRunM === null ? null : Math.round((week.longRunM * share) / 100) * 100,
    gainTargetM:
      week.gainTargetM === null ? null : Math.round((week.gainTargetM * share) / 10) * 10,
  }
}

/**
 * The week held to what a rest window leaves of its held days [rule J9]: the target falls to `cap`
 * minutes, and the sessions of the days left keep the lengths they had, so the long run stays as
 * long as the target allows, where `capWeek` shrinks every session by the same share.
 */
function holdWeek(week: WeekDraft, cap: number): WeekDraft {
  if (cap >= week.targetRunMin) return week
  const target = Math.max(0, Math.floor(cap))
  const share = week.targetRunMin > 0 ? target / week.targetRunMin : 0
  const longRunMin = Math.min(week.longRunMin, target)
  const longShare = week.longRunMin > 0 ? longRunMin / week.longRunMin : 0
  return {
    ...week,
    targetRunMin: target,
    longRunMin,
    longRunM: week.longRunM === null ? null : Math.round((week.longRunM * longShare) / 100) * 100,
    gainTargetM:
      week.gainTargetM === null ? null : Math.round((week.gainTargetM * share) / 10) * 10,
  }
}

/** The week without its long run: a window holds the day the plan had it on, and it is not moved. */
function withoutLongRun(week: WeekDraft): WeekDraft {
  return { ...week, longRunMin: 0, longRunM: week.longRunM === null ? null : 0 }
}

/**
 * A week the weekly decision reduces is a recovery week [rules J5, E3]: it is marked so, and held
 * to the recovery cut from the last loading week before it.
 */
function reduceWeek(week: WeekDraft, lastLoad: WeekDraft | undefined): WeekDraft {
  const cut = P.e3.recoveryWeekCutPct.value / 100
  const capped =
    lastLoad === undefined
      ? week
      : capWeek(week, Math.floor(lastLoad.targetRunMin * (1 - cut) + 1e-9))
  return {
    ...capped,
    isRecovery: true,
    focus: 'Recovery week: lighter volume, frequency kept',
    flags: capped.flags.includes('recovery') ? capped.flags : [...capped.flags, 'recovery'],
  }
}

/**
 * A break of 7 days or more restarts below the volume before it [rules J7]: the typical week the
 * macrocycle grows from is the restart volume, not the pre-break one.
 */
export function afterBreak(state: AthleteState): AthleteState {
  if (state.layoffDays < P.j7.tier1Days.value || state.typicalWeekMin <= 0) return state
  const restart = breakRestart(state.layoffDays, state.typicalWeekMin)
  return { ...state, typicalWeekMin: Math.min(state.typicalWeekMin, restart.restartMin) }
}

/**
 * The shared generator. `keep` holds the sessions of the existing plan that stay as they are (the
 * past, the finished sessions of the current week and the owner's edits ahead); their dates are
 * closed to new sessions. `weekOffset` is the number of weeks of the existing plan before the
 * current one, so a week keeps its index in the plan.
 *
 * Each week is placed inside the limits the guards check (limits.ts), measured on what is already
 * run and placed: the weekly ramp and gain ramp over the previous loading weeks, and the 30-day
 * reference of every run. The macrocycle draws its weeks inside the same limits, so this changes
 * nothing for a plan placed as drawn, and the guards that follow find nothing to cut.
 */
function generate(input: EngineInput, keep: Keep, weekOffset: number): PlanDraft {
  const { today, goal } = input
  const kept = keep.sessions
  const state = afterBreak(estimateState(input))
  const zones = buildZones(input.profile, state, today)
  const feas = feasibility(goal, state, today, startPath(input, state))
  const currentMonday = mondayOf(today)
  const pastWeeks = (input.existing?.weeks ?? []).filter((w) => w.weekStart < currentMonday)
  const macro: WeekDraft[] = []
  const { weeks: macroWeeks, raceWeekTail } = macroPlanDraft(input, state, goal, feas)
  for (const w of macroWeeks) {
    let week: WeekDraft = {
      ...capWeek(w, input.weekCaps?.[w.weekStart]),
      index: w.index + weekOffset,
    }
    if (keep.decisions[w.weekStart] === 'reduce' && !week.isTaper && week.phase !== 'race') {
      const lastLoad = [...pastWeeks, ...macro]
        .filter((x) => x.weekStart < w.weekStart && !x.isRecovery && !x.isTaper)
        .at(-1)
      week = reduceWeek(week, lastLoad)
    }
    macro.push(week)
  }
  const keptDates = new Set(kept.filter((s) => s.date >= today).map((s) => s.date))
  // The post-race windows the plan's days fall in: a past race's, and the goal race's [rules H12].
  const windows = planWindows(input)
  // The rest windows the runner reported [rule J9]: a held day closes to running and strength, caps
  // and quiet days pass to the week placement, and a week the windows touch holds what they leave.
  const dplan = disruptionPlan(input.disruptions ?? [])

  // The limits, from the completed runs and weeks, then each week as it is placed.
  const completed = completedReference(input.activities, state)
  // The 30-day reference of every run: the completed runs and the planned ones before it. The
  // sessions of a start-path programme are compared with the completed runs and the plain runs
  // only (`plain`); the runs after a programme see its sessions too [rules E6, g-1].
  const records: RunRecord[] = [...completed.runs]
  const plain: RunRecord[] = [...completed.runs]
  const volumes = new Map(state.weeks.map((w) => [w.weekStart, w.runMin]))
  const gains = weeklyGain(input.activities)
  const floorWeek = [...pastWeeks, ...macro].filter((w) => w.flags.includes('restart-floor')).at(-1)
  // The post-race weeks are recovery weeks that set a ramp baseline: the weeks after them grow
  // from the last step, not from the weeks before the race [rules H12, g-6].
  const lowWeeks = [...pastWeeks, ...macro]
    .filter((w) => (w.isRecovery || w.isTaper) && !w.flags.includes('post-race'))
    .map((w) => w.weekStart)
  // exempt from G-2: the post-race weeks, and the week that restarts from them [rules H12, J7]
  const afterRaceWeeks = [...pastWeeks, ...macro]
    .filter((w) => w.flags.includes('post-race') || w.flags.includes('post-race-restart'))
    .map((w) => w.weekStart)
  const rampCtx: RampContext = {
    volumes,
    skip: rampSkipWeeks(today, lowWeeks),
    floor:
      floorWeek === undefined
        ? null
        : { weekStart: floorWeek.weekStart, minutes: floorWeek.targetRunMin },
    exempt: startExemptions([...pastWeeks, ...macro], returnWeeks(dplan)),
    typicalWeekMin: state.typicalWeekMin,
    novice: noviceRamp(state),
    tight: tightRamp(state),
  }
  const doneRow = state.weeks.find((w) => w.weekStart === currentMonday)
  const doneGain = gains.get(currentMonday) ?? 0
  const isRun = (s: SessionSpec) => s.durationMin > 0 && !NOT_RUNS.has(s.kind)

  // Micro: each week to days; weeks see the sessions placed before them.
  const placed: SessionSpec[] = []
  const shortOfDays: Array<{ weekStart: string; fit: number; wanted: number; spaced: boolean }> = []
  const tooShort: Array<{ weekStart: string; room: number; minimum: number }> = []
  const history: SessionSpec[] = [...kept]
  const raceMonday = mondayOf(goal.date)
  for (let w = 0; w < macro.length; w++) {
    const week = macro[w]!
    const isCurrent = week.weekStart === currentMonday
    const weekEnd = addDays(week.weekStart, 6)
    const inWeek = (s: SessionSpec) => s.date >= week.weekStart && s.date <= weekEnd
    const keptAhead = kept.filter((s) => inWeek(s) && s.date >= today)
    const keptToRun = keptAhead.filter((s) => keep.toRun.has(s))
    const closed = new Set<string>()
    for (let i = 0; i < 7; i++) {
      const date = addDays(week.weekStart, i)
      if (date < today || keptDates.has(date)) closed.add(date)
    }
    // the days a window rules in this week; the week as it would be without the windows closes only
    // the days above
    const weekRules: DayRule[] =
      dplan.days.length === 0 ? [] : dayRulesIn(dplan, { from: week.weekStart, to: weekEnd })
    const closedBase = weekRules.length === 0 ? closed : new Set(closed)
    for (const rule of weekRules) if (rule.held) closed.add(rule.date)
    // What the current week has run so far: the recorded activities, and the sessions kept from the
    // replaced plan that no activity stands for (finished without a recorded run). A day with a
    // run, done or kept, is one run day: a session finished today and its activity are the same run.
    const ranDates = new Set(
      isCurrent
        ? input.activities
            .filter(
              (a) =>
                (a.type === 'run' || a.type === 'race') &&
                !isDuplicate(a) &&
                a.date >= week.weekStart &&
                a.date <= today &&
                !keptDates.has(a.date),
            )
            .map((a) => a.date)
        : [],
    )
    const unrecorded = isCurrent
      ? kept.filter(
          (s) =>
            inWeek(s) &&
            s.date < today &&
            VOLUME_KINDS.has(s.kind) &&
            s.durationMin > 0 &&
            !keep.matched.has(s) &&
            !ranDates.has(s.date) &&
            // a run a rest window skipped was not run [rule J9]
            !s.flags.includes('rest-window'),
        )
      : []
    const done = isCurrent
      ? {
          minutes: (doneRow?.runMin ?? 0) + runningMinutes(unrecorded),
          gain: doneGain + runningGain(unrecorded),
          runDays: new Set([...ranDates, ...unrecorded.map((s) => s.date)]).size,
        }
      : { minutes: 0, gain: 0, runDays: 0 }
    const keptMin = runningMinutes(keptToRun)
    let planWeek = week
    if (isCurrent || keptAhead.length > 0) {
      planWeek = remainingOfWeek(
        week,
        done,
        new Set(keptAhead.filter(isRun).map((s) => s.date)),
        keptMin,
        keep.stillPlanned.get(week.weekStart) ?? null,
      )
    }
    // A recovery week stays cut from the loading week before it, and a taper week below the week
    // before it, as placed [rules E3, K2].
    if (!isCurrent && keptAhead.length === 0) {
      const before = [...pastWeeks, ...macro.slice(0, w)]
      if (week.isRecovery && !week.flags.includes('post-race')) {
        const lastLoad = before.filter((x) => !x.isRecovery && !x.isTaper).at(-1)
        const cut = P.e3.recoveryWeekCutPct.value / 100
        if (lastLoad !== undefined) {
          planWeek = capWeek(planWeek, Math.floor(lastLoad.targetRunMin * (1 - cut) + 1e-9))
        }
      } else if (week.isTaper && before.length > 0) {
        planWeek = capWeek(planWeek, Math.max(0, before.at(-1)!.targetRunMin - 1))
      }
    }
    // Inside the weekly ramp and the gain ramp, over what is run and placed [rules g-2, H4].
    // The post-race weeks and the restart week after them are exempt from G-2, as a return to an
    // established base [rules H12].
    const ramp = afterRaceWeeks.includes(week.weekStart)
      ? null
      : rampLimits(rampCtx, week.weekStart)
    if (ramp !== null && planWeek.targetRunMin > 0) {
      planWeek = capWeek(planWeek, Math.max(0, ramp.plan - done.minutes - keptMin))
    }
    const gainCap = gainLimit(gains, rampCtx.skip, week.weekStart)
    if (gainCap !== null && planWeek.gainTargetM !== null) {
      const room = Math.floor(gainCap.allowed - done.gain - runningGain(keptToRun) + 1e-9)
      if (planWeek.gainTargetM > room) planWeek = { ...planWeek, gainTargetM: Math.max(0, room) }
    }
    // The race week of the goal is placed as before: the days after the race are dropped below, and
    // its minutes stay before the race. Every other week keeps the windows its days fall in.
    const placing = windows.filter(
      (w) => !(w.race.date === goal.date && mondayOf(w.race.date) === week.weekStart),
    )
    const profile =
      closed.size > 0 ? closeDates(input.profile, week.weekStart, closed) : input.profile
    const place = (
      target: WeekDraft,
      on: AthleteProfile,
      rules: readonly DayRule[],
      ceiling = false,
    ) =>
      placeWeek(target, {
        profile: on,
        zones,
        state,
        prevSessions: history,
        limits: {
          runs: isProgrammeWeek(week.flags) ? plain : records,
          virtualTwoDay: completed.virtualTwoDay,
        },
        postRace: placing,
        longRunMaxM:
          goal.distanceClass === '5k' || goal.distanceClass === '10k'
            ? P.macroDesign.peakLongRunKmMax.value * 1000
            : undefined,
        ...(rules.length > 0 ? { dayRules: rules } : {}),
        ...(dplan.days.length > 0 ? { windowPlan: true } : {}),
        ...(ceiling ? { ceiling: true } : {}),
      })
    // A week a window touches, or that a long hold sends back at the J7 fraction, holds what the
    // window leaves of the plan's own week [rules J9, J7, G-6]: the minutes of the held days, and
    // the share of the reference week the restart allows, are lost and never moved.
    let disruptionFlags: string[] = []
    const startDrawn = isProgrammeWeek(week.flags) || week.flags.includes('restart-floor')
    const returning = dplan.holds.filter(
      (h) =>
        h.fraction < 1 &&
        (h.returnWeekStart === week.weekStart || h.fullWeekStart === week.weekStart),
    )
    if (weekRules.length > 0 || returning.length > 0) {
      // the minutes the plan had on the days a window rules, from the week placed without it
      const ruled = weekRules.filter((r) => r.date >= today && (r.held || r.maxRunMin !== null))
      let baselineAhead = planWeek.targetRunMin
      let longLost = false
      const minByDate: Record<string, number> = {}
      if (ruled.length > 0 && (planWeek.targetRunMin > 0 || planWeek.strengthSessions > 0)) {
        const baseline = place(planWeek, closeDates(input.profile, week.weekStart, closedBase), [])
        baselineAhead = runningMinutes(baseline)
        for (const s of baseline) {
          if (VOLUME_KINDS.has(s.kind)) minByDate[s.date] = (minByDate[s.date] ?? 0) + s.durationMin
        }
        // a long run on a held day, or above the cap of its day, is lost and not moved
        longLost = baseline.some((s) => {
          const rule = ruled.find((r) => r.date === s.date)
          return (
            LONG_RUNS.has(s.kind) &&
            rule !== undefined &&
            (rule.held || (rule.maxRunMin !== null && s.durationMin > rule.maxRunMin))
          )
        })
      }
      const baselineMin = done.minutes + keptMin + baselineAhead
      // A held day already past cost an equal share of the week, unless the replaced plan's own
      // remaining minutes already leave it out (a re-plan: `stillPlanned`) [rule G-6].
      const pastShare = keep.stillPlanned.has(week.weekStart) ? 0 : baselineMin / 7
      for (const r of weekRules) if (r.held && r.date < today) minByDate[r.date] = pastShare
      // The programme of a start path sets its own weeks, and J7 hands the first weeks back to it
      // when the fraction falls under 3 x 20 min [rules J7, E6]: its week is not cut to the share.
      const reference = Math.min(...returning.map((h) => holdReference(h, (ws) => volumes.get(ws))))
      const referenceMin = startDrawn
        ? Number.MAX_SAFE_INTEGER
        : reference > 0 && Number.isFinite(reference)
          ? reference
          : baselineMin
      const cap = disruptionWeekCap(dplan, week.weekStart, { referenceMin, baselineMin, minByDate })
      if (cap !== null) {
        disruptionFlags = cap.flags
        if (cap.capMin !== null) {
          // a return week shrinks every session by the same share; a week that only lost days keeps
          // the sessions of the days left
          const left = Math.max(0, cap.capMin - done.minutes - keptMin)
          planWeek = cap.flags.includes('disruption-return')
            ? capWeek(planWeek, left)
            : holdWeek(planWeek, left)
        }
      }
      // a window that holds the day of the long run takes it; the run is not moved
      if (longLost) planWeek = withoutLongRun(planWeek)
    }
    if (!isCurrent && keptAhead.length === 0) {
      // the week as placed is the week of record
      macro[w] = {
        ...week,
        targetRunMin: planWeek.targetRunMin,
        longRunMin: planWeek.longRunMin,
        longRunM: planWeek.longRunM,
        gainTargetM: planWeek.gainTargetM,
      }
    }
    // the week says which windows touched it
    if (disruptionFlags.length > 0) {
      planWeek = { ...planWeek, flags: [...planWeek.flags, ...disruptionFlags] }
      const recorded = macro[w]!
      macro[w] = {
        ...recorded,
        flags: [...recorded.flags, ...disruptionFlags.filter((f) => !recorded.flags.includes(f))],
      }
    }

    // a week the windows (or the ramp back from them) hold under its drawn target is a ceiling
    const ceiling =
      dplan.days.length > 0 &&
      week.weekStart >= mondayOf(dplan.days[0]!.date) &&
      planWeek.targetRunMin < week.targetRunMin
    let sessions =
      planWeek.targetRunMin > 0 || planWeek.strengthSessions > 0
        ? place(planWeek, profile, weekRules, ceiling)
        : []
    // A hold trims the week's next quality session, once a week [rules J5, design 4.3].
    const trimmedAlready = kept.some((s) => inWeek(s) && s.rules.includes('design-4.3'))
    if (keep.decisions[week.weekStart] === 'hold' && !trimmedAlready) {
      const next = sessions.find((s) => s.date >= today && isQualityKind(s.kind))
      if (next !== undefined) {
        const cut = trimQuality(
          next,
          "last week's review suggested holding, so this session is a little shorter.",
        )
        sessions = sessions.map((s) => (s === next ? cut : s))
      }
    }
    // Fewer run days open than planned: the week gets the days there are, and the plan says so. A
    // week of a start path keeps a rest day between runs, so open days that sit next to each other
    // hold fewer sessions than the programme draws; the week then says what was placed.
    const placedRuns = sessions.filter((s) => VOLUME_KINDS.has(s.kind) && s.durationMin > 0)
    const placedDays = new Set(placedRuns.map((s) => s.date)).size
    const open = WEEKDAYS.filter((day) => {
      const a = profile.availability[day]
      return a.available && (a.maxMin === null || a.maxMin >= P.fplace.minRunDayMin.value)
    }).length
    // a part week (its Monday has passed) holds fewer runs by nature and is not counted
    const spaced =
      startDrawn &&
      week.weekStart >= today &&
      placedRuns.length > 0 &&
      placedDays < planWeek.runDays
    // a week a window touches has fewer days by the window, which its flag and rest days say
    if (
      planWeek.targetRunMin > 0 &&
      !planWeek.flags.includes('post-race') &&
      disruptionFlags.length === 0 &&
      (open < planWeek.runDays || spaced)
    ) {
      shortOfDays.push({
        weekStart: week.weekStart,
        fit: spaced ? placedDays : open,
        wanted: planWeek.runDays,
        spaced,
      })
    }
    if (startDrawn && placedRuns.length > 0) {
      // The week says what was placed. A whole week with nothing kept in it takes the target and
      // run days too, but not the first week of a start path: its minutes are the baseline the
      // ramp measures from. The current week, which part of it has run, takes the words only.
      const whole = !isCurrent && keptAhead.length === 0
      const baseline = week.flags.includes('restart-floor')
      const minutes = runningMinutes(placedRuns)
      const longest = Math.max(...placedRuns.map((s) => s.durationMin))
      const drawn = macro[w]!
      const focus = placedFocus(drawn, { days: whole ? placedDays : drawn.runDays, longest })
      const counts = whole && !baseline
      if (
        focus !== drawn.focus ||
        (counts && (minutes !== drawn.targetRunMin || placedDays !== drawn.runDays))
      ) {
        macro[w] = {
          ...drawn,
          ...(counts
            ? {
                targetRunMin: minutes,
                runDays: placedDays,
                longRunMin: drawn.longRunMin > 0 ? longest : 0,
              }
            : {}),
          focus,
        }
      }
    }
    // A week with a target but no run placed because 1.10x the 30-day reference is under the run
    // day minimum on every day left: the limit is hit, so the plan says so [rules g-1, F5].
    if (
      planWeek.targetRunMin > 0 &&
      disruptionFlags.length === 0 &&
      runningMinutes(sessions) === 0
    ) {
      const room = Math.max(
        0,
        ...[0, 1, 2, 3, 4, 5, 6]
          .map((i) => addDays(week.weekStart, i))
          .filter((date) => date >= today)
          .map((date) => runCaps(referenceAt(records, date)).min),
      )
      const minimum = startDrawn ? startSessionMinMin() : P.fplace.minRunDayMin.value
      if (room < minimum) {
        tooShort.push({ weekStart: week.weekStart, room, minimum })
      }
    }
    // The race day holds the race and the rest of race week is the start of recovery; the weeks
    // after it keep their own (reduced) sessions.
    const inside = sessions.filter((s) => s.date < goal.date || mondayOf(s.date) > raceMonday)
    // hold days after a race are rest days, the race week's included [rules H12]
    const rest = holdSessions(week, zones, windows, today).filter((s) => !keptDates.has(s.date))
    // The days of the race week after the hold carry the first return step: easy runs within its
    // caps, counted with the step's runs of the weeks after [rules H12].
    const afterRace =
      raceWeekTail !== null && raceWeekTail.targetRunMin > 0 && week.weekStart === raceMonday
        ? placeWeek(raceWeekTail, {
            profile: closeDates(
              input.profile,
              week.weekStart,
              new Set([
                ...closed,
                ...[0, 1, 2, 3, 4, 5, 6]
                  .map((i) => addDays(week.weekStart, i))
                  .filter((date) => date <= goal.date),
              ]),
            ),
            zones,
            state,
            prevSessions: [...history, ...inside],
            limits: {
              runs: [...records, ...inside.filter((s) => VOLUME_KINDS.has(s.kind)).map(recordOf)],
              virtualTwoDay: completed.virtualTwoDay,
            },
            postRace: windows,
          }).filter((s) => !keptDates.has(s.date))
        : []
    // hold days of a rest window are rest days with the window's words; the race day keeps the race
    // and a day already holding a kept session or a post-race rest keeps that [rule J9]
    const windowRest =
      dplan.days.length === 0
        ? []
        : restSessions(dplan, {
            from: week.weekStart > today ? week.weekStart : today,
            to: weekEnd,
          }).filter(
            (s) =>
              s.date < goal.date && !keptDates.has(s.date) && !rest.some((r) => r.date === s.date),
          )
    placed.push(...inside, ...rest, ...afterRace, ...windowRest)
    history.push(...inside, ...afterRace)

    // The week enters the baselines and its runs the 30-day reference, as the guards count them.
    const ahead = [...inside, ...afterRace, ...keptToRun].filter((s) => s.date >= today)
    volumes.set(week.weekStart, done.minutes + runningMinutes(ahead))
    gains.set(week.weekStart, done.gain + runningGain(ahead))
    for (const s of ahead.sort(bySlot)) {
      if (!VOLUME_KINDS.has(s.kind)) continue
      records.push(recordOf(s))
      if (!isProgramme(s)) plain.push(recordOf(s))
    }
  }

  // Guards over the whole plan: the check, which finds nothing to cut in a plan placed as above.
  const guarded = applyGuards(placed, state, input.activities, {
    ultraRaceDurationSec: goal.isUltra ? goal.expectedDurationSec : null,
    neverOverride: true,
    lowWeeks,
    exemptWeeks: afterRaceWeeks,
    startPath:
      rampCtx.floor === null || floorWeek === undefined
        ? null
        : { ...rampCtx.floor, kind: startKind(floorWeek.flags) ?? 'floor' },
    exempt: rampCtx.exempt,
    fixed: kept.filter((s) => keep.toRun.has(s) && s.date >= today),
  })

  // Race day.
  const raceWeek = macro.find((w) => w.weekStart === mondayOf(goal.date))
  const sessions: SessionSpec[] = [...guarded.sessions]
  if (raceWeek !== undefined && goal.date >= today) {
    sessions.push(raceSession(input, zones, raceWeek))
  }
  const all = [...kept, ...sessions].sort(bySlot)

  const warnings: EngineWarning[] = [...feas.notes, ...guarded.warnings]
  if (shortOfDays.length > 0) {
    const first = shortOfDays[0]!
    warnings.push({
      code: 'availability-limits-runs',
      severity: 'info',
      message: `${shortOfDays.length} week(s), from the week of ${first.weekStart}, have room for fewer run days (${first.fit}) than the ${first.wanted} planned${first.spaced ? ', as the open days leave too few with a rest day between runs' : ''}, so those weeks hold the runs on the days that fit.`,
      rules: ['F5'],
    })
  }
  if (tooShort.length > 0) {
    const first = tooShort[0]!
    warnings.push({
      code: 'spike-run-dropped',
      severity: 'info',
      message: `${tooShort.length} week(s), from the week of ${first.weekStart}, hold no run: ${P.g1.spikeRatioWarn.value}x the longest run of the last ${P.g1.windowDays.value} days is ${first.room} min, under the ${first.minimum}-minute minimum for a run in those weeks, so those runs are left out.`,
      rules: ['g-1', 'F5'],
    })
  }
  warnings.push(...postRaceWarnings(windows))
  if (redsHold(state)) {
    warnings.push({
      code: 'reds-hold',
      severity: 'hold',
      message: `${state.risk.redsFlags} signs on the energy-availability screening. Progression holds: weekly running stays at the current level, with no ramp and no new back-to-back runs. A clinician or sports dietitian can help look at this; consider booking one before adding load.`,
      rules: ['n-4', 'J5'],
    })
  }
  if (focalBoneActive(input, today)) {
    warnings.push({
      code: 'focal-bone-hold',
      severity: 'hold',
      message:
        "Focal bone pain or point tenderness was reported. Progression holds: weekly running, the long run and climbing stay at their current level, with no back-to-back runs, until a check-in no longer reports it. Today's advice is rest; please have it assessed by a clinician.",
      rules: ['n-1'],
    })
  }
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
  const draft = generate(
    input,
    { sessions: [], toRun: new Set(), stillPlanned: new Map(), matched: new Set(), decisions: {} },
    0,
  )
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
 * Keeps the past, the finished sessions of the current week and the owner's edits of the next 14
 * days (`keptByReplan`), recomputes the rest from the updated state within every limit, and lists
 * what changed with the rule ids behind it. `options.decisions` carries the weekly decision behind
 * a week's cap [rules J5].
 */
export function replan(
  input: EngineInput,
  options: ReplanOptions = {},
): { draft: PlanDraft; changes: PlanChange[] } {
  const existing = input.existing
  const currentMonday = mondayOf(input.today)
  const oldWeeks = existing?.weeks ?? []
  const oldSessions = existing?.sessions ?? []

  const pastWeeks = oldWeeks.filter((w) => w.weekStart < currentMonday)
  // an owner edit on a day a rest window holds is released, so the day can carry its rest session
  const holds = new Set(heldDates(disruptionPlan(input.disruptions ?? [])))
  const keptRows = oldSessions.filter((s) => keptByReplan(s, input.today, holds))
  const kept = keptRows.map(specOf)
  // The engine input types a stored status as a string; the server passes the plan's own statuses.
  const toRun = new Set(
    kept.filter(
      (_, i) =>
        keptRows[i]!.date >= input.today && isToRun(keptRows[i]!.status as PlanSessionStatus),
    ),
  )

  // A re-plan never adds to a week with settled sessions what the replaced plan did not hold on
  // its other days [rules g-6]: the current week, and the weeks with owner edits ahead.
  const settled = new Set([
    currentMonday,
    ...keptRows.filter((s) => s.date >= input.today).map((s) => mondayOf(s.date)),
  ])
  const stillPlanned = new Map<string, number>()
  for (const weekStart of settled) {
    if (!oldWeeks.some((w) => w.weekStart === weekStart)) continue
    stillPlanned.set(
      weekStart,
      plannedMinutes(
        oldSessions.filter((s) => s.status === 'planned'),
        weekStart,
        input.today,
      ),
    )
  }
  const matched = new Set(kept.filter((_, i) => keptRows[i]!.activityId !== null))
  const draft = generate(
    input,
    { sessions: kept, toRun, stillPlanned, matched, decisions: options.decisions ?? {} },
    pastWeeks.length,
  )
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
