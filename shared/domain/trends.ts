// Weekly recovery series for the Trends page [rule T1]. Pure: a series of wellness rows in, one
// entry per week out. Nothing here sets a target or marks a week as inside or outside its range.
import { addDays } from '../dates.ts'
import { baselineReadings, recentRange } from '../engine/readiness.ts'
import { P } from '../engine/params/index.ts'
import type { TrendWeek, TrendWeightWeek, WeekRow } from '../types.ts'

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

/** Weigh-ins a weekly mean of body weight needs. A page default, as `MIN_NIGHTS_PER_MEAN` is. */
export const MIN_WEIGHINS_PER_WEEK = 2

/** The columns of a night the weight series reads. */
export interface WeightSeriesRow {
  date: string
  weightKg: number | null
}

/**
 * One entry per week of `weekStarts` for body weight: the mean of the week's weigh-ins in integer
 * grams, null under `MIN_WEIGHINS_PER_WEEK`. No difference, change or direction is computed. A
 * series with no weigh-in in any week is empty.
 */
export function weightWeeks(
  rows: readonly WeightSeriesRow[],
  weekStarts: readonly string[],
): TrendWeightWeek[] {
  const byDate = new Map(rows.map((row) => [row.date, row.weightKg]))
  const weeks = weekStarts.map((weekStart): TrendWeightWeek => {
    const values: number[] = []
    for (let k = 0; k < 7; k++) {
      const value = byDate.get(addDays(weekStart, k))
      if (valid(value)) values.push(value)
    }
    return {
      weekStart,
      grams: values.length >= MIN_WEIGHINS_PER_WEEK ? Math.round(mean(values) * 1000) : null,
      weighIns: values.length,
    }
  })
  return weeks.some((week) => week.weighIns > 0) ? weeks : []
}

/** Where a chart starts: the weeks from the first record on, and the Monday that week starts. */
export interface CroppedWeeks<T> {
  weeks: T[]
  /** The Monday of the first record when weeks before it were cut; null when nothing was cut. */
  cutBefore: string | null
}

/** The Monday of the first week of `weeks` that `hasRecord` accepts, or null when none does. */
export function firstRecordWeek<T extends { weekStart: string }>(
  weeks: readonly T[],
  hasRecord: (week: T) => boolean,
): string | null {
  return weeks.find(hasRecord)?.weekStart ?? null
}

/**
 * Where a range's plot starts. `firstRecord` is the first record of the whole history, not of the
 * range, so a quiet stretch at the start of a short range is drawn and a range reaching back past
 * the first record is cut to it. Null when nothing is cut (no record at all, or the range starts
 * on or after the first record).
 */
export function cropStart(
  weeks: readonly { weekStart: string }[],
  firstRecord: string | null,
): string | null {
  const first = weeks[0]
  return first !== undefined && firstRecord !== null && first.weekStart < firstRecord
    ? firstRecord
    : null
}

/** The weeks of a range from the first record on; whole when the range starts on or after it. */
export function cropToFirstRecord<T extends { weekStart: string }>(
  weeks: readonly T[],
  firstRecord: string | null,
): CroppedWeeks<T> {
  const start = cropStart(weeks, firstRecord)
  if (start === null) return { weeks: [...weeks], cutBefore: null }
  return { weeks: weeks.filter((week) => week.weekStart >= start), cutBefore: start }
}

/** A week with anything logged: a run, cross-training, a race or a strength session. */
export const weekHasRecord = (week: WeekRow): boolean =>
  week.runMin > 0 || week.crossMin > 0 || week.raceMin > 0 || week.strengthSessions > 0

/** A week with a recovery reading: at least one recorded night. */
export const trendWeekHasRecord = (week: TrendWeek): boolean => week.nights > 0
