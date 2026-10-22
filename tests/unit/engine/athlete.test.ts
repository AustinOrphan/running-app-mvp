import { describe, expect, test } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { efficiencyIndex, estimateState, experienceClass } from '../../../shared/engine/athlete.ts'
import { ewma } from '../../../shared/engine/load.ts'
import type { EngineInput, GoalModel } from '../../../shared/engine/types.ts'
import type { Activity, AthleteProfile, WellnessDay } from '../../../shared/types.ts'
import { makeActivity, makeWeekRow } from '../../factories.ts'
import { profileFixture, steadyHistogram } from './fixtures.ts'

const TODAY = '2026-06-17' // a Wednesday; the current week starts 2026-06-15

const goal: GoalModel = {
  goalId: 'g1',
  name: 'Synthetic marathon',
  date: '2026-10-11',
  distanceM: 42_195,
  gainM: 100,
  lossM: 100,
  surface: 'road',
  goalType: 'time',
  targetTimeSec: null,
  startTime: null,
  isUltra: false,
  distanceClass: 'marathon',
  expectedDurationSec: 14_400,
  crossesDarkness: false,
  raceWbgtC: null,
}

function input(
  activities: Activity[],
  over: { profile?: Partial<AthleteProfile>; wellness?: WellnessDay[]; today?: string } = {},
): EngineInput {
  return {
    today: over.today ?? TODAY,
    profile: { ...profileFixture, ...over.profile },
    activities,
    wellness: over.wellness ?? [],
    reviews: [],
    goal,
    forecast: null,
    existing: null,
    options: {},
  }
}

const daysAgo = (n: number) => addDays(TODAY, -n)
const run = (n: number, over: Partial<Activity> = {}) =>
  makeActivity({ date: daysAgo(n), type: 'run', ...over })

describe('estimateState: identity and weeks', () => {
  test('age and years running come from the profile years and today', () => {
    const s = estimateState(input([], { profile: { birthYear: 1980, runningSinceYear: 2020 } }))
    expect(s).toMatchObject({ asOf: TODAY, age: 46, sex: 'male', yearsRunning: 6 })
    const none = estimateState(
      input([], { profile: { birthYear: null, runningSinceYear: null, sex: null } }),
    )
    expect(none).toMatchObject({ age: null, sex: null, yearsRunning: null })
  })

  test('weeks lists the last 16 Mondays, oldest first, ending with the current week', () => {
    const s = estimateState(input([run(1, { durationSec: 3600 })]))
    expect(s.weeks).toHaveLength(16)
    expect(s.weeks[15]!.weekStart).toBe('2026-06-15')
    expect(s.weeks[0]!.weekStart).toBe(addDays('2026-06-15', -15 * 7))
    expect(s.weeks[15]!.runMin).toBe(60)
  })

  test('typicalWeekMin is the median of the last 4 complete weeks that contain a run', () => {
    // complete weeks start 06-08, 06-01, 05-25, 05-18, 05-11; the current week is ignored
    const acts = [
      run(0, { durationSec: 9000 }), // current week, ignored
      makeActivity({ date: '2026-06-09', durationSec: 6000 }), // 100
      makeActivity({ date: '2026-05-26', durationSec: 12_000 }), // 200 (06-01 week has none)
      makeActivity({ date: '2026-05-19', durationSec: 8400 }), // 140
      makeActivity({ date: '2026-05-12', durationSec: 3600 }), // 60
      makeActivity({ date: '2026-05-05', durationSec: 30_000 }), // older than 4 run weeks
    ]
    expect(estimateState(input(acts)).typicalWeekMin).toBe(120)
    expect(estimateState(input([])).typicalWeekMin).toBe(0)
  })
})

