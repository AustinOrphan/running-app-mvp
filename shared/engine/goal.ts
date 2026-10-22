// Goal model and feasibility [rules section d]. Pure: no I/O, no clock; `today` is an argument.
import { daysBetween, mondayOf } from '../dates.ts'
import type { Goal } from '../types.ts'
import { P } from './params/index.ts'
import { predictFromState } from './predict.ts'
import type { AthleteState, EngineWarning, Feasibility, GoalModel } from './types.ts'

const SEC_PER_MIN = 60
const SEC_PER_HOUR = 3600
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

function meanWeeklyKm(state: AthleteState, today: string, weeks: number): number {
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

/**
 * comfortable, tight or not reachable within default limits; never refuses [rules D3-D5].
 * D4: weeks needed = ceil(ln(Lt / L0) / ln(1.10)) x 4/3 (cutbacks) plus the taper, where L0 is the
 * 30-day longest run and Lt the target long run; the weekly floor of a time goal uses the same
 * formula on the recent weekly distance, and the longer of the two governs.
 */
export function feasibility(goal: GoalModel, state: AthleteState, today: string): Feasibility {
  const notes: EngineWarning[] = []
  const weeksAvailable = Math.max(0, Math.floor(daysBetween(today, goal.date) / DAYS_PER_WEEK))

  // Target long run. Ultras count time on feet (H2); shorter goals count distance (D3).
  let longRunWeeks: number
  if (goal.isUltra) {
    const classTarget =
      goal.distanceClass in P.d4LongRun
        ? P.d4LongRun[goal.distanceClass as keyof typeof P.d4LongRun].value * SEC_PER_MIN
        : Infinity
    const capSec = Math.min(
      classTarget,
      P.h2.longestRunCapHours.value * SEC_PER_HOUR,
      P.h2.longestRunCapRaceFraction.value * goal.expectedDurationSec,
    )
    const current = Math.max(
      state.longest30d.durationSec,
      P.g2.noviceMinStepMin.value * SEC_PER_MIN,
    )
    longRunWeeks = growthWeeks(current, capSec)
  } else {
    const targetM =
      goal.distanceClass === 'half'
        ? P.d3.halfMinLongRunKm.value * M_PER_KM
        : goal.distanceClass === 'marathon'
          ? P.d3.marathonMinLongRunKm.value * M_PER_KM
          : Math.min(goal.distanceM, P.d3.typicalSessionKm.value * M_PER_KM)
    const current = Math.max(state.longest30d.distanceM, P.g1.minStepDistanceM.value)
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
    const currentKm = Math.max(
      meanWeeklyKm(state, today, 4),
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

  const growth = Math.max(longRunWeeks, weeklyWeeks)
  const weeksNeeded = Math.ceil(
    growth * P.d4.cutbackFactor.value + taperWeeks(goal.distanceClass) - EPSILON,
  )

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
