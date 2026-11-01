// The baseline of the weekly ramp [rules G-2, J9]: `highestBaseline`, which every ramp limit reads.
// The cases below pin how a part week (a week a window took days from) counts: beside another week
// and inside the baseline window, never alone, never outside it.
import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { highestBaseline } from '../../../shared/engine/limits.ts'
import { P } from '../../../shared/engine/params/index.ts'

// Monday 30 November 2026; the weeks before it, by their distance (lag 1 is the week just before)
const WEEK = '2026-11-30'
const before = (weeks: number) => addDays(WEEK, -7 * weeks)

/** Minutes by distance before `WEEK`: `{ 1: 100, 2: 90 }` is 100 a week before and 90 two before. */
const volumes = (byDistance: Record<number, number>): Map<string, number> =>
  new Map(Object.entries(byDistance).map(([n, minutes]) => [before(Number(n)), minutes]))
const weeksAt = (...distances: number[]): Set<string> => new Set(distances.map(before))

describe('highestBaseline', () => {
  it('rests on the two baseline weeks and the six-week look back of the Params', () => {
    // the cases below count weeks from these two figures
    expect(P.g2.baselineWeeks.value).toBe(2)
    expect(P.g2.ceilingLookbackWeeks.value).toBe(6)
  })

  it('is the highest of the two weeks before, and null when no week is known', () => {
    expect(highestBaseline(volumes({ 1: 100, 2: 120, 3: 300 }), new Set(), WEEK, 1)).toBe(120)
    expect(highestBaseline(volumes({}), new Set(), WEEK, 1)).toBeNull()
    // the lag moves the window back
    expect(highestBaseline(volumes({ 2: 100, 3: 120, 4: 300 }), new Set(), WEEK, 2)).toBe(120)
  })

  it('leaves out the weeks it is told to skip and goes back to the first week that is not', () => {
    // two recovery weeks lie before the week: the window moves back to the loading week behind them
    const skip = weeksAt(1, 2)
    expect(highestBaseline(volumes({ 1: 60, 2: 70, 3: 200, 4: 300 }), skip, WEEK, 1)).toBe(200)
  })

  describe('with a part week', () => {
    it('counts beside another week, when it is the higher', () => {
      const partial = weeksAt(1)
      expect(highestBaseline(volumes({ 1: 130, 2: 100 }), new Set(), WEEK, 1, null, partial)).toBe(
        130,
      )
      // and beside a higher one it changes nothing
      expect(highestBaseline(volumes({ 1: 60, 2: 100 }), new Set(), WEEK, 1, null, partial)).toBe(
        100,
      )
    })

    it('never counts alone: the window moves back to the last week the window did not touch', () => {
      // 11-23 and 11-16 are part weeks and 11-09 a recovery week: 11-02 sets the baseline
      const got = highestBaseline(
        volumes({ 1: 0, 2: 209, 3: 217, 4: 290 }),
        weeksAt(3),
        WEEK,
        1,
        null,
        weeksAt(1, 2),
      )
      expect(got).toBe(290)
    })

    it('falls back to the part week when no other week is known', () => {
      expect(highestBaseline(volumes({ 1: 60 }), new Set(), WEEK, 1, null, weeksAt(1))).toBe(60)
      // two part weeks and nothing else: the higher of them
      expect(
        highestBaseline(volumes({ 1: 60, 2: 80 }), new Set(), WEEK, 1, null, weeksAt(1, 2)),
      ).toBe(80)
    })

    it('falls back to the part week when the look back finds no other week', () => {
      // every other week of the six lies in the skip set
      const skip = weeksAt(2, 3, 4, 5, 6)
      const got = highestBaseline(volumes({ 1: 60, 7: 500 }), skip, WEEK, 1, null, weeksAt(1))
      expect(got).toBe(60)
    })

    it('does not count outside the baseline window: a part week beyond it is no baseline', () => {
      // 100 and 110 fill the two baseline weeks; a higher part week three weeks back is not read
      const got = highestBaseline(
        volumes({ 1: 100, 2: 110, 3: 400 }),
        new Set(),
        WEEK,
        1,
        null,
        weeksAt(3),
      )
      expect(got).toBe(110)
      // nor when the window moved back past it for want of a week: only a week inside it counts
      const moved = highestBaseline(
        volumes({ 1: 0, 2: 0, 3: 400, 4: 200 }),
        weeksAt(1, 2),
        WEEK,
        1,
        null,
        weeksAt(3),
      )
      expect(moved).toBe(200)
    })

    it('is a week like another where it is not in the set of part weeks', () => {
      expect(highestBaseline(volumes({ 1: 60 }), new Set(), WEEK, 1)).toBe(60)
      expect(highestBaseline(volumes({ 1: 60, 2: 100 }), new Set(), WEEK, 1)).toBe(100)
    })

    it('leaves out a part week that is also skipped', () => {
      const got = highestBaseline(
        volumes({ 1: 130, 2: 100 }),
        weeksAt(1),
        WEEK,
        1,
        null,
        weeksAt(1),
      )
      expect(got).toBe(100)
    })
  })
})