describe('estimateState: longest run in 30 days', () => {
  test('uses completed runs only: no cross, strength, duplicates, future or older runs', () => {
    const acts = [
      run(2, { distanceM: 10_000, durationSec: 3600, elevationGainM: 80, elevationLossM: 70 }),
      run(9, { distanceM: 15_000, durationSec: 5400, elevationGainM: 40, elevationLossM: 150 }),
      run(29, { type: 'race', distanceM: 12_000, durationSec: 4000 }),
      run(5, { type: 'cross', distanceM: 40_000, durationSec: 9000, elevationGainM: 900 }),
      run(6, { type: 'strength', durationSec: 9000 }),
      run(7, { distanceM: 30_000, durationSec: 12_000, duplicateStatus: 'confirmed' }),
      run(30, { distanceM: 25_000, durationSec: 9000 }),
      run(-1, { distanceM: 50_000, durationSec: 20_000 }),
    ]
    const s = estimateState(input(acts))
    expect(s.longest30d).toMatchObject({
      distanceM: 15_000,
      durationSec: 5400,
      gainM: 80,
      lossM: 150,
    })
  })

  test('twoDaySec is the largest total on two consecutive days', () => {
    const acts = [
      run(10, { durationSec: 3000 }),
      run(11, { durationSec: 5000 }),
      run(11, { durationSec: 1000 }),
      run(12, { durationSec: 4000 }),
      run(3, { durationSec: 7000 }),
    ]
    expect(estimateState(input(acts)).longest30d.twoDaySec).toBe(5000 + 1000 + 4000)
    expect(estimateState(input([run(3, { durationSec: 7000 })])).longest30d.twoDaySec).toBe(7000)
  })

  test('is all zero without runs', () => {
    expect(estimateState(input([])).longest30d).toEqual({
      distanceM: 0,
      durationSec: 0,
      gainM: 0,
      lossM: 0,
      twoDaySec: 0,
    })
  })
})

describe('estimateState: gaps and layoff', () => {
  const every = (days: number[]) => days.map((n) => run(n))

  test('counts runs of 7 or more days without running in the last 16 weeks', () => {
    // 12 -> 20 leaves 7 empty days (counts), 20 -> 27 leaves 6 (does not), 42 -> 60 leaves 17
    const days = [0, 2, 4, 6, 8, 10, 12, 20, 27, 28, 30, 37, 40, 41, 42, 60, 62, 64, 66, 68, 70]
    const s = estimateState(input(every(days)))
    expect(s.gaps16w).toBe(2)
    expect(s.layoffDays).toBe(0)
    expect(s.lastRunDate).toBe(TODAY)
  })

  test('a layoff up to today counts as a gap; a race counts as running; cross does not', () => {
    const s = estimateState(
      input([
        ...every([30, 32, 34, 36, 38, 40]),
        run(20, { type: 'cross' }),
        run(15, { type: 'race' }),
      ]),
    )
    // 30 -> 15 leaves 14 empty days (counts); 15 -> today leaves 14 (counts)
    expect(s.gaps16w).toBe(2)
    expect(s.layoffDays).toBe(15)
    expect(s.lastRunDate).toBe(daysAgo(15))
  })

  test('a gap before the first run of a new runner is not a gap, but one after earlier running is', () => {
    const fresh = estimateState(input(every([100, 98, 96])))
    // history begins at day 100; the only gap is the one from 96 to today
    expect(fresh.gaps16w).toBe(1)
    const beginner = estimateState(input(every([5, 3, 1])))
    expect(beginner.gaps16w).toBe(0)
    const returning = estimateState(input([run(200), ...every([100, 98])]))
    // the window starts 111 days ago; running existed earlier, so the 11 empty days before the
    // first in-window run count, then 98 -> today
    expect(returning.gaps16w).toBe(2)
  })

  test('no logged run: layoff is the history window and there is no last run', () => {
    expect(estimateState(input([]))).toMatchObject({
      gaps16w: 0,
      layoffDays: 365,
      lastRunDate: null,
    })
  })
})

