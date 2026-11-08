// The arrival ranges of the race plan's checkpoint table (rule H14 and L5, ADR 0018, step 4): the
// properties the design holds `splitsFor` to. Fixtures are synthetic ("Checkpoint A").
import { describe, expect, it } from 'vitest'
import { P } from '../../../shared/engine/params/index.ts'
import { splitsFor } from '../../../shared/engine/raceSplits.ts'
import type { CheckpointInput, SplitsInput } from '../../../shared/engine/raceSplits.ts'

const HOUR = 3600
const COURSE_M = 160_000
const STEP = P.r1.arrivalRoundMin.value * 60

const row = (name: string, distanceM: number, over: Partial<CheckpointInput> = {}) => ({
  name,
  distanceM,
  gainM: null,
  lossM: null,
  cutoffSec: null,
  ...over,
})

function input(over: Partial<SplitsInput> = {}): SplitsInput {
  return {
    distanceM: COURSE_M,
    courseGainM: 0,
    supportLevel: 'aided',
    checkpoints: [row('Checkpoint A', 40_000), row('Checkpoint B', 100_000)],
    expected: { lowSec: 28 * HOUR, highSec: 36 * HOUR, midSec: 31 * HOUR },
    startMin: 6 * 60,
    rateGPerH: [55, 65],
    ...over,
  }
}

function splits(over: Partial<SplitsInput> = {}) {
  const result = splitsFor(input(over))
  if (result === null) throw new Error('no splits')
  return result
}

describe('splitsFor: the table', () => {
  it('has no splits without a row', () => {
    expect(splitsFor(input({ checkpoints: [] }))).toBeNull()
  })

  it('gives one row per checkpoint and the finish, in distance order, whatever the input order', () => {
    const { rows } = splits({
      checkpoints: [row('Checkpoint B', 100_000), row('Checkpoint A', 40_000)],
    })
    expect(rows.map((r) => [r.name, r.distanceM, r.finish])).toEqual([
      ['Checkpoint A', 40_000, false],
      ['Checkpoint B', 100_000, false],
      [null, COURSE_M, true],
    ])
    expect(rows.map((r) => r.segmentM)).toEqual([40_000, 60_000, 60_000])
  })

  it('is deterministic and does not change its input', () => {
    const checkpoints = [row('Checkpoint B', 100_000), row('Checkpoint A', 40_000)]
    const frozen = Object.freeze(checkpoints.map((c) => Object.freeze({ ...c })))
    const a = splitsFor(input({ checkpoints: frozen }))
    const b = splitsFor(input({ checkpoints: frozen }))
    expect(a).toEqual(b)
    expect(frozen.map((c) => c.name)).toEqual(['Checkpoint B', 'Checkpoint A'])
  })
})

