import { describe, expect, test } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import {
  criticalSpeed,
  dailyLoad,
  ewma,
  monotonyStrain,
  sessionDivergence,
  sessionLoad,
  type LoadContext,
} from '../../../shared/engine/load.ts'
import type { ZoneSet } from '../../../shared/engine/types.ts'
import { makeActivity } from '../../factories.ts'
import { profileFixture, steadyHistogram } from './fixtures.ts'

const HR_MAX = 190
const HR_REST = 50

const boundary = (value: number) => ({
  value,
  band: [value - 5, value + 5] as [number, number],
  source: 'tested' as const,
  asOf: '2026-01-01',
})

const zones: ZoneSet = {
  hrMax: boundary(HR_MAX),
  hrRest: HR_REST,
  lt1Hr: null,
  lt2Hr: null,
  csMps: null,
  lt1PaceSecPerKm: null,
  thresholdPaceSecPerKm: null,
  hr: null,
  pace: null,
  rpe: { z1: [2, 3], z2: [4, 5], z3: [6, 8] },
}

const ctx: LoadContext = { profile: profileFixture, zones }

const trimpOf = (min: number, hr: number, w: number, b: number) => {
  const x = (hr - HR_REST) / (HR_MAX - HR_REST)
  return min * x * w * Math.exp(b * x)
}

const CHEST = 'Polar H10 chest strap'
const WRIST = 'Forerunner 255'

describe('sessionLoad: sRPE', () => {
  test('sRPE is minutes times CR-10, null without a rating', () => {
    const a = makeActivity({ durationSec: 3600, rpe: 5 })
    expect(sessionLoad(a, ctx)).toMatchObject({ srpe: 300, metric: 'srpe' })
    expect(sessionLoad(makeActivity({ rpe: null }), ctx).srpe).toBeNull()
  })

  test('an unrated run with no HR falls back to minutes', () => {
    const out = sessionLoad(makeActivity({ durationSec: 2700 }), ctx)
    expect(out).toMatchObject({ srpe: null, trimp: null, metric: 'minutes', hrQualified: false })
  })
})

describe('sessionLoad: TRIMP and HR qualification', () => {
  test('chest strap average HR gives male Banister TRIMP and sRPE stays alongside', () => {
    const a = makeActivity({ durationSec: 3600, avgHr: 150, deviceName: CHEST, rpe: 4 })
    const out = sessionLoad(a, ctx)
    expect(out.hrQualified).toBe(true)
    expect(out.trimp).toBeCloseTo(trimpOf(60, 150, 0.64, 1.92), 6)
    expect(out.srpe).toBe(240)
    expect(out.metric).toBe('srpe')
  })

  test('female uses 0.86 and 1.67; unspecified defaults to male unless the context says otherwise', () => {
    const a = makeActivity({ durationSec: 3600, avgHr: 150, deviceName: CHEST })
    const female = sessionLoad(a, { ...ctx, profile: { ...profileFixture, sex: 'female' } })
    expect(female.trimp).toBeCloseTo(trimpOf(60, 150, 0.86, 1.67), 6)
    expect(female.metric).toBe('trimp')
    const unspecified = { ...ctx, profile: { ...profileFixture, sex: 'unspecified' as const } }
    expect(sessionLoad(a, unspecified).trimp).toBeCloseTo(trimpOf(60, 150, 0.64, 1.92), 6)
    const chosen = sessionLoad(a, { ...unspecified, trimpSex: 'female' })
    expect(chosen.trimp).toBeCloseTo(trimpOf(60, 150, 0.86, 1.67), 6)
  })

  test('a histogram is integrated bin by bin', () => {
    const hist = { start: 40, width: 1, sec: new Array<number>(181).fill(0) }
    hist.sec[120 - 40] = 1800
    hist.sec[160 - 40] = 1800
    const a = makeActivity({ durationSec: 3600, avgHr: 140, deviceName: CHEST, hrHistogram: hist })
    const expected = trimpOf(30, 120, 0.64, 1.92) + trimpOf(30, 160, 0.64, 1.92)
    expect(sessionLoad(a, ctx).trimp).toBeCloseTo(expected, 6)
  })

  test('optical HR on a trail run is not qualified; the same run on a chest strap is', () => {
    const base = {
      durationSec: 3600,
      avgHr: 150,
      subtype: 'trail',
      hrHistogram: steadyHistogram(150, 3600),
    }
    const optical = sessionLoad(makeActivity({ ...base, deviceName: WRIST }), ctx)
    expect(optical).toMatchObject({ hrQualified: false, trimp: null, metric: 'minutes' })
    const strap = sessionLoad(makeActivity({ ...base, deviceName: CHEST }), ctx)
    expect(strap.hrQualified).toBe(true)
  })

  test('optical HR qualifies on a steady flat run with full coverage', () => {
    const a = makeActivity({
      durationSec: 3600,
      distanceM: 10_000,
      elevationGainM: 30,
      avgHr: 150,
      deviceName: WRIST,
      hrHistogram: steadyHistogram(150, 3600),
    })
    expect(sessionLoad(a, ctx).hrQualified).toBe(true)
  })

  test('optical HR is rejected without a histogram, on hills, on intervals, or on a short sample', () => {
    const flat = {
      durationSec: 3600,
      distanceM: 10_000,
      elevationGainM: 30,
      avgHr: 150,
      deviceName: WRIST,
    }
    expect(sessionLoad(makeActivity(flat), ctx).hrQualified).toBe(false)
    const hilly = makeActivity({
      ...flat,
      elevationGainM: 400,
      hrHistogram: steadyHistogram(150, 3600),
    })
    expect(sessionLoad(hilly, ctx).hrQualified).toBe(false)
    const intervals = new Array<number>(181).fill(0)
    intervals[120 - 40] = 1800
    intervals[175 - 40] = 1800
    const wide = makeActivity({
      ...flat,
      avgHr: 148,
      hrHistogram: { start: 40, width: 1, sec: intervals },
    })
    expect(sessionLoad(wide, ctx).hrQualified).toBe(false)
    const short = makeActivity({ ...flat, hrHistogram: steadyHistogram(150, 1200) })
    expect(sessionLoad(short, ctx).hrQualified).toBe(false)
  })

  test('optical HR on non-running activity is rejected', () => {
    const a = makeActivity({
      type: 'cross',
      durationSec: 3600,
      avgHr: 140,
      deviceName: WRIST,
      hrHistogram: steadyHistogram(140, 3600),
    })
    expect(sessionLoad(a, ctx).hrQualified).toBe(false)
  })

  test('no TRIMP without HRmax and resting HR, or with an implausible average', () => {
    const a = makeActivity({ durationSec: 3600, avgHr: 150, deviceName: CHEST })
    const noMax = { ...ctx, zones: { ...zones, hrMax: null } }
    expect(sessionLoad(a, noMax)).toMatchObject({ hrQualified: false, trimp: null })
    const noRest = {
      profile: { ...profileFixture, hrRest: null },
      zones: { ...zones, hrRest: null },
    }
    expect(sessionLoad(a, noRest).trimp).toBeNull()
    const above = makeActivity({ durationSec: 3600, avgHr: 230, deviceName: CHEST })
    expect(sessionLoad(above, ctx).hrQualified).toBe(false)
  })
})