describe('experienceClass', () => {
  const weeks = (runMins: number[]) =>
    runMins.map((runMin, i) =>
      makeWeekRow({ weekStart: addDays('2026-03-02', 7 * i), runMin, runSessions: runMin ? 3 : 0 }),
    )
  const steady = (min: number) => weeks(new Array<number>(16).fill(min))
  const profile = profileFixture

  test('novice: no running history, or no running for about four months', () => {
    expect(
      experienceClass({ profile, weeks: steady(0), layoffDays: 365, yearsRunning: null }),
    ).toBe('novice')
    expect(experienceClass({ profile, weeks: steady(0), layoffDays: 130, yearsRunning: 8 })).toBe(
      'novice',
    )
  })

  test('novice: under a year of running with fewer than 4 run weeks in 16', () => {
    const w = weeks([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 90, 120, 100])
    expect(experienceClass({ profile, weeks: w, layoffDays: 2, yearsRunning: 0.5 })).toBe('novice')
    expect(experienceClass({ profile, weeks: w, layoffDays: 2, yearsRunning: null })).toBe('novice')
  })

  test('returning: a layoff of 4 weeks or more with earlier running', () => {
    expect(experienceClass({ profile, weeks: steady(150), layoffDays: 40, yearsRunning: 5 })).toBe(
      'returning',
    )
    expect(
      experienceClass({ profile, weeks: steady(150), layoffDays: 27, yearsRunning: 5 }),
    ).not.toBe('returning')
  })

  test('trained needs years and volume; otherwise recreational', () => {
    expect(experienceClass({ profile, weeks: steady(300), layoffDays: 1, yearsRunning: 6 })).toBe(
      'trained',
    )
    expect(experienceClass({ profile, weeks: steady(150), layoffDays: 1, yearsRunning: 6 })).toBe(
      'recreational',
    )
    expect(experienceClass({ profile, weeks: steady(300), layoffDays: 1, yearsRunning: 1.5 })).toBe(
      'recreational',
    )
    expect(
      experienceClass({ profile, weeks: steady(300), layoffDays: 1, yearsRunning: null }),
    ).toBe('recreational')
  })
})

describe('estimateState: experience, risk and flags', () => {
  test('a logged runner with a long history and volume is trained', () => {
    const acts = Array.from({ length: 112 }, (_, i) => run(i, { durationSec: 3000 })) // 350 min/week
    expect(estimateState(input(acts)).experience).toBe('trained')
  })

  test('injuries: recent within 12 months, prior bone stress injury at any date', () => {
    const none = estimateState(input([]))
    expect(none.risk).toMatchObject({ recentInjury: false, priorBsi: false, redsFlags: 0 })
    const injury = (
      year: number,
      month: number | null,
      kind: 'bone-stress' | 'tendon' | 'muscle',
    ) => ({
      area: 'x',
      side: null,
      year,
      month,
      kind,
      notes: null,
    })
    const state = (i: ReturnType<typeof injury>) =>
      estimateState(input([], { profile: { injuries: [i] } }))
    expect(state(injury(2023, 3, 'bone-stress')).risk).toMatchObject({
      recentInjury: false,
      priorBsi: true,
    })
    expect(state(injury(2025, 8, 'tendon')).risk).toMatchObject({
      recentInjury: true,
      priorBsi: false,
    })
    expect(state(injury(2025, null, 'muscle')).risk.recentInjury).toBe(true)
    expect(state(injury(2025, 5, 'muscle')).risk.recentInjury).toBe(false)
  })

  test('BSI factors count prior BSI, 12 h of weekly running and low BMI in women', () => {
    const heavy = Array.from({ length: 28 }, (_, i) => run(i, { durationSec: 7200 })) // 14 h/week
    const profile: Partial<AthleteProfile> = {
      sex: 'female',
      heightCm: 170,
      weightKg: 58, // BMI 20.07
      injuries: [
        {
          area: 'metatarsal',
          side: 'right',
          year: 2022,
          month: 2,
          kind: 'bone-stress',
          notes: null,
        },
      ],
    }
    expect(estimateState(input(heavy, { profile })).risk.bsiFactors).toBe(3)
    expect(
      estimateState(input(heavy, { profile: { ...profile, sex: 'male' } })).risk.bsiFactors,
    ).toBe(2)
    expect(estimateState(input([], { profile: { sex: 'male' } })).risk.bsiFactors).toBe(0)
  })

  test('soft flags apply to novices only', () => {
    const novice = estimateState(
      input([], {
        profile: { birthYear: 1970, heightCm: 170, weightKg: 95, runningSinceYear: null },
      }),
    )
    expect(novice.experience).toBe('novice')
    expect(novice.risk.noviceFlags).toEqual(['age-45-65', 'bmi-over-30', 'no-running-history'])
    const trainedActs = Array.from({ length: 112 }, (_, i) => run(i, { durationSec: 3000 }))
    const trained = estimateState(
      input(trainedActs, { profile: { birthYear: 1970, heightCm: 170, weightKg: 95 } }),
    )
    expect(trained.risk.noviceFlags).toEqual([])
  })
})

