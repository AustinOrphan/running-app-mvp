import { describe, expect, test } from 'vitest'
import { parseFit } from '../../../shared/importers/files/fit.ts'
import {
  MAX_GAP_SEC,
  MOVING_SPEED_MPS,
  summarize,
} from '../../../shared/importers/files/summarize.ts'
import {
  TERRAIN_EDGES_PCT,
  TERRAIN_STOPPED_MPS,
  TERRAIN_WINDOW_M,
  TERRAIN_MAX_STEP_SEC,
  TERRAIN_MIN_ALTITUDE_RANGE_M,
  computeTerrainBins,
  hasTerrainBins,
} from '../../../shared/importers/files/terrainBins.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { COURSE, courseFit, type Leg } from '../../fixtures/fit/terrainCourse.ts'

// Band indexes for TERRAIN_EDGES_PCT = [-15, -10, -6, -3, 3, 6, 10, 15].
const DOWN_8 = 2
const FLAT = 4
const UP_8 = 6
const UP_20 = 8

function summaryOf(legs: Leg[], opts: Parameters<typeof courseFit>[1] = {}) {
  const [parsed] = parseFit(courseFit(legs, opts), { timezone: 'UTC' })
  if (!parsed) throw new Error('expected one activity')
  return { parsed, summary: summarize(parsed) }
}

