// Synthetic OpenStreetMap data and routes for the trail and road tests (M1d). Nothing here comes
// from a real place: the origin is an arbitrary point, the ways are straight lines and a lattice.
import type { RoutePoint } from '../../shared/importers/files/track.ts'

export const ORIGIN = { lat: 45.0, lng: -93.0 }
const M_PER_DEG_LAT = 111_320

/** A position `eastM` metres east and `northM` metres north of the origin. */
export function at(eastM: number, northM: number): { lat: number; lng: number } {
  return {
    lat: ORIGIN.lat + northM / M_PER_DEG_LAT,
    lng: ORIGIN.lng + eastM / (M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  }
}

/** A recorded route along a straight line, one fix every `stepM` metres, with device distance. */
export function line(
  from: [number, number],
  to: [number, number],
  stepM = 5,
  startD = 0,
): RoutePoint[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const n = Math.max(1, Math.round(length / stepM))
  const points: RoutePoint[] = []
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const p = at(from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f)
    points.push({ ...p, d: startD + length * f, t: Math.round(startD + length * f) })
  }
  return points
}

export interface FakeWay {
  id: number
  tags: Record<string, string>
  /** `[eastM, northM]` pairs from the origin. */
  at: ReadonlyArray<readonly [number, number]>
}

export function overpassWay(way: FakeWay) {
  return {
    type: 'way',
    id: way.id,
    bounds: {},
    nodes: [],
    geometry: way.at.map(([e, n]) => {
      const p = at(e, n)
      return { lat: p.lat, lon: p.lng }
    }),
    tags: way.tags,
  }
}

/** The body of an Overpass `out tags geom` answer. */
export function overpassAnswer(
  ways: readonly FakeWay[],
  opts: { timestamp?: string; remark?: string } = {},
) {
  return {
    version: 0.6,
    generator: 'Overpass API (synthetic)',
    osm3s: {
      timestamp_osm_base: opts.timestamp ?? '2026-11-08T09:00:00Z',
      copyright: 'The data included in this document is from www.openstreetmap.org.',
    },
    ...(opts.remark === undefined ? {} : { remark: opts.remark }),
    elements: ways.map(overpassWay),
  }
}

/** Three parallel east-west ways at north 0 (trail), 200 (road) and 400 (paved path), 2 km long. */
export function threeWays(): FakeWay[] {
  return [
    {
      id: 1,
      tags: { highway: 'path' },
      at: [
        [-1000, 0],
        [1000, 0],
      ],
    },
    {
      id: 2,
      tags: { highway: 'residential', name: 'Synthetic Street' },
      at: [
        [-1000, 200],
        [1000, 200],
      ],
    },
    {
      id: 3,
      tags: { highway: 'cycleway', surface: 'asphalt' },
      at: [
        [-1000, 400],
        [1000, 400],
      ],
    },
  ]
}

/**
 * `count` ways laid out as a street lattice of gently curving blocks with realistic tags, to measure
 * what a download costs to store. Deterministic.
 */
export function syntheticStreets(count: number): FakeWay[] {
  const ways: FakeWay[] = []
  const kinds: Array<Record<string, string>> = [
    { highway: 'residential', surface: 'asphalt', name: 'Synthetic Street' },
    { highway: 'residential' },
    { highway: 'service' },
    { highway: 'footway', footway: 'sidewalk' },
    { highway: 'path', surface: 'dirt' },
    { highway: 'track', tracktype: 'grade3' },
    { highway: 'cycleway', surface: 'asphalt' },
    { highway: 'tertiary', surface: 'asphalt', lanes: '2' },
  ]
  const side = Math.ceil(Math.sqrt(count))
  let seed = 12345
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  for (let i = 0; i < count; i++) {
    const gx = (i % side) * 120 - (side * 120) / 2
    const gy = Math.floor(i / side) * 120 - (side * 120) / 2
    const vertical = i % 2 === 0
    const pts: Array<[number, number]> = []
    const nodes = 6 + Math.floor(rand() * 10)
    for (let k = 0; k < nodes; k++) {
      const along = (k / (nodes - 1)) * 110
      // A bend of up to 12 m over the block, plus a little survey noise.
      const wobble = 12 * Math.sin((along / 110) * Math.PI * 1.5 + rand()) + (rand() - 0.5) * 2
      pts.push(vertical ? [gx + wobble, gy + along] : [gx + along, gy + wobble])
    }
    ways.push({ id: 1000 + i, tags: kinds[i % kinds.length]!, at: pts })
  }
  return ways
}
