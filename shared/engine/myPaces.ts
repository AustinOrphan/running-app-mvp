// My paces (rule C9, ADR 0020): the easy pace, and what the runner can run now at a set distance,
// read from what the engine already holds. Derived on every read and stored nowhere. Pure: no I/O,
// no clock; `today` and the events arrive as data. Every number comes from `P`.
//
// Easy pace, in order:
// 1. `hr-model`: the speed at which the runner's own heart-rate-at-speed line (`fitHrModel`, rule
//    A8) meets the top of Z1, in cool air on the flat. The range runs from that pace to the slow
//    edge of Z1 (`c2.z1PaceSlowFactor`), the shape of the zones' own Z1 pace range.
// 2. `threshold-pace` or `critical-speed`: the Z1 pace range of the zones, named by where the
//    zones took their pace anchor from (a tested threshold pace, or critical speed).
// 3. none: a missing pace is never replaced by a guess, and the view says what would give one.
// Heat and a climb are shown as one example each: the heat-steering WBGT (`i9.warnWbgtC`) through
// the line's own heat term, and `c9.exampleGradePct` through the cost of the grade (rule I11), or,
// when the runner's own curve passes its test for the band that holds that grade, through their own
// speed ratio there (rule I13; display only, the easy pace is the same whatever the climb example).
//
// Predictions are `predictFromState`: no goal, no race-day weather, the courses of the caller. A
// course with gain also reads the runner's own climbing a little (rule L5, `EventRow.ownClimb`). The grade of a method is the lowest among the Params it reads.
import type { Activity } from '../types.ts'
import { heatExcessC, hrModelSample, type HrModel } from './execution.ts'
import {
  curveRunsOf,
  gradeCurve,
  type BandReason,
  type GradeBand,
  type GradeCurve,
} from './gradeCurve.ts'
import { P } from './params/index.ts'
import { anchorRaceFor, CS_METHODS, predictFromState, rangeLabel } from './predict.ts'
import { gradeAdjustedSpeed } from './terrain.ts'
import type { AthleteState, ClimbBlend, Grade, Param, Prediction, ZoneSet } from './types.ts'

const M_PER_KM = 1000
const PERCENT = 100

/** Where an easy pace came from. */
export type EasyBasis = 'hr-model' | 'threshold-pace' | 'critical-speed'

/** Sec/km, slow end first (the order of `ZoneSet.pace`). */
export type PaceBand = [slow: number, fast: number]

export interface EasyPace {
  basis: EasyBasis
  /** Cool air, flat ground. */
  range: PaceBand
  /** The heart rate the range answers to; null unless the basis is the heart-rate line. */
  ceilingBpm: number | null
  /** Half the width of that ceiling's band (rule C7), in bpm; null with the ceiling. */
  ceilingBandBpm: number | null
  /** The runs the heart-rate line stands on and the day of the earliest; null for the zone bases. */
  sample: { runs: number; since: string } | null
  confidence: 'moderate' | 'low'
  grade: Grade
  /**
   * The example hot day through the line's heat term; null unless the basis is the line. `own` is
   * true when the runner has hot runs enough (`hrModel.shrinkagePriorRuns`) for the term to be
   * theirs; with fewer it is the population default (rule I7) and the page says so.
   */
  hot: { wbgtC: number; range: PaceBand; own: boolean } | null
  /**
   * The example climb: through the runner's own ratio in the band that holds the grade when the
   * curve of rule I13 shows one there (`source` personal), else through the cost of the grade
   * (rule I11), with the reason the curve did not speak. `bandIndex` is the band in `terrain`.
   */
  climb: {
    gradePct: number
    range: PaceBand
    source: 'personal' | 'default'
    reason: BandReason
    bandIndex: number | null
  }
  rules: string[]
}

/** What a heart-rate line needs, and how far the runner is from it. */
export interface HrLineNeeds {
  /** Runs that qualify in the window now. */
  runs: number
  need: number
  windowWeeks: number
  minDurationMin: number
  /** False when the zones hold no heart-rate ceiling (no maximum heart rate and no age). */
  ceiling: boolean
}

/** The guided critical-speed test the engine supports (rule A6). */
export interface CsTest {
  /** Distinct efforts found in the window. */
  efforts: number
  need: number
  minM: number
  maxM: number
  /** The longest effort has to last at least this many times the shortest. */
  spreadRatio: number
  windowDays: number
  /** True when the efforts already give a critical speed. */
  done: boolean
  /** True when that critical speed uses the stretches of longer runs, so a test would narrow it (A6). */
  fromTraining: boolean
}