describe('dailyLoad', () => {
  const day = '2026-06-01'

  test('sums one metric per day, sorted, skipping duplicates and unrated activities', () => {
    const acts = [
      makeActivity({ date: addDays(day, 1), durationSec: 3600, rpe: 5 }),
      makeActivity({ date: day, durationSec: 1800, rpe: 4 }),
      makeActivity({ date: day, durationSec: 1800, rpe: 6 }),
      makeActivity({ date: addDays(day, 2), durationSec: 3600 }),
      makeActivity({ date: day, durationSec: 3600, rpe: 9, duplicateStatus: 'confirmed' }),
    ]
    expect(dailyLoad(acts, ctx, 'srpe')).toEqual([
      { date: day, load: 30 * 4 + 30 * 6 },
      { date: addDays(day, 1), load: 300 },
    ])
  })

  test('sRPE and TRIMP are never summed: each series holds only its own metric', () => {
    const rated = makeActivity({ date: day, durationSec: 3600, rpe: 5 })
    const strap = makeActivity({ date: day, durationSec: 3600, avgHr: 150, deviceName: CHEST })
    const srpe = dailyLoad([rated, strap], ctx, 'srpe')
    const trimp = dailyLoad([rated, strap], ctx, 'trimp')
    expect(srpe).toEqual([{ date: day, load: 300 }])
    expect(trimp).toHaveLength(1)
    expect(trimp[0]!.load).toBeCloseTo(trimpOf(60, 150, 0.64, 1.92), 6)
  })

  test('minutes counts every activity', () => {
    const acts = [
      makeActivity({ date: day, durationSec: 1800 }),
      makeActivity({ date: day, type: 'strength', durationSec: 1200 }),
    ]
    expect(dailyLoad(acts, ctx, 'minutes')).toEqual([{ date: day, load: 50 }])
  })
})

describe('ewma', () => {
  test('uses lambda 2 / (N + 1) and treats missing days as zero load', () => {
    const series = [
      { date: '2026-06-01', load: 100 },
      { date: '2026-06-03', load: 0 },
    ]
    // lambda 0.25: 25, 18.75, 14.0625
    expect(ewma(series, 7)).toBeCloseTo(14.0625, 9)
    expect(ewma([series[0]!], 7)).toBeCloseTo(25, 9)
  })

  test('converges to a constant load and is 0 for an empty series', () => {
    const series = Array.from({ length: 300 }, (_, i) => ({
      date: addDays('2026-01-01', i),
      load: 100,
    }))
    expect(ewma(series, 42)).toBeCloseTo(100, 3)
    expect(ewma([], 7)).toBe(0)
  })

  test('an unsorted series gives the same answer', () => {
    const a = { date: '2026-06-01', load: 100 }
    const b = { date: '2026-06-03', load: 40 }
    expect(ewma([b, a], 7)).toBeCloseTo(ewma([a, b], 7), 9)
  })
})

