import { describe, expect, test } from 'vitest'
import { parseFit } from '../../../shared/importers/files/fit.ts'
import { MOVING_SPEED_MPS, summarize } from '../../../shared/importers/files/summarize.ts'
import {
  TERRAIN_EDGES_PCT,
  TERRAIN_STOPPED_MPS,
  TERRAIN_WINDOW_M,
  computeTerrainBins,
  hasTerrainBins,
} from '../../../shared/importers/files/terrainBins.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { COURSE, courseFit } from '../../fixtures/fit/terrainCourse.ts'

// Band indexes for TERRAIN_EDGES_PCT = [-15, -10, -6, -3, 3, 6, 10, 15].
const DOWN_8 = 2
const FLAT = 4
const UP_8 = 6
const UP_20 = 8

function streamOf(withAltitude = true) {
  const [parsed] = parseFit(courseFit(COURSE, { withAltitude }), { timezone: 'UTC' })
  if (!parsed) throw new Error('expected one activity')
  return summarize(parsed).stream
}

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

describe('terrain bin settings', () => {
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
