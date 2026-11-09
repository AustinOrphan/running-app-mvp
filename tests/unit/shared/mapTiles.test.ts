import { describe, expect, test } from 'vitest'
import {
  fitZoom,
  metresPerPixel,
  pointAtDistance,
  project,
  scaleBar,
  tileOf,
  tilesFor,
  tileUrl,
  toBox,
  viewFor,
  wrapTileX,
  type Bbox,
} from '../../../shared/domain/mapTiles.ts'

describe('project and tileOf', () => {
  test('the origin of the world is its middle', () => {
    const p = project(0, 0, 0)
    expect(p.x).toBeCloseTo(128, 6)
    expect(p.y).toBeCloseTo(128, 6)
  })

  test('the pixel doubles with each zoom level', () => {
    const a = project(12.3456, -45.6789, 10)
    const b = project(12.3456, -45.6789, 11)
    expect(b.x).toBeCloseTo(a.x * 2, 6)
    expect(b.y).toBeCloseTo(a.y * 2, 6)
  })

  test('matches the slippy-map wiki example (Berlin-ish at zoom 10 is tile 550/335)', () => {
    expect(tileOf(52.52, 13.405, 10)).toEqual({ x: 550, y: 335 })
  })

  test('clamps a latitude beyond the Mercator square', () => {
    expect(project(89.9, 0, 3).y).toBeCloseTo(0, 3)
    expect(Number.isFinite(project(-90, 0, 3).y)).toBe(true)
  })
})

describe('fitZoom', () => {
  const bbox: Bbox = { minLat: 12.34, minLng: -45.69, maxLat: 12.35, maxLng: -45.67 }

  test('fits the bbox inside the box with the padding left over', () => {
    const z = fitZoom(bbox, 360, 240, 16)
    const a = project(bbox.maxLat, bbox.minLng, z)
    const b = project(bbox.minLat, bbox.maxLng, z)
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)
    expect(w).toBeLessThanOrEqual(360 - 32 + 1e-6)
    expect(h).toBeLessThanOrEqual(240 - 32 + 1e-6)
    // and one of the two axes is exactly full
    expect(Math.max(w / (360 - 32), h / (240 - 32))).toBeCloseTo(1, 6)
  })

  test('a taller box lets a wide bbox zoom no further than its width allows', () => {
    const wide: Bbox = { minLat: 12.3, minLng: -45.8, maxLat: 12.301, maxLng: -45.6 }
    expect(fitZoom(wide, 360, 600)).toBeCloseTo(fitZoom(wide, 360, 240), 6)
  })

  test('a point, or a path under a street long, takes the cap', () => {
    const point: Bbox = { minLat: 1, minLng: 1, maxLat: 1, maxLng: 1 }
    expect(fitZoom(point, 360, 240)).toBe(17)
    expect(fitZoom(point, 360, 240, 0, 15)).toBe(15)
  })

  test('a whole-world bbox does not go below zoom 0', () => {
    const world: Bbox = { minLat: -80, minLng: -180, maxLat: 80, maxLng: 180 }
    expect(fitZoom(world, 100, 100)).toBe(0)
  })
})