describe('splitsFor: the arrival ranges', () => {
  it('makes the finish row equal to the expected range, to the second', () => {
    const { rows } = splits()
    const finish = rows.at(-1)
    expect([finish?.lowSec, finish?.highSec]).toEqual([28 * HOUR, 36 * HOUR])
  })

  it('keeps an interior row inside the finish range, on the rounding step, never running backwards', () => {
    for (const courseGainM of [0, 6000]) {
      const { rows } = splits({
        courseGainM,
        checkpoints: [
          row('Checkpoint A', 5_000, { gainM: 1200 }),
          row('Checkpoint B', 40_000),
          row('Checkpoint C', 41_000),
          row('Checkpoint D', 159_000, { gainM: 10 }),
        ],
      })
      let low = 0
      let high = 0
      for (const r of rows) {
        expect(r.lowSec % STEP, r.name ?? 'finish').toBe(0)
        expect(r.highSec % STEP, r.name ?? 'finish').toBe(0)
        expect(r.lowSec).toBeGreaterThanOrEqual(low)
        expect(r.highSec).toBeGreaterThanOrEqual(high)
        expect(r.lowSec).toBeLessThanOrEqual(r.highSec)
        expect(r.highSec).toBeLessThanOrEqual(36 * HOUR)
        low = r.lowSec
        high = r.highSec
      }
    }
  })

  it('on a flat course puts a row at its share of the distance, rounded outward', () => {
    const { rows } = splits({ courseGainM: 0 })
    const [a, b] = rows
    expect(a?.lowSec).toBe(Math.floor((28 * HOUR * 0.25) / STEP) * STEP)
    expect(a?.highSec).toBe(Math.ceil((36 * HOUR * 0.25) / STEP) * STEP)
    expect(b?.lowSec).toBe(Math.floor((28 * HOUR * 0.625) / STEP) * STEP)
    expect(b?.highSec).toBe(Math.ceil((36 * HOUR * 0.625) / STEP) * STEP)
  })

  it('treats a course with a climb and no entered rows as flat: the spread is proportional to distance', () => {
    const flat = splits({ courseGainM: 0 }).rows.map((r) => [r.lowSec, r.highSec])
    const climbing = splits({ courseGainM: 8000 }).rows.map((r) => [r.lowSec, r.highSec])
    expect(climbing).toEqual(flat)
  })

  it('moves a row later when the climb is before it, and earlier when the climb is after it', () => {
    const base = splits({ courseGainM: 0 }).rows[0]!
    const early = splits({
      courseGainM: 6000,
      checkpoints: [row('Checkpoint A', 40_000, { gainM: 4000 }), row('Checkpoint B', 100_000)],
    }).rows[0]!
    const late = splits({
      courseGainM: 6000,
      checkpoints: [row('Checkpoint A', 40_000, { gainM: 0 }), row('Checkpoint B', 100_000)],
    }).rows[0]!
    expect(early.highSec).toBeGreaterThan(base.highSec)
    expect(late.highSec).toBeLessThan(base.highSec)
  })

  it('weights each metre of climb as l5.gainEquivalentM metres of flat', () => {
    // One row at the start of a course whose whole climb is entered on the second segment.
    const { rows } = splits({
      distanceM: 100_000,
      courseGainM: 1000,
      checkpoints: [row('Checkpoint A', 50_000, { gainM: 0 })],
      expected: { lowSec: 10 * HOUR, highSec: 10 * HOUR, midSec: 10 * HOUR },
    })
    // The second segment holds the leftover 1000 m: weights 50 000 and 50 000 + 10 * 1000.
    const share = 50_000 / (50_000 + 50_000 + P.l5.gainEquivalentM.value * 1000)
    expect(rows[0]?.lowSec).toBe(Math.floor((10 * HOUR * share) / STEP) * STEP)
  })

  it('weighs climb at the figure the prediction used when the runner own climbing moved it (L5)', () => {
    const over = {
      distanceM: 100_000,
      courseGainM: 1000,
      checkpoints: [row('Checkpoint A', 50_000, { gainM: 0 })],
      expected: { lowSec: 10 * HOUR, highSec: 10 * HOUR, midSec: 10 * HOUR },
    }
    const climb = { runs: 23, defaultM: 10, personalM: 6, usedM: 9, shiftSec: -600, capped: false }
    const result = splits({ ...over, climb })
    const share = 50_000 / (50_000 + 50_000 + 9 * 1000)
    expect(result.rows[0]?.lowSec).toBe(Math.floor((10 * HOUR * share) / STEP) * STEP)
    expect(result.climb).toEqual(climb)
    expect(splits(over).climb).toBeNull()
  })

  it('spreads the climb left after the entered rows, all of it with the default share', () => {
    expect(P.r1.unenteredClimbShare.value).toBe(1)
    const { rows } = splits({
      courseGainM: 6000,
      checkpoints: [row('Checkpoint A', 40_000, { gainM: 2000 }), row('Checkpoint B', 100_000)],
    })
    expect(rows.map((r) => r.gainEntered)).toEqual([true, false, false])
    expect(rows.reduce((sum, r) => sum + r.gainM, 0)).toBeCloseTo(6000, 6)
    // The 4000 m left is spread by distance over the two unentered segments (60 km each).
    expect(rows[1]?.gainM).toBeCloseTo(2000, 6)
    expect(rows[2]?.gainM).toBeCloseTo(2000, 6)
  })

  it('gives no credit for descent: a row with a long descent arrives when it would without it', () => {
    const none = splits().rows.map((r) => [r.lowSec, r.highSec])
    const down = splits({
      checkpoints: [
        row('Checkpoint A', 40_000, { lossM: 3000 }),
        row('Checkpoint B', 100_000, { lossM: 5000 }),
      ],
    })
    expect(down.rows.map((r) => [r.lowSec, r.highSec])).toEqual(none)
    expect(down.rows.map((r) => r.lossM)).toEqual([3000, 5000, null])
  })

  it('counts a row at or past the finish, or at the start, and leaves it out', () => {
    const result = splits({
      checkpoints: [
        row('Checkpoint A', 0),
        row('Checkpoint B', 40_000),
        row('Checkpoint C', COURSE_M),
        row('Checkpoint D', COURSE_M + 5000),
      ],
    })
    expect(result.ignored).toBe(3)
    expect(result.rows.map((r) => r.name)).toEqual(['Checkpoint B', null])
  })

  it('states when the climb of the rows adds up to more than the course climb, and when there is none to share', () => {
    const over = splits({
      courseGainM: 1000,
      checkpoints: [
        row('Checkpoint A', 40_000, { gainM: 800 }),
        row('Checkpoint B', 100_000, { gainM: 800 }),
      ],
    })
    expect(over.climbOverCourse).toBe(true)
    expect(over.rows.at(-1)?.gainM).toBe(0)

    const unknown = splits({ courseGainM: 0 })
    expect(unknown.courseGainKnown).toBe(false)
    expect(unknown.climbUnknown).toBe(true)
    const entered = splits({
      courseGainM: 0,
      checkpoints: [row('Checkpoint A', 40_000, { gainM: 100 })],
    })
    expect(entered.climbUnknown, 'the finish segment still has none of its own').toBe(true)
    expect(splits({ courseGainM: 3000 }).climbUnknown).toBe(false)
  })
})

