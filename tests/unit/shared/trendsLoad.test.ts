import { describe, expect, it } from 'vitest'
import {
  bandSeconds,
  climbCoverage,
  climbInUnit,
  climbWeeks,
  intensityCoverage,
  intensityWeeks,
  loadRuns,
  type LoadSource,
  type TrendLoadRun,
} from '../../../shared/domain/trendsLoad.ts'
import { addDays, weekStartsBetween } from '../../../shared/dates.ts'
import type { HrQuality } from '../../../shared/types.ts'

const ZONES = { lt1Hr: 140, lt2Hr: 160 }

/** A summary that passes the checks of B2: a wrist source, all of an hour clean. */
const passing: HrQuality = {
  v: 2,
  th: '',
  source: 'wrist',
  movingSec: 3600,
  cleanSec: 3600,
  lockSec: 0,
  spikeSec: 0,
  dropSec: 0,
  flatSec: 0,
  mismatchSec: 0,
  halves: null,
  gapDecouplingPct: null,
}
/** The same hour with a third of it flagged, which fails for a wrist source. */
const failing: HrQuality = { ...passing, cleanSec: 1200, lockSec: 2400 }

/** One minute at each of 130, 150 and 170 bpm, in bins of 1 bpm from 100. */
function histogram(seconds: Record<number, number>) {
  const sec = new Array<number>(121).fill(0)
  for (const [bpm, s] of Object.entries(seconds)) sec[Number(bpm) - 100] = s
  return { start: 100, width: 1, sec }
}

const source = (over: Partial<LoadSource> = {}): LoadSource => ({
  date: '2026-06-02',
  durationSec: 3600,
  elevationGainM: 100,
  hrHistogram: histogram({ 130: 1200, 150: 1200, 170: 1200 }),
  hrQuality: passing,
  ...over,
})

const run = (over: Partial<TrendLoadRun> = {}): TrendLoadRun => ({
  date: '2026-06-02',
  durationSec: 3600,
  elevationGainM: 100,
  bandSec: [1200, 1200, 1200],
  ...over,
})

describe('bandSeconds', () => {
  it('cuts the histogram at the two limits', () => {
    expect(bandSeconds(source(), ZONES)).toEqual([1200, 1200, 1200])
  })

  it('splits a bin that straddles a limit in proportion to its overlap', () => {
    // A bin of 10 bpm from 135 to 145 holds 100 s; the limit at 140 halves it.
    const hist = { start: 135, width: 10, sec: [100] }
    expect(bandSeconds({ hrHistogram: hist, hrQuality: passing }, ZONES)).toEqual([50, 50, 0])
  })

  it('is null without a histogram, without zones, or when the heart rate failed the checks', () => {
    expect(bandSeconds(source({ hrHistogram: null }), ZONES)).toBeNull()
    expect(bandSeconds(source(), null)).toBeNull()
    expect(bandSeconds(source({ hrQuality: failing }), ZONES)).toBeNull()
    // A summary that was never computed is not a pass.
    expect(bandSeconds(source({ hrQuality: null }), ZONES)).toBeNull()
  })

  it('is null for a histogram that holds no time or a bin that is not a number', () => {
    const zero = { start: 100, width: 1, sec: new Array<number>(121).fill(0) }
    expect(bandSeconds(source({ hrHistogram: zero }), ZONES)).toBeNull()
    const nan = histogram({ 130: 600, 150: Number.NaN })
    expect(bandSeconds(source({ hrHistogram: nan }), ZONES)).toBeNull()
  })
})

describe('loadRuns', () => {
  it('keeps a missing gain as null, sorts oldest first and never turns a failed run into bands', () => {
    const rows = loadRuns(
      [
        source({ date: '2026-06-09', elevationGainM: null }),
        source({ date: '2026-06-02', hrQuality: failing }),
      ],
      ZONES,
    )
    expect(rows.map((r) => r.date)).toEqual(['2026-06-02', '2026-06-09'])
    expect(rows[0]!.bandSec).toBeNull()
    expect(rows[1]!.elevationGainM).toBeNull()
    expect(rows[1]!.bandSec).toEqual([1200, 1200, 1200])
  })

  it('keeps a gain that is not a number as null, not as 0', () => {
    const [row] = loadRuns([source({ elevationGainM: Number.NaN })], ZONES)
    expect(row!.elevationGainM).toBeNull()
  })
})

