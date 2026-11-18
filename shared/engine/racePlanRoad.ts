// The race plan of a road goal (rule H15, ADR 0023). One pure function of the goal model, the live
// prediction, the same prediction without race heat, the runner's critical speed, the replayed fuel
// ladder, the body mass and the heat credit, evaluated on every read and stored nowhere, as the
// ultra plan is (rule H14, ADR 0018). It returns data: facts and the rule ids behind them. The words
// are `shared/copy/racePlanRoad.ts`.
//
// Which blocks a goal gets (ADR 0023, owner answers of 2026-11-16):
// - the half marathon and the marathon: time, pace, heat, fuel and fluid, race week; the marathon
//   adds the first-half line and the I5 finding;
// - the 10 km: time, pace and heat only;
// - a trail or mixed course: no pace and no first-half line (`course-not-flat`).
//
// What it does not do, on purpose: no split or pace per kilometre, no late-slowing size, no pacing
// shape (the range is already uniformly slower through I2), no heart rate or RPE, no rate above a
// tolerated rung and none for a race under `h7.logMinDurationMin`, no fuel timing, no hold fact of
// FT1 (those stay on the Fuel lab), no warm-up, no finish target. No Param of its own: every gate is
// an existing Param read anew.
//
// Pure: no clock, no I/O. `today` and the weather arrive as data.
import { daysBetween } from '../dates.ts'
import type { RaceHeatState } from '../domain/raceHeat.ts'
import type { ClimbBlend, GoalModel, LadderResult, Prediction } from './types.ts'
import type { RangeLabel, SupportLevel } from '../types.ts'
import { eahCard, isHotForFuel, raceFuelFor, type RaceFuel } from './fuel.ts'
import { goalPaceSecPerKm, startMinutes } from './goal.ts'
import { heatWarning, isHotForSteering } from './heat.ts'
import { P } from './params/index.ts'
import { rangeLabel } from './predict.ts'
import { clockAt, type RaceClock } from './raceClock.ts'
import {
  carbLineDays,
  raceWbgtIndex,
  raceWeekFor,
  type RaceWeek,
  type RaceWeekSession,
} from './racePlan.ts'

const SEC_PER_MIN = 60
const SEC_PER_HOUR = 3600
const M_PER_KM = 1000

/** The distance classes a road plan exists for (ADR 0023, Q1). */
export type RoadDistanceClass = '10k' | 'half' | 'marathon'

export interface RoadRacePlanInput {
  /** The goal model; `distanceClass` is `10k`, `half` or `marathon`. */
  goal: GoalModel
  supportLevel: SupportLevel
  /** The live prediction for the goal; null when the state supports no source. */
  prediction: Pick<
    Prediction,
    'predictedSec' | 'lowSec' | 'highSec' | 'rules' | 'trainingSince' | 'trainingWidened' | 'climb'
  > | null
  /**
   * The prediction of the same goal on the same snapshot, course and climb with no race heat (the
   * server builds both from one helper), in seconds; null with no prediction. It feeds only
   * `heat.inRangeSec`: the plan never adjusts the range for heat a second time.
   */
  coolPredictedSec: number | null
  /** The runner's critical speed (rule A6), or null when the state holds none. */
  cs: { mps: number; fromTraining: boolean; widened: boolean } | null
  ladder: LadderResult
  /** Body mass in kilograms from the profile; null when it holds none. */
  weightKg: number | null
  /** The heat acclimation credit from 0 to 1 as of `today`. */
  acclimationCredit: number
  /** The stored plan's sessions (see `RacePlanInput.raceWeekSessions`). */
  raceWeekSessions?: readonly RaceWeekSession[] | null
  /** Why the race climate is missing, or `known` (RH1); absent: the notice says only that it is missing. */
  heatState?: RaceHeatState
  /** The server's day. */
  today: string
}

/** Why the plan is thinner than it could be; the page says each in a line. */
export type RoadRaceNotice =
  /** No prediction: the goal's own expected duration stands in, labelled "about", with no pace line. */
  | 'no-prediction'
  | 'no-start-time'
  /** No race climate is cached yet: the plan says nothing about heat. */
  | 'no-climate'
  /** A marathon of the first-half line's length with no critical speed fitted. */
  | 'no-cs'
  /** The critical speed rests on efforts older than the 90-day window (A6): no first-half line. */
  | 'cs-dated'
  /** A trail or mixed course: no pace and no first-half line. */
  | 'course-not-flat'
  /** A half or marathon under `h7.logMinDurationMin`: the ladder gives no race rate. */
  | 'short-for-ladder'
  /** The race WBGT is above `i3.slopeStartC` but the prediction holds no heat adjustment. */
  | 'heat-not-in-range'

