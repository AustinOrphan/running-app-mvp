import { haversineM } from './summarize.ts'

/**
 * Route simplification for the run map (M1a). The tolerance and the cap are data preparation, not
 * engine Params: they decide how much of a recorded path is kept for drawing, and no training
 * decision reads them.
 */

/** Shape version of a stored track; a change to the tolerance, cap or encoding raises it. */
export const TRACK_VERSION = 1
/** Douglas-Peucker tolerance in metres: a kept path stays within this of the recorded one. */
export const TRACK_TOLERANCE_M = 5
/** Most points a track keeps; a longer path is simplified again with a wider tolerance. */
export const TRACK_MAX_POINTS = 2000
/** Coordinates are rounded to 5 decimals (about 1.1 m) by the polyline encoding. */
export const TRACK_PRECISION = 5
/** A path shorter than this, in metres, is not a route worth drawing. */
const MIN_TRACK_M = 50

/** One recorded position; `d` is the device's cumulative metres when the source has them. */
export interface RoutePoint {
  lat: number
  lng: number
  d: number | null
}

export interface Track {
  v: number
  /** Google encoded polyline, precision 5. */
  polyline: string
  /** Cumulative metres at each kept point, from 0, non-decreasing. */
  distM: number[]
  pointCount: number
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number }
  /** The tolerance the simplification ended at (the base one unless the cap forced a wider one). */
  toleranceM: number
}

export function validPosition(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

/** Indexes kept by Douglas-Peucker over a local equirectangular projection (metres). */
function simplifyIndexes(points: ReadonlyArray<RoutePoint>, toleranceM: number): number[] {
  const n = points.length
  const lat0 = (points[0]!.lat * Math.PI) / 180
  const mPerDeg = 111_320
  const xs = points.map((p) => (p.lng - points[0]!.lng) * mPerDeg * Math.cos(lat0))
  const ys = points.map((p) => (p.lat - points[0]!.lat) * mPerDeg)
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    const dx = xs[b]! - xs[a]!
    const dy = ys[b]! - ys[a]!
    const len = Math.hypot(dx, dy)
    let far = -1
    let farDist = toleranceM
    for (let i = a + 1; i < b; i++) {
      const px = xs[i]! - xs[a]!
      const py = ys[i]! - ys[a]!
      const dist = len === 0 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / len
      if (dist > farDist) {
        farDist = dist
        far = i
      }
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push([a, far], [far, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i)
  return out
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1
  let out = ''
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
    v >>= 5
  }
  return out + String.fromCharCode(v + 63)
}

/** Google encoded polyline of `[lat, lng]` pairs, precision 5. */
export function encodePolyline(points: ReadonlyArray<readonly [number, number]>): string {
  const scale = 10 ** TRACK_PRECISION
  let prevLat = 0
  let prevLng = 0
  let out = ''
  for (const [lat, lng] of points) {
    const la = Math.round(lat * scale)
    const ln = Math.round(lng * scale)
    out += encodeValue(la - prevLat) + encodeValue(ln - prevLng)
    prevLat = la
    prevLng = ln
  }
  return out
}

/** The inverse of `encodePolyline`. */
export function decodePolyline(text: string): Array<[number, number]> {
  const scale = 10 ** TRACK_PRECISION
  const out: Array<[number, number]> = []
  let index = 0
  let lat = 0
  let lng = 0
  const next = (): number => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = text.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < text.length)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (index < text.length) {
    lat += next()
    lng += next()
    out.push([lat / scale, lng / scale])
  }
  return out
}

/**
 * Builds the stored track of one run from its recorded positions in time order, or null when there
 * are fewer than two usable positions or the path is under 50 m. Positions that are not on the
 * globe, or exactly 0,0, are dropped. Cumulative distance uses the device's `d` where every point
 * has one and the great-circle length of the path otherwise. Douglas-Peucker keeps the points that
 * matter at `TRACK_TOLERANCE_M`; a path still above `TRACK_MAX_POINTS` is simplified again with a
 * tolerance 1.5 times wider until it fits.
 */
export function buildTrack(route: ReadonlyArray<RoutePoint>): Track | null {
  const points = route.filter((p) => validPosition(p.lat, p.lng))
  if (points.length < 2) return null

  const device = points.every((p) => p.d !== null && Number.isFinite(p.d))
  let walked = 0
  const cumulative = points.map((p, i) => {
    if (i > 0) {
      const prev = points[i - 1]!
      walked += haversineM(prev.lat, prev.lng, p.lat, p.lng)
    }
    return device ? p.d! : walked
  })
  if (walked < MIN_TRACK_M) return null

  let tolerance = TRACK_TOLERANCE_M
  let kept = simplifyIndexes(points, tolerance)
  while (kept.length > TRACK_MAX_POINTS) {
    tolerance *= 1.5
    kept = simplifyIndexes(points, tolerance)
  }

  const first = cumulative[0]!
  let last = 0
  const distM = kept.map((i) => {
    last = Math.max(last, Math.round(cumulative[i]! - first))
    return last
  })
  const lats = kept.map((i) => points[i]!.lat)
  const lngs = kept.map((i) => points[i]!.lng)
  const polyline = encodePolyline(kept.map((i) => [points[i]!.lat, points[i]!.lng] as const))
  const round = (v: number) => Math.round(v * 10 ** TRACK_PRECISION) / 10 ** TRACK_PRECISION
  return {
    v: TRACK_VERSION,
    polyline,
    distM,
    pointCount: kept.length,
    bbox: {
      minLat: round(Math.min(...lats)),
      minLng: round(Math.min(...lngs)),
      maxLat: round(Math.max(...lats)),
      maxLng: round(Math.max(...lngs)),
    },
    toleranceM: Math.round(tolerance * 100) / 100,
  }
}

/** Whether a run gets a track: a treadmill run has no outdoor path. */
export function hasTrack(type: string, subtype: string | null): boolean {
  return (type === 'run' || type === 'race') && subtype !== 'treadmill'
}
