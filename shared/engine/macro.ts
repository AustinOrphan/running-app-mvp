// Macrocycle: phases built backwards from race day, weekly targets, intensity distribution and
// the fixed blocks [rules e, h, k]. Pure: the same input gives the same weeks.
//
// Week flags written here (WeekDraft.flags): 'recovery', 'peak', 'taper', 'race-week',
// 'post-race', 'strength-block', 'gut-training', 'heat-acclimation', 'night', 'downhill', 'b2b',
// and for the first weeks of a plan 'restart-floor', 'run-walk', 'ladder-<n>', 'injury-return',
// 'injury-level-<n>' (startWeeks.ts). A re-plan adds 'overshoot' and 'planned-<n>' to a loading
// week run past its target (index.ts, limits.ts `overshootFlags`).
// Race week is the last week with the race in it: its volume is the shake-out running around the
// race, not the race itself, and its long run is 0. The weeks after the race (H12) follow it; the
// days of the race week after the hold are a week of their own (`macroPlanDraft`).
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import type { Activity } from '../types.ts'
import { breakRestart, runsReaching, weekEvidence } from './adapt.ts'
import { bmiOf } from './athlete.ts'
import { peakLongRunMin, peakWeeklyMin, trainingPace } from './goal.ts'
import {
  completedReference,
  countsTowardReference,
  gainLimit,
  injuryTight,
  noviceRamp,
  plannedMinOf,
  rampBasis,
  rampLimits,
  rampSkipWeeks,
  rebuildStep,
  referenceBetween,
  responseBaseline,
  runCaps,
  startLevelMin,
  tightRamp,
  weeklyGain,
  weeklyRamp,
  type RampContext,
  type RampExemption,
  type RunRecord,
} from './limits.ts'
import { isDuplicate } from './load.ts'
import { blockLift, rebuildZone, responseBasis } from './loadSetting.ts'
import { P } from './params/index.ts'
import {
  ownWindow,
  postRaceWindows,
  windowMondays,
  windowRuns,
  windowWeeks,
  type PostRaceWindow,
} from './postRace.ts'
import { checkinOn, focalBoneActive } from './readiness.ts'
import {
  injuryLevel,
  isLadderSession,
  ladderRung,
  longestBout,
  rungCount,
  rungSessions,
  startWeek,
  stepSchedule,
  type StartKind,
  type StartPath,
  type StartWeek,
} from './startWeeks.ts'
import { buildZones } from './zones.ts'
import type {
  AthleteState,
  EngineInput,
  Feasibility,
  GoalModel,
  PhaseV2,
  SessionSpec,
  WeekDraft,
} from './types.ts'

export type { StartPath } from './startWeeks.ts'

type Tid = WeekDraft['tid']

/** Guards float noise (100 * 1.1 = 110.00000000000001) before rounding down. */
const EPS = 1e-9
const floorEps = (x: number) => Math.floor(x + EPS)
const floorTo10 = (x: number) => Math.floor((x + EPS) / 10) * 10

/** Weekly ramp that applies to this athlete [rules G-2, G-3]; defined with the other limits. */
export { weeklyRamp }

/** The long-run ceiling of a goal is defined with the goal model (goal.ts), which the feasibility reads too. */
export { peakLongRunMin }

/**
 * Two or more flags on the latest energy-availability screening hold progression [rules n-4, J5]:
 * weekly targets stay at the current level, there is no ramp growth and no new back-to-back.
 */
export function redsHold(state: AthleteState): boolean {
  return state.risk.redsFlags >= P.j5.redsHoldFlags.value
}

/**
 * Progression holds while either hold applies: two or more REDs flags [rules n-4] or focal bone
 * pain reported and not yet cleared by a later check-in [rules n-1].
 */
export function progressionHold(input: EngineInput, state: AthleteState): boolean {
  return redsHold(state) || focalBoneActive(input, input.today)
}

/** Taper length in days [rules K1]; never above the 21-day maximum. */
export function taperDays(goal: GoalModel, state: AthleteState): number {
  let days: number
  switch (goal.distanceClass) {
    case '5k':
      days = P.k1.fiveKmDays.value
      break
    case '10k':
      days = P.k1.tenKmDays.value
      break
    case 'half':
      days = P.k1.halfMarathonDays.value
      break
    case 'marathon':
      days =
        state.typicalWeekMin < P.k1Design.lowVolumeWeeklyMin.value
          ? P.k1.marathonLowVolumeDays.value
          : P.k1.marathonDays.value
      break
    case 'ultra50':
    case 'ultra100k':
      days = P.k1.ultra50to100kDays.value
      break
    case 'ultra100mi':
      days = P.k1.ultra100miDays.value
      break
    case 'beyond':
      days = P.k1.ultra100miDays.range?.[1] ?? P.k1.ultra100miDays.value
      break
  }
  return Math.min(days, P.k1.maxDays.value)
}

/** Volume multipliers of the taper weeks against the reference week, race week last [rules K2]. */
export function taperMultipliers(weeks: number): number[] {
  const two = P.k2.twoWeekMultipliers.value
  if (weeks >= 3) return P.k2.threeWeekMultipliers.value
  if (weeks === 2) return two
  return [two[two.length - 1] ?? 0]
}

/** Z1/Z2/Z3 shares of running time [rules E4]; Z1 never below its floor, Z2 never above Z1. */
function tidFor(phase: PhaseV2, goal: GoalModel, polarized: boolean): Tid {
  let z1: number
  let z2: number
  let z3: number
  const shortRace = goal.distanceClass === '5k' || goal.distanceClass === '10k'
  if (goal.isUltra) {
    z1 = P.e4.ultraZ1Min.value
    z3 = P.e4.ultraZ3Max.value
    z2 = 100 - z1 - z3
  } else if (phase === 'base') {
    z3 = P.e4.baseZ3Share.value
    z2 = P.e4.z2CapBase.value
    z1 = 100 - z2 - z3
  } else if (phase === 'build' || (shortRace && !polarized)) {
    z1 = P.e4.z1Prior.value
    z2 = P.e4.z2Prior.value
    z3 = P.e4.z3Prior.value
  } else if (shortRace) {
    // polarized specific phase, offered on request for 5-10 km
    z2 = P.macroDesign.polarizedZ2Share.value
    z1 = 100 - P.f2.z2z3Share.value
    z3 = 100 - z1 - z2
  } else {
    // half-marathon and marathon specific, taper and race weeks: race pace moves into Z2
    z3 = P.e4.baseZ3Share.value
    z2 = Math.min(P.e4.specificHalfMarathonZ2Max.value, P.f2.z2z3Share.value - z3)
    z1 = 100 - z2 - z3
  }
  z1 = Math.max(z1, P.e4.z1Floor.value)
  z2 = Math.min(z2, z1)
  z3 = 100 - z1 - z2
  return { z1, z2, z3 }
}

const FOCUS: Record<PhaseV2, string> = {
  base: 'Aerobic base: easy running, strides and strength',
  build: 'Build: steady aerobic volume with quality work',
  specific: 'Race-specific: long runs and race-effort work',
  taper: 'Taper: volume down, intensity kept',
  race: 'Race week: short, sharp and rested',
}

interface PhasePlan {
  phase: PhaseV2
  isRecovery: boolean
}

/**
 * Why the recovery cycle is the shorter 2:1 and not the default 3:1 [rules E3, G-3]: a recent
 * injury, the cycle the runner chose, or a new or low-frequency runner. Null for the default.
 */
export function cycleShortReason(
  input: Pick<EngineInput, 'options'>,
  state: AthleteState,
): 'recent-injury' | 'chosen' | 'new-runner' | null {
  if (state.risk.recentInjury) return 'recent-injury'
  if (input.options.recoveryCycle === '2:1') return 'chosen'
  if (input.options.recoveryCycle === '3:1') return null
  return noviceRamp(state) ? 'new-runner' : null
}

/** Work weeks per recovery cycle [rules E3, G-3]. */
export function cycleWorkWeeks(input: EngineInput, state: AthleteState): number {
  return cycleShortReason(input, state) === null
    ? P.e3.defaultCycleWorkWeeks.value
    : P.e3.flaggedCycleWorkWeeks.value
}

/**
 * Phases built backwards: taper and race week, specific, build, base takes the remainder [E2]. A
 * re-plan passes the phase the replaced plan gave each week (`carried`), so the weeks close to the
 * race stay race-specific instead of falling under the minimum length of a new plan's specific block.
 */