export interface RoadExpected {
  basis: 'prediction' | 'estimate'
  /** The ends of the prediction's range in seconds, unrounded (the copy rounds as Today's countdown does). */
  lowSec: number
  highSec: number
  /** The most likely time; the goal's expected duration for an estimate. */
  midSec: number
  /** `HH:MM`, or null without a valid start time. */
  start: string | null
  /** The clock at the two ends of the range; null without a start time. */
  finish: { from: RaceClock; to: RaceClock } | null
  /** The first day of the window when the prediction stands on a critical speed from training (A6). */
  trainingSince: string | null
  /** True when that fit needed efforts older than the 90-day window (A6): no "at most". */
  trainingWidened: boolean
  range: RangeLabel
  /** The runner's own climbing moved the prediction (rule L5); null otherwise. */
  climb: ClimbBlend | null
  rules: string[]
}

export interface RoadHeat {
  /** The climate normal for the race date; null while the race's climate is not cached. */
  wbgtC: number | null
  /** Always `climate-normal`: the plan reads no forecast. */
  source: 'climate-normal'
  /** Why `wbgtC` is null (RH1): no place to read it for, or a place not read yet. Absent when unknown to the builder. */
  state?: RaceHeatState
  /**
   * The seconds of the range that come from the usual weather for the date: the prediction minus the
   * same prediction without race heat. Null when the prediction holds no heat adjustment (no I2 in
   * its rules) or when either time is missing; 0 when the adjustment is zero.
   */
  inRangeSec: number | null
  /** The WBGT is above `i3.slopeStartC`. */
  warm: boolean
  /** Hot for steering (`isHotForSteering`, the predicate the ultra plan uses): the cooling line of I8 shows. */
  hot: boolean
  /** The WBGT is above `i9.warnWbgtC` (`heatWarning`), past the range of the penalty model. */
  aboveModel: boolean
  /** A marathon above `i3.slopeStartC`: the I5 pair (Ely 2008) and the medical-records line (Roberts 2010). */
  paceShapeFinding: boolean
  /** The prediction holds the heat adjustment (I2): its range is already slower for heat. */
  rangeHoldsHeat: boolean
  rules: string[]
}

export interface RoadRacePlan {
  goalId: string
  name: string
  date: string
  daysToRace: number
  distanceClass: RoadDistanceClass
  distanceM: number
  gainM: number
  surface: GoalModel['surface']
  supportLevel: SupportLevel
  expected: RoadExpected
  /** The goal time and its pace, for a time goal; a plain fact beside the range, never compared with it. */
  goal: { timeSec: number; paceSecPerKm: number } | null
  /** The range over the distance, an average over the race; null off a road or track course or with no prediction. */
  pace: { fastSecPerKm: number; slowSecPerKm: number; rules: string[] } | null
  /** The population finding of K6 with the runner's figure; null unless every gate holds (see below). */
  firstHalf: {
    /** `1000 / (k6.firstHalfWarningCsFraction x csMps)`: the average pace of a first half at that fraction. */
    secPerKm: number
    csFraction: number
    /** The critical speed is a floor from training (A6): the figure is slower than with the true one. */
    fromTraining: boolean
    rules: string[]
  } | null
  heat: RoadHeat
  /** The tolerated rung for a race of `h7.logMinDurationMin` or more; null for a shorter one and for a 10 km. */
  fuel: (RaceFuel & { rules: string[] }) | null
  /** The H8 reference range; null for a 10 km. */
  fluid: { referenceMlPerH: [number, number]; rules: string[] } | null
  /** The stronger safety card: over `n7.eahStrongerAlertHours` hours, or in heat; false for a 10 km. */
  eahStronger: boolean
  /** The K6 block, measured on `goal.expectedDurationSec`; null for a 10 km and under the threshold. */
  raceWeek: RaceWeek | null
  notices: RoadRaceNotice[]
  /** Every rule id behind the plan, once, in order. */
  rules: string[]
}

/**
 * What Today carries in race week: the days to the viewed race, the race-week block, the expected
 * time, and the fuel block the race-day sheet shows. Cut from the plan, never recomputed.
 */