export type EventKey = 'five-k' | 'ten-k' | 'half' | 'marathon' | 'fifty-k' | 'custom'

export interface EventSpec {
  key: EventKey
  distanceM: number
  gainM: number
}

export interface EventBasis {
  /** The race the prediction is anchored on, when the method used one. */
  race: { date: string; distanceM: number; timeSec: number } | null
  /**
   * Critical speed, when the method used it. `since` is the first day of the window when the fit
   * uses the best efforts of training runs (not races or a test); null for a fit from whole runs.
   */
  cs: { csMps: number; efforts: number; since: string | null } | null
}

export interface EventRow extends EventSpec {
  /** Null when the state supports no source. */
  time: { midSec: number; lowSec: number; highSec: number } | null
  /** Sec/km over the course's own distance: the middle, and the fast and slow ends. */
  pace: { midSec: number; fastSec: number; slowSec: number } | null
  basis: EventBasis
  methods: string[]
  grade: Grade
  /** An ultra: the range is wide on purpose (`rangeLabel`). */
  wide: boolean
  /** Fewer sources than rule L3 asks for: the range is wider. */
  singleSource: boolean
  /** Climb counted as flat distance (rule L5). */
  climbs: boolean
  /** Set when the runner's own climbing moved the time (rule L5, I13). */
  ownClimb: ClimbBlend | null
  rules: string[]
}

export interface MyPaces {
  asOf: string
  easy: {
    pace: EasyPace | null
    /** Why the heart-rate line gave no pace though there is one and a ceiling to read it at. */
    lineIssue: LineIssue | null
    /** The Z1 pace range of the zones, whatever the basis, for a comparison; null without one. */
    zoneRange: PaceBand | null
    hr: HrLineNeeds
  }
  /** The runner's speed by grade next to Minetti's, rule I13. Display only. */
  terrain: GradeCurve
  events: EventRow[]
  test: CsTest
}

export interface MyPacesInput {
  state: AthleteState
  zones: ZoneSet
  hrModel: HrModel | null
  activities: Activity[]
  today: string
}

const GRADE_ORDER: readonly Grade[] = ['A', 'B', 'C', 'D']

/** The lowest of a set of grades; `D` for none, the safe side. */
function lowestGrade(grades: readonly Grade[]): Grade {
  let worst = 0
  for (const grade of grades) worst = Math.max(worst, GRADE_ORDER.indexOf(grade))
  return grades.length === 0 ? 'D' : (GRADE_ORDER[worst] ?? 'D')
}

const gradesOf = (params: ReadonlyArray<Param<unknown>>): Grade[] => params.map((p) => p.grade)

const paceOf = (speedMps: number): number => M_PER_KM / speedMps

function scaleBand(band: PaceBand, factor: number): PaceBand {
  return [Math.round(band[0] * factor), Math.round(band[1] * factor)]
}

/** The band of the curve that holds a grade (a grade on an edge belongs to the band above). */
function bandAt(curve: GradeCurve, gradePct: number): GradeBand | null {
  return (
    curve.bands.find(
      (band) =>
        (band.fromPct === null || gradePct >= band.fromPct) &&
        (band.toPct === null || gradePct < band.toPct),
    ) ?? null
  )
}

/**
 * The example climb for a flat range: the runner's own ratio when the band that holds the example
 * grade shows it (rule I13), else the cost of the grade (rule I11), slower by that factor.
 */
function climbOf(range: PaceBand, curve: GradeCurve): EasyPace['climb'] {
  const gradePct = P.c9.exampleGradePct.value
  const band = bandAt(curve, gradePct)
  const personal = band !== null && band.source === 'personal'
  // The cost of the grade is the factor by which the pace grows; a ratio is its inverse (speed).
  const factor = personal ? 1 / band.ratio : gradeAdjustedSpeed(1, gradePct / PERCENT)
  return {
    gradePct,
    range: scaleBand(range, factor),
    source: personal ? 'personal' : 'default',
    reason: band?.reason ?? 'untested',
    bandIndex: band?.index ?? null,
  }
}

/** The top of Z1, the ceiling a heart-rate easy pace answers to; null without a heart-rate zone. */
function ceilingOf(zones: ZoneSet): number | null {
  return zones.hr?.z1[1] ?? null
}

