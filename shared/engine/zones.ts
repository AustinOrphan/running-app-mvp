// Zones with the anchor hierarchy and a recorded source per boundary [rules section c].
import { P } from './params/index.ts'
import type { AthleteProfile } from '../types.ts'
import type { AthleteState, Boundary, ZoneSet } from './types.ts'

type HrMaxSource = Extract<Boundary['source'], 'hrmax-observed' | 'hrmax-age' | 'profile'>

/** Pace in sec/km for a speed in m/s. */
function paceOf(speedMps: number): number {
  return 1000 / speedMps
}

function percentBand(value: number, pct: number): [number, number] {
  return [value * (1 - pct / 100), value * (1 + pct / 100)]
}

function hrBoundary(
  value: number,
  halfWidthBpm: number,
  source: Boundary['source'],
  asOf: string,
): Boundary {
  return {
    value: Math.round(value),
    band: [Math.round(value - halfWidthBpm), Math.round(value + halfWidthBpm)],
    source,
    asOf,
  }
}

function paceBoundary(paceSecPerKm: number, source: Boundary['source'], asOf: string): Boundary {
  const [low, high] = percentBand(paceSecPerKm, P.c7.bandDefaultPacePct.value)
  return {
    value: Math.round(paceSecPerKm),
    band: [Math.round(low), Math.round(high)],
    source,
    asOf,
  }
}

/** Age in whole years at `today`, from the state or from the profile's birth year. */
function ageAt(profile: AthleteProfile, state: AthleteState, today: string): number | null {
  if (state.age !== null) return state.age
  if (profile.birthYear === null) return null
  return Number(today.slice(0, 4)) - profile.birthYear
}

/**
 * HRmax anchor [rules C3]: an observed maximum when the profile holds a measured one, else a
 * value the profile carries without a measurement, else the age prior (208 - 0.7 x age, +-10.8).
 * The profile has no measurement date, so an old observation is not aged down.
 */
function hrMaxBoundary(
  profile: AthleteProfile,
  state: AthleteState,
  today: string,
): { boundary: Boundary; source: HrMaxSource } | null {
  if (profile.hrMax !== null) {
    const source: HrMaxSource = profile.hrMaxSource === 'measured' ? 'hrmax-observed' : 'profile'
    return {
      boundary: hrBoundary(profile.hrMax, P.c7.bandDefaultBpm.value, source, today),
      source,
    }
  }
  const age = ageAt(profile, state, today)
  if (age === null || age < 0) return null
  const value = P.c3.hrMaxIntercept.value - P.c3.hrMaxAgeSlope.value * age
  return {
    boundary: hrBoundary(value, P.c3.priorBandBpm.value, 'hrmax-age', today),
    source: 'hrmax-age',
  }
}

/**
 * Zones with the anchor hierarchy and a recorded source per boundary [rules section c].
 *
 * Pace anchors, in order: a threshold pace the profile carries (tested), then critical speed from
 * the state (a proxy). Threshold pace is critical speed minus the margin of rule C5 (the
 * well-trained margin for the `trained` experience class, the general one otherwise), and the
 * Z1/Z2 boundary is 82.3% of critical speed [rules C4]. After a break of `c8.breakDays` or more
 * the pace anchors are dropped, so targets fall back to heart rate and effort until fresh data
 * exists [rules C8].
 *
 * Heart-rate boundaries: a lactate-threshold HR from the profile, else a share of HRmax (tier 3,
 * grade D) with the band of the HRmax anchor. %HRR is not used: it is ranked last and no better
 * than %HRmax [rules C2]. Every boundary keeps its band [rules C7] and its source.
 */
