// A race course read from a GPX file (rule H14, ADR 0018): the length and the climb along the track,
// and the waypoints placed on it. The Race page reads the file in the browser and sends only the
// checkpoints the runner confirms, so the track is never stored and no activity is made from it
// (`parseGpx` reads a recorded run; this reads a planned route, which has no times).
//
// Pure: bytes in, numbers out. The distance is the sum of straight lines between track points
// (`haversineM`), the climb is `elevationGainLoss`'s, so a course and a recorded run of the same
// ground agree on both.
import { asArray, isNode, numberOf, parseXmlDocument, textOf, type XmlNode } from './gpx.ts'
import { elevationGainLoss, haversineM, toNumber } from './summarize.ts'

/** A waypoint further than this from every track point is not on the course and is left out. */
export const COURSE_MAX_OFF_TRACK_M = 300

/**
 * Two stretches of the track within snap distance of a waypoint are two passes when they lie at
 * least this far apart along the track. A course is expected to say where an aid station is on each
 * pass: a track that wanders back within 300 m of a station after less than this counts as one pass.
 */
export const COURSE_PASS_GAP_M = 1000

/** The profile keeps about this many points: enough for a chart, few enough to climb-count each. */
export const COURSE_PROFILE_POINTS = 500

/** The longest name a waypoint keeps (the checkpoint name limit). */
const NAME_MAX = 60

/** A place along the track, with the distance and the climb done up to it. */
export interface CourseSample {
  /** Metres along the track from its start. */
  distanceM: number
  /** Altitude in metres; null when the file holds none. */
  altM: number | null
  /** Whole metres climbed and descended from the start up to here; 0 when the file holds no altitude. */
  gainM: number
  lossM: number
}

export interface CourseWaypoint extends CourseSample {
  /** The waypoint's name, else its description; null when it has neither. */
  name: string | null
  /** How far the waypoint lies from the nearest track point, in metres. */
  offTrackM: number
  /** Which pass of the waypoint this is, counting along the track from 1, and how many there are. */
  pass: number
  passes: number
}

export interface Course {
  /** The length of the track in metres. */
  distanceM: number
  /** Total climb and descent in whole metres; null when the file holds no altitude. */
  gainM: number | null
  lossM: number | null
  /** The track thinned for a chart, start and end included, in distance order. */
  profile: CourseSample[]
  /** The waypoints that lie on the track, one for each pass, in distance order. */
  waypoints: CourseWaypoint[]
  /** Waypoints (not passes) left out for lying further than `COURSE_MAX_OFF_TRACK_M` from the track. */
  offTrack: number
}

interface TrackPoint {
  lat: number
  lng: number
  alt: number | null
}

function pointOf(node: unknown, altKey: 'ele'): TrackPoint | null {
  if (!isNode(node)) return null
  const lat = toNumber(node['@_lat'])
  const lng = toNumber(node['@_lon'])
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng, alt: numberOf(node[altKey]) }
}

/** Every track point in file order, else every route point. */
function trackPoints(gpx: XmlNode): TrackPoint[] {
  const fromTracks = asArray(gpx['trk'])
    .flatMap((trk) => (isNode(trk) ? asArray(trk['trkseg']) : []))
    .flatMap((seg) => (isNode(seg) ? asArray(seg['trkpt']) : []))
    .map((node) => pointOf(node, 'ele'))
    .filter((p): p is TrackPoint => p !== null)
  if (fromTracks.length > 0) return fromTracks
  return asArray(gpx['rte'])
    .flatMap((rte) => (isNode(rte) ? asArray(rte['rtept']) : []))
    .map((node) => pointOf(node, 'ele'))
    .filter((p): p is TrackPoint => p !== null)
}

/** Altitudes with a gap carried forward from the last known one (the first known one back to the start). */
function filledAltitudes(points: readonly TrackPoint[]): number[] | null {
  const first = points.find((p) => p.alt !== null)?.alt
  if (first === undefined || first === null) return null
  let last = first
  return points.map((p) => {
    if (p.alt !== null) last = p.alt
    return last
  })
}

/** A XML character reference or one of the five predefined entities, as the parser leaves it. */
const ENTITY = /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Decodes the five predefined entities and numeric references; the parser is told not to. */
function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, dec?: string, hex?: string, named?: string) => {
    if (named !== undefined) return NAMED[named] ?? whole
    const code = dec !== undefined ? Number(dec) : parseInt(hex ?? '', 16)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : whole
  })
}

/**
 * The nearest point of the segment from `a` to `b` to `spot`: how far along it (0 to 1) and how far
 * off, in metres, on a flat plane around the waypoint (accurate to centimetres at the 300 m snap).
 */
function nearestOnSegment(
  spot: TrackPoint,
  a: TrackPoint,
  b: TrackPoint,
): { t: number; distanceM: number } {
  const rad = Math.PI / 180
  const radius = 6_371_000
  const scale = Math.cos(spot.lat * rad)
  const flat = (p: TrackPoint) => ({
    x: (p.lng - spot.lng) * rad * radius * scale,
    y: (p.lat - spot.lat) * rad * radius,
  })
  const pa = flat(a)
  const pb = flat(b)
  const dx = pb.x - pa.x
  const dy = pb.y - pa.y
  const span = dx * dx + dy * dy
  const t = span === 0 ? 0 : Math.min(1, Math.max(0, -(pa.x * dx + pa.y * dy) / span))
  return { t, distanceM: Math.hypot(pa.x + t * dx, pa.y + t * dy) }
}

