// Matching a run's stored track to the ways of the downloaded map area (M1d): each stretch of the
// track takes the class of the nearest way within `MATCH_RADIUS_M`; a stretch with none, or outside
// the area, is `unknown`. Pure: no I/O, so the server job and the tests use the same function.
import { decodePolyline } from '../importers/files/track.ts'
import type { SurfaceBins } from '../types.ts'
import type { GeoBox } from './mapArea.ts'
import { SURFACE_VERSION, type WayClass } from './surface.ts'

/** How far from a way a stretch of the track may be and still be on it. */
export const MATCH_RADIUS_M = 25
/** The track is sampled at most this far apart (metres), so a short way is not stepped over. */
export const MATCH_STEP_M = 10
/** Side of a cell of the spatial grid, and the longest piece a segment is cut into (metres). */
const CELL_M = 50

const M_PER_DEG_LAT = 111_320
const CLASS_ORDER: readonly WayClass[] = ['trail', 'paved', 'road', 'unknown']

export interface IndexedWay {
  cls: WayClass
  /** `[lat, lng]` pairs. */
  points: ReadonlyArray<readonly [number, number]>
}

/** A grid over the area's ways: a nearest-way query looks at nine cells. */
export interface WayIndex {
  readonly box: GeoBox
  /** The number of segment pieces indexed. */
  readonly pieces: number
  /** Class of the nearest way within `MATCH_RADIUS_M` of a position, or null. */
  nearest(lat: number, lng: number): WayClass | null
}

function cellKey(cx: number, cy: number): number {
  return (cx + 4096) * 16384 + (cy + 4096)
}

/** Builds the grid for `ways` inside `box`; positions are projected around the middle of the box. */
export function buildWayIndex(ways: Iterable<IndexedWay>, box: GeoBox): WayIndex {
  const lat0 = (box.minLat + box.maxLat) / 2
  const lng0 = (box.minLng + box.maxLng) / 2
  const mLng = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)
  const px = (lng: number) => (lng - lng0) * mLng
  const py = (lat: number) => (lat - lat0) * M_PER_DEG_LAT

  const ax: number[] = []
  const ay: number[] = []
  const bx: number[] = []
  const by: number[] = []
  const cls: number[] = []
  const cells = new Map<number, number[]>()

  function addPiece(x1: number, y1: number, x2: number, y2: number, c: number): void {
    const id = ax.length
    ax.push(x1)
    ay.push(y1)
    bx.push(x2)
    by.push(y2)
    cls.push(c)
    const c1x = Math.floor(Math.min(x1, x2) / CELL_M)
    const c2x = Math.floor(Math.max(x1, x2) / CELL_M)
    const c1y = Math.floor(Math.min(y1, y2) / CELL_M)
    const c2y = Math.floor(Math.max(y1, y2) / CELL_M)
    for (let cx = c1x; cx <= c2x; cx++) {
      for (let cy = c1y; cy <= c2y; cy++) {
        const key = cellKey(cx, cy)
        const list = cells.get(key)
        if (list) list.push(id)
        else cells.set(key, [id])
      }
    }
  }

  for (const way of ways) {
    const c = CLASS_ORDER.indexOf(way.cls)
    for (let i = 1; i < way.points.length; i++) {
      const x1 = px(way.points[i - 1]![1])
      const y1 = py(way.points[i - 1]![0])
      const x2 = px(way.points[i]![1])
      const y2 = py(way.points[i]![0])
      const parts = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / CELL_M))
      for (let k = 0; k < parts; k++) {
        const f0 = k / parts
        const f1 = (k + 1) / parts
        addPiece(
          x1 + (x2 - x1) * f0,
          y1 + (y2 - y1) * f0,
          x1 + (x2 - x1) * f1,
          y1 + (y2 - y1) * f1,
          c,
        )
      }
    }
  }

  return {
    box,
    pieces: ax.length,
    nearest(lat, lng) {
      const x = px(lng)
      const y = py(lat)
      const cx = Math.floor(x / CELL_M)
      const cy = Math.floor(y / CELL_M)
      let best = MATCH_RADIUS_M * MATCH_RADIUS_M
      let found = -1
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = cells.get(cellKey(cx + dx, cy + dy))
          if (!list) continue
          for (const id of list) {
            const sx = bx[id]! - ax[id]!
            const sy = by[id]! - ay[id]!
            const lenSq = sx * sx + sy * sy
            const t =
              lenSq === 0
                ? 0
                : Math.max(0, Math.min(1, ((x - ax[id]!) * sx + (y - ay[id]!) * sy) / lenSq))
            const ex = x - (ax[id]! + t * sx)
            const ey = y - (ay[id]! + t * sy)
            const d = ex * ex + ey * ey
            if (d < best) {
              best = d
              found = id
            }
          }
        }
      }
      return found < 0 ? null : CLASS_ORDER[cls[found]!]!
    },
  }
}

