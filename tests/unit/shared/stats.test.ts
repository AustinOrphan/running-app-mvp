import { describe, expect, test } from 'vitest'
import {
  fastestEfforts,
  longestRuns,
  monthlyTotals,
  statsOf,
  yearlyTotals,
} from '../../../shared/domain/stats.ts'
import type { Activity } from '../../../shared/types.ts'
import { makeActivity, makeActivityCore } from '../../factories.ts'

const run = (distanceM: number | null, durationSec: number, over: Partial<Activity> = {}) =>
  makeActivity({ type: 'run', distanceM, durationSec, ...over })

describe('fastestEfforts', () => {
  test('labels and targets', () => {
    const efforts = fastestEfforts([
      run(1610, 400),
      run(5000, 1500),
      run(10000, 3200),
      run(21100, 6600),
      run(42195, 14400),
      run(50000, 20000),
    ])
    expect(efforts.map((e) => e.label)).toEqual(['1 mi', '5K', '10K', 'Half', 'Marathon', '50K'])
    expect(efforts.map((e) => e.targetM)).toEqual([1609.344, 5000, 10000, 21097.5, 42195, 50000])
  })

  test('window: from 99.5% of the target up to 102% of it', () => {
    const only5k = (d: number) => fastestEfforts([run(d, 1500)]).filter((e) => e.label === '5K')
    expect(only5k(5000)).toHaveLength(1)
    expect(only5k(5100)).toHaveLength(1)
    expect(only5k(5101)).toHaveLength(0)
    expect(only5k(4975)).toHaveLength(1)
    expect(only5k(4974)).toHaveLength(0)
    const mile = (d: number) => fastestEfforts([run(d, 400)]).filter((e) => e.label === '1 mi')
    expect(mile(1609.344)).toHaveLength(1)
    expect(mile(1641)).toHaveLength(1)
    expect(mile(1642)).toHaveLength(0)
    expect(mile(1602)).toHaveLength(1)
    expect(mile(1601)).toHaveLength(0)
  })

  test('runs logged in whole miles qualify: 13.1 mi for Half, 26.2 mi for Marathon, but 3.08 mi is not a 5K', () => {
    const labels = (distanceM: number) =>
      fastestEfforts([run(Math.round(distanceM), 6000)]).map((e) => e.label)
    const mi = 1609.344
    expect(labels(13.1 * mi)).toContain('Half')
    expect(labels(26.2 * mi)).toContain('Marathon')
    expect(labels(3.1 * mi)).toContain('5K')
    // 3.08 mi is 4957 m, under the 4975 m floor.
    expect(labels(3.08 * mi)).not.toContain('5K')
  })

  test('pace is whole-run seconds per km, fastest wins, earlier date breaks ties', () => {
    const slow = run(5000, 1500, { id: 'slow', date: '2026-03-01' })
    const fast = run(5050, 1500, { id: 'fast', date: '2026-03-05' })
    const [best] = fastestEfforts([slow, fast])
    expect(best?.activityId).toBe('fast')
    expect(best?.paceSecPerKm).toBeCloseTo(297.03, 2)
    expect(best).toMatchObject({ date: '2026-03-05', distanceM: 5050, durationSec: 1500 })

    expect(fastestEfforts([slow])[0]?.paceSecPerKm).toBe(300)

    const later = run(5000, 1500, { id: 'later', date: '2026-04-01' })
    const earlier = run(5000, 1500, { id: 'earlier', date: '2026-02-01' })
    expect(fastestEfforts([later, earlier])[0]?.activityId).toBe('earlier')
    expect(fastestEfforts([earlier, later])[0]?.activityId).toBe('earlier')
  })

  test('races qualify; strength, cross and flagged duplicates do not; dismissed ones do', () => {
    const race = makeActivity({ type: 'race', distanceM: 10000, durationSec: 3000, id: 'race' })
    const strength = makeActivity({ type: 'strength', distanceM: 5000, durationSec: 1000 })
    const cross = makeActivity({ type: 'cross', distanceM: 5000, durationSec: 1000 })
    const possible = run(5000, 900, { duplicateStatus: 'possible' })
    const confirmed = run(5000, 900, { duplicateStatus: 'confirmed' })
    const dismissed = run(5000, 1400, { id: 'dismissed', duplicateStatus: 'dismissed' })
    const noDistance = run(null, 900)
    const efforts = fastestEfforts([
      race,
      strength,
      cross,
      possible,
      confirmed,
      dismissed,
      noDistance,
    ])
    expect(efforts.map((e) => [e.label, e.activityId])).toEqual([
      ['5K', 'dismissed'],
      ['10K', 'race'],
    ])
  })

  test('labels without a qualifying run are omitted', () => {
    expect(fastestEfforts([])).toEqual([])
    expect(fastestEfforts([run(3000, 900)])).toEqual([])
  })
})