describe('criticalSpeed', () => {
  const effort = (t: number) => ({ timeSec: t, distanceM: 4 * t + 100 })

  test('fits distance = CS * time + D prime', () => {
    const out = criticalSpeed([effort(180), effort(360), effort(720), effort(1200)])
    expect(out?.csMps).toBeCloseTo(4, 9)
    expect(out?.dPrimeM).toBeCloseTo(100, 6)
  })

  test('needs three efforts of 400-5000 m with spread in duration', () => {
    expect(criticalSpeed([effort(180), effort(360)])).toBeNull()
    // 5500 m is out of range, leaving two
    expect(criticalSpeed([effort(180), effort(360), { timeSec: 600, distanceM: 5500 }])).toBeNull()
    expect(criticalSpeed([effort(180), effort(190), effort(200)])).toBeNull()
  })

  test('a fit with negative D prime is not used', () => {
    expect(
      criticalSpeed([
        { timeSec: 180, distanceM: 600 },
        { timeSec: 360, distanceM: 1400 },
        { timeSec: 720, distanceM: 3200 },
      ]),
    ).toBeNull()
  })
})

describe('sessionDivergence', () => {
  const strapRun = (i: number, rpe: number, hr: number) =>
    makeActivity({
      date: addDays('2026-05-01', i),
      durationSec: 3600,
      rpe,
      avgHr: hr,
      deviceName: CHEST,
    })
  const priors = () =>
    [4, 5, 6, 5, 4, 6, 5, 4].map((rpe, i) => strapRun(i, rpe, 140 + (rpe - 5) * 4))

  test('flags a session whose sRPE and HR-load z-scores differ by more than 1.5 SD, after 8 priors', () => {
    const odd = strapRun(8, 9, 128)
    const out = sessionDivergence([...priors(), odd], ctx)
    expect(out.map((o) => o.activityId)).toEqual([odd.id])
    expect(out[0]).toMatchObject({ divergent: true })
    expect(out[0]!.zSrpe).toBeGreaterThan(1.5)
    expect(out[0]!.zTrimp).toBeLessThan(0)
  })

  test('says nothing with fewer than 8 prior sessions, and flags nothing for a matching session', () => {
    const few = priors().slice(0, 7)
    expect(sessionDivergence([...few, strapRun(7, 9, 128)], ctx)).toEqual([])
    const match = strapRun(8, 6, 144)
    expect(sessionDivergence([...priors(), match], ctx)[0]).toMatchObject({ divergent: false })
  })
})

describe('monotonyStrain', () => {
  const week = (start: string, loads: number[]) =>
    loads.map((load, i) => ({ date: addDays(start, i), load }))

  test('monotony is mean over population SD of the 7 days, strain is weekly load times monotony', () => {
    const loads = [100, 0, 80, 0, 120, 0, 60]
    const mean = loads.reduce((s, v) => s + v, 0) / 7
    const sd = Math.sqrt(loads.reduce((s, v) => s + (v - mean) ** 2, 0) / 7)
    const out = monotonyStrain(week('2026-06-01', loads), '2026-06-07')
    expect(out.weeklyLoad).toBe(360)
    expect(out.monotony).toBeCloseTo(mean / sd, 9)
    expect(out.strain).toBeCloseTo(360 * (mean / sd), 9)
  })

  test('a flat week has no defined monotony', () => {
    const out = monotonyStrain(week('2026-06-01', [50, 50, 50, 50, 50, 50, 50]), '2026-06-07')
    expect(out.monotony).toBeNull()
    expect(out.strain).toBeNull()
  })

  test("flags only against the athlete's own range, and only with enough earlier weeks", () => {
    const patterns = [
      [100, 0, 80, 0, 120, 0, 60],
      [90, 20, 70, 30, 100, 10, 60],
    ]
    const build = (earlier: number) => {
      const series: Array<{ date: string; load: number }> = []
      for (let w = 0; w < earlier; w += 1) {
        series.push(...week(addDays('2026-04-06', 7 * w), patterns[w % 2]!))
      }
      series.push(...week(addDays('2026-04-06', 7 * earlier), [70, 71, 70, 71, 70, 71, 70]))
      return { series, end: addDays('2026-04-06', 7 * earlier + 6) }
    }
    const rich = build(8)
    expect(monotonyStrain(rich.series, rich.end)).toMatchObject({ monotonyFlag: true })
    const sparse = build(3)
    expect(monotonyStrain(sparse.series, sparse.end)).toMatchObject({
      monotonyFlag: false,
      strainFlag: false,
    })
  })
})