describe('splitsFor: the facts on a row', () => {
  it('gives clock times from the start time and none without it', () => {
    const withStart = splits().rows
    expect(withStart[0]?.clock?.from.time).toMatch(/^\d\d:\d\d$/)
    expect(withStart.at(-1)?.clock?.from).toEqual({ time: '10:00', day: 1 })
    expect(withStart.at(-1)?.clock?.to).toEqual({ time: '18:00', day: 1 })
    const without = splits({ startMin: null }).rows
    expect(without.every((r) => r.clock === null && r.night === null)).toBe(true)
  })

  it('tags a row by the middle of its range against the D1 daylight clock', () => {
    const { rows } = splits()
    // The middle of the race is 31 h in: 06:00 + 31 h = 13:00 the next day, in daylight; the
    // quarter point is 7.75 h in, 13:45 the first day.
    expect(rows.at(-1)?.night).toBe(false)
    const night = splits({
      startMin: 19 * 60 + 30,
      checkpoints: [row('Checkpoint A', 5_000)],
    }).rows[0]
    expect(night?.night).toBe(true)
  })

  it('carries a cutoff through and compares it with nothing', () => {
    const { rows } = splits({
      checkpoints: [
        row('Checkpoint A', 40_000, { cutoffSec: 5 * HOUR }),
        row('Checkpoint B', 100_000),
      ],
    })
    expect(rows.map((r) => r.cutoffSec)).toEqual([5 * HOUR, null, null])
    expect(Object.keys(rows[0] ?? {})).not.toContain('beforeCutoff')
    // A cutoff well inside the range, and one past it, leave every arrival the same.
    const tight = splits({
      checkpoints: [row('Checkpoint A', 40_000, { cutoffSec: 60 }), row('Checkpoint B', 100_000)],
    }).rows.map((r) => [r.lowSec, r.highSec])
    const loose = splits({
      checkpoints: [
        row('Checkpoint A', 40_000, { cutoffSec: 400 * HOUR }),
        row('Checkpoint B', 100_000),
      ],
    }).rows.map((r) => [r.lowSec, r.highSec])
    expect(tight).toEqual(loose)
  })

  it('gives grams to carry for an aided race: the rate over each segment, summing to the rate over the race', () => {
    const { rows } = splits()
    const carry = rows.map((r) => r.carryG)
    expect(carry.every((c) => c !== null)).toBe(true)
    const low = rows.reduce((sum, r) => sum + (r.carryG?.[0] ?? 0), 0)
    const high = rows.reduce((sum, r) => sum + (r.carryG?.[1] ?? 0), 0)
    expect(low).toBeCloseTo(55 * 31, 6)
    expect(high).toBeCloseTo(65 * 31, 6)
  })

  it('gives no grams to carry, and no aid rule, for a self-supported race', () => {
    const { rows, rules } = splits({ supportLevel: 'self' })
    expect(rows.every((r) => r.carryG === null)).toBe(true)
    expect(rules).not.toContain('H7')
    expect(splits().rules).toContain('H7')
  })

  it('tags a segment that climbs at h4.climbNoteGainPerHourM or more per hour of its time', () => {
    const { rows, rules } = splits({
      courseGainM: 0,
      checkpoints: [
        row('Checkpoint A', 40_000, { gainM: 4000 }),
        row('Checkpoint B', 100_000, { gainM: 10 }),
      ],
    })
    expect(rows.map((r) => r.climbByEffort)).toEqual([true, false, false])
    expect(rules).toContain('H4')
    expect(splits().rules).not.toContain('H4')
    expect(splits().rules).toEqual(expect.arrayContaining(['H14', 'L5']))
  })
})
