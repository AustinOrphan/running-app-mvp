// What the plan can see (rule T2): the counts come from the engine's own selections, so the tests
// build synthetic snapshots and read the numbers back.
import { describe, expect, test } from 'vitest'
import { planInputs, type PlanInputsInput } from '../../../shared/domain/planInputs.ts'
import { addDays } from '../../../shared/dates.ts'
import { fitHrModel } from '../../../shared/engine/execution.ts'
import { watchRatingCheck, withUsableRatings } from '../../../shared/engine/watchRatings.ts'
import { mastersCheckinHistory } from '../../../shared/engine/readiness.ts'
import { repeatPainPattern } from '../../../shared/domain/painArea.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { Boundary, EngineInput, ZoneSet } from '../../../shared/engine/types.ts'
import type { Activity, HrQuality, HrSource } from '../../../shared/types.ts'
import { RUNS, run, TODAY } from '../engine/myPacesFixtures.ts'

type Wellness = EngineInput['wellness'][number]

function night(daysAgo: number, over: Partial<Wellness> = {}): Wellness {
  return {
    id: `w${String(daysAgo)}`,
    date: addDays(TODAY, -daysAgo),
    restingHr: null,
    hrvRmssd: null,
    hrvSdnn: null,
    sleepSec: null,
    sleepScore: null,
    weightKg: null,
    vo2max: null,
    notes: null,
    source: 'manual',
    updatedAt: '2026-06-30T00:00:00Z',
    ...over,
  }
}

const boundary = (source: Boundary['source'], extra: Partial<Boundary> = {}): Boundary => ({
  value: 150,
  band: [145, 155],
  source,
  asOf: '2026-06-01',
  ...extra,
})

const ZONES: ZoneSet = {
  hrMax: boundary('hrmax-age'),
  hrRest: null,
  lt1Hr: boundary('hrr'),
  lt2Hr: null,
  csMps: boundary('cs', { fromTraining: true, windowWidened: true }),
  lt1PaceSecPerKm: null,
  thresholdPaceSecPerKm: boundary('tested'),
  hr: null,
  pace: null,
  rpe: { z1: [1, 3], z2: [4, 6], z3: [7, 10] },
}

function input(over: Partial<PlanInputsInput> = {}): PlanInputsInput {
  return {
    today: TODAY,
    profile: { sex: 'male' },
    wellness: [],
    wellnessWindowDays: 60,
    activities: over.activities ?? [],
    watchRatings: watchRatingCheck(over.activities ?? []),
    streamIds: new Set(),
    raceHeat: null,
    zones: ZONES,
    hrModel: null,
    providerLabels: [
      { key: 'intervals', label: 'intervals.icu' },
      { key: 'apple-health', label: 'Apple Health' },
    ],
    ...over,
  }
}

function quality(source: HrSource, cleanShare: number): HrQuality {
  const movingSec = 40 * 60
  return {
    v: 1,
    th: 'x',
    source,
    movingSec,
    cleanSec: Math.round(movingSec * cleanShare),
    lockSec: 0,
    spikeSec: 0,
    dropSec: 0,
    flatSec: 0,
    mismatchSec: 0,
    halves: null,
    gapDecouplingPct: null,
  }
}

