import { describe, expect, test } from 'vitest'
import {
  RUN_MINUTES_DAYS,
  runMinutesAhead,
  type RunMinutesRow,
} from '../../../shared/domain/runMinutes.ts'

// Today is Thursday 22 October; the four weeks run to Wednesday 18 November.
const TODAY = '2026-10-22'

const row = (date: string, durationMin: number, over: Partial<RunMinutesRow> = {}) => ({
  date,
  kind: 'easy',
  durationMin,
  status: 'planned',
  ...over,
})
const none = { created: [], deleted: [], updated: [] }

const rows = [
  row('2026-10-20', 60), // before today
  row('2026-10-22', 50),
  row('2026-10-25', 90, { kind: 'long' }),
  row('2026-10-23', 30, { kind: 'strength' }),
  row('2026-10-27', 40, { status: 'skipped' }),
  row('2026-11-18', 45), // the last day
  row('2026-11-19', 45), // one day too far
]

describe('the running time of the next four weeks', () => {
  test('spans 28 days from today', () => {
    expect(RUN_MINUTES_DAYS).toBe(28)
  })

  test('adds up the runs still to come, and nothing else, when a write changes nothing', () => {
    // 50 + 90 + 45; strength, a skipped run and days outside the weeks do not count.
    expect(runMinutesAhead(rows, none, TODAY)).toEqual({ before: 185, after: 185 })
  })

  test('applies the created, deleted and updated rows of a write to the total', () => {
    expect(
      runMinutesAhead(
        rows,
        {
          // a run added
          created: [row('2026-10-30', 25)],
          // a run day held as rest
          deleted: [row('2026-10-22', 50)],
          updated: [
            // a run cut short
            { before: row('2026-10-25', 90, { kind: 'long' }), after: row('2026-10-25', 60) },
            // a run moved out of the four weeks
            { before: row('2026-11-18', 45), after: row('2026-11-19', 45) },
          ],
        },
        TODAY,
      ),
    ).toEqual({ before: 185, after: 85 })
  })

  test('takes nothing from the total for a skipped run that a write replaces', () => {
    // A rest window releases a skipped run on a held day: the run was never in the first figure.
    expect(
      runMinutesAhead(
        rows,
        {
          created: [],
          deleted: [row('2026-10-27', 40, { status: 'skipped' })],
          updated: [
            { before: row('2026-10-22', 50), after: row('2026-10-22', 0, { kind: 'rest' }) },
          ],
        },
        TODAY,
      ),
    ).toEqual({ before: 185, after: 135 })
  })

  test('counts a skipped run that a write brings back to life', () => {
    const skipped = row('2026-10-27', 40, { status: 'skipped' })
    expect(
      runMinutesAhead(
        [skipped],
        { created: [], deleted: [], updated: [{ before: skipped, after: row('2026-10-27', 40) }] },
        TODAY,
      ),
    ).toEqual({ before: 0, after: 40 })
  })

  test('is never negative: with no run stored, a write only adds', () => {
    expect(runMinutesAhead([], none, TODAY)).toBeNull()
    expect(runMinutesAhead([], { ...none, created: [row('2026-10-30', 25)] }, TODAY)).toEqual({
      before: 0,
      after: 25,
    })
  })

  test('has no figure when no run is planned in those weeks', () => {
    expect(runMinutesAhead(rows, none, '2027-03-01')).toBeNull()
  })
})
