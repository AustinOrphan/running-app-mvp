// Macrocycle: phases built backwards from race day, weekly targets, intensity distribution and
// the fixed blocks [rules e, h, k]. Pure: the same input gives the same weeks.
//
// Week flags written here (WeekDraft.flags): 'recovery', 'peak', 'taper', 'race-week',
// 'post-race', 'strength-block', 'gut-training', 'heat-acclimation', 'night', 'downhill', 'b2b'.
// Race week is the last week with the race in it: its volume is the shake-out running around the
// race, not the race itself, and its long run is 0. The weeks after the race (H12) follow it.
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import { breakRestart } from './adapt.ts'
import {
  completedReference,
  gainLimit,
  rampLimits,
  rampSkipWeeks,
  rampStep,
  referenceBetween,
  runCaps,
  tightRamp,
  ultraRunCapMin,
  weeklyGain,
  weeklyRamp,
  type RampContext,
  type RunRecord,
} from './limits.ts'
import { isDuplicate } from './load.ts'
import { P } from './params/index.ts'
import {
  ownWindow,
  postRaceWindows,
  windowMondays,
  windowRuns,
  windowWeeks,
  type PostRaceWindow,
} from './postRace.ts'
import { focalBoneActive } from './readiness.ts'
import { buildZones } from './zones.ts'
import type {
  AthleteState,
  EngineInput,
  Feasibility,
  GoalModel,
  PhaseV2,
  WeekDraft,
} from './types.ts'

type Tid = WeekDraft['tid']

/** Guards float noise (100 * 1.1 = 110.00000000000001) before rounding down. */
const EPS = 1e-9
const floorEps = (x: number) => Math.floor(x + EPS)
const floorTo10 = (x: number) => Math.floor((x + EPS) / 10) * 10

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const hi = sorted[mid] ?? 0
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? hi) + hi) / 2
}

/** Weekly ramp that applies to this athlete [rules G-2, G-3]; defined with the other limits. */
export { weeklyRamp }

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

/** Average training pace in sec/km: recent weeks, else the goal pace slowed, else a default. */
function trainingPace(state: AthleteState, goal: GoalModel): number {
  const paces = state.weeks
    .slice(-4)
    .filter((w) => w.runM > 0 && w.runMin > 0)
    .map((w) => (w.runMin * 60) / (w.runM / 1000))
  if (paces.length > 0) return median(paces)
  if (goal.expectedDurationSec > 0 && goal.distanceM > 0) {
    return (
      (goal.expectedDurationSec / (goal.distanceM / 1000)) * P.macroDesign.trainingPaceFactor.value
    )
  }
  return P.macroDesign.defaultEasyPaceSecPerKm.value
}

/** Minutes of running that cover `km` at the training pace. */
const minutesFor = (km: number, paceSecPerKm: number) => Math.ceil((km * paceSecPerKm) / 60)

/** The weekly-minutes ceiling for the goal: the class peak, lifted to the D3 floor for time goals. */
function peakWeeklyMin(goal: GoalModel, pace: number): number {
  let peak = P.peakWeeklyMin[goal.distanceClass].value
  if (goal.goalType === 'time') {
    if (goal.distanceClass === 'half') {
      peak = Math.max(peak, minutesFor(P.d3.halfMinWeeklyKm.value, pace))
    } else if (goal.distanceClass === 'marathon') {
      peak = Math.max(peak, minutesFor(P.d3.marathonMinWeeklyKm.value, pace))
    }
  }
  return peak
}