export interface RoadRacePlanSummary {
  goalId: string
  name: string
  date: string
  supportLevel: SupportLevel
  distanceClass: Exclude<RoadDistanceClass, '10k'>
  /** Days from the viewed day to the race. */
  daysToRace: number
  /** The K6 line is shown: the viewed day is inside the final window or on the race day. */
  carbLineDue: boolean
  expected: RoadExpected
  raceWeek: RoadRacePlan['raceWeek']
  fuel: RoadRacePlan['fuel']
  fluid: NonNullable<RoadRacePlan['fluid']>
  eahStronger: boolean
}

/** Whether `goal` is one the road plan covers. */
export function isRoadPlanClass(
  distanceClass: GoalModel['distanceClass'],
): distanceClass is RoadDistanceClass {
  return distanceClass === '10k' || distanceClass === 'half' || distanceClass === 'marathon'
}

function expectedOf(input: RoadRacePlanInput): RoadExpected {
  const { goal, prediction } = input
  const start = startMinutes(goal.startTime) === null ? null : goal.startTime
  const startMin = startMinutes(start)
  const midSec = prediction === null ? goal.expectedDurationSec : prediction.predictedSec
  const lowSec = prediction === null ? midSec : prediction.lowSec
  const highSec = prediction === null ? midSec : prediction.highSec
  const range = rangeLabel({ distanceM: goal.distanceM })
  return {
    basis: prediction === null ? 'estimate' : 'prediction',
    lowSec,
    highSec,
    midSec,
    start,
    finish:
      startMin === null
        ? null
        : { from: clockAt(startMin, lowSec), to: clockAt(startMin, highSec) },
    trainingSince: prediction?.trainingSince ?? null,
    trainingWidened: prediction?.trainingWidened === true,
    range,
    climb: prediction?.climb ?? null,
    rules: ['H15', ...(prediction?.climb ? ['L5'] : []), ...range.rules],
  }
}