function planPhases(
  weeksBeforeTaper: number,
  taperWeeks: number,
  workPerCycle: number,
  openingRecovery: boolean,
  carried: ReadonlyArray<PhaseV2 | null> = [],
): PhasePlan[] {
  const specificMin = P.e2.specificWeeksMin.value
  const specific =
    weeksBeforeTaper >= specificMin ? Math.min(P.e2.specificWeeksMax.value, weeksBeforeTaper) : 0
  const remaining = weeksBeforeTaper - specific
  const build = Math.min(remaining, P.macroDesign.buildWeeks.value)
  const base = remaining - build
  const cycle = workPerCycle + 1
  const out: PhasePlan[] = []
  for (let i = 0; i < weeksBeforeTaper; i++) {
    const phase: PhaseV2 =
      carried[i] ?? (i < base ? 'base' : i < base + build ? 'build' : 'specific')
    // counted back from the last pre-taper week, which is always a work week (the peak); a new
    // plan never opens with a recovery week, so its first cycle may run one work week longer. A
    // re-plan keeps the first week a recovery week when the plan it replaces had it so, where the
    // count lands on it; where it does not (the cycle changed), `planWeeks` keeps the week.
    const fromEnd = weeksBeforeTaper - 1 - i
    out.push({
      phase,
      isRecovery: (i > 0 || openingRecovery) && fromEnd % cycle === cycle - 1,
    })
  }
  for (let i = 0; i < taperWeeks; i++) {
    out.push({ phase: i === taperWeeks - 1 ? 'race' : 'taper', isRecovery: false })
  }
  return out
}

/**
 * A re-plan counts the loading weeks that end the plan it replaces, so a change of cadence between
 * two plans (the 2:1 cadence of a low-frequency runner switching on or off, say) never leaves more
 * than a cycle of loading weeks in a row [rules E3]: a week that would be one too many becomes a
 * recovery week, and a recovery week right after it is dropped. A new plan needs none of this.
 */
function keepCadenceAcrossReplan(
  phases: PhasePlan[],
  input: EngineInput,
  firstMonday: string,
  workWeeks: number,
  programmeWeeks: number,
  startWeeks: number,
): void {
  const past = (input.existing?.weeks ?? []).filter((w) => w.weekStart < firstMonday)
  if (past.length === 0) return
  const byStart = new Map(past.map((w) => [w.weekStart, w]))
  const fixedProgramme = (w: WeekDraft) =>
    ladderRung(w.flags) !== null || w.flags.includes('injury-return')
  let run = 0
  for (let cursor = addDays(firstMonday, -7); ; cursor = addDays(cursor, -7)) {
    const w = byStart.get(cursor)
    if (
      w === undefined ||
      w.isRecovery ||
      w.isTaper ||
      w.phase === 'race' ||
      w.flags.includes('post-race') ||
      fixedProgramme(w)
    ) {
      break
    }
    run += 1
  }
  // the first block of a plan may run one week longer, until a recovery week has been seen
  let allowance = past.some((w) => w.isRecovery) ? 0 : 1
  const pre = phases.filter((p) => p.phase !== 'taper' && p.phase !== 'race')
  for (const [i, ph] of pre.entries()) {
    if (i < programmeWeeks) {
      run = 0
      continue
    }
    if (ph.isRecovery) {
      run = 0
      allowance = 0
      continue
    }
    run += 1
    // a floor week is never turned into a recovery week
    if (run > workWeeks + allowance && i >= startWeeks) {
      ph.isRecovery = true
      const next = pre[i + 1]
      if (next?.isRecovery === true) next.isRecovery = false
      run = 0
      allowance = 0
    }
  }
}

/**
 * The phases the replaced plan gave the pre-taper weeks, by week; null where it had none. They
 * carry over only when the race week is the same, so a moved goal builds its phases anew.
 */
function carriedPhases(
  input: EngineInput,
  firstMonday: string,
  raceMonday: string,
  preCount: number,
): Array<PhaseV2 | null> {
  const weeks = input.existing?.weeks ?? []
  const sameRace = weeks.some((w) => w.weekStart === raceMonday && w.phase === 'race')
  if (!sameRace) return []
  const out: Array<PhaseV2 | null> = []
  for (let i = 0; i < preCount; i++) {
    const phase = weeks.find((w) => w.weekStart === addDays(firstMonday, 7 * i))?.phase
    out.push(phase === 'base' || phase === 'build' || phase === 'specific' ? phase : null)
  }
  return out
}

/**
 * Where a re-plan restarts the loading sequence: the working target of the current week in the plan
 * it replaces, not the typical week, so the Monday re-plan does not flatten the progression. In a
 * recovery week the sequence continues from the work week before it (`paused`). The start is held
 * to the step the recent weeks allow (`stepCap`, never below the minutes already run in the week),
 * so missed training still lowers it. A break of a week or more restarts from the typical week.
 * The response to weeks run above plan [rules g-8] does not lift this start: the week in progress
 * keeps the minutes the plan gave it (a re-plan adds none to a settled week, `remainingOfWeek`),
 * and the weeks after it step from the higher of these minutes and the mean of the weeks run
 * (`responseBaseline`, read where each loading week is drawn). A week the weekly decision holds
 * (`heldCap`) carries the sequence on from the cap.
 */
function replanAnchor(
  input: EngineInput,
  state: AthleteState,
  firstMonday: string,
  stepCap: number,
  heldCap: number | undefined,
): { minutes: number; paused: boolean } | null {
  const weeks = input.existing?.weeks
  if (weeks === undefined || state.layoffDays >= P.j7.tier1Days.value) return null
  const current = weeks.find((w) => w.weekStart === firstMonday)
  if (current === undefined || current.isTaper || current.phase === 'race') return null
  const work = current.isRecovery
    ? [...weeks]
        .filter((w) => w.weekStart < firstMonday && !w.isRecovery && !w.isTaper)
        .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0]
    : current
  if (work === undefined || work.targetRunMin <= 0 || !Number.isFinite(stepCap)) return null
  // A week run past its target is stored at the minutes run; the loading sequence carries on from
  // the minutes it was planned at, so an overshoot lifts nothing after it [rules g-2, g-6].
  // A hold keeps the volume it caps the week at, and the sequence carries on from that week. Read
  // from the stored week alone it would carry on from the cap at a second re-plan of the same
  // Monday and from the plan before the cap at the first [rules J5, G-6].
  const held = current.isRecovery || heldCap === undefined ? Infinity : heldCap
  return { minutes: Math.min(plannedMinOf(work), stepCap, held), paused: current.isRecovery }
}

/** Quality sessions wanted in a pre-taper week before the run-day cap [rules F2, H1]. */
function wantedQuality(phase: PhaseV2, novice: boolean, goal: GoalModel): number {
  let q: number
  if (phase === 'base') q = novice ? 0 : P.k3.minQualitySessionsPerWeek.value
  else q = novice ? P.k3.minQualitySessionsPerWeek.value : P.f2.qualitySessionsPerWeek.value
  // 100 km and longer: grow weekly volume before adding pace work
  if (goal.distanceM >= P.h1.volumeFirstFromM.value) q = Math.min(q, 1)
  return q
}

/** Phase-specific share of the race's gain per km practised each week [rules H4]. */
function gainShare(phase: PhaseV2): number {
  if (phase === 'base') return P.macroDesign.gainShareBase.value
  if (phase === 'build') return P.macroDesign.gainShareBuild.value
  return P.macroDesign.gainShareSpecific.value
}

/**
 * Where a week stands in its strength block, week k of n: the run of consecutive weeks that carry
 * `strength-block` in `weeks` (the stored weeks and the planned ones) that contains it. Null for a
 * week outside a block [rule E5].
 */
export function strengthBlockPosition(
  weeks: ReadonlyArray<Pick<WeekDraft, 'weekStart' | 'flags'>>,
  weekStart: string,
): { week: number; of: number } | null {
  const flagged = new Set(
    weeks.filter((w) => w.flags.includes('strength-block')).map((w) => w.weekStart),
  )
  if (!flagged.has(weekStart)) return null
  let first = weekStart
  while (flagged.has(addDays(first, -7))) first = addDays(first, -7)
  let last = weekStart
  while (flagged.has(addDays(last, 7))) last = addDays(last, 7)
  return { week: daysBetween(first, weekStart) / 7 + 1, of: daysBetween(first, last) / 7 + 1 }
}

/**
 * The latest run of consecutive weeks (adjacent Mondays) before `firstMonday` that carry
 * `strength-block` in the plan a re-plan replaces: its length, and whether it ends on the Monday
 * before `firstMonday`, which is a block under way. Null without such a week or without a stored
 * plan. An earlier run is not counted, so a stray flag cannot shorten a block under way [rule E5].
 */
function pastStrengthBlock(
  input: EngineInput,
  firstMonday: string,
): { weeks: number; underWay: boolean } | null {
  const flagged = new Set(
    (input.existing?.weeks ?? [])
      .filter((w) => w.weekStart < firstMonday && w.flags.includes('strength-block'))
      .map((w) => w.weekStart),
  )
  const last = [...flagged].sort().at(-1)
  if (last === undefined) return null
  let weeks = 1
  for (let cursor = addDays(last, -7); flagged.has(cursor); cursor = addDays(cursor, -7)) weeks += 1
  return { weeks, underWay: last === addDays(firstMonday, -7) }
}