describe('period totals', () => {
  const sample = [
    run(5000, 1800, { date: '2026-02-03' }),
    run(10000, 3629, { date: '2026-02-20' }),
    run(8000, 2400, { date: '2026-03-01' }),
    makeActivity({ type: 'race', date: '2026-03-08', distanceM: 10000, durationSec: 3000 }),
    makeActivity({ type: 'strength', date: '2026-03-09', distanceM: null, durationSec: 2700 }),
    run(5000, 1800, { date: '2026-03-10', duplicateStatus: 'possible' }),
    run(6000, 2100, { date: '2025-12-31' }),
  ]

  test('monthlyTotals ascending, runs only, rounded minutes', () => {
    expect(monthlyTotals(sample)).toEqual([
      { month: '2025-12', runMin: 35, runM: 6000, runs: 1, longestRunMin: 35 },
      { month: '2026-02', runMin: 90, runM: 15000, runs: 2, longestRunMin: 60 },
      { month: '2026-03', runMin: 40, runM: 8000, runs: 1, longestRunMin: 40 },
    ])
  })

  test('yearlyTotals ascending', () => {
    expect(yearlyTotals(sample)).toEqual([
      { year: '2025', runMin: 35, runM: 6000, runs: 1, longestRunMin: 35 },
      { year: '2026', runMin: 130, runM: 23000, runs: 3, longestRunMin: 60 },
    ])
  })

  test('dismissed duplicates count; confirmed duplicates and cross do not', () => {
    expect(
      monthlyTotals([
        run(5000, 1200, { date: '2026-04-01', duplicateStatus: 'dismissed' }),
        run(5000, 1200, { date: '2026-04-02', duplicateStatus: 'confirmed' }),
        makeActivity({ type: 'cross', date: '2026-04-03', distanceM: 20000, durationSec: 3600 }),
      ]),
    ).toEqual([{ month: '2026-04', runMin: 20, runM: 5000, runs: 1, longestRunMin: 20 }])
  })

  test('runs without a distance add zero metres', () => {
    expect(yearlyTotals([run(null, 600)])).toEqual([
      { year: '2026', runMin: 10, runM: 0, runs: 1, longestRunMin: 10 },
    ])
  })
})

describe('longestRuns', () => {
  test('orders by duration, limits, excludes duplicates and non-runs', () => {
    const acts = [
      run(5000, 1000, { id: 'a' }),
      run(9000, 3000, { id: 'b' }),
      run(7000, 2000, { id: 'c' }),
      run(20000, 9000, { id: 'dup', duplicateStatus: 'confirmed' }),
      makeActivity({ id: 'str', type: 'strength', durationSec: 9999 }),
    ]
    expect(longestRuns(acts, 2).map((a) => a.id)).toEqual(['b', 'c'])
    expect(longestRuns(acts).map((a) => a.id)).toEqual(['b', 'c', 'a'])
  })

  test('default limit is 10', () => {
    const acts = Array.from({ length: 12 }, (_, i) => run(5000, 1000 + i))
    expect(longestRuns(acts)).toHaveLength(10)
  })
})

test('empty input gives empty arrays', () => {
  expect(fastestEfforts([])).toEqual([])
  expect(monthlyTotals([])).toEqual([])
  expect(yearlyTotals([])).toEqual([])
  expect(longestRuns([])).toEqual([])
})

describe('rows of six columns', () => {
  // The server loads these six columns instead of whole activities; every statistic reads no more.
  test('feed the efforts, the totals and the longest runs', () => {
    const rows = [
      makeActivityCore({ id: 'fast', durationSec: 1500 }),
      makeActivityCore({ id: 'slow', durationSec: 1700, date: '2026-03-09' }),
      makeActivityCore({ id: 'dup', durationSec: 1000, duplicateStatus: 'possible' }),
    ]
    expect(fastestEfforts(rows).map((e) => [e.label, e.activityId])).toEqual([['5K', 'fast']])
    expect(monthlyTotals(rows)).toEqual([
      { month: '2026-03', runMin: 53, runM: 10000, runs: 2, longestRunMin: 28 },
    ])
    expect(yearlyTotals(rows)).toHaveLength(1)
    expect(longestRuns(rows).map((r) => r.id)).toEqual(['slow', 'fast'])
  })
})

describe('statsOf', () => {
  const rows = [
    makeActivityCore({ id: 'b', date: '2026-02-03', durationSec: 1380, distanceM: 5050 }),
    makeActivityCore({ id: 'a', date: '2026-02-03', durationSec: 1380, distanceM: 5050 }),
    makeActivityCore({ id: 'c', date: '2026-01-10', durationSec: 6000, distanceM: 21_200 }),
    makeActivityCore({ id: 'd', date: '2025-11-02', durationSec: 1500, distanceM: 5000 }),
    makeActivityCore({
      id: 'e',
      date: '2026-02-20',
      durationSec: 9000,
      duplicateStatus: 'possible',
    }),
    makeActivityCore({ id: 'f', date: '2026-02-22', type: 'strength', distanceM: null }),
  ]

  test('is the four statistics of the same rows', () => {
    expect(statsOf(rows)).toEqual({
      monthly: monthlyTotals(rows),
      yearly: yearlyTotals(rows),
      efforts: fastestEfforts(rows),
      longest: longestRuns(rows),
    })
  })

  test('does not depend on the order the rows arrive in, ties included', () => {
    const forward = statsOf(rows)
    expect(statsOf([...rows].reverse())).toEqual(forward)
    expect(statsOf([rows[3]!, rows[0]!, rows[5]!, rows[1]!, rows[4]!, rows[2]!])).toEqual(forward)
    // Two runs tie on pace and date; the smaller id is the one named, whatever came first.
    expect(forward.efforts.find((e) => e.label === '5K')?.activityId).toBe('a')
    expect(forward.longest.map((r) => r.id)).toEqual(['c', 'd', 'a', 'b'])
  })

  test('is empty for no rows', () => {
    expect(statsOf([])).toEqual({ monthly: [], yearly: [], efforts: [], longest: [] })
  })

  test('leaves its input alone, so a frozen history can be read', () => {
    const frozen = Object.freeze(rows.map((row) => Object.freeze({ ...row })))
    expect(() => statsOf([...frozen])).not.toThrow()
    expect(() => statsOf(frozen as unknown as typeof rows)).not.toThrow()
  })
})
