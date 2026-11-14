// Ratings the watch gave (rule B1, WR1): the spread check at its edges and the gate every engine
// reader sits behind.
import { describe, expect, test } from 'vitest'
import { P } from '../../../shared/engine/params/index.ts'
import {
  checkWatchRatings,
  readableActivity,
  watchRatingCheck,
  withUsableRatings,
} from '../../../shared/engine/watchRatings.ts'
import { sessionLoad } from '../../../shared/engine/load.ts'
import type { Activity, RpeSource } from '../../../shared/types.ts'
import { run } from './myPacesFixtures.ts'

const MIN = P.b1.watchRpeMinCount.value
const DISTINCT = P.b1.watchRpeMinDistinct.value
const SHARE = P.b1.watchRpeMaxModalShare.value

/** `n` ratings spread over `values` as evenly as they divide. */
function spread(n: number, values: number[]): number[] {
  return Array.from({ length: n }, (_, i) => values[i % values.length]!)
}

function rated(i: number, rpe: number | null, rpeSource: RpeSource | null): Activity {
  return run(i, 3, { rpe, rpeSource })
}

describe('checkWatchRatings', () => {
  test('is not usable with no rating', () => {
    expect(checkWatchRatings([])).toEqual({ count: 0, distinct: 0, modalShare: 0, usable: false })
  })

  test('needs the minimum count, and passes at it', () => {
    expect(checkWatchRatings(spread(MIN - 1, [3, 5, 7])).usable).toBe(false)
    expect(checkWatchRatings(spread(MIN, [3, 5, 7])).usable).toBe(true)
  })

  test('needs the minimum of different values, and passes at it', () => {
    expect(DISTINCT).toBe(3)
    expect(checkWatchRatings(spread(MIN, [5, 6])).usable).toBe(false)
    expect(checkWatchRatings(spread(MIN, [5, 6, 7])).usable).toBe(true)
  })

  test('a reflexive default tap fails: one value above the allowed share', () => {
    const tapped = [...Array.from({ length: 10 }, () => 5), 3, 7]
    const check = checkWatchRatings(tapped)
    expect(check.distinct).toBe(3)
    expect(check.modalShare).toBeCloseTo(10 / 12)
    expect(check.usable).toBe(false)
  })

  test('the modal share passes at exactly the limit and fails above it', () => {
    const n = 20
    const atLimit = Math.round(n * SHARE)
    const make = (top: number) => [
      ...Array.from({ length: top }, () => 5),
      ...spread(n - top, [3, 7]),
    ]
    expect(checkWatchRatings(make(atLimit)).usable).toBe(true)
    expect(checkWatchRatings(make(atLimit + 1)).usable).toBe(false)
  })
})

describe('withUsableRatings', () => {
  test('reads a watch rating as empty until the check passes, and an in-app one as stored', () => {
    const activities = [rated(1, 5, 'watch'), rated(2, 6, 'app'), rated(3, 4, null)]
    const out = withUsableRatings(activities)
    expect(out.check.usable).toBe(false)
    expect(out.activities.map((a) => a.rpe)).toEqual([null, 6, 4])
    // The marker is kept so a reader can still tell the rating was there.
    expect(out.activities[0]!.rpeSource).toBe('watch')
  })

  test('reads watch ratings like in-app ones once the check passes', () => {
    const activities = spread(MIN, [3, 5, 7]).map((v, i) => rated(i + 1, v, 'watch'))
    const out = withUsableRatings(activities)
    expect(out.check.usable).toBe(true)
    expect(out.activities).toBe(activities)
  })

  test('in-app ratings do not count toward the check', () => {
    const activities = spread(MIN, [3, 5, 7]).map((v, i) => rated(i + 1, v, 'app'))
    expect(watchRatingCheck(activities).count).toBe(0)
    expect(withUsableRatings(activities).activities).toBe(activities)
  })

  test('flagged duplicates are not counted', () => {
    const activities = spread(MIN, [3, 5, 7]).map((v, i) =>
      i === 0
        ? { ...rated(i + 1, v, 'watch'), duplicateStatus: 'confirmed' as const }
        : rated(i + 1, v, 'watch'),
    )
    expect(watchRatingCheck(activities).count).toBe(MIN - 1)
  })

  test('session RPE load ignores a held watch rating and uses a passing one', () => {
    const one = [rated(1, 8, 'watch')]
    const ctx = {
      profile: { sex: 'male' },
      zones: { hrMax: null, hrRest: null },
    } as unknown as Parameters<typeof sessionLoad>[1]
    const held = withUsableRatings(one).activities[0]!
    expect(sessionLoad(held, ctx).srpe).toBeNull()
    expect(sessionLoad(one[0]!, ctx).srpe).toBe(40 * 8)
  })
})

describe('readableActivity', () => {
  test('nulls only a watch rating, and only when the check fails', () => {
    expect(readableActivity(rated(1, 5, 'watch'), { usable: false }).rpe).toBeNull()
    expect(readableActivity(rated(1, 5, 'watch'), { usable: true }).rpe).toBe(5)
    expect(readableActivity(rated(1, 5, 'app'), { usable: false }).rpe).toBe(5)
    expect(readableActivity(rated(1, 5, null), { usable: false }).rpe).toBe(5)
  })
})