describe('viewFor and tilesFor', () => {
  const bbox: Bbox = { minLat: 12.34, minLng: -45.69, maxLat: 12.35, maxLng: -45.67 }

  test('centres the bbox in the box', () => {
    const view = viewFor(bbox, 360, 240, { padding: 16 })
    const a = toBox(view, bbox.maxLat, bbox.minLng)
    const b = toBox(view, bbox.minLat, bbox.maxLng)
    expect((a.x + b.x) / 2).toBeCloseTo(180, 6)
    expect((a.y + b.y) / 2).toBeCloseTo(120, 6)
  })

  test('keeps the route out of a padded band: a taller bottom inset leaves it clear', () => {
    const pad = { top: 16, right: 16, bottom: 56, left: 16 }
    const view = viewFor(bbox, 360, 240, { padding: pad })
    const a = toBox(view, bbox.maxLat, bbox.minLng)
    const b = toBox(view, bbox.minLat, bbox.maxLng)
    expect(Math.min(a.y, b.y)).toBeGreaterThanOrEqual(pad.top - 1e-6)
    expect(Math.max(a.y, b.y)).toBeLessThanOrEqual(240 - pad.bottom + 1e-6)
    expect(Math.min(a.x, b.x)).toBeGreaterThanOrEqual(pad.left - 1e-6)
    expect(Math.max(a.x, b.x)).toBeLessThanOrEqual(360 - pad.right + 1e-6)
    // centred in what is left, and a number still means the same on every side
    expect((a.y + b.y) / 2).toBeCloseTo(16 + (240 - 16 - 56) / 2, 6)
    expect(fitZoom(bbox, 360, 240, 16)).toBeCloseTo(
      fitZoom(bbox, 360, 240, { top: 16, right: 16, bottom: 16, left: 16 }),
      9,
    )
  })

  test('uses tiles one zoom deeper on a high-density screen, drawn at the same size', () => {
    const low = viewFor(bbox, 360, 240, { density: 1 })
    const high = viewFor(bbox, 360, 240, { density: 2 })
    expect(high.zoom).toBeCloseTo(low.zoom, 9)
    expect(high.tileZoom).toBe(low.tileZoom + 1)
    expect(high.tileCss).toBeCloseTo(low.tileCss / 2, 9)
  })

  test('the tiles cover the box with no gap and no overlap', () => {
    for (const density of [1, 2]) {
      const view = viewFor(bbox, 360, 240, { padding: 16, density })
      const tiles = tilesFor(view)
      expect(tiles.length).toBeGreaterThan(0)
      const left = Math.min(...tiles.map((t) => t.left))
      const top = Math.min(...tiles.map((t) => t.top))
      const right = Math.max(...tiles.map((t) => t.left + t.width))
      const bottom = Math.max(...tiles.map((t) => t.top + t.height))
      expect(left).toBeLessThanOrEqual(0)
      expect(top).toBeLessThanOrEqual(0)
      expect(right).toBeGreaterThanOrEqual(360)
      expect(bottom).toBeGreaterThanOrEqual(240)
      // each tile starts where the one before it in its row ends, and the same down a column
      for (const t of tiles) {
        const row = tiles.filter((o) => o.top === t.top && o.left >= t.left + t.width)
        if (row.length > 0) expect(Math.min(...row.map((o) => o.left))).toBe(t.left + t.width)
        const column = tiles.filter((o) => o.left === t.left && o.top >= t.top + t.height)
        if (column.length > 0) expect(Math.min(...column.map((o) => o.top))).toBe(t.top + t.height)
      }
    }
  })

  test('the tile under a position is one of the tiles, at the pixel the projection gives', () => {
    const view = viewFor(bbox, 360, 240, { density: 1 })
    const where = toBox(view, 12.345, -45.68)
    const hit = tilesFor(view).find(
      (t) =>
        where.x >= t.left &&
        where.x < t.left + t.width &&
        where.y >= t.top &&
        where.y < t.top + t.height,
    )
    const expected = tileOf(12.345, -45.68, view.tileZoom)
    expect(hit).toMatchObject({ x: expected.x, y: expected.y, z: view.tileZoom })
  })

  test('addresses the tile server', () => {
    expect(tileUrl({ z: 12, x: 3, y: 4 })).toBe('https://tile.openstreetmap.org/12/3/4.png')
  })
})