/** The speed at which the line meets a heart rate, or null when the line cannot say. */
function speedAtHr(model: HrModel, bpm: number): number | null {
  if (!(model.slopeBpmPerMps > 0)) return null
  const speed = (bpm - model.interceptBpm) / model.slopeBpmPerMps
  return Number.isFinite(speed) && speed > 0 ? speed : null
}

/**
 * Why the line gives no easy pace, a closed set the page words one by one: `flat` (too little slope
 * to say which speed meets a heart rate), `outside-runs` (the speed lies beyond the speeds the line
 * was fitted on, widened by a margin, or the line never reaches the ceiling), `too-fast` (at or above
 * critical speed or, with none, above the ceiling on easy speed) and `too-slow` (slower than a walk).
 */
export type LineIssue = 'flat' | 'outside-runs' | 'too-fast' | 'too-slow'

/** The slowest speed the line is read at: the fitted speeds widened by a margin, never a walk. */
function slowestReadableMps(model: HrModel): number {
  return Math.max(model.minSpeedMps * (1 - P.c9.lineSpeedMargin.value), P.c9.walkingFloorMps.value)
}

/**
 * Why the line cannot be read at this speed (rule C9), or null when it can: steep enough, inside
 * the fitted speeds widened by a margin, not slower than a walk, and under critical speed or, with
 * none, under a ceiling on easy speed. `speed` null is a line that never reaches the heart rate.
 */
function lineIssueAt(model: HrModel, speed: number | null, csMps: number | null): LineIssue | null {
  if (!(model.slopeBpmPerMps >= P.c9.lineMinSlopeBpmPerMps.value)) return 'flat'
  if (speed === null) return 'outside-runs'
  const margin = P.c9.lineSpeedMargin.value
  if (speed < model.minSpeedMps * (1 - margin) || speed > model.maxSpeedMps * (1 + margin)) {
    return 'outside-runs'
  }
  if (speed < P.c9.walkingFloorMps.value) return 'too-slow'
  if (csMps === null ? speed > P.c9.maxEasySpeedMps.value : speed >= csMps) return 'too-fast'
  return null
}

/** The slow edge of Z1 from its fast edge, the shape of the zones' own Z1 pace range. */
function bandFromFast(fastSecPerKm: number): PaceBand {
  return [Math.round(fastSecPerKm * P.c2.z1PaceSlowFactor.value), Math.round(fastSecPerKm)]
}

function hrBasedPace(
  input: MyPacesInput,
  terrain: GradeCurve,
  sample: { runs: number; first: string | null },
): { pace: EasyPace | null; issue: LineIssue | null } {
  const { hrModel, zones, state } = input
  const ceiling = ceilingOf(zones)
  if (hrModel === null || ceiling === null || sample.first === null) {
    return { pace: null, issue: null }
  }
  const speed = speedAtHr(hrModel, ceiling)
  // A line that cannot be read at the ceiling gives no pace: the zones answer instead.
  const issue = lineIssueAt(hrModel, speed, state.fitness.csMps)
  if (issue !== null || speed === null) return { pace: null, issue }
  return { pace: hrPaceAt(input, terrain, sample.first, ceiling, speed, hrModel), issue: null }
}

function hrPaceAt(
  input: MyPacesInput,
  terrain: GradeCurve,
  since: string,
  ceiling: number,
  speed: number,
  hrModel: HrModel,
): EasyPace {
  const { zones } = input
  const range = bandFromFast(paceOf(speed))
  const hotWbgt = P.i9.warnWbgtC.value
  // The hot speed is held to the same slow bound as the cool one: below the fitted speeds the line
  // extrapolates, and then there is no hot figure and the page says to go by effort. The heat term
  // is always positive (the population prior moves it by shrinkage); it is the runner's own only
  // with hot runs of their own, and the hot figure says which.
  const hotSpeed = speedAtHr(hrModel, ceiling - hrModel.heatBpmPerC * heatExcessC(hotWbgt))
  const hot =
    hotSpeed !== null && hotSpeed >= slowestReadableMps(hrModel)
      ? {
          wbgtC: hotWbgt,
          range: bandFromFast(paceOf(hotSpeed)),
          own: hrModel.hotRuns >= P.hrModel.shrinkagePriorRuns.value,
        }
      : null
  return {
    basis: 'hr-model',
    range,
    ceilingBpm: ceiling,
    ceilingBandBpm: zones.lt1Hr === null ? null : (zones.lt1Hr.band[1] - zones.lt1Hr.band[0]) / 2,
    sample: { runs: hrModel.runs, since },
    confidence: zones.lt1Hr?.source === 'hrmax-age' ? 'low' : 'moderate',
    grade: lowestGrade(
      gradesOf([
        P.hrModel.minQualifyingRuns,
        P.c2.z1PaceSlowFactor,
        P.c9.lineSpeedMargin,
        P.c9.lineMinSlopeBpmPerMps,
      ]),
    ),
    hot,
    climb: climbOf(range, terrain),
    rules: ['C9', 'C2', 'C4', 'A8', 'I11', 'I13', ...(hot === null ? [] : ['I7', 'I9'])].sort(),
  }
}