/** The race plan for a 10 km, half marathon or marathon goal (rule H15). Throws RangeError for any other goal. */
export function roadRacePlanFor(input: RoadRacePlanInput): RoadRacePlan {
  const { goal, prediction } = input
  const distanceClass = goal.distanceClass
  if (!isRoadPlanClass(distanceClass)) {
    throw new RangeError('roadRacePlanFor needs a 10 km, half marathon or marathon goal')
  }
  const longRace = distanceClass !== '10k'
  const flatCourse = goal.surface === 'road' || goal.surface === 'track'
  const expected = expectedOf(input)
  const wbgt = goal.raceWbgtC
  const wbgtIndex = raceWbgtIndex(goal)
  const hotForFuel = isHotForFuel(wbgtIndex)
  const notices: RoadRaceNotice[] = []

  const goalLine = goalPaceSecPerKm(goal)
  const goalOut =
    goalLine === null || goal.targetTimeSec === null
      ? null
      : { timeSec: goal.targetTimeSec, paceSecPerKm: goalLine }

  const km = goal.distanceM / M_PER_KM
  const pace =
    prediction === null || !flatCourse || !(km > 0)
      ? null
      : {
          fastSecPerKm: expected.lowSec / km,
          slowSecPerKm: expected.highSec / km,
          rules: ['H15', 'L6', 'K6'],
        }

  // First half: a marathon on a flat course whose expected time reaches the CS prior's own long-race
  // anchor, with a critical speed that is not from a widened window. The figure is the fixed K6 line
  // applied to the runner's CS; it is not tied to the expected pace (ADR 0023, Q10).
  let firstHalf: RoadRacePlan['firstHalf'] = null
  const firstHalfApplies =
    distanceClass === 'marathon' &&
    flatCourse &&
    prediction !== null &&
    expected.midSec / SEC_PER_MIN >= P.l2.csFractionShortMin.value
  if (firstHalfApplies) {
    if (input.cs === null) notices.push('no-cs')
    else if (input.cs.widened) notices.push('cs-dated')
    else {
      const fraction = P.k6.firstHalfWarningCsFraction.value
      firstHalf = {
        secPerKm: M_PER_KM / (fraction * input.cs.mps),
        csFraction: fraction,
        fromTraining: input.cs.fromTraining,
        rules: ['K6', 'A6'],
      }
    }
  }

  const heatRules = prediction?.rules.includes('I2') === true
  const warm = wbgt !== null && wbgt > P.i3.slopeStartC.value
  const hot = isHotForSteering(wbgtIndex, [])
  const heat: RoadHeat = {
    wbgtC: wbgt,
    source: 'climate-normal',
    ...(input.heatState === undefined ? {} : { state: input.heatState }),
    inRangeSec:
      prediction === null || input.coolPredictedSec === null || !heatRules
        ? null
        : Math.max(0, prediction.predictedSec - input.coolPredictedSec),
    warm,
    hot,
    aboveModel: wbgt !== null && heatWarning(wbgt) !== null,
    paceShapeFinding: distanceClass === 'marathon' && warm,
    rangeHoldsHeat: prediction !== null && heatRules,
    rules: [
      'I2',
      'I3',
      ...(wbgt !== null && heatWarning(wbgt) !== null ? ['I9'] : []),
      ...(distanceClass === 'marathon' && warm ? ['I5'] : []),
      ...(hot ? ['I8'] : []),
    ],
  }

  // Fuel: the tolerated rung, only for a race the ladder's own runs are as long as (rule H7).
  const expectedForFuelSec = expected.midSec
  const fuelApplies = longRace && expectedForFuelSec >= P.h7.logMinDurationMin.value * SEC_PER_MIN
  const fuel = fuelApplies
    ? {
        ...raceFuelFor(input.ladder, { hot: hotForFuel, expectedSec: expectedForFuelSec }),
        rules: ['H7', 'H15'],
      }
    : null
  const fluid = longRace
    ? { referenceMlPerH: [...P.h8.fluidReferenceMlPerH.value] as [number, number], rules: ['H8'] }
    : null
  const eahStronger = longRace
    ? eahCard({ eventHours: expectedForFuelSec / SEC_PER_HOUR, hot: hotForFuel }).stronger
    : false

  // Race week: measured on the goal's expected duration, the quantity the plan's own shake-out reads.
  const raceWeek = longRace
    ? raceWeekFor({
        goal,
        expectedMin: goal.expectedDurationSec / SEC_PER_MIN,
        weightKg: input.weightKg,
        wbgtC: wbgt,
        acclimationCredit: input.acclimationCredit,
        sessions: input.raceWeekSessions,
      })
    : null

  if (prediction === null) notices.push('no-prediction')
  if (expected.start === null) notices.push('no-start-time')
  if (wbgt === null) notices.push('no-climate')
  if (!flatCourse) notices.push('course-not-flat')
  if (longRace && !fuelApplies) notices.push('short-for-ladder')
  if (warm && prediction !== null && !heatRules) notices.push('heat-not-in-range')

  const blocks = [
    expected.rules,
    pace?.rules ?? [],
    firstHalf?.rules ?? [],
    heat.rules,
    fuel?.rules ?? [],
    fluid?.rules ?? [],
    raceWeek?.rules ?? [],
  ]
  return {
    goalId: goal.goalId,
    name: goal.name,
    date: goal.date,
    daysToRace: daysBetween(input.today, goal.date),
    distanceClass,
    distanceM: goal.distanceM,
    gainM: goal.gainM,
    surface: goal.surface,
    supportLevel: input.supportLevel,
    expected,
    goal: goalOut,
    pace,
    firstHalf,
    heat,
    fuel,
    fluid,
    eahStronger,
    raceWeek,
    notices,
    rules: [...new Set(['H15', ...blocks.flat()])],
  }
}

/**
 * The Today view of a plan for the viewed day, or null outside race week (`r1.raceWeekCardDays` days
 * before the race, the race day included) and for a 10 km, which has no race week, fuel or fluid to
 * show beyond what the countdown already says. Cut from the plan: the same objects.
 */
export function roadSummaryOf(plan: RoadRacePlan, date: string): RoadRacePlanSummary | null {
  const daysToRace = daysBetween(date, plan.date)
  if (daysToRace < 0 || daysToRace > P.r1.raceWeekCardDays.value) return null
  if (plan.distanceClass === '10k' || plan.fluid === null) return null
  return {
    goalId: plan.goalId,
    name: plan.name,
    date: plan.date,
    supportLevel: plan.supportLevel,
    distanceClass: plan.distanceClass,
    daysToRace,
    carbLineDue: daysToRace <= carbLineDays(),
    expected: plan.expected,
    raceWeek: plan.raceWeek,
    fuel: plan.fuel,
    fluid: plan.fluid,
    eahStronger: plan.eahStronger,
  }
}
