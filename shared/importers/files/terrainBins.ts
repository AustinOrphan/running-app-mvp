// Terrain bins of one run: time, distance and walking time by grade band, from the stored 10 s
// stream (distance and altitude only; no heart rate). The personal grade curve (rule I13) divides
// each band's speed by the run's own flat speed. Pure and free of Node-only imports, so the import
// and the backfill call the same function over the same stream and agree to the digit.
//
// Every number below is data preparation, not an engine decision: it fixes what the stored bins
// mean. The thresholds the curve applies to them (minutes per band, runs per band, shrinkage) are
// the I13 Params of the grade-curve batch. The one engine number used here, the walking floor, is
// `c9.walkingFloorMps`, and the value used is stored with the bins.
import { P } from '../../engine/params/index.ts'
import type { ActivityStreamData, ActivityType, TerrainBins } from '../../types.ts'

/** Version of the stored shape. A change of the edges, the window or the rules below raises it. */
export const TERRAIN_BINS_VERSION = 1
/**
 * Distance the grade is measured over, in metres. A distance window, not the time window of the
 * gap-distance grade, so a slow climb is no noisier than a fast one. Data preparation: about the
 * smallest span over which the rounded altitude steps and GNSS height noise (a few metres) stop
 * dominating a grade of a few percent. Stored with the bins.
 */
export const TERRAIN_WINDOW_M = 60
/**
 * Band edges in percent grade. A grade equal to an edge belongs to the band above it. The band
 * that holds 0 (-3 to 3) is the flat band the curve divides by. Data preparation: narrow bands
 * where running speed changes fastest (rolling terrain), wide open ends for the steep tails.
 */
export const TERRAIN_EDGES_PCT: readonly number[] = [-15, -10, -6, -3, 3, 6, 10, 15]
/** Same figure as `MOVING_SPEED_MPS` in summarize.ts (a test pins them): slower is standing still. */
export const TERRAIN_STOPPED_MPS = 0.5
/** Faster than this over one bucket is a GPS jump, not running (the world record is 10.4 m/s). */
const MAX_SPEED_MPS = 12
/** Same cap as the gap-distance grade: a steeper reading is a data error. */
const MAX_GRADE = 0.45

function binOf(gradePct: number): number {
  let bin = 0
  while (bin < TERRAIN_EDGES_PCT.length && gradePct >= TERRAIN_EDGES_PCT[bin]!) bin++
  return bin
}

function emptyBins(): TerrainBins {
  const zeros = (): number[] => new Array<number>(TERRAIN_EDGES_PCT.length + 1).fill(0)
  return {
    v: TERRAIN_BINS_VERSION,
    windowM: TERRAIN_WINDOW_M,
    walkMps: P.c9.walkingFloorMps.value,
    edgesPct: [...TERRAIN_EDGES_PCT],
    sec: zeros(),
    m: zeros(),
    walkSec: zeros(),
  }
}

/** Whether a run or race gets terrain bins; every other type stores none. */
export function hasTerrainBins(type: ActivityType): boolean {
  return type === 'run' || type === 'race'
}

/**
 * The bins of one run's stream. A stream with no distance or no altitude gives all-zero bins (not
 * null), so a stored value always means "computed" and the backfill never revisits the run.
 *
 * Per stream step: the speed is the distance covered over the step; a step slower than
 * `TERRAIN_STOPPED_MPS`, or faster than a GPS-jump bound, counts nowhere. The grade belongs to the
 * step's midpoint: altitude at the two ends of a `TERRAIN_WINDOW_M` span along the distance
 * (interpolated). A step whose span runs off the start or the end of the run is left out. Time
 * under `c9.walkingFloorMps` also counts as walking time of its band.
 */
export function computeTerrainBins(stream: ActivityStreamData, sampleSec: number): TerrainBins {
  const out = emptyBins()
  const { t, d, alt } = stream
  if (!d || !alt || t.length < 2 || !(sampleSec > 0)) return out

  // The altitude profile along the distance: buckets that have an altitude, distance never going back.
  const ds: number[] = []
  const heights: number[] = []
  for (let i = 0; i < t.length; i++) {
    const dist = d[i]
    const height = alt[i]
    if (typeof dist !== 'number' || !Number.isFinite(dist)) continue
    if (typeof height !== 'number' || !Number.isFinite(height)) continue
    if (ds.length > 0 && dist < ds[ds.length - 1]!) continue
    ds.push(dist)
    heights.push(height)
  }
  if (ds.length < 2) return out
  const first = ds[0]!
  const last = ds[ds.length - 1]!

  /** Altitude at distance `x`, between the profile's first and last distance. */
  const altitudeAt = (x: number): number => {
    let lo = 0
    let hi = ds.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ds[mid]! <= x) lo = mid
      else hi = mid - 1
    }
    if (lo === ds.length - 1) return heights[lo]!
    const span = ds[lo + 1]! - ds[lo]!
    return heights[lo]! + ((heights[lo + 1]! - heights[lo]!) * (x - ds[lo]!)) / span
  }

  const half = TERRAIN_WINDOW_M / 2
  for (let i = 0; i < t.length - 1; i++) {
    const d0 = d[i]
    const d1 = d[i + 1]
    if (typeof d0 !== 'number' || typeof d1 !== 'number') continue
    const dt = t[i + 1]! - t[i]!
    const dd = d1 - d0
    if (!(dt > 0) || !(dd > 0)) continue
    const speed = dd / dt
    if (speed < TERRAIN_STOPPED_MPS || speed > MAX_SPEED_MPS) continue
    const mid = (d0 + d1) / 2
    if (mid - half < first || mid + half > last) continue
    const grade = (altitudeAt(mid + half) - altitudeAt(mid - half)) / TERRAIN_WINDOW_M
    if (Math.abs(grade) > MAX_GRADE) continue
    const bin = binOf(grade * 100)
    out.sec[bin]! += dt
    out.m[bin]! += dd
    if (speed < out.walkMps) out.walkSec[bin]! += dt
  }
  const tenth = (values: number[]): number[] => values.map((v) => Math.round(v * 10) / 10)
  out.sec = tenth(out.sec)
  out.m = tenth(out.m)
  out.walkSec = tenth(out.walkSec)
  return out
}