describe('climbWeeks', () => {
  const weeks = weekStartsBetween('2026-05-04', '2026-06-08')
  const current = '2026-06-08'

  it('sums the gain of the week and leaves a week with no run, and a run with no gain, as gaps', () => {
    const rows = climbWeeks(
      [
        run({ date: '2026-05-05', elevationGainM: 300 }),
        run({ date: '2026-05-07', elevationGainM: 200 }),
        // 2026-05-11 week: no run at all.
        run({ date: '2026-05-19', elevationGainM: null }),
      ],
      weeks,
      current,
    )
    expect(rows[0]).toMatchObject({ weekStart: '2026-05-04', runs: 2, measured: 2, ascentM: 500 })
    expect(rows[1]).toMatchObject({ weekStart: '2026-05-11', runs: 0, measured: 0, ascentM: null })
    // Runs, none with a gain: counted, not zero.
    expect(rows[2]).toMatchObject({ weekStart: '2026-05-18', runs: 1, measured: 0, ascentM: null })
  })

  it('counts only the runs with a gain in a mixed week, and keeps a measured 0 m as 0', () => {
    const rows = climbWeeks(
      [
        run({ date: '2026-05-05', elevationGainM: 300 }),
        run({ date: '2026-05-06', elevationGainM: null }),
        run({ date: '2026-05-12', elevationGainM: 0 }),
      ],
      weeks,
      current,
    )
    expect(rows[0]).toMatchObject({ runs: 2, measured: 1, ascentM: 300 })
    expect(rows[1]).toMatchObject({ runs: 1, measured: 1, ascentM: 0 })
    expect(climbCoverage(rows)).toEqual({ runs: 3, covered: 2 })
  })

  it('draws the line as the mean of the week and the three before it, a week without runs counting 0 m', () => {
    const rows = climbWeeks(
      [
        run({ date: '2026-05-05', elevationGainM: 400 }),
        // The week of 05-11 has no run: nothing was climbed.
        run({ date: '2026-05-19', elevationGainM: 800 }),
        run({ date: '2026-05-26', elevationGainM: 1200 }),
      ],
      weeks,
      current,
    )
    // 05-04, 05-11, 05-18, 05-25: 400, 0, 800, 1200.
    expect(rows[3]!.meanM).toBe(600)
  })

  it('leaves a week whose runs lack a gain out of the line instead of reading it as 0', () => {
    const rows = climbWeeks(
      [
        run({ date: '2026-05-05', elevationGainM: 400 }),
        run({ date: '2026-05-12', elevationGainM: null }),
        run({ date: '2026-05-19', elevationGainM: 800 }),
        run({ date: '2026-05-26', elevationGainM: 1200 }),
      ],
      weeks,
      current,
    )
    // 400, unknown, 800, 1200: the mean of three.
    expect(rows[3]!.meanM).toBe(800)
  })

  it('has no point where fewer than two weeks hold a figure', () => {
    const rows = climbWeeks(
      [
        run({ date: '2026-05-05', elevationGainM: null }),
        run({ date: '2026-05-12', elevationGainM: null }),
        run({ date: '2026-05-19', elevationGainM: null }),
        run({ date: '2026-05-26', elevationGainM: 900 }),
      ],
      weeks,
      current,
    )
    expect(rows[3]!.meanM).toBeNull()
  })

  it('reads the weeks before the first shown for the line, and gives the current week no point', () => {
    const shown = weekStartsBetween('2026-06-01', '2026-06-08')
    const rows = climbWeeks(
      [
        run({ date: '2026-05-12', elevationGainM: 400 }),
        run({ date: '2026-05-19', elevationGainM: 400 }),
        run({ date: '2026-05-26', elevationGainM: 400 }),
        run({ date: '2026-06-02', elevationGainM: 400 }),
        run({ date: '2026-06-09', elevationGainM: 700 }),
      ],
      shown,
      current,
    )
    expect(rows[0]).toMatchObject({ weekStart: '2026-06-01', meanM: 400, current: false })
    expect(rows[1]).toMatchObject({ weekStart: current, ascentM: 700, meanM: null, current: true })
  })

  it('draws the current partial week as its own bar', () => {
    const rows = climbWeeks([run({ date: '2026-06-09', elevationGainM: 250 })], weeks, current)
    expect(rows.at(-1)).toMatchObject({ ascentM: 250, meanM: null, current: true })
  })

  it('returns nothing for no weeks and all gaps for no runs', () => {
    expect(climbWeeks([], [], current)).toEqual([])
    expect(climbWeeks([], weeks, current).every((w) => w.ascentM === null)).toBe(true)
  })
})

