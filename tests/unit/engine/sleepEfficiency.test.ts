// The sleep-efficiency signal of rule J5: sleep over time in bed, the mean of the last window of
// nights against the runner's own baseline, active only with enough nights that have both values.
import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { weeklyDecision } from '../../../shared/engine/adapt.ts'
import { P } from '../../../shared/engine/params/index.ts'
import {
  sleepEfficiencyDrop,
  sleepEfficiencyEval,
  sleepEfficiencyOf,
} from '../../../shared/engine/readiness.ts'
import { input, wellnessDay } from './e8-fixtures.ts'

const END = '2026-10-18' // the Sunday that ends the week under review
const WEEK = '2026-10-12'
const WINDOW = P.j5.reducePersistDays.value
const BED = 8 * 3600

/** A night with `eff` percent efficiency over 8 h in bed. */
function night(daysBefore: number, eff: number | null, inBedSec: number | null = BED) {
  return wellnessDay(addDays(END, -daysBefore), {
    sleepSec: eff === null ? null : Math.round((BED * eff) / 100),
    inBedSec: eff === null ? null : inBedSec,
  })
}

/** `n` nights from `from` days back at `eff`. */
const nights = (from: number, n: number, eff: number) =>
  Array.from({ length: n }, (_, k) => night(from + k, eff))

/** A baseline of 10 nights at 90 % before the window and a window of 7 nights at `eff`. */
const series = (eff: number, windowNights = WINDOW) => [
  ...nights(0, windowNights, eff),
  ...nights(WINDOW, 10, 90),
]

describe('sleepEfficiencyOf', () => {
  it('is sleep over time in bed in percent, on a night with both', () => {
    expect(sleepEfficiencyOf({ sleepSec: 7 * 3600, inBedSec: 8 * 3600 })).toBeCloseTo(87.5)
  })

  it('is null without either value, or with more sleep than time in bed', () => {
    expect(sleepEfficiencyOf(undefined)).toBeNull()
    expect(sleepEfficiencyOf({ sleepSec: 7 * 3600, inBedSec: null })).toBeNull()
    expect(sleepEfficiencyOf({ sleepSec: null, inBedSec: 8 * 3600 })).toBeNull()
    expect(sleepEfficiencyOf({ sleepSec: 0, inBedSec: 8 * 3600 })).toBeNull()
    expect(sleepEfficiencyOf({ sleepSec: 9 * 3600, inBedSec: 8 * 3600 })).toBeNull()
  })
})

describe('sleepEfficiencyDrop (rule J5)', () => {
  it('is inactive for a runner with no time in bed', () => {
    const rows = Array.from({ length: 30 }, (_, k) =>
      wellnessDay(addDays(END, -k), { sleepSec: 7 * 3600 }),
    )
    expect(sleepEfficiencyEval(rows, END)).toEqual({
      windowNights: 0,
      baselineNights: 0,
      dropPp: null,
    })
  })

  it('is inactive with too few nights in the window, and says nothing', () => {
    const few = P.j5.sleepEffMinNights.value - 1
    const rows = [...nights(0, few, 80), ...nights(WINDOW, 10, 90)]
    const view = sleepEfficiencyEval(rows, END)
    expect(view.windowNights).toBe(few)
    expect(view.dropPp).toBeNull()
    expect(sleepEfficiencyDrop(rows, END)).toBeNull()
  })

  it('is active at the minimum number of nights in the window', () => {
    const rows = series(88, P.j5.sleepEffMinNights.value)
    expect(sleepEfficiencyDrop(rows, END)).toBe(2)
  })

  it('is inactive with too few baseline nights, active at the minimum', () => {
    const minBase = P.j5.sleepEffMinBaselineNights.value
    const rows = (baseline: number) => [...nights(0, WINDOW, 80), ...nights(WINDOW, baseline, 90)]
    expect(sleepEfficiencyDrop(rows(minBase - 1), END)).toBeNull()
    expect(sleepEfficiencyDrop(rows(minBase), END)).toBe(10)
  })

  it('reads a drop of exactly 2 points and fires; 1 point is below the threshold', () => {
    expect(sleepEfficiencyDrop(series(88), END)).toBe(2)
    expect(sleepEfficiencyDrop(series(89), END)).toBe(1)
    expect(P.j5.sleepEfficiencyDropPp.value).toBe(2)
  })

  it('reads a rise as a negative drop', () => {
    expect(sleepEfficiencyDrop(series(92), END)).toBe(-2)
  })

  it('builds the baseline from the nights before the window, never the window itself', () => {
    // Window at 80, the nights before it at 90: the baseline is 90 whatever the window holds.
    expect(sleepEfficiencyDrop(series(80), END)).toBe(10)
  })

  it('keeps the newest baseline nights within the lookback, and ignores older ones', () => {
    const old = nights(WINDOW + P.j5.sleepEffLookbackDays.value, 20, 50)
    const rows = [...series(88), ...old]
    expect(sleepEfficiencyDrop(rows, END)).toBe(2)
    const view = sleepEfficiencyEval(rows, END)
    expect(view.baselineNights).toBe(P.j5.sleepEffBaselineNights.value)
  })

  it('skips nights with a gap, a missing value or a disagreeing pair', () => {
    const rows = [
      ...nights(0, 5, 88),
      night(5, null),
      wellnessDay(addDays(END, -6), { sleepSec: 9 * 3600, inBedSec: BED }),
      ...nights(WINDOW, 10, 90),
    ]
    expect(sleepEfficiencyEval(rows, END)).toMatchObject({ windowNights: 5, dropPp: 2 })
  })
})

describe('weeklyDecision reads the sleep-efficiency drop from the stored nights', () => {
  const run = (wellness: ReturnType<typeof night>[], ctx = {}) =>
    weeklyDecision(input({ today: addDays(END, 1), wellness }), WEEK, ctx).signals.map(
      (s) => s.code,
    )

  it('adds the signal for a drop of 2 points and not for 1 point', () => {
    expect(run(series(88))).toContain('sleep-efficiency-drop')
    expect(run(series(89))).not.toContain('sleep-efficiency-drop')
  })

  it('adds nothing for a runner with no time in bed', () => {
    const rows = Array.from({ length: 30 }, (_, k) =>
      wellnessDay(addDays(END, -k), { sleepSec: 7 * 3600 }),
    )
    expect(run(rows)).not.toContain('sleep-efficiency-drop')
  })

  it('lets the caller pass the figure, null included', () => {
    expect(run([], { sleepEfficiencyDropPp: 3 })).toContain('sleep-efficiency-drop')
    expect(run(series(80), { sleepEfficiencyDropPp: null })).not.toContain('sleep-efficiency-drop')
  })
})
