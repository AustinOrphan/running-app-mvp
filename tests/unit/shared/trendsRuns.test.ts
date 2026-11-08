import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import {
  durabilityGroup,
  fixedSpeedSeries,
  HR_WINDOW_COUNT,
  HR_WINDOW_STEP_DAYS,
  hrWindows,
  longRunReadings,
  runHistoryDays,
  type TrendHrWindow,
  type TrendLongRun,
} from '../../../shared/domain/trendsRuns.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { HrQuality } from '../../../shared/types.ts'
import type { TrendRun } from '../../../shared/domain/trendsRuns.ts'
import { steadyTrendRun, trendRun } from '../../factories.ts'

const TODAY = '2026-06-30'

describe('longRunReadings', () => {
  it('keeps flat runs with a stored reading, oldest first, and nothing else about them', () => {
    const rows = longRunReadings([
      trendRun({ date: '2026-05-10', decouplingPct: 6.2 }),
      trendRun({ date: '2026-03-01', decouplingPct: -1.5, tempC: null }),
    ])
    expect(rows).toEqual([
      { date: '2026-03-01', durationSec: 7200, decouplingPct: -1.5, hilly: false, tempC: null },
      { date: '2026-05-10', durationSec: 7200, decouplingPct: 6.2, hilly: false, tempC: 14 },
    ])
  })

  describe('hilly runs whose heart rate passed (B2, HQ1)', () => {
    const limit = P.hrModel.maxGainPerKm.value
    /** A quality summary whose two halves run entirely on the flat band: 2% more heart rate in the second. */
    const quality = (over: Partial<HrQuality> = {}, secondHr = 153): HrQuality => {
      const band = (value: number) => {
        const row = new Array<number>(9).fill(0)
        row[4] = value
        return row
      }
      return {
        v: 2,
        th: '',
        source: 'wrist',
        movingSec: 7000,
        cleanSec: 6800,
        lockSec: 0,
        spikeSec: 0,
        dropSec: 0,
        flatSec: 0,
        mismatchSec: 200,
        halves: {
          sec: [band(3400), band(3400)],
          m: [band(10_200), band(10_200)],
          hrSec: [band(150 * 3400), band(secondHr * 3400)],
        },
        gapDecouplingPct: 2,
        ...over,
      }
    }
    const hillyRun = (over: Partial<TrendRun> = {}) =>
      trendRun({ elevationGainM: limit * 20 + 100, decouplingPct: 12, ...over })

    it('draws a hilly run that passes with its grade-adjusted drift, never its raw one', () => {
      const rows = longRunReadings([
        hillyRun({ date: '2026-05-10', hrQuality: quality() }),
        trendRun({ date: '2026-05-11', decouplingPct: 4 }),
      ])
      expect(rows).toEqual([
        { date: '2026-05-10', durationSec: 7200, decouplingPct: 2, hilly: true, tempC: 14 },
        { date: '2026-05-11', durationSec: 7200, decouplingPct: 4, hilly: false, tempC: 14 },
      ])
    })

    it('leaves out a hilly run with no summary, a failed one, or too little clean time in a half', () => {
      const rows = longRunReadings([
        hillyRun({ date: '2026-05-01' }),
        hillyRun({ date: '2026-05-02', hrQuality: null }),
        hillyRun({ date: '2026-05-03', hrQuality: quality({ cleanSec: 5000 }) }),
        hillyRun({ date: '2026-05-04', hrQuality: quality({ halves: null }) }),
        hillyRun({
          date: '2026-05-05',
          hrQuality: quality({
            halves: {
              ...quality().halves!,
              sec: [[0, 0, 0, 0, 300, 0, 0, 0, 0], quality().halves!.sec[1]],
            },
          }),
        }),
      ])
      expect(rows).toEqual([])
    })

    it('passes a strap by its source, and divides each band by the ratio it is given', () => {
      const strap = quality({ source: 'strap', cleanSec: 100, movingSec: 7000 })
      expect(longRunReadings([hillyRun({ hrQuality: strap })]).map((r) => r.hilly)).toEqual([true])
      // The flat band is the one with all the time: a uniform ratio leaves the drift alone.
      const doubled = new Array<number>(9).fill(2)
      expect(longRunReadings([hillyRun({ hrQuality: strap })], doubled)[0]!.decouplingPct).toBe(2)
    })
  })

  it('leaves out a run with no reading, a race and a run that climbs over the hill limit (B2)', () => {
    const limit = P.hrModel.maxGainPerKm.value
    const rows = longRunReadings([
      trendRun({ date: '2026-05-01', decouplingPct: null }),
      trendRun({ date: '2026-05-02', type: 'race' }),
      // 20 km: the limit per kilometre is exceeded by one metre in total.
      trendRun({ date: '2026-05-03', elevationGainM: limit * 20 + 1 }),
      trendRun({ date: '2026-05-04', elevationGainM: limit * 20 }),
      // No climb recorded passes, as it does for the heart-rate fit.
      trendRun({ date: '2026-05-05', elevationGainM: null, distanceM: null }),
    ])
    expect(rows.map((r) => r.date)).toEqual(['2026-05-04', '2026-05-05'])
  })
})

