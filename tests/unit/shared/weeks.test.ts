import { describe, expect, test } from 'vitest'
import { aggregateWeeks } from '../../../shared/domain/weeks.ts'
import { addDays } from '../../../shared/dates.ts'
import { makeActivity } from '../../factories.ts'

const W = '2026-03-02'
const min = (n: number) => n * 60

function first(rows: ReturnType<typeof aggregateWeeks>) {
  const row = rows[0]
  if (!row) throw new Error('expected a row')
  return row
}

describe('aggregateWeeks', () => {
  test('run minutes count only runs; race, strength and cross are separate', () => {
    const row = first(
      aggregateWeeks(
        [
          makeActivity({ date: W, type: 'run', durationSec: 3600 }),
          makeActivity({ date: addDays(W, 1), type: 'run', durationSec: 1800 }),
          makeActivity({ date: addDays(W, 2), type: 'race', durationSec: 7200 }),
          makeActivity({ date: addDays(W, 3), type: 'strength', durationSec: 2700 }),
          makeActivity({ date: addDays(W, 4), type: 'cross', durationSec: 1800 }),
        ],
        [W],
      ),
    )
    expect(row).toMatchObject({
      weekStart: W,
      runMin: 90,
      raceMin: 120,
      crossMin: 30,
      strengthSessions: 1,
      runSessions: 2,
    })
  })

  test('run days are distinct dates', () => {
    const row = first(
      aggregateWeeks(
        [
          makeActivity({ date: '2026-03-02' }),
          makeActivity({ date: '2026-03-02' }),
          makeActivity({ date: '2026-03-04' }),
        ],
        [W],
      ),
    )
    expect(row).toMatchObject({ runSessions: 3, runDays: 2 })
  })

  test('possible and confirmed duplicates are excluded; dismissed ones count', () => {
    const row = first(
      aggregateWeeks(
        [
          makeActivity({ durationSec: min(30), duplicateStatus: 'possible' }),
          makeActivity({ durationSec: min(30), duplicateStatus: 'confirmed' }),
          makeActivity({ durationSec: min(30), duplicateStatus: 'dismissed' }),
          makeActivity({ durationSec: min(30), duplicateStatus: 'none' }),
        ],
        [W],
      ),
    )
    expect(row.runMin).toBe(60)
    expect(row.runSessions).toBe(2)
  })

  test('Sunday belongs to the preceding Monday, Monday to its own week', () => {
    const rows = aggregateWeeks(
      [
        makeActivity({ date: '2026-03-08', durationSec: min(40) }),
        makeActivity({ date: '2026-03-09', durationSec: min(20) }),
      ],
      [W, '2026-03-09'],
    )
    expect(rows.map((r) => r.runMin)).toEqual([40, 20])
  })

  test('longest run and share', () => {
    const row = first(
      aggregateWeeks(
        [
          makeActivity({ date: '2026-03-02', durationSec: min(60) }),
          makeActivity({ date: '2026-03-04', durationSec: min(30) }),
        ],
        [W],
      ),
    )
    expect(row.longestRunMin).toBe(60)
    expect(row.longRunShare).toBeCloseTo(0.667, 3)
  })

  test('a week with no runs gives zeros and a null share, never NaN', () => {
    const row = first(aggregateWeeks([], [W]))
    expect(row).toEqual({
      weekStart: W,
      runMin: 0,
      runM: 0,
      runSessions: 0,
      runDays: 0,
      strengthSessions: 0,
      crossMin: 0,
      raceMin: 0,
      longestRunMin: 0,
      longRunShare: null,
      avg4wRunMin: 0,
      streak3Plus: 0,
    })
  })

  test('a week with only strength has a null share', () => {
    const row = first(aggregateWeeks([makeActivity({ type: 'strength' })], [W]))
    expect(row.longRunShare).toBeNull()
    expect(row.strengthSessions).toBe(1)
  })

  test('runM sums distance, treating null as 0', () => {
    const row = first(
      aggregateWeeks(
        [
          makeActivity({ distanceM: 5000 }),
          makeActivity({ distanceM: null }),
          makeActivity({ distanceM: 2500 }),
        ],
        [W],
      ),
    )
    expect(row.runM).toBe(7500)
  })

  test('runMin rounds the summed seconds to whole minutes', () => {
    const row = first(aggregateWeeks([makeActivity({ durationSec: 3570 })], [W]))
    expect(row.runMin).toBe(60)
  })

  test('avg4wRunMin is the mean of this and the previous 3 calendar weeks, empty weeks included', () => {
    // weeks W-3..W hold 60, 120, 0 and 180 minutes
    const rows = aggregateWeeks(
      [
        makeActivity({ date: addDays(W, -21), durationSec: min(60) }),
        makeActivity({ date: addDays(W, -14), durationSec: min(120) }),
        makeActivity({ date: W, durationSec: min(180) }),
      ],
      [W],
    )
    expect(first(rows).avg4wRunMin).toBe(90)
  })

  test('streak3Plus counts consecutive weeks ending here with at least 3 run sessions', () => {
    const runs = (weekStart: string, n: number) =>
      Array.from({ length: n }, (_, i) => makeActivity({ date: addDays(weekStart, i) }))
    const w1 = addDays(W, -7)
    const w2 = addDays(W, -14)
    const all = [...runs(w2, 3), ...runs(w1, 3), ...runs(W, 3)]
    expect(first(aggregateWeeks(all, [W])).streak3Plus).toBe(3)

    const gap = [...runs(w2, 3), ...runs(w1, 2), ...runs(W, 3)]
    expect(first(aggregateWeeks(gap, [W])).streak3Plus).toBe(1)

    const thisWeekShort = [...runs(w2, 3), ...runs(w1, 3), ...runs(W, 2)]
    expect(first(aggregateWeeks(thisWeekShort, [W])).streak3Plus).toBe(0)
  })

  test('streak3Plus stops at the earliest activity week and handles no activities', () => {
    expect(first(aggregateWeeks([], [W])).streak3Plus).toBe(0)
    const rows = aggregateWeeks(
      Array.from({ length: 3 }, (_, i) => makeActivity({ date: addDays(W, i) })),
      [W],
    )
    expect(first(rows).streak3Plus).toBe(1)
  })

  test('rows follow weekStarts order and include weeks with no activity', () => {
    const rows = aggregateWeeks(
      [makeActivity({ date: '2026-03-09', durationSec: min(30) })],
      ['2026-03-16', W, '2026-03-09'],
    )
    expect(rows.map((r) => r.weekStart)).toEqual(['2026-03-16', W, '2026-03-09'])
    expect(rows.map((r) => r.runMin)).toEqual([0, 0, 30])
  })

  test('a week start that is not a Monday or not a date throws instead of giving an empty row', () => {
    expect(() => aggregateWeeks([], ['2026-03-04'])).toThrow(RangeError)
    expect(() => aggregateWeeks([], ['2026-3-2'])).toThrow(RangeError)
  })
})