/** The latest restart floor week of the plan a re-plan replaces, before `firstMonday`. */
export function pastFloor(
  input: EngineInput,
  firstMonday: string,
): { weekStart: string; minutes: number } | null {
  const week = (input.existing?.weeks ?? [])
    .filter((w) => w.weekStart < firstMonday && w.flags.includes('restart-floor'))
    .at(-1)
  return week === undefined ? null : { weekStart: week.weekStart, minutes: week.targetRunMin }
}

// ---- start paths [rules E6, G-3] ----

/** One completed run as the start paths read it. */
interface RunFact {
  /** Days before today. */
  ago: number
  /** The continuous running of the activity, in minutes. */
  min: number
  /** The whole activity, walks included: what the 30-day reference of G-1 compares sessions with. */
  whole: number
  pain: number | null
}

/**
 * The continuous run of an activity: for one linked to a run-walk session, its longest running
 * bout (the walks are no part of it), else the whole activity [rules E6].
 */
function continuousMin(a: Activity, linked: SessionSpec | undefined): number {
  const whole = a.durationSec / 60
  if (linked === undefined || !(linked.flags.includes('run-walk') || isLadderSession(linked))) {
    return whole
  }
  const bouts = linked.structure
    .filter((s) => (s.kind === 'work' || s.kind === 'steady') && s.durationSec !== null)
    .map((s) => s.durationSec! / 60)
  return bouts.length === 0 ? whole : Math.max(...bouts)
}

/**
 * The completed runs the start paths read: the same runs as the 30-day reference of G-1
 * (`countsTowardReference`, so a marathon or longer race is no run here either), without
 * duplicates, so the path and the limit that holds its sessions agree [rules E6, g-1].
 */
function runFacts(input: EngineInput): RunFact[] {
  const linked = new Map<string, SessionSpec>()
  for (const s of input.existing?.sessions ?? []) {
    if (s.activityId !== null) linked.set(s.activityId, s)
  }
  return input.activities
    .filter(
      (a) =>
        countsTowardReference(a) && !isDuplicate(a) && a.date <= input.today && a.durationSec > 0,
    )
    .map((a) => ({
      ago: daysBetween(a.date, input.today),
      min: continuousMin(a, linked.get(a.id)),
      whole: a.durationSec / 60,
      pain: a.pain,
    }))
}

/** The longest continuous run within `days` days of today, in minutes; 0 without one. */
const longestWithin = (runs: RunFact[], days: number): number =>
  runs.filter((r) => r.ago < days).reduce((m, r) => Math.max(m, r.min), 0)

/**
 * The most a session may hold against the 30-day reference of G-1 in the first week of a plan
 * (`runCaps` of the longest whole run): the runs still in the window on every day of the week, as
 * the macrocycle holds the week; when none is, the first day's window, since a run that leaves the
 * 30 days during the week still limits the days before it. Infinity without a run in either, as
 * the guard compares nothing then. `weekday` counts days since Monday (0 for Monday).
 */
function sessionBound(runs: RunFact[], weekday: number): number {
  const window = P.g1.windowDays.value
  const capWithin = (maxAgo: number) =>
    runCaps({
      min: runs
        .filter((r) => r.ago >= 1 && r.ago <= maxAgo)
        .reduce((m, r) => Math.max(m, r.whole), 0),
      distanceM: null,
      gainM: null,
      lossM: null,
    }).min
  const shared = capWithin(weekday + window - 6)
  return Number.isFinite(shared) ? shared : capWithin(window)
}

/**
 * The highest rung whose longest running bout is within the G-1 limit of a run of `ref` minutes,
 * and within the `bound` that the 30-day reference leaves a session in the first week.
 */
function ladderEntry(ref: number, bound: number): number {
  const limit = Math.min(P.g1.spikeRatioWarn.value * ref, bound)
  let rung = 1
  for (let r = 1; r <= rungCount(); r += 1) {
    if (Math.max(...rungSessions(r).map(longestBout)) <= limit + EPS) rung = r
  }
  return rung
}

/** The years route of E6 path 2: 2 years of running and no soft start flag. */
function experiencedStart(state: AthleteState): boolean {
  return (
    state.yearsRunning !== null &&
    state.yearsRunning >= P.a5.trainedMinYears.value &&
    state.risk.noviceFlags.length === 0
  )
}

/** Which route lifts a start above 3 x 20 [rules E6, g-8]. */
export type StartLift = 'years' | 'block'

/**
 * The route that lets a 3 x N start rise above 20 minutes, or null when N stays 20 [rules E6]:
 * the years route (2 years of running, no soft flag, no tightened profile), else the block route
 * of g-8 (`blockLift`, loadSetting.ts: a year of running and a recent block of at least 3 x 30
 * minutes a week at the standard and upper positions). Whether N actually rises also depends on
 * the longest run of the last 30 days.
 */
export function startLift(input: EngineInput, state: AthleteState): StartLift | null {
  if (experiencedStart(state) && tightRamp(state) === null) return 'years'
  return blockLift(input, state) ? 'block' : null
}

/**
 * Where a runner starts, from history [rules E6, G-3, A9]: the run-walk ladder, 3 sessions of N
 * minutes, the injury-return ladder, or null when the start level (`startLevelMin`, limits.ts:
 * the typical week, or the last two complete weeks when they were higher) is at or above
 * 3 x 20 minutes. It reads the runs of the last 30 and 90 days that the 30-day reference of G-1
 * counts (a marathon or longer race is none of them); sex never changes the dose.
 *
 *  - A recent-injury flag with a typical week under the floor, or no runs: the injury-return
 *    ladder, entering at the highest level not above the longest pain-free run of the last
 *    30 days.
 *  - A continuous run of 20 minutes or more in the last 30 days: 3 x N, N the longest such run
 *    rounded down to 5 minutes and held between 20 and 30, and never above what G-1 lets a
 *    session hold; above 20 only by one of the two routes of `startLift`. A tightened profile
 *    (an earlier bone stress injury, the BSI factors) counts as a flag: it takes the path but
 *    is never lifted.
 *  - Otherwise, with a run in the last 90 days: the J7 fraction (by layoff) times that run, when
 *    the 30-day window holds none; 20 minutes or more is 3 x 20, less enters the ladder at the
 *    highest rung that run allows.
 *  - No run in 90 days: 3 x 20 for an unflagged runner with 2 years of running, else rung 1.
 */
export function startPath(input: EngineInput, state: AthleteState): StartPath | null {
  const sessionMin = P.restartFloor.sessionMin.value
  if (startLevelMin(state) >= P.restartFloor.sessions.value * sessionMin) return null
  const runs = runFacts(input)

  if (injuryTight(state)) {
    const best = runs
      .filter(
        (r) =>
          r.ago < P.restartFloor.lookbackDays.value &&
          (r.pain === null || r.pain <= P.injuryReturn.advanceMaxPain.value),
      )
      .reduce((m, r) => Math.max(m, r.min), 0)
    let level = 0
    P.injuryReturn.levelsMin.value.forEach((minutes, i) => {
      if (minutes <= best + EPS) level = i
    })
    return { kind: 'injury-return', level }
  }

  const experienced = experiencedStart(state)
  // a tightened profile takes the path like any runner, but never the lift above 20 minutes
  const lifts = startLift(input, state) !== null
  const bmi = bmiOf(input.profile)
  const heavy = bmi !== null && bmi > P.a9.noviceFlagBmiAbove.value
  const floor = (minutes: number): StartPath => ({ kind: 'floor', sessionMin: minutes })
  const ladder = (rung: number): StartPath => ({
    kind: 'ladder',
    rung,
    bmiHold: heavy && rung === 1,
  })
  // What G-1 leaves a session against the runs of the last 30 days: no floor session is longer
  const bound = sessionBound(runs, daysBetween(mondayOf(input.today), input.today))
  const floorFits = bound >= sessionMin - EPS

  const longest30 = longestWithin(runs, P.restartFloor.lookbackDays.value)
  if (longest30 >= sessionMin - EPS && floorFits) {
    const step = P.restartFloor.sessionStepMin.value
    const rounded = Math.floor(longest30 / step + EPS) * step
    const lifted = Math.min(Math.max(rounded, sessionMin), P.restartFloor.sessionMaxMin.value)
    return floor(Math.min(lifts ? lifted : sessionMin, floorEps(bound)))
  }
  const longest90 = longestWithin(runs, P.restartFloor.fallbackLookbackDays.value)
  if (longest90 <= 0) return experienced ? floor(sessionMin) : ladder(1)
  // G-1 has no reference after 30 days off: the J7 fraction of the longest run stands in for it
  const ref = longest30 > 0 ? longest30 : breakRestart(state.layoffDays, 1).fraction * longest90
  return ref >= sessionMin - EPS && floorFits ? floor(sessionMin) : ladder(ladderEntry(ref, bound))
}