describe('planInputs: heart-rate variability', () => {
  test('SDNN only is stored and not used: no rMSSD reading reaches the baseline', () => {
    const wellness = Array.from({ length: 14 }, (_, i) =>
      night(i + 1, { hrvSdnn: 45, source: 'apple-health' }),
    )
    const { hrv } = planInputs(input({ wellness }))
    expect(hrv.kind).toBe('sdnn')
    expect(hrv.sdnnDays).toBe(14)
    expect(hrv.rmssdDays).toBe(0)
    expect(hrv.baselineReadings).toBe(0)
  })

  test('rMSSD readings fill the baseline up to j4.windowDays inside j4.lookbackDays', () => {
    const wellness = Array.from({ length: 30 }, (_, i) => night(i + 1, { hrvRmssd: 60 }))
    const { hrv } = planInputs(input({ wellness }))
    expect(hrv.kind).toBe('rmssd')
    expect(hrv.rmssdDays).toBe(30)
    expect(hrv.baselineReadings).toBe(P.j4.windowDays.value)
    expect(hrv.lookbackDays).toBe(P.j4.lookbackDays.value)
    expect(hrv.baselineKeeps).toBe(P.j4.windowDays.value)
    expect(hrv.minReadings).toBe(P.j4.minReadings.value)
  })

  test('readings older than the lookback are stored but not in the baseline', () => {
    const old = P.j4.lookbackDays.value + 1
    const wellness = [night(old, { hrvRmssd: 60 }), night(old + 1, { hrvRmssd: 60 })]
    const { hrv } = planInputs(input({ wellness }))
    expect(hrv.rmssdDays).toBe(2)
    expect(hrv.baselineReadings).toBe(0)
  })

  test('both kinds are told apart, and the female profile keeps every reading of the wider window', () => {
    const wellness = Array.from({ length: 14 }, (_, i) =>
      night(i + 1, { hrvRmssd: 60, hrvSdnn: 45 }),
    )
    const view = planInputs(input({ wellness, profile: { sex: 'female' } }))
    expect(view.hrv.kind).toBe('both')
    expect(view.hrv.baselineKeeps).toBeNull()
    expect(view.hrv.lookbackDays).toBe(P.j4.cycleBaselineDays.value)
    expect(view.hrv.baselineReadings).toBe(14)
  })

  test('none is none', () => {
    const { hrv } = planInputs(input({ wellness: [night(1, { restingHr: 50 })] }))
    expect(hrv.kind).toBe('none')
    expect(hrv.baselineReadings).toBe(0)
  })
})

describe('planInputs: resting heart rate and sleep', () => {
  test('resting heart rate counts the stored days and the baseline readings', () => {
    const wellness = Array.from({ length: 12 }, (_, i) => night(i + 1, { restingHr: 52 }))
    const { restingHr } = planInputs(input({ wellness }))
    expect(restingHr.days).toBe(12)
    expect(restingHr.baselineReadings).toBe(P.j4.windowDays.value)
  })

  test('sleep counts the recorded nights of the last j5.sleepWarnNights, today included', () => {
    const wellness = [
      night(0, { sleepSec: 7 * 3600 }),
      night(3, { sleepSec: 6 * 3600 }),
      night(6, { sleepSec: 0 }),
      night(P.j5.sleepWarnNights.value, { sleepSec: 7 * 3600 }),
    ]
    const { sleep } = planInputs(input({ wellness }))
    expect(sleep.nights).toBe(2)
    expect(sleep.windowNights).toBe(P.j5.sleepWarnNights.value)
    expect(sleep.minNights).toBe(P.j5.sleepMinNights.value)
  })
})

describe('planInputs: sleep efficiency (rule J5)', () => {
  const bed = (daysAgo: number): Wellness =>
    night(daysAgo, { sleepSec: 7 * 3600, inBedSec: 8 * 3600 })

  test('a runner without time in bed has no nights and the plan does not read it', () => {
    const wellness = Array.from({ length: 30 }, (_, i) => night(i, { sleepSec: 7 * 3600 }))
    const { efficiency } = planInputs(input({ wellness })).sleep
    expect(efficiency).toMatchObject({ nights: 0, baselineNights: 0, read: false })
    expect(efficiency.windowNights).toBe(P.j5.reducePersistDays.value)
    expect(efficiency.minNights).toBe(P.j5.sleepEffMinNights.value)
    expect(efficiency.baselineMinNights).toBe(P.j5.sleepEffMinBaselineNights.value)
  })

  test('counts the nights with both values in the window and before it, and reads once both are met', () => {
    const window = P.j5.reducePersistDays.value
    const wellness = [
      ...Array.from({ length: P.j5.sleepEffMinNights.value }, (_, i) => bed(i)),
      ...Array.from({ length: P.j5.sleepEffMinBaselineNights.value - 1 }, (_, i) =>
        bed(window + i),
      ),
    ]
    const short = planInputs(input({ wellness })).sleep.efficiency
    expect(short).toMatchObject({
      nights: P.j5.sleepEffMinNights.value,
      baselineNights: P.j5.sleepEffMinBaselineNights.value - 1,
      read: false,
    })
    const enough = planInputs(input({ wellness: [...wellness, bed(window + 20)] })).sleep.efficiency
    expect(enough).toMatchObject({
      baselineNights: P.j5.sleepEffMinBaselineNights.value,
      read: true,
    })
  })

  test('a night with more sleep than time in bed is not counted', () => {
    const wellness = [night(0, { sleepSec: 9 * 3600, inBedSec: 8 * 3600 }), bed(1)]
    expect(planInputs(input({ wellness })).sleep.efficiency.nights).toBe(1)
  })
})

