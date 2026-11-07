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
// the line's own heat term, and `c9.exampleGradePct` through the cost of the grade (rule I11).
//
// Predictions are `predictFromState`, unchanged: no goal, no race-day weather, the courses of the
// caller. The grade of a method is the lowest among the Params it reads.
import type { Activity } from '../types.ts'
import { heatExcessC, hrModelSample, type HrModel } from './execution.ts'
import { P } from './params/index.ts'
import { anchorRaceFor, predictFromState, rangeLabel } from './predict.ts'
import { gradeAdjustedSpeed } from './terrain.ts'
import type { AthleteState, Grade, Param, Prediction, ZoneSet } from './types.ts'

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
  /** The runs the heart-rate line stands on and the day of the earliest; null for the zone bases. */
  sample: { runs: number; since: string } | null
  confidence: 'moderate' | 'low'
  grade: Grade
  /** The example hot day through the line's heat term; null unless the basis is the line. */
  hot: { wbgtC: number; range: PaceBand } | null
  /** The example climb through the cost of the grade. */
  climb: { gradePct: number; range: PaceBand }
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
  /** Critical speed, when the method used it. */
  cs: { csMps: number; efforts: number } | null
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
  rules: string[]
}

export interface MyPaces {
  asOf: string
  easy: {
    pace: EasyPace | null
    /** The Z1 pace range of the zones, whatever the basis, for a comparison; null without one. */
    zoneRange: PaceBand | null
    hr: HrLineNeeds
  }
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

/** The cost of the example climb as a ratio of the flat pace: slower by this factor. */
function climbFactor(): number {
  return gradeAdjustedSpeed(1, P.c9.exampleGradePct.value / PERCENT)
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

/** The slow edge of Z1 from its fast edge, the shape of the zones' own Z1 pace range. */
function bandFromFast(fastSecPerKm: number): PaceBand {
  return [Math.round(fastSecPerKm * P.c2.z1PaceSlowFactor.value), Math.round(fastSecPerKm)]
}

function hrBasedPace(
  input: MyPacesInput,
  sample: { runs: number; first: string | null },
): EasyPace | null {
  const { hrModel, zones, state } = input
  const ceiling = ceilingOf(zones)
  if (hrModel === null || ceiling === null || sample.first === null) return null
  const speed = speedAtHr(hrModel, ceiling)
  // An easy pace at or above critical speed is not easy: the line does not describe that range.
  if (speed === null || (state.fitness.csMps !== null && speed >= state.fitness.csMps)) return null

  const range = bandFromFast(paceOf(speed))
  const hotWbgt = P.i9.warnWbgtC.value
  // The line's heat term is zero only when it was never fitted to any heat; then it says nothing.
  const hot =
    hrModel.heatBpmPerC > 0
      ? speedAtHr(hrModel, ceiling - hrModel.heatBpmPerC * heatExcessC(hotWbgt))
      : null
  const factor = climbFactor()
  return {
    basis: 'hr-model',
    range,
    ceilingBpm: ceiling,
    sample: { runs: hrModel.runs, since: sample.first },
    confidence: zones.lt1Hr?.source === 'hrmax-age' ? 'low' : 'moderate',
    grade: lowestGrade(gradesOf([P.hrModel.minQualifyingRuns, P.c2.z1PaceSlowFactor])),
    hot: hot === null ? null : { wbgtC: hotWbgt, range: bandFromFast(paceOf(hot)) },
    climb: { gradePct: P.c9.exampleGradePct.value, range: scaleBand(range, factor) },
    rules: ['C9', 'C2', 'C4', 'A8', 'I11', ...(hot === null ? [] : ['I7', 'I9'])].sort(),
  }
}

function zoneBasedPace(zones: ZoneSet): EasyPace | null {
  const z1 = zones.pace?.z1 ?? null
  const source = zones.lt1PaceSecPerKm?.source ?? null
  if (z1 === null || source === null || !(z1[1] > 0)) return null
  const tested = source === 'profile'
  return {
    basis: tested ? 'threshold-pace' : 'critical-speed',
    range: [z1[0], z1[1]],
    ceilingBpm: null,
    sample: null,
    confidence: tested ? 'moderate' : 'low',
    grade: lowestGrade(gradesOf([P.c2.z1PaceSlowFactor, ...(tested ? [] : [P.c4.lt1CsFraction])])),
    hot: null,
    climb: {
      gradePct: P.c9.exampleGradePct.value,
      range: scaleBand([z1[0], z1[1]], climbFactor()),
    },
    rules: ['C9', 'C2', tested ? 'C5' : 'C4', 'I11'].sort(),
  }
}

/** Methods that read a race, and methods that read critical speed (`predictFromState`). */
const RACE_METHODS = new Set(['personal-exponent', 'riegel', 'same-distance', 'single-anchor'])
const CS_METHODS = new Set(['critical-speed', 'cs-durability', 'cs-fraction'])

/** The Params a method of `predictFromState` stands on, for its grade. */
const METHOD_PARAMS: Record<string, ReadonlyArray<Param<unknown>>> = {
  'personal-exponent': [P.l1.personalExponentMinRaces],
  riegel: [P.l1.riegelExponent],
  'same-distance': [P.l1.sameDistanceTolerancePct],
  'single-anchor': [P.l2.singleAnchorSlowdownPct],
  'critical-speed': [P.l1.csExtrapolationMaxMin],
  'cs-durability': [P.l2.csFractionLowDecoupling],
  'cs-fraction': [P.l2.csFractionAt150Min],
}

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
      cs: usesCs && csMps !== null ? { csMps, efforts: state.fitness.csEfforts } : null,
    },
    methods,
    grade: lowestGrade([
      ...gradesOf(methods.flatMap((m) => METHOD_PARAMS[m] ?? [])),
      // The floor of the interval is set by the distance (L2, L4, L6).
      label.grade,
      ...(spec.gainM > 0 ? gradesOf([P.l5.gainEquivalentM]) : []),
    ]),
    wide: label.wide,
    singleSource: prediction.rules.includes('L3'),
    climbs: spec.gainM > 0,
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
  const pace = hrBasedPace(input, sample) ?? zoneBasedPace(zones)
  return {
    asOf: today,
    easy: {
      pace,
      zoneRange: zones.pace === null ? null : [zones.pace.z1[0], zones.pace.z1[1]],
      hr: {
        runs: sample.runs,
        need: P.hrModel.minQualifyingRuns.value,
        windowWeeks: P.hrModel.windowWeeks.value,
        minDurationMin: P.hrModel.minDurationMin.value,
        ceiling: ceilingOf(zones) !== null,
      },
    },
    events: events.map((spec) => eventRow(state, spec)),
    test: {
      efforts: state.fitness.csEfforts,
      need: P.a6.csMinEfforts.value,
      minM: P.a6.csMinDistanceM.value,
      maxM: P.a6.csMaxDistanceM.value,
      spreadRatio: P.a6.csMinTimeSpreadRatio.value,
      windowDays: P.a6.csWindowDays.value,
      done: state.fitness.csMps !== null,
    },
  }
}
