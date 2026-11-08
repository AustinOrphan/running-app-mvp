// Per-run quality of a run's heart rate, from the stored 10 s stream (rule B2, batch HQ1). Pure and
// free of Node-only imports, so the import and the backfill call the same function over the same
// stream and agree to the digit.
//
// Five checks mark seconds of moving time as unclean: cadence lock, spikes, dropouts, flat lines and
// a mismatch between heart rate and effort. The stored summary counts them; whether a run passes is
// read from the counts by `hrQualityPasses`, so a new threshold needs no backfill. The `b2.q*`
// numbers of the checks are data preparation (they fix what the counts mean); the pass share and the
// minimum clean time of a half are engine numbers (they decide which hilly runs the Trends panels
// draw). All are grade D defaults, and no study validates them on stored streams (evidence gap 33).
//
// The same pass also keeps, per terrain band and per half, the clean moving seconds, metres and heart
// rate times seconds, so the drift of a hilly run can be read on grade-adjusted pace with the
// runner's own ratio per band (`gaDecouplingPct`) without the stream.
import {
  TERRAIN_BAND_COUNT,
  TERRAIN_EDGES_PCT,
  TERRAIN_WINDOW_M,
} from '../../domain/terrainShape.ts'
import { defaultBandRatios } from '../../engine/gradeCurve.ts'
import { P } from '../../engine/params/index.ts'
import { gaDecouplingPct } from '../../engine/hrQuality.ts'
import { gradeAdjustedSpeed } from '../../engine/terrain.ts'
import type { ActivityStreamData, HrQuality, HrQualityHalves, HrSource } from '../../types.ts'
import { DECOUPLING_MIN_SEC } from './summarize.ts'
import {
  TERRAIN_MAX_STEP_SEC,
  TERRAIN_MIN_ALTITUDE_RANGE_M,
  TERRAIN_STOPPED_MPS,
} from './terrainBins.ts'

/** Version of the stored shape. A change of a check or of what is counted raises it. */
export const HR_QUALITY_VERSION = 1
/** Faster than this over one bucket is a GPS jump, not running. Same figure as the terrain bins. */
const MAX_SPEED_MPS = 12
/** Same cap as the terrain bins and the gap-distance grade: a steeper reading is a data error. */
const MAX_GRADE = 0.45
const BAND_COUNT = TERRAIN_BAND_COUNT

function binOf(gradePct: number): number {
  let bin = 0
  while (bin < TERRAIN_EDGES_PCT.length && gradePct >= TERRAIN_EDGES_PCT[bin]!) bin++
  return bin
}

interface Step {
  dt: number
  dd: number
  speed: number
  moving: boolean
  /** Heart rate at the start of the step, or null when none was recorded. */
  hr: number | null
  cad: number | null
  /** Fractional grade over `TERRAIN_WINDOW_M` around the step; null where it cannot be read. */
  grade: number | null
  /** Grade-adjusted speed, m/s. */
  effort: number
}

const valid = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0

