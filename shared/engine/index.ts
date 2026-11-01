// Engine entry points. Pure and deterministic for a given input; `today` arrives in the input.
// buildPlan runs state, zones, goal, feasibility, macro, micro, guards, race day, checklist and
// prediction in that order; replan keeps the past and recomputes the future. The other entry
// points delegate to the module that owns the rule.
import { loadFocus } from '../copy/load.ts'
import { addDays, mondayOf } from '../dates.ts'
import { HOLD_TRIM_RULE, isHoldTrim, isToRun, isTrimmed } from '../domain/sessionStatus.ts'
import type { AthleteProfile, PlanSessionStatus, Weekday } from '../types.ts'
import { afterBreak, trimQuality } from './adapt.ts'
import { estimateState } from './athlete.ts'
import { runChecklist } from './checklist.ts'
import {
  dayRuleOn,
  dayRulesIn,
  disruptionPlan,
  disruptionWeekCap,
  heldDates,
  holdReference,
  holdRestartWeeks,
  isDisruptedWeek,
  longHoldWeeks,
  restartShares,
  restSessions,
  returnWeeks,
  windowedWeeks,
  type DayRule,
  type DisruptionPlan,
} from './disruption.ts'
import { feasibility } from './goal.ts'
import { applyGuards } from './guards.ts'
import { heatWarning } from './heat.ts'
import {
  completedReference,
  gainLimit,
  isProgramme,
  overshootFlags,
  rampBasis,
  rampLimits,
  rampSkipWeeks,
  rebuildZoneUsed,
  recordOf,
  referenceAt,
  runCaps,
  runningGain,
  runningMinutes,
  VOLUME_KINDS,
  weeklyGain,
  type RampContext,
  type RunRecord,
} from './limits.ts'
import { isDuplicate } from './load.ts'
import { rebuildZone, responseBasis } from './loadSetting.ts'
import { macroPlanDraft, redsHold, startPath, strengthBlockPosition } from './macro.ts'
import { resolveMethod } from './methods.ts'
import { holdSessions, placeWeek, shakeOutFor, type ShakeOut } from './micro.ts'
import { P, PARAMS_VERSION } from './params/index.ts'
import { planWindows, postRaceWarnings } from './postRace.ts'
import { predictRace } from './predict.ts'
import { focalBoneActive, isQualityKind } from './readiness.ts'
import { prescribe } from './sessions.ts'
import { shapeOfFlags, takesShape, withShape } from './shape.ts'
import {
  isLoadingWeek,
  isProgrammeWeek,
  placedFocus,
  startExemptions,
  startKind,
  startSessionMinMin,
} from './startWeeks.ts'
import type {
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

export { afterBreak, zoneProposals, weeklyDecision } from './adapt.ts'
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
export {
  anchorEstimate,
  barbellAllowed,
  blockPosition,
  estimateOneRm,
  isLowReadiness,
  liftFor,
  liftTexts,
  modeOf,
  percentOfMax,
  pickLift,
  rampInWeeks,
  sessionVariant,
  strengthTemplate,
  structuresFor,
  suggestLoad,
  summariseHistory,
  waysFor,
  workoutFor,
} from './strength.ts'
export type {
  BlockPosition,
  F8Rule,
  HistorySession,
  HistorySet,
  HistorySummary,
  LiftChoice,
  LiftHistory,
  LiftRole,
  LiftWay,
  LoadRequest,
  LoadSuggestion,
  PickOptions,
  Structure,
  StructureKind,
  StructureSet,
  WeekHistory,
} from './strength.ts'

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
  /**
   * The weeks the replaced plan has not started (`unstartedWeek`), each with the plan's own figure
   * for it: the week's stored target. `stillPlanned` of such a week is that figure unless a window
   * touches it.
   */
  figure: ReadonlyMap<string, number>
  /**
   * The same for every week the replaced plan has not started, a start-path week included (whose
   * minutes `figure` leaves to its programme): the week as the plan had it before a window reached
   * it, for the ramp that puts back the days a window took.
   */
  notStarted?: ReadonlyMap<string, number>
  /** The running minutes the replaced plan still has on each day from today on. */
  plannedOn: ReadonlyMap<string, number>
  /** The kept sessions that a recorded activity stands for; its run is counted from the activity. */
  matched: ReadonlySet<KeptSession>
  decisions: NonNullable<ReplanOptions['decisions']>
  /**
   * The Monday of a week whose sessions are all in `sessions` (a week held under the shape it was
   * drawn under, `replan`): nothing more is placed in it and its week row is not drawn again from
   * the macrocycle. The weeks after it read its kept sessions as the minutes it holds.
   */
  heldWeek?: string
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
  s.status === 'downgraded' && isTrimmed(s.rules)

/** A session still to be drawn that the weekly decision trimmed: the re-plan draws it again [rule J5]. */
const isHoldTrimRow = (s: { status: string; rules: string[] }) =>
  s.status === 'downgraded' && isHoldTrim(s.rules)

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
  // The trim of the weekly decision is that decision's own: a re-plan draws it again from the
  // decision, with the week it trims, and keeps no copy of it [rule J5].
  if (isHoldTrimRow(session)) return false
  const released = holdDates?.has(session.date) === true && RELEASED_ON_HOLD.has(session.status)
  if (mondayOf(session.date) === mondayOf(today) && session.status !== 'planned') return !released
  if (session.date >= addDays(today, P.macroDesign.keepOwnerEditsDays.value)) return false
  return !released && (OWNER_EDITS.has(session.status) || isTrim(session))
}

/** The kinds a window never skips: a rest day has nothing to skip, and the race is the runner's call. */
const NEVER_SKIPPED: ReadonlySet<string> = new Set(['rest', 'race'])

/**
 * The past sessions a rest window skips when it is reported late [rules J9, G-6]: sessions dated
 * before `today`, on a day the windows hold or cap, that are still to be run (`isToRun`) and have
 * no activity linked, so nothing says they were run. They are marked skipped, not deleted, and the
 * minutes they held are lost and never added back. Linked and finished sessions stay as they are.
 * Returns the matching entries of `sessions`, in their order.
 */
