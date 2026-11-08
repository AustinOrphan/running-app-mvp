// Terrain bins of one run: time, distance and walking time by grade band, from the stored 10 s
// stream (distance and altitude only; no heart rate). The personal grade curve (rule I13) divides
// each band's speed by the run's own flat speed. Pure and free of Node-only imports, so the import
// and the backfill call the same function over the same stream and agree to the digit.
//
// Every number below is data preparation, not an engine decision: it fixes what the stored bins
// mean. The thresholds the curve applies to them (minutes per band, runs per band, shrinkage) are
// the I13 Params of the grade-curve batch. The one engine number used here, the walking floor, is
// `c9.walkingFloorMps`, and the value used is stored with the bins.
import {
  TERRAIN_BINS_VERSION,
  TERRAIN_EDGES_PCT,
  TERRAIN_WINDOW_M,
} from '../../domain/terrainShape.ts'
import { P } from '../../engine/params/index.ts'
import type { ActivityStreamData, ActivityType, TerrainBins } from '../../types.ts'

// The shape constants (version, window, edges) live in `shared/domain/terrainShape.ts`: the grade
// curve reads them too and `shared/engine` does not import from the importers.
export { TERRAIN_BINS_VERSION, TERRAIN_EDGES_PCT, TERRAIN_WINDOW_M }
/** Same figure as `MOVING_SPEED_MPS` in summarize.ts (a test pins them): slower is standing still. */
export const TERRAIN_STOPPED_MPS = 0.5
/**
 * Longest span, in seconds, one step may cover. Same figure as `MAX_GAP_SEC` in summarize.ts (a
 * test pins them): a longer gap is a pause and counts as no time at all, as in `movingSec`.
 */
export const TERRAIN_MAX_STEP_SEC = 30
/**
 * A run whose altitude spans less than this many metres from lowest to highest has no terrain to
 * read (a treadmill, or a watch without a barometer) and gets the all-zero form. Data
 * preparation: GNSS and barometer height wander by a metre or two on their own, so a smaller span
 * says nothing about the course, and booking the run as all flat would feed the flat band falsely.
 */
export const TERRAIN_MIN_ALTITUDE_RANGE_M = 2
/**
 * Seconds a segment must hold before it is closed, for the walking time and the flat-speed
 * variation. Data preparation: the stream keeps only 10 s bucket starts, so a step's seconds are the
 * grid gap, not the elapsed time. A recording every 12, 15 or 25 s gives steps alternately 10 and 20
 * s apart over equal distances, and a single step's speed is off by a factor of two. Over a run of
 * consecutive steps the errors cancel, leaving at most one bucket (10 s) in all, so a segment of
 * 120 s reads its speed to within about 8% at any sampling interval. The price is that variation
 * faster than about two minutes (short repeats) is averaged away; the measure is for steady running.
 */
export const TERRAIN_SEGMENT_SEC = 120
/** Faster than this over one bucket is a GPS jump, not running (the world record is 10.4 m/s). */
const MAX_SPEED_MPS = 12
/** Same cap as the gap-distance grade: a steeper reading is a data error. */
const MAX_GRADE = 0.45

/** Index of the band that holds 0 (the flat band the curve divides by). */
const FLAT_BAND = TERRAIN_EDGES_PCT.filter((edge) => edge <= 0).length

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
    flatCv: null,
  }
}

/** Whether a run or race gets terrain bins; every other type stores none. */
export function hasTerrainBins(type: ActivityType): boolean {
  return type === 'run' || type === 'race'
}

/**
 * The bins of one run's stream. A stream with no distance, no altitude, or an altitude that spans
 * under `TERRAIN_MIN_ALTITUDE_RANGE_M` gives all-zero bins (not null), so a stored value always
 * means "computed" and the backfill never revisits the run.
 *
 * The stream is a 10 s grid, but a recording sampled more slowly leaves empty buckets (no altitude;
 * distance carried forward). A step runs from one sampled bucket to the next, so its distance and
 * time add up to the run's (the band totals are exact), but its own speed is not: the stream keeps
 * only 10 s bucket starts, so a step's seconds are the grid gap, not the elapsed time. A step is dropped when it is slower than
 * `TERRAIN_STOPPED_MPS`, faster than a GPS-jump bound or longer than `TERRAIN_MAX_STEP_SEC`; a step
 * also counts only when the steps on both sides are moving, so a bucket that is part running and
 * part standing (averaging a walking speed) is neither booked as walking nor counted as moving
 * time. The grade belongs to the step's midpoint: altitude at the two ends of a `TERRAIN_WINDOW_M`
 * span along the distance (interpolated). A step whose span runs off the start or the end of the
 * run is left out. Time under `c9.walkingFloorMps` also counts as walking time of its band.
 * Walking time and `flatCv` (the time-weighted coefficient of variation of segment speed in the flat
 * band, the measure of a steady run; null with under two flat segments) are read over segments of
 * at least `TERRAIN_SEGMENT_SEC`, each segment's speed being its metres over its seconds.
 */