describe('planInputs: runs', () => {
  test('streams, altitude, heart-rate sources and the checks are counted per run', () => {
    const activities = [
      run(0, 2.5, {
        terrainBins: {
          v: 1,
          windowM: 100,
          walkMps: 1,
          edgesPct: [0],
          sec: [0, 60],
          m: [0, 200],
          walkSec: [0, 0],
          flatCv: null,
        },
        hrQuality: quality('strap', 0.1),
      }),
      run(1, 2.6, { hrQuality: quality('wrist', 0.95) }),
      run(2, 2.7, { hrQuality: quality('wrist', 0.2) }),
      run(3, 2.8, { hrQuality: quality('unknown', 0.95) }),
      run(4, 2.9, {
        terrainBins: {
          v: 1,
          windowM: 100,
          walkMps: 1,
          edgesPct: [0],
          sec: [0, 0],
          m: [0, 0],
          walkSec: [0, 0],
          flatCv: null,
        },
      }),
      run(5, 3.0, { duplicateStatus: 'confirmed' }),
      run(6, 3.0, { type: 'strength' }),
    ]
    const { runs } = planInputs(input({ activities, streamIds: new Set(['m0', 'm1', 'm5', 'm6']) }))
    expect(runs.count).toBe(5)
    expect(runs.withStream).toBe(2)
    expect(runs.withAltitude).toBe(1)
    expect(runs.strap).toBe(1)
    expect(runs.wrist).toBe(2)
    expect(runs.unknown).toBe(1)
    expect(runs.passing).toBe(3)
    expect(runs.windowDays).toBe(P.a5.historyWindowDays.value)
  })

  test('the heart-rate line reports the runs it stands on and whether it is fitted', () => {
    const open = planInputs(input({ activities: RUNS.slice(0, 3) }))
    expect(open.runs.hrLine).toEqual({
      runs: 3,
      need: P.hrModel.minQualifyingRuns.value,
      windowWeeks: P.hrModel.windowWeeks.value,
      fitted: false,
    })
    const model = fitHrModel(RUNS, TODAY)
    const fitted = planInputs(input({ activities: RUNS, hrModel: model }))
    expect(fitted.runs.hrLine.runs).toBe(RUNS.length)
    expect(fitted.runs.hrLine.fitted).toBe(model !== null)
  })

  test('no runs gives zeros', () => {
    const { runs } = planInputs(input())
    expect([runs.count, runs.withStream, runs.withAltitude, runs.passing]).toEqual([0, 0, 0, 0])
  })
})