describe('climbInUnit', () => {
  it('keeps metres for km and converts to feet for miles', () => {
    expect(climbInUnit(1000, 'km')).toBe(1000)
    expect(climbInUnit(1000, 'mi')).toBeCloseTo(3280.84, 2)
  })
})

describe('intensityWeeks', () => {
  const weeks = weekStartsBetween('2026-05-25', '2026-06-08')
  const current = '2026-06-08'

  it('sums the bands of the week and leaves the fourth part empty when every run is usable', () => {
    const rows = intensityWeeks(
      [
        run({ date: '2026-05-26', durationSec: 3600, bandSec: [3000, 600, 0] }),
        run({ date: '2026-05-28', durationSec: 1800, bandSec: [600, 600, 600] }),
      ],
      weeks,
      current,
    )
    expect(rows[0]).toMatchObject({
      runs: 2,
      usableRuns: 2,
      belowSec: 3600,
      betweenSec: 1200,
      aboveSec: 600,
      noHrSec: 0,
    })
  })

  it('puts a run with no usable heart rate wholly in the fourth part and never spreads it', () => {
    const rows = intensityWeeks(
      [
        run({ date: '2026-05-26', durationSec: 3600, bandSec: [3600, 0, 0] }),
        run({ date: '2026-05-27', durationSec: 5400, bandSec: null }),
      ],
      weeks,
      current,
    )
    expect(rows[0]).toMatchObject({
      runs: 2,
      usableRuns: 1,
      belowSec: 3600,
      betweenSec: 0,
      aboveSec: 0,
      noHrSec: 5400,
    })
  })

  it('names the time a histogram did not cover as no usable heart rate', () => {
    const rows = intensityWeeks(
      [run({ date: '2026-05-26', durationSec: 3600, bandSec: [1000, 1000, 1000] })],
      weeks,
      current,
    )
    expect(rows[0]).toMatchObject({ usableRuns: 1, noHrSec: 600 })
  })

  it('never takes negative time for the neutral part when the bands outlast the run', () => {
    const rows = intensityWeeks(
      [run({ date: '2026-05-26', durationSec: 1800, bandSec: [1000, 1000, 1000] })],
      weeks,
      current,
    )
    expect(rows[0]).toMatchObject({ belowSec: 1000, betweenSec: 1000, aboveSec: 1000, noHrSec: 0 })
  })

  it('keeps a week of only unmeasured runs as one neutral segment', () => {
    const rows = intensityWeeks(
      [
        run({ date: '2026-06-02', durationSec: 2400, bandSec: null }),
        run({ date: '2026-06-04', durationSec: 3000, bandSec: null }),
      ],
      weeks,
      current,
    )
    expect(rows[1]).toMatchObject({
      weekStart: '2026-06-01',
      runs: 2,
      usableRuns: 0,
      belowSec: 0,
      betweenSec: 0,
      aboveSec: 0,
      noHrSec: 5400,
    })
  })

  it('leaves a week with no run empty, flags the current week, and sums to the run time', () => {
    const rows = intensityWeeks(
      [
        run({ date: '2026-06-09', durationSec: 3000, bandSec: [1000, 1000, 500] }),
        run({ date: '2026-06-10', durationSec: 3000, bandSec: null }),
      ],
      weeks,
      current,
    )
    expect(rows[0]).toMatchObject({ runs: 0, noHrSec: 0 })
    const last = rows.at(-1)!
    expect(last.current).toBe(true)
    expect(last.belowSec + last.betweenSec + last.aboveSec + last.noHrSec).toBe(6000)
    expect(intensityCoverage(rows)).toEqual({ runs: 2, covered: 1 })
  })

  it('counts a run once whichever day of the week it falls on (Monday to Sunday)', () => {
    const monday = '2026-06-01'
    const rows = intensityWeeks(
      [
        run({ date: monday, durationSec: 600, bandSec: null }),
        run({ date: addDays(monday, 6), durationSec: 600, bandSec: null }),
        run({ date: addDays(monday, 7), durationSec: 600, bandSec: null }),
      ],
      weeks,
      current,
    )
    expect(rows[1]!.runs).toBe(2)
    expect(rows[2]!.runs).toBe(1)
  })
})