describe('durabilityGroup', () => {
  const longRun = (date: string, min: number, pct: number, tempC: number | null): TrendLongRun => ({
    date,
    durationSec: min * 60,
    decouplingPct: pct,
    hilly: false,
    tempC,
  })

  it('never takes a hilly run into the group, whatever its length and air (A7 is flat-only)', () => {
    const hilly = { ...longRun('2026-05-09', 120, 9, 12), hilly: true }
    const flat = [
      longRun('2026-05-01', 120, 2, 12),
      longRun('2026-05-02', 120, 3, 12),
      longRun('2026-05-03', 120, 4, 12),
    ]
    const group = durabilityGroup([...flat, hilly])
    expect(group?.runs).toHaveLength(3)
    expect(group?.runs.some((run) => run.date === '2026-05-09')).toBe(false)
    expect(group?.medianPct).toBe(3)
  })

  it('is null without a candidate, and has no median under the minimum of runs (A7)', () => {
    expect(durabilityGroup([])).toBeNull()
    // Too short, too hot, too long, no weather: none is a candidate.
    expect(
      durabilityGroup([
        longRun('2026-05-01', 60, 3, 12),
        longRun('2026-05-02', 120, 3, 28),
        longRun('2026-05-03', 200, 3, 12),
        longRun('2026-05-04', 120, 3, null),
      ]),
    ).toBeNull()
    const two = durabilityGroup([
      longRun('2026-05-01', 120, 3, 12),
      longRun('2026-05-08', 118, 5, 13),
    ])
    expect(two).toMatchObject({ medianPct: null })
    expect(two!.runs).toHaveLength(2)
    expect(P.a7.minComparableRuns.value).toBe(3)
  })

  it('takes the median of the largest comparable group, as the engine descriptor does', () => {
    const group = durabilityGroup([
      longRun('2026-04-01', 120, 2, 12),
      longRun('2026-04-08', 125, 4, 14),
      longRun('2026-04-15', 115, 6, 13),
      longRun('2026-04-22', 120, 10, 15),
      // A longer run, outside 20% of the others, is a candidate of its own and not in the group.
      longRun('2026-05-01', 165, 9, 12),
    ])
    expect(group!.runs.map((r) => r.date)).toEqual([
      '2026-04-01',
      '2026-04-08',
      '2026-04-15',
      '2026-04-22',
    ])
    expect(group!.medianPct).toBe(5)
    expect(group!.medianMin).toBeCloseTo(120)
  })
})

describe('hrWindows', () => {
  it('draws 26 windows four weeks apart, oldest first, the last ending today', () => {
    const windows = hrWindows([], TODAY)
    expect(windows).toHaveLength(HR_WINDOW_COUNT)
    expect(windows.at(-1)!.end).toBe(TODAY)
    expect(windows[0]!.end).toBe(addDays(TODAY, -HR_WINDOW_STEP_DAYS * (HR_WINDOW_COUNT - 1)))
    expect(windows.every((w) => w.line === null && w.qualifying === 0)).toBe(true)
    expect(runHistoryDays()).toBe(
      HR_WINDOW_STEP_DAYS * (HR_WINDOW_COUNT - 1) + P.hrModel.windowWeeks.value * 7,
    )
  })

  it('fits each window on the runs of its own eight weeks and counts the runs when there are too few', () => {
    // Nine runs inside the 8 weeks before today (speeds 2.3 to 3.1), four far earlier.
    const recent = Array.from({ length: 9 }, (_, i) =>
      steadyTrendRun(TODAY, 3 + i * 6, 2.3 + i * 0.1),
    )
    const early = Array.from({ length: 4 }, (_, i) => steadyTrendRun(TODAY, 300 + i * 6, 3))
    const windows = hrWindows([...recent, ...early], TODAY)
    const last = windows.at(-1)!
    expect(last.qualifying).toBe(9)
    expect(last.line).not.toBeNull()
    expect(last.line!.runs).toBe(9)
    expect(last.line!.slopeBpmPerMps).toBeCloseTo(20, 0)
    expect(last.line!.interceptBpm).toBeCloseTo(90, 0)
    expect(last.line!.minSpeedMps).toBeCloseTo(2.3, 2)
    expect(last.line!.maxSpeedMps).toBeCloseTo(3.1, 2)
    // Four runs in one window are counted and give no line.
    const sparse = windows.find((w) => w.qualifying > 0 && w.qualifying < 9 && w.line === null)
    expect(sparse).toBeDefined()
    expect(sparse!.qualifying).toBeLessThan(P.hrModel.minQualifyingRuns.value)
  })

  it('does not read a run that is after the end of the window', () => {
    const windows = hrWindows(
      Array.from({ length: 9 }, (_, i) => steadyTrendRun(TODAY, 3 + i * 2, 2.3 + i * 0.1)),
      TODAY,
    )
    expect(windows.slice(0, -1).every((w) => w.line === null)).toBe(true)
  })
})