describe('estimateState: load', () => {
  test('one rated run today: acute and chronic follow the EWMA constants', () => {
    const s = estimateState(input([run(0, { durationSec: 3600, rpe: 5 })]))
    expect(s.load.metric).toBe('srpe')
    expect(s.load.acute).toBeCloseTo(300 * (2 / 8), 9)
    expect(s.load.chronic).toBeCloseTo(300 * (2 / 43), 9)
    expect(s.load.daily).toHaveLength(90)
    expect(s.load.daily[89]).toEqual({ date: TODAY, load: 300 })
    expect(s.load.daily[0]!.date).toBe(addDays(TODAY, -89))
  })

  test('acute and chronic equal ewma over the filled series', () => {
    const acts = [run(1, { durationSec: 3600, rpe: 4 }), run(8, { durationSec: 5400, rpe: 6 })]
    const s = estimateState(input(acts))
    const series = [
      { date: daysAgo(8), load: 540 },
      { date: daysAgo(1), load: 240 },
      { date: TODAY, load: 0 },
    ]
    expect(s.load.acute).toBeCloseTo(ewma(series, 7), 9)
    expect(s.load.chronic).toBeCloseTo(ewma(series, 42), 9)
  })

  test('falls back to minutes when too few runs carry an RPE, and never mixes metrics', () => {
    const acts = [
      run(1, { durationSec: 3600, rpe: 5 }),
      run(3, { durationSec: 3600 }),
      run(5, { durationSec: 3600 }),
      run(7, { durationSec: 3600 }),
      run(9, { durationSec: 3600 }),
    ]
    const s = estimateState(input(acts))
    expect(s.load.metric).toBe('minutes')
    expect(s.load.daily.find((d) => d.date === daysAgo(1))!.load).toBe(60)
  })

  test('uses TRIMP when HR is qualified for most runs and RPE is not', () => {
    const acts = [1, 3, 5, 7].map((n) =>
      run(n, { durationSec: 3600, avgHr: 150, deviceName: 'Polar H10 chest strap' }),
    )
    const s = estimateState(input(acts))
    expect(s.load.metric).toBe('trimp')
    expect(s.load.daily.find((d) => d.date === daysAgo(1))!.load).toBeGreaterThan(0)
  })

  test('without activities the load is zero', () => {
    const s = estimateState(input([]))
    expect(s.load).toMatchObject({ acute: 0, chronic: 0, metric: 'minutes' })
  })
})

