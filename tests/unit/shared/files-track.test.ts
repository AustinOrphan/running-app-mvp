import { describe, expect, test } from 'vitest'
import { parseActivityFile } from '../../../shared/importers/files/index.ts'
import {
  TRACK_MAX_POINTS,
  TRACK_TOLERANCE_M,
  buildTrack,
  decodePolyline,
  encodePolyline,
  hasTrack,
} from '../../../shared/importers/files/track.ts'
import { haversineM } from '../../../shared/importers/files/summarize.ts'
import { buildFit } from '../../fixtures/fit/buildFit.ts'
import { syntheticRun } from '../../fixtures/syntheticRoute.ts'

const OPTS = { timezone: 'UTC' }
const START = Date.UTC(2026, 0, 5, 7) / 1000

/** Distance in metres from a point to the nearest segment of a path (planar, small area). */
function offPathM(path: Array<[number, number]>, lat: number, lng: number): number {
  const k = Math.cos((lat * Math.PI) / 180)
  let best = Infinity
  for (let i = 0; i + 1 < path.length; i++) {
    const [aLat, aLng] = path[i]!
    const [bLat, bLng] = path[i + 1]!
    const ax = aLng * k * 111_320
    const ay = aLat * 111_320
    const bx = bLng * k * 111_320
    const by = bLat * 111_320
    const px = lng * k * 111_320
    const py = lat * 111_320
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2
    const u =
      len2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2))
    best = Math.min(best, Math.hypot(px - (ax + u * (bx - ax)), py - (ay + u * (by - ay))))
  }
  return best
}

describe('polyline', () => {
  test('matches the published example', () => {
    const pts: Array<[number, number]> = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(pts)
  })
})

describe('buildTrack', () => {
  test('a 3 h run keeps few points, within tolerance, under the cap', () => {
    const fixes = syntheticRun(3 * 3600)
    const track = buildTrack(fixes.map((f) => ({ lat: f.lat, lng: f.lng, d: f.distanceM })))!
    expect(track.pointCount).toBeLessThanOrEqual(TRACK_MAX_POINTS)
    expect(track.pointCount).toBeLessThan(fixes.length / 4)
    expect(track.toleranceM).toBe(TRACK_TOLERANCE_M)
    const path = decodePolyline(track.polyline)
    expect(path).toHaveLength(track.pointCount)
    expect(track.distM).toHaveLength(track.pointCount)
    expect(track.distM[0]).toBe(0)
    expect(track.distM[track.distM.length - 1]).toBe(Math.round(fixes[fixes.length - 1]!.distanceM))
    for (let i = 1; i < track.distM.length; i++) {
      expect(track.distM[i]!).toBeGreaterThanOrEqual(track.distM[i - 1]!)
    }
    // Every recorded fix lies within the tolerance (plus the 1 m of rounding) of the kept path.
    for (const f of fixes.filter((_, i) => i % 50 === 0)) {
      expect(offPathM(path, f.lat, f.lng)).toBeLessThan(TRACK_TOLERANCE_M + 1.5)
    }
    expect(track.bbox.minLat).toBeLessThanOrEqual(track.bbox.maxLat)
  })

  test('widens the tolerance when the cap would be exceeded', () => {
    // A zigzag of 6000 points, each 20 m off the line, cannot fit 2000 points at 5 m.
    const route = Array.from({ length: 6000 }, (_, i) => ({
      lat: 12 + i * 0.00002,
      lng: -45 + (i % 2) * 0.0002,
      d: null,
    }))
    const track = buildTrack(route)!
    expect(track.pointCount).toBeLessThanOrEqual(TRACK_MAX_POINTS)
    expect(track.toleranceM).toBeGreaterThan(TRACK_TOLERANCE_M)
  })

  test('derives distance from the path when the source has none', () => {
    const track = buildTrack([
      { lat: 12, lng: -45, d: null },
      { lat: 12.001, lng: -45, d: null },
    ])!
    expect(track.distM[1]).toBe(Math.round(haversineM(12, -45, 12.001, -45)))
  })

  test('returns null for no positions, a single one, a stand-still or null island', () => {
    expect(buildTrack([])).toBeNull()
    expect(buildTrack([{ lat: 12, lng: -45, d: 0 }])).toBeNull()
    expect(
      buildTrack([
        { lat: 12, lng: -45, d: 0 },
        { lat: 12, lng: -45, d: 0 },
      ]),
    ).toBeNull()
    expect(
      buildTrack([
        { lat: 0, lng: 0, d: 0 },
        { lat: 0, lng: 0, d: 10 },
      ]),
    ).toBeNull()
  })

  test('hasTrack excludes treadmill runs and other sports', () => {
    expect(hasTrack('run', null)).toBe(true)
    expect(hasTrack('race', 'road')).toBe(true)
    expect(hasTrack('run', 'treadmill')).toBe(false)
    expect(hasTrack('cross', 'bike')).toBe(false)
  })
})