function nameOf(node: XmlNode): string | null {
  const text = textOf(node['name']) ?? textOf(node['desc'])
  if (text === null) return null
  const decoded = decodeEntities(text).trim().slice(0, NAME_MAX).trim()
  return decoded === '' ? null : decoded
}

/**
 * Reads a course. Throws `RangeError` for an unreadable file, a file with no `<gpx>` element, or a
 * track of fewer than two points or no length.
 */
export function parseCourse(bytes: Uint8Array): Course {
  const doc = parseXmlDocument(bytes, 'GPX')
  const gpx = doc['gpx']
  if (!isNode(gpx)) throw new RangeError('Not a GPX file: there is no <gpx> element')
  const points = trackPoints(gpx)
  if (points.length < 2) throw new RangeError('Not a course: the file holds no track')

  const along: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    along.push(along[i - 1]! + haversineM(a.lat, a.lng, b.lat, b.lng))
  }
  const total = along[along.length - 1]!
  if (!(total > 0)) throw new RangeError('Not a course: the track has no length')
  const altitudes = filledAltitudes(points)

  // A waypoint is placed once for each pass of the track within snap distance: an out-and-back
  // passes its aid stations twice and each lap of a loop passes them again. Two stretches within
  // snap distance belong to one pass unless they lie `COURSE_PASS_GAP_M` or more apart along the
  // track; the closest place of each pass is its place. The place is the nearest point of a track
  // segment, not the nearest vertex, so a thinned or sparse track does not move a waypoint by half
  // a gap.
  const waypoints = asArray(gpx['wpt']).flatMap((node) => {
    if (!isNode(node)) return []
    const spot = pointOf(node, 'ele')
    if (spot === null) return []
    const name = nameOf(node)
    const passes: Array<{ index: number; at: number; offTrackM: number }> = []
    let nearest = { index: 0, at: 0, offTrackM: Infinity }
    let lastAt = -Infinity
    for (let k = 0; k < points.length - 1; k++) {
      const hit = nearestOnSegment(spot, points[k]!, points[k + 1]!)
      const length = along[k + 1]! - along[k]!
      const found = {
        index: hit.t < 0.5 ? k : k + 1,
        at: along[k]! + hit.t * length,
        offTrackM: hit.distanceM,
      }
      if (found.offTrackM < nearest.offTrackM) nearest = found
      if (found.offTrackM > COURSE_MAX_OFF_TRACK_M) continue
      const current = passes[passes.length - 1]
      if (current === undefined || found.at - lastAt >= COURSE_PASS_GAP_M) {
        passes.push(found)
      } else if (found.offTrackM < current.offTrackM) {
        Object.assign(current, found)
      }
      lastAt = found.at
    }
    if (passes.length === 0) return [{ ...nearest, name, pass: 1, passes: 1, off: true }]
    return passes.map((pass, n) => ({
      ...pass,
      name,
      pass: n + 1,
      passes: passes.length,
      off: false,
    }))
  })
  const onTrack = waypoints.filter((w) => !w.off)

  // The places to count climb at: evenly spaced along the track, every waypoint, and the end.
  const wanted = new Set<number>([0, points.length - 1, ...onTrack.map((w) => w.index)])
  let next = 1
  for (let i = 1; i < points.length - 1 && next < COURSE_PROFILE_POINTS; i++) {
    if (along[i]! >= (next * total) / COURSE_PROFILE_POINTS) {
      wanted.add(i)
      next = Math.floor((along[i]! * COURSE_PROFILE_POINTS) / total) + 1
    }
  }
  const sample = (index: number): CourseSample => {
    const change = altitudes === null ? null : elevationGainLoss(altitudes.slice(0, index + 1))
    return {
      distanceM: along[index]!,
      altM: altitudes === null ? null : altitudes[index]!,
      gainM: change?.gain ?? 0,
      lossM: change?.loss ?? 0,
    }
  }
  const profile = [...wanted].sort((a, b) => a - b).map(sample)
  const end = profile[profile.length - 1]!

  return {
    distanceM: total,
    gainM: altitudes === null ? null : end.gainM,
    lossM: altitudes === null ? null : end.lossM,
    profile,
    waypoints: onTrack
      .map((w) => ({
        ...sample(w.index),
        distanceM: w.at,
        name: w.name,
        offTrackM: w.offTrackM,
        pass: w.pass,
        passes: w.passes,
      }))
      .sort((a, b) => a.distanceM - b.distanceM),
    offTrack: waypoints.filter((w) => w.off).length,
  }
}

/**
 * The climb and descent done by a distance along the track, read between the two nearest samples
 * of the profile; the ends clamp. For a point that is not a waypoint (an evenly spaced proposal).
 */
export function courseSampleAt(course: Course, distanceM: number): CourseSample {
  const { profile } = course
  const first = profile[0]!
  const last = profile[profile.length - 1]!
  if (distanceM <= first.distanceM) return first
  if (distanceM >= last.distanceM) return last
  let high = profile.findIndex((p) => p.distanceM >= distanceM)
  if (high < 1) high = 1
  const a = profile[high - 1]!
  const b = profile[high]!
  const span = b.distanceM - a.distanceM
  const t = span > 0 ? (distanceM - a.distanceM) / span : 0
  const mix = (x: number, y: number) => x + (y - x) * t
  return {
    distanceM,
    altM: a.altM === null || b.altM === null ? null : mix(a.altM, b.altM),
    gainM: Math.round(mix(a.gainM, b.gainM)),
    lossM: Math.round(mix(a.lossM, b.lossM)),
  }
}
