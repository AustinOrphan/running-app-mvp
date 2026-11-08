// My paces (rule C9, ADR 0020): the easy pace from the runner's own heart-rate line, else from the
// zones, else none; the events from `predictFromState`; the test the engine supports. The runs are
// synthetic and the line is exact (HR = 90 + 20 x speed), so every figure is checked by hand.
import { describe, expect, it } from 'vitest'
import { fitHrModel } from '../../../shared/engine/execution.ts'
import { eventRow } from '../../../shared/engine/myPaces.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { gradeAdjustedSpeed } from '../../../shared/engine/terrain.ts'
import type { Activity } from '../../../shared/types.ts'
import { athlete, scaledCurve, syntheticRuns } from './gradeCurve-fixtures.ts'
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

describe('the hot day is held to the same bounds as the cool one [C9]', () => {
  // HR = 100 + 12 x speed on runs of 2.5 to 3.3 m/s, a ceiling of 135 bpm (hrMax 173 x 0.78)
  const runs = Array.from({ length: 9 }, (_, i) =>
    run(i, 2.5 + i * 0.1, {}, Math.round(100 + 12 * (2.5 + i * 0.1))),
  )
  const profile = { ...profileFixture, hrMax: 173 }

  it('shows no hot figure when the heat moves the speed below the fitted ones', () => {
    const model = fitHrModel(runs, TODAY)!
    const { zones, view } = paces({ profile, activities: runs })
    const ceiling = zones.hr!.z1[1]
    expect(ceiling).toBe(135)
    const pace = view.easy.pace!
    // cool: (135 - intercept) / slope is about 2.9 m/s, inside 2.5 to 3.3 widened by the margin
    const cool = (ceiling - model.interceptBpm) / model.slopeBpmPerMps
    expect(cool).toBeGreaterThan(model.minSpeedMps * (1 - P.c9.lineSpeedMargin.value))
    expect(pace.basis).toBe('hr-model')
    expect(pace.range[1]).toBe(Math.round(1000 / cool))
    // hot: the heat shift of about 12 bpm puts the line at about 1.9 m/s, under 2.25 m/s
    const excess = P.i9.warnWbgtC.value - P.conditions.heatAdjustAboveWbgtC.value
    const hot = (ceiling - model.heatBpmPerC * excess - model.interceptBpm) / model.slopeBpmPerMps
    expect(hot).toBeLessThan(model.minSpeedMps * (1 - P.c9.lineSpeedMargin.value))
    expect(hot).toBeGreaterThan(P.c9.walkingFloorMps.value)
    expect(pace.hot).toBeNull()
    expect(pace.rules).not.toContain('I9')
  })
})