/** Longest planned run in minutes; ultras are capped by the lesser of 6 h and 60% of the race [H2]. */
export function peakLongRunMin(goal: GoalModel, pace: number): number {
  let peak = P.peakLongRunMin[goal.distanceClass].value
  if (goal.goalType === 'time') {
    if (goal.distanceClass === 'half') {
      peak = Math.max(peak, minutesFor(P.d3.halfMinLongRunKm.value, pace))
    } else if (goal.distanceClass === 'marathon') {
      peak = Math.max(peak, minutesFor(P.d3.marathonMinLongRunKm.value, pace))
    }
  }
  const cap = goal.isUltra ? ultraRunCapMin(goal.expectedDurationSec) : null
  if (cap !== null) peak = Math.min(peak, cap)
  return peak
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

/** Work weeks per recovery cycle [rules E3, G-3]. */
function cycleWorkWeeks(input: EngineInput, state: AthleteState): number {
  const flagged = P.e3.flaggedCycleWorkWeeks.value
  if (state.risk.recentInjury) return flagged
  if (input.options.recoveryCycle === '2:1') return flagged
  if (input.options.recoveryCycle === '3:1') return P.e3.defaultCycleWorkWeeks.value
  return state.experience === 'novice' ? flagged : P.e3.defaultCycleWorkWeeks.value
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
    // re-plan keeps the first week a recovery week when the plan it replaces had it so.
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
 * to the step the recent weeks allow (`stepCap`), so missed training still lowers it. A break of a
 * week or more restarts from the typical week.
 */
function replanAnchor(
  input: EngineInput,
  state: AthleteState,
  firstMonday: string,
  stepCap: number,
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
  return { minutes: Math.min(work.targetRunMin, stepCap), paused: current.isRecovery }
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

/** The restart floor week: its minutes, and whether the runner has a recent run to build on. */
export interface RestartFloor {
  minutes: number
  hasRecentRun: boolean
}

/**
 * The first week of a plan for a runner whose typical week is under the floor (sessions x session
 * length) starts at the floor instead [design-macro]: novice and return programmes begin at about
 * three sessions of 20-30 minutes, and the 10% ramp from a very small week never reaches a useful
 * volume. Tightened profiles (recent injury, bone stress history) are not lifted. The sessions
 * are plain runs when a run of the floor length was completed in the last 90 days, else run-walk.
 */
export function restartFloor(input: EngineInput, state: AthleteState): RestartFloor | null {
  const minutes = P.restartFloor.sessions.value * P.restartFloor.sessionMin.value
  if (state.typicalWeekMin <= 0 || state.typicalWeekMin >= minutes) return null
  if (weeklyRamp(state) < P.g2.rampSoft.value) return null
  const since = addDays(input.today, -P.restartFloor.lookbackDays.value)
  const hasRecentRun = input.activities.some(
    (a) =>
      (a.type === 'run' || a.type === 'race') &&
      !isDuplicate(a) &&
      a.date >= since &&
      a.date <= input.today &&
      a.durationSec >= P.restartFloor.sessionMin.value * 60,
  )
  return { minutes, hasRecentRun }
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
): WeekDraft[] {
  const firstMonday = mondayOf(input.today)
  const raceMonday = mondayOf(goal.date)
  if (goal.date < input.today) return []
  const total = daysBetween(firstMonday, raceMonday) / 7 + 1
  if (total < 1) return []

  const novice = state.experience === 'novice'
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
  const rampCtx: RampContext = {
    volumes,
    skip,
    // a restart floor week of the plan being replaced stays the baseline of the weeks after it
    floor: pastFloor(input, firstMonday),
    typicalWeekMin: state.typicalWeekMin,
    novice,
    tight: tightRamp(state),
  }
  /** The most a loading week may hold: the planning limit, at the athlete's own ramp. */
  const stepCap = (weekStart: string): number => {
    if (restartWeeks.has(weekStart)) return Infinity
    const lim = rampLimits(rampCtx, weekStart)
    if (lim === null) return Infinity
    if (lim.isFloorWeek) return floorEps(lim.plan)
    return floorEps(Math.min(lim.plan, rampStep(lim.base, ramp, novice)))
  }
  // the runs of the post-race weeks before the plan's first week are in the 30-day reference
  const runs: RunRecord[] = [...completedReference(input.activities, state).runs, ...lead.runs]
  const gains = weeklyGain(input.activities)
  const window = P.g1.windowDays.value
  /** The normal band of the runs within 30 days of every day the week can hold its long run. */
  const capsOf = (weekStart: string) => {
    const firstDay = weekStart < input.today ? input.today : weekStart
    return runCaps(referenceBetween(runs, addDays(weekStart, 6 - window), addDays(firstDay, -1)))
  }

  // Weekly targets, long runs, run days and gain for the pre-taper weeks
  // The floor lifts a small week to a useful one, which is growth; a hold keeps the current level.
  // A re-plan continues the plan it replaces; the restart floor lifts only a new plan, or a re-plan
  // whose continuation would sit below the floor.
  const continued = hold ? null : replanAnchor(input, state, firstMonday, stepCap(firstMonday))
  const floorWeek = hold ? null : restartFloor(input, state)
  const restart =
    floorWeek !== null && (continued === null || continued.minutes < floorWeek.minutes)
      ? floorWeek
      : null
  if (restart !== null) rampCtx.floor = { weekStart: firstMonday, minutes: restart.minutes }
  const anchored = restart === null ? continued : null
  const start =
    restart !== null
      ? restart.minutes
      : anchored !== null
        ? anchored.minutes
        : state.typicalWeekMin > 0
          ? state.typicalWeekMin
          : P.macroDesign.startFloorWeekMin.value
  const ceiling = Math.max(peakWeeklyMin(goal, pace), start)
  const peakLong = peakLongRunMin(goal, pace)
  const hasGain = goal.gainM > 0 && goal.distanceM > 0
  const gainPerKm = hasGain ? goal.gainM / (goal.distanceM / 1000) : 0
  const gainStep = P.h4.minStepGainM.value
  // A plain long run is prescribed at the middle of the zone 1 pace band when the zones carry pace
  // (sessions.ts), and otherwise takes the week's long-run distance at the training pace.
  const z1 = buildZones(input.profile, state, input.today).pace?.z1 ?? null
  const runPace = z1 === null ? pace : (z1[0] + z1[1]) / 2
  /** The long run's distance at the training pace, within the distance limit of the week. */
  const distanceOf = (minutes: number, caps: { distanceM: number }) => {
    if (minutes <= 0) return null
    const metres = Math.round((((minutes * 60) / pace) * 1000) / 100) * 100
    return Number.isFinite(caps.distanceM) ? Math.min(metres, Math.floor(caps.distanceM)) : metres
  }
  /** The distance the long run will carry: as prescribed, rounded to 100 m. */
  const carriedM = (minutes: number, metres: number | null) =>
    z1 === null ? metres : Math.round((((minutes * 60) / runPace) * 1000) / 100) * 100

  const target: number[] = []
  const longRun: number[] = []
  const longM: Array<number | null> = []
  const runDays: number[] = []
  const gain: Array<number | null> = []
  let lastWork = start
  // after an opening recovery week, the first work week continues the loading sequence it paused
  let haveWork = anchored?.paused === true
  let prevLong = floorEps(state.longest30d.durationSec / 60)
  let prevDays = 0
  let prevGain = Math.max(gainStep, floorTo10(state.longest30d.gainM))

  /** The week enters the ramp baselines, and its long run the 30-day reference. */
  const record = (i: number, weekStart: string, low: boolean) => {
    const t = target[i] as number
    volumes.set(weekStart, t)
    if (low) skip.add(weekStart)
    const g = gain[i] ?? null
    if (g !== null) gains.set(weekStart, g)
    const long = longRun[i] as number
    if (long > 0) {
      // dated on the first day the week can hold it, so the reference is never overstated
      const date = weekStart < input.today ? input.today : weekStart
      const longGain = g === null || t <= 0 ? null : Math.floor((g * long) / t)
      runs.push({
        date,
        min: long,
        distanceM: carriedM(long, longM[i] ?? null),
        gainM: longGain,
        lossM: longGain,
      })
    }
  }

  for (let i = 0; i < preCount; i++) {
    const ph = phases[i] as PhasePlan
    const weekStart = addDays(firstMonday, 7 * i)
    const caps = capsOf(weekStart)
    // rounded to 100 m, the distance may be 50 m above the minutes' own
    const distanceCapMin = Number.isFinite(caps.distanceM)
      ? floorEps(((caps.distanceM - 50) * runPace) / 60_000)
      : Infinity
    const longCap = Math.min(peakLong, caps.min, distanceCapMin)
    const rawLong = floorEps(start * share)
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
    const wanted = haveWork
      ? Math.min(ceiling, hold ? lastWork : floorEps(rampStep(lastWork, ramp, novice)))
      : start
    let t = Math.max(0, Math.min(wanted, stepCap(weekStart)))
    // the restart floor week holds its floor sessions [design-macro]
    const floorDays = i === 0 && restart !== null ? P.restartFloor.sessions.value : 0
    const days = Math.max(prevDays, daysFor(t), floorDays)
    // no run of the week is longer than the long run, so the week holds at most its run days at
    // the long run's limit [rules g-1, F5]
    if (Number.isFinite(longCap)) t = Math.min(t, days * longCap)
    haveWork = true
    lastWork = t
    target.push(t)

    const raw = floorEps(t * share)
    const held = hold && prevLong > 0 ? prevLong : Infinity
    const long = Math.max(0, Math.min(raw, longCap, held))
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

  // Strength: a heavy block in base and early build, then maintenance
  const requested =
    input.options.strengthSessions ??
    Math.min(P.flib.strengthPerWeek.value, input.profile.strengthPreference)
  const maintenance = Math.min(requested, P.e5.strengthMaintenancePerWeek.value)
  const nonSpecific = phases.filter((p, i) => i < preCount && p.phase !== 'specific').length
  const blockLen =
    nonSpecific >= P.e5.strengthBlockMinWeeks.value
      ? Math.min(P.e5.strengthBlockWeeks.value, nonSpecific)
      : 0

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
  if (restart !== null && preCount > 0) {
    flag(0, 'restart-floor')
    if (!restart.hasRecentRun) flag(0, 'run-walk')
  }

  const specificIdx = phases.map((p, i) => (p.phase === 'specific' ? i : -1)).filter((i) => i >= 0)
  if (goal.isUltra || goal.distanceClass === 'marathon') {
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

  // Assemble the weeks
  const weeks: WeekDraft[] = phases.map((ph, i) => {
    const t = target[i] as number
    const isTaperWeek = ph.phase === 'taper' || ph.phase === 'race'
    const days = runDays[i] as number
    let quality: number
    if (isTaperWeek) quality = P.k3.minQualitySessionsPerWeek.value
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
      focus: ph.isRecovery ? 'Recovery week: lighter volume, frequency kept' : FOCUS[ph.phase],
      targetRunMin: t,
      longRunMin: long,
      longRunM: long > 0 ? (longM[i] ?? null) : null,
      gainTargetM: gain[i] ?? null,
      runDays: days,
      qualitySessions: quality,
      strengthSessions: strength,
      tid: tidFor(ph.phase, goal, input.options.tidModel === 'polarized'),
      flags: [...(flagSets[i] ?? [])],
      isRecovery: ph.isRecovery,
      isTaper: isTaperWeek,
    }
  })

  // After the race: the H12 window, counted in days from the race and laid over the Monday weeks
  // after the race week. The days of the race week after the race carry no running.
  const afterRace = ownWindow(input)
  weeks.push(
    ...windowWeeks(afterRace, {
      weekStarts: windowMondays(afterRace, addDays(raceMonday, 7)),
      firstIndex: total,
      reference,
      referenceRunDays: refDays,
    }),
  )
  return weeks
}

/** A week counts as a window week when this many of its days come before the window ends. */
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
  const weeks = windowWeeks(past, { weekStarts, firstIndex: 0, reference, referenceRunDays })

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
  const lead = windowLeadIn(input, state, goal)
  if (lead === null) return planWeeks(input, state, goal, feasibility)
  const normalStart = addDays(mondayOf(input.today), 7 * lead.weeks.length)
  // The plan it replaces is not read: its weeks at the shifted start are weeks of the normal plan
  // and would anchor the restart above the J7 volume.
  const rest = planWeeks(
    { ...input, today: normalStart, existing: null },
    { ...state, typicalWeekMin: lead.restartMin },
    goal,
    feasibility,
    {
      volumes: new Map(lead.weeks.map((w) => [w.weekStart, w.targetRunMin])),
      runs: windowRuns(lead.window, lead.weeks),
      restart: normalStart,
    },
  )
  return [...lead.weeks, ...rest.map((w) => ({ ...w, index: w.index + lead.weeks.length }))]
}
