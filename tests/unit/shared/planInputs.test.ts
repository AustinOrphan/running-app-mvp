// What the plan can see (rule T2): the counts come from the engine's own selections, so the tests
// build synthetic snapshots and read the numbers back.
import { describe, expect, test } from 'vitest'
import { planInputs, type PlanInputsInput } from '../../../shared/domain/planInputs.ts'
import { addDays } from '../../../shared/dates.ts'
import { fitHrModel } from '../../../shared/engine/execution.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { Boundary, EngineInput, ZoneSet } from '../../../shared/engine/types.ts'
import type { HrQuality, HrSource } from '../../../shared/types.ts'
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
    activities: [],
    streamIds: new Set(),
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