export function buildZones(profile: AthleteProfile, state: AthleteState, today: string): ZoneSet {
  const hrMaxAnchor = hrMaxBoundary(profile, state, today)
  const hrMax = hrMaxAnchor?.boundary ?? null
  const hrRest = profile.hrRest

  // Pace anchors.
  const afterBreak = state.layoffDays >= P.c8.breakDays.value
  const marginKmh =
    state.experience === 'trained'
      ? P.c5.thresholdMarginWellTrainedKmh.value
      : P.c5.thresholdMarginOtherKmh.value
  const marginMps = marginKmh / 3.6
  const stateCs = !afterBreak ? state.fitness.csMps : null
  const profileThreshold = !afterBreak ? profile.thresholdPaceSecPerKm : null

  let csEquivalentMps: number | null = null
  let thresholdPace: number | null = null
  let paceSource: Boundary['source'] = 'cs'
  if (profileThreshold !== null && profileThreshold > 0) {
    thresholdPace = profileThreshold
    csEquivalentMps = 1000 / profileThreshold + marginMps
    paceSource = 'profile'
  } else if (stateCs !== null && stateCs > 0) {
    csEquivalentMps = stateCs
    thresholdPace = paceOf(stateCs - marginMps)
    paceSource = 'cs'
  }

  const csMps: Boundary | null =
    stateCs !== null && stateCs > 0
      ? {
          value: Math.round(stateCs * 1000) / 1000,
          band: [
            Math.round(percentBand(stateCs, P.c7.bandDefaultPacePct.value)[0] * 1000) / 1000,
            Math.round(percentBand(stateCs, P.c7.bandDefaultPacePct.value)[1] * 1000) / 1000,
          ],
          source: 'cs',
          asOf: today,
        }
      : null
  const lt1PaceValue =
    csEquivalentMps !== null ? paceOf(csEquivalentMps * P.c4.lt1CsFraction.value) : null
  const lt1PaceSecPerKm =
    lt1PaceValue !== null ? paceBoundary(lt1PaceValue, paceSource, today) : null
  const thresholdPaceSecPerKm =
    thresholdPace !== null ? paceBoundary(thresholdPace, paceSource, today) : null

  // Heart-rate boundaries.
  const lt1Frac = P.c2.lt1FractionOfHrMax.value
  const lt2Frac = P.c2.lt2FractionOfHrMax.value
  const bandDefault = P.c7.bandDefaultBpm.value
  let lt1Hr: Boundary | null = null
  let lt2Hr: Boundary | null = null
  if (profile.lthr !== null && profile.lthr > 0) {
    lt2Hr = hrBoundary(profile.lthr, bandDefault, 'profile', today)
    lt1Hr = hrBoundary(profile.lthr * (lt1Frac / lt2Frac), bandDefault, 'profile', today)
  } else if (hrMaxAnchor) {
    const halfWidth = (hrMaxAnchor.boundary.band[1] - hrMaxAnchor.boundary.band[0]) / 2
    const hrMaxValue = hrMaxAnchor.boundary.value
    lt1Hr = hrBoundary(hrMaxValue * lt1Frac, halfWidth * lt1Frac, hrMaxAnchor.source, today)
    lt2Hr = hrBoundary(hrMaxValue * lt2Frac, halfWidth * lt2Frac, hrMaxAnchor.source, today)
  }

  let hr: ZoneSet['hr'] = null
  if (hrMax && lt1Hr && lt2Hr) {
    const floorByFraction = Math.round(hrMax.value * P.c2.z1FloorFractionOfHrMax.value)
    const floor = hrRest !== null && hrRest > 0 && hrRest < lt1Hr.value ? hrRest : floorByFraction
    hr = {
      z1: [floor, lt1Hr.value],
      z2: [lt1Hr.value, lt2Hr.value],
      z3: [lt2Hr.value, Math.max(hrMax.value, lt2Hr.value)],
    }
  }

  let pace: ZoneSet['pace'] = null
  if (lt1PaceSecPerKm && thresholdPaceSecPerKm && csEquivalentMps !== null) {
    pace = {
      z1: [Math.round(lt1PaceSecPerKm.value * P.c2.z1PaceSlowFactor.value), lt1PaceSecPerKm.value],
      z2: [lt1PaceSecPerKm.value, thresholdPaceSecPerKm.value],
      z3: [thresholdPaceSecPerKm.value, Math.round(paceOf(csEquivalentMps))],
    }
  }

  return {
    hrMax,
    hrRest,
    lt1Hr,
    lt2Hr,
    csMps,
    lt1PaceSecPerKm,
    thresholdPaceSecPerKm,
    hr,
    pace,
    rpe: { z1: P.c4.rpeZ1.value, z2: P.c4.rpeZ2.value, z3: P.c4.rpeZ3.value },
  }
}
