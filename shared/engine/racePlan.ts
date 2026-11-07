// The race plan of an ultra goal (rule H14, ADR 0018; design 2026-11-07, steps 2 and 3). One pure
// function of the goal model, the live prediction, the replayed fuel ladder, the zone 1 ceiling and
// the heat credit, evaluated on every read and stored nowhere, as the strength workout is
// (ADR 0014). It returns data: facts and the rule ids behind them. The words are
// `shared/copy/racePlan.ts`, so the page, the Today card and the session sheet cannot say
// different things.
//
// What it does not do, on purpose: no pace and no split (the corpus holds no study of pace by third
// or by segment, gaps R1 to R3), no time at an aid station (R2), no rate above a tolerated rung
// (G6, R4), no downhill credit (I11), no sleep advice (R5) and no comparison of a cutoff with the
// expected range. The checkpoint table and the splits of the design (step 4) would add a
// `checkpoints` input and a `splits` block; nothing here prevents them.
//
// Pure: no clock, no I/O. `today` and the weather arrive as data. Every number comes from `P`.
import { addDays, daysBetween } from '../dates.ts'
import type { RangeLabel, SupportLevel } from '../types.ts'
import { eahCard, isHotForFuel, raceFuelFor, type RaceFuel } from './fuel.ts'
import { startMinutes } from './goal.ts'
import { isHotForSteering } from './heat.ts'
import { shakeOutFor } from './micro.ts'
import { P } from './params/index.ts'
import { rangeLabel } from './predict.ts'
import type { GoalModel, LadderResult, Prediction } from './types.ts'

const SEC_PER_MIN = 60
const MIN_PER_HOUR = 60
const MIN_PER_DAY = 1440
const SEC_PER_HOUR = 3600
const HOURS_PER_DAY = 24

// ---------------------------------------------------------------------------------------------
// Input and output
// ---------------------------------------------------------------------------------------------

export interface RacePlanInput {
  goal: GoalModel
  supportLevel: SupportLevel
  /** The live prediction for the goal; null when the state supports no source. */
  prediction: Pick<Prediction, 'predictedSec' | 'lowSec' | 'highSec'> | null
  /**
   * The top of the current zone 1, the ceiling the race session of an ultra goal shows
   * (`resolveTargets`, rule H11); null when the zones hold no heart rate.
   */
  z1CeilingBpm: number | null
  ladder: LadderResult
  /** Body mass in kilograms from the profile; null when it holds none. */
  weightKg: number | null
  /** The heat acclimation credit from 0 to 1 as of `today` (`AthleteState.heatAcclimation`). */
  acclimationCredit: number
  /** The server's day. */
  today: string
}

/** A time of day on a race day: `day` 0 is the race date, 1 the day after. */
export interface RaceClock {
  /** `HH:MM`. */
  time: string
  day: number
}

/** Why the plan is thinner than it could be; the page says each in a line. */
export type RaceNotice =
  /** No prediction: the goal's own expected duration stands in, labelled "about". */
  | 'no-prediction'
  /** No start time: no clock windows, no dark hours. */
  | 'no-start-time'
  /** The zones hold no heart rate: the effort is the whole target. */
  | 'no-heart-rate'
  /** No race climate is cached yet: the plan says nothing about heat. */
  | 'no-climate'

export interface RaceExpected {
  basis: 'prediction' | 'estimate'
  /** The ends of the range in seconds, rounded outward to `r1.arrivalRoundMin` (equal for an estimate). */
  lowSec: number
  highSec: number
  /** The expected time that the parts, the totals and the dark hours are drawn from. */
  midSec: number
  /** `HH:MM`, or null without a valid start time. */
  start: string | null
  /** The clock at the two ends of the range; null without a start time. */
  finish: { from: RaceClock; to: RaceClock } | null
  /** How wide the range has to be, with its rules and grade (`rangeLabel`, rules L4 and L6). */
  range: RangeLabel
  rules: string[]
}

export interface RaceEffort {
  /** The zone 1 ceiling; null when the zones hold none, and null on a hot race (effort leads). */
  ceilingBpm: number | null
  /** CR-10 (`h11.raceRpe`). */
  rpe: [number, number]
  /** `h11.belowVt1Share`, percent of race time at or below the first threshold in the study. */
  belowVt1Pct: number
  /** The race is hot for steering (`isHotForSteering`): effort leads and no heart rate is stated. */
  hot: boolean
  rules: string[]
}