describe('why the line gives no pace [C9]', () => {
  const cs = { csMps: 3.5, dPrimeM: 150, csEfforts: 3 }
  const on = (speeds: number[], hr: (v: number) => number) =>
    speeds.map((v, i) => run(i, v, {}, hr(v)))
  const line = (v: number) => Math.round(90 + 20 * v)

  it('is null when the line speaks, and when there is no line or ceiling to read', () => {
    expect(paces({}).view.easy.lineIssue).toBeNull()
    expect(paces({ activities: RUNS.slice(0, 3) }).view.easy.lineIssue).toBeNull()
  })

  it('names a line too flat to say', () => {
    const runs = on([2.6, 2.7, 2.8, 2.9, 3, 3.1, 3.2, 3.3, 3.4], () => 140)
    expect(paces({ activities: runs }).view.easy.lineIssue).toBe('flat')
  })

  it('names a ceiling outside the speeds the runs cover', () => {
    const profile = { ...profileFixture, hrMax: 170 }
    const runs = on([3, 3.005, 3.01, 3.015, 3.02, 3.025, 3.03, 3.035, 3.04], line)
    expect(paces({ profile, activities: runs }).view.easy.lineIssue).toBe('outside-runs')
  })

  it('names a line that never reaches the ceiling as outside the runs', () => {
    // HR = 150 + 8 x speed: every run is above the 148 bpm ceiling, so no speed meets it
    const runs = on([2.6, 2.7, 2.8, 2.9, 3, 3.1, 3.2, 3.3, 3.4], (v) => Math.round(150 + 8 * v))
    expect(paces({ activities: runs }).view.easy.lineIssue).toBe('outside-runs')
  })

  it('names a pace faster than easy running can be', () => {
    const runs = on([4, 4.125, 4.25, 4.375, 4.5, 4.625, 4.75, 4.875, 5], (v) =>
      Math.round(100 + 10 * v),
    )
    expect(paces({ activities: runs }).view.easy.lineIssue).toBe('too-fast')
    const bounded = paces({ state: stateWith({ ...cs, csMps: 4.7 }), activities: runs })
    expect(bounded.view.easy.lineIssue).toBe('too-fast')
  })

  it('names a pace slower than a walk', () => {
    // a ceiling of 118 bpm meets HR = 90 + 20 x speed at 1.4 m/s, inside runs of 1.2 to 1.8
    const profile = { ...profileFixture, hrMax: 151 }
    const runs = on([1.2, 1.275, 1.35, 1.425, 1.5, 1.575, 1.65, 1.725, 1.8], line)
    expect(paces({ profile, activities: runs }).view.easy.lineIssue).toBe('too-slow')
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
    expect(ten?.basis.cs).toEqual({ csMps: 3.5, efforts: 3, since: null })
    expect(ten?.methods).toEqual(['riegel', 'critical-speed'])
    expect(ten?.singleSource).toBe(false)
    // the fit of critical speed and the widening for one source are grade D defaults (A6, L3)
    expect(ten?.grade).toBe('D')
    expect(ten?.rules).toEqual(expect.arrayContaining(['L1', 'L6']))
  })

  it('says a critical speed found from training widens the range and offers the test (A6)', () => {
    const base = { csMps: 3.5, dPrimeM: 150, csEfforts: 4 }
    const flat = stateWith(base)
    const trained = stateWith({ ...base, csTrainingSince: '2026-08-11' })
    const spec = { key: 'half' as const, distanceM: 21097, gainM: 0 }
    const wide = eventRow(trained, spec)
    const narrow = eventRow(flat, spec)
    expect(wide.basis.cs).toEqual({ csMps: 3.5, efforts: 4, since: '2026-08-11' })
    expect(narrow.basis.cs?.since).toBeNull()
    // only the faster end opens
    expect(wide.time!.highSec).toBe(narrow.time!.highSec)
    expect(wide.time!.midSec - wide.time!.lowSec).toBeGreaterThan(
      narrow.time!.midSec - narrow.time!.lowSec,
    )
    expect(wide.rules).toContain('A6')
    expect(wide.grade).toBe('D')
    expect(paces({ state: trained }).view.test.fromTraining).toBe(true)
    expect(paces({ state: flat }).view.test.fromTraining).toBe(false)
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
      fromTraining: false,
    })
  })

  it('marks a row whose time the runner own climbing moved, and no other (L5, I13)', () => {
    const state = stateWith({ races: [tenK], csMps: 3.5, dPrimeM: 150, csEfforts: 3 })
    const own = { ...state, climb: { ratio: 0.7, runs: 23 } }
    const flat = eventRow(own, { key: 'custom', distanceM: 20000, gainM: 0 })
    const plain = eventRow(state, { key: 'custom', distanceM: 20000, gainM: 800 })
    const hilly = eventRow(own, { key: 'custom', distanceM: 20000, gainM: 800 })
    expect(flat.ownClimb).toBeNull()
    expect(plain.ownClimb).toBeNull()
    expect(hilly.ownClimb?.runs).toBe(23)
    expect(hilly.ownClimb?.shiftSec).toBe(hilly.time!.midSec - plain.time!.midSec)
    expect(hilly.time!.midSec).toBeLessThan(plain.time!.midSec)
    expect(hilly.grade).toBe('D')
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

describe('the climb row and the grade table from the runner own curve [I13]', () => {
  const who = athlete(scaledCurve(0.5), 0.03)
  /** Synthetic runs with terrain bins, as activities, on top of the nine runs of the line. */
  const withBins = (count: number): Activity[] =>
    syntheticRuns(who, count, TODAY, 21, 2).map((r, i) =>
      run(100 + i, 3, { id: r.id, date: r.date, terrainBins: r.bins }),
    )
  const climbBand = (view: ReturnType<typeof paces>['view']) =>
    view.terrain.bands.find((band) => band.fromPct === 3 && band.toPct === 6)!

  it('keeps Minetti and says why when the runs carry no bins', () => {
    const { view } = paces({})
    const climb = view.easy.pace!.climb
    expect(climb.source).toBe('default')
    expect(climb.reason).toBe('few-minutes')
    expect(climb.bandIndex).toBe(climbBand(view).index)
    expect(view.terrain.eligibleRuns).toBe(0)
    expect(view.terrain.bands.every((band) => band.source === 'default')).toBe(true)
    expect(view.easy.pace!.rules).toContain('I13')
  })

  it('moves the climb by the own ratio of the band when the curve shows it', () => {
    const { view } = paces({ activities: [...RUNS, ...withBins(40)] })
    const band = climbBand(view)
    expect(band.source).toBe('personal')
    const pace = view.easy.pace!
    expect(pace.climb.source).toBe('personal')
    expect(pace.climb.reason).toBe('personal')
    expect(pace.climb.range).toEqual([
      Math.round(pace.range[0] / band.ratio),
      Math.round(pace.range[1] / band.ratio),
    ])
    // scaledCurve(0.5) is half as steep as Minetti, so the climb is faster than the default one
    const minetti = gradeAdjustedSpeed(1, P.c9.exampleGradePct.value / 100)
    expect(pace.climb.range[1]).toBeLessThan(Math.round(pace.range[1] * minetti))
  })

  it('reads runs only: races and flagged duplicates give no bins to the curve', () => {
    const extra = withBins(40)
    const races = extra.map((a) => ({ ...a, type: 'race' as const }))
    const dups = extra.map((a) => ({ ...a, duplicateStatus: 'confirmed' as const }))
    expect(paces({ activities: [...RUNS, ...races] }).view.terrain.eligibleRuns).toBe(0)
    expect(paces({ activities: [...RUNS, ...dups] }).view.terrain.eligibleRuns).toBe(0)
  })

  it('changes no prediction', () => {
    const plain = paces({}).view.events
    const rich = paces({ activities: [...RUNS, ...withBins(40)] }).view.events
    expect(rich).toEqual(plain)
  })
})