describe('estimateState: fitness', () => {
  // CS 4 m/s, D' 100 m: distance = 4 t + 100
  const eff = (n: number, t: number, over: Partial<Activity> = {}) =>
    run(n, { durationSec: t, gapDistanceM: 4 * t + 100, distanceM: 4 * t + 100, ...over })

  test('critical speed from the fastest grade-adjusted effort per distance band in 90 days', () => {
    const acts = [
      eff(10, 180), // 820 m
      eff(20, 360), // 1540 m
      eff(30, 720), // 2980 m
      eff(40, 1200), // 4900 m
      run(15, { durationSec: 400, gapDistanceM: 1100, distanceM: 1100 }), // slower, same band
      eff(100, 240), // outside the window
    ]
    const s = estimateState(input(acts))
    expect(s.fitness.csMps).toBeCloseTo(4, 6)
    expect(s.fitness.dPrimeM).toBeCloseTo(100, 4)
    expect(s.fitness.csEfforts).toBe(4)
  })

  test('uses grade-adjusted distance, and raw distance only on flat runs', () => {
    const hilly = [
      eff(10, 180),
      eff(20, 360),
      eff(30, 720, { gapDistanceM: null, elevationGainM: 400 }), // raw distance is not flat-equivalent
    ]
    const s = estimateState(input(hilly))
    expect(s.fitness.csMps).toBeNull()
    expect(s.fitness.csEfforts).toBe(2)
    const flat = [
      eff(10, 180),
      eff(20, 360),
      eff(30, 720, { gapDistanceM: null, elevationGainM: 20 }),
    ]
    expect(estimateState(input(flat)).fitness.csMps).toBeCloseTo(4, 6)
  })

  test('fewer than 3 bands: no CS', () => {
    const s = estimateState(input([eff(10, 180), eff(20, 360)]))
    expect(s.fitness).toMatchObject({ csMps: null, dPrimeM: null, csEfforts: 2 })
  })

  test('personal exponent from races at different distances', () => {
    const t = (d: number) => 1200 * (d / 5000) ** 1.06
    const race = (n: number, d: number) =>
      makeActivity({ date: daysAgo(n), type: 'race', distanceM: d, durationSec: t(d) })
    const s = estimateState(input([race(200, 5000), race(100, 21_097.5), race(30, 10_000)]))
    expect(s.fitness.exponent).toBeCloseTo(1.06, 6)
    expect(s.fitness.races.map((r) => r.distanceM)).toEqual([5000, 21_097.5, 10_000])
    expect(s.fitness.races[0]).toMatchObject({ date: daysAgo(200), timeSec: t(5000) })
  })

  test('no exponent from one race, from one distance, or from an implausible fit', () => {
    const race = (n: number, d: number, t: number) =>
      makeActivity({ date: daysAgo(n), type: 'race', distanceM: d, durationSec: t })
    expect(estimateState(input([race(10, 5000, 1200)])).fitness.exponent).toBeNull()
    expect(
      estimateState(input([race(10, 5000, 1200), race(60, 5100, 1250)])).fitness.exponent,
    ).toBeNull()
    expect(
      estimateState(input([race(10, 5000, 1200), race(60, 10_000, 4000)])).fitness.exponent,
    ).toBeNull()
  })

  test('device VO2max trend is the smoothed slope per 30 days, null with few readings', () => {
    const w = (n: number, vo2max: number): WellnessDay => ({
      id: `w${n}`,
      date: daysAgo(n),
      restingHr: null,
      hrvRmssd: null,
      hrvSdnn: null,
      sleepSec: null,
      sleepScore: null,
      weightKg: null,
      vo2max,
      notes: null,
      source: 'manual',
      updatedAt: '2026-06-17T00:00:00.000Z',
    })
    const rising = [w(60, 50), w(40, 50.6667), w(20, 51.3333), w(0, 52)]
    expect(estimateState(input([], { wellness: rising })).fitness.vo2maxTrend).toBeCloseTo(1, 3)
    expect(estimateState(input([], { wellness: rising.slice(1) })).fitness.vo2maxTrend).toBeNull()
    expect(estimateState(input([])).fitness.vo2maxTrend).toBeNull()
  })
})

describe('efficiencyIndex', () => {
  // metres per heartbeat: speed (m/s) * 60 / HR
  const steady = (n: number, speedMps: number, hr = 140, over: Partial<Activity> = {}) =>
    run(n, {
      durationSec: 3000,
      distanceM: speedMps * 3000,
      gapDistanceM: speedMps * 3000,
      elevationGainM: 20,
      avgHr: hr,
      hrHistogram: steadyHistogram(hr, 3000),
      ...over,
    })

  test('median metres per beat over the last 4 weeks and the change from the 4 weeks before', () => {
    const recent = [2, 8, 14, 20].map((n) => steady(n, 8 / 3))
    const prior = [31, 38, 45, 52].map((n) => steady(n, 2.5))
    const out = efficiencyIndex([...recent, ...prior], TODAY)
    expect(out.current).toBeCloseTo((8 / 3) * (60 / 140), 9)
    expect(out.trendPct).toBeCloseTo((8 / 3 / 2.5 - 1) * 100, 6)
    expect(out.samples).toBe(8)
  })

  test('ignores races, hills, heat, unsteady or HR-less runs and runs outside 20-90 minutes', () => {
    const good = [2, 8, 14].map((n) => steady(n, 2.5))
    const noise = [
      steady(3, 3.5, 140, { type: 'race' }),
      steady(4, 3.5, 140, { elevationGainM: 400 }),
      steady(5, 3.5, 140, { tempC: 28 }),
      steady(6, 3.5, 140, { hrHistogram: null }),
      steady(7, 3.5, 140, { avgHr: null }),
      steady(9, 3.5, 140, { durationSec: 600 }),
      steady(10, 3.5, 140, { durationSec: 7200 }),
      steady(11, 3.5, 140, { subtype: 'trail' }),
      steady(12, 3.5, 140, { duplicateStatus: 'possible' }),
    ]
    const out = efficiencyIndex([...good, ...noise], TODAY)
    expect(out.samples).toBe(3)
    expect(out.current).toBeCloseTo(2.5 * (60 / 140), 9)
    expect(out.trendPct).toBeNull()
  })

  test('too few runs in the recent window: no index', () => {
    expect(efficiencyIndex([steady(2, 2.5), steady(9, 2.5)], TODAY)).toEqual({
      current: null,
      trendPct: null,
      samples: 2,
    })
    expect(efficiencyIndex([], TODAY)).toEqual({ current: null, trendPct: null, samples: 0 })
  })

  test('estimateState reports the same index as of today', () => {
    const acts = [2, 8, 14, 20].map((n) => steady(n, 2.5))
    expect(estimateState(input(acts)).efficiency).toEqual(efficiencyIndex(acts, TODAY))
  })
})

