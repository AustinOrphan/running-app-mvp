// My paces (rule C9, ADR 0020): the easy pace from the runner's own heart-rate line, else from the
// zones, else none; the events from `predictFromState`; the test the engine supports. The runs are
// synthetic and the line is exact (HR = 90 + 20 x speed), so every figure is checked by hand.
import { describe, expect, it } from 'vitest'
import { fitHrModel } from '../../../shared/engine/execution.ts'
import { eventRow } from '../../../shared/engine/myPaces.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { gradeAdjustedSpeed } from '../../../shared/engine/terrain.ts'
import { paces, profileFixture, run, RUNS, stateWith, TODAY } from './myPacesFixtures.ts'

describe('easy pace from the heart-rate line [C9, A8, C2]', () => {
  it('meets the top of Z1 on the line, and runs to the slow edge of Z1', () => {
    const { zones, view } = paces({})
    const ceiling = zones.hr!.z1[1]
    const pace = view.easy.pace!
    expect(pace.basis).toBe('hr-model')
    expect(pace.ceilingBpm).toBe(ceiling)
    expect(pace.ceilingBandBpm).toBe((zones.lt1Hr!.band[1] - zones.lt1Hr!.band[0]) / 2)
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
    // no hot run among the nine: the heat term is the population default, and the figure says so
    expect(pace.hot?.own).toBe(false)
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

describe('where the heart-rate line speaks [C9]', () => {
  const cs = { csMps: 3.5, dPrimeM: 150, csEfforts: 3 }
  /** Nine runs at 3.00 to 3.04 m/s with the heart rates the caller gives. */
  const narrow = (hr: (i: number) => number) =>
    Array.from({ length: 9 }, (_, i) => run(i, 3 + i * 0.005, {}, hr(i)))

  it('says hot runs of the runner own make the heat term theirs', () => {
    const hot = RUNS.map((r, i) =>
      i < P.hrModel.shrinkagePriorRuns.value ? { ...r, tempC: 30, humidityPct: 70 } : r,
    )
    const model = fitHrModel(hot, TODAY)!
    expect(model.hotRuns).toBeGreaterThanOrEqual(P.hrModel.shrinkagePriorRuns.value)
    const { view } = paces({ activities: hot })
    expect(view.easy.pace?.hot?.own).toBe(true)
  })

  it('gives no pace from a flat line with no critical speed to bound it', () => {
    // every run at 140 bpm whatever the speed: the slope is nothing, the "easy speed" unbounded
    const { view } = paces({ activities: narrow(() => 140) })
    expect(view.easy.pace).toBeNull()
  })

  it('gives no pace from a nearly flat line whose solved speed is inside the fitted ones', () => {
    // heart rate 148 to 149 bpm across 2.6 to 3.4 m/s: the 148 bpm ceiling is met inside the runs,
    // but a slope this small cannot say at which speed
    const runs = Array.from({ length: 9 }, (_, i) =>
      run(i, 2.6 + i * 0.1, {}, Math.round(145.4 + (2.6 + i * 0.1))),
    )
    const model = fitHrModel(runs, TODAY)!
    expect(model.slopeBpmPerMps).toBeGreaterThan(0)
    expect(model.slopeBpmPerMps).toBeLessThan(P.c9.lineMinSlopeBpmPerMps.value)
    expect(paces({ activities: runs }).view.easy.pace).toBeNull()
  })

  it('falls back to the zones from a flat line', () => {
    const { zones, view } = paces({ state: stateWith(cs), activities: narrow(() => 140) })
    expect(view.easy.pace?.basis).toBe('critical-speed')
    expect(view.easy.pace?.range).toEqual(zones.pace!.z1)
  })

  it('gives no pace from a line whose intercept sits near the ceiling', () => {
    // HR = 146 + 5 x speed: the line meets 148 bpm at 0.4 m/s, below every fitted run and a walk
    const runs = Array.from({ length: 9 }, (_, i) =>
      run(i, 2.6 + i * 0.1, {}, Math.round(146 + 5 * (2.6 + i * 0.1))),
    )
    const model = fitHrModel(runs, TODAY)!
    expect(model.slopeBpmPerMps).toBeGreaterThanOrEqual(P.c9.lineMinSlopeBpmPerMps.value - 1)
    const { view } = paces({ activities: runs })
    expect(view.easy.pace).toBeNull()
  })

  it('gives no pace when the ceiling lies beyond the speeds fitted', () => {
    // runs at 3.00 to 3.04 m/s on the line HR = 90 + 20 x speed; a ceiling of 132 bpm meets it at 2.1
    const profile = { ...profileFixture, hrMax: 170 }
    const { view } = paces({
      profile,
      activities: narrow((i) => Math.round(90 + 20 * (3 + i * 0.005))),
    })
    expect(view.easy.pace).toBeNull()
  })

  it('gives no pace faster than the ceiling on easy speed when nothing bounds it', () => {
    // fitted at 4.0 to 5.0 m/s on HR = 100 + 10 x speed, the line meets 148 bpm at 4.8 m/s
    const runs = Array.from({ length: 9 }, (_, i) =>
      run(i, 4 + i * 0.125, {}, Math.round(100 + 10 * (4 + i * 0.125))),
    )
    expect(paces({ activities: runs }).view.easy.pace).toBeNull()
    // with a critical speed above it, the same line is a pace
    const bounded = paces({
      state: stateWith({ csMps: 5.5, dPrimeM: 150, csEfforts: 3 }),
      activities: runs,
    })
    expect(bounded.view.easy.pace?.basis).toBe('hr-model')
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
    // the fit of critical speed and the widening for one source are grade D defaults (A6, L3)
    expect(ten?.grade).toBe('D')
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
