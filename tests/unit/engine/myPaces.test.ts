// My paces (rule C9, ADR 0020): the easy pace from the runner's own heart-rate line, else from the
// zones, else none; the events from `predictFromState`; the test the engine supports. The runs are
// synthetic and the line is exact (HR = 90 + 20 x speed), so every figure is checked by hand.
import { describe, expect, it } from 'vitest'
import { fitHrModel } from '../../../shared/engine/execution.ts'
import { eventRow, myPaces, type EventSpec } from '../../../shared/engine/myPaces.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { gradeAdjustedSpeed } from '../../../shared/engine/terrain.ts'
import type { AthleteState } from '../../../shared/engine/types.ts'
import { buildZones } from '../../../shared/engine/zones.ts'
import type { Activity } from '../../../shared/types.ts'
import { profileFixture } from './fixtures.ts'

const TODAY = '2026-06-30'

function run(i: number, speedMps: number, over: Partial<Activity> = {}): Activity {
  const durationSec = 40 * 60
  const avgHr = Math.round(90 + 20 * speedMps)
  return {
    id: `m${String(i)}`,
    userId: 'u1',
    date: `2026-06-${String(10 + i).padStart(2, '0')}`,
    startTime: null,
    type: 'run',
    durationSec,
    distanceM: speedMps * durationSec,
    rpe: null,
    avgHr,
    maxHr: null,
    elevationGainM: 20,
    notes: null,
    source: 'manual',
    providerKey: null,
    importBatchId: null,
    duplicateOfId: null,
    duplicateStatus: 'none',
    subtype: null,
    startUtc: null,
    utcOffsetMin: null,
    movingSec: null,
    elevationLossM: null,
    avgCadence: null,
    avgPowerW: null,
    deviceName: null,
    startLat: null,
    startLng: null,
    tempC: null,
    dewPointC: null,
    windKph: null,
    humidityPct: null,
    weatherSource: null,
    hrHistogram: {
      start: 100,
      width: 5,
      sec: Array.from({ length: 20 }, (_, bin) =>
        bin === Math.floor((avgHr - 100) / 5) ? durationSec : 0,
      ),
    },
    decouplingPct: null,
    gapDistanceM: speedMps * durationSec,
    feel: null,
    pain: null,
    createdAt: '2026-06-30T00:00:00Z',
    updatedAt: '2026-06-30T00:00:00Z',
    ...over,
  }
}

/** Nine steady flat runs on the line HR = 90 + 20 x speed, speeds 2.6 to 3.4 m/s. */
const RUNS = Array.from({ length: 9 }, (_, i) => run(i, 2.6 + i * 0.1))

function stateWith(fitness: Partial<AthleteState['fitness']> = {}, layoffDays = 0): AthleteState {
  return {
    asOf: TODAY,
    age: 40,
    sex: 'unspecified',
    experience: 'recreational',
    yearsRunning: 6,
    load: { metric: 'minutes', acute: 0, chronic: 0, daily: [] },
    weeks: [],
    typicalWeekMin: 240,
    recentWeekMin: 0,
    longest30d: { distanceM: 0, durationSec: 0, gainM: 0, lossM: 0, twoDaySec: 0 },
    gaps16w: 0,
    layoffDays,
    lastRunDate: null,
    fitness: {
      csMps: null,
      dPrimeM: null,
      csEfforts: 0,
      exponent: null,
      races: [],
      vo2maxTrend: null,
      ...fitness,
    },
    efficiency: { current: null, trendPct: null, samples: 0 },
    durability: { decouplingMedianPct: null, samples: 0 },
    risk: { recentInjury: false, priorBsi: false, bsiFactors: 0, redsFlags: 0, noviceFlags: [] },
    lowFrequency: false,
    history: null,
    heatAcclimation: 0,
  }
}

const EVENTS: EventSpec[] = [
  { key: 'five-k', distanceM: 5000, gainM: 0 },
  { key: 'ten-k', distanceM: 10000, gainM: 0 },
]

function paces(over: {
  state?: AthleteState
  profile?: typeof profileFixture
  activities?: Activity[]
}) {
  const state = over.state ?? stateWith()
  const profile = over.profile ?? profileFixture
  const activities = over.activities ?? RUNS
  const zones = buildZones(profile, state, TODAY)
  return {
    zones,
    view: myPaces(
      { state, zones, hrModel: fitHrModel(activities, TODAY), activities, today: TODAY },
      EVENTS,
    ),
  }
}

