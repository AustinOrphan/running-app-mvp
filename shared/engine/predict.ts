// Race prediction with an interval and its method [rules section l]. Pure: no I/O, no clock.
import { estimateState } from './athlete.ts'
import { heatPenaltyPct } from './heat.ts'
import { P } from './params/index.ts'
import type { AthleteState, EngineInput, Prediction } from './types.ts'

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

function fmtKm(m: number): string {
  return `${(Math.round(m / 100) / 10).toFixed(1)} km`
}

/** Distance with gain converted to flat metres; road models and race anchors are flat-equivalent. */
function effectiveDistanceM(target: PredictTarget): number {
  return target.distanceM + Math.max(0, target.gainM) * P.l5.gainEquivalentM.value
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

function distinctDistances(races: Race[]): number {
  return new Set(races.map((r) => Math.round(r.distanceM / 10))).size
}

/** L1: personal exponent, then Riegel up to 21.1 km, then the single-anchor placeholder [L2]. */
function raceEstimate(state: AthleteState, target: PredictTarget): Estimate | null {
  const races = state.fitness.races
  const dEff = effectiveDistanceM(target)
  const anchor = nearestAnchor(races, dEff)
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
function csEstimate(state: AthleteState, target: PredictTarget): Estimate | null {
  const cs = state.fitness.csMps
  if (cs === null || !(cs > 0)) return null
  const dEff = effectiveDistanceM(target)
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
function basePrediction(state: AthleteState, target: PredictTarget): Base | null {
  const estimates = [raceEstimate(state, target), csEstimate(state, target)].filter(
    (e): e is Estimate => e !== null,
  )
  if (estimates.length === 0) return null
  const sec = estimates.reduce((sum, e) => sum + e.sec, 0) / estimates.length
  return { sec, estimates }
}

function minHalfWidthPct(target: PredictTarget): number {
  if (target.distanceM <= P.l1.riegelMaxTargetM.value) return P.l6.minBandPct.value
  if (target.distanceM <= P.d1.ultraAboveM.value) return P.l2.marathonMinHalfWidthPct.value
  return P.l4.ultraMinHalfWidthPct.value
}

/**
 * Prediction for a course from an athlete state. Uses every source the state supports (a race
 * anchor, a critical-speed fit), averages them, and states the interval and the method [L1-L6].
 * Null when the state supports no source at all.
 */
export function predictFromState(state: AthleteState, target: PredictTarget): Prediction | null {
  if (!(target.distanceM > 0)) return null
  const base = basePrediction(state, target)
  if (!base) return null

  const rules = new Set<string>(['L6'])
  const conditions: string[] = []
  for (const e of base.estimates) {
    e.rules.forEach((r) => rules.add(r))
    conditions.push(...e.conditions)
  }

  let sec = base.sec
  if (target.gainM > 0) {
    const flatKm = fmtKm(target.gainM * P.l5.gainEquivalentM.value)
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