describe('planInputs: zones and sources', () => {
  test('each boundary reports the tier it sits on, or null', () => {
    const { zones } = planInputs(input())
    expect(zones.map((z) => [z.key, z.boundary?.source ?? null])).toEqual([
      ['hrMax', 'hrmax-age'],
      ['lt1Hr', 'hrr'],
      ['lt2Hr', null],
      ['csMps', 'cs'],
      ['lt1PaceSecPerKm', null],
      ['thresholdPaceSecPerKm', 'tested'],
    ])
    expect(zones[3]!.boundary).toMatchObject({ fromTraining: true, windowWidened: true })
    expect(zones[0]!.boundary).not.toHaveProperty('fromTraining')
  })

  test('registry sources are named with their labels; anything else is one line', () => {
    const activities = [
      run(0, 2.5, { source: 'intervals' }),
      run(1, 2.6, { source: 'intervals' }),
      run(2, 2.7, { source: 'file' }),
      run(3, 2.8, { source: 'intervals', duplicateStatus: 'possible' }),
    ]
    const wellness = [night(1, { source: 'apple-health' }), night(2, { source: 'manual' })]
    const { sources } = planInputs(input({ activities, wellness }))
    expect(sources.named).toEqual([
      { key: 'intervals', label: 'intervals.icu', activities: 2, wellnessDays: 0 },
      { key: 'apple-health', label: 'Apple Health', activities: 0, wellnessDays: 1 },
    ])
    expect(sources.other).toEqual({ activities: 1, wellnessDays: 1 })
  })
})

describe('watch ratings on the page', () => {
  const rated = (i: number, rpe: number | null, rpeSource: 'app' | 'watch' | null) =>
    run(i, 3, { rpe, rpeSource })

  test('counts the stored watch ratings and says the plan does not read them below the check', () => {
    const activities = [rated(1, 5, 'watch'), rated(2, 6, 'watch'), rated(3, 7, 'app')]
    const { runs } = planInputs(input({ activities }))
    expect(runs.watchRatings).toMatchObject({
      count: 2,
      distinct: 2,
      used: false,
      minCount: P.b1.watchRpeMinCount.value,
    })
  })

  test('says the plan reads them once the check passes', () => {
    const activities = Array.from({ length: 12 }, (_, i) => rated(i + 1, 3 + (i % 4), 'watch'))
    expect(planInputs(input({ activities })).runs.watchRatings).toMatchObject({
      count: 12,
      used: true,
    })
  })
})

