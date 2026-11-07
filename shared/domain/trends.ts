// Weekly recovery series for the Trends page [rule T1]. Pure: a series of wellness rows in, one
// entry per week out. Nothing here sets a target or marks a week as inside or outside its range.
import { addDays } from '../dates.ts'
import { baselineReadings, recentRange } from '../engine/readiness.ts'
import { P } from '../engine/params/index.ts'
import type { TrendWeek } from '../types.ts'

/**
 * Nights a weekly mean of heart-rate variability or resting heart rate needs. A display default
 * with no evidence behind it (open question 7 of the Trends design); sleep uses `j5.sleepMinNights`.
 */
export const MIN_NIGHTS_PER_MEAN = 4

/** The columns of a night the weekly series read. */
export interface WellnessSeriesRow {
  date: string
  restingHr: number | null
  hrvRmssd: number | null
  sleepSec: number | null
}

type SeriesByDate = ReadonlyMap<string, WellnessSeriesRow>

/** The rows keyed by date, for the baseline helpers. A later row for a date replaces an earlier one. */
export function seriesByDate(rows: readonly WellnessSeriesRow[]): SeriesByDate {
  return new Map(rows.map((row) => [row.date, row]))
}

const valid = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const round = (value: number, places: number): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** The valid readings of the seven days from `weekStart`, picked by `pick`. */
function weekReadings(
  byDate: SeriesByDate,
  weekStart: string,
  pick: (row: WellnessSeriesRow) => number | null,
): number[] {
  const found: number[] = []
  for (let k = 0; k < 7; k++) {
    const row = byDate.get(addDays(weekStart, k))
    const value = row === undefined ? null : pick(row)
    if (valid(value)) found.push(value)
  }
  return found
}

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length

/**
 * One entry per week of `weekStarts` for heart-rate variability (`hrv`, rMSSD in ms, the mean
 * taken on the ln scale) or resting heart rate (`resting-hr`, bpm). The mean is null under
 * `MIN_NIGHTS_PER_MEAN` nights. The range is the runner's recent range at the week's Monday, built
 * from the readings of the days before it (`recentRange`), so the week's own nights never build its
 * band; it is null until `j4.minReadings` earlier readings exist, and `readings` says how many do.
 * A series with no reading in any week is empty.
 */
export function weeklyBands(
  byDate: SeriesByDate,
  weekStarts: readonly string[],
  signal: 'hrv' | 'resting-hr',
  cyclic: boolean,
): TrendWeek[] {
  const pick = (row: WellnessSeriesRow) => (signal === 'hrv' ? row.hrvRmssd : row.restingHr)
  const weeks = weekStarts.map((weekStart): TrendWeek => {
    const values = weekReadings(byDate, weekStart, pick)
    const enough = values.length >= MIN_NIGHTS_PER_MEAN
    const weekMean = !enough
      ? null
      : signal === 'hrv'
        ? Math.exp(mean(values.map(Math.log)))
        : mean(values)
    const range = recentRange(byDate, weekStart, signal, cyclic)
    return {
      weekStart,
      mean: weekMean === null ? null : round(weekMean, 1),
      nights: values.length,
      low: range === null ? null : round(range.low, 1),
      high: range === null ? null : round(range.high, 1),
      readings: baselineReadings(byDate, weekStart, signal, cyclic).values.length,
    }
  })
  return weeks.some((week) => week.nights > 0) ? weeks : []
}

/**
 * One entry per week of `weekStarts` for recorded sleep in hours. The mean is null under
 * `j5.sleepMinNights` nights. Sleep has no range: its bounds are null and `readings` is null.
 */
export function weeklySleep(byDate: SeriesByDate, weekStarts: readonly string[]): TrendWeek[] {
  const weeks = weekStarts.map((weekStart): TrendWeek => {
    const hours = weekReadings(byDate, weekStart, (row) => row.sleepSec).map((sec) => sec / 3600)
    return {
      weekStart,
      mean: hours.length >= P.j5.sleepMinNights.value ? round(mean(hours), 2) : null,
      nights: hours.length,
      low: null,
      high: null,
      readings: null,
    }
  })
  return weeks.some((week) => week.nights > 0) ? weeks : []
}
