// Goal model and feasibility [rules section d]. Pure: no I/O, no clock; `today` is an argument.
import { daysBetween, mondayOf } from '../dates.ts'
import type { Goal } from '../types.ts'
import { startWeekMin, ultraRunCapMin } from './limits.ts'
import { effective } from './methods.ts'
import { P } from './params/index.ts'
import { predictFromState } from './predict.ts'
import { rungCount, startWeek, type StartPath } from './startWeeks.ts'
import type { AthleteState, EngineWarning, Feasibility, GoalModel, PresetId } from './types.ts'

const SEC_PER_MIN = 60
const MIN_PER_HOUR = 60
const DAYS_PER_WEEK = 7
const M_PER_KM = 1000
const EPSILON = 1e-9

type DistanceClass = GoalModel['distanceClass']

/** D1: the descriptor class of a distance in metres. */
export function distanceClassOf(distanceM: number): DistanceClass {
  if (distanceM <= P.d1Class.fiveKmUpperM.value) return '5k'
  if (distanceM <= P.d1Class.tenKmUpperM.value) return '10k'
  if (distanceM <= P.d1Class.halfUpperM.value) return 'half'
  if (distanceM <= P.d1.ultraAboveM.value) return 'marathon'
  if (distanceM <= P.d1Class.ultra50UpperM.value) return 'ultra50'
  if (distanceM <= P.d1Class.ultra100kUpperM.value) return 'ultra100k'
  if (distanceM <= P.d1Class.ultra100miUpperM.value) return 'ultra100mi'
  return 'beyond'
}

/** Minutes after midnight for 'HH:MM', or null when the string is not a valid start time. */
function startMinutes(startTime: string | null): number | null {
  if (startTime === null) return null
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startTime)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * D1/H6: whether the race runs partly in darkness. Known start: it starts before dawn or is
 * still running after dusk. Unknown start: any race longer than the daylight window.
 */
function crossesDarkness(startTime: string | null, durationSec: number): boolean {
  const dawnMin = P.d1Dark.dawnHour.value * 60
  const duskMin = P.d1Dark.duskHour.value * 60
  const start = startMinutes(startTime)
  const durationMin = durationSec / SEC_PER_MIN
  if (start === null) return durationMin > duskMin - dawnMin
  return start < dawnMin || start + durationMin > duskMin
}

/** Expected duration: prediction, else the time goal's target, else the pace prior [rules D1, L1]. */
function expectedDuration(
  distanceM: number,
  gainM: number,
  targetTimeSec: number | null,
  prediction: { predictedSec: number } | null,
): number {
  if (prediction) return prediction.predictedSec
  if (targetTimeSec !== null && targetTimeSec > 0) return targetTimeSec
  const flatKm = (distanceM + Math.max(0, gainM) * P.l5.gainEquivalentM.value) / M_PER_KM
  const pace =
    distanceM > P.d1.ultraAboveM.value
      ? P.d1Prior.ultraPaceSecPerKm.value
      : P.d1Prior.paceSecPerKm.value
  return Math.round(flatKm * pace)
}

/**
 * Goal descriptors, distance class, expected duration and darkness [rules section d].
 * Throws RangeError when the goal has no distance: a plan cannot be built without one.
 */
export function goalModel(
  goal: Goal,
  state: AthleteState,
  climate: { wbgtC: number; source: 'forecast' | 'climatology' } | null,
): GoalModel {
  const distanceM = goal.distanceM
  if (distanceM === null || !(distanceM > 0)) {
    throw new RangeError('goalModel needs a goal with a positive distance')
  }
  const gainM = goal.gainM ?? 0
  const lossM = goal.lossM ?? 0
  const wbgtC = climate?.wbgtC ?? null
  // D2: from 100 miles the default is finish-first; a time goal without a target time is that default.
  const goalType: GoalModel['goalType'] =
    goal.goalType === 'time' &&
    goal.targetTimeSec === null &&
    distanceM >= P.d2.finishFirstFromM.value
      ? 'finish'
      : goal.goalType
  const prediction = predictFromState(state, { distanceM, gainM, surface: goal.surface, wbgtC })
  const expectedDurationSec = expectedDuration(distanceM, gainM, goal.targetTimeSec, prediction)
  const startTime = startMinutes(goal.startTime) === null ? null : goal.startTime

  return {
    goalId: goal.id,
    name: goal.name,
    date: goal.targetDate,
    distanceM,
    gainM,
    lossM,
    surface: goal.surface,
    goalType,
    targetTimeSec: goal.targetTimeSec,
    startTime,
    isUltra: distanceM > P.d1.ultraAboveM.value,
    distanceClass: distanceClassOf(distanceM),
    expectedDurationSec,
    crossesDarkness: crossesDarkness(startTime, expectedDurationSec),
    raceWbgtC: wbgtC,
  }
}

