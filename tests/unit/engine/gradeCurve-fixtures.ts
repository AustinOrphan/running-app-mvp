// Synthetic runs for the personal grade curve (rule I13): terrain bins built from a known "true"
// curve with seeded noise, so a test can say what the backtest should find. Nothing here is real
// data. Used by `gradeCurve.test.ts` and the report `tests/reports/grade-curve-report.ts`.
import { addDays } from '../../../shared/dates.ts'
import type { GradeCurveRun } from '../../../shared/engine/gradeCurve.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { minettiCost } from '../../../shared/engine/terrain.ts'
import {
  TERRAIN_BINS_VERSION,
  TERRAIN_EDGES_PCT,
  TERRAIN_WINDOW_M,
} from '../../../shared/domain/terrainShape.ts'
import type { TerrainBins } from '../../../shared/types.ts'

/** Mulberry32: a small seeded generator, so every run of a test or the report agrees. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal from two uniforms. */
function normal(next: () => number): number {
  const u = Math.max(next(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
}

const BANDS = TERRAIN_EDGES_PCT.length + 1
const FLAT = TERRAIN_EDGES_PCT.filter((edge) => edge <= 0).length
/** Middle grades of the nine bands, as the curve reads them. */
const MIDS = [-17.5, -12.5, -8, -4.5, 0, 4.5, 8, 12.5, 17.5]

/** Minetti's speed ratio at each band: the curve a runner who follows the default would have. */
export const MINETTI_RATIOS: number[] = MIDS.map((mid) => 1 / minettiCost(mid / 100))

/** A runner whose speed gain and loss on grades is `k` times Minetti's (1 = Minetti, 0 = ignores grade). */
export function scaledCurve(k: number): number[] {
  return MINETTI_RATIOS.map((ratio) => 1 + k * (ratio - 1))
}

export interface SyntheticAthlete {
  /** True speed in each band over flat speed. */
  ratios: number[]
  /** Share of time in each band for an average run (sums to 1). */
  timeShare: number[]
  /** Share of each band's time under the walking floor. */
  walkShare: number[]
  /** Relative day-to-day noise on a band's ratio (standard deviation). */
  noise: number
  /** Flat-speed variation written into the bins. */
  flatCv: number
}

/** Rolling terrain: most time near flat, little beyond 10%. */
export const ROLLING_SHARE = [0.01, 0.03, 0.08, 0.16, 0.4, 0.16, 0.1, 0.05, 0.01]
export const WALK_SHARE = [0, 0, 0, 0, 0.02, 0.05, 0.2, 0.55, 0.85]

export function athlete(ratios: number[], noise = 0.04): SyntheticAthlete {
  return { ratios, timeShare: ROLLING_SHARE, walkShare: WALK_SHARE, noise, flatCv: 0.08 }
}

/** Bins of one run: `minutes` of moving time, a flat speed of the day, noise on each band. */
export function syntheticBins(
  who: SyntheticAthlete,
  minutes: number,
  flatMps: number,
  next: () => number,
): TerrainBins {
  const sec = new Array<number>(BANDS).fill(0)
  const m = new Array<number>(BANDS).fill(0)
  const walkSec = new Array<number>(BANDS).fill(0)
  for (let b = 0; b < BANDS; b++) {
    // a ragged amount of time in each band, from run to run
    const seconds = Math.round(minutes * 60 * who.timeShare[b]! * (0.6 + 0.8 * next()))
    sec[b] = seconds
    const ratio = who.ratios[b]! * (b === FLAT ? 1 : 1 + who.noise * normal(next))
    m[b] = seconds * flatMps * ratio
    walkSec[b] = Math.round(seconds * who.walkShare[b]!)
  }
  return {
    v: TERRAIN_BINS_VERSION,
    windowM: TERRAIN_WINDOW_M,
    walkMps: P.c9.walkingFloorMps.value,
    edgesPct: [...TERRAIN_EDGES_PCT],
    sec,
    m,
    walkSec,
    flatCv: who.flatCv,
  }
}

/** `count` runs on consecutive days ending the day before `today`, each 60 to 100 minutes. */
export function syntheticRuns(
  who: SyntheticAthlete,
  count: number,
  today: string,
  seed: number,
  everyDays = 3,
): GradeCurveRun[] {
  const next = rng(seed)
  return Array.from({ length: count }, (_, i) => ({
    id: `run-${seed}-${i}`,
    date: addDays(today, -1 - i * everyDays),
    bins: syntheticBins(who, 60 + 40 * next(), 2.6 + 0.8 * next(), next),
  }))
}
