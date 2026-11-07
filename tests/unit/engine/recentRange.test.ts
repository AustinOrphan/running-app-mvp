import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { P } from '../../../shared/engine/params/index.ts'
import {
  baselineReadings,
  readinessSignals,
  recentRange,
} from '../../../shared/engine/readiness.ts'
import { hrvSeries, input, profile, STEADY_HRV, TODAY, wellnessDay } from './e8-fixtures.ts'

const byDate = (rows: Array<ReturnType<typeof wellnessDay>>) =>
  new Map(rows.map((row) => [row.date, row]))

const sd = (values: number[]) => {
  const m = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1))
}

describe('baselineReadings', () => {
  it('takes the newest windowDays readings of the lookback for the default profile', () => {
    const rows = hrvSeries(TODAY, [50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61])
    const { values, lookback } = baselineReadings(byDate(rows), TODAY, 'hrv', false)
    expect(lookback).toBe(P.j4.lookbackDays.value)
    expect(values).toHaveLength(P.j4.windowDays.value)
    expect(values[0]).toBeCloseTo(Math.log(61))
  })

  it('keeps every reading of the 35-day cycle baseline for the cyclic profile', () => {
    const rows = hrvSeries(
      TODAY,
      Array.from({ length: 30 }, (_, i) => 50 + i),
    )
    const { values, lookback } = baselineReadings(byDate(rows), TODAY, 'hrv', true)
    expect(lookback).toBe(P.j4.cycleBaselineDays.value)
    expect(values).toHaveLength(30)
  })

  it('reads resting heart rate on its own scale with no cycle handling', () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      wellnessDay(addDays(TODAY, -(i + 1)), { restingHr: 50 + i }),
    )
    const plain = baselineReadings(byDate(rows), TODAY, 'resting-hr', false)
    const cyclic = baselineReadings(byDate(rows), TODAY, 'resting-hr', true)
    expect(plain.values).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59])
    expect(cyclic).toEqual(plain)
  })

  it('skips days without a valid reading and never reads the date itself', () => {
    const rows = [
      wellnessDay(TODAY, { hrvRmssd: 99 }),
      wellnessDay(addDays(TODAY, -1), { hrvRmssd: 0 }),
      wellnessDay(addDays(TODAY, -2), { hrvRmssd: 60 }),
    ]
    expect(baselineReadings(byDate(rows), TODAY, 'hrv', false).values).toEqual([Math.log(60)])
  })
})

describe('recentRange', () => {
  it('is null below the minimum number of readings', () => {
    const rows = hrvSeries(TODAY, STEADY_HRV.slice(0, P.j4.minReadings.value - 1))
    expect(recentRange(byDate(rows), TODAY, 'hrv', false)).toBeNull()
  })

  it('gives the HRV bounds Today prints, mean of ln plus or minus one SD', () => {
    const rows = hrvSeries(TODAY, STEADY_HRV)
    const range = recentRange(byDate(rows), TODAY, 'hrv', false)
    const logs = STEADY_HRV.map(Math.log)
    const m = logs.reduce((a, b) => a + b, 0) / logs.length
    expect(range).not.toBeNull()
    expect(range!.low).toBeCloseTo(Math.exp(m - sd(logs)), 10)
    expect(range!.high).toBeCloseTo(Math.exp(m + sd(logs)), 10)
    expect(range!.readings).toBe(10)

    // The same series with a reading today: Today's sentence prints the rounded bounds.
    const withToday = [...rows, wellnessDay(TODAY, { hrvRmssd: 60 })]
    const signal = readinessSignals(input({ wellness: withToday }), TODAY).find(
      (s) => s.code === 'hrv',
    )!
    expect(signal.slots).toMatchObject({
      low: { n: Math.round(range!.low) },
      high: { n: Math.round(range!.high) },
    })
  })

  it('gives resting heart rate as mean plus or minus one SD in bpm', () => {
    const values = [50, 52, 51, 49, 50, 53, 48, 51, 50, 52]
    const rows = values.map((restingHr, i) =>
      wellnessDay(addDays(TODAY, -(values.length - i)), { restingHr }),
    )
    const range = recentRange(byDate(rows), TODAY, 'resting-hr', false)
    const m = values.reduce((a, b) => a + b, 0) / values.length
    expect(range!.mean).toBeCloseTo(m, 10)
    expect(range!.low).toBeCloseTo(m - sd(values), 10)
    expect(range!.high).toBeCloseTo(m + sd(values), 10)
  })

  it('agrees with Today for the female profile on the 35-day baseline', () => {
    const values = Array.from({ length: 28 }, (_, i) => 55 + ((i * 7) % 11))
    const rows = hrvSeries(TODAY, values)
    const range = recentRange(byDate(rows), TODAY, 'hrv', true)
    const signal = readinessSignals(
      input({
        profile: profile({ sex: 'female' }),
        wellness: [...rows, wellnessDay(TODAY, { hrvRmssd: 60 })],
      }),
      TODAY,
    ).find((s) => s.code === 'hrv')!
    expect(signal.slots).toMatchObject({
      low: { n: Math.round(range!.low) },
      high: { n: Math.round(range!.high) },
    })
  })
})
