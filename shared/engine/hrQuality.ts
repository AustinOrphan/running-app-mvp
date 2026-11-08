// The reading of a stored heart-rate quality summary (rule B2, batch HQ1): whether a run's heart rate
// passes, why not, and the drift on grade-adjusted pace. Pure. The summary is computed on import by
// `shared/importers/files/hrQuality.ts`; the numbers read here (the pass share and the clean time of a
// half) are engine numbers, so a new threshold needs no backfill.
import { TERRAIN_BAND_COUNT as BAND_COUNT } from '../domain/terrainShape.ts'
import type { HrQuality } from '../types.ts'
import { P } from './params/index.ts'

/**
 * Whether a run's heart rate passes: at least `hrModel.minDurationMin` minutes of moving time and,
 * unless the source is an external sensor, at least `b2.qMinCleanShare` of it clean. A strap passes
 * by its source (rule B2); a wrist or unknown source passes on the checks. Engine numbers.
 */
export function hrQualityPasses(quality: HrQuality | null): boolean {
  if (quality === null) return false
  if (quality.movingSec < P.hrModel.minDurationMin.value * 60) return false
  if (quality.source === 'strap') return true
  return quality.cleanSec / quality.movingSec >= P.b2.qMinCleanShare.value
}

/** What most of a failing run's unclean seconds were, or null when it passes. */
export type HrQualityFailure =
  'short' | 'cadence-lock' | 'spikes' | 'dropouts' | 'flat-lines' | 'mismatch'

export function hrQualityFailure(quality: HrQuality): HrQualityFailure | null {
  if (hrQualityPasses(quality)) return null
  if (quality.movingSec < P.hrModel.minDurationMin.value * 60) return 'short'
  const counts: Array<[HrQualityFailure, number]> = [
    ['cadence-lock', quality.lockSec],
    ['spikes', quality.spikeSec],
    ['dropouts', quality.dropSec],
    ['flat-lines', quality.flatSec],
    ['mismatch', quality.mismatchSec],
  ]
  return counts.reduce((best, item) => (item[1] > best[1] ? item : best))[0]
}

/**
 * Drift on grade-adjusted pace, in percent, from the clean time of a run: heart rate per unit of
 * grade-adjusted speed in the second half over the first, minus 1. The speed of a band is divided by
 * its `ratio` to flat (the runner's own ratio where rule I13 shows one, Minetti otherwise; one
 * entry per band of the terrain bins). Null without halves, or when a half has under
 * `b2.qMinHalfCleanMin` clean minutes.
 */
export function gaDecouplingPct(quality: HrQuality, ratios: readonly number[]): number | null {
  const { halves } = quality
  if (!halves || ratios.length !== BAND_COUNT) return null
  const cost: number[] = []
  for (const h of [0, 1] as const) {
    let sec = 0
    let flatM = 0
    let hrSec = 0
    for (let b = 0; b < BAND_COUNT; b++) {
      const ratio = ratios[b]!
      if (!(ratio > 0)) return null
      sec += halves.sec[h][b]!
      flatM += halves.m[h][b]! / ratio
      hrSec += halves.hrSec[h][b]!
    }
    if (sec < P.b2.qMinHalfCleanMin.value * 60 || flatM <= 0 || hrSec <= 0) return null
    cost.push(hrSec / sec / (flatM / sec))
  }
  return Math.round((cost[1]! / cost[0]! - 1) * 10_000) / 100
}