describe('easy pace from the heart-rate line [C9, A8, C2]', () => {
  it('meets the top of Z1 on the line, and runs to the slow edge of Z1', () => {
    const { zones, view } = paces({})
    const ceiling = zones.hr!.z1[1]
    const pace = view.easy.pace!
    expect(pace.basis).toBe('hr-model')
    expect(pace.ceilingBpm).toBe(ceiling)
    // HR = 90 + 20 v: the line meets the ceiling at (ceiling - 90) / 20 m/s
    const fastSec = 1000 / ((ceiling - 90) / 20)
    expect(pace.range[1]).toBe(Math.round(fastSec))
    expect(pace.range[0]).toBe(Math.round(fastSec * P.c2.z1PaceSlowFactor.value))
    expect(pace.range[0]).toBeGreaterThan(pace.range[1])
  })

  it('names the runs and the earliest day, and the grade of a default', () => {
    const pace = paces({}).view.easy.pace!
    expect(pace.sample).toEqual({ runs: 9, since: '2026-06-10' })
    expect(pace.grade).toBe('D')
    expect(pace.confidence).toBe('moderate')
    expect(pace.rules).toEqual(expect.arrayContaining(['C9', 'C2', 'A8', 'I11']))
  })

  it('is low in confidence when the ceiling comes from an age estimate of the maximum', () => {
    const profile = { ...profileFixture, hrMax: null, hrMaxSource: null }
    const pace = paces({ profile }).view.easy.pace
    expect(pace?.basis).toBe('hr-model')
    expect(pace?.confidence).toBe('low')
  })

  it('moves the hot day by the line heat term, from the heat-steering WBGT', () => {
    const { zones, view } = paces({})
    const model = fitHrModel(RUNS, TODAY)!
    const pace = view.easy.pace!
    expect(pace.hot?.wbgtC).toBe(P.i9.warnWbgtC.value)
    const excess = P.i9.warnWbgtC.value - P.conditions.heatAdjustAboveWbgtC.value
    const speed = (zones.hr!.z1[1] - model.heatBpmPerC * excess - 90) / 20
    expect(pace.hot?.range[1]).toBe(Math.round(1000 / speed))
    expect(pace.hot!.range[1]).toBeGreaterThan(pace.range[1])
    expect(pace.rules).toEqual(expect.arrayContaining(['I7', 'I9']))
  })

  it('moves the climb by the cost of the grade (I11)', () => {
    const pace = paces({}).view.easy.pace!
    const ratio = gradeAdjustedSpeed(1, P.c9.exampleGradePct.value / 100)
    expect(ratio).toBeGreaterThan(1)
    expect(pace.climb.gradePct).toBe(P.c9.exampleGradePct.value)
    expect(pace.climb.range).toEqual([
      Math.round(pace.range[0] * ratio),
      Math.round(pace.range[1] * ratio),
    ])
  })

  it('does not use a line that puts easy running at critical speed or beyond', () => {
    const state = stateWith({ csMps: 2.5, dPrimeM: 150, csEfforts: 3 })
    const pace = paces({ state }).view.easy.pace
    expect(pace?.basis).toBe('critical-speed')
  })
})

describe('easy pace from the zones, else none [C9, C2, C4]', () => {
  it('takes the Z1 pace range of the zones when no line qualifies, from critical speed', () => {
    const state = stateWith({ csMps: 3.5, dPrimeM: 150, csEfforts: 3 })
    const { zones, view } = paces({ state, activities: RUNS.slice(0, 3) })
    const pace = view.easy.pace!
    expect(pace.basis).toBe('critical-speed')
    expect(pace.range).toEqual(zones.pace!.z1)
    expect(pace.sample).toBeNull()
    expect(pace.hot).toBeNull()
    expect(pace.confidence).toBe('low')
    expect(view.easy.zoneRange).toEqual(zones.pace!.z1)
  })

  it('names a tested threshold pace as the basis when the profile carries one', () => {
    const profile = { ...profileFixture, thresholdPaceSecPerKm: 300 }
    const pace = paces({ profile, activities: [] }).view.easy.pace!
    expect(pace.basis).toBe('threshold-pace')
    expect(pace.confidence).toBe('moderate')
  })

  it('gives none after a break, when the zones drop their paces, and says how far the line is', () => {
    const state = stateWith({ csMps: 3.5, dPrimeM: 150, csEfforts: 3 }, P.c8.breakDays.value)
    const { view } = paces({ state, activities: RUNS.slice(0, 3) })
    expect(view.easy.pace).toBeNull()
    expect(view.easy.zoneRange).toBeNull()
    expect(view.easy.hr).toEqual({
      runs: 3,
      need: P.hrModel.minQualifyingRuns.value,
      windowWeeks: P.hrModel.windowWeeks.value,
      minDurationMin: P.hrModel.minDurationMin.value,
      ceiling: true,
    })
  })

  it('says the ceiling is missing when the zones hold no heart rate', () => {
    const profile = { ...profileFixture, hrMax: null, hrMaxSource: null, birthYear: null }
    const state = { ...stateWith(), age: null }
    const { view } = paces({ state, profile, activities: [] })
    expect(view.easy.hr.ceiling).toBe(false)
    expect(view.easy.pace).toBeNull()
  })
})