function streamOf(withAltitude = true) {
  return summaryOf(COURSE, { withAltitude }).summary.stream
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

describe('computeTerrainBins', () => {
  const { sampleSec, ...stream } = streamOf()
  const bins = computeTerrainBins(stream, sampleSec)

  test('has one entry per band and records the settings it used', () => {
    expect(bins.edgesPct).toEqual([...TERRAIN_EDGES_PCT])
    expect(bins.windowM).toBe(TERRAIN_WINDOW_M)
    expect(bins.walkMps).toBe(P.c9.walkingFloorMps.value)
    for (const key of ['sec', 'm', 'walkSec'] as const) {
      expect(bins[key]).toHaveLength(TERRAIN_EDGES_PCT.length + 1)
    }
  })

  test('puts time and distance in the band of the grade, with the speed each band was run at', () => {
    const speed = (band: number) => bins.m[band]! / bins.sec[band]!
    // The flat legs hold 1200 s in all, the others 300, 200 and 300 s; steps near a change blend two grades.
    expect(bins.sec[FLAT]!).toBeGreaterThan(1000)
    expect(bins.sec[UP_8]!).toBeGreaterThan(200)
    expect(bins.sec[UP_8]!).toBeLessThanOrEqual(300)
    expect(bins.sec[UP_20]!).toBeGreaterThan(100)
    expect(bins.sec[DOWN_8]!).toBeGreaterThan(200)
    expect(speed(FLAT)).toBeCloseTo(3, 0)
    expect(speed(UP_8)).toBeCloseTo(2.4, 0)
    expect(speed(UP_20)).toBeCloseTo(1, 0)
    expect(speed(DOWN_8)).toBeCloseTo(3.6, 0)
  })

  test('counts time under the walking floor as walking, and nothing else', () => {
    expect(bins.walkSec[UP_20]!).toBe(bins.sec[UP_20]!)
    for (const band of [FLAT, UP_8, DOWN_8]) expect(bins.walkSec[band]).toBe(0)
  })

  test('leaves standing still out, and the run-off at both ends of the run', () => {
    const total = bins.sec.reduce((a, b) => a + b, 0)
    // 2000 s of movement, minus the 60 s stop (never counted) and the steps within half a window
    // of the start and the end.
    expect(total).toBeLessThan(2000)
    expect(total).toBeGreaterThan(1900)
    expect(bins.sec.every((v, i) => v >= bins.walkSec[i]!)).toBe(true)
  })

  test('stays small: no per-sample data', () => {
    expect(JSON.stringify(bins).length).toBeLessThan(400)
  })

  test('a stream with no altitude, or with no distance, gives all-zero bins', () => {
    const flat = streamOf(false)
    for (const empty of [
      computeTerrainBins({ ...flat, alt: null }, flat.sampleSec),
      computeTerrainBins({ ...stream, d: null }, sampleSec),
      computeTerrainBins({ ...stream, t: [] }, sampleSec),
    ]) {
      expect(empty.sec.every((v) => v === 0)).toBe(true)
      expect(empty.m.every((v) => v === 0)).toBe(true)
      expect(empty.walkSec.every((v) => v === 0)).toBe(true)
      expect(empty.edgesPct).toEqual([...TERRAIN_EDGES_PCT])
    }
  })

  test('is deterministic over the same stream', () => {
    expect(computeTerrainBins(stream, sampleSec)).toEqual(bins)
  })

  test('a gap in the altitude (a pause bucket) does not stop the run being binned', () => {
    const alt = stream.alt!.map((v, i) => (i % 17 === 5 ? Number.NaN : v))
    const holed = computeTerrainBins({ ...stream, alt }, sampleSec)
    expect(holed.sec[FLAT]!).toBeGreaterThan(1000)
  })
})

describe('streams sampled more slowly than the 10 s bucket', () => {
  test.each([12, 15, 20, 30])('a record every %i s keeps the true speed and time', (everySec) => {
    const { summary } = summaryOf(COURSE, { everySec })
    const bins = computeTerrainBins(summary.stream, summary.stream.sampleSec)
    const speed = (band: number) => bins.m[band]! / bins.sec[band]!
    // Within 0.1 m/s: a step across a change of grade blends two legs. An unfixed step width
    // would read 4.5 m/s on 15 s sampling.
    expect(Math.abs(speed(FLAT) - 3)).toBeLessThan(0.1)
    expect(Math.abs(speed(UP_8) - 2.4)).toBeLessThan(0.1)
    expect(Math.abs(speed(DOWN_8) - 3.6)).toBeLessThan(0.1)
    // Seconds stay near the moving time: steps beside a stop and at the two ends are left out.
    expect(sum(bins.sec)).toBeLessThanOrEqual(summary.movingSec!)
    expect(sum(bins.sec)).toBeGreaterThan(summary.movingSec! * 0.85)
    expect(bins.walkSec[FLAT]).toBe(0)
  })
})

describe('stop and go', () => {
  // A hill to give the run some altitude, then 40 s running and 15 s standing, repeated.
  const cycle: Leg[] = Array.from({ length: 30 }, () => [
    { seconds: 40, speed: 3, gradePct: 0 },
    { seconds: 15, speed: 0, gradePct: 0 },
  ]).flat()
  const legs: Leg[] = [{ seconds: 300, speed: 3, gradePct: 5 }, ...cycle]

  test('bin seconds stay within moving time and nothing is booked as walking', () => {
    const { parsed, summary } = summaryOf(legs)
    const bins = computeTerrainBins(summary.stream, summary.stream.sampleSec)
    const moving = summary.movingSec!
    // Every bucket beside a stop (part running, part standing) is left out, which is two of the
    // four buckets of each 40 s burst here: the bins hold between half and all of the moving
    // time, never more.
    expect(sum(bins.sec)).toBeLessThanOrEqual(moving)
    expect(sum(bins.sec)).toBeGreaterThan(moving * 0.5)
    expect(sum(bins.m)).toBeLessThanOrEqual(parsed.distanceM! + 1)
    expect(sum(bins.walkSec)).toBe(0)
  })
})

describe('no terrain to read', () => {
  test.each([
    ['a constant altitude', () => 120],
    ['an altitude that only wanders within a metre', (i: number) => 120 + 0.5 * Math.sin(i)],
  ])('%s gives all-zero bins', (_name, altitudeAt) => {
    const { summary } = summaryOf([{ seconds: 900, speed: 3, gradePct: 0 }])
    const stream = { ...summary.stream, alt: summary.stream.alt!.map((_, i) => altitudeAt(i)) }
    const bins = computeTerrainBins(stream, summary.stream.sampleSec)
    expect(sum(bins.sec)).toBe(0)
    expect(bins.flatCv).toBeNull()
  })

  test('an altitude spanning the minimum is read', () => {
    const { summary } = summaryOf([{ seconds: 900, speed: 3, gradePct: 0 }])
    const n = summary.stream.alt!.length
    const alt = summary.stream.alt!.map(
      (_, i) => 100 + (i < n / 2 ? 0 : TERRAIN_MIN_ALTITUDE_RANGE_M),
    )
    const bins = computeTerrainBins({ ...summary.stream, alt }, summary.stream.sampleSec)
    expect(sum(bins.sec)).toBeGreaterThan(700)
  })
})

describe('flat speed variation', () => {
  test('is near zero for steady running and large for intervals', () => {
    const hill: Leg = { seconds: 120, speed: 3, gradePct: 5 }
    const steady = summaryOf([hill, { seconds: 1200, speed: 3, gradePct: 0 }]).summary
    const repeats: Leg[] = Array.from({ length: 12 }, () => [
      { seconds: 60, speed: 4.5, gradePct: 0 },
      { seconds: 40, speed: 2, gradePct: 0 },
    ]).flat()
    const intervals = summaryOf([hill, ...repeats]).summary
    const cv = (s: typeof steady) => computeTerrainBins(s.stream, s.stream.sampleSec).flatCv
    expect(cv(steady)).toBeLessThan(0.02)
    expect(cv(intervals)).toBeGreaterThan(0.25)
  })
})

describe('terrain bin settings', () => {
  test('the longest step is the gap summarize treats as a pause', () => {
    expect(TERRAIN_MAX_STEP_SEC).toBe(MAX_GAP_SEC)
  })

  test('the stopped speed is the one summarize uses for moving time', () => {
    expect(TERRAIN_STOPPED_MPS).toBe(MOVING_SPEED_MPS)
  })

  test('edges ascend and the flat band holds 0', () => {
    const edges = [...TERRAIN_EDGES_PCT]
    expect(edges).toEqual([...edges].sort((a, b) => a - b))
    expect(edges.filter((e) => e <= 0)).toHaveLength(FLAT)
  })

  test('only runs and races get bins', () => {
    expect(hasTerrainBins('run')).toBe(true)
    expect(hasTerrainBins('race')).toBe(true)
    expect(hasTerrainBins('strength')).toBe(false)
    expect(hasTerrainBins('cross')).toBe(false)
  })
})