export interface RaceThird {
  index: number
  /** The elapsed window in seconds, rounded to `r1.arrivalRoundMin`. */
  fromSec: number
  toSec: number
  /** The clock window; null without a start time. */
  clock: { from: RaceClock; to: RaceClock } | null
  /** The part starts between dawn and dusk (`d1Dark`); null without a start time. */
  startsInDaylight: boolean | null
  /** Minutes of the part outside daylight, rounded; null without a start time. */
  darkMin: number | null
  /** Carbohydrate over the part, low to high, in grams. */
  fuelG: [number, number]
  /** The last part: what the corpus holds about late climbing and descending is stated here. */
  late: boolean
}

export interface RaceClimbing {
  hikeGradePct: number
  walkCheaperGradePct: number
  /** `h4.ultraClimbReferenceMh`: a reference for sustained ultra climbing, never a target. */
  referenceMPerH: number
  /** `i11.lateDescentCostIncrease`, a fraction (0.13 is about 13%). */
  lateDescentCostIncrease: number
  rules: string[]
}

export interface RaceHeat {
  /** The climate normal for the race date; null while the race's climate is not cached. */
  wbgtC: number | null
  /** Always `climate-normal`: the plan reads no forecast. */
  source: 'climate-normal'
  /** The race is hot for steering (`i9.warnWbgtC`). */
  hot: boolean
  /** The expected time is over `i6.lowConfidenceEventHours`: every heat adjustment is low confidence. */
  lowConfidence: boolean
  rules: string[]
}

export interface RaceDark {
  /** Hours of the expected range that fall outside daylight, low to high; null without a start time. */
  hours: [number, number] | null
  /** `d1Dark`, as `HH:MM`. */
  dawn: string
  dusk: string
  /** `h6.headlampRehearsalRuns`: the rule asks for this many headlamp runs. */
  headlampRuns: [number, number]
  rules: string[]
}

export interface RaceWeek {
  /** `k6.carbLoadGPerKgDay`. */
  carbGPerKgDay: [number, number]
  /** `k6.carbLoadFinalHours`. */
  finalHours: [number, number]
  /** The days the final window covers, the race date excluded. */
  from: string
  to: string
  /** The body mass in kilograms and the grams it gives, low to high; null without a body mass. */
  weightKg: number | null
  carbG: [number, number] | null
  /** The plan's own shake-out (`shakeOutFor`). */
  shakeOut: { dayBefore: string; easyFrom: string; maxMin: number }
  /** The race WBGT reaches `i8.triggerWbgtC`: the heat top-up line of rule I8 applies. */
  heatTopUp: boolean
  acclimationCredit: number
  rules: string[]
}

export interface RacePlan {
  goalId: string
  name: string
  date: string
  daysToRace: number
  distanceM: number
  gainM: number
  supportLevel: SupportLevel
  expected: RaceExpected
  effort: RaceEffort
  thirds: RaceThird[]
  /** Null when the course climbs less than `h4.climbNoteGainPerHourM` per hour of expected time. */
  climbing: RaceClimbing | null
  fuel: RaceFuel & { rules: string[] }
  fluid: { referenceMlPerH: [number, number]; rules: string[] }
  /** The stronger safety card: over `n7.eahStrongerAlertHours` hours, or in heat. */
  eahStronger: boolean
  /** Null while the race is not yet inside the final window and for a race the rule does not cover. */
  raceWeek: RaceWeek | null
  heat: RaceHeat
  /** Null when the race does not cross darkness (D1). */
  dark: RaceDark | null
  notices: RaceNotice[]
  /** Every rule id behind the plan, once, in order. */
  rules: string[]
}

/**
 * What Today carries: the days to the viewed race, the race-week block while the final window is
 * near, and the block the race-day sheet shows. It is cut from the plan, never recomputed.
 */
