import { describe, expect, test } from 'vitest'
import { GLYPH_BOX, GLYPH_MAX_POINTS, routeGlyph } from '../../../shared/domain/routeGlyph.ts'
import { buildTrack, type RoutePoint } from '../../../shared/importers/files/track.ts'

/** A route from points in metres east and north of an origin, one fix every 5 m of path. */
function route(
  metres: Array<[number, number]>,
  origin = { lat: 12.3456, lng: -45.6789 },
): RoutePoint[] {
  const mLat = 111_320
  const mLng = 111_320 * Math.max(0.01, Math.cos((origin.lat * Math.PI) / 180))
  const out: RoutePoint[] = []
  for (let i = 1; i < metres.length; i++) {
    const [x0, y0] = metres[i - 1]!
    const [x1, y1] = metres[i]!
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 5))
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      const f = s / steps
      out.push({
        lat: origin.lat + (y0 + (y1 - y0) * f) / mLat,
        lng: origin.lng + (x0 + (x1 - x0) * f) / mLng,
        d: null,
      })
    }
  }
  return out
}

function points(d: string): Array<[number, number]> {
  return [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
}

function loop(radius: number, n = 200): Array<[number, number]> {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * 2 * Math.PI
    return [radius * Math.cos(a), radius * Math.sin(a)] as [number, number]
  })
}

function glyphOf(
  metres: Array<[number, number]>,
  hideEnds: boolean,
  origin?: { lat: number; lng: number },
) {
  const track = buildTrack(route(metres, origin))
  expect(track).not.toBeNull()
  return routeGlyph(track!, hideEnds)
}

describe('routeGlyph', () => {
  test('a loop fits the box on its longer side, centred, with few points', () => {
    const glyph = glyphOf(loop(600), false)!
    const pts = points(glyph.d)
    expect(pts.length).toBeGreaterThan(8)
    expect(pts.length).toBeLessThanOrEqual(GLYPH_MAX_POINTS)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(GLYPH_BOX)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(95)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(95)
  })

  test('uses one scale on both axes: a wide route stays wide and is centred vertically', () => {
    const glyph = glyphOf(
      [
        [0, 0],
        [2000, 0],
        [2000, 500],
        [0, 500],
      ],
      false,
    )!
    const pts = points(glyph.d)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    expect(w).toBeCloseTo(100, 0)
    expect(h / w).toBeCloseTo(0.25, 1)
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(50, 0)
  })

  test('is north up: a route going north ends higher (smaller y) than it began', () => {
    const glyph = glyphOf(
      [
        [0, 0],
        [0, 1500],
      ],
      false,
    )!
    const pts = points(glyph.d)
    expect(pts[0]![1]).toBeGreaterThan(pts.at(-1)![1])
  })

  test('a straight out-and-back stays a line', () => {
    const glyph = glyphOf(
      [
        [0, 0],
        [2500, 0],
        [0, 0],
      ],
      false,
    )!
    const pts = points(glyph.d)
    expect(pts.length).toBeLessThanOrEqual(4)
    const ys = pts.map((p) => p[1])
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1)
    expect(Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]))).toBeCloseTo(
      100,
      0,
    )
  })

  test('a short run keeps its shape when the ends are shown', () => {
    const glyph = glyphOf(
      [
        [0, 0],
        [150, 0],
        [150, 100],
      ],
      false,
    )
    expect(glyph).not.toBeNull()
    expect(points(glyph!.d).length).toBeGreaterThanOrEqual(3)
  })

  test('a run too short to survive the trim has no glyph', () => {
    const track = buildTrack(
      route([
        [0, 0],
        [300, 0],
      ]),
    )
    expect(track).not.toBeNull()
    expect(routeGlyph(track!, true)).toBeNull()
    expect(routeGlyph(track!, false)).not.toBeNull()
  })

  test('a remnant under 100 m after the cut is not drawn', () => {
    const track = buildTrack(
      route([
        [0, 0],
        [460, 0],
      ]),
    )
    expect(track).not.toBeNull()
    expect(routeGlyph(track!, true)).toBeNull()
  })

  test('a single point or a standing track has no glyph', () => {
    expect(buildTrack([{ lat: 10, lng: 10, d: null }])).toBeNull()
    const track = buildTrack(
      route([
        [0, 0],
        [2000, 0],
      ]),
    )!
    const one = { ...track, polyline: track.polyline.slice(0, 4), pointCount: 1, distM: [0] }
    expect(routeGlyph(one, false)).toBeNull()
    expect(routeGlyph(one, true)).toBeNull()
  })

  test('the trim is honoured: the first and last 200 m are not in the glyph', () => {
    // 1,400 m out along x. Untrimmed spans 1,400 m; trimmed, 1,000 m, so the ratio of the glyph's
    // drawn extent to a path that is trimmed on the east only shows the cut at both ends.
    const metres: Array<[number, number]> = [
      [0, 0],
      [1400, 0],
      [1400, 1000],
    ]
    const trimmed = points(glyphOf(metres, true)!.d)
    const whole = points(glyphOf(metres, false)!.d)
    // Whole route is 1,400 x 1,000 (aspect 0.714); the trimmed one is 1,200 x 800 (0.667) or less.
    const aspect = (pts: Array<[number, number]>) => {
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      return (Math.max(...ys) - Math.min(...ys)) / (Math.max(...xs) - Math.min(...xs))
    }
    expect(aspect(whole)).toBeCloseTo(1000 / 1400, 2)
    expect(aspect(trimmed)).toBeCloseTo(800 / 1200, 2)
    expect(aspect(whole) - aspect(trimmed)).toBeGreaterThan(0.03)
    // The start corner (0, 0) of the whole route is the bottom-left; the trimmed glyph starts inside.
    expect(whole[0]![0]).toBeCloseTo(0, 0)
    expect(trimmed[0]![0]).toBeCloseTo(0, 0)
    expect(trimmed.length).toBeGreaterThanOrEqual(3)
  })

  test('the trimmed glyph is built only from the trimmed path', () => {
    // A spur out and back inside the first 200 m (a doorstep detour) must not show.
    const metres: Array<[number, number]> = [
      [0, 0],
      [0, 90],
      [0, 0],
      [1500, 0],
    ]
    const track = buildTrack(route(metres))!
    const pts = points(routeGlyph(track, true)!.d)
    const ys = pts.map((p) => p[1])
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1)
  })

  test('a run across the antimeridian is one continuous drawing', () => {
    const glyph = glyphOf(
      [
        [0, 0],
        [3000, 0],
        [3000, 1000],
      ],
      false,
      { lat: 10, lng: 179.98 },
    )!
    const pts = points(glyph.d)
    const xs = pts.map((p) => p[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 0)
  })

  test('near a pole it does not crash and stays inside the box', () => {
    const glyph = glyphOf(loop(500), false, { lat: 89.9, lng: 20 })
    expect(glyph).not.toBeNull()
    for (const [x, y] of points(glyph!.d)) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(GLYPH_BOX)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(GLYPH_BOX)
    }
  })

  test('a long wiggly route is cut to the point cap', () => {
    const wiggle: Array<[number, number]> = Array.from({ length: 400 }, (_, i) => [
      i * 20,
      150 * Math.sin(i / 3),
    ])
    const pts = points(glyphOf(wiggle, false)!.d)
    expect(pts.length).toBeLessThanOrEqual(GLYPH_MAX_POINTS)
    expect(pts.length).toBeGreaterThan(10)
  })
})