describe('fixedSpeedSeries', () => {
  const line = (min: number, max: number, runs = 9): TrendHrWindow['line'] => ({
    runs,
    interceptBpm: 90,
    slopeBpmPerMps: 20,
    minSpeedMps: min,
    maxSpeedMps: max,
  })
  const win = (end: string, fitted: TrendHrWindow['line'], qualifying = 9): TrendHrWindow => ({
    end,
    qualifying,
    hillyRuns: [],
    line: fitted,
  })

  it('has no reference speed and only gaps when no window has a line', () => {
    const series = fixedSpeedSeries([win('2026-05-01', null, 3), win('2026-06-01', null, 0)])
    expect(series.referenceMps).toBeNull()
    expect(series.points.map((p) => p.gap)).toEqual(['few-runs', 'few-runs'])
    expect(series.points.every((p) => p.bpm === null)).toBe(true)
    expect(fixedSpeedSeries([])).toEqual({ referenceMps: null, points: [] })
  })

  it('reads every line at the median of the middles of the fitted speeds', () => {
    const series = fixedSpeedSeries([
      win('2026-03-01', line(2.4, 3.0)),
      win('2026-04-01', line(2.5, 3.1)),
      win('2026-05-01', line(2.6, 3.2)),
    ])
    // Middles 2.7, 2.8, 2.9: the median is 2.8 m/s, 90 + 20 x 2.8 = 146 bpm in every window.
    expect(series.referenceMps).toBeCloseTo(2.8, 6)
    expect(series.points.map((p) => p.bpm)).toEqual([146, 146, 146])
    expect(series.points.map((p) => p.fitted)).toEqual([9, 9, 9])
  })

  it('makes a gap of a window that did not run the speed, widened by the margin of the line (C9)', () => {
    const margin = P.c9.lineSpeedMargin.value
    const series = fixedSpeedSeries([
      win('2026-02-01', line(2.4, 3.0)),
      win('2026-03-01', line(2.5, 3.1)),
      win('2026-04-01', line(2.6, 3.2)),
      // The reference is 2.8. A window that stayed slow, 2.0 to 2.2 m/s, reaches 2.2 x 1.1 = 2.42.
      win('2026-05-01', line(2.0, 2.2)),
      // A window just inside the margin still reads.
      win('2026-06-01', line(2.8 / (1 + margin) + 0.001, 3.4), 9),
      win('2026-06-15', null, 5),
    ])
    expect(series.points.map((p) => p.gap)).toEqual([
      null,
      null,
      null,
      'speed-not-run',
      null,
      'few-runs',
    ])
    expect(series.points[3]!).toMatchObject({ bpm: null, fitted: 9, qualifying: 9 })
    expect(series.points[5]!).toMatchObject({ bpm: null, fitted: null, qualifying: 5 })
  })

  it('draws a single window as a single point at its own middle', () => {
    const series = fixedSpeedSeries([win('2026-06-30', line(2.5, 3.1))])
    expect(series.referenceMps).toBeCloseTo(2.8, 6)
    expect(series.points).toHaveLength(1)
    expect(series.points[0]!.bpm).toBe(146)
  })
})

describe('hrWindows with hilly runs that passed (B2, HQ1)', () => {
  const strap: HrQuality = {
    v: 2,
    th: '',
    source: 'strap',
    movingSec: 2300,
    cleanSec: 2300,
    lockSec: 0,
    spikeSec: 0,
    dropSec: 0,
    flatSec: 0,
    mismatchSec: 0,
    halves: null,
    gapDecouplingPct: null,
  }
  const hilly = (daysAgo: number, speed: number, hrQuality: HrQuality | null): TrendRun => ({
    ...steadyTrendRun(TODAY, daysAgo, speed),
    elevationGainM: 900,
    hrQuality,
  })
  const flat = Array.from({ length: 6 }, (_, i) => steadyTrendRun(TODAY, 3 + i * 6, 2.4 + i * 0.1))

  it('counts a passing hilly run in the fit and names it, and leaves a failing one out', () => {
    const windows = hrWindows(
      [...flat, hilly(5, 3.0, strap), hilly(9, 3.1, strap), hilly(11, 3.2, null)],
      TODAY,
    )
    const last = windows.at(-1)!
    expect(last.qualifying).toBe(8)
    expect(last.line!.runs).toBe(8)
    expect(last.hillyRuns).toHaveLength(2)
    expect(last.hillyRuns[0]).toMatch(/^2026-06-\d\d\|2400$/)
  })

  it('has no line from six flat runs, and one when hilly runs make up the number', () => {
    expect(hrWindows(flat, TODAY).at(-1)!.line).toBeNull()
    const withHilly = hrWindows([...flat, hilly(5, 3.0, strap), hilly(9, 3.1, strap)], TODAY)
    expect(withHilly.at(-1)!.line).not.toBeNull()
  })
})
