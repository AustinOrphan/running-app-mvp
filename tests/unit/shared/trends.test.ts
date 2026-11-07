import { describe, expect, it } from 'vitest'
import { addDays, weekStartsBetween } from '../../../shared/dates.ts'
import {
  MIN_NIGHTS_PER_MEAN,
  MIN_WEIGHINS_PER_WEEK,
  seriesByDate,
  weeklyBands,
  weeklySleep,
  weightWeeks,
  type WellnessSeriesRow,
} from '../../../shared/domain/trends.ts'
import { P } from '../../../shared/engine/params/index.ts'

const MONDAY = '2026-10-19'
const WEEKS = weekStartsBetween(addDays(MONDAY, -7 * 5), MONDAY)

function night(
  date: string,
  over: Partial<Omit<WellnessSeriesRow, 'date'>> = {},
): WellnessSeriesRow {
  return { date, restingHr: null, hrvRmssd: null, sleepSec: null, ...over }
}

/** One row per day from `from` for `days` days, with `make` giving the reading of the day. */
function days(
  from: string,
  count: number,
  make: (index: number) => Partial<Omit<WellnessSeriesRow, 'date'>>,
): WellnessSeriesRow[] {
  return Array.from({ length: count }, (_, i) => night(addDays(from, i), make(i)))
}

describe('weeklyBands', () => {
  it('is an empty series when no week holds a reading', () => {
    expect(weeklyBands(seriesByDate([]), WEEKS, 'hrv', false)).toEqual([])
    expect(
      weeklyBands(seriesByDate([night(MONDAY, { restingHr: 50 })]), WEEKS, 'hrv', false),
    ).toEqual([])
  })

  it('returns one entry per week, in order', () => {
    const rows = days(addDays(WEEKS[0]!, -21), 60, () => ({ hrvRmssd: 60 }))
    const weeks = weeklyBands(seriesByDate(rows), WEEKS, 'hrv', false)
    expect(weeks.map((w) => w.weekStart)).toEqual(WEEKS)
  })

  it('leaves the mean null under the minimum nights and counts the nights', () => {
    const rows = days(MONDAY, MIN_NIGHTS_PER_MEAN - 1, () => ({ restingHr: 52 }))
    const [last] = weeklyBands(seriesByDate(rows), [MONDAY], 'resting-hr', false)
    expect(last).toMatchObject({ weekStart: MONDAY, mean: null, nights: MIN_NIGHTS_PER_MEAN - 1 })
    const enough = days(MONDAY, MIN_NIGHTS_PER_MEAN, () => ({ restingHr: 52 }))
    expect(weeklyBands(seriesByDate(enough), [MONDAY], 'resting-hr', false)[0]).toMatchObject({
      mean: 52,
      nights: MIN_NIGHTS_PER_MEAN,
    })
  })

  it('takes the heart-rate-variability mean on the ln scale', () => {
    const values = [40, 90, 60, 70]
    const rows = values.map((hrvRmssd, i) => night(addDays(MONDAY, i), { hrvRmssd }))
    const geometric = Math.exp(values.reduce((s, v) => s + Math.log(v), 0) / values.length)
    const [week] = weeklyBands(seriesByDate(rows), [MONDAY], 'hrv', false)
    expect(week!.mean).toBeCloseTo(geometric, 1)
    expect(week!.mean).not.toBeCloseTo(values.reduce((s, v) => s + v, 0) / values.length, 0)
  })

  it('builds the range at the Monday from earlier days only, never from the week itself', () => {
    // Ten steady earlier readings of 60, then a week of 120: the week must not widen its own band.
    const earlier = days(addDays(MONDAY, -10), 10, () => ({ hrvRmssd: 60 }))
    const week = days(MONDAY, 7, () => ({ hrvRmssd: 120 }))
    const [entry] = weeklyBands(seriesByDate([...earlier, ...week]), [MONDAY], 'hrv', false)
    expect(entry).toMatchObject({ mean: 120, low: 60, high: 60, readings: 10 })
  })

  it('has no range until j4.minReadings earlier readings exist and says how many do', () => {
    const rows = days(addDays(MONDAY, -6), 13, () => ({ hrvRmssd: 60 }))
    const [entry] = weeklyBands(seriesByDate(rows), [MONDAY], 'hrv', false)
    expect(P.j4.minReadings.value).toBe(10)
    expect(entry).toMatchObject({ low: null, high: null, readings: 6 })
  })

  it('reads the 35-day baseline for the cyclic profile', () => {
    // Twelve readings 34 to 23 days before the Monday are outside the 21-day lookback but inside 35.
    const old = days(addDays(MONDAY, -34), 12, (i) => ({ hrvRmssd: 50 + (i % 3) }))
    const week = days(MONDAY, 7, () => ({ hrvRmssd: 60 }))
    const rows = seriesByDate([...old, ...week])
    expect(weeklyBands(rows, [MONDAY], 'hrv', false)[0]).toMatchObject({ low: null, readings: 0 })
    const cyclic = weeklyBands(rows, [MONDAY], 'hrv', true)[0]!
    expect(cyclic.readings).toBe(12)
    expect(cyclic.low).not.toBeNull()
  })

  it('draws the resting heart rate range as mean plus or minus one SD of ten earlier readings', () => {
    const earlier = [48, 50, 52, 50, 49, 51, 50, 52, 48, 50].map((restingHr, i) =>
      night(addDays(MONDAY, -10 + i), { restingHr }),
    )
    const week = days(MONDAY, 4, () => ({ restingHr: 55 }))
    const [entry] = weeklyBands(seriesByDate([...earlier, ...week]), [MONDAY], 'resting-hr', false)
    // Mean 50, sample SD sqrt(18 / 9): 48.6 to 51.4. The week's own 55 does not move the band.
    expect(entry).toMatchObject({ mean: 55, nights: 4, readings: 10 })
    expect(entry!.low).toBeCloseTo(48.6, 1)
    expect(entry!.high).toBeCloseTo(51.4, 1)
  })

  it('never reads rMSSD from a night that holds only another signal', () => {
    const rows = days(MONDAY, 7, () => ({ restingHr: 50, sleepSec: 27_000 }))
    expect(weeklyBands(seriesByDate(rows), [MONDAY], 'hrv', false)).toEqual([])
  })
})