/** A start path as the macrocycle runs it: the step, the BMI hold left and whether it repeats. */
interface StartPlan {
  kind: StartKind
  /** Ladder rung (1-based), floor session minutes, or injury-return level index. */
  step: number
  /** Weeks still held at `step` by the BMI rule, counting the first. */
  holdWeeks: number
  /** The first week repeats the step of the week before. */
  repeat: boolean
  /** A progression hold: the step never rises and the floor repeats [rules n-1, n-4, J5]. */
  frozen: boolean
}

function planOf(path: StartPath, frozen: boolean): StartPlan {
  if (path.kind === 'ladder') {
    return {
      kind: 'ladder',
      step: path.rung,
      holdWeeks: path.bmiHold ? P.noviceLadder.bmiHoldWeeks.value : 0,
      repeat: false,
      frozen,
    }
  }
  if (path.kind === 'floor') {
    return { kind: 'floor', step: path.sessionMin, holdWeeks: 0, repeat: false, frozen }
  }
  return { kind: 'injury-return', step: path.level, holdWeeks: 0, repeat: false, frozen }
}

/** A week without pain: no activity, no check-in of the week or the day after it reports any. */
function symptomFree(input: EngineInput, weekStart: string): boolean {
  const max = P.injuryReturn.advanceMaxPain.value
  for (let k = 0; k <= 7; k += 1) {
    const checkin = checkinOn(input, addDays(weekStart, k))
    if (checkin !== null && ((checkin.painScore ?? 0) > max || checkin.painFocalBone)) return false
  }
  const weekEnd = addDays(weekStart, 6)
  return !input.activities.some(
    (a) => a.date >= weekStart && a.date <= weekEnd && a.pain !== null && a.pain > max,
  )
}

/**
 * Whether a stored start week was planned at its step's own length: the sessions it holds average
 * what the table week of the step does, within a minute for rounding. A week held short of its
 * step by a limit (G-1 on the sessions, a cap on the week) repeats the step; a week with fewer
 * sessions than the step draws, as the open days leave room for, does not [rules E6, G-3].
 */
function atOwnLength(week: WeekDraft, kind: StartKind, step: number): boolean {
  const table = startWeek(kind, step)
  if (week.runDays <= 0 || table.sessions.length === 0) return false
  return week.targetRunMin / week.runDays >= table.minutes / table.sessions.length - 1
}

/**
 * The 3 x N floor week a re-plan is made in, when the start path has since ended [rules E6, g-2]:
 * the plan opened this week on the floor, so the week stays on it. The floor is one week, and its
 * exemption from the 2-week ceiling is the week's own. History logged since the plan was made (a
 * week of runs imported late) can lift the start level to 3 x 20 and end the start path, but the
 * week is then not drawn again from the ceiling of the weeks before the layoff (28 min x 1.3),
 * which would plan it below the floor it opened on and every week after it below the plan they
 * continue. Null without such a week, and under a progression hold, where a runner with a start
 * level keeps it and no floor repeats.
 */
function floorContinuation(
  input: EngineInput,
  firstMonday: string,
  hold: boolean,
): StartPlan | null {
  const current = input.existing?.weeks.find((w) => w.weekStart === firstMonday)
  if (hold || current === undefined || !current.flags.includes('restart-floor')) return null
  const sessions = P.restartFloor.sessions.value
  const step =
    current.longRunMin > 0 ? current.longRunMin : Math.round(plannedMinOf(current) / sessions)
  return step > 0 ? { kind: 'floor', step, holdWeeks: 0, repeat: false, frozen: false } : null
}

/**
 * Where a re-plan carries a start path on [rules E6, G-3]: the weeks before this one that the
 * replaced plan flagged as ladder or injury-return weeks, in a row up to last week, are walked from
 * the first. A ladder week advances one rung after a week at the rung's own length with at least
 * 80% of the planned minutes, no pain and (with ratings) a mean RPE under 5; otherwise the rung
 * repeats. An injury-return week advances one level after both runs were run at the level's own
 * length (within a minute) without symptoms, drops one level with symptoms and repeats otherwise,
 * so the programme ends only after the last level was run at its length. A plan that began this
 * week keeps the step it began at. Under a progression hold nothing advances beyond the step of
 * last week. Null without a start week to carry on.
 */
function startContinuation(
  input: EngineInput,
  firstMonday: string,
  frozen: boolean,
): StartPlan | null {
  const byStart = new Map((input.existing?.weeks ?? []).map((w) => [w.weekStart, w]))
  const kindOf = (w: WeekDraft | undefined): 'ladder' | 'injury-return' | null =>
    w === undefined
      ? null
      : ladderRung(w.flags) !== null
        ? 'ladder'
        : w.flags.includes('injury-return')
          ? 'injury-return'
          : null
  const heavyAt = (rung: number) => {
    const bmi = bmiOf(input.profile)
    return rung === 1 && bmi !== null && bmi > P.a9.noviceFlagBmiAbove.value
  }
  const held = P.noviceLadder.bmiHoldWeeks.value

  const lastKind = kindOf(byStart.get(addDays(firstMonday, -7)))
  const run: WeekDraft[] = []
  if (lastKind !== null) {
    for (
      let cursor = addDays(firstMonday, -7);
      kindOf(byStart.get(cursor)) === lastKind;
      cursor = addDays(cursor, -7)
    ) {
      run.unshift(byStart.get(cursor)!)
    }
  }
  if (run.length === 0) {
    const current = byStart.get(firstMonday)
    const kind = kindOf(current)
    if (kind === null || current === undefined) return null
    const step = kind === 'ladder' ? ladderRung(current.flags)! : (injuryLevel(current.flags) ?? 0)
    return {
      kind,
      step,
      holdWeeks: kind === 'ladder' && heavyAt(step) ? held : 0,
      repeat: false,
      frozen,
    }
  }

  const first = run[0]!
  if (lastKind === 'ladder') {
    const heavy = heavyAt(ladderRung(first.flags)!)
    let rung = ladderRung(first.flags)!
    run.forEach((w, k) => {
      const planned = ladderRung(w.flags)!
      const ev = weekEvidence(input, w.weekStart)
      const advanced =
        atOwnLength(w, 'ladder', planned) &&
        ev.share !== null &&
        ev.share >= P.noviceLadder.advanceMinCompletion.value - EPS &&
        ev.worstPain <= 0 &&
        (ev.meanRpe === null || ev.meanRpe < P.noviceLadder.holdRpe.value)
      rung = advanced && !(heavy && k + 1 < held) ? planned + 1 : Math.min(rung, planned)
    })
    // a hold keeps the rung the runner was on last week, whatever the week showed
    const lastRung = ladderRung(run.at(-1)!.flags)!
    if (frozen) rung = Math.min(rung, lastRung)
    return {
      kind: 'ladder',
      step: rung,
      holdWeeks: heavy ? Math.max(0, held - run.length) : 0,
      repeat: rung <= lastRung,
      frozen,
    }
  }
  const levels = P.injuryReturn.levelsMin.value
  let level = injuryLevel(first.flags) ?? 0
  for (const w of run) {
    const planned = injuryLevel(w.flags) ?? 0
    const atLength =
      runsReaching(input, w.weekStart, levels[Math.min(planned, levels.length - 1)]!) >=
      P.injuryReturn.repeatsPerLevel.value
    level = !symptomFree(input, w.weekStart)
      ? Math.max(0, planned - 1)
      : atLength
        ? planned + 1
        : Math.min(level, planned)
  }
  // a hold keeps the level the runner was on last week, whatever the week showed
  const lastLevel = injuryLevel(run.at(-1)!.flags) ?? 0
  if (frozen) level = Math.min(level, lastLevel)
  return {
    kind: 'injury-return',
    step: level,
    holdWeeks: 0,
    repeat: level <= lastLevel,
    frozen,
  }
}

/**
 * Phases built backwards from race day, weekly targets, TID targets, fixed blocks and the
 * post-race weeks [rules e, h, k]. Feasibility labels the plan elsewhere; it never changes a limit.
 */