/** Weeks to grow from `from` to `to` at the soft weekly growth, before cutbacks [D4]. */
function growthWeeks(from: number, to: number): number {
  if (!(to > from)) return 0
  return Math.ceil(Math.log(to / from) / Math.log(P.d4.weeklyGrowth.value) - EPSILON)
}

/** The last `count` completed weeks (the current, partial week is left out). */
function completedWeeks(state: AthleteState, today: string, count: number) {
  const thisMonday = mondayOf(today)
  return state.weeks.filter((w) => w.weekStart < thisMonday).slice(-count)
}

/** The mean weekly distance of the last `weeks` completed weeks, in km. */
export function meanWeeklyKm(state: AthleteState, today: string, weeks: number): number {
  const rows = completedWeeks(state, today, weeks)
  if (rows.length === 0) return 0
  return rows.reduce((sum, w) => sum + w.runM, 0) / rows.length / M_PER_KM
}

/** Taper weeks by distance class, from the section k lengths [K1]. */
function taperWeeks(distanceClass: DistanceClass): number {
  const days = {
    '5k': P.k1.fiveKmDays.value,
    '10k': P.k1.tenKmDays.value,
    half: P.k1.halfMarathonDays.value,
    marathon: P.k1.marathonDays.value,
    ultra50: P.k1.ultra50to100kDays.value,
    ultra100k: P.k1.ultra50to100kDays.value,
    ultra100mi: P.k1.ultra100miDays.value,
    beyond: P.k1.ultra100miDays.value,
  }[distanceClass]
  return Math.ceil(days / DAYS_PER_WEEK)
}

/** The median of a list; 0 for an empty one. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const hi = sorted[mid] ?? 0
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? hi) + hi) / 2
}

/**
 * The median of the weekly paces over the last `macroDesign.trainingPaceWeeks` weeks, leaving out a
 * week without a run, in sec/km; null when no week of the window holds a run with a distance.
 */
export function recentWeeklyPace(state: Pick<AthleteState, 'weeks'>): number | null {
  const paces = state.weeks
    .slice(-P.macroDesign.trainingPaceWeeks.value)
    .filter((w) => w.runM > 0 && w.runMin > 0)
    .map((w) => (w.runMin * SEC_PER_MIN) / (w.runM / M_PER_KM))
  return paces.length > 0 ? median(paces) : null
}

/** Average training pace in sec/km: recent weeks, else the goal pace slowed, else a default. */
export function trainingPace(state: AthleteState, goal: GoalModel): number {
  const recent = recentWeeklyPace(state)
  if (recent !== null) return recent
  if (goal.expectedDurationSec > 0 && goal.distanceM > 0) {
    return (
      (goal.expectedDurationSec / (goal.distanceM / M_PER_KM)) *
      P.macroDesign.trainingPaceFactor.value
    )
  }
  return P.macroDesign.defaultEasyPaceSecPerKm.value
}

/** Minutes of running that cover `km` at the training pace. */
const minutesFor = (km: number, paceSecPerKm: number) =>
  Math.ceil((km * paceSecPerKm) / SEC_PER_MIN)