export function backdatedSkips<
  S extends { date: string; kind: string; status: string; activityId: string | null },
>(sessions: readonly S[], plan: DisruptionPlan, today: string): S[] {
  if (plan.days.length === 0) return []
  return sessions.filter((session) => {
    if (session.date >= today || session.activityId !== null) return false
    if (NEVER_SKIPPED.has(session.kind) || !isToRun(session.status as PlanSessionStatus)) {
      return false
    }
    const rule = dayRuleOn(plan, session.date)
    return rule !== null && (rule.held || rule.maxRunMin !== null)
  })
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
  // the long run stays as long as the target allows, and its distance with it, at the pace it had
  const longRunMin = Math.min(week.longRunMin, target)
  const longShare = week.longRunMin > 0 ? longRunMin / week.longRunMin : 0
  return {
    ...week,
    targetRunMin: target,
    longRunMin,
    longRunM: week.longRunM === null ? null : Math.round((week.longRunM * longShare) / 100) * 100,
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
 * A loading week already run past its target is taken as run [rules g-2, g-6]: the minutes logged
 * are a fact the engine cannot change, so the target rises to them and the week is flagged
 * `overshoot`. The rest of the week holds no more running (`remainingOfWeek`), and the weeks after
 * it were drawn from the planned week, so they neither rise on the strength of it nor make up
 * anything. A recovery, taper, race, post-race or programme week keeps its target: the recovery
 * cadence, the taper and the steps of a programme are read from it, and a ladder session is
 * logged with its walks.
 */
function takenAsRun(week: WeekDraft, ranMin: number): WeekDraft {
  if (!isLoadingWeek(week) || ranMin <= week.targetRunMin) return week
  return {
    ...week,
    targetRunMin: Math.ceil(ranMin - 1e-9),
    flags: [...week.flags, ...overshootFlags(week.targetRunMin)],
  }
}

/**
 * The figure a cut is taken from: that of the last week before it (the last loading week for the
 * cut of a recovery week [rule E3], any week for the fall of a taper [rule K2]). A week a window took
 * days from is a part week, and the minutes the window left are no base: `partFigure` is null for a
 * week no window touched; for one that is, it is the figure the week has without the window (the cut
 * is then taken from that, as a day closed in the week must not change the cut of the week after it,
 * relation 5.3), or Infinity where the week was run or stored as cut, and the cut then goes back to
 * the last week the window left. Undefined where there is none.
 */
function cutBase(
  before: readonly WeekDraft[],
  partFigure: (week: WeekDraft) => number | null,
  loadingOnly = true,
  figureOf: (week: WeekDraft) => number = (x) => x.targetRunMin,
): number | undefined {
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const x = before[i]!
    if (loadingOnly && (x.isRecovery || x.isTaper)) continue
    const figure = partFigure(x)
    if (figure === null) return figureOf(x)
    if (Number.isFinite(figure)) return figure
  }
  return undefined
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
 * The shared generator. `keep` holds the sessions of the existing plan that stay as they are (the
 * past, the finished sessions of the current week and the owner's edits ahead); their dates are
 * closed to new sessions. `weekOffset` is the number of weeks of the existing plan before the
 * current one, so a week keeps its index in the plan.
 *
 * Each week is placed inside the limits the guards check (limits.ts), measured on what is already
 * run and placed: the weekly ramp and gain ramp over the previous loading weeks, and the 30-day
 * reference of every run. The macrocycle draws its weeks inside the same limits, so this changes
 * nothing for a plan placed as drawn, and the guards that follow find nothing to cut.
 *
 * A method preset that applies [rules P1 to P4] is held week by week to what the default plan of the
 * same input does, so it never plans more than the default [rule G6]: see `WeekLimit`. `record`
 * collects those figures for the default run.
 */
function generate(
  input: EngineInput,
  keep: Keep,
  weekOffset: number,
  record?: Map<string, WeekLimit>,
): PlanDraft {
  const { today, goal } = input
  const kept = keep.sessions
  const state = afterBreak(estimateState(input))
  const zones = buildZones(input.profile, state, today)
  // The method preset that applies [rules P1 to P4]: the label reads its long-run share, the macro
  // cycle draws the weeks with it, and the week placement below reads the table of quality kinds,
  // once the plan's weeks show whether it has a base week to lengthen.
  const feas = feasibility(
    goal,
    state,
    today,
    startPath(input, state),
    resolveMethod(input, state).effective,
  )
  const currentMonday = mondayOf(today)
  const pastWeeks = (input.existing?.weeks ?? []).filter((w) => w.weekStart < currentMonday)
  const macro: WeekDraft[] = []
  // The week a hold caps carries the loading sequence on from the cap [rule J5].
  const heldCap =
    keep.decisions[currentMonday] === 'hold' ? input.weekCaps?.[currentMonday] : undefined
  // The week a reduce makes a recovery week is one for the macrocycle too, as it is when the stored
  // plan carries it: the cadence and the loading sequence are drawn once, not once for each case.
  const reduced =
    keep.decisions[currentMonday] === 'reduce' && input.existing !== null
      ? {
          ...input,
          existing: {
            ...input.existing,
            weeks: input.existing.weeks.map((w) =>
              w.weekStart === currentMonday ? { ...w, isRecovery: true } : w,
            ),
          },
        }
      : input
  // the default run a preset is held to draws its phases anew: it does not inherit the preset's
  const { weeks: macroWeeks, raceWeekTail } = macroPlanDraft(
    reduced,
    state,
    goal,
    feas,
    heldCap,
    record !== undefined,
  )
  const method = resolveMethod(input, state, [...pastWeeks, ...macroWeeks]).effective
  const limits = method === 'default' ? null : defaultWeeks(input, keep, weekOffset)
  // The rest windows the runner reported [rule J9]: a held day closes to running and strength, caps
  // and quiet days pass to the week placement, and a week the windows touch holds what they leave.
  const dplan = disruptionPlan(input.disruptions ?? [])
  // A week a window took days from is a part week, and part of a week is not a week: it counts as a
  // baseline beside another week and never alone, so the weeks after it are measured against the
  // last week run before it, the return of J7, and not against the minutes the window left. The
  // cut of a recovery week is sized from a loading week that is not a part week [rules J9, J7, g-2, E3].
  const windowed = windowedWeeks(dplan)
  const unwindowed = new Map<string, number>()
  for (const w of macroWeeks) {
    let week: WeekDraft = {
      ...capWeek(w, input.weekCaps?.[w.weekStart]),
      index: w.index + weekOffset,
    }
    if (keep.decisions[w.weekStart] === 'reduce' && !week.isTaper && week.phase !== 'race') {
      // the weeks drawn here are drawn without the windows, so only a week already run (stored) can
      // be a part week
      const lastLoad = [...pastWeeks, ...macro]
        .filter(
          (x) =>
            x.weekStart < w.weekStart &&
            !x.isRecovery &&
            !x.isTaper &&
            !(x.weekStart < currentMonday && isDisruptedWeek(x.flags)),
        )
        .at(-1)
      week = reduceWeek(week, lastLoad)
    }
    // The recovery week in progress stays cut from the loading week before it as that week stands in
    // the plan: the plan being replaced cut it from the week as it was drawn, and that week may since
    // have been held lower, so that the cut of the stored week no longer reads 25% [rules E3, J9].
    if (
      week.weekStart === currentMonday &&
      week.isRecovery &&
      !week.isTaper &&
      !week.flags.includes('post-race')
    ) {
      const base = cutBase(pastWeeks, (x) =>
        windowed.includes(x.weekStart) || isDisruptedWeek(x.flags) ? Infinity : null,
      )
      if (base !== undefined) {
        week = capWeek(week, Math.floor(base * (1 - P.e3.recoveryWeekCutPct.value / 100) + 1e-9))
      }
    }
    // A week drawn under a shape other than the plan's own says so, so that the next re-plan can
    // tell the shape it replaces from the shape that applies then (`replan`).
    macro.push(takesShape(week.flags) ? withShape(week, method) : week)
  }
  const keptDates = new Set(kept.filter((s) => s.date >= today).map((s) => s.date))
  // The post-race windows the plan's days fall in: a past race's, and the goal race's [rules H12].
  const windows = planWindows(input)

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
  // from the last step, not from the weeks before the race [rules H12, g-6]. So is the restart week
  // after a long hold that the J7 share holds, where the cadence made it a recovery week: the weeks
  // after it grow from it. A past one is known by its stored target; one still ahead is known when
  // it is placed, below [rules J7, J9].
  const pastTargets = new Map(pastWeeks.map((w) => [w.weekStart, w.targetRunMin]))
  const restartAt = holdRestartWeeks(
    dplan,
    (weekStart) => volumes.get(weekStart),
    (weekStart) => pastTargets.get(weekStart),
  )
  const structureLow = [...pastWeeks, ...macro]
    .filter(
      (w) =>
        (w.isRecovery || w.isTaper) &&
        !w.flags.includes('post-race') &&
        !(w.isRecovery && !w.isTaper && restartAt.includes(w.weekStart)),
    )
    .map((w) => w.weekStart)
  // exempt from G-2: the post-race weeks, and the week that restarts from them [rules H12, J7]
  const afterRaceWeeks = [...pastWeeks, ...macro]
    .filter((w) => w.flags.includes('post-race') || w.flags.includes('post-race-restart'))
    .map((w) => w.weekStart)
  const skip = rampSkipWeeks(today, structureLow)
  // the restart weeks that proved to be held at the J7 share, once they are placed
  const restartKept = new Set<string>()
  const rampCtx: RampContext = {
    volumes,
    skip,
    partial: new Set(windowed),
    floor:
      floorWeek === undefined
        ? null
        : { weekStart: floorWeek.weekStart, minutes: floorWeek.targetRunMin },
    exempt: startExemptions([...pastWeeks, ...macro], returnWeeks(dplan)),
    ...rampBasis(state, rebuildZone(input, state), responseBasis(input, state)),
  }
  // A window never raises a week [rule G-6, relation 5.3]. Where a part week is no baseline alone, the
  // look back can reach a week higher than the plan has without the window, and the weeks after
  // would rise with it. The same ramp with each week from today on that a short window took days
  // from put back at the minutes it holds without the window bounds them; the weeks of a long hold
  // stay out of it, as the restart share is theirs (J9), and so do the weeks before today, which
  // are facts.
  const longHold = longHoldWeeks(dplan)
  const shortTouched = (weekStart: string) =>
    weekStart >= currentMonday && windowed.includes(weekStart) && !longHold.includes(weekStart)
  const freeVolumes = new Map(volumes)
  const freeCtx: RampContext = {
    ...rampCtx,
    volumes: freeVolumes,
    partial: new Set(windowed.filter((weekStart) => !shortTouched(weekStart))),
  }
  const doneRow = state.weeks.find((w) => w.weekStart === currentMonday)
  const doneGain = gains.get(currentMonday) ?? 0
  const isRun = (s: SessionSpec) => s.durationMin > 0 && !NOT_RUNS.has(s.kind)

  // Micro: each week to days; weeks see the sessions placed before them.
  const placed: SessionSpec[] = []
  const shortOfDays: Array<{ weekStart: string; fit: number; wanted: number; spaced: boolean }> = []
  const tooShort: Array<{ weekStart: string; room: number; minimum: number }> = []
  const overshot: Array<{ weekStart: string; planned: number; ran: number }> = []
  const history: SessionSpec[] = [...kept]
  let figureRecord: { index: number; week: WeekDraft } | null = null
  const raceMonday = mondayOf(goal.date)
  // The day before a race of 90 minutes or more holds a shake-out, and the days before it easy running
  // only; they may lie in the week before the race week [rule K6]. The cap is K6 applied, the more
  // conservative rule where K2 and K6 differ for the day [rule G6]: the minutes it removes are not
  // moved to other days, and the row of the week keeps the figure of K2.
  const shakeOut = shakeOutFor(goal.date, goal.expectedDurationSec / 60)
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
    // The race week of the goal places its runs before the race day: the race is the session of its
    // day, and the days after it are the hold of the race's window, whose first return step is the
    // tail below. The week's minutes are the shake-out before the race, so no slot is left to a run
    // that the race replaces [rules K2, K6, H12].
    const raceDays =
      week.weekStart === raceMonday
        ? [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(week.weekStart, i)).filter((d) => d >= goal.date)
        : []
    const closedForRuns = (dates: ReadonlySet<string>): AthleteProfile =>
      closeDates(input.profile, week.weekStart, new Set([...dates, ...raceDays]))
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
    // A held week has every session it is going to have: nothing more is placed in it.
    const held = keep.heldWeek === week.weekStart
    if (held) {
      planWeek = {
        ...planWeek,
        targetRunMin: 0,
        longRunMin: 0,
        longRunM: planWeek.longRunM === null ? null : 0,
        gainTargetM: planWeek.gainTargetM === null ? null : 0,
        strengthSessions: 0,
        qualitySessions: 0,
        runDays: 0,
      }
    }
    // A recovery week stays cut from the loading week before it, and a taper week below the week
    // before it, as placed. A loading week a window took days from is no week to cut from: the week
    // as placed is its part, and a restart week cut from it would hold the weeks after it down
    // [rules E3, K2, J9].
    if (!isCurrent && keptAhead.length === 0) {
      const before = [...pastWeeks, ...macro.slice(0, w)]
      // a week a window took days from: stored as cut by an earlier window, or reached by the
      // windows now reported
      const part = (x: WeekDraft) =>
        windowed.includes(x.weekStart) || (x.weekStart < currentMonday && isDisruptedWeek(x.flags))
      // a week the checklist reads as disrupted: one with any day a window rules, or a return week
      const touchedBy = (x: WeekDraft) =>
        x.weekStart < currentMonday
          ? isDisruptedWeek(x.flags)
          : disruptionWeekCap(dplan, x.weekStart, { referenceMin: 0, baselineMin: 0 }) !== null
      const untouched = () => cutBase(before, (x) => (part(x) ? Infinity : null))
      const storedCut = (weekStart: string) =>
        (input.existing?.weeks ?? []).some(
          (o) => o.weekStart === weekStart && isDisruptedWeek(o.flags),
        )
      const partFigure = (x: WeekDraft) => {
        if (!part(x)) return null
        if (x.weekStart < currentMonday) return Infinity
        // the week in progress, stored as cut by a window of the plan it replaces, draws its
        // sequence from the last week the window left when that is higher
        if (x.weekStart === currentMonday && storedCut(x.weekStart)) {
          return Math.max(x.targetRunMin, untouched() ?? 0)
        }
        return unwindowed.get(x.weekStart) ?? x.targetRunMin
      }
      // The week in progress is read as its row will stand: held below the week drawn by the figure of
      // the plan being replaced, the week cut from it falls from that figure and not from the week
      // drawn, or it would stand above its cut, a recovery week, or above it, a race week
      // [rules E3, K2, G-6].
      const figureOf = (x: WeekDraft) =>
        figureRecord !== null && macro[figureRecord.index] === x
          ? figureRecord.week.targetRunMin
          : x.targetRunMin
      if (week.isRecovery && !week.flags.includes('post-race')) {
        const base = cutBase(before, partFigure, true, figureOf)
        const cut = P.e3.recoveryWeekCutPct.value / 100
        if (base !== undefined) {
          planWeek = capWeek(planWeek, Math.floor(base * (1 - cut) + 1e-9))
        }
      } else if (week.isTaper && before.length > 0) {
        // The taper falls below the week before it, read as the cut of a recovery week reads it (the
        // figure a part week has without the window), and below the last week no window touched, which
        // is how the checklist reads the fall. Where loading weeks still rise into the taper the two
        // differ, and the lesser wins [rules K2, J9, G6].
        const prev = cutBase(before, partFigure, false, figureOf)
        const clean = before.findLast((x) => !x.isRecovery && !touchedBy(x))
        const cleanFigure = clean === undefined ? undefined : figureOf(clean)
        const base = Math.min(prev ?? Infinity, cleanFigure ?? Infinity)
        if (Number.isFinite(base)) planWeek = capWeek(planWeek, Math.max(0, base - 1))
      }
    }
    // Inside the weekly ramp and the gain ramp, over what is run and placed [rules g-2, H4].
    // The post-race weeks and the restart week after them are exempt from G-2, as a return to an
    // established base [rules H12].
    const ramp = afterRaceWeeks.includes(week.weekStart)
      ? null
      : rampLimits(rampCtx, week.weekStart)
    const rampPlan =
      ramp === null
        ? null
        : windowed.length === 0
          ? ramp.plan
          : Math.min(ramp.plan, rampLimits(freeCtx, week.weekStart)?.plan ?? Infinity)
    if (rampPlan !== null && planWeek.targetRunMin > 0) {
      planWeek = capWeek(planWeek, Math.max(0, rampPlan - done.minutes - keptMin))
    }
    const gainCap = gainLimit(gains, rampCtx.skip, week.weekStart)
    if (gainCap !== null && planWeek.gainTargetM !== null) {
      const room = Math.floor(gainCap.allowed - done.gain - runningGain(keptToRun) + 1e-9)
      if (planWeek.gainTargetM > room) planWeek = { ...planWeek, gainTargetM: Math.max(0, room) }
    }
    // The race week of the goal is placed with the post-race window of its own race left out (its
    // days are closed above). Every other week keeps the windows its days fall in.
    const placing = windows.filter(
      (w) => !(w.race.date === goal.date && mondayOf(w.race.date) === week.weekStart),
    )
    const profile =
      closed.size > 0 ? closeDates(input.profile, week.weekStart, closed) : input.profile
    // the profile the runs are placed on: the days open to running before the race day
    const runProfile = raceDays.length === 0 ? profile : closedForRuns(closed)
    const place = (
      target: WeekDraft,
      on: AthleteProfile,
      rules: readonly DayRule[],
      ceiling = false,
      shake = true,
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
        ultra: goal.isUltra,
        method,
        blockPosition: strengthBlockPosition([...pastWeeks, ...macro], week.weekStart),
        ...(rules.length > 0 ? { dayRules: rules } : {}),
        ...(dplan.days.length > 0 ? { windowPlan: true } : {}),
        ...(ceiling ? { ceiling: true } : {}),
        ...(shake && shakeOut !== undefined ? { shakeOut } : {}),
      })
    // A week a window touches, or that a long hold sends back at the J7 fraction, holds what the
    // window leaves of the plan's own week [rules J9, J7, G-6]: the minutes of the held days, and
    // the share of the reference week the restart allows, are lost and never moved.
    let disruptionFlags: string[] = []
    // The week as it stands before the windows reach it, for the ramp that puts back the days a short
    // window took (`freeCtx`). The plan's own figure bounds a week the replaced plan has not started,
    // where `stillPlanned` is the minutes its sessions place, which a window already in that plan has
    // cut: the figure is the same at every re-plan of the Monday.
    let freeWeek: WeekDraft | null = null
    if (shortTouched(week.weekStart)) {
      freeWeek = planWeek
      const figure = keep.notStarted?.get(week.weekStart)
      if (figure !== undefined && keep.heldWeek !== week.weekStart) {
        freeWeek = remainingOfWeek(
          week,
          done,
          new Set(keptAhead.filter(isRun).map((s) => s.date)),
          keptMin,
          figure,
        )
        if (rampPlan !== null && freeWeek.targetRunMin > 0) {
          freeWeek = capWeek(freeWeek, Math.max(0, rampPlan - done.minutes - keptMin))
        }
      }
    }
    const startDrawn = isProgrammeWeek(week.flags) || week.flags.includes('restart-floor')
    const returning = dplan.holds.filter(
      (h) =>
        h.fraction < 1 &&
        (h.returnWeekStart === week.weekStart || h.fullWeekStart === week.weekStart),
    )
    // the figure of the week before any window reaches it, which bounds an E3 cut taken from it
    if (!isCurrent && keptAhead.length === 0) unwindowed.set(week.weekStart, planWeek.targetRunMin)
    if (weekRules.length > 0 || returning.length > 0) {
      // the minutes the plan had on the days a window rules, from the week placed without it
      const ruled = weekRules.filter((r) => r.date >= today && (r.held || r.maxRunMin !== null))
      let baselineAhead = planWeek.targetRunMin
      let longLost = false
      const minByDate: Record<string, number> = {}
      if (ruled.length > 0 && (planWeek.targetRunMin > 0 || planWeek.strengthSessions > 0)) {
        // placed without the shake-out: the hold target is spread over the runs at their shares and
        // the cap cuts the day before once, from the placed result [rules K6, J9]
        const baseline = place(planWeek, closedForRuns(closedBase), [], false, false)
        baselineAhead = runningMinutes(baseline)
        for (const s of baseline) {
          if (VOLUME_KINDS.has(s.kind)) minByDate[s.date] = (minByDate[s.date] ?? 0) + s.durationMin
        }
        // The week of a re-plan is bounded by what the replaced plan still had on its other days
        // (`stillPlanned`). A ruled day on which that plan already keeps to the rule (a rest session
        // on a held day, a run within the cap of a capped day) is out of that figure, so it costs
        // nothing a second time [rules J9, G-6].
        if (keep.stillPlanned.has(week.weekStart)) {
          for (const r of ruled) {
            if ((keep.plannedOn.get(r.date) ?? 0) <= (r.maxRunMin ?? 0)) minByDate[r.date] = 0
          }
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
      // the week without the short windows still holds the restart share of a long hold (J9): that
      // cap is the hold's, not the short window's
      if (freeWeek !== null) {
        const restart = disruptionWeekCap({ ...dplan, days: [] }, week.weekStart, {
          referenceMin,
          baselineMin: Number.MAX_SAFE_INTEGER,
        })
        if (restart?.capMin != null) {
          freeWeek = capWeek(freeWeek, Math.max(0, restart.capMin - done.minutes - keptMin))
        }
      }
    }
    // A preset never plans more than the default plan of the same input [rule G6]: the week's
    // target is held to the default's (the long run and the climbing shrink with it), and the week
    // is placed against no more than the minutes the default places, which are fewer where a
    // session of the default places short of its share (`placingWeek` below). The weeks after it
    // read the minutes placed, so the ramp cannot rise on a preset's weeks.
    const limit = limits?.get(week.weekStart)
    if (limit !== undefined) planWeek = capWeek(planWeek, limit.target)
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
    // the sessions keep the long run and share what is left, as a window's hold does (`holdWeek`)
    const placingWeek =
      limit !== undefined && planWeek.targetRunMin > limit.placed
        ? holdWeek(planWeek, limit.placed)
        : planWeek
    let sessions =
      planWeek.targetRunMin > 0 || planWeek.strengthSessions > 0
        ? place(placingWeek, runProfile, weekRules, ceiling)
        : []
    // A hold trims the week's next quality session, once a week [rules J5, design 4.3].
    const trimmedAlready = kept.some((s) => inWeek(s) && isTrimmed(s.rules))
    const holdTrimmed = (list: SessionSpec[]): SessionSpec[] => {
      if (keep.decisions[week.weekStart] !== 'hold' || trimmedAlready) return list
      const next = list.find((s) => s.date >= today && isQualityKind(s.kind))
      if (next === undefined) return list
      const trim = trimQuality(
        next,
        "last week's review suggested holding, so this session is a little shorter.",
      )
      const cut = { ...trim, rules: [...trim.rules, HOLD_TRIM_RULE] }
      return list.map((s) => (s === next ? cut : s))
    }
    sessions = holdTrimmed(sessions)
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
            method,
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
    // The week as it would be without the windows: the same week placed on every day they hold too,
    // with the same hold trim, so that a closed day puts back exactly what it took. A preset is held
    // to the default's week of the same kind (`WeekLimit.free`).
    let freeSessions: SessionSpec[] | null = null
    let freeLimit: WeekLimit['free']
    if (freeWeek !== null && (freeWeek.targetRunMin > 0 || freeWeek.strengthSessions > 0)) {
      const bound = limit?.free ?? limit
      const capped = bound === undefined ? freeWeek : capWeek(freeWeek, bound.target)
      freeSessions = holdTrimmed(
        place(
          bound !== undefined && capped.targetRunMin > bound.placed
            ? holdWeek(capped, bound.placed)
            : capped,
          closedForRuns(closedBase),
          [],
        ),
      ).filter((s) => s.date < goal.date || mondayOf(s.date) > raceMonday)
      freeLimit = {
        target: capped.targetRunMin,
        placed: runningMinutes([...freeSessions, ...afterRace]),
      }
    }
    placed.push(...inside, ...rest, ...afterRace, ...windowRest)
    history.push(...inside, ...afterRace)
    record?.set(week.weekStart, {
      target: planWeek.targetRunMin,
      placed: runningMinutes([...inside, ...afterRace]),
      ...(freeLimit === undefined ? {} : { free: freeLimit }),
    })

    // The week enters the baselines and its runs the 30-day reference, as the guards count them.
    const ahead = [...inside, ...afterRace, ...keptToRun].filter((s) => s.date >= today)
    const weekMin = done.minutes + runningMinutes(ahead)
    volumes.set(week.weekStart, weekMin)
    // a short window's week enters the bounding ramp at the minutes it holds without the window
    freeVolumes.set(
      week.weekStart,
      freeSessions === null
        ? weekMin
        : Math.max(
            weekMin,
            done.minutes +
              runningMinutes(
                [...freeSessions, ...afterRace, ...keptToRun].filter((s) => s.date >= today),
              ),
          ),
    )
    gains.set(week.weekStart, done.gain + runningGain(ahead))
    // The current week's logged minutes are taken as they are, after the weeks that follow were
    // drawn and capped from the planned week [rules g-2, g-6].
    if (isCurrent && !held) {
      const taken = takenAsRun(macro[w]!, done.minutes + keptMin)
      if (taken !== macro[w]) {
        overshot.push({
          weekStart: week.weekStart,
          planned: macro[w]!.targetRunMin,
          ran: taken.targetRunMin,
        })
        macro[w] = taken
      }
      // A week the replaced plan's figure holds below the week the rules draw keeps that figure on
      // record, as a week drawn ahead does, so the next re-plan of the same Monday is held to it
      // again and not to the minutes the sessions placed [rule G-6]. Set after the loop, so the
      // weeks drawn from this one are the same as before.
      const figure = keep.figure.get(week.weekStart)
      if (
        figure !== undefined &&
        !startDrawn &&
        figure < Math.floor(week.targetRunMin) &&
        done.runDays === 0 &&
        keptAhead.length === 0
      ) {
        figureRecord = {
          index: w,
          week: remainingOfWeek(week, { minutes: 0, runDays: 0 }, new Set(), 0, figure),
        }
      }
    }
    // The restart week after a long hold is a baseline for the weeks after it when the J7 share holds
    // it, a recovery week or not; the cadence cutting it below the share leaves it a recovery week
    // like another [rules J7, J9, E3]. The week is read as its row in the plan will stand, which is
    // how the checklist reads it: for the week in progress that is the week drawn, or the figure of
    // the plan being replaced that holds it, and not the minutes left to place.
    if (week.isRecovery && !week.isTaper) {
      const share = restartShares(dplan, (weekStart) => volumes.get(weekStart)).get(week.weekStart)
      const target = isCurrent
        ? figureRecord !== null && figureRecord.index === w
          ? figureRecord.week.targetRunMin
          : macro[w]!.targetRunMin
        : planWeek.targetRunMin + done.minutes + keptMin
      if (share !== undefined && share > 0 && target >= share) {
        skip.delete(week.weekStart)
        restartKept.add(week.weekStart)
      }
    }
    // A loading week as placed that uses the rebuild zone says what it rebuilds toward. It is the
    // week the checklist's progression item counts as a zone week (`rebuildZoneUsed`), measured on
    // the minutes placed in it [rules g-8].
    const zone =
      weekMin > 0 &&
      isLoadingWeek(macro[w]!) &&
      !startDrawn &&
      !afterRaceWeeks.includes(week.weekStart)
        ? rebuildZoneUsed(rampLimits(rampCtx, week.weekStart), weekMin)
        : null
    if (zone !== null) macro[w] = { ...macro[w]!, focus: loadFocus(zone.ceilingMin) }
    for (const s of ahead.sort(bySlot)) {
      if (!VOLUME_KINDS.has(s.kind)) continue
      records.push(recordOf(s))
      if (!isProgramme(s)) plain.push(recordOf(s))
    }
  }

  if (figureRecord !== null) {
    const { index, week } = figureRecord
    macro[index] = {
      ...macro[index]!,
      targetRunMin: week.targetRunMin,
      longRunMin: week.longRunMin,
      longRunM: week.longRunM,
      gainTargetM: week.gainTargetM,
    }
  }

  // Guards over the whole plan: the check, which finds nothing to cut in a plan placed as above.
  const guarded = applyGuards(placed, state, input.activities, {
    ultraRaceDurationSec: goal.isUltra ? goal.expectedDurationSec : null,
    neverOverride: true,
    lowWeeks: structureLow.filter((weekStart) => !restartKept.has(weekStart)),
    partialWeeks: windowed,
    exemptWeeks: afterRaceWeeks,
    startPath:
      rampCtx.floor === null || floorWeek === undefined
        ? null
        : { ...rampCtx.floor, kind: startKind(floorWeek.flags) ?? 'floor' },
    exempt: rampCtx.exempt,
    rebuild: rampCtx.rebuild,
    response: rampCtx.response,
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
  for (const week of overshot) {
    warnings.push({
      code: 'overshoot-week',
      severity: 'info',
      message: `The week of ${week.weekStart} holds ${week.ran} min of running, above the ${week.planned} min planned. The week stands as run: it takes no more running, and the weeks after it keep their plan instead of rising from it.`,
      rules: ['g-2', 'g-6'],
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

/**
 * What the default plan does in one week, in the units `generate` places a week in: `target` is the
 * running minutes the week is placed against (what is left of the week, after the caps) and `placed`
 * the running minutes the placement gives it, which are fewer when a session places short of its
 * share. A method preset is held to both [rule G6]. `free` is the same for the week as it would be
 * without the windows, set on a week a short window took days from: the week the preset's own
 * ramp puts back (`generate`).
 */
interface WeekLimit {
  target: number
  placed: number
  free?: { target: number; placed: number }
}

/** The weeks of the default plan of `input`, as `generate` places them. */
function defaultWeeks(
  input: EngineInput,
  keep: Keep,
  weekOffset: number,
): ReadonlyMap<string, WeekLimit> {
  const record = new Map<string, WeekLimit>()
  generate({ ...input, options: { ...input.options, method: 'default' } }, keep, weekOffset, record)
  return record
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
    {
      sessions: [],
      toRun: new Set(),
      stillPlanned: new Map(),
      figure: new Map(),
      plannedOn: new Map(),
      matched: new Set(),
      decisions: {},
    },
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

/** A session whose minutes count as running time (races, strength and hikes do not). */
const isRunningTime = (s: SessionSpec): boolean =>
  s.kind !== 'race' && s.kind !== 'strength' && s.kind !== 'hike'

/** Running minutes planned in a week from `from` on (races and strength are not running time). */
function plannedMinutes(sessions: SessionSpec[], weekStart: string, from: string): number {
  return sessions
    .filter((s) => mondayOf(s.date) === weekStart && s.date >= from && isRunningTime(s))
    .reduce((sum, s) => sum + s.durationMin, 0)
}

/**
 * The minutes rule K6 cut from the run of the day before a long race in the plan being replaced, for
 * the week that holds that day: the run stands at the cap and the other runs still planned stand at
 * their share of the week, so the cut is the largest of the others less the run. The bound of the
 * week (`stillPlanned`) counts the run at its share, as the share-out of the remaining runs gives it,
 * and the cap then cuts the run once more. Counted at the cap, each re-plan of a week in progress
 * would cut the run a second time and shed a share of the runs that nothing changed [rules K6, G-6].
 */
function shakeOutCut(
  rows: ReadonlyArray<SessionSpec>,
  weekStart: string,
  from: string,
  shakeOut: ShakeOut,
): number {
  if (shakeOut.dayBefore < weekStart || shakeOut.dayBefore > addDays(weekStart, 6)) return 0
  const runs = rows.filter(
    (s) =>
      mondayOf(s.date) === weekStart &&
      s.date >= from &&
      s.durationMin > 0 &&
      isRunningTime(s) &&
      !NOT_RUNS.has(s.kind),
  )
  const dayBefore = runs.filter((s) => s.date === shakeOut.dayBefore)
  const others = runs.filter((s) => s.date !== shakeOut.dayBefore)
  if (dayBefore.length !== 1 || others.length === 0) return 0
  const held = dayBefore[0]!.durationMin
  // a run under the cap was not cut
  if (held < shakeOut.maxMin) return 0
  return Math.max(0, Math.max(...others.map((s) => s.durationMin)) - held)
}

/**
 * Whether the replaced plan has not started `oldWeek`: today is its Monday, every session of it is
 * still planned (or trimmed by the weekly decision, which the re-plan draws again), and nothing has
 * been run since.
 */
function notStartedWeek(
  oldWeek: WeekDraft,
  oldSessions: ReadonlyArray<{ date: string; status: string; rules: string[] }>,
  input: EngineInput,
): boolean {
  const { weekStart } = oldWeek
  return (
    weekStart === input.today &&
    oldSessions
      .filter((s) => s.date >= weekStart && s.date <= addDays(weekStart, 6))
      .every((s) => s.status === 'planned' || isHoldTrimRow(s)) &&
    !input.activities.some((a) => a.date >= weekStart)
  )
}

/**
 * `notStartedWeek` for a week the plan's own figure bounds. The weeks of a start path are left out:
 * their minutes are their programme's, and the floor week is the baseline the ramp measures from.
 */
function unstartedWeek(
  oldWeek: WeekDraft,
  oldSessions: ReadonlyArray<{ date: string; status: string; rules: string[] }>,
  input: EngineInput,
): boolean {
  return (
    !isProgrammeWeek(oldWeek.flags) &&
    !oldWeek.flags.includes('restart-floor') &&
    notStartedWeek(oldWeek, oldSessions, input)
  )
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
): { draft: PlanDraft; changes: PlanChange[]; heldWeek: string | null } {
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
  const figure = new Map<string, number>()
  const notStarted = new Map<string, number>()
  const windowPlan = disruptionPlan(input.disruptions ?? [])
  const shakeOut = shakeOutFor(input.goal.date, input.goal.expectedDurationSec / 60)
  for (const weekStart of settled) {
    const oldWeek = oldWeeks.find((w) => w.weekStart === weekStart)
    if (oldWeek === undefined) continue
    if (notStartedWeek(oldWeek, oldSessions, input)) notStarted.set(weekStart, oldWeek.targetRunMin)
    const stillRows = oldSessions.filter((s) => s.status === 'planned' || isHoldTrimRow(s))
    // the run of the day before a long race counts at its share of the week, not at its cap
    const planned =
      plannedMinutes(stillRows, weekStart, input.today) +
      (shakeOut === undefined ? 0 : shakeOutCut(stillRows, weekStart, input.today, shakeOut))
    // A week the replaced plan has not started is held to the plan's own figure for it, not to the
    // minutes its sessions placed: those fall short of the figure by what the placement cannot use
    // (a trimmed session, rounding), and held to them each
    // re-plan of the same Monday would take the shortfall again [rule G-6]. The sessions stay the
    // bound where a window touches the week, as its cap charges the held days against them, but
    // never above the figure: a closed day must not hold a week to more than it was without it.
    if (unstartedWeek(oldWeek, oldSessions, input)) {
      figure.set(weekStart, oldWeek.targetRunMin)
      const touched =
        dayRulesIn(windowPlan, { from: weekStart, to: addDays(weekStart, 6) }).length > 0
      stillPlanned.set(
        weekStart,
        touched ? Math.min(planned, oldWeek.targetRunMin) : oldWeek.targetRunMin,
      )
    } else {
      stillPlanned.set(weekStart, planned)
    }
  }
  // the running minutes the replaced plan still has on each day from today on
  const plannedOn = new Map<string, number>()
  for (const s of oldSessions) {
    if (
      (s.status !== 'planned' && !isHoldTrimRow(s)) ||
      s.date < input.today ||
      !isRunningTime(s)
    ) {
      continue
    }
    plannedOn.set(s.date, (plannedOn.get(s.date) ?? 0) + s.durationMin)
  }
  const matched = new Set(kept.filter((_, i) => keptRows[i]!.activityId !== null))
  const keep: Keep = {
    sessions: kept,
    toRun,
    stillPlanned,
    figure,
    notStarted,
    plannedOn,
    matched,
    decisions: options.decisions ?? {},
  }
  const { draft, heldWeek } = drawn(input, keep, oldWeeks, pastWeeks.length)
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
      oldSessions.filter((s) => s.status === 'planned' || isHoldTrimRow(s)),
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
  return { draft: merged, changes, heldWeek }
}

/**
 * The draft of a re-plan, with the current week held under the shape it was drawn under when that is
 * not the shape that applies now [rules P1 to P4, follow-up 27]. A week's shape is fixed when it
 * begins: a change of the shape in effect between two re-plans (a method change by the runner, a
 * persistent hold starting or ending, a novice's days ending) reaches the weeks after the current
 * one, and the current week is drawn again under the shape it has, with every other rule of the
 * re-plan (the weekly decision, the windows, the ramp) applied to it as to any week. The weeks after
 * it are drawn from the sessions the current week now holds, so the ramp and the spacing read the
 * week as it will be.
 *
 * A shape that the resolver now reads as the plan's own (a hold starting) cannot be drawn again for
 * the current week: the hold is a condition of the runner and applies at once, so the current week
 * is drawn under the plan's own shape and `heldWeek` is null. A plan whose current week is not
 * stored has no shape to hold.
 */
function drawn(
  input: EngineInput,
  keep: Keep,
  oldWeeks: readonly WeekDraft[],
  weekOffset: number,
): { draft: PlanDraft; heldWeek: string | null } {
  const current = mondayOf(input.today)
  const live = generate(input, keep, weekOffset)
  const stored = oldWeeks.find((week) => week.weekStart === current)
  const liveWeek = live.weeks.find((week) => week.weekStart === current)
  // a week a start programme sets is the programme's whatever the shape: there is nothing to hold
  if (stored === undefined || liveWeek === undefined || !takesShape(stored.flags)) {
    return { draft: live, heldWeek: null }
  }
  const was = shapeOfFlags(stored.flags)
  if (was === shapeOfFlags(liveWeek.flags)) return { draft: live, heldWeek: null }
  // the current week as it is drawn under the shape it has: forced, and used only if it applies
  const own = generate({ ...input, options: { ...input.options, method: was } }, keep, weekOffset)
  const ownWeek = own.weeks.find((week) => week.weekStart === current)
  if (ownWeek === undefined || shapeOfFlags(ownWeek.flags) !== was) {
    return { draft: live, heldWeek: null }
  }
  const already = new Set<SessionSpec>(keep.sessions)
  // the race is drawn by the held pass itself, so its copy stays out
  const sessions = own.sessions.filter(
    (s) =>
      !already.has(s) && s.kind !== 'race' && s.date >= input.today && mondayOf(s.date) === current,
  )
  const held = generate(
    input,
    {
      ...keep,
      sessions: [...keep.sessions, ...sessions],
      toRun: new Set([...keep.toRun, ...sessions]),
      heldWeek: current,
    },
    weekOffset,
  )
  // The held pass places nothing in the week and takes its sessions as fixed, so it says nothing of
  // them: the warnings the re-plan draws for the week itself (a week run past its plan, a run with no
  // reference run to bound it) are the ones of the pass that drew it.
  const said = new Set(held.warnings.map((w) => `${w.code}|${w.message}`))
  const ofWeek = own.warnings.filter(
    (w) => namesWeek(w, current) && !said.has(`${w.code}|${w.message}`),
  )
  return {
    draft: {
      ...held,
      weeks: held.weeks.map((week) => (week.weekStart === current ? ownWeek : week)),
      warnings: [...held.warnings, ...ofWeek],
    },
    heldWeek: current,
  }
}

/** An aggregate warning counts the weeks from a first one on; its later weeks belong to one pass. */
const ACROSS_WEEKS = /^\d+ week\(s\), from the week of /

/**
 * Whether a warning is about the week of `monday`: its message names a day of that week as a date.
 * The warnings of the engine about one week or one session do (`overshoot-week`, the guards'); an
 * aggregate over weeks (`availability-limits-runs`, `spike-run-dropped`) does not count.
 */
function namesWeek(warning: EngineWarning, monday: string): boolean {
  if (ACROSS_WEEKS.test(warning.message)) return false
  const end = addDays(monday, 6)
  return (warning.message.match(/\d{4}-\d{2}-\d{2}/g) ?? []).some((d) => d >= monday && d <= end)
}