export interface RacePlanSummary {
  goalId: string
  name: string
  date: string
  supportLevel: SupportLevel
  /** Days from the viewed day to the race. */
  daysToRace: number
  /** The K6 line is shown: the viewed day is inside the final window or on the race day. */
  carbLineDue: boolean
  raceWeek: RaceWeek | null
  effort: RaceEffort
  fuel: RaceFuel & { rules: string[] }
  fluid: RacePlan['fluid']
  eahStronger: boolean
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** The clock after `sec` seconds from a start at `startMin` minutes after midnight, to the minute. */
export function clockAt(startMin: number, sec: number): RaceClock {
  const total = startMin + Math.round(sec / SEC_PER_MIN)
  const day = Math.floor(total / MIN_PER_DAY)
  const within = total - day * MIN_PER_DAY
  return {
    time: `${pad2(Math.floor(within / MIN_PER_HOUR))}:${pad2(within % MIN_PER_HOUR)}`,
    day,
  }
}

/** Minutes of `[fromMin, toMin]` (minutes after midnight of the race date) outside daylight. */
function nightMinutes(fromMin: number, toMin: number): number {
  const dawn = P.d1Dark.dawnHour.value * MIN_PER_HOUR
  const dusk = P.d1Dark.duskHour.value * MIN_PER_HOUR
  let light = 0
  for (let day = 0; day * MIN_PER_DAY < toMin; day++) {
    const start = Math.max(fromMin, day * MIN_PER_DAY + dawn)
    const end = Math.min(toMin, day * MIN_PER_DAY + dusk)
    if (end > start) light += end - start
  }
  return Math.max(0, toMin - fromMin - light)
}

/**
 * Hours of a race starting at `startTime` that fall outside the D1 daylight clock, for an expected
 * range; null without a valid start time (the plan then states the whole-race fact only).
 */
export function darkHoursFor(
  startTime: string | null,
  lowSec: number,
  highSec: number,
): [number, number] | null {
  const start = startMinutes(startTime)
  if (start === null) return null
  const hours = (sec: number) => nightMinutes(start, start + sec / SEC_PER_MIN) / MIN_PER_HOUR
  return [hours(lowSec), hours(highSec)]
}

/** The ends of the expected time: the prediction's range rounded outward, else the goal's estimate. */
function expectedOf(input: RacePlanInput): RaceExpected {
  const { goal, prediction } = input
  const step = P.r1.arrivalRoundMin.value * SEC_PER_MIN
  const start = startMinutes(goal.startTime) === null ? null : goal.startTime
  const startMin = startMinutes(start)
  let lowSec: number
  let highSec: number
  let midSec: number
  if (prediction === null) {
    midSec = goal.expectedDurationSec
    lowSec = highSec = Math.round(midSec / step) * step
  } else {
    midSec = prediction.predictedSec
    lowSec = Math.floor(prediction.lowSec / step) * step
    highSec = Math.ceil(prediction.highSec / step) * step
  }
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
    range,
    rules: ['H14', ...range.rules],
  }
}

function thirdsOf(midSec: number, start: string | null, fuel: RaceFuel): RaceThird[] {
  const parts = P.r1.thirds.value
  const step = P.r1.arrivalRoundMin.value * SEC_PER_MIN
  const startMin = startMinutes(start)
  const dawn = P.d1Dark.dawnHour.value * MIN_PER_HOUR
  const dusk = P.d1Dark.duskHour.value * MIN_PER_HOUR
  const edge = (i: number) => Math.round((midSec * i) / parts / step) * step
  const [rateLow, rateHigh] = fuel.range ?? [fuel.gPerH, fuel.gPerH]
  return Array.from({ length: parts }, (_unused, index) => {
    const fromSec = edge(index)
    const toSec = edge(index + 1)
    const hours = (toSec - fromSec) / SEC_PER_HOUR
    const startClock = startMin === null ? null : clockAt(startMin, fromSec)
    const startOfDay =
      startClock === null
        ? null
        : Number(startClock.time.slice(0, 2)) * MIN_PER_HOUR + Number(startClock.time.slice(3))
    return {
      index,
      fromSec,
      toSec,
      clock:
        startMin === null || startClock === null
          ? null
          : { from: startClock, to: clockAt(startMin, toSec) },
      startsInDaylight: startOfDay === null ? null : startOfDay >= dawn && startOfDay < dusk,
      darkMin:
        startMin === null
          ? null
          : Math.round(
              nightMinutes(startMin + fromSec / SEC_PER_MIN, startMin + toSec / SEC_PER_MIN) /
                P.r1.arrivalRoundMin.value,
            ) * P.r1.arrivalRoundMin.value,
      fuelG: [rateLow * hours, rateHigh * hours],
      late: index === parts - 1,
    }
  })
}

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

const hourOfDayText = (hour: number): string => `${pad2(hour)}:00`