describe('the antimeridian', () => {
  // M1a unwraps longitudes, so a run across 180 has a bbox such as 179.99 to 180.02.
  const bbox: Bbox = { minLat: 64.0, minLng: 179.99, maxLat: 64.01, maxLng: 180.02 }

  test('the bbox has a positive extent and fits like any other', () => {
    const z = fitZoom(bbox, 360, 240, 16)
    expect(z).toBeGreaterThan(10)
    expect(z).toBeLessThan(17)
  })

  test('the tile columns past the edge wrap to the start of the world', () => {
    const view = viewFor(bbox, 360, 240, { padding: 16 })
    const tiles = tilesFor(view)
    const n = 2 ** view.tileZoom
    expect(tiles.every((t) => t.x >= 0 && t.x < n)).toBe(true)
    // both sides of the line are drawn: the last column and column 0
    expect(tiles.some((t) => t.x === n - 1)).toBe(true)
    expect(tiles.some((t) => t.x === 0)).toBe(true)
    // and they sit side by side in the box
    const east = tiles.find((t) => t.x === n - 1)!
    const west = tiles.find((t) => t.x === 0 && t.y === east.y)!
    expect(west.left).toBe(east.left + east.width)
  })

  test('positions on both sides of the line are next to each other in the box', () => {
    const view = viewFor(bbox, 360, 240, { padding: 16 })
    const before = toBox(view, 64.005, 179.999)
    const after = toBox(view, 64.005, 180.001)
    expect(after.x).toBeGreaterThan(before.x)
    expect(after.x - before.x).toBeLessThan(30)
  })

  test('wrapTileX wraps both ways', () => {
    expect(wrapTileX(1024, 10)).toBe(0)
    expect(wrapTileX(1026, 10)).toBe(2)
    expect(wrapTileX(-1, 10)).toBe(1023)
  })
})

describe('scaleBar', () => {
  test('is about 111 m per pixel at zoom 0 on the equator scale of 156 km', () => {
    const view = viewFor({ minLat: 0, minLng: 0, maxLat: 0, maxLng: 0 }, 100, 100, { maxZoom: 0 })
    expect(metresPerPixel(view)).toBeCloseTo(156_543, -1)
  })

  test('picks the longest round metric step that fits', () => {
    // 2 m per pixel: 100 m is 50 px, 200 m is 100 px
    expect(scaleBar(2, 'km', 120)).toEqual({ label: '200 m', px: 100 })
    expect(scaleBar(2, 'km', 99)).toEqual({ label: '100 m', px: 50 })
  })

  test('crosses into kilometres', () => {
    expect(scaleBar(20, 'km', 120)).toEqual({ label: '2 km', px: 100 })
  })

  test('measures in feet and miles for a runner in miles', () => {
    const feet = scaleBar(0.3048, 'mi', 120)
    expect(feet?.label).toBe('100 ft')
    expect(feet?.px).toBeCloseTo(100, 6)
    const miles = scaleBar(10, 'mi', 120)
    expect(miles?.label).toBe('0.5 mi')
    expect(miles?.px).toBeCloseTo(80.4672, 3)
  })

  test('gives nothing when no step fits or the scale is unknown', () => {
    expect(scaleBar(0.01, 'km', 5)).toBeNull()
    expect(scaleBar(0, 'km', 100)).toBeNull()
  })
})

describe('pointAtDistance', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 20 },
  ]
  const dist = [200, 300, 500]

  test('interpolates between the two points around the distance', () => {
    expect(pointAtDistance(points, dist, 250)).toEqual({ x: 5, y: 0 })
    expect(pointAtDistance(points, dist, 400)).toEqual({ x: 10, y: 10 })
  })

  test('hits the points exactly', () => {
    expect(pointAtDistance(points, dist, 200)).toEqual({ x: 0, y: 0 })
    expect(pointAtDistance(points, dist, 300)).toEqual({ x: 10, y: 0 })
    expect(pointAtDistance(points, dist, 500)).toEqual({ x: 10, y: 20 })
  })

  test('is null outside the path, where the ends are hidden', () => {
    expect(pointAtDistance(points, dist, 199)).toBeNull()
    expect(pointAtDistance(points, dist, 501)).toBeNull()
    expect(pointAtDistance(points, dist, Number.NaN)).toBeNull()
  })

  test('a stopped stretch (equal distances) does not divide by zero', () => {
    const stopped = [
      { x: 0, y: 0 },
      { x: 4, y: 4 },
    ]
    expect(pointAtDistance(stopped, [100, 100], 100)).toEqual({ x: 0, y: 0 })
  })

  test('is null for mismatched or empty input', () => {
    expect(pointAtDistance([], [], 0)).toBeNull()
    expect(pointAtDistance(points, [1, 2], 1)).toBeNull()
  })
})
