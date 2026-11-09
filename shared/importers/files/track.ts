import { haversineM } from './summarize.ts'

/**
 * Route simplification for the run map (M1a). The tolerance, the cap and the speed limit are data
 * preparation, not engine Params: they decide how much of a recorded path is kept for drawing, and
 * no training decision reads them.
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
/** A single fix that implies a speed above this (m/s) from both neighbours is a GPS jump. */
export const TRACK_MAX_SPEED_MPS = 15
/** Device distance is trusted while its total is within this factor of the walked length. */
const DEVICE_DISTANCE_FACTOR = 2

/**
 * One recorded position. `d` is the device's cumulative metres and `t` the seconds from the start,
 * each when the source has them.
 */
export interface RoutePoint {
  lat: number
  lng: number
  d: number | null
  t?: number | null
}

export interface Track {
  v: number
  /** Google encoded polyline, precision 5. Longitudes are unwrapped, so they may pass +-180. */
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
export function simplifyIndexes(
  points: ReadonlyArray<{ lat: number; lng: number }>,
  toleranceM: number,
): number[] {
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

/** Cumulative great-circle length of a path, from 0. */
function walkedLength(points: ReadonlyArray<{ lat: number; lng: number }>): number[] {
  const out = [0]
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!
    const q = points[i]!
    out.push(out[i - 1]! + haversineM(p.lat, p.lng, q.lat, q.lng))
  }
  return out
}

/**
 * Drops a single fix that jumps away and back: the speed into it and out of it both exceed
 * `TRACK_MAX_SPEED_MPS` while the speed across it does not (an end is judged against its one
 * neighbour pair). Needs a time on every point; without them the points are returned as they are.
 */
function dropJumps<T extends RoutePoint>(points: T[]): T[] {
  const n = points.length
  if (n < 3 || points.some((p) => typeof p.t !== 'number' || !Number.isFinite(p.t))) return points
  const fast = (a: number, b: number): boolean => {
    const p = points[a]!
    const q = points[b]!
    const dt = Math.max(1, Math.abs(q.t! - p.t!))
    return haversineM(p.lat, p.lng, q.lat, q.lng) / dt > TRACK_MAX_SPEED_MPS
  }
  return points.filter((_, i) => {
    if (i === 0) return !(fast(0, 1) && !fast(1, 2))
    if (i === n - 1) return !(fast(n - 2, n - 1) && !fast(n - 3, n - 2))
    return !(fast(i - 1, i) && fast(i, i + 1) && !fast(i - 1, i + 1))
  })
}

/**
 * The fixes of a route that may be trusted, in order: positions on the globe (not 0,0), without a
 * single fix that jumps away and back. The one rule the track and an activity's own distance
 * share, so the two agree. Returns the same objects, so a caller can match them by identity.
 */
export function usableFixes<T extends RoutePoint>(route: ReadonlyArray<T>): T[] {
  return dropJumps(route.filter((p) => validPosition(p.lat, p.lng)))
}

/**
 * Cumulative distance of each point: the device's where it has one, with the walked length between
 * known values filling the gaps. The walked length stands in for all of it when no point has a
 * device value, or when the device total is not within a factor of 2 of the walked length (a
 * counter that jumped, reset or ran in other units).
 */
function cumulativeDistance(device: ReadonlyArray<number | null>, walked: number[]): number[] {
  const known = (i: number): boolean => typeof device[i] === 'number' && Number.isFinite(device[i])
  const first = device.findIndex((_, i) => known(i))
  if (first < 0) return walked
  const out: number[] = []
  let anchor = first
  for (let i = 0; i < device.length; i++) {
    if (known(i)) {
      out.push(device[i]!)
      anchor = i
    } else if (i < first) {
      out.push(device[first]! - (walked[first]! - walked[i]!))
    } else {
      out.push(out[anchor]! + (walked[i]! - walked[anchor]!))
    }
  }
  const total = out[out.length - 1]! - out[0]!
  const walkedTotal = walked[walked.length - 1]!
  const agrees =
    total >= walkedTotal / DEVICE_DISTANCE_FACTOR && total <= walkedTotal * DEVICE_DISTANCE_FACTOR
  return agrees ? out : walked
}

/**
 * Builds the stored track of one run from its recorded positions in time order, or null when there
 * are fewer than two usable positions or the path is under 50 m. Positions that are not on the
 * globe, or exactly 0,0, are dropped, and so is a single fix that jumps away and back
 * (`TRACK_MAX_SPEED_MPS`). Longitudes are unwrapped against the previous fix, so a run across the
 * antimeridian is one continuous path: its longitudes, and the bounding box, may lie beyond +-180
 * and a map must read them so. Cumulative distance uses the device's values where present (gaps
 * filled from the walked length) while their total agrees with the walked length, and the walked
 * length otherwise. Douglas-Peucker keeps the points that matter at `TRACK_TOLERANCE_M`; a path
 * still above `TRACK_MAX_POINTS` is simplified again with a tolerance 1.5 times wider until it fits.
 */
export function buildTrack(route: ReadonlyArray<RoutePoint>): Track | null {
  const valid = usableFixes(route)
  if (valid.length < 2) return null

  let prevLng = valid[0]!.lng
  const points: RoutePoint[] = valid.map((p) => {
    let lng = p.lng
    while (lng - prevLng > 180) lng -= 360
    while (lng - prevLng < -180) lng += 360
    prevLng = lng
    return { ...p, lng }
  })

  const walked = walkedLength(points)
  if (walked[walked.length - 1]! < MIN_TRACK_M) return null
  const cumulative = cumulativeDistance(
    points.map((p) => p.d),
    walked,
  )

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

/** Metres left out at each end of a map when the runner hides the ends (privacy, M1a). */
export const MAP_END_TRIM_M = 200

/**
 * The track without its first and last `metres`, or null when nothing would be left (a path under
 * twice `metres`) or the stored track is inconsistent. The distance is measured along the simplified
 * path itself (the great-circle length of its vertices), never from the stored `distM`: GPS jitter
 * and a bad device counter can inflate or corrupt `distM`, and neither may shorten the hidden
 * stretch below `metres` of ground. The cut falls exactly there, on a point interpolated along the
 * segment it lands in. `distM` of the kept points keeps its absolute values (interpolated at the
 * cuts), so a chart can still map a distance to a point; the bounding box is that of the trimmed path.
 */
export function trimTrackEnds(track: Track, metres: number): Track | null {
  const path = decodePolyline(track.polyline)
  if (path.length < 2 || track.distM.length !== path.length) return null
  const walked = walkedLength(path.map(([lat, lng]) => ({ lat, lng })))
  const total = walked[walked.length - 1]!
  const from = metres
  const to = total - metres
  if (to <= from) return null

  const at = (w: number): { point: [number, number]; dist: number } => {
    for (let i = 1; i < path.length; i++) {
      const w1 = walked[i]!
      if (w <= w1) {
        const w0 = walked[i - 1]!
        const f = w1 === w0 ? 0 : (w - w0) / (w1 - w0)
        const [aLat, aLng] = path[i - 1]!
        const [bLat, bLng] = path[i]!
        const d0 = track.distM[i - 1]!
        const d1 = track.distM[i]!
        return {
          point: [aLat + (bLat - aLat) * f, aLng + (bLng - aLng) * f],
          dist: Math.round(d0 + (d1 - d0) * f),
        }
      }
    }
    return { point: path[path.length - 1]!, dist: track.distM[path.length - 1]! }
  }

  const start = at(from)
  const end = at(to)
  const points: Array<[number, number]> = [start.point]
  const dist: number[] = [start.dist]
  for (let i = 0; i < path.length; i++) {
    if (walked[i]! > from && walked[i]! < to) {
      points.push(path[i]!)
      dist.push(track.distM[i]!)
    }
  }
  points.push(end.point)
  dist.push(end.dist)

  const polyline = encodePolyline(points)
  const kept = decodePolyline(polyline)
  const lats = kept.map(([lat]) => lat)
  const lngs = kept.map(([, lng]) => lng)
  return {
    ...track,
    polyline,
    distM: dist,
    pointCount: kept.length,
    bbox: {
      minLat: Math.min(...lats),
      minLng: Math.min(...lngs),
      maxLat: Math.max(...lats),
      maxLng: Math.max(...lngs),
    },
  }
}