function planWeeks(
  input: EngineInput,
  state: AthleteState,
  goal: GoalModel,
  _feasibility: Feasibility,
  /**
   * A plan built inside a post-race window [H12]: the planned minutes of the window weeks before
   * its first week (ramp baselines), and the first loading week after them, which restarts from
   * the J7 volume and is exempt from G-2 like the restart floor week.
   */
  lead: {
    volumes: ReadonlyMap<string, number>
    runs: RunRecord[]
    restart: string | null
  } = { volumes: new Map(), runs: [], restart: null },
  /** The cap of the first week when the weekly decision holds it [rule J5]. */
  heldCap?: number,
): { weeks: WeekDraft[]; raceWeekTail: WeekDraft | null } {
  const firstMonday = mondayOf(input.today)
  const raceMonday = mondayOf(goal.date)
  if (goal.date < input.today) return { weeks: [], raceWeekTail: null }
  const total = daysBetween(firstMonday, raceMonday) / 7 + 1
  if (total < 1) return { weeks: [], raceWeekTail: null }

  const novice = state.experience === 'novice'
  // Novices and low-frequency runners step by time, with a minimum step [rules A5, g-2].
  const rampNovice = noviceRamp(state)
  // A hold (REDs flags or focal bone pain) stops growth: every loading week, long run and gain
  // target stays at the current level.
  const hold = progressionHold(input, state)
  const ramp = hold ? 0 : weeklyRamp(state)
  const pace = trainingPace(state, goal)
  const share = goal.isUltra
    ? P.macroDesign.longRunShareOfWeekUltra.value
    : P.macroDesign.longRunShareOfWeek.value
  const cut = P.e3.recoveryWeekCutPct.value / 100

  // Phases
  const taperCount = Math.min(Math.ceil(taperDays(goal, state) / 7), total)
  const preCount = total - taperCount
  const openingRecovery =
    input.existing?.weeks.find((w) => w.weekStart === firstMonday)?.isRecovery === true
  const phases = planPhases(
    preCount,
    taperCount,
    cycleWorkWeeks(input, state),
    openingRecovery,
    carriedPhases(input, firstMonday, raceMonday, preCount),
  )
  const raceIdx = total - 1

  // Run days: novices keep the three-day rhythm, others follow the minutes, never above six
  const sessionMin = (P.d3.typicalSessionKm.value * pace) / 60
  const minDays = P.f5.noviceRunDays.value
  const maxDays = P.f5.mastersMaxRunDays.value
  const daysFor = (target: number) => {
    if (target <= 0) return 0
    if (novice) return minDays
    // volume sets a floor on the run days: 4 from 3 h, 5 from 5 h, 6 from 7 h [F5]
    const byVolume =
      target >= P.f5.sixDaysFromWeeklyMin.value
        ? 6
        : target >= P.f5.fiveDaysFromWeeklyMin.value
          ? 5
          : target >= P.f5.fourDaysFromWeeklyMin.value
            ? 4
            : 0
    return Math.min(maxDays, Math.max(minDays, Math.round(target / sessionMin), byVolume))
  }

  // The limits every week is planned inside (limits.ts), as the guards check them: the weekly ramp
  // over the previous loading weeks, the 30-day reference of the session spike guard over the
  // completed runs and the long runs planned before, and the weekly gain ramp [rules g-1, g-2,
  // H4]. Each planned week enters the baselines as it is drawn; the week placement holds these
  // targets, so the guards read the same numbers from the placed sessions.
  const volumes = new Map(state.weeks.map((w) => [w.weekStart, w.runMin]))
  for (const [weekStart, minutes] of lead.volumes) volumes.set(weekStart, minutes)
  // the restart week after a post-race window, in this plan or in the one it replaces
  const restartWeeks = new Set(
    (input.existing?.weeks ?? [])
      .filter((w) => w.flags.includes('post-race-restart'))
      .map((w) => w.weekStart),
  )
  if (lead.restart !== null) restartWeeks.add(lead.restart)
  const pastLow = (input.existing?.weeks ?? [])
    .filter((w) => w.weekStart < firstMonday && (w.isRecovery || w.isTaper))
    .map((w) => w.weekStart)
  const skip = rampSkipWeeks(input.today, pastLow)
  const exempt = new Map<string, RampExemption>()
  const rampCtx: RampContext = {
    volumes,
    skip,
    // a restart floor week of the plan being replaced stays the baseline of the weeks after it
    floor: pastFloor(input, firstMonday),
    exempt,
    ...rampBasis(state, rebuildZone(input, state), responseBasis(input, state)),
  }
  // The minutes already logged in the week the plan opens in. The ceiling of G-2 limits what a plan
  // adds to the weeks two and three before it; it cannot take back minutes already run, so the cap
  // of the opening week is never below them. Otherwise a plan made in the middle of the week after
  // one above that ceiling (runs imported late, a layoff just ended) would plan the week below what
  // is logged in it, and every week after it from there [rules g-2].
  const loggedOpening = state.weeks.find((w) => w.weekStart === firstMonday)?.runMin ?? 0
  /** The most a loading week may hold: the planning limit, at the athlete's own ramp. */
  const stepCap = (weekStart: string): number => {
    if (restartWeeks.has(weekStart)) return Infinity
    // The week the plan opens on is not stepped from a baseline, so the response does not lift its
    // cap: after weeks run under the plan, missed training still lowers it [rules g-2, g-8].
    const lim = rampLimits(
      weekStart === firstMonday ? { ...rampCtx, response: null } : rampCtx,
      weekStart,
    )
    if (lim === null) return Infinity
    if (lim.isFloorWeek) return floorEps(lim.plan)
    const cap = floorEps(
      Math.min(lim.plan, rebuildStep(lim.base, ramp, rampNovice, rampCtx.rebuild)),
    )
    return weekStart === firstMonday ? Math.max(cap, loggedOpening) : cap
  }
  const runs: RunRecord[] = [...completedReference(input.activities, state).runs]
  // the runs a programme week is compared with leave out the sessions of other programme weeks
  const plainRuns: RunRecord[] = [...runs]
  const gains = weeklyGain(input.activities)
  const window = P.g1.windowDays.value
  /**
   * The normal band of the runs within 30 days of every day the week can hold its long run. The
   * week of a start path, whose sessions share one limit, is held by the first day's window when
   * no run is in the window of every day: a run that leaves the 30 days during the week still
   * limits the days before it does. `programme` reads the completed and the plain runs only (a
   * ladder or injury-return week).
   */
  const capsOf = (weekStart: string, programme = false, startPathWeek = programme) => {
    const firstDay = weekStart < input.today ? input.today : weekStart
    const source = programme ? plainRuns : runs
    let ref = referenceBetween(source, addDays(weekStart, 6 - window), addDays(firstDay, -1))
    if (startPathWeek && ref.min <= 0) {
      ref = referenceBetween(source, addDays(firstDay, -window), addDays(firstDay, -1))
    }
    return runCaps(ref)
  }

  // A plain long run is prescribed at the middle of the zone 1 pace band when the zones carry pace
  // (sessions.ts), and otherwise takes the week's long-run distance at the training pace.
  const z1 = buildZones(input.profile, state, input.today).pace?.z1 ?? null
  const runPace = z1 === null ? pace : (z1[0] + z1[1]) / 2
  // The D7 distance cap of a 5 km or 10 km long run is measured at the pace the run is carried at,
  // so a runner whose zone 1 is faster than the logged runs gets the minutes of 16 km at that pace.
  const peakLong = peakLongRunMin(goal, pace, state, runPace)
  const shortRace = goal.distanceClass === '5k' || goal.distanceClass === '10k'
  const longRunMaxM = shortRace ? P.macroDesign.peakLongRunKmMax.value * 1000 : Infinity
  /** The long run's distance at the training pace, within the distance limit of the week. */
  const distanceOf = (minutes: number, caps: { distanceM: number }) => {
    if (minutes <= 0) return null
    const metres = Math.round((((minutes * 60) / pace) * 1000) / 100) * 100
    return Math.min(
      metres,
      longRunMaxM,
      Number.isFinite(caps.distanceM) ? Math.floor(caps.distanceM) : Infinity,
    )
  }
  /** The distance the long run will carry: as prescribed, rounded to 100 m. */
  const carriedM = (minutes: number, metres: number | null) =>
    z1 === null
      ? metres
      : Math.min(Math.round((((minutes * 60) / runPace) * 1000) / 100) * 100, longRunMaxM)
  // The runs of the post-race weeks before the plan's first week are in the 30-day reference. They
  // carry the distance they are placed at, as the long runs drawn below do, so the distance limit
  // of G-1 on the weeks after them reads the same reference as the placement.
  for (const r of lead.runs) {
    const entry: RunRecord = { ...r, distanceM: carriedM(r.min, r.distanceM) }
    runs.push(entry)
    plainRuns.push(entry)
  }

  // Weekly targets, long runs, run days and gain for the pre-taper weeks
  // A start path lifts a small week to a useful one, which is growth; a hold keeps the current
  // level. A re-plan continues the plan it replaces: a ladder carries on from the weeks it has run
  // (`startContinuation`), and a start path lifts only a new plan, or a re-plan whose continuation
  // would sit below its first week [rules E6].
  const continued = hold
    ? null
    : replanAnchor(input, state, firstMonday, stepCap(firstMonday), heldCap)
  // Under a hold nothing advances: a ladder keeps its rung, a level its level, and the floor
  // repeats. A new start path is chosen under a hold only for a runner with no weekly running,
  // who would otherwise start from the start floor week; a runner with a typical week keeps it.
  const carried = startContinuation(input, firstMonday, hold)
  const fresh =
    carried !== null || (hold && state.typicalWeekMin > 0) ? null : startPath(input, state)
  // The floor week the plan opened on stays on the floor when the start level has since ended the
  // start path (`floorContinuation`).
  const lapsed =
    carried === null && fresh === null ? floorContinuation(input, firstMonday, hold) : null
  const path: StartPlan | null = carried ?? lapsed ?? (fresh === null ? null : planOf(fresh, hold))
  /** The most a session of a start path may hold in the week of `weekStart`: G-1 as a hard bound. */
  const limitOf = (weekStart: string, kind: StartKind): number => {
    const caps = capsOf(weekStart, kind !== 'floor', true)
    const distanceCap = Number.isFinite(caps.distanceM)
      ? floorEps(((caps.distanceM - 50) * runPace) / 60_000)
      : Infinity
    return Math.min(caps.min, distanceCap)
  }
  // The weeks of the start path in this plan, cut at the taper. A step rises only when the week
  // drawn at it ran at its own length, so a step held short by G-1 repeats and the programme ends
  // only after its last step was run at full length [rules E6, G-3].
  const schedule =
    path === null
      ? { steps: [] as number[], finished: false }
      : stepSchedule(
          path,
          preCount,
          (i, step) =>
            startWeek(path.kind, step, limitOf(addDays(firstMonday, 7 * i), path.kind)).clipped,
        )
  const startCount = schedule.steps.length
  const opening = startCount > 0 ? startWeek(path!.kind, schedule.steps[0]!) : null
  // a 3 x N floor does not replace a recovery week of the plan being replaced
  const lifts = path?.kind !== 'floor' || phases[0]?.isRecovery !== true
  // the plan being replaced opened this week on the 3 x N floor
  const onFloorNow =
    input.existing?.weeks
      .find((w) => w.weekStart === firstMonday)
      ?.flags.includes('restart-floor') === true
  // A re-plan keeps its floor week when the minutes run in it have lifted the cap of the opening
  // week (`stepCap`) to the floor itself: the continuation then no longer sits below the floor
  // week, and the week would lose its floor flags [rules E6, g-2].
  const restart =
    path !== null &&
    opening !== null &&
    lifts &&
    (carried !== null ||
      continued === null ||
      continued.minutes < opening.minutes ||
      (onFloorNow && path.kind === 'floor'))
      ? path
      : null
  const startWeeks = restart === null ? 0 : startCount
  // the plan opens with this path: it is new, or it began this week (a re-plan keeps its floor week)
  const opensPlan = carried === null || onFloorNow
  // the weeks of a ladder follow its steps and repeats: no recovery week inside it (the weeks after
  // it open a new block, which the checklist counts the same way)
  const programmeWeeks = restart !== null && restart.kind !== 'floor' ? startWeeks : 0
  for (let i = 0; i < programmeWeeks && i < preCount; i++) phases[i]!.isRecovery = false
  // The recovery week the replaced plan stored on this Monday stays a recovery week wherever the
  // count falls, unless a start path claims the week (a 3 x N floor after a gap, a ladder: a rule
  // drives that start, not the cadence). After a change of cycle (the low-frequency flag arming or
  // ending, 2:1 and 3:1) the count misses the week, and a loading week there would be drawn a step
  // above the loading sequence while its sessions stay the recovery week's (`remainingOfWeek`).
  // The last pre-taper week is the peak, a work week, and the count's own recovery week would
  // follow the kept one directly: one recovery week, not two.
  if (openingRecovery && restart === null && preCount > 1) {
    phases[0]!.isRecovery = true
    phases[1]!.isRecovery = false
  }
  keepCadenceAcrossReplan(
    phases,
    input,
    firstMonday,
    cycleWorkWeeks(input, state),
    programmeWeeks,
    startWeeks,
  )
  const anchored = restart === null ? continued : null
  const start =
    restart !== null
      ? opening!.minutes
      : anchored !== null
        ? anchored.minutes
        : startLevelMin(state) > 0
          ? startLevelMin(state)
          : P.macroDesign.startFloorWeekMin.value
  const ceiling = Math.max(peakWeeklyMin(goal, pace), start)
  const hasGain = goal.gainM > 0 && goal.distanceM > 0
  const gainPerKm = hasGain ? goal.gainM / (goal.distanceM / 1000) : 0
  const gainStep = P.h4.minStepGainM.value
  const target: number[] = []
  const longRun: number[] = []
  const longM: Array<number | null> = []
  const runDays: number[] = []
  const gain: Array<number | null> = []
  /** The weeks drawn from a start path, by index. */
  const startDrawn: StartWeek[] = []
  let lastWork = start
  // after an opening recovery week, the first work week continues the loading sequence it paused
  let haveWork = anchored?.paused === true
  let prevLong = floorEps(state.longest30d.durationSec / 60)
  let prevDays = 0
  let prevGain = Math.max(gainStep, floorTo10(state.longest30d.gainM))

  /** The week enters the ramp baselines, and its long run the 30-day reference. */
  const record = (
    i: number,
    weekStart: string,
    low: boolean,
    longest = longRun[i] as number,
    programme = false,
  ) => {
    const t = target[i] as number
    volumes.set(weekStart, t)
    if (low) skip.add(weekStart)
    const g = gain[i] ?? null
    if (g !== null) gains.set(weekStart, g)
    const long = longest
    if (long > 0) {
      // dated on the first day the week can hold it, so the reference is never overstated
      const date = weekStart < input.today ? input.today : weekStart
      const longGain = g === null || t <= 0 ? null : Math.floor((g * long) / t)
      const entry: RunRecord = {
        date,
        min: long,
        distanceM: carriedM(long, longM[i] ?? null),
        gainM: longGain,
        lossM: longGain,
      }
      runs.push(entry)
      if (!programme) plainRuns.push(entry)
    }
  }

  for (let i = 0; i < preCount; i++) {
    const ph = phases[i] as PhasePlan
    const weekStart = addDays(firstMonday, 7 * i)
    // a ladder or injury-return week is compared with the completed runs and the plain runs
    const programmeWeek = restart !== null && restart.kind !== 'floor' && i < startWeeks
    const caps = capsOf(weekStart, programmeWeek, restart !== null && i < startWeeks)
    // rounded to 100 m, the distance may be 50 m above the minutes' own
    const distanceCapMin = Number.isFinite(caps.distanceM)
      ? floorEps(((caps.distanceM - 50) * runPace) / 60_000)
      : Infinity
    const longCap = Math.min(peakLong, caps.min, distanceCapMin)
    const rawLong = floorEps(start * share)
    // A week of a start path is its programme, every session held to the 30-day limit of G-1 as a
    // hard bound [rules E6, g-1]; the first week is the baseline the ramp measures from.
    const step = restart === null || i >= startWeeks ? null : (schedule.steps[i] ?? null)
    if (restart !== null && step !== null) {
      const repeat = restart.repeat && i === 0
      // the first week of a new start is the baseline; a later week stays inside the 2-week
      // ceiling of G-2, which the ladders are exempt from only in the soft step
      if (restart.kind !== 'floor') {
        exempt.set(weekStart, restart.kind === 'ladder' ? 'soft' : 'ramp')
      }
      const lim = i === 0 && opensPlan ? null : rampLimits(rampCtx, weekStart)
      // a hold stops growth: no week of the held programme is longer than its first
      const heldAt = restart.frozen && i > 0 ? (startDrawn[0]?.minutes ?? Infinity) : Infinity
      const weekMax = Math.min(lim === null ? Infinity : floorEps(lim.allowed), heldAt)
      const limit = Math.min(caps.min, distanceCapMin)
      let sw = startWeek(restart.kind, step, limit, repeat, weekMax)
      // when the limit leaves no run, the week keeps its programme and the plan says the runs
      // are left out (generate: spike-run-dropped)
      if (sw.sessions.length === 0) sw = startWeek(restart.kind, step, Infinity, repeat, weekMax)
      const floorWeek = restart.kind === 'floor'
      startDrawn[i] = sw
      target.push(sw.minutes)
      // a ladder has no separate long run; the 3 x N floor is three runs of the same length
      longRun.push(floorWeek ? sw.longest : 0)
      longM.push(floorWeek ? distanceOf(sw.longest, caps) : null)
      runDays.push(sw.sessions.length)
      gain.push(null)
      if (i === 0 && opensPlan) rampCtx.floor = { weekStart, minutes: sw.minutes }
      haveWork = true
      lastWork = sw.minutes
      prevLong = sw.longest
      prevDays = sw.sessions.length
      // a ladder or injury-return session is no reference for another programme week, only for
      // the plain weeks after them (isProgramme)
      record(i, weekStart, false, sw.longest, !floorWeek)
      continue
    }
    if (ph.isRecovery) {
      const t = floorEps(lastWork * (1 - cut))
      target.push(t)
      const long = Math.min(
        prevLong > 0 ? floorEps(prevLong * (1 - cut)) : rawLong,
        floorEps(t * share),
        longCap,
      )
      longRun.push(long)
      longM.push(distanceOf(long, caps))
      runDays.push(prevDays > 0 ? prevDays : daysFor(t))
      gain.push(hasGain ? floorTo10(prevGain * (1 - cut)) : null)
      record(i, weekStart, true)
      continue
    }
    // The step applies to the baseline of the week: the minutes of the last loading week, or at
    // standard and upper the mean of the minutes run over the last eligible weeks when that is
    // higher (`responseBaseline`, the one function the limits read too). A hold stops growth.
    const wanted = haveWork
      ? Math.min(
          ceiling,
          hold
            ? lastWork
            : floorEps(
                rebuildStep(
                  responseBaseline(lastWork, rampCtx.response, rampNovice),
                  ramp,
                  rampNovice,
                  rampCtx.rebuild,
                ),
              ),
        )
      : start
    let t = Math.max(0, Math.min(wanted, stepCap(weekStart)))
    const days = Math.max(prevDays, daysFor(t))
    // no run of the week is longer than the long run, so the week holds at most its run days at
    // the long run's limit [rules g-1, F5]
    if (Number.isFinite(longCap)) t = Math.min(t, days * longCap)
    haveWork = true
    lastWork = t
    target.push(t)

    const raw = floorEps(t * share)
    const held = hold && prevLong > 0 ? prevLong : Infinity
    // The restart week after a window, with no run in its 30-day reference: the first run of the
    // week sets the reference for the others, so its runs are of one length [rules G-1, J7].
    const even =
      restartWeeks.has(weekStart) && !Number.isFinite(caps.min) ? Math.ceil(t / days) : Infinity
    const long = Math.max(0, Math.min(raw, longCap, held, even))
    longRun.push(long)
    longM.push(distanceOf(long, caps))
    prevLong = long

    prevDays = days
    runDays.push(prevDays)

    if (hasGain) {
      const desired = floorTo10(gainPerKm * ((t * 60) / pace) * gainShare(ph.phase))
      const grown = hold
        ? prevGain
        : Math.max(floorEps(prevGain * (1 + P.h4.weeklyGainRamp.value)), prevGain + gainStep)
      const weekly = gainLimit(gains, skip, weekStart)
      // the long run takes its share of the week's gain by minutes, within its own limit
      const perRun =
        long > 0 && Number.isFinite(caps.gainM) ? floorTo10((caps.gainM * t) / long) : Infinity
      prevGain = Math.max(
        0,
        Math.min(desired, grown, weekly === null ? Infinity : floorTo10(weekly.allowed), perRun),
      )
      gain.push(prevGain)
    } else {
      gain.push(null)
    }
    record(i, weekStart, false)
  }

  // The reference week for the taper and the post-race weeks is the peak before the taper
  const reference = preCount > 0 ? Math.max(...target) : start
  const refDays = preCount > 0 ? prevDays : daysFor(start)
  const refLong = prevLong
  const refGain = hasGain ? prevGain : null
  const mult = taperMultipliers(taperCount)
  let prevTarget = preCount > 0 ? (target[preCount - 1] as number) : start
  let prevTaperLong = refLong
  for (let k = 0; k < taperCount; k++) {
    const i = preCount + k
    const weekStart = addDays(firstMonday, 7 * i)
    const caps = capsOf(weekStart)
    const t = Math.max(0, Math.min(floorEps(reference * (mult[k] ?? 0)), prevTarget - 1))
    prevTarget = t
    target.push(t)
    const isRace = k === taperCount - 1
    const long = isRace ? 0 : Math.max(0, Math.min(prevTaperLong, floorEps(t * share), caps.min))
    longRun.push(long)
    longM.push(distanceOf(long, caps))
    prevTaperLong = isRace ? prevTaperLong : long
    const cutDays = (P.k3.runDaysMaxCutPct.value / 100) * ((k + 1) / taperCount)
    runDays.push(Math.ceil(refDays * (1 - cutDays) - EPS))
    gain.push(refGain === null ? null : floorTo10(refGain * (t / Math.max(reference, 1))))
    record(i, weekStart, true)
  }

  // Strength: a heavy block in base and early build, then maintenance. An ultra goal reads the H10
  // Params in place of the E5 and F-lib ones; their values are equal [rules E5, H10].
  const blockWeeks = goal.isUltra ? P.h10.strengthBlockWeeks.value : P.e5.strengthBlockWeeks.value
  const requested =
    input.options.strengthSessions ??
    Math.min(
      goal.isUltra ? P.h10.strengthSessionsPerWeek.value : P.flib.strengthPerWeek.value,
      input.profile.strengthPreference,
    )
  const maintenance = Math.min(requested, P.e5.strengthMaintenancePerWeek.value)
  const nonSpecific = phases.filter((p, i) => i < preCount && p.phase !== 'specific').length
  // The block belongs to the weeks and not to a plan [rule E5]. The plan being replaced says where
  // it stands: a block that ends on the Monday before this week is under way, and the weeks it has
  // left are the block's length less the run of weeks it has served (no more than the non-specific
  // weeks that remain, and without the minimum, which only a block that has not started must meet).
  // A block that ended earlier is over and starts no other. A plan with no stored block, a
  // regenerate or a new plan, starts one.
  const past = pastStrengthBlock(input, firstMonday)
  let blockLen = 0
  if (past === null) {
    if (nonSpecific >= P.e5.strengthBlockMinWeeks.value) {
      blockLen = Math.min(blockWeeks, nonSpecific)
    }
  } else if (past.underWay) {
    blockLen = Math.min(Math.max(blockWeeks - past.weeks, 0), nonSpecific)
  }

  // Flags for the fixed blocks
  const flagSets: Array<Set<string>> = phases.map(() => new Set<string>())
  const flag = (i: number, name: string) => {
    if (i >= 0 && i < total) flagSets[i]?.add(name)
  }
  for (let i = 0; i < total; i++) {
    const ph = phases[i] as PhasePlan
    if (ph.isRecovery) flag(i, 'recovery')
    if (ph.phase === 'taper') flag(i, 'taper')
    if (ph.phase === 'race') flag(i, 'race-week')
    if (i < blockLen) flag(i, 'strength-block')
  }
  if (preCount > 0) flag(preCount - 1, 'peak')
  for (let i = 0; i < preCount; i++) {
    if (restartWeeks.has(addDays(firstMonday, 7 * i))) flag(i, 'post-race-restart')
  }
  startDrawn.forEach((sw, i) => {
    for (const name of sw.flags) flag(i, name)
  })
  if (opensPlan && startDrawn[0] !== undefined) flag(0, 'restart-floor')

  const specificIdx = phases.map((p, i) => (p.phase === 'specific' ? i : -1)).filter((i) => i >= 0)
  // The last specific weeks, so the block ends before the taper; `gutTraining: false` (a gut
  // condition or an opt-out) leaves it out and changes nothing else [rule H7].
  if ((goal.isUltra || goal.distanceClass === 'marathon') && input.options.gutTraining !== false) {
    for (const i of specificIdx.slice(-P.h7.gutTrainingWeeks.value)) flag(i, 'gut-training')
  }
  if (goal.raceWbgtC !== null && goal.raceWbgtC >= P.i8.triggerWbgtC.value) {
    const blockWeeks = Math.ceil(P.i8.blockDays.value / 7)
    for (let i = Math.max(0, raceIdx - blockWeeks); i < raceIdx; i++) flag(i, 'heat-acclimation')
  }
  if (goal.crossesDarkness) {
    const work = specificIdx.filter((i) => !(phases[i] as PhasePlan).isRecovery)
    const candidates = work.length > 1 ? work.slice(0, -1) : work
    for (const i of candidates.slice(-P.h6.headlampRehearsalRuns.value[1])) flag(i, 'night')
  }
  if (goal.lossM >= P.h4.minStepGainM.value) {
    for (
      let i = Math.max(0, raceIdx - P.h5.downhillStartWeeksBeforeRace.value);
      i < preCount;
      i++
    ) {
      flag(i, 'downhill')
    }
  }
  if (goal.isUltra && !hold) {
    let last = -Infinity
    for (let i = 0; i < preCount; i++) {
      const ph = phases[i] as PhasePlan
      const eligible =
        !ph.isRecovery &&
        (ph.phase === 'build' || ph.phase === 'specific') &&
        (longRun[i] ?? 0) >= P.flib.longRunMinMin.value
      if (eligible && i - last >= P.h3.b2bMinGapWeeks.value) {
        flag(i, 'b2b')
        last = i
      }
    }
  }

  // No quality sessions or strides on the ladder, in the floor and injury-return weeks, or for two
  // weeks after the ladder or the injury return ends [rules E6, G-3]: the Monday of the last such
  // week, from this plan or the plan it replaces.
  let ladderEnd =
    (input.existing?.weeks ?? [])
      .filter(
        (w) =>
          w.weekStart < firstMonday &&
          (ladderRung(w.flags) !== null || injuryLevel(w.flags) !== null),
      )
      .map((w) => w.weekStart)
      .sort()
      .at(-1) ?? null
  if (
    (restart?.kind === 'ladder' || restart?.kind === 'injury-return') &&
    startWeeks > 0 &&
    schedule.finished
  ) {
    ladderEnd = addDays(firstMonday, 7 * (startWeeks - 1))
  }
  const quiet = (weekStart: string) =>
    ladderEnd !== null &&
    weekStart > ladderEnd &&
    daysBetween(ladderEnd, weekStart) <= 7 * P.noviceLadder.quietWeeksAfter.value

  // Assemble the weeks
  const weeks: WeekDraft[] = phases.map((ph, i) => {
    const t = target[i] as number
    const isTaperWeek = ph.phase === 'taper' || ph.phase === 'race'
    const days = runDays[i] as number
    const drawn = startDrawn[i]
    let quality: number
    if (isTaperWeek) quality = P.k3.minQualitySessionsPerWeek.value
    else if (drawn !== undefined || quiet(addDays(firstMonday, 7 * i))) quality = 0
    else {
      quality = Math.min(wantedQuality(ph.phase, novice, goal), Math.max(days - 2, 0))
      if (ph.isRecovery) quality = Math.min(quality, 1)
    }
    let strength: number
    if (ph.phase === 'race') strength = 0
    else if (i < blockLen) strength = requested
    else strength = maintenance
    const long = longRun[i] as number
    return {
      weekStart: addDays(firstMonday, 7 * i),
      index: i,
      phase: ph.phase,
      focus:
        drawn !== undefined
          ? drawn.focus
          : ph.isRecovery
            ? 'Recovery week: lighter volume, frequency kept'
            : FOCUS[ph.phase],
      targetRunMin: t,
      longRunMin: long,
      longRunM: long > 0 ? (longM[i] ?? null) : null,
      gainTargetM: gain[i] ?? null,
      runDays: days,
      qualitySessions: quality,
      strengthSessions: strength,
      tid:
        drawn !== undefined
          ? { z1: 100, z2: 0, z3: 0 }
          : tidFor(ph.phase, goal, input.options.tidModel === 'polarized'),
      flags: [...(flagSets[i] ?? [])],
      isRecovery: ph.isRecovery,
      isTaper: isTaperWeek,
    }
  })

  // After the race: the H12 window, counted in days from the race and laid over the Monday weeks,
  // the race week's included: its days after the hold carry the first step's runs, as a week of
  // their own (`raceWeekTail`) since the race week keeps its taper row. The weeks are held to the
  // runs drawn above, as the guards read them [rules G-1].
  const afterRace = ownWindow(input)
  const [raceWeekTail, ...afterWeeks] = windowWeeks(afterRace, {
    weekStarts: windowMondays(afterRace, raceMonday),
    firstIndex: total - 1,
    reference,
    referenceRunDays: refDays,
    limits: { runs, today: input.today },
  })
  weeks.push(...afterWeeks)
  return { weeks, raceWeekTail: raceWeekTail ?? null }
}