function zoneBasedPace(zones: ZoneSet, terrain: GradeCurve): EasyPace | null {
  const z1 = zones.pace?.z1 ?? null
  const source = zones.lt1PaceSecPerKm?.source ?? null
  if (z1 === null || source === null || !(z1[1] > 0)) return null
  const tested = source === 'profile'
  return {
    basis: tested ? 'threshold-pace' : 'critical-speed',
    range: [z1[0], z1[1]],
    ceilingBpm: null,
    ceilingBandBpm: null,
    sample: null,
    confidence: tested ? 'moderate' : 'low',
    grade: lowestGrade(gradesOf([P.c2.z1PaceSlowFactor, ...(tested ? [] : [P.c4.lt1CsFraction])])),
    hot: null,
    climb: climbOf([z1[0], z1[1]], terrain),
    rules: ['C9', 'C2', tested ? 'C5' : 'C4', 'I11', 'I13'].sort(),
  }
}

/** Methods that read a race, and methods that read critical speed (`predictFromState`). */
const RACE_METHODS = new Set(['personal-exponent', 'riegel', 'same-distance', 'single-anchor'])

/** The Params of the critical-speed fit of rule A6 that every critical-speed method reads. */
const CS_FIT_PARAMS: ReadonlyArray<Param<unknown>> = [
  P.a6.csMinEfforts,
  P.a6.csMinDistanceM,
  P.a6.csMaxDistanceM,
  P.a6.csWindowDays,
  P.a6.csBandInnerEdgesM,
  P.a6.csMinTimeSpreadRatio,
]

/** The Params of a fit that uses the stretches of training runs (A6), read on top of the above. */
const CS_TRAINING_PARAMS: ReadonlyArray<Param<unknown>> = [
  P.a6.csEffortTargetsM,
  P.a6.csMinEffortSec,
  P.a6.csTrainingWideningPct,
]

/**
 * The Params a method of `predictFromState` reads, for its grade: the ones named in the method and
 * the ones of the fit it stands on (the race exponent of A6, the critical-speed fit of A6). A grade
 * D default among them sets the grade of the figure, so the grade is the lowest of all.
 */
const METHOD_PARAMS: Record<string, ReadonlyArray<Param<unknown>>> = {
  'personal-exponent': [
    P.l1.personalExponentMinRaces,
    P.a6.exponentMinRaces,
    P.a6.exponentMinDistanceRatio,
    P.a6.exponentPlausible,
  ],
  riegel: [P.l1.riegelExponent, P.l1.riegelMaxTargetM],
  'same-distance': [P.l1.sameDistanceTolerancePct, P.l1.riegelExponent],
  'single-anchor': [P.l2.singleAnchorSlowdownPct, P.l2.singleAnchorMaxM, P.l1.riegelExponent],
  'critical-speed': [P.l1.csExtrapolationMaxMin, ...CS_FIT_PARAMS],
  'cs-durability': [
    P.l2.csFractionLowDecoupling,
    P.l2.csFractionHighDecoupling,
    P.l2.decouplingLowBelow,
    P.l2.decouplingHighFrom,
    ...CS_FIT_PARAMS,
  ],
  'cs-fraction': [
    P.l2.csFractionAt60Min,
    P.l2.csFractionAt150Min,
    P.l2.csFractionAt360Min,
    P.l4.csFractionFloor,
    ...CS_FIT_PARAMS,
  ],
}

/** The Params that widen or move a range beyond its method (rules L3, L5). */
const SINGLE_SOURCE_PARAMS = [P.l3.singleSourceWideningPct, P.l3.minSources]
const CLIMB_PARAMS = [
  P.l5.gainEquivalentM,
  P.l5.personalBlendFaster,
  P.l5.personalBlendSlower,
  P.l5.personalBlendMaxShiftPct,
  P.l5.trailIntervalWideningPct,
  P.l5.gainWideningPctPerMPerKm,
]

