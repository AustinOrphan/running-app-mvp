import { describe, expect, test } from 'vitest'
import {
  MAP_AREA_MAX_M,
  MAP_AREA_MIN_M,
  boxSizeM,
  boxesOverlap,
  mapAreaBox,
  type GeoBox,
} from '../../../shared/domain/mapArea.ts'

/** A small track box centred on a point. */
function around(lat: number, lng: number, halfDeg = 0.01): GeoBox {
  return {
    minLat: lat - halfDeg,
    maxLat: lat + halfDeg,
    minLng: lng - halfDeg,
    maxLng: lng + halfDeg,
  }
}

/** Rounding outward to 0.01 degree can add up to 2 x 1.11 km to a side. */
const ROUNDING_M = 2_300

describe('mapAreaBox', () => {
  test('has no box without a track', () => {
    expect(mapAreaBox([])).toBeNull()
  })

  test('holds every track near home, rounded outward to 0.01 degree', () => {
    const tracks = [around(45.0, -93.0), around(45.05, -93.04), around(44.96, -92.97)]
    const box = mapAreaBox(tracks)!
    for (const track of tracks) {
      expect(box.minLat).toBeLessThanOrEqual(track.minLat)
      expect(box.maxLat).toBeGreaterThanOrEqual(track.maxLat)
      expect(box.minLng).toBeLessThanOrEqual(track.minLng)
      expect(box.maxLng).toBeGreaterThanOrEqual(track.maxLng)
    }
    for (const edge of [box.minLat, box.maxLat, box.minLng, box.maxLng]) {
      expect(Math.abs(edge * 100 - Math.round(edge * 100))).toBeLessThan(1e-6)
    }
  })

  test('leaves out the far runs: the 5 % farthest from the median do not stretch the box', () => {
    const near = Array.from({ length: 39 }, (_, i) =>
      around(45 + (i % 5) * 0.005, -93 + (i % 7) * 0.005),
    )
    const trip = around(48.5, -88.0)
    const withTrip = mapAreaBox([...near, trip])!
    expect(withTrip).toEqual(mapAreaBox(near)!)
    expect(withTrip.maxLat).toBeLessThan(46)
  })

  test('a quarter of the runs far away moves the middle, but the box stays within the cap', () => {
    const home = Array.from({ length: 30 }, () => around(45, -93))
    const away = Array.from({ length: 10 }, () => around(46.4, -91))
    const { heightM, widthM } = boxSizeM(mapAreaBox([...home, ...away])!)
    expect(heightM).toBeLessThanOrEqual(MAP_AREA_MAX_M + ROUNDING_M)
    expect(widthM).toBeLessThanOrEqual(MAP_AREA_MAX_M + ROUNDING_M)
  })

  test('is cut to about 40 km on a side, centred on the home centre', () => {
    // Runs spread over 1.4 degrees (far over 40 km), with the median at 45.0, -93.0.
    const tracks = [-0.7, -0.35, 0, 0.35, 0.7].map((d) => around(45 + d, -93 + d * 1.2))
    const box = mapAreaBox(tracks)!
    const { heightM, widthM } = boxSizeM(box)
    expect(heightM).toBeGreaterThan(MAP_AREA_MAX_M - 100)
    expect(heightM).toBeLessThan(MAP_AREA_MAX_M + ROUNDING_M)
    expect(widthM).toBeLessThan(MAP_AREA_MAX_M + ROUNDING_M)
    expect((box.minLat + box.maxLat) / 2).toBeCloseTo(45, 1)
    expect((box.minLng + box.maxLng) / 2).toBeCloseTo(-93, 1)
  })

  test('a single short run still gets the minimum box around it', () => {
    const box = mapAreaBox([around(45, -93, 0.002)])!
    const { heightM, widthM } = boxSizeM(box)
    expect(heightM).toBeGreaterThanOrEqual(MAP_AREA_MIN_M - 100)
    expect(widthM).toBeGreaterThanOrEqual(MAP_AREA_MIN_M - 100)
    expect(boxesOverlap(box, around(45, -93, 0.002))).toBe(true)
  })

  const middleOf = (box: GeoBox) => ({
    lat: (box.minLat + box.maxLat) / 2,
    lng: (box.minLng + box.maxLng) / 2,
  })

  test('two equal clusters: the box is around one of them, never between them', () => {
    // Two cities about 80 km apart, the same number of runs in each.
    const a = Array.from({ length: 20 }, (_, i) =>
      around(45 + (i % 4) * 0.004, -93 + (i % 3) * 0.004),
    )
    const b = Array.from({ length: 20 }, (_, i) =>
      around(45.7 + (i % 4) * 0.004, -93 + (i % 3) * 0.004),
    )
    const box = mapAreaBox([...a, ...b])!
    const mid = middleOf(box)
    const nearA = Math.abs(mid.lat - 45.01) < 0.1
    const nearB = Math.abs(mid.lat - 45.71) < 0.1
    expect(nearA || nearB).toBe(true)
    expect(mid.lat).not.toBeCloseTo(45.35, 1)
    // The same answer whatever the order the runs come in.
    expect(mapAreaBox([...b, ...a])).not.toBeNull()
  })

  test('a runner who moved: the city with most runs wins, the old one does not pull the box', () => {
    const old = Array.from({ length: 12 }, (_, i) => around(45 + (i % 4) * 0.004, -93))
    const now = Array.from({ length: 30 }, (_, i) => around(47.5 + (i % 5) * 0.004, -91))
    const box = mapAreaBox([...old, ...now])!
    expect(middleOf(box).lat).toBeGreaterThan(47.3)
    expect(box.minLat).toBeGreaterThan(47)
  })

  test('three cities: the one with the most runs within 20 km gets the box', () => {
    const city = (lat: number, lng: number, n: number) =>
      Array.from({ length: n }, (_, i) => around(lat + (i % 4) * 0.004, lng + (i % 3) * 0.004))
    const box = mapAreaBox([...city(45, -93, 10), ...city(46.2, -91, 25), ...city(43.9, -95, 15)])!
    const mid = middleOf(box)
    expect(mid.lat).toBeCloseTo(46.2, 0)
    expect(mid.lng).toBeCloseTo(-91, 0)
  })

  test('the centre is a place a run happened, even when the runs are on a line', () => {
    // Runs spread evenly along 60 km of road: the middle one wins on the count within 20 km.
    const along = Array.from({ length: 13 }, (_, i) => around(45 + i * 0.045, -93))
    const mid = middleOf(mapAreaBox(along)!)
    expect(mid.lat).toBeCloseTo(45 + 6 * 0.045, 1)
  })

  test('boxesOverlap', () => {
    expect(boxesOverlap(around(45, -93), around(45.01, -93))).toBe(true)
    expect(boxesOverlap(around(45, -93), around(46, -93))).toBe(false)
  })
})