/**
 * A week counts as a window week when this many of its days come before the window ends: the
 * majority of a seven-day week, a count and not a tunable threshold, so it is not a Param.
 */
const WINDOW_MAJORITY_DAYS = 4

/**
 * The weeks of a plan built inside the window of a past race [rules H12, J7]: the Monday weeks that
 * follow the rest of the window, and the volume the normal plan restarts from. Null when no past
 * window is open or the goal date has passed.
 */
function windowLeadIn(
  input: EngineInput,
  state: AthleteState,
  goal: GoalModel,
): { window: PostRaceWindow; weeks: WeekDraft[]; restartMin: number } | null {
  if (goal.date < input.today) return null
  const { past } = postRaceWindows(input)
  if (past === null) return null

  // The reference week: the busiest completed week before the race, else the typical week.
  const raceMonday = mondayOf(past.race.date)
  const before = state.weeks.filter((w) => w.weekStart < raceMonday && w.runMin > 0)
  const peak = before.reduce<(typeof before)[number] | null>(
    (best, w) => (best === null || w.runMin > best.runMin ? w : best),
    null,
  )
  const reference = peak === null ? state.typicalWeekMin : peak.runMin
  const referenceRunDays = Math.max(peak?.runDays ?? 0, P.f5.noviceRunDays.value)

  // Weeks follow the window while most of their days lie inside it, and stop at the goal's week.
  const goalMonday = mondayOf(goal.date)
  const lastMonday = addDays(past.quietUntil, -WINDOW_MAJORITY_DAYS)
  const weekStarts: string[] = []
  for (let m = mondayOf(input.today); m <= lastMonday && m < goalMonday; m = addDays(m, 7)) {
    weekStarts.push(m)
  }
  const weeks = windowWeeks(past, {
    weekStarts,
    firstIndex: 0,
    reference,
    referenceRunDays,
    limits: { runs: completedReference(input.activities, state).runs, today: input.today },
  })

  // J7 with the hold as the layoff, held to the last step's minutes plus one ramp step [G-6].
  const lastFraction = past.stages[past.stages.length - 1]?.fraction ?? 1
  const lastStep = floorEps(reference * lastFraction)
  const restartMin = Math.min(
    breakRestart(past.holdDays, reference).restartMin,
    floorEps(lastStep * (1 + weeklyRamp(state))),
  )
  return { window: past, weeks, restartMin }
}

