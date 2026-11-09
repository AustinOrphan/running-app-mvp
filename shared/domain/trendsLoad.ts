// The two load panels of the Trends page (rule A12, ADR 0019): the climbing of each week and the
// minutes of each week split by heart-rate zone. Pure. The server turns the stored runs into the
// small rows the page needs (`loadRuns`); the page sums them by week (`climbWeeks`,
// `intensityWeeks`), so the range switch asks the server for nothing more. Display only: no ratio of
// recent to earlier load, no band marked high, no comparison with the plan, and nothing here reaches
// the engine's decisions (rules T1, G-5 and G5, ADR 0005). A run with no figure is counted and named,
// never read as zero and never spread over the others.
import { addDays, mondayOf } from '../dates.ts'
import { timeInBand } from '../engine/execution.ts'
import { hrQualityPasses } from '../engine/hrQuality.ts'
import type { Activity, Units } from '../types.ts'
import { FEET_PER_METRE } from '../units.ts'

/** The columns of a run the panels read. */
export type LoadSource = Pick<
  Activity,
  'date' | 'durationSec' | 'elevationGainM' | 'hrHistogram' | 'hrQuality'
>

/** Heart-rate limits of the three-zone model, bpm: the top of Zone 1 and the top of Zone 2. */
export interface LoadZones {
  lt1Hr: number
  lt2Hr: number
}

/** One run as the panels sum it. */
export interface TrendLoadRun {
  date: string
  durationSec: number
  /** Metres climbed, or null when the file recorded none (never read as 0). */
  elevationGainM: number | null
  /**
   * Seconds below, between and above the limits of `LoadZones`, from the stored histogram; null when
   * the run has no histogram, its heart rate failed the checks of rule B2, or no zones are set.
   */
  bandSec: [number, number, number] | null
}

/** The body of `GET /api/trends/load`. */
export interface TrendsLoadView {
  asOf: string
  /** The limits the bands were cut at, as the zones stand on `asOf`; null when none are set. */
  zones: LoadZones | null
  /** Runs (not races), flagged duplicates left out, oldest first. */
  runs: TrendLoadRun[]
}

/** Weeks the line looks across: the week and the three before it, as the minutes panel's. */
export const LINE_WEEKS = 4

/** A line point needs this many of its weeks to hold a figure (a page default, not a Param). */
export const LINE_MIN_WEEKS = 2

/**
 * Seconds of a run below, between and above the two limits, bins split in proportion to their
 * overlap (`timeInBand`). Null when the heart rate cannot be read: no histogram, a quality summary
 * that is missing or fails the checks of rule B2 (`hrQualityPasses`), or no zones. The seconds are
 * the histogram's own and are not stretched to the run's length.
 */
export function bandSeconds(
  run: Pick<LoadSource, 'hrHistogram' | 'hrQuality'>,
  zones: LoadZones | null,
): [number, number, number] | null {
  if (zones === null || run.hrHistogram === null) return null
  if (!hrQualityPasses(run.hrQuality)) return null
  const t = timeInBand(run.hrHistogram, zones.lt1Hr, zones.lt2Hr)
  const sec: [number, number, number] = [t.below, t.within, t.above]
  if (sec.some((s) => !Number.isFinite(s)) || sec[0] + sec[1] + sec[2] <= 0) return null
  return [Math.round(sec[0]), Math.round(sec[1]), Math.round(sec[2])]
}

