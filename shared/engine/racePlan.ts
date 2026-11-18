// The race plan of an ultra goal (rule H14, ADR 0018; design 2026-11-07, steps 2 and 3). One pure
// function of the goal model, the live prediction, the replayed fuel ladder, the zone 1 ceiling and
// the heat credit, evaluated on every read and stored nowhere, as the strength workout is
// (ADR 0014). It returns data: facts and the rule ids behind them. The words are
// `shared/copy/racePlan.ts`, so the page, the Today card and the session sheet cannot say
// different things.
//
// What it does not do, on purpose: no pace and no late-race slowdown (the corpus holds no study of
// pace by third or by segment, gaps R1 to R3), no time at an aid station (R2), no rate above a
// tolerated rung (G6, R4), no downhill credit (I11), no sleep advice (R5) and no comparison of a
// cutoff with the expected range. The runner's checkpoint table adds arrival ranges, scaled from
// the expected range by the share of the course (`raceSplits.ts`, step 4 of the design).
//
// Pure: no clock, no I/O. `today` and the weather arrive as data. Every number comes from `P`.
import { addDays, daysBetween } from '../dates.ts'
import type { RaceHeatState } from '../domain/raceHeat.ts'
import type { Activity, RangeLabel, SupportLevel } from '../types.ts'
import { eahCard, isHotForFuel, raceFuelFor, type RaceFuel } from './fuel.ts'
import { startMinutes } from './goal.ts'
import { isHotForSteering, type WeatherIndex } from './heat.ts'
import { shakeOutFor } from './micro.ts'
import { P } from './params/index.ts'
import { rangeLabel } from './predict.ts'
import { clockAt, type RaceClock } from './raceClock.ts'
import { rehearsalFor, type RaceRehearsal } from './rehearsal.ts'
import { splitsFor, type CheckpointInput, type RaceSplits } from './raceSplits.ts'
import type { ClimbBlend, GoalModel, LadderResult, Prediction, SessionKind } from './types.ts'

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
  prediction: Pick<
    Prediction,
    'predictedSec' | 'lowSec' | 'highSec' | 'trainingSince' | 'trainingWidened' | 'climb'
  > | null
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
  /** The runner's own course points for the goal (`RaceCheckpoint`); empty when there are none. */
  checkpoints: readonly CheckpointInput[]
  /**
   * The runs the rehearsal count reads (the snapshot's history window) and the home place. Absent:
   * the plan carries no rehearsal.
   */
  history?: { activities: readonly Activity[]; homeLat: number | null; homeLng: number | null }
  /**
   * The stored plan's sessions (the snapshot's `planSessions`), the one source of the race-week
   * lines once the plan holds its race week. Absent or null: no plan, the lines come from Params.
   */
  raceWeekSessions?: readonly RaceWeekSession[] | null
  /** Why the race climate is missing, or `known` (RH1); absent: the notice says only that it is missing. */
  heatState?: RaceHeatState
  /** The server's day. */
  today: string
}

export type { RaceClock }

/** The part of a stored plan session the race-week lines read. */
export interface RaceWeekSession {
  date: string
  kind: SessionKind
  durationMin: number
  status?: string
}

/** The kinds of the run-in before a long race that count as easy running [rule K6]. */
const EASY_RUN_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>(['easy', 'recovery'])
/**
 * The kinds that are runs, and so count toward the day before's minutes. An entered B or C race in
 * the taper stays as entered (K6), so a `race` dated before the goal race is a run that is not easy.
 */
const RUN_KINDS_BEFORE_RACE: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'hike',
  'b2b',
  'race',
])

/**
 * The rule's shake-out read against the stored plan's race-week sessions (rule K6): the saved
 * sessions are the one source of the race-week lines. The plan has a race week when it holds a
 * session in the seven days up to the race; without one the rule's own shake-out stands. A skipped
 * session is not held. `easyFrom` moves later when the plan holds a run that is not easy within the
 * rule's days (a swap or an edit put it there); `held` appears when the saved day before holds more
 * than the rule's minutes or is not easy running. An unedited plan returns `shakeOut` unchanged.
 */
