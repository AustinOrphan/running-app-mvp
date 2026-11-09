import { describe, expect, test } from 'vitest'
import type { GeoBox } from '../../../shared/domain/mapArea.ts'
import { SURFACE_VERSION, type WayClass } from '../../../shared/domain/surface.ts'
import {
  buildWayIndex,
  emptySurfaceBins,
  surfaceBinsOf,
} from '../../../shared/domain/surfaceMatch.ts'
import { buildTrack } from '../../../shared/importers/files/track.ts'
import { at, line, threeWays, type FakeWay } from '../../fixtures/surface.ts'

const BOX: GeoBox = {
  minLat: at(0, -5000).lat,
  maxLat: at(0, 5000).lat,
  minLng: at(-5000, 0).lng,
  maxLng: at(5000, 0).lng,
}

function indexOf(ways: readonly FakeWay[], classes: WayClass[], box: GeoBox = BOX) {
  return buildWayIndex(
    ways.map((way, i) => ({
      cls: classes[i]!,
      points: way.at.map(([e, n]) => {
        const p = at(e, n)
        return [p.lat, p.lng] as const
      }),
    })),
    box,
  )
}

function trackOf(points: ReturnType<typeof line>) {
  const track = buildTrack(points)!
  return { polyline: track.polyline, distM: track.distM }
}

/** The trail at north 0, a road at 200 and a paved path at 400. */
const index = () => indexOf(threeWays(), ['trail', 'road', 'paved'])

describe('surfaceBinsOf', () => {
  test('a run along one way is all that class', () => {
    expect(surfaceBinsOf(trackOf(line([-500, 3], [500, 3])), index())).toMatchObject({
      trailM: 1000,
      pavedM: 0,
      roadM: 0,
      unknownM: 0,
    })
    expect(surfaceBinsOf(trackOf(line([-500, 198], [500, 198])), index())).toMatchObject({
      roadM: 1000,
      trailM: 0,
    })
    expect(surfaceBinsOf(trackOf(line([-500, 405], [500, 405])), index())).toMatchObject({
      pavedM: 1000,
    })
  })

  test('a run that switches ways is split where it switches, and the parts add up to its length', () => {
    // 600 m on the trail (north 0), a connector north to the road at 200, then 400 m along the road.
    const run = [
      ...line([-600, 0], [0, 0], 5, 0),
      ...line([0, 0], [0, 200], 5, 600).slice(1),
      ...line([0, 200], [400, 200], 5, 800).slice(1),
    ]
    const track = buildTrack(run)!
    const bins = surfaceBinsOf({ polyline: track.polyline, distM: track.distM }, index())
    const total = track.distM[track.distM.length - 1]! - track.distM[0]!
    expect(bins.trailM + bins.pavedM + bins.roadM + bins.unknownM).toBe(Math.round(total))
    expect(bins.trailM).toBeGreaterThan(560)
    expect(bins.trailM).toBeLessThan(680)
    expect(bins.roadM).toBeGreaterThan(380)
    // The connector is 200 m of open ground between the two ways: mostly unmatched.
    expect(bins.unknownM).toBeGreaterThan(100)
    expect(bins.pavedM).toBe(0)
  })

  test('a stretch 24 m from a way is matched, 60 m from it is unknown', () => {
    expect(surfaceBinsOf(trackOf(line([-300, 24], [300, 24])), index()).trailM).toBe(600)
    expect(surfaceBinsOf(trackOf(line([-300, 60], [300, 60])), index())).toMatchObject({
      trailM: 0,
      unknownM: 600,
    })
  })

  test('the nearest way wins where two are within reach', () => {
    const close = indexOf(
      [
        {
          id: 1,
          tags: {},
          at: [
            [-500, 0],
            [500, 0],
          ],
        },
        {
          id: 2,
          tags: {},
          at: [
            [-500, 20],
            [500, 20],
          ],
        },
      ],
      ['trail', 'road'],
    )
    expect(surfaceBinsOf(trackOf(line([-300, 6], [300, 6])), close)).toMatchObject({
      trailM: 600,
      roadM: 0,
    })
    expect(surfaceBinsOf(trackOf(line([-300, 14], [300, 14])), close)).toMatchObject({
      trailM: 0,
      roadM: 600,
    })
  })

  test('a way of class unknown claims the stretch, so a farther road does not', () => {
    const claimed = indexOf(
      [
        {
          id: 1,
          tags: {},
          at: [
            [-500, 0],
            [500, 0],
          ],
        },
        {
          id: 2,
          tags: {},
          at: [
            [-500, 20],
            [500, 20],
          ],
        },
      ],
      ['unknown', 'road'],
    )
    expect(surfaceBinsOf(trackOf(line([-300, 3], [300, 3])), claimed)).toMatchObject({
      unknownM: 600,
      roadM: 0,
    })
  })

  test('stretches outside the area are unknown, even with a way beside them', () => {
    const narrow: GeoBox = { ...BOX, maxLng: at(0, 0).lng }
    const bins = surfaceBinsOf(
      trackOf(line([-300, 3], [300, 3])),
      indexOf(threeWays(), ['trail', 'road', 'paved'], narrow),
    )
    expect(bins.trailM).toBe(300)
    expect(bins.unknownM).toBe(300)
  })

  test('finds a long diagonal way across many cells', () => {
    const diagonal = indexOf(
      [
        {
          id: 1,
          tags: {},
          at: [
            [-3000, -3000],
            [3000, 3000],
          ],
        },
      ],
      ['trail'],
    )
    const bins = surfaceBinsOf(trackOf(line([-2000, -2005], [2000, 1995])), diagonal)
    expect(bins.trailM).toBeGreaterThan(5600)
    expect(bins.unknownM).toBe(0)
  })

  test('the figures are whole metres that sum to the track length, whatever the split', () => {
    const track = buildTrack([
      ...line([-700, 0], [-100, 0], 7, 0),
      ...line([-100, 0], [-100, 200], 7, 600).slice(1),
      ...line([-100, 200], [650, 200], 7, 800).slice(1),
    ])!
    const bins = surfaceBinsOf({ polyline: track.polyline, distM: track.distM }, index())
    const total = track.distM[track.distM.length - 1]! - track.distM[0]!
    expect(Object.values(bins).every(Number.isInteger)).toBe(true)
    expect(bins.trailM + bins.pavedM + bins.roadM + bins.unknownM).toBe(Math.round(total))
    expect(bins.v).toBe(SURFACE_VERSION)
  })

  test('refuses a polyline and distances that disagree', () => {
    const track = trackOf(line([-300, 3], [300, 3]))
    expect(() => surfaceBinsOf({ ...track, distM: track.distM.slice(1) }, index())).toThrow()
  })

  test('an empty result is all zero', () => {
    expect(emptySurfaceBins()).toEqual({
      v: SURFACE_VERSION,
      trailM: 0,
      pavedM: 0,
      roadM: 0,
      unknownM: 0,
    })
  })
})