/** The part of a stored track the matcher reads. */
export interface MatchableTrack {
  polyline: string
  /** Cumulative metres at each point of the polyline. */
  distM: ReadonlyArray<number>
}

/** Whole metres for four shares of `total`, summing to `total` (largest remainder). */
function wholeMetres(parts: readonly number[], total: number): number[] {
  const target = Math.round(total)
  const floors = parts.map((p) => Math.floor(p))
  let missing = target - floors.reduce((a, b) => a + b, 0)
  const order = parts
    .map((p, i) => ({ i, rest: p - Math.floor(p) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (let k = 0; missing > 0 && order.length > 0; k = (k + 1) % order.length, missing--) {
    floors[order[k]!.i]! += 1
  }
  return floors
}

function inside(box: GeoBox, lat: number, lng: number): boolean {
  return lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng
}

/**
 * The metres of a track on each class. Every segment between two kept points is cut into pieces of
 * at most `MATCH_STEP_M`; each piece takes the class of the way nearest its middle, or `unknown`
 * outside the area or with no way within `MATCH_RADIUS_M`. The track's recorded metres are what is
 * shared out (the last of `distM`), and the four figures are whole metres that add up to them. Throws
 * when the polyline and the distances disagree, so the caller can report an unreadable track.
 */
export function surfaceBinsOf(track: MatchableTrack, index: WayIndex): SurfaceBins {
  const points = decodePolyline(track.polyline)
  if (points.length !== track.distM.length) throw new Error('The track is unreadable.')
  const sums = { trail: 0, paved: 0, road: 0, unknown: 0 }
  for (let i = 1; i < points.length; i++) {
    const [lat1, lng1] = points[i - 1]!
    const [lat2, lng2] = points[i]!
    const metres = Math.max(0, track.distM[i]! - track.distM[i - 1]!)
    if (metres === 0) continue
    const mLng = M_PER_DEG_LAT * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
    const geom = Math.hypot((lat2 - lat1) * M_PER_DEG_LAT, (lng2 - lng1) * mLng)
    const n = Math.max(1, Math.ceil(Math.max(geom, 0) / MATCH_STEP_M))
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n
      const lat = lat1 + (lat2 - lat1) * f
      const lng = lng1 + (lng2 - lng1) * f
      const cls = inside(index.box, lat, lng) ? index.nearest(lat, lng) : null
      sums[cls ?? 'unknown'] += metres / n
    }
  }
  const total = sums.trail + sums.paved + sums.road + sums.unknown
  const [trailM, pavedM, roadM, unknownM] = wholeMetres(
    [sums.trail, sums.paved, sums.road, sums.unknown],
    total,
  ) as [number, number, number, number]
  return { v: SURFACE_VERSION, trailM, pavedM, roadM, unknownM }
}

/** An empty result, for a track that could not be read. */
export function emptySurfaceBins(): SurfaceBins {
  return { v: SURFACE_VERSION, trailM: 0, pavedM: 0, roadM: 0, unknownM: 0 }
}
