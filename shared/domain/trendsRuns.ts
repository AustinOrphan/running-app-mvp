// The two run-based panels of the Trends page (rules T1 and A11, ADR 0019): the heart-rate drift of
// long runs and the heart rate at one speed over months. Pure. The server turns the stored runs
// into the small rows the page needs (`longRunReadings`, `hrWindows`); the page turns those into
// what it draws (`durabilityGroup`, `fixedSpeedSeries`). Nothing here sets a target, marks a value
// as good or poor, or reaches the engine's decisions (ADR 0005).
import { addDays } from '../dates.ts'
import { durabilityRuns } from '../engine/athlete.ts'
import { fitHrModel, hrModelSample, isFlatRun, type HrFitRun } from '../engine/execution.ts'
import { defaultBandRatios } from '../engine/gradeCurve.ts'
import { gaDecouplingPct, hrQualityPasses } from '../engine/hrQuality.ts'
import { P } from '../engine/params/index.ts'
import type { Activity } from '../types.ts'

/** The columns of a run the two panels read: what the heart-rate fit reads, and the stored drift. */
export type TrendRun = HrFitRun & Pick<Activity, 'decouplingPct' | 'terrainBins'>

/** Days between the ends of two neighbouring windows: four weeks, so neighbours share half their runs. */
export const HR_WINDOW_STEP_DAYS = 28

/** Windows the panel can show: 26 of four weeks cover 100 weeks, the span of the 104-week page. */
export const HR_WINDOW_COUNT = 26

/** Days of runs the oldest window reads: its end, back to the start of its eight weeks. */
export function runHistoryDays(): number {
  return HR_WINDOW_STEP_DAYS * (HR_WINDOW_COUNT - 1) + P.hrModel.windowWeeks.value * 7
}

/** One long run with a drift reading, as the long-run panel draws it. */
export interface TrendLongRun {
  date: string
  durationSec: number
  /**
   * Heart rate per unit of speed in the second half over the first, minus 1, in percent. For a hilly
   * run (`hilly`) the speed is grade-adjusted and only the clean time counts (rule B2, HQ1).
   */
  decouplingPct: number
  /** A run that climbs more than `hrModel.maxGainPerKm` per km whose heart rate passed the checks of B2. */
  hilly: boolean
  /** Air temperature of the run, or null when no weather is stored. */
  tempC: number | null
}

/** The line the heart-rate model drew in one window, read at a speed by the page. */
export interface TrendHrLine {
  /** Steady flat runs the line was fitted on. */
  runs: number
  interceptBpm: number
  slopeBpmPerMps: number
  /** The slowest and the fastest speed fitted, m/s. */
  minSpeedMps: number
  maxSpeedMps: number
}

/** One window of `hrModel.windowWeeks` weeks ending on `end`. */
export interface TrendHrWindow {
  /** Last day of the window, `YYYY-MM-DD`. */
  end: string
  /** Steady runs with heart rate inside the window (flat, and hilly ones that passed), whether or not there are enough for a line. */
  qualifying: number
  /** Of those, the hilly runs that passed the heart-rate checks, by date and length (`date|seconds`). */
  hillyRuns: string[]
  /** The line, or null with fewer than `hrModel.minQualifyingRuns` runs. */
  line: TrendHrLine | null
}

/** The body of `GET /api/trends/runs`. */
export interface TrendsRunsView {
  asOf: string
  longRuns: TrendLongRun[]
  /** Oldest first, one every `HR_WINDOW_STEP_DAYS` days, the last ending on `asOf`. */
  hrWindows: TrendHrWindow[]
}

