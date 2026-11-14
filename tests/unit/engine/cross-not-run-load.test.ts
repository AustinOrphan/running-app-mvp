// PA1b: the cross-training line says "It does not count toward run load". This file is the check
// behind that sentence: an activity of type `cross` (bike, swim, elliptical, hike, walk) added to a
// history changes no run total, no 30-day reference, no ramp and no plan.
import { describe, expect, test } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { aggregateWeeks } from '../../../shared/domain/weeks.ts'
import { statsOf } from '../../../shared/domain/stats.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { makeActivityCore } from '../../factories.ts'
import { activity, input, TODAY } from './e8-fixtures.ts'

const CROSS_SUBTYPES = ['bike', 'swim', 'elliptical', 'hike', 'walk', 'other'] as const

function history() {
  const runs = []
  for (let week = 0; week < 10; week += 1) {
    for (const back of [1, 3, 5]) {
      runs.push(
        activity(addDays(TODAY, -(week * 7 + back)), {
          durationSec: 3000 + back * 300,
          distanceM: 8000 + back * 500,
          avgHr: 150,
        }),
      )
    }
  }
  return runs
}

/** A long, far, high-climb outing on days inside every window. */
function crossOutings() {
  return CROSS_SUBTYPES.map((subtype, i) =>
    activity(addDays(TODAY, -(1 + i * 2)), {
      id: `cross-${subtype}`,
      type: 'cross',
      subtype,
      durationSec: 6 * 3600,
      distanceM: 150_000,
      elevationGainM: 3000,
      avgHr: 140,
    }),
  )
}

const cores = (list: ReturnType<typeof history>) => list.map((a) => makeActivityCore({ ...a }))

describe('cross activities stay out of run load', () => {
  test('the athlete state is identical with and without them', () => {
    const base = estimateState(input({ activities: history() }))
    const withCross = estimateState(input({ activities: [...history(), ...crossOutings()] }))
    // `weeks` carries a separate `crossMin`; every other figure must be equal.
    const strip = (s: typeof base) => ({
      ...s,
      weeks: s.weeks.map(({ crossMin: _crossMin, ...rest }) => rest),
    })
    expect(strip(withCross)).toEqual(strip(base))
    expect(withCross.weeks.some((w) => w.crossMin > 0)).toBe(true)
  })

  test('the generated plan is identical with and without them', () => {
    const base = buildPlan(input({ activities: history() }))
    const withCross = buildPlan(input({ activities: [...history(), ...crossOutings()] }))
    expect(withCross.weeks).toEqual(base.weeks)
    expect(withCross.sessions).toEqual(base.sessions)
  })

  test('weekly run minutes and the statistics ignore them', () => {
    const weekStart = addDays(TODAY, -2)
    const rows = aggregateWeeks(cores([...history(), ...crossOutings()]), [weekStart])
    const without = aggregateWeeks(cores(history()), [weekStart])
    expect(rows[0]!.runMin).toBe(without[0]!.runMin)
    expect(rows[0]!.runSessions).toBe(without[0]!.runSessions)
    expect(statsOf(cores([...history(), ...crossOutings()]))).toEqual(statsOf(cores(history())))
  })
})