/** The rows of the view from the stored runs, oldest first. */
export function loadRuns(runs: readonly LoadSource[], zones: LoadZones | null): TrendLoadRun[] {
  return runs
    .map((run) => ({
      date: run.date,
      durationSec: run.durationSec,
      elevationGainM:
        run.elevationGainM !== null && Number.isFinite(run.elevationGainM)
          ? run.elevationGainM
          : null,
      bandSec: bandSeconds(run, zones),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function byWeek(runs: readonly TrendLoadRun[]): Map<string, TrendLoadRun[]> {
  const weeks = new Map<string, TrendLoadRun[]>()
  for (const run of runs) {
    const week = mondayOf(run.date)
    const list = weeks.get(week)
    if (list === undefined) weeks.set(week, [run])
    else list.push(run)
  }
  return weeks
}

/** One week of climbing. */
export interface ClimbWeek {
  weekStart: string
  /** Runs of the week, whether or not they carry a gain. */
  runs: number
  /** Of those, the runs that carry a gain. */
  measured: number
  /** Metres climbed by the measured runs; null with no measured run (no run, or none with a gain). */
  ascentM: number | null
  /** Mean of this week and the three before it; null for the current week or with too few weeks. */
  meanM: number | null
  /** The week is not over: its bar is outlined and it has no point on the line. */
  current: boolean
}

/**
 * Weekly ascent for `weekStarts` (Mondays, oldest first) from the runs, which may reach back before
 * the first of them so the line has its three weeks. A week with no run has no bar and counts as 0 m
 * in the line (nothing was climbed); a week whose runs all lack a gain has no bar and is left out of
 * the line (its climb is unknown). The line is the mean of the weeks that hold a figure among the
 * week and the three before it, needs `LINE_MIN_WEEKS` of them, and stops at the last complete week.
 */
export function climbWeeks(
  runs: readonly TrendLoadRun[],
  weekStarts: readonly string[],
  currentWeek: string,
): ClimbWeek[] {
  const grouped = byWeek(runs)
  const cell = (weekStart: string) => {
    const list = grouped.get(weekStart) ?? []
    const measured = list.filter((run) => run.elevationGainM !== null)
    return {
      runs: list.length,
      measured: measured.length,
      ascentM:
        measured.length === 0
          ? null
          : measured.reduce((sum, run) => sum + (run.elevationGainM ?? 0), 0),
    }
  }
  return weekStarts.map((weekStart) => {
    const own = cell(weekStart)
    const current = weekStart === currentWeek
    let meanM: number | null = null
    if (!current) {
      const known: number[] = []
      for (let back = 0; back < LINE_WEEKS; back += 1) {
        const c = cell(addDays(weekStart, -7 * back))
        if (c.runs === 0) known.push(0)
        else if (c.ascentM !== null) known.push(c.ascentM)
      }
      if (known.length >= LINE_MIN_WEEKS) {
        meanM = known.reduce((sum, v) => sum + v, 0) / known.length
      }
    }
    return { weekStart, ...own, meanM, current }
  })
}

/** One week of minutes split by heart-rate zone. */
export interface IntensityWeek {
  weekStart: string
  runs: number
  /** Runs whose seconds are in the three bands. */
  usableRuns: number
  belowSec: number
  betweenSec: number
  aboveSec: number
  /** Seconds with no usable heart rate: whole runs without it, and the part of a run its histogram did not cover. */
  noHrSec: number
  current: boolean
}

/**
 * Weekly run time for `weekStarts` split in three bands by heart rate and a fourth, neutral part
 * for the time with no usable heart rate. A run without usable heart rate puts its whole length in
 * the fourth part; a usable run puts there only what its histogram did not cover. Every second a
 * run lasted is in exactly one part, so the four sum to the week's run time.
 */
export function intensityWeeks(
  runs: readonly TrendLoadRun[],
  weekStarts: readonly string[],
  currentWeek: string,
): IntensityWeek[] {
  const grouped = byWeek(runs)
  return weekStarts.map((weekStart) => {
    const week: IntensityWeek = {
      weekStart,
      runs: 0,
      usableRuns: 0,
      belowSec: 0,
      betweenSec: 0,
      aboveSec: 0,
      noHrSec: 0,
      current: weekStart === currentWeek,
    }
    for (const run of grouped.get(weekStart) ?? []) {
      week.runs += 1
      if (run.bandSec === null) {
        week.noHrSec += run.durationSec
        continue
      }
      const [below, between, above] = run.bandSec
      week.usableRuns += 1
      week.belowSec += below
      week.betweenSec += between
      week.aboveSec += above
      week.noHrSec += Math.max(0, run.durationSec - below - between - above)
    }
    return week
  })
}

/** Runs counted and, of those, the ones with a figure. */
export interface Coverage {
  runs: number
  covered: number
}

export function climbCoverage(weeks: readonly ClimbWeek[]): Coverage {
  return {
    runs: weeks.reduce((sum, w) => sum + w.runs, 0),
    covered: weeks.reduce((sum, w) => sum + w.measured, 0),
  }
}

export function intensityCoverage(weeks: readonly IntensityWeek[]): Coverage {
  return {
    runs: weeks.reduce((sum, w) => sum + w.runs, 0),
    covered: weeks.reduce((sum, w) => sum + w.usableRuns, 0),
  }
}

/** Climb in the runner's unit, for an axis or a table: metres for km, feet for miles. */
export function climbInUnit(metres: number, units: Units): number {
  return units === 'mi' ? metres * FEET_PER_METRE : metres
}