/** The race plan for an ultra goal (rule H14). Throws RangeError for a goal that is not an ultra. */
export function racePlanFor(input: RacePlanInput): RacePlan {
  const { goal } = input
  if (!goal.isUltra) throw new RangeError('racePlanFor needs an ultra goal')

  const expected = expectedOf(input)
  const hoursExpected = expected.midSec / SEC_PER_HOUR
  const wbgt = goal.raceWbgtC
  const wbgtIndex = wbgt === null ? null : ({ value: wbgt, index: 'wbgt' } as const)
  const hot = isHotForSteering(wbgtIndex, [])
  const hotForFuel = isHotForFuel(wbgtIndex)

  const fuel = raceFuelFor(input.ladder, { hot: hotForFuel, expectedSec: expected.midSec })
  const thirds = thirdsOf(expected.midSec, expected.start, fuel)

  const effort: RaceEffort = {
    ceilingBpm: hot ? null : input.z1CeilingBpm,
    rpe: [...P.h11.raceRpe.value],
    belowVt1Pct: P.h11.belowVt1Share.value,
    hot,
    rules: ['H11', ...(hot ? ['I7', 'I9'] : [])],
  }

  const gainPerHour = hoursExpected > 0 ? goal.gainM / hoursExpected : 0
  const climbing: RaceClimbing | null =
    gainPerHour >= P.h4.climbNoteGainPerHourM.value
      ? {
          hikeGradePct: P.h4.hikeGradePct.value,
          walkCheaperGradePct: P.h4.walkCheaperGradePct.value,
          referenceMPerH: P.h4.ultraClimbReferenceMh.value,
          lateDescentCostIncrease: P.i11.lateDescentCostIncrease.value,
          rules: ['H4', 'I11'],
        }
      : null

  const heat: RaceHeat = {
    wbgtC: wbgt,
    source: 'climate-normal',
    hot,
    lowConfidence: hoursExpected > P.i6.lowConfidenceEventHours.value,
    rules: ['I6', 'I9'],
  }

  const dark: RaceDark | null = goal.crossesDarkness
    ? {
        hours: darkHoursFor(expected.start, expected.lowSec, expected.highSec),
        dawn: hourOfDayText(P.d1Dark.dawnHour.value),
        dusk: hourOfDayText(P.d1Dark.duskHour.value),
        headlampRuns: [...P.h6.headlampRehearsalRuns.value],
        rules: ['D1', 'H6'],
      }
    : null

  const shakeOut = shakeOutFor(goal.date, expected.midSec / SEC_PER_MIN)
  const [carbLow, carbHigh] = P.k6.carbLoadGPerKgDay.value
  const finalHours = [...P.k6.carbLoadFinalHours.value] as [number, number]
  const raceWeek: RaceWeek | null =
    shakeOut === undefined
      ? null
      : {
          carbGPerKgDay: [carbLow, carbHigh],
          finalHours,
          from: addDays(goal.date, -Math.ceil(finalHours[1] / HOURS_PER_DAY)),
          to: addDays(goal.date, -1),
          weightKg: input.weightKg,
          carbG:
            input.weightKg === null ? null : [input.weightKg * carbLow, input.weightKg * carbHigh],
          shakeOut,
          heatTopUp: wbgt !== null && wbgt >= P.i8.triggerWbgtC.value,
          acclimationCredit: input.acclimationCredit,
          rules: ['K6', 'I8', 'H8'],
        }

  const notices: RaceNotice[] = []
  if (input.prediction === null) notices.push('no-prediction')
  if (expected.start === null) notices.push('no-start-time')
  if (input.z1CeilingBpm === null) notices.push('no-heart-rate')
  if (wbgt === null) notices.push('no-climate')

  const blocks = [
    expected.rules,
    effort.rules,
    climbing?.rules ?? [],
    ['H7', 'H8', 'H9'],
    heat.rules,
    dark?.rules ?? [],
    raceWeek?.rules ?? [],
  ]
  return {
    goalId: goal.goalId,
    name: goal.name,
    date: goal.date,
    daysToRace: daysBetween(input.today, goal.date),
    distanceM: goal.distanceM,
    gainM: goal.gainM,
    supportLevel: input.supportLevel,
    expected,
    effort,
    thirds,
    climbing,
    fuel: { ...fuel, rules: ['H7', 'H14'] },
    fluid: { referenceMlPerH: [...P.h8.fluidReferenceMlPerH.value], rules: ['H8'] },
    eahStronger: eahCard({ eventHours: hoursExpected, hot: hotForFuel }).stronger,
    raceWeek,
    heat,
    dark,
    notices,
    rules: [...new Set(['H14', ...blocks.flat()])],
  }
}

/**
 * The days from the viewed day to the race after which the K6 carbohydrate line is shown: the
 * final window of `k6.carbLoadFinalHours` (its long end, in whole days).
 */
export function carbLineDays(): number {
  return Math.ceil(P.k6.carbLoadFinalHours.value[1] / HOURS_PER_DAY)
}

/**
 * The Today view of a plan for the viewed day, or null outside race week (`r1.raceWeekCardDays`
 * days before the race, the race day included). Cut from the plan: the same objects, so the page
 * and the card cannot differ.
 */
export function summaryOf(plan: RacePlan, date: string): RacePlanSummary | null {
  const daysToRace = daysBetween(date, plan.date)
  if (daysToRace < 0 || daysToRace > P.r1.raceWeekCardDays.value) return null
  return {
    goalId: plan.goalId,
    name: plan.name,
    date: plan.date,
    supportLevel: plan.supportLevel,
    daysToRace,
    carbLineDue: daysToRace <= carbLineDays(),
    raceWeek: plan.raceWeek,
    effort: plan.effort,
    fuel: plan.fuel,
    fluid: plan.fluid,
    eahStronger: plan.eahStronger,
  }
}