export function shakeOutHeld(
  raceDate: string,
  shakeOut: RaceWeek['shakeOut'],
  sessions: readonly RaceWeekSession[] | null | undefined,
): RaceWeek['shakeOut'] {
  if (sessions == null) return shakeOut
  const live = sessions.filter((s) => s.status !== 'skipped')
  const windowStart = addDays(raceDate, -7)
  if (!live.some((s) => s.date >= windowStart && s.date <= raceDate)) return shakeOut
  const runs = live.filter(
    (s) => s.date < raceDate && s.date >= windowStart && RUN_KINDS_BEFORE_RACE.has(s.kind),
  )
  const lastHard = runs
    .filter((s) => !EASY_RUN_KINDS.has(s.kind))
    .reduce<string | null>((max, s) => (max === null || s.date > max ? s.date : max), null)
  const easyFrom =
    lastHard !== null && addDays(lastHard, 1) > shakeOut.easyFrom
      ? addDays(lastHard, 1)
      : shakeOut.easyFrom
  const before = runs.filter((s) => s.date === shakeOut.dayBefore)
  const min = before.reduce((sum, s) => sum + s.durationMin, 0)
  const hard = before.find((s) => !EASY_RUN_KINDS.has(s.kind))
  const longest = [...before].sort((a, b) => b.durationMin - a.durationMin)[0]
  const kind = hard?.kind ?? longest?.kind
  const held =
    kind !== undefined && (min > shakeOut.maxMin || hard !== undefined) ? { min, kind } : undefined
  return { ...shakeOut, easyFrom, ...(held === undefined ? {} : { held }) }
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
  /** The prediction's own ends, unrounded: the words round the shown range themselves (PF1). */
  rawLowSec: number
  rawHighSec: number
  /** The expected time that the parts, the totals and the dark hours are drawn from. */
  midSec: number
  /** `HH:MM`, or null without a valid start time. */
  start: string | null
  /** The clock at the two ends of the range; null without a start time. */
  finish: { from: RaceClock; to: RaceClock } | null
  /**
   * The first day of the window when the prediction stands on a critical speed found from training
   * (rule A6), so the range is wider and the page says why; null or absent otherwise.
   */
  trainingSince?: string | null
  /** True when that fit needed efforts older than the 90-day window (A6): no "at most". */
  trainingWidened?: boolean
  /** How wide the range has to be, with its rules and grade (`rangeLabel`, rules L4 and L6). */
  range: RangeLabel
  /** The runner's own climbing moved the prediction (rule L5); null otherwise. */
  climb: ClimbBlend | null
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
  /** Why `wbgtC` is null (RH1): no place to read it for, or a place not read yet. Absent when unknown to the builder. */
  state?: RaceHeatState
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
  /**
   * The plan's shake-out (`shakeOutFor`), read against the stored plan's race-week sessions when
   * the caller passes them (`raceWeekSessions`): `easyFrom` is then the later of the rule's date and
   * the day after the plan's last session that is not easy running, and `held` is present only when
   * the saved day before holds more than `maxMin` minutes or is not easy running.
   */
  shakeOut: {
    dayBefore: string
    easyFrom: string
    maxMin: number
    held?: { min: number; kind: SessionKind }
  }
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
  /**
   * What the runner's recent runs hold of the night and downhill preparation the plan asks for (H6,
   * H5); null without history or when the plan asks for neither.
   */
  rehearsal: RaceRehearsal | null
  /** Arrival ranges for the runner's checkpoints and the finish; null without any row. */
  splits: RaceSplits | null
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
  let rawLowSec: number
  let rawHighSec: number
  if (prediction === null) {
    midSec = goal.expectedDurationSec
    lowSec = highSec = Math.round(midSec / step) * step
    rawLowSec = rawHighSec = midSec
  } else {
    midSec = prediction.predictedSec
    rawLowSec = prediction.lowSec
    rawHighSec = prediction.highSec
    lowSec = Math.floor(prediction.lowSec / step) * step
    highSec = Math.ceil(prediction.highSec / step) * step
  }
  const range = rangeLabel({ distanceM: goal.distanceM })
  return {
    basis: prediction === null ? 'estimate' : 'prediction',
    trainingSince: prediction?.trainingSince ?? null,
    ...(prediction?.trainingWidened === true ? { trainingWidened: true } : {}),
    lowSec,
    highSec,
    rawLowSec,
    rawHighSec,
    midSec,
    start,
    finish:
      startMin === null
        ? null
        : { from: clockAt(startMin, lowSec), to: clockAt(startMin, highSec) },
    range,
    climb: prediction?.climb ?? null,
    rules: ['H14', ...(prediction?.climb ? ['L5'] : []), ...range.rules],
  }
}