export function computeTerrainBins(stream: ActivityStreamData, sampleSec: number): TerrainBins {
  const out = emptyBins()
  const { t, d, alt } = stream
  if (!d || !alt || t.length < 2 || !(sampleSec > 0)) return out

  // The sampled buckets: those that have both a distance and an altitude. Distance never goes back.
  const ts: number[] = []
  const ds: number[] = []
  const heights: number[] = []
  for (let i = 0; i < t.length; i++) {
    const dist = d[i]
    const height = alt[i]
    if (typeof dist !== 'number' || !Number.isFinite(dist)) continue
    if (typeof height !== 'number' || !Number.isFinite(height)) continue
    if (ds.length > 0 && dist < ds[ds.length - 1]!) continue
    ts.push(t[i]!)
    ds.push(dist)
    heights.push(height)
  }
  if (ds.length < 3) return out
  if (Math.max(...heights) - Math.min(...heights) < TERRAIN_MIN_ALTITUDE_RANGE_M) return out
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

  const steps = ds.slice(1).map((end, k) => {
    const dt = ts[k + 1]! - ts[k]!
    const dd = end - ds[k]!
    const speed = dd / dt
    const moving =
      dt > 0 &&
      dt <= TERRAIN_MAX_STEP_SEC &&
      dd > 0 &&
      speed >= TERRAIN_STOPPED_MPS &&
      speed <= MAX_SPEED_MPS
    return { dt, dd, speed, moving, mid: (ds[k]! + end) / 2 }
  })

  const half = TERRAIN_WINDOW_M / 2
  // Walking time and flat-speed variation are read over segments of consecutive steps in one band,
  // never over single steps: on a stream recorded every 12, 15 or 25 s the 10 s grid gives steps
  // alternately 10 and 20 s apart over a constant distance, so one step's speed is off by a factor
  // of two either way while the sums over a few steps are right.
  let segment = { bin: -1, sec: 0, m: 0 }
  let flatSec = 0
  let flatSum = 0
  let flatSquares = 0
  let flatSegments = 0
  const flush = (): void => {
    if (segment.sec > 0) {
      const speed = segment.m / segment.sec
      if (speed < out.walkMps) out.walkSec[segment.bin]! += segment.sec
      if (segment.bin === FLAT_BAND && segment.sec >= TERRAIN_SEGMENT_SEC) {
        flatSec += segment.sec
        flatSum += segment.sec * speed
        flatSquares += segment.sec * speed * speed
        flatSegments += 1
      }
    }
    segment = { bin: -1, sec: 0, m: 0 }
  }
  for (let k = 1; k < steps.length - 1; k++) {
    const step = steps[k]!
    const counts = step.moving && steps[k - 1]!.moving && steps[k + 1]!.moving
    if (!counts || step.mid - half < first || step.mid + half > last) {
      flush()
      continue
    }
    const grade = (altitudeAt(step.mid + half) - altitudeAt(step.mid - half)) / TERRAIN_WINDOW_M
    if (Math.abs(grade) > MAX_GRADE) {
      flush()
      continue
    }
    const bin = binOf(grade * 100)
    out.sec[bin]! += step.dt
    out.m[bin]! += step.dd
    if (segment.bin !== bin) flush()
    segment.bin = bin
    segment.sec += step.dt
    segment.m += step.dd
    if (segment.sec >= TERRAIN_SEGMENT_SEC) flush()
  }
  flush()
  if (flatSegments >= 2) {
    const mean = flatSum / flatSec
    const variance = Math.max(0, flatSquares / flatSec - mean * mean)
    out.flatCv = Math.round((Math.sqrt(variance) / mean) * 1000) / 1000
  }
  const tenth = (values: number[]): number[] => values.map((v) => Math.round(v * 10) / 10)
  out.sec = tenth(out.sec)
  out.m = tenth(out.m)
  out.walkSec = tenth(out.walkSec)
  return out
}