const round = (value: number, places: number): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * The runs the drift panel draws, oldest first: runs with a stored drift reading that climbed no
 * more than `hrModel.maxGainPerKm` per kilometre, and hilly runs whose heart rate passed the checks
 * of B2 and that have a grade-adjusted drift (`gaDecouplingPct` over `ratios`: the speed of each
 * terrain band relative to flat, the runner's own where rule I13 shows one, Minetti by default).
 * A hilly run's raw drift is not drawn: a climbing second half reads as drift. Flagged duplicates
 * are the loader's to leave out.
 */
export function longRunReadings(
  runs: readonly TrendRun[],
  ratios: readonly number[] = defaultBandRatios(),
): TrendLongRun[] {
  const out: TrendLongRun[] = []
  for (const run of runs) {
    if (run.type !== 'run') continue
    if (isFlatRun(run)) {
      if (run.decouplingPct === null || !Number.isFinite(run.decouplingPct)) continue
      out.push({
        date: run.date,
        durationSec: run.durationSec,
        decouplingPct: run.decouplingPct,
        hilly: false,
        tempC: run.tempC,
      })
      continue
    }
    const quality = run.hrQuality ?? null
    if (quality === null || !hrQualityPasses(quality)) continue
    const ga = gaDecouplingPct(quality, ratios)
    if (ga === null) continue
    out.push({
      date: run.date,
      durationSec: run.durationSec,
      decouplingPct: ga,
      hilly: true,
      tempC: run.tempC,
    })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * `HR_WINDOW_COUNT` windows ending every `HR_WINDOW_STEP_DAYS` days back from `today`, oldest
 * first: the heart-rate line of each (rule A8, `fitHrModel`), or null where too few runs qualify.
 * The runs are not filtered here; the fit keeps the steady, flat ones with a sampled histogram.
 */
export function hrWindows(runs: readonly HrFitRun[], today: string): TrendHrWindow[] {
  const windows: TrendHrWindow[] = []
  for (let k = HR_WINDOW_COUNT - 1; k >= 0; k -= 1) {
    const end = addDays(today, -HR_WINDOW_STEP_DAYS * k)
    const model = fitHrModel(runs, end, { hilly: true })
    const sample = hrModelSample(runs, end, { hilly: true })
    windows.push({
      end,
      qualifying: sample.runs,
      hillyRuns: sample.hillyKeys,
      line:
        model === null
          ? null
          : {
              runs: model.runs,
              interceptBpm: round(model.interceptBpm, 3),
              slopeBpmPerMps: round(model.slopeBpmPerMps, 3),
              minSpeedMps: round(model.minSpeedMps, 4),
              maxSpeedMps: round(model.maxSpeedMps, 4),
            },
    })
  }
  return windows
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** What identifies a drawn run: two runs on one day differ in length or drift. */
export function runKey(run: TrendLongRun): string {
  return `${run.date}|${String(run.durationSec)}|${String(run.decouplingPct)}`
}

/** The largest group of comparable, cool long runs among the drawn ones, and what the line says [A7]. */
export interface DurabilityGroup {
  /** The runs the median is taken from, whether or not there are enough for a median line. */
  runs: TrendLongRun[]
  /** Median drift of the group; null with fewer than `a7.minComparableRuns` runs. */
  medianPct: number | null
  /** Median length of the group, in minutes. */
  medianMin: number
}

/**
 * The group the median line is read from: `durabilityRuns` (rule A7) over the runs drawn, so the
 * panel and the engine's descriptor pick runs the same way, though the panel's runs are the flat
 * ones of the range. Null when no run qualifies at all.
 */
export function durabilityGroup(longRuns: readonly TrendLongRun[]): DurabilityGroup | null {
  // Hilly runs are drawn but never make the group: the engine's A7 test is flat-only (rule B2, HQ1).
  const runs = durabilityRuns(
    longRuns.filter((run) => !run.hilly).map((run) => ({ ...run, type: 'run' as const })),
  )
  if (runs.length === 0) return null
  return {
    runs: runs.map(({ date, durationSec, decouplingPct, tempC }) => ({
      date,
      durationSec,
      decouplingPct,
      hilly: false,
      tempC,
    })),
    medianPct:
      runs.length >= P.a7.minComparableRuns.value
        ? round(median(runs.map((run) => run.decouplingPct)), 1)
        : null,
    medianMin: median(runs.map((run) => run.durationSec / 60)),
  }
}

/** Why a window has no point at the reference speed. */
export type WindowGap = 'few-runs' | 'speed-not-run'

/** One window as the heart-rate panel draws it. */
export interface FixedSpeedPoint {
  end: string
  /** Steady flat runs inside the window. */
  qualifying: number
  /** Runs the line was fitted on, or null with no line. */
  fitted: number | null
  /** The line's heart rate at the reference speed, whole bpm; null in a gap. */
  bpm: number | null
  gap: WindowGap | null
}

/** The heart-rate panel's series over a set of windows. */
export interface FixedSpeedSeries {
  /** The speed every point is read at, m/s; null when no window has a line. */
  referenceMps: number | null
  points: FixedSpeedPoint[]
}

/**
 * The line of each window read at one speed. The speed is the median, over the windows that have a
 * line, of the middle of the speeds the line was fitted on, so it is a speed the runner ran in the
 * span shown. A window whose fitted speeds, widened by `c9.lineSpeedMargin` (the margin My paces
 * reads its line within), do not contain it is a gap, as is a window with no line. The heat term
 * is not applied: the figure is the line's own, in cool air. No point is compared with another.
 */
export function fixedSpeedSeries(windows: readonly TrendHrWindow[]): FixedSpeedSeries {
  const mids = windows.flatMap((w) =>
    w.line === null ? [] : [(w.line.minSpeedMps + w.line.maxSpeedMps) / 2],
  )
  const referenceMps = mids.length === 0 ? null : median(mids)
  const margin = P.c9.lineSpeedMargin.value
  const points = windows.map((w): FixedSpeedPoint => {
    const base = { end: w.end, qualifying: w.qualifying, fitted: w.line?.runs ?? null }
    if (w.line === null || referenceMps === null) {
      return { ...base, bpm: null, gap: 'few-runs' }
    }
    const inside =
      referenceMps >= w.line.minSpeedMps * (1 - margin) &&
      referenceMps <= w.line.maxSpeedMps * (1 + margin)
    if (!inside) return { ...base, bpm: null, gap: 'speed-not-run' }
    return {
      ...base,
      bpm: Math.round(w.line.interceptBpm + w.line.slopeBpmPerMps * referenceMps),
      gap: null,
    }
  })
  return { referenceMps, points }
}
