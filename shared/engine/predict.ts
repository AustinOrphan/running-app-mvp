// Race prediction with an interval and its method [rules section l]. Pure: no I/O, no clock.
import type { RangeLabel } from '../types.ts'
import { estimateState } from './athlete.ts'
import { heatPenaltyPct } from './heat.ts'
import { P } from './params/index.ts'
import type { AthleteState, ClimbBlend, EngineInput, Param, Prediction } from './types.ts'

/** What is being predicted: the course, not the athlete. */
export interface PredictTarget {
  distanceM: number
  gainM: number
  surface: 'road' | 'trail' | 'track' | 'mixed'
  /** Race-day WBGT, or null when unknown (no heat term). */
  wbgtC: number | null
}

interface Estimate {
  method: string
  sec: number
  rules: string[]
  conditions: string[]
}

interface Base {
  sec: number
  estimates: Estimate[]
}

/** Race anchors the state carries (date, distance, time). */
type Race = AthleteState['fitness']['races'][number]

const SEC_PER_MIN = 60
const FIXED_POINT_ITERATIONS = 400
const FIXED_POINT_TOLERANCE_MIN = 1e-7

function fmtTime(sec: number): string {
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** A signed change in whole minutes ("+1 min", "-2 min"); under half a minute reads in words. */
export function signedMinutes(sec: number): string {
  const min = Math.round(Math.abs(sec) / SEC_PER_MIN)
  if (min === 0) return 'less than a minute'
  return `${sec < 0 ? '-' : '+'}${min} min`
}

function fmtKm(m: number): string {
  return `${(Math.round(m / 100) / 10).toFixed(1)} km`
}

/**
 * Distance with gain converted to flat metres; road models and race anchors are flat-equivalent.
 * `gainEquivalentM` is `l5.gainEquivalentM` unless the runner's own climbing is blended in.
 */
function effectiveDistanceM(
  target: PredictTarget,
  gainEquivalentM: number = P.l5.gainEquivalentM.value,
): number {
  return target.distanceM + Math.max(0, target.gainM) * gainEquivalentM
}

/** The race closest to the target distance (log scale); ties go to the later date. */
function nearestAnchor(races: Race[], distanceM: number): Race | null {
  let best: Race | null = null
  let bestGap = Infinity
  for (const race of races) {
    if (!(race.distanceM > 0) || !(race.timeSec > 0)) continue
    const gap = Math.abs(Math.log(race.distanceM / distanceM))
    const tie = Math.abs(gap - bestGap) <= 1e-12
    if (gap < bestGap - 1e-12 || (tie && best !== null && race.date > best.date)) {
      best = race
      bestGap = gap
    }
  }
  return best
}

/**
 * The race a prediction for this course is anchored on (rule L1): the one nearest in distance on
 * the log scale, climb counted as flat distance (L5). Null without a race. Whether the prediction
 * used it is `Prediction.method`; the page names it only when it did.
 */
export function anchorRaceFor(state: AthleteState, target: PredictTarget): Race | null {
  return nearestAnchor(state.fitness.races, effectiveDistanceM(target))
}

function distinctDistances(races: Race[]): number {
  return new Set(races.map((r) => Math.round(r.distanceM / 10))).size
}

/** L1: personal exponent, then Riegel up to 21.1 km, then the single-anchor placeholder [L2]. */
function raceEstimate(
  state: AthleteState,
  target: PredictTarget,
  gainEquivalentM: number,
): Estimate | null {
  const races = state.fitness.races
  const dEff = effectiveDistanceM(target, gainEquivalentM)
  // The anchor is chosen with the default figure, so the blend scales a time and never swaps the race.
  const anchor = nearestAnchor(races, effectiveDistanceM(target))
  if (!anchor) return null
  const anchorText = `${fmtKm(anchor.distanceM)} in ${fmtTime(anchor.timeSec)} on ${anchor.date}`
  const scaled = (exponent: number) => anchor.timeSec * Math.pow(dEff / anchor.distanceM, exponent)

  const exponent = state.fitness.exponent
  if (exponent !== null && distinctDistances(races) >= P.l1.personalExponentMinRaces.value) {
    return {
      method: 'personal-exponent',
      sec: scaled(exponent),
      rules: ['L1'],
      conditions: [
        `Personal exponent ${exponent.toFixed(3)} from ${distinctDistances(races)} race distances, anchored on ${anchorText}.`,
      ],
    }
  }
  if (target.distanceM <= P.l1.riegelMaxTargetM.value) {
    return {
      method: 'riegel',
      sec: scaled(P.l1.riegelExponent.value),
      rules: ['L1'],
      conditions: [`Riegel exponent ${P.l1.riegelExponent.value} from ${anchorText}.`],
    }
  }
  // L1, L4: a race at the target distance anchors it directly, marathons and ultras included.
  if (
    Math.abs(Math.log(anchor.distanceM / dEff)) <=
    Math.log(1 + P.l1.sameDistanceTolerancePct.value / 100)
  ) {
    const ultra = target.distanceM > P.d1.ultraAboveM.value
    return {
      method: 'same-distance',
      sec: scaled(P.l1.riegelExponent.value),
      rules: ['L1', ultra ? 'L4' : 'L2'],
      conditions: [`A race at about the target distance: ${anchorText}.`],
    }
  }
  if (
    target.distanceM <= P.d1.ultraAboveM.value &&
    anchor.distanceM <= P.l2.singleAnchorMaxM.value
  ) {
    const slow = 1 + P.l2.singleAnchorSlowdownPct.value / 100
    return {
      method: 'single-anchor',
      sec: scaled(P.l1.riegelExponent.value) * slow,
      rules: ['L1', 'L2'],
      conditions: [
        `One race at ${fmtKm(anchor.distanceM)} (${anchorText}) with a ${P.l2.singleAnchorSlowdownPct.value}% placeholder slowdown for the longer distance.`,
      ],
    }
  }
  return null
}

/** Fraction of CS sustainable for a duration in minutes [L2, L4]: a prior, not a fit. */
export function csFractionAtMin(minutes: number): number {
  const points: Array<[number, number]> = [
    [P.l1.csExtrapolationMaxMin.value, P.l2.csFractionAt60Min.value],
    [P.l2.csFractionShortMin.value, P.l2.csFractionAt150Min.value],
    [P.l2.csFractionLongMin.value, P.l2.csFractionAt360Min.value],
  ]
  const [t0, f0] = points[0] as [number, number]
  if (minutes <= t0) return f0
  for (let i = 1; i < points.length; i++) {
    const [ta, fa] = points[i - 1] as [number, number]
    const [tb, fb] = points[i] as [number, number]
    if (minutes <= tb) return fa + ((fb - fa) * (minutes - ta)) / (tb - ta)
  }
  const [ta, fa] = points[1] as [number, number]
  const [tb, fb] = points[2] as [number, number]
  const slope = (fb - fa) / (tb - ta)
  return Math.max(P.l4.csFractionFloor.value, fb + slope * (minutes - tb))
}

/** Durability descriptor from the median decoupling (percent); null when unknown [L2]. */
function durabilityFraction(state: AthleteState): { fraction: number; label: string } | null {
  const pct = state.durability.decouplingMedianPct
  if (pct === null) return null
  const ratio = 1 + pct / 100
  const low = P.l2.csFractionLowDecoupling.value
  const high = P.l2.csFractionHighDecoupling.value
  if (ratio < P.l2.decouplingLowBelow.value) return { fraction: low, label: 'low decoupling' }
  if (ratio >= P.l2.decouplingHighFrom.value) return { fraction: high, label: 'high decoupling' }
  return { fraction: (low + high) / 2, label: 'moderate decoupling' }
}

/** Solves t = D / (CS f(t)) by damped fixed-point iteration; deterministic. */
function solveFractionTimeSec(distanceM: number, csMps: number): number {
  let minutes = distanceM / (csMps * P.l2.csFractionAt150Min.value) / SEC_PER_MIN
  for (let i = 0; i < FIXED_POINT_ITERATIONS; i++) {
    const next = distanceM / (csMps * csFractionAtMin(minutes)) / SEC_PER_MIN
    const damped = (minutes + next) / 2
    const done = Math.abs(damped - minutes) < FIXED_POINT_TOLERANCE_MIN
    minutes = damped
    if (done) break
  }
  return minutes * SEC_PER_MIN
}

/** L1: CS fit up to 60 min; beyond that the CS-fraction prior with durability [L2, L4]. */
function csEstimate(
  state: AthleteState,
  target: PredictTarget,
  gainEquivalentM: number,
): Estimate | null {
  const cs = state.fitness.csMps
  if (cs === null || !(cs > 0)) return null
  const dEff = effectiveDistanceM(target, gainEquivalentM)
  const dPrime = Math.max(0, state.fitness.dPrimeM ?? 0)
  const fitSec = dEff > dPrime ? (dEff - dPrime) / cs : dEff / cs
  if (fitSec <= P.l1.csExtrapolationMaxMin.value * SEC_PER_MIN) {
    return {
      method: 'critical-speed',
      sec: fitSec,
      rules: ['L1'],
      conditions: [
        `Critical speed ${cs.toFixed(2)} m/s with D' ${Math.round(dPrime)} m, extrapolated to ${Math.round(fitSec / SEC_PER_MIN)} min (limit ${P.l1.csExtrapolationMaxMin.value} min).`,
      ],
    }
  }
  const marathonish =
    target.distanceM > P.d1Class.halfUpperM.value && target.distanceM <= P.d1.ultraAboveM.value
  const durability = marathonish ? durabilityFraction(state) : null
  if (durability) {
    return {
      method: 'cs-durability',
      sec: dEff / (cs * durability.fraction),
      rules: ['L1', 'L2'],
      conditions: [
        `${Math.round(durability.fraction * 100)}% of critical speed (${durability.label}) for the marathon range.`,
      ],
    }
  }
  return {
    method: 'cs-fraction',
    sec: solveFractionTimeSec(dEff, cs),
    rules: ['L1', 'L2', ...(target.distanceM > P.d1.ultraAboveM.value ? ['L4'] : [])],
    conditions: [
      `Critical-speed fraction prior (${P.l2.csFractionAt150Min.value} of CS at 150 min, ${P.l2.csFractionAt360Min.value} at 360 min) for a target beyond the fitted range.`,
    ],
  }
}

/** Mean of the available estimates, flat road conditions, no heat. */
function basePrediction(
  state: AthleteState,
  target: PredictTarget,
  gainEquivalentM: number = P.l5.gainEquivalentM.value,
): Base | null {
  const estimates = [
    raceEstimate(state, target, gainEquivalentM),
    csEstimate(state, target, gainEquivalentM),
  ].filter((e): e is Estimate => e !== null)
  if (estimates.length === 0) return null
  const sec = estimates.reduce((sum, e) => sum + e.sec, 0) / estimates.length
  return { sec, estimates }
}

/**
 * The runner's own climbing blended into the gain-equivalent [rule L5]: `default + w * (personal -
 * default)`, with `w` smaller when the personal value would make the runner faster (G6), and the
 * change to the time held to `l5.personalBlendMaxShiftPct` of the default prediction. Null when the
 * course has no gain, the state has no personal climbing band, or the blend moves nothing.
 */
function climbBlend(
  state: AthleteState,
  target: PredictTarget,
  base: Base,
): { blend: ClimbBlend; base: Base } | null {
  const personal = state.climb
  if (!personal || !(target.gainM > 0)) return null
  const defaultM = P.l5.gainEquivalentM.value
  const weight =
    personal.gainEquivalentM < defaultM
      ? P.l5.personalBlendFaster.value
      : P.l5.personalBlendSlower.value
  const blendedM = defaultM + weight * (personal.gainEquivalentM - defaultM)
  const blended = basePrediction(state, target, blendedM)
  if (!blended) return null
  const raw = blended.sec - base.sec
  const cap = (P.l5.personalBlendMaxShiftPct.value / 100) * base.sec
  const capped = Math.abs(raw) > cap
  // Past the cap the figure is scaled back with the time, so the splits weigh climb as the time does.
  const keep = capped ? cap / Math.abs(raw) : 1
  const shift = raw * keep
  if (Math.round(shift) === 0) return null
  return {
    base: { ...base, sec: base.sec + shift },
    blend: {
      runs: personal.runs,
      defaultM,
      personalM: personal.gainEquivalentM,
      usedM: defaultM + keep * (blendedM - defaultM),
      shiftSec: shift,
      capped,
    },
  }
}

/** The Param that sets the least half-width of the interval for a course of this distance. */
function halfWidthFloor(distanceM: number): Param {
  if (distanceM <= P.l1.riegelMaxTargetM.value) return P.l6.minBandPct
  if (distanceM <= P.d1.ultraAboveM.value) return P.l2.marathonMinHalfWidthPct
  return P.l4.ultraMinHalfWidthPct
}

function minHalfWidthPct(target: PredictTarget): number {
  return halfWidthFloor(target.distanceM).value
}

/**
 * How wide a prediction for this course has to be: the interval floor of `predictFromState` with
 * the rules that set it and its grade, so the Today countdown labels the range from the same
 * Params the interval uses [rules L2, L4, L6]. `wide` is true for an ultra, where the floor is a
 * grade D default and the range is wide on purpose; the label never narrows an interval.
 */
export function rangeLabel(target: Pick<PredictTarget, 'distanceM'>): RangeLabel {
  const floor = halfWidthFloor(target.distanceM)
  return {
    wide: target.distanceM > P.d1.ultraAboveM.value,
    minHalfWidthPct: floor.value,
    rules: [...new Set([floor.rule, 'L6'])].sort(),
    grade: floor.grade,
  }
}

/**
 * Prediction for a course from an athlete state. Uses every source the state supports (a race
 * anchor, a critical-speed fit), averages them, and states the interval and the method [L1-L6].
 * Null when the state supports no source at all.
 */
export function predictFromState(state: AthleteState, target: PredictTarget): Prediction | null {
  if (!(target.distanceM > 0)) return null
  const defaultBase = basePrediction(state, target)
  if (!defaultBase) return null
  const climb = climbBlend(state, target, defaultBase)
  const base = climb?.base ?? defaultBase

  const rules = new Set<string>(['L6'])
  const conditions: string[] = []
  for (const e of base.estimates) {
    e.rules.forEach((r) => rules.add(r))
    conditions.push(...e.conditions)
  }

  let sec = base.sec
  if (target.gainM > 0) {
    const flatKm = fmtKm(target.gainM * (climb?.blend.usedM ?? P.l5.gainEquivalentM.value))
    conditions.push(`${Math.round(target.gainM)} m of gain counted as ${flatKm} of flat distance.`)
    rules.add('L5')
  }

  if (target.wbgtC !== null) {
    const marathon = basePrediction(state, {
      distanceM: P.l2.marathonDistanceM.value,
      gainM: 0,
      surface: 'road',
      wbgtC: null,
    })
    if (marathon) {
      const pct = heatPenaltyPct(target.wbgtC, marathon.sec)
      sec *= 1 + pct / 100
      conditions.push(
        `Race-day WBGT ${target.wbgtC.toFixed(1)} C adds ${pct.toFixed(1)}% to the time.`,
      )
      rules.add('I2')
    } else {
      conditions.push(
        'Race-day heat is not applied: no marathon-equivalent ability to scale it by.',
      )
    }
  }

  // Heat scales the whole time, so it scales the shift from the runner's own climbing too.
  const climbShiftSec = climb === null ? 0 : climb.blend.shiftSec * (sec / base.sec)
  if (climb !== null) {
    conditions.push(
      `Includes your own speed on climbs from ${climb.blend.runs} runs, moving this by ${signedMinutes(climbShiftSec)}.`,
    )
  }

  // Interval: at least the band for the distance, at least the spread between sources.
  let halfWidth = minHalfWidthPct(target)
  const [first, second] = base.estimates
  if (first && second) {
    halfWidth = Math.max(
      halfWidth,
      (Math.abs(first.sec - second.sec) / (first.sec + second.sec)) * 100,
    )
  }
  if (base.estimates.length < P.l3.minSources.value) {
    halfWidth *= 1 + P.l3.singleSourceWideningPct.value / 100
    conditions.push(
      `Only one source supports this prediction (rule L3 asks for ${P.l3.minSources.value}); the interval is widened by ${P.l3.singleSourceWideningPct.value}%.`,
    )
    rules.add('L3')
  }
  if (target.surface === 'trail' || target.surface === 'mixed') {
    const gainPerKm = (Math.max(0, target.gainM) / target.distanceM) * 1000
    const widening =
      P.l5.trailIntervalWideningPct.value + P.l5.gainWideningPctPerMPerKm.value * gainPerKm
    halfWidth *= 1 + widening / 100
    conditions.push(
      `Trail course: road models explain trail performance less well; the interval is widened by ${Math.round(widening)}%.`,
    )
    rules.add('L5')
  }

  return {
    method: base.estimates.map((e) => e.method).join('+'),
    predictedSec: Math.round(sec),
    lowSec: Math.round(sec * (1 - halfWidth / 100)),
    highSec: Math.round(sec * (1 + halfWidth / 100)),
    conditions,
    rules: [...rules].sort(),
    ...(climb === null ? {} : { climb: { ...climb.blend, shiftSec: Math.round(climbShiftSec) } }),
  }
}

/** Race prediction with an interval and its method [rules section l]. */
export function predictRace(input: EngineInput): Prediction | null {
  const goal = input.goal
  return predictFromState(estimateState(input), {
    distanceM: goal.distanceM,
    gainM: goal.gainM,
    surface: goal.surface,
    wbgtC: goal.raceWbgtC,
  })
}