describe('planInputs: your answers (rules J6 and J11)', () => {
  const rated = (daysAgo: number, over: Partial<Activity> = {}) =>
    run(1, 3, { date: addDays(TODAY, -daysAgo), ...over })
  const masters = { sex: 'male', birthYear: 1980 } as const

  test('J6 counts the check-ins the masters gate takes its median from', () => {
    const wellness = [
      night(0, { fatigue: 4 }),
      ...Array.from({ length: 9 }, (_, i) => night(i + 1, { fatigue: 3, soreness: 2 })),
      night(P.j6.medianDays.value, { mood: 3 }),
      night(P.j6.medianDays.value + 1, { fatigue: 3 }),
      night(12, { restingHr: 50 }),
    ]
    const { j6 } = planInputs(input({ wellness, profile: masters })).ownAnswers!
    const byDate = new Map(wellness.map((row) => [row.date, row]))
    expect(j6.checkins).toBe(mastersCheckinHistory(byDate, TODAY).length)
    // Nine days and the oldest day of the window; today, the day after the window and a day with
    // no check-in field are out.
    expect(j6.checkins).toBe(10)
    expect(j6.items).toEqual({ fatigue: 9, soreness: 9, mood: 1 })
    expect(j6.windowDays).toBe(P.j6.medianDays.value)
    expect(j6.minCheckins).toBe(P.j6.medianMinCheckins.value)
    expect(j6.reading).toBe(10 >= P.j6.medianMinCheckins.value)
  })

  test('J6 reads nothing below the minimum, under the masters age or with no birth year', () => {
    const min = P.j6.medianMinCheckins.value
    const few = Array.from({ length: min - 1 }, (_, i) => night(i + 1, { fatigue: 3 }))
    const enough = [...few, night(min, { fatigue: 3 })]
    expect(planInputs(input({ wellness: few, profile: masters })).ownAnswers!.j6).toMatchObject({
      applies: 'on',
      reading: false,
    })
    expect(planInputs(input({ wellness: enough, profile: masters })).ownAnswers!.j6.reading).toBe(
      true,
    )
    expect(
      planInputs(input({ wellness: enough, profile: { sex: 'male', birthYear: 2000 } })).ownAnswers!
        .j6,
    ).toMatchObject({ applies: 'under', reading: false })
    expect(planInputs(input({ wellness: enough })).ownAnswers!.j6).toMatchObject({
      applies: 'no-birth-year',
      reading: false,
    })
  })

  test('J11 agrees with repeatPainPattern on whether the look-back holds the reports', () => {
    const area = (daysAgo: number, painArea: string, painScore = P.pain.repeatMinScore.value) =>
      night(daysAgo, { painScore, painArea })
    const cases: Array<EngineInput['wellness']> = [
      [],
      [area(0, 'left knee'), area(2, 'knee')],
      [area(0, 'left knee'), area(2, 'knee'), area(4, 'my knee')],
      [area(0, 'left knee'), area(2, 'achilles'), area(4, 'calf')],
      [area(0, 'knee'), area(2, 'knee'), area(P.pain.repeatDays.value, 'knee')],
      [area(0, 'knee'), area(2, 'knee'), area(4, 'knee', P.pain.repeatMinScore.value - 1)],
    ]
    for (const wellness of cases) {
      const { j11 } = planInputs(input({ wellness })).ownAnswers!
      const pattern = repeatPainPattern({ wellness, windows: [], date: TODAY })
      expect(j11.reading).toBe(pattern !== null)
      if (pattern) expect(j11.mostOfOneArea).toBe(pattern.reports)
      expect(j11.windowDays).toBe(P.pain.repeatDays.value)
      expect(j11.minReports).toBe(P.pain.repeatReports.value)
    }
  })

  test('J11 counts pain scores apart from the reports that name an area', () => {
    const wellness = [
      night(0, { painScore: 5, painArea: 'knee' }),
      night(1, { painScore: 1, painArea: 'knee' }),
      night(2, { painScore: 4 }),
      night(3, { painScore: 4, painArea: 'hip' }),
    ]
    const { j11 } = planInputs(input({ wellness })).ownAnswers!
    expect(j11).toMatchObject({ painCheckins: 4, reports: 2, mostOfOneArea: 1, reading: false })
  })

  test('ratings: the watch is counted apart; duplicates, other types and days outside hold out', () => {
    const activities = [
      rated(1, { rpe: 5, rpeSource: 'app', feel: 1, pain: 2 }),
      rated(2, { rpe: 6, rpeSource: null }),
      rated(3, { rpe: 7, rpeSource: 'watch' }),
      rated(4, { rpe: 4, rpeSource: 'app', duplicateStatus: 'confirmed' }),
      rated(5, { rpe: 4, rpeSource: 'app', type: 'strength' }),
      rated(10, { rpe: 3, rpeSource: 'app', feel: 0 }),
      rated(P.j6.medianDays.value + 2, { rpe: 3, rpeSource: 'app' }),
      rated(0, { rpe: 9, rpeSource: 'app' }),
    ]
    // The snapshot the server passes: a watch rating is empty until the spread check passes.
    const snapshot = withUsableRatings(activities).activities
    const { j6, j11 } = planInputs(input({ activities: snapshot })).ownAnswers!
    // J6 takes the days before today; J11 takes today and the days before it.
    expect(j6.ratings).toEqual({ inApp: 3, watch: 0, feel: 2, pain: 1 })
    expect(j11.ratings).toEqual({ inApp: 3, watch: 0, feel: 1, pain: 1 })
  })

  test('ratings: watch ratings the engine reads are counted once the spread check passes', () => {
    const activities = Array.from({ length: 12 }, (_, i) =>
      rated(i + 1, { rpe: 3 + (i % 4), rpeSource: 'watch' }),
    )
    const snapshot = withUsableRatings(activities)
    expect(snapshot.check.usable).toBe(true)
    const { j6, j11 } = planInputs(input({ activities: snapshot.activities })).ownAnswers!
    expect(j6.ratings.watch).toBe(12)
    expect(j6.ratings.inApp).toBe(0)
    expect(j11.ratings.watch).toBe(6)
  })
})