/** The steps of a stream: bucket to bucket, with what each needs for the checks. */
function stepsOf(stream: ActivityStreamData): { steps: Step[]; hasGrade: boolean } {
  const { t, d, hr, alt, cad } = stream
  if (!d || t.length < 2) return { steps: [], hasGrade: false }

  // The profile altitude is read at a distance, as the terrain bins read it: the buckets that have
  // both a distance and an altitude, with the distance never going back.
  const ds: number[] = []
  const heights: number[] = []
  if (alt) {
    for (let i = 0; i < t.length; i++) {
      const dist = d[i]
      const height = alt[i]
      if (typeof dist !== 'number' || !Number.isFinite(dist)) continue
      if (typeof height !== 'number' || !Number.isFinite(height)) continue
      if (ds.length > 0 && dist < ds[ds.length - 1]!) continue
      ds.push(dist)
      heights.push(height)
    }
  }
  const hasGrade =
    ds.length >= 3 && Math.max(...heights) - Math.min(...heights) >= TERRAIN_MIN_ALTITUDE_RANGE_M
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

  const steps: Step[] = []
  for (let k = 0; k < t.length - 1; k++) {
    const from = d[k]
    const to = d[k + 1]
    const dt = t[k + 1]! - t[k]!
    if (typeof from !== 'number' || typeof to !== 'number' || !(dt > 0)) {
      steps.push({
        dt: Math.max(dt, 0),
        dd: 0,
        speed: 0,
        moving: false,
        hr: null,
        cad: null,
        grade: null,
        effort: 0,
      })
      continue
    }
    const dd = to - from
    const speed = dd / dt
    const moving =
      dt <= TERRAIN_MAX_STEP_SEC && dd > 0 && speed >= TERRAIN_STOPPED_MPS && speed <= MAX_SPEED_MPS
    let grade: number | null = null
    if (hasGrade && moving) {
      const mid = (from + to) / 2
      if (mid - half >= ds[0]! && mid + half <= ds[ds.length - 1]!) {
        const g = (altitudeAt(mid + half) - altitudeAt(mid - half)) / TERRAIN_WINDOW_M
        if (Math.abs(g) <= MAX_GRADE) grade = g
      }
    }
    const beat = hr?.[k]
    const cadence = cad?.[k]
    steps.push({
      dt,
      dd,
      speed,
      moving,
      hr: valid(beat) ? beat : null,
      cad: valid(cadence) ? cadence : null,
      grade,
      effort: moving ? gradeAdjustedSpeed(speed, grade ?? 0) : 0,
    })
  }
  return { steps, hasGrade }
}

/** Marks every maximal run of consecutive steps that satisfy `inRun` and last `minSec` or longer. */
function markRuns(
  steps: readonly Step[],
  inRun: (step: Step, index: number) => boolean,
  minSec: number,
  flags: boolean[],
): void {
  let start = -1
  let seconds = 0
  const close = (end: number): void => {
    if (start >= 0 && seconds >= minSec) for (let k = start; k < end; k++) flags[k] = true
    start = -1
    seconds = 0
  }
  steps.forEach((step, k) => {
    if (step.moving && inRun(step, k)) {
      if (start < 0) start = k
      seconds += step.dt
    } else close(k)
  })
  close(steps.length)
}

/** Marks every run of consecutive moving steps with exactly one heart rate that lasts `minSec` or longer. */
function markEqualRuns(steps: readonly Step[], minSec: number, flags: boolean[]): void {
  let start = -1
  let seconds = 0
  const close = (end: number): void => {
    if (start >= 0 && seconds >= minSec) for (let k = start; k < end; k++) flags[k] = true
    start = -1
    seconds = 0
  }
  steps.forEach((step, k) => {
    if (!step.moving || step.hr === null) return close(k)
    if (start >= 0 && steps[start]!.hr !== step.hr) close(k)
    if (start < 0) start = k
    seconds += step.dt
  })
  close(steps.length)
}

/** The cadence a heart rate is compared with: steps per minute, or twice a single foot's. */
function stepsPerMin(cad: number): number | null {
  const floor = P.b2.qLockMinCadenceSpm.value
  if (cad >= floor) return cad
  return cad >= floor / 2 ? cad * 2 : null
}

const empty = (source: HrSource): HrQuality => ({
  v: HR_QUALITY_VERSION,
  source,
  movingSec: 0,
  cleanSec: 0,
  lockSec: 0,
  spikeSec: 0,
  dropSec: 0,
  flatSec: 0,
  mismatchSec: 0,
  halves: null,
  gapDecouplingPct: null,
})

const tenth = (v: number): number => Math.round(v * 10) / 10

/**
 * The heart-rate quality of one run's stream. A stream with no distance gives all-zero counts (not
 * null), so a stored value always means "computed" and the backfill never revisits the run. A
 * stream with no heart rate counts every moving second as a dropout. `sampleSec` is the bucket
 * width of the stream. The halves are kept only for a run of `DECOUPLING_MIN_SEC` or longer with an
 * altitude profile.
 */
