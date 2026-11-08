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
}

export interface Course {
  /** The length of the track in metres. */
  distanceM: number
  /** Total climb and descent in whole metres; null when the file holds no altitude. */
  gainM: number | null
  lossM: number | null
  /** The track thinned for a chart, start and end included, in distance order. */
  profile: CourseSample[]
  /** The waypoints that lie on the track, in distance order. */
  waypoints: CourseWaypoint[]
  /** Waypoints left out for lying further than `COURSE_MAX_OFF_TRACK_M` from the track. */
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

function nameOf(node: XmlNode): string | null {
  const text = textOf(node['name']) ?? textOf(node['desc'])
  return text === null ? null : text.slice(0, NAME_MAX)
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

  const waypoints = asArray(gpx['wpt']).flatMap((node) => {
    if (!isNode(node)) return []
    const spot = pointOf(node, 'ele')
    if (spot === null) return []
    let nearest = 0
    let nearestM = Infinity
    points.forEach((p, index) => {
      const d = haversineM(spot.lat, spot.lng, p.lat, p.lng)
      if (d < nearestM) {
        nearestM = d
        nearest = index
      }
    })
    return [{ index: nearest, offTrackM: nearestM, name: nameOf(node) }]
  })
  const onTrack = waypoints.filter((w) => w.offTrackM <= COURSE_MAX_OFF_TRACK_M)

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
      .map((w) => ({ ...sample(w.index), name: w.name, offTrackM: w.offTrackM }))
      .sort((a, b) => a.distanceM - b.distanceM),
    offTrack: waypoints.length - onTrack.length,
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