describe('weeklySleep', () => {
  it('is hours with no range, and null under j5.sleepMinNights nights', () => {
    const few = days(MONDAY, P.j5.sleepMinNights.value - 1, () => ({ sleepSec: 7 * 3600 }))
    expect(weeklySleep(seriesByDate(few), [MONDAY])[0]).toEqual({
      weekStart: MONDAY,
      mean: null,
      nights: P.j5.sleepMinNights.value - 1,
      low: null,
      high: null,
      readings: null,
    })
    const enough = days(MONDAY, P.j5.sleepMinNights.value, (i) => ({
      sleepSec: (i % 2 === 0 ? 7 : 8) * 3600,
    }))
    expect(weeklySleep(seriesByDate(enough), [MONDAY])[0]).toMatchObject({ mean: 7.5, nights: 4 })
  })

  it('is empty when no night was recorded', () => {
    expect(weeklySleep(seriesByDate([night(MONDAY, { restingHr: 50 })]), WEEKS)).toEqual([])
  })
})

describe('weightWeeks', () => {
  it('is the mean of a week in integer grams, null under the minimum, with no change figure', () => {
    const rows = [
      { date: MONDAY, weightKg: 70.1 },
      { date: addDays(MONDAY, 3), weightKg: 70.4 },
      { date: addDays(MONDAY, -7), weightKg: 75 },
    ]
    const weeks = weightWeeks(rows, [addDays(MONDAY, -14), addDays(MONDAY, -7), MONDAY])
    expect(weeks).toEqual([
      { weekStart: addDays(MONDAY, -14), grams: null, weighIns: 0 },
      { weekStart: addDays(MONDAY, -7), grams: null, weighIns: 1 },
      { weekStart: MONDAY, grams: 70250, weighIns: 2 },
    ])
    expect(MIN_WEIGHINS_PER_WEEK).toBe(2)
    for (const week of weeks) {
      expect(Object.keys(week).sort()).toEqual(['grams', 'weekStart', 'weighIns'])
    }
  })

  it('ignores a weigh-in outside the weeks and a reading that is not a weight', () => {
    const rows = [
      { date: addDays(MONDAY, 7), weightKg: 70 },
      { date: MONDAY, weightKg: 0 },
      { date: addDays(MONDAY, 1), weightKg: null },
    ]
    expect(weightWeeks(rows, [MONDAY])).toEqual([])
  })
})