describe('route extraction', () => {
  const fixes = syntheticRun(600)

  test('FIT: position_lat and position_long become degrees', () => {
    const bytes = buildFit({
      sessions: [
        {
          sport: 1,
          startUnix: START,
          durationSec: 600,
          records: fixes.map((f) => ({ t: f.t, lat: f.lat, lng: f.lng, distanceM: f.distanceM })),
        },
      ],
    })
    const [a] = parseActivityFile('run.fit', bytes, OPTS)
    expect(a!.route).toHaveLength(600)
    expect(a!.route![100]!.lat).toBeCloseTo(fixes[100]!.lat, 5)
    expect(a!.route![100]!.lng).toBeCloseTo(fixes[100]!.lng, 5)
    expect(a!.route![100]!.d).toBeCloseTo(fixes[100]!.distanceM, 0)
  })

  test('FIT without positions has no route', () => {
    const bytes = buildFit({
      sessions: [
        {
          sport: 1,
          subSport: 1,
          startUnix: START,
          durationSec: 60,
          records: [{ t: 0 }, { t: 60 }],
        },
      ],
    })
    expect(parseActivityFile('tm.fit', bytes, OPTS)[0]!.route ?? null).toBeNull()
  })

  test('GPX: trkpt lat and lon', () => {
    const pts = fixes
      .slice(0, 100)
      .map(
        (f) =>
          `<trkpt lat="${f.lat.toFixed(6)}" lon="${f.lng.toFixed(6)}"><time>2026-01-05T07:${String(Math.floor(f.t / 60)).padStart(2, '0')}:${String(f.t % 60).padStart(2, '0')}Z</time></trkpt>`,
      )
      .join('')
    const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="Example"><trk><trkseg>${pts}</trkseg></trk></gpx>`
    const [a] = parseActivityFile('run.gpx', new TextEncoder().encode(gpx), OPTS)
    expect(a!.route).toHaveLength(100)
    expect(a!.route![50]!.lat).toBeCloseTo(fixes[50]!.lat, 5)
    expect(a!.route![99]!.d).toBeGreaterThan(200)
  })

  test('TCX: Position', () => {
    const pts = fixes
      .slice(0, 100)
      .map(
        (f) =>
          `<Trackpoint><Time>2026-01-05T07:${String(Math.floor(f.t / 60)).padStart(2, '0')}:${String(f.t % 60).padStart(2, '0')}Z</Time><Position><LatitudeDegrees>${f.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${f.lng.toFixed(6)}</LongitudeDegrees></Position><DistanceMeters>${f.distanceM.toFixed(1)}</DistanceMeters></Trackpoint>`,
      )
      .join('')
    const tcx = `<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-01-05T07:00:00Z</Id><Lap StartTime="2026-01-05T07:00:00Z"><TotalTimeSeconds>100</TotalTimeSeconds><Track>${pts}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`
    const [a] = parseActivityFile('run.tcx', new TextEncoder().encode(tcx), OPTS)
    expect(a!.route).toHaveLength(100)
    expect(a!.route![10]!.lng).toBeCloseTo(fixes[10]!.lng, 5)
    expect(a!.route![10]!.d).toBeCloseTo(fixes[10]!.distanceM, 0)
  })
})