function thirdsOf(midSec: number, start: string | null, fuel: RaceFuel): RaceThird[] {
  const parts = P.r1.thirds.value
  const step = P.r1.arrivalRoundMin.value * SEC_PER_MIN
  const startMin = startMinutes(start)
  const dawn = P.d1Dark.dawnHour.value * MIN_PER_HOUR
  const dusk = P.d1Dark.duskHour.value * MIN_PER_HOUR
  // The inner edges are rounded to the arrival step; the last edge is the expected time itself, so
  // the end of the last part and the figure above it name the same instant ("32 h 9 min", not
  // "32 h 10 min").
  const edge = (i: number) =>
    i === parts ? midSec : Math.round((midSec * i) / parts / step) * step
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

/**
 * The race heat as the weather index the heat predicates read: the climate normal of the goal's race
 * date as a WBGT, or null while none is cached. Shared by the ultra plan (steering and fuel) and the
 * road plan (fuel).
 */
export function raceWbgtIndex(goal: Pick<GoalModel, 'raceWbgtC'>): WeatherIndex | null {
  return goal.raceWbgtC === null ? null : { value: goal.raceWbgtC, index: 'wbgt' }
}

/**
 * The K6 race-week block (rule K6): null for a race under `k6.carbLoadMinRaceMin` minutes (decided by
 * `shakeOutFor`, the plan's own shake-out), else the carbohydrate range, its days, the shake-out, the
 * I8 heat top-up and the credit. `expectedMin` is the duration the caller measures the race by: the
 * ultra plan passes the prediction's middle, the road plan the goal's expected duration (the quantity
 * the generated plan's own shake-out reads).
 */
export function raceWeekFor(args: {
  goal: Pick<GoalModel, 'date'>
  expectedMin: number
  weightKg: number | null
  wbgtC: number | null
  acclimationCredit: number
  /** The stored plan's sessions; see `shakeOutHeld`. */
  sessions?: readonly RaceWeekSession[] | null
}): RaceWeek | null {
  const ruleShakeOut = shakeOutFor(args.goal.date, args.expectedMin)
  if (ruleShakeOut === undefined) return null
  const shakeOut = shakeOutHeld(args.goal.date, ruleShakeOut, args.sessions)
  const [carbLow, carbHigh] = P.k6.carbLoadGPerKgDay.value
  const finalHours = [...P.k6.carbLoadFinalHours.value] as [number, number]
  return {
    carbGPerKgDay: [carbLow, carbHigh],
    finalHours,
    from: addDays(args.goal.date, -Math.ceil(finalHours[1] / HOURS_PER_DAY)),
    to: addDays(args.goal.date, -1),
    weightKg: args.weightKg,
    carbG: args.weightKg === null ? null : [args.weightKg * carbLow, args.weightKg * carbHigh],
    shakeOut,
    heatTopUp: args.wbgtC !== null && args.wbgtC >= P.i8.triggerWbgtC.value,
    acclimationCredit: args.acclimationCredit,
    rules: ['K6', 'I8', 'H8'],
  }
}

/** The race plan for an ultra goal (rule H14). Throws RangeError for a goal that is not an ultra. */
export function racePlanFor(input: RacePlanInput): RacePlan {
  const { goal } = input
  if (!goal.isUltra) throw new RangeError('racePlanFor needs an ultra goal')

  const expected = expectedOf(input)
  const hoursExpected = expected.midSec / SEC_PER_HOUR
  const wbgt = goal.raceWbgtC
  const wbgtIndex = raceWbgtIndex(goal)
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
    ...(input.heatState === undefined ? {} : { state: input.heatState }),
    rules: ['I6', 'I9', ...(hot ? ['I8'] : [])],
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

  const rehearsal =
    input.history === undefined
      ? null
      : rehearsalFor({
          activities: input.history.activities,
          homeLat: input.history.homeLat,
          homeLng: input.history.homeLng,
          today: input.today,
          night: dark !== null,
          downhill:
            goal.distanceM > 0 &&
            goal.lossM / (goal.distanceM / 1000) >= P.h12.hillyDescentMPerKm.value,
          course:
            goal.distanceM > 0 && goal.gainM > 0
              ? {
                  gainPerKm: goal.gainM / (goal.distanceM / 1000),
                  lossPerKm: goal.lossM > 0 ? goal.lossM / (goal.distanceM / 1000) : null,
                }
              : null,
        })

  const raceWeek = raceWeekFor({
    goal,
    expectedMin: expected.midSec / SEC_PER_MIN,
    weightKg: input.weightKg,
    wbgtC: wbgt,
    acclimationCredit: input.acclimationCredit,
    sessions: input.raceWeekSessions,
  })

  const notices: RaceNotice[] = []
  if (input.prediction === null) notices.push('no-prediction')
  if (expected.start === null) notices.push('no-start-time')
  if (input.z1CeilingBpm === null) notices.push('no-heart-rate')
  if (wbgt === null) notices.push('no-climate')

  const [rateLow, rateHigh] = fuel.range ?? [fuel.gPerH, fuel.gPerH]
  const splits = splitsFor({
    distanceM: goal.distanceM,
    courseGainM: goal.gainM,
    supportLevel: input.supportLevel,
    checkpoints: input.checkpoints,
    expected: { lowSec: expected.lowSec, highSec: expected.highSec, midSec: expected.midSec },
    startMin: startMinutes(expected.start),
    rateGPerH: [rateLow, rateHigh],
    climb: expected.climb,
  })

  const blocks = [
    expected.rules,
    effort.rules,
    climbing?.rules ?? [],
    ['H7', 'H8', 'H9'],
    heat.rules,
    dark?.rules ?? [],
    rehearsal?.rules ?? [],
    raceWeek?.rules ?? [],
    splits?.rules ?? [],
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
    rehearsal,
    splits,
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
