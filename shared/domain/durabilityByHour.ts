// The hour-by-hour read-out of a long run (rule T1, amendment of batch DR1; display only, ADR 0005):
// for each whole hour of a run or race of at least `a7.driftInferenceLimitMin` minutes, the
// grade-adjusted pace and the mean heart rate over the clean moving time. Pure. It describes the
// runner's own long runs side by side; it sets no target, draws no line and compares no hour with
// another. Nothing in `shared/engine/` imports this file (`durabilityIsolation.test.ts`).
//
// The grade cost is the one the hilly drift of HQ1 uses: the speed of each terrain band divided by
// its ratio to flat (`ratios`: the runner's own where rule I13 shows one, Minetti otherwise), so no
// second grade cost exists. Which seconds are clean moving time is the per-run checks of rule B2
// (`flagSteps`), the same function the stored summary is computed with.
import { hrQualityFailure, hrQualityPasses } from '../engine/hrQuality.ts'
import { binOf, cleanSteps, flagSteps, stepsOf } from '../importers/files/hrQuality.ts'
import type { ActivityStreamData, HrQuality } from '../types.ts'
import { TERRAIN_BAND_COUNT } from './terrainShape.ts'

/** Seconds in one hour of the run's clock. */
const HOUR_SEC = 3600

/**
 * A last part-hour is read only when the run's clock holds at least this many minutes of it. A
 * shorter tail is left out of the read-out, not shown with a figure it cannot carry. A display
 * constant (rule T1, DR1); not an engine number.
 */
export const DURABILITY_PART_HOUR_MIN = 30

/**
 * An hour shows a pace only with at least this many minutes of moving time on a readable grade in
 * it, and a heart rate only with at least this many minutes of clean moving time. A display
 * constant (rule T1, DR1); not an engine number.
 */
export const DURABILITY_MIN_FIGURE_MIN = 10

/** One hour of a run. */
export interface DurabilityHour {
  /** 1 for the first hour. */
  hour: number
  /** True for a last part-hour of at least `DURABILITY_PART_HOUR_MIN` minutes. */
  partial: boolean
  /** Minutes of the run's clock the hour covers: 60, or the part-hour's. */
  minutes: number
  /** Grade-adjusted pace, seconds per kilometre; null where the hour has too little moving time on a readable grade. */
  paceSecPerKm: number | null
  /** Mean heart rate over the clean moving time, whole bpm; null where the heart rate is left out or the hour has too little clean time. */
  hrBpm: number | null
}

/** Why a run's heart rate is not shown. `not-checked` is a run whose quality summary is not stored yet. */
export type DurabilityHrGap = NonNullable<ReturnType<typeof hrQualityFailure>> | 'not-checked'

/** The read-out of one run. */
export interface DurabilityRead {
  hours: DurabilityHour[]
  /** Null when the heart rate passed the checks of B2 and is shown; otherwise why it is not. */
  hrGap: DurabilityHrGap | null
}

/**
 * The hours of a run's stored stream, or null when the stream cannot give a grade-adjusted pace (no
 * distance, or no altitude profile that spans the minimum range of the terrain bins). The hours run
 * on the stream's clock from its first sample, so a stop in the middle takes its time out of the
 * hour's moving seconds, not out of the hour. A heart rate that fails `hrQualityPasses` (or has no
 * stored summary) is left out of every hour; the pace stays.
 */
export function durabilityByHour(
  stream: ActivityStreamData,
  sampleSec: number,
  quality: HrQuality | null,
  ratios: readonly number[],
): DurabilityRead | null {
  if (ratios.length !== TERRAIN_BAND_COUNT || stream.t.length < 2) return null
  const { steps, hasGrade } = stepsOf(stream)
  if (!hasGrade || steps.length === 0) return null

  const first = stream.t[0]!
  const span = stream.t[stream.t.length - 1]! - first
  const whole = Math.floor(span / HOUR_SEC)
  const rest = span - whole * HOUR_SEC
  const partial = rest >= DURABILITY_PART_HOUR_MIN * 60
  const count = whole + (partial ? 1 : 0)
  if (count === 0) return null

  const showHr = hrQualityPasses(quality)
  const clean = showHr ? cleanSteps(steps, flagSteps(steps, sampleSec)) : []
  const acc = Array.from({ length: count }, () => ({
    sec: 0,
    flatM: 0,
    cleanSec: 0,
    hrSec: 0,
  }))

  steps.forEach((step, k) => {
    // A step belongs to the hour it starts in; a tail shorter than a part-hour is not read.
    const slot = acc[Math.floor((step.t - first) / HOUR_SEC)]
    if (slot === undefined || !step.moving) return
    if (step.grade !== null) {
      slot.sec += step.dt
      slot.flatM += step.dd / ratios[binOf(step.grade * 100)]!
    }
    if (clean[k] === true) {
      slot.cleanSec += step.dt
      slot.hrSec += step.hr! * step.dt
    }
  })

  const minSec = DURABILITY_MIN_FIGURE_MIN * 60
  const hours = acc.map((slot, i): DurabilityHour => {
    const isPart = partial && i === count - 1
    return {
      hour: i + 1,
      partial: isPart,
      minutes: isPart ? Math.floor(rest / 60) : 60,
      paceSecPerKm:
        slot.sec >= minSec && slot.flatM > 0 ? Math.round((slot.sec / slot.flatM) * 1000) : null,
      hrBpm: slot.cleanSec >= minSec ? Math.round(slot.hrSec / slot.cleanSec) : null,
    }
  })
  const hrGap = showHr ? null : quality === null ? 'not-checked' : hrQualityFailure(quality)
  return { hours, hrGap }
}

/** The fuel-log group a run is in: a stored log that was not skipped, or none. Never "unfuelled". */
export type DurabilityFuel = 'logged' | 'none'

/** One run or race of `a7.driftInferenceLimitMin` minutes or more, as the panel draws it. */
export interface DurabilityRun {
  activityId: string
  date: string
  type: 'run' | 'race'
  durationSec: number
  fuel: DurabilityFuel
  hours: DurabilityHour[]
  hrGap: DurabilityHrGap | null
}

/** The runs of that length that are not drawn, and why. */
export interface DurabilityLeftOut {
  /** No stored 10 s stream (a spreadsheet import, a manual entry). */
  noStream: number
  /** A stream with no distance or no altitude profile, so no grade-adjusted pace. */
  noGrade: number
}

/** The body of `GET /api/trends/durability`. */
export interface TrendsDurabilityView {
  asOf: string
  /** Oldest first. */
  runs: DurabilityRun[]
  leftOut: DurabilityLeftOut
}