describe('the events [C9, L1 to L6]', () => {
  const tenK = { date: '2026-03-14', distanceM: 10000, timeSec: 3000 }

  it('predicts each course with a range, a pace and the basis it stood on', () => {
    const state = stateWith({ races: [tenK], csMps: 3.5, dPrimeM: 150, csEfforts: 3 })
    const { view } = paces({ state })
    const [five, ten] = view.events
    expect(five?.time?.lowSec).toBeLessThan(five!.time!.midSec)
    expect(five?.time?.highSec).toBeGreaterThan(five!.time!.midSec)
    expect(ten?.pace?.midSec).toBeCloseTo(ten!.time!.midSec / 10, 6)
    expect(ten?.pace?.fastSec).toBeLessThan(ten!.pace!.slowSec)
    expect(ten?.basis.race).toEqual(tenK)
    expect(ten?.basis.cs).toEqual({ csMps: 3.5, efforts: 3 })
    expect(ten?.methods).toEqual(['riegel', 'critical-speed'])
    expect(ten?.singleSource).toBe(false)
    expect(ten?.grade).toBe('C')
    expect(ten?.rules).toEqual(expect.arrayContaining(['L1', 'L6']))
  })

  it('says one source widens the range, and grades a placeholder as a default', () => {
    const state = stateWith({ races: [tenK] })
    const marathon = eventRow(state, { key: 'marathon', distanceM: 42195, gainM: 0 })
    expect(marathon.methods).toEqual(['single-anchor'])
    expect(marathon.singleSource).toBe(true)
    expect(marathon.basis.cs).toBeNull()
    expect(marathon.grade).toBe('D')
  })

  it('has no time when the state supports no source, and the test is offered', () => {
    const { view } = paces({})
    for (const row of view.events) {
      expect(row.time).toBeNull()
      expect(row.pace).toBeNull()
      expect(row.methods).toEqual([])
    }
    expect(view.test).toEqual({
      efforts: 0,
      need: P.a6.csMinEfforts.value,
      minM: P.a6.csMinDistanceM.value,
      maxM: P.a6.csMaxDistanceM.value,
      spreadRatio: P.a6.csMinTimeSpreadRatio.value,
      windowDays: P.a6.csWindowDays.value,
      done: false,
    })
  })

  it('counts climb as flat distance and says so, as a trail course (L5)', () => {
    const state = stateWith({ races: [tenK], csMps: 3.5, dPrimeM: 150, csEfforts: 3 })
    const flat = eventRow(state, { key: 'custom', distanceM: 20000, gainM: 0 })
    const hilly = eventRow(state, { key: 'custom', distanceM: 20000, gainM: 800 })
    expect(hilly.climbs).toBe(true)
    expect(hilly.rules).toContain('L5')
    expect(hilly.grade).toBe('D')
    expect(hilly.time!.midSec).toBeGreaterThan(flat.time!.midSec)
    expect(hilly.pace!.slowSec - hilly.pace!.fastSec).toBeGreaterThan(
      flat.pace!.slowSec - flat.pace!.fastSec,
    )
  })

  it('shows an ultra as wide on purpose', () => {
    const state = stateWith({ races: [tenK], csMps: 3.5, dPrimeM: 150, csEfforts: 3 })
    expect(eventRow(state, { key: 'fifty-k', distanceM: 50000, gainM: 0 }).wide).toBe(true)
    expect(eventRow(state, { key: 'five-k', distanceM: 5000, gainM: 0 }).wide).toBe(false)
  })

  it('reports a critical speed as done once the efforts give one', () => {
    const state = stateWith({ csMps: 3.5, dPrimeM: 150, csEfforts: 4 })
    expect(paces({ state }).view.test).toMatchObject({ efforts: 4, done: true })
  })
})