/**
 * The weeks of the plan: the post-race weeks of a race still in its window, when the plan is built
 * inside one, then the phases, weekly targets and post-race weeks of the goal race [rules e, h, k,
 * H12]. The normal plan starts when the window weeks end, from the J7 restart volume, with the
 * window weeks as ramp baselines; the window weeks are redrawn at every call, never kept.
 */
export function macroPlan(
  input: EngineInput,
  state: AthleteState,
  goal: GoalModel,
  feasibility: Feasibility,
): WeekDraft[] {
  return macroPlanDraft(input, state, goal, feasibility).weeks
}

/**
 * The weeks of the plan (`macroPlan`) and the days of the race week after the goal race as a week
 * of their own: the race week keeps its taper row, and these days carry the first return step
 * [rule H12]. Null where the plan has no race week or the goal race is not ahead.
 */
export function macroPlanDraft(
  input: EngineInput,
  state: AthleteState,
  goal: GoalModel,
  feasibility: Feasibility,
  heldCap?: number,
): { weeks: WeekDraft[]; raceWeekTail: WeekDraft | null } {
  const lead = windowLeadIn(input, state, goal)
  if (lead === null) return planWeeks(input, state, goal, feasibility, undefined, heldCap)
  const normalStart = addDays(mondayOf(input.today), 7 * lead.weeks.length)
  // The plan it replaces is not read: its weeks at the shifted start are weeks of the normal plan
  // and would anchor the restart above the J7 volume.
  const rest = planWeeks(
    { ...input, today: normalStart, existing: null },
    {
      ...state,
      typicalWeekMin: lead.restartMin,
      recentWeekMin: Math.min(state.recentWeekMin, lead.restartMin),
      // the plan restarts from the J7 volume after the window: no history credit, as the position
      // is held at steady inside a post-race window (`loadPosition`), which this call no longer sees
      history: null,
    },
    goal,
    feasibility,
    {
      volumes: new Map(lead.weeks.map((w) => [w.weekStart, w.targetRunMin])),
      runs: windowRuns(lead.window, lead.weeks),
      restart: normalStart,
    },
  )
  return {
    weeks: [
      ...lead.weeks,
      ...rest.weeks.map((w) => ({ ...w, index: w.index + lead.weeks.length })),
    ],
    raceWeekTail:
      rest.raceWeekTail === null
        ? null
        : { ...rest.raceWeekTail, index: rest.raceWeekTail.index + lead.weeks.length },
  }
}