describe('estimateState: durability', () => {
  const long = (n: number, decoupling: number, over: Partial<Activity> = {}) =>
    run(n, { durationSec: 6000, decouplingPct: decoupling, tempC: 15, ...over })

  test('median decoupling of comparable long runs, after 3 comparable runs', () => {
    const acts = [
      long(5, 4),
      long(12, 6, { durationSec: 6600, tempC: 18 }),
      long(19, 5, { durationSec: 5700 }),
      long(26, 9, { tempC: 27 }), // hot: excluded
      long(33, 12, { durationSec: 11_400 }), // beyond 180 min: excluded
      long(40, 20, { durationSec: 3000 }), // not comparable (duration)
      long(41, 15, { tempC: null }), // unknown temperature: excluded
    ]
    expect(estimateState(input(acts)).durability).toEqual({ decouplingMedianPct: 5, samples: 3 })
  })

  test('fewer than 3 comparable runs keeps the prior', () => {
    const s = estimateState(input([long(5, 4), long(12, 6)]))
    expect(s.durability).toEqual({ decouplingMedianPct: null, samples: 2 })
    expect(estimateState(input([])).durability).toEqual({ decouplingMedianPct: null, samples: 0 })
  })

  test('runs shorter than 90 minutes are not long runs, however many are comparable', () => {
    const easy = [2, 4, 6, 8, 10].map((n) => long(n, 3, { durationSec: 3000 }))
    expect(estimateState(input(easy)).durability).toEqual({
      decouplingMedianPct: null,
      samples: 0,
    })
    const mixed = [...easy, long(5, 4), long(12, 6), long(19, 5, { durationSec: 5700 })]
    expect(estimateState(input(mixed)).durability).toEqual({ decouplingMedianPct: 5, samples: 3 })
  })
})

describe('estimateState: heat acclimation credit', () => {
  const hot = (n: number, over: Partial<Activity> = {}) =>
    run(n, { durationSec: 2700, tempC: 28, ...over })
  const block = (lastDaysAgo: number) => Array.from({ length: 10 }, (_, i) => hot(lastDaysAgo + i))

  test('a 10-day block gives full credit; it decays 2.5% per day afterwards', () => {
    expect(estimateState(input(block(0))).heatAcclimation).toBeCloseTo(1, 9)
    expect(estimateState(input(block(10))).heatAcclimation).toBeCloseTo(0.75, 9)
    expect(estimateState(input(block(50))).heatAcclimation).toBe(0)
  })

  test('five exposure days give half credit; cool or short runs give none', () => {
    expect(estimateState(input(block(0).slice(0, 5))).heatAcclimation).toBeCloseTo(0.5, 9)
    const cool = [0, 1, 2].map((n) => run(n, { durationSec: 2700, tempC: 20 }))
    const short = [0, 1, 2].map((n) => hot(n, { durationSec: 1200 }))
    expect(estimateState(input([...cool, ...short])).heatAcclimation).toBe(0)
  })
})

describe('estimateState: purity', () => {
  test('same input, same output; the input is not modified', () => {
    const acts = [run(1, { durationSec: 3600, rpe: 5 }), run(4, { durationSec: 3000 })]
    const frozen = JSON.parse(JSON.stringify(acts)) as Activity[]
    const a = estimateState(input(acts))
    const b = estimateState(input(acts))
    expect(a).toEqual(b)
    expect(acts).toEqual(frozen)
  })
})