export function computeHrQuality(
  stream: ActivityStreamData,
  sampleSec: number,
  source: HrSource,
): HrQuality {
  const out = empty(source)
  const { steps, hasGrade } = stepsOf(stream)
  if (steps.length === 0 || !(sampleSec > 0)) return out

  const n = steps.length
  const lock = new Array<boolean>(n).fill(false)
  const spike = new Array<boolean>(n).fill(false)
  const flat = new Array<boolean>(n).fill(false)
  const mismatch = new Array<boolean>(n).fill(false)

  const band = P.b2.qLockBandBpm.value
  markRuns(
    steps,
    (step) => {
      if (step.hr === null || step.cad === null) return false
      const spm = stepsPerMin(step.cad)
      return spm !== null && Math.abs(step.hr - spm) <= band
    },
    P.b2.qLockMinSec.value,
    lock,
  )

  // Exactly one value for a minute: the 10 s means are rounded to a tenth, so a live heart does
  // not repeat itself this long.
  markEqualRuns(steps, P.b2.qFlatLineSec.value, flat)

  for (let k = 1; k < n; k++) {
    const a = steps[k - 1]!
    const b = steps[k]!
    if (!a.moving || !b.moving || a.hr === null || b.hr === null) continue
    if (Math.abs(b.hr - a.hr) > (P.b2.qMaxJumpBpm.value * a.dt) / 10) {
      spike[k - 1] = true
      spike[k] = true
    }
  }

  const win = Math.max(1, Math.round(P.b2.qMismatchWindowSec.value / sampleSec))
  for (let k = 2 * win - 1; k < n; k++) {
    let ok = true
    let hrPrev = 0
    let hrCur = 0
    let effortPrev = 0
    let effortCur = 0
    for (let j = k - 2 * win + 1; j <= k && ok; j++) {
      const step = steps[j]!
      if (!step.moving || step.hr === null) ok = false
      else if (j <= k - win) {
        hrPrev += step.hr
        effortPrev += step.effort
      } else {
        hrCur += step.hr
        effortCur += step.effort
      }
    }
    if (!ok || effortPrev <= 0) continue
    if (
      (hrPrev - hrCur) / win >= P.b2.qMismatchHrDropBpm.value &&
      effortCur / effortPrev - 1 >= P.b2.qMismatchEffortRise.value
    ) {
      for (let j = k - win + 1; j <= k; j++) mismatch[j] = true
    }
  }

  // Halves of a long run: the split is at the middle of the time, as the raw drift's.
  const first = stream.t[0]!
  const span = stream.t[stream.t.length - 1]! - first
  const keepHalves = hasGrade && span >= DECOUPLING_MIN_SEC
  const mid = first + span / 2
  const halves: HrQualityHalves | null = keepHalves
    ? {
        sec: [new Array<number>(BAND_COUNT).fill(0), new Array<number>(BAND_COUNT).fill(0)],
        m: [new Array<number>(BAND_COUNT).fill(0), new Array<number>(BAND_COUNT).fill(0)],
        hrSec: [new Array<number>(BAND_COUNT).fill(0), new Array<number>(BAND_COUNT).fill(0)],
      }
    : null

  for (let k = 0; k < n; k++) {
    const step = steps[k]!
    if (!step.moving) continue
    out.movingSec += step.dt
    if (step.hr === null) out.dropSec += step.dt
    if (lock[k]) out.lockSec += step.dt
    if (spike[k]) out.spikeSec += step.dt
    if (flat[k]) out.flatSec += step.dt
    if (mismatch[k]) out.mismatchSec += step.dt
    const clean = step.hr !== null && !lock[k] && !spike[k] && !flat[k] && !mismatch[k]
    if (!clean) continue
    out.cleanSec += step.dt
    if (halves && step.grade !== null) {
      const half = stream.t[k]! < mid ? 0 : 1
      const b = binOf(step.grade * 100)
      halves.sec[half][b]! += step.dt
      halves.m[half][b]! += step.dd
      halves.hrSec[half][b]! += step.hr! * step.dt
    }
  }

  const round = (values: number[][]): [number[], number[]] => [
    values[0]!.map(tenth),
    values[1]!.map(tenth),
  ]
  for (const key of [
    'movingSec',
    'cleanSec',
    'lockSec',
    'spikeSec',
    'dropSec',
    'flatSec',
    'mismatchSec',
  ] as const) {
    out[key] = tenth(out[key])
  }
  if (halves) {
    out.halves = {
      sec: round(halves.sec),
      m: round(halves.m),
      hrSec: round(halves.hrSec),
    }
    out.gapDecouplingPct = gaDecouplingPct(out, defaultBandRatios())
  }
  return out
}