function rowOf(spec: EventSpec, state: AthleteState, prediction: Prediction | null): EventRow {
  const label = rangeLabel(spec)
  if (prediction === null) {
    return {
      ...spec,
      time: null,
      pace: null,
      basis: { race: null, cs: null },
      methods: [],
      grade: label.grade,
      wide: label.wide,
      singleSource: false,
      climbs: spec.gainM > 0,
      ownClimb: null,
      rules: label.rules,
    }
  }
  const methods = prediction.method.split('+')
  const usesRace = methods.some((m) => RACE_METHODS.has(m))
  const usesCs = methods.some((m) => CS_METHODS.has(m))
  const anchor = usesRace
    ? anchorRaceFor(state, { ...spec, surface: spec.gainM > 0 ? 'trail' : 'road', wbgtC: null })
    : null
  const km = spec.distanceM / M_PER_KM
  const csMps = state.fitness.csMps
  return {
    ...spec,
    time: {
      midSec: prediction.predictedSec,
      lowSec: prediction.lowSec,
      highSec: prediction.highSec,
    },
    pace: {
      midSec: prediction.predictedSec / km,
      fastSec: prediction.lowSec / km,
      slowSec: prediction.highSec / km,
    },
    basis: {
      race: anchor === null ? null : { ...anchor },
      cs:
        usesCs && csMps !== null
          ? {
              csMps,
              efforts: state.fitness.csEfforts,
              since: prediction.trainingSince ?? null,
            }
          : null,
    },
    methods,
    grade: lowestGrade([
      ...gradesOf(methods.flatMap((m) => METHOD_PARAMS[m] ?? [])),
      ...(prediction.trainingSince === undefined ? [] : gradesOf(CS_TRAINING_PARAMS)),
      // The floor of the interval is set by the distance (L2, L4, L6).
      label.grade,
      ...(prediction.rules.includes('L3') ? gradesOf(SINGLE_SOURCE_PARAMS) : []),
      ...(spec.gainM > 0 ? gradesOf(CLIMB_PARAMS) : []),
    ]),
    wide: label.wide,
    singleSource: prediction.rules.includes('L3'),
    climbs: spec.gainM > 0,
    ownClimb: prediction.climb ?? null,
    rules: prediction.rules,
  }
}

/** The prediction row of one course: flat road, or trail when it climbs, no race-day weather. */
export function eventRow(state: AthleteState, spec: EventSpec): EventRow {
  const prediction = predictFromState(state, {
    distanceM: spec.distanceM,
    gainM: spec.gainM,
    surface: spec.gainM > 0 ? 'trail' : 'road',
    wbgtC: null,
  })
  return rowOf(spec, state, prediction)
}

/**
 * The easy pace, the zones' pace comparison, the events and the test, for an athlete as of `today`.
 * The zones themselves are `ZoneSet`, served by their own route.
 */
export function myPaces(input: MyPacesInput, events: readonly EventSpec[]): MyPaces {
  const { state, zones, today } = input
  const sample = hrModelSample(input.activities, today)
  const terrain = gradeCurve(curveRunsOf(input.activities), today)
  const fromLine = hrBasedPace(input, terrain, sample)
  const pace = fromLine.pace ?? zoneBasedPace(zones, terrain)
  return {
    asOf: today,
    easy: {
      pace,
      lineIssue: fromLine.issue,
      zoneRange: zones.pace === null ? null : [zones.pace.z1[0], zones.pace.z1[1]],
      hr: {
        runs: sample.runs,
        need: P.hrModel.minQualifyingRuns.value,
        windowWeeks: P.hrModel.windowWeeks.value,
        minDurationMin: P.hrModel.minDurationMin.value,
        ceiling: ceilingOf(zones) !== null,
      },
    },
    terrain,
    events: events.map((spec) => eventRow(state, spec)),
    test: {
      efforts: state.fitness.csEfforts,
      need: P.a6.csMinEfforts.value,
      minM: P.a6.csMinDistanceM.value,
      maxM: P.a6.csMaxDistanceM.value,
      spreadRatio: P.a6.csMinTimeSpreadRatio.value,
      windowDays: P.a6.csWindowDays.value,
      done: state.fitness.csMps !== null,
      fromTraining: state.fitness.csTrainingSince != null,
    },
  }
}