/** The weekly-minutes ceiling for the goal: the class peak, lifted to the D3 floor for time goals. */
export function peakWeeklyMin(goal: GoalModel, pace: number): number {
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

/**
 * The long-run tier of a 5 km or 10 km goal [rules D7]: 0 below the first boundary of
 * `macroDesign.longRunTierWeeklyMin`, 1 up to and including the second, 2 above it. It is read from
 * the completed typical week, never from a planned one, so a plan cannot lift its own cap.
 */
function longRunTier(state: AthleteState): 0 | 1 | 2 {
  const [low, high] = P.macroDesign.longRunTierWeeklyMin.value
  if (state.typicalWeekMin < low) return 0
  return state.typicalWeekMin <= high ? 1 : 2
}

/**
 * Longest planned run in minutes. 5 km and 10 km goals take the tier of the completed typical week
 * and stop at the minutes that 16 km takes at `longRunPace`, the pace the long run is carried at
 * [rules D7]; `pace` is the training pace, which turns the D3 floors of a half-marathon or marathon
 * time goal into minutes. Ultras are capped by the lesser of 6 h and 60% of the race [H2].
 */
export function peakLongRunMin(
  goal: GoalModel,
  pace: number,
  state: AthleteState,
  longRunPace = pace,
): number {
  const table = P.peakLongRunMin[goal.distanceClass].value
  let peak: number
  if (typeof table === 'number') {
    peak = table
  } else {
    const kmMin = Math.floor(
      (P.macroDesign.peakLongRunKmMax.value * longRunPace) / SEC_PER_MIN + EPSILON,
    )
    peak = Math.min(table[longRunTier(state)], kmMin)
  }
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

/** The long run of a half-marathon or marathon goal against its D3 floor [rules D3, D4]. */
export interface LongRunFloor {
  /** The D3 floor, in km. */
  floorKm: number
  /** The longest long run the planner schedules at its peak, in minutes and in km at the training pace. */
  plannedMin: number
  plannedKm: number
  /** Whether the planner schedules a long run of the floor. */
  reached: boolean
  /** The long run the check works toward, in metres: the floor, or the planned run when it is shorter. */
  targetM: number
}

/**
 * The long run the check works toward for a half marathon or a marathon: the D3 floor, or the long
 * run the planner can schedule when that is shorter. The planner's long run is the lesser of
 * `peakLongRunMin` and the long-run share of the larger of the class peak week and the start week,
 * in minutes at the training pace, so the check never counts weeks toward a run the plan does not
 * build [rules D3, D4]. Null for the other classes, which have no long-run floor. The share is the
 * one the plan's method preset gives (`method`, the preset that applies: `resolveMethod`; the
 * default when absent), so the label reads the long run the plan builds.
 */
export function longRunFloor(
  goal: GoalModel,
  state: AthleteState,
  start?: StartPath | null,
  method: PresetId = 'default',
): LongRunFloor | null {
  const floorKm =
    goal.distanceClass === 'half'
      ? P.d3.halfMinLongRunKm.value
      : goal.distanceClass === 'marathon'
        ? P.d3.marathonMinLongRunKm.value
        : null
  if (floorKm === null) return null
  const pace = trainingPace(state, goal)
  const weekMin = Math.max(peakWeeklyMin(goal, pace), startWeekMin(state, start))
  const plannedMin = Math.min(
    peakLongRunMin(goal, pace, state),
    Math.floor(effective(method, 'macroDesign.longRunShareOfWeek') * weekMin + EPSILON),
  )
  const plannedKm = (plannedMin * SEC_PER_MIN) / pace
  const reached = plannedMin >= minutesFor(floorKm, pace)
  return {
    floorKm,
    plannedMin,
    plannedKm,
    reached,
    targetM: (reached ? floorKm : plannedKm) * M_PER_KM,
  }
}

/**
 * What the start of a plan adds to the long-run path of a goal that is not an ultra [rules E6, g-3,
 * J7]: the weeks of its programme still ahead, and the long run the plan has once they are over.
 * The 3 x N floor has that run at once (N minutes). A plan without a start path and without a run in
 * the last 30 days has no G-1 reference; it opens with its long-run share of the start week, the
 * typical week or the restart volume after a break, as the generator does. With a run in the window
 * that run is the start, as the generator holds its first long run to 1.10 times it. A ladder or
 * injury-return programme counts its last session (the 30 minutes of the last rung, the last level)
 * only after its weeks, which have no recovery week inside them.
 */
function startReach(
  state: AthleteState,
  start: StartPath | null | undefined,
  method: PresetId,
): { weeks: number; reachMin: number } {
  if (start === undefined || start === null) {
    const { distanceM, durationSec } = state.longest30d
    if (distanceM > 0 || durationSec > 0) return { weeks: 0, reachMin: 0 }
    const weekMin = startWeekMin(state, start)
    return {
      weeks: 0,
      reachMin: Math.floor(effective(method, 'macroDesign.longRunShareOfWeek') * weekMin + EPSILON),
    }
  }
  if (start.kind === 'floor') return { weeks: 0, reachMin: start.sessionMin }
  if (start.kind === 'ladder') {
    const held = start.bmiHold ? P.noviceLadder.bmiHoldWeeks.value - 1 : 0
    return {
      weeks: rungCount() - start.rung + 1 + held,
      reachMin: startWeek('ladder', rungCount()).longest,
    }
  }
  const levels = P.injuryReturn.levelsMin.value
  return { weeks: levels.length - start.level, reachMin: levels[levels.length - 1] ?? 0 }
}

/**
 * The long run, in whole minutes, that the feasibility check of an ultra works toward [rules D4]:
 * the least of the class value, the H2 cap (6 h), its race fraction (60% of the expected duration)
 * and the planner's long-run share of the larger of the class peak week and the start week, so the
 * check never counts weeks toward a run the planner would not schedule.
 */
export function ultraLongRunTargetMin(
  goal: GoalModel,
  state: AthleteState,
  start?: StartPath | null,
): number {
  const known = goal.distanceClass in P.d4LongRun
  const cls = goal.distanceClass as keyof typeof P.d4LongRun
  const caps = [
    known ? P.d4LongRun[cls].value : Infinity,
    P.h2.longestRunCapHours.value * MIN_PER_HOUR,
    (P.h2.longestRunCapRaceFraction.value * goal.expectedDurationSec) / SEC_PER_MIN,
  ]
  if (known) {
    const weekMin = Math.max(P.peakWeeklyMin[cls].value, startWeekMin(state, start))
    caps.push(P.macroDesign.longRunShareOfWeekUltra.value * weekMin)
  }
  return Math.floor(Math.min(...caps) + EPSILON)
}

/**
 * The weeks the plan holds up to the race [rule D4]: the Monday weeks from the one that contains
 * `today` (the week in progress is week 1) through the one that contains the race, race week
 * included. The generator opens on `mondayOf(today)` and ends with the race week (`planWeeks`,
 * macro.ts), and `weeksNeeded` counts the same weeks, so the label and the plan agree. 0 when the
 * race date is before `today`. The `+ 1` counts the race week as well as the Mondays between: it is
 * arithmetic, not a tuned value.
 */
export function planWeeksAvailable(today: string, raceDate: string): number {
  if (raceDate < today) return 0
  return daysBetween(mondayOf(today), mondayOf(raceDate)) / DAYS_PER_WEEK + 1
}

/**
 * comfortable, tight or not reachable within default limits; never refuses [rules D3-D5].
 * D4: weeks needed = ceil(ln(Lt / L0) / ln(1.10)) x 4/3 (cutbacks) plus the taper, where L0 is the
 * 30-day longest run and Lt the target long run; the weekly floor of a time goal uses the same
 * formula on the recent weekly distance, and the longer of the two governs. An ultra also grows its
 * weekly running time from the start week to the class peak, and the slower path labels it. The
 * start week is the first week of `start`, the start path of the plan (`startPath`, macro.ts).
 * The inputs follow the plan: L0 is at least the first session of the start path, a ladder or an
 * injury-return programme adds its remaining weeks and counts its last session only after them, the
 * weekly floor grows from the start week, and the Lt of a half or marathon is the D3 floor or the
 * long run the planner schedules when that is shorter (`longRunFloor`).
 * The weeks available are the plan's own Monday weeks, the current week through the race week
 * (`planWeeksAvailable`), the same weeks `weeksNeeded` counts.
 * `method` is the preset that applies to the plan (`resolveMethod`), read for the long-run share.
 * A label only: it changes no limit and no session.
 */
export function feasibility(
  goal: GoalModel,
  state: AthleteState,
  today: string,
  start?: StartPath | null,
  method: PresetId = 'default',
): Feasibility {
  const notes: EngineWarning[] = []
  const weeksAvailable = planWeeksAvailable(today, goal.date)

  // Target long run. Ultras count time on feet (H2); shorter goals count distance (D3). The pace
  // that turns the planner's minutes into distance is the training pace of the generator.
  const pace = trainingPace(state, goal)
  let longRunWeeks: number
  // Weeks of a start programme before the long run can grow; they have no cutback week inside.
  let leadWeeks = 0
  if (goal.isUltra) {
    const current = Math.max(
      state.longest30d.durationSec,
      P.g2.noviceMinStepMin.value * SEC_PER_MIN,
    )
    longRunWeeks = growthWeeks(current, ultraLongRunTargetMin(goal, state, start) * SEC_PER_MIN)
  } else {
    // D3/D4: a half or marathon works toward the D3 floor, or the long run the planner schedules
    // when that is shorter; the other classes toward the race distance, at most a typical session.
    const floor = longRunFloor(goal, state, start, method)
    const targetM =
      floor?.targetM ?? Math.min(goal.distanceM, P.d3.typicalSessionKm.value * M_PER_KM)
    if (floor !== null && !floor.reached && goal.goalType === 'time') {
      notes.push({
        code: 'long-run-floor',
        severity: 'info',
        message: `A ${goal.distanceClass === 'half' ? 'half-marathon' : 'marathon'} time goal asks for a long run above ${floor.floorKm} km. The plan builds up to about ${floor.plannedMin} minutes (${floor.plannedKm.toFixed(1)} km at the training pace) within its weekly time, so the outlook counts the weeks to that run.`,
        rules: ['D3'],
      })
    }
    // E6: the plan starts from its first session, and a ladder reaches its last rung after its weeks.
    const reach = startReach(state, start, method)
    leadWeeks = reach.weeks
    const startM = ((reach.reachMin * SEC_PER_MIN) / pace) * M_PER_KM
    const current = Math.max(state.longest30d.distanceM, P.g1.minStepDistanceM.value, startM)
    longRunWeeks = growthWeeks(current, targetM)
  }

  // Weekly volume floor, time goals only (D2, D3).
  let weeklyWeeks = 0
  const floorKm =
    goal.goalType === 'time'
      ? goal.distanceClass === 'half'
        ? P.d3.halfMinWeeklyKm.value
        : goal.distanceClass === 'marathon'
          ? P.d3.marathonMinWeeklyKm.value
          : null
      : null
  if (floorKm !== null) {
    // the weekly path grows from the week the plan starts at, in km at the training pace (E6, J7)
    const startKm = (startWeekMin(state, start) * SEC_PER_MIN) / pace
    const currentKm = Math.max(
      meanWeeklyKm(state, today, P.d3.weeklyFloorWeeks.value),
      startKm,
      P.g1.minStepDistanceM.value / M_PER_KM,
    )
    weeklyWeeks = growthWeeks(currentKm, floorKm)
    if (weeklyWeeks > 0) {
      notes.push({
        code: 'weekly-floor',
        severity: 'info',
        message: `A ${goal.distanceClass === 'half' ? 'half-marathon' : 'marathon'} time goal works toward ${floorKm} km per week, reached only within the weekly ramp limits.`,
        rules: ['D3'],
      })
    }
  }

  // D4, ultras: weekly running time grows from the start week at the weekly ramp to the week
  // that carries the target long run at the ultra long-run share, capped at the class peak. The
  // class peak itself is a ceiling the plan may never reach, not a requirement, so it is not the
  // target. The start week is the one the generator starts from, so the label matches the plan.
  if (goal.isUltra && goal.distanceClass in P.d4LongRun) {
    const peakMin = P.peakWeeklyMin[goal.distanceClass as keyof typeof P.d4LongRun].value
    const targetMin = Math.min(
      peakMin,
      Math.ceil(
        ultraLongRunTargetMin(goal, state, start) / P.macroDesign.longRunShareOfWeekUltra.value -
          EPSILON,
      ),
    )
    const startMin = startWeekMin(state, start)
    weeklyWeeks = growthWeeks(startMin, targetMin)
    if (weeklyWeeks > longRunWeeks) {
      notes.push({
        code: 'weekly-path',
        severity: 'info',
        message: `Weekly running time sets the pace for this goal: growing from about ${Math.round(startMin)} to ${targetMin} minutes a week within the ramp limits takes longer than building the long run. This only labels the outlook; the plan keeps every limit.`,
        rules: ['D4'],
      })
    }
  }

  // The growth weeks carry a cutback week in every cycle; the weeks of a start programme do not.
  const pathWeeks = Math.max(
    leadWeeks + longRunWeeks * P.d4.cutbackFactor.value,
    weeklyWeeks * P.d4.cutbackFactor.value,
  )
  const weeksNeeded = Math.ceil(pathWeeks + taperWeeks(goal.distanceClass) - EPSILON)

  let label: Feasibility['label']
  if (weeksAvailable >= weeksNeeded * P.d4Label.comfortableMargin.value - EPSILON) {
    label = 'comfortable'
  } else if (weeksAvailable >= weeksNeeded) {
    label = 'tight'
  } else {
    label = 'not-reachable'
  }

  if (label === 'tight') {
    notes.push({
      code: 'tight',
      severity: 'info',
      message: `About ${weeksNeeded} weeks fit the default ramp and ${weeksAvailable} are available, so there is little room for a lost week.`,
      rules: ['D4'],
    })
  } else if (label === 'not-reachable') {
    notes.push({
      code: 'not-reachable',
      severity: 'warn',
      message: `Within the default limits this goal needs about ${weeksNeeded} weeks and ${weeksAvailable} are available. The plan keeps every limit; a later race, a shorter distance or a finish-first goal would fit better.`,
      rules: ['D4'],
    })
  }

  // D5: ultra readiness notes, non-blocking.
  if (goal.isUltra) {
    const windowWeeks = P.d5.lowWeeklyWindowWeeks.value
    const avgKm = meanWeeklyKm(state, today, windowWeeks)
    if (avgKm < P.d5.lowWeeklyKm.value) {
      notes.push({
        code: 'ultra-low-weekly-distance',
        severity: 'info',
        message: `Average weekly distance over the last ${windowWeeks} weeks is ${Math.round(avgKm)} km, under ${P.d5.lowWeeklyKm.value} km. A note, not a limit.`,
        rules: ['D5'],
      })
    }
    const priorUltra = state.fitness.races.some((r) => r.distanceM > P.d1.ultraAboveM.value)
    if (
      !priorUltra &&
      state.yearsRunning !== null &&
      state.yearsRunning < P.d5.minYearsRunning.value
    ) {
      notes.push({
        code: 'ultra-few-years-running',
        severity: 'info',
        message: `Fewer than ${P.d5.minYearsRunning.value} years of regular running precede this first ultra. A note, not a limit; first-timer status alone is not a risk factor.`,
        rules: ['D5'],
      })
    }
  }

  // D6: hot race.
  if (goal.raceWbgtC !== null && goal.raceWbgtC >= P.d6.raceWbgtAcclimationC.value) {
    notes.push({
      code: 'heat-acclimation',
      severity: 'info',
      message: `Race-day WBGT is ${goal.raceWbgtC.toFixed(1)} C, so the plan includes a heat acclimation block.`,
      rules: ['D6'],
    })
  }

  return { label, weeksNeeded, weeksAvailable, notes }
}
