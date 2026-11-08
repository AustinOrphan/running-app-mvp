import { describe, expect, test } from 'vitest'
import {
  COURSE_MAX_OFF_TRACK_M,
  courseSampleAt,
  parseCourse,
} from '../../../shared/importers/files/course.ts'

const bytes = (xml: string) => new TextEncoder().encode(xml)

/** One degree of longitude on the equator, in metres, as `haversineM` measures it. */
const DEG_M = (2 * Math.PI * 6_371_000) / 360

/** A synthetic route along the equator: `n` points 0.001 degrees apart (about 111 m). */
function gpx(opts: {
  n?: number
  ele?: (i: number) => number | null
  waypoints?: Array<{ name?: string; desc?: string; i: number; lat?: number }>
  as?: 'trk' | 'rte'
}): string {
  const n = opts.n ?? 101
  const ele = opts.ele ?? ((i) => (i <= 50 ? i : 100 - i))
  const tag = opts.as === 'rte' ? 'rtept' : 'trkpt'
  const pts = Array.from({ length: n }, (_, i) => {
    const e = ele(i)
    return `<${tag} lat="0" lon="${(i * 0.001).toFixed(3)}">${e === null ? '' : `<ele>${String(e)}</ele>`}</${tag}>`
  }).join('')
  const track =
    opts.as === 'rte'
      ? `<rte>${pts}</rte>`
      : `<trk><name>Example Loop</name><trkseg>${pts}</trkseg></trk>`
  const marks = (opts.waypoints ?? [])
    .map(
      (w) =>
        `<wpt lat="${String(w.lat ?? 0)}" lon="${(w.i * 0.001).toFixed(3)}">` +
        `${w.name === undefined ? '' : `<name>${w.name}</name>`}` +
        `${w.desc === undefined ? '' : `<desc>${w.desc}</desc>`}</wpt>`,
    )
    .join('')
  return `<?xml version="1.0"?><gpx version="1.1" creator="Example Planner">${marks}${track}</gpx>`
}

describe('parseCourse', () => {
  test('reads the length and the climb along the track', () => {
    const course = parseCourse(bytes(gpx({})))
    expect(course.distanceM).toBeCloseTo(100 * 0.001 * DEG_M, 0)
    expect(course.gainM).toBe(50)
    expect(course.lossM).toBe(50)
    expect(course.profile[0]).toMatchObject({ distanceM: 0, altM: 0, gainM: 0, lossM: 0 })
    const last = course.profile[course.profile.length - 1]!
    expect(last).toMatchObject({ altM: 0, gainM: 50, lossM: 50 })
    expect(last.distanceM).toBeCloseTo(course.distanceM, 6)
  })

  test('puts each waypoint at the distance of its nearest track point, with the climb done by then', () => {
    const course = parseCourse(
      bytes(
        gpx({
          waypoints: [
            { name: 'Second', i: 75 },
            { name: 'First', i: 25, lat: 0.0005 },
          ],
        }),
      ),
    )
    expect(course.waypoints.map((w) => w.name)).toEqual(['First', 'Second'])
    const [first, second] = course.waypoints
    expect(first!.distanceM).toBeCloseTo(25 * 0.001 * DEG_M, 0)
    expect(first).toMatchObject({ gainM: 25, lossM: 0, altM: 25 })
    expect(first!.offTrackM).toBeCloseTo(0.0005 * DEG_M, 0)
    expect(second).toMatchObject({ gainM: 50, lossM: 25, altM: 25 })
    expect(course.offTrack).toBe(0)
  })

  test('the climb up to each waypoint never exceeds the total and never falls', () => {
    const course = parseCourse(
      bytes(gpx({ waypoints: [{ i: 20 }, { i: 60 }, { i: 90 }], ele: (i) => (i % 20) * 3 })),
    )
    const gains = course.waypoints.map((w) => w.gainM)
    expect(gains).toEqual([...gains].sort((a, b) => a - b))
    expect(gains[gains.length - 1]!).toBeLessThanOrEqual(course.gainM!)
  })

  test('leaves out a waypoint that is not on the track and counts it', () => {
    const far = (COURSE_MAX_OFF_TRACK_M * 2) / DEG_M
    const course = parseCourse(
      bytes(
        gpx({
          waypoints: [
            { name: 'Near', i: 10 },
            { name: 'Far', i: 40, lat: far },
          ],
        }),
      ),
    )
    expect(course.waypoints.map((w) => w.name)).toEqual(['Near'])
    expect(course.offTrack).toBe(1)
  })

  test('names a waypoint by its name, else its description, else null', () => {
    const course = parseCourse(
      bytes(
        gpx({ waypoints: [{ name: 'Named', i: 10 }, { desc: 'Described', i: 20 }, { i: 30 }] }),
      ),
    )
    expect(course.waypoints.map((w) => w.name)).toEqual(['Named', 'Described', null])
  })

  test('a file with no altitude has a length and no climb', () => {
    const course = parseCourse(bytes(gpx({ ele: () => null })))
    expect(course.gainM).toBeNull()
    expect(course.lossM).toBeNull()
    expect(course.profile.every((p) => p.altM === null && p.gainM === 0)).toBe(true)
    expect(course.distanceM).toBeGreaterThan(0)
  })

  test('a gap in the altitudes is carried forward from the last known one', () => {
    const course = parseCourse(bytes(gpx({ n: 11, ele: (i) => (i === 5 ? null : i * 2) })))
    expect(course.gainM).toBe(20)
  })

  test('a route with no track is read from its route points', () => {
    const course = parseCourse(bytes(gpx({ as: 'rte' })))
    expect(course.gainM).toBe(50)
  })

  test('thins a long track to about the profile size and keeps the waypoints exact', () => {
    const course = parseCourse(
      bytes(gpx({ n: 4001, ele: (i) => Math.sin(i / 50) * 40, waypoints: [{ i: 1234 }] })),
    )
    expect(course.profile.length).toBeLessThan(560)
    expect(course.profile.length).toBeGreaterThan(300)
    expect(course.waypoints[0]!.distanceM).toBeCloseTo(1234 * 0.001 * DEG_M, 0)
    const distances = course.profile.map((p) => p.distanceM)
    expect(distances).toEqual([...distances].sort((a, b) => a - b))
  })

  test('refuses what is not a course', () => {
    const line = '<trkpt lat="0" lon="0"/><trkpt lat="0" lon="0"/>'
    expect(() => parseCourse(bytes(''))).toThrow(RangeError)
    expect(() => parseCourse(bytes('<kml></kml>'))).toThrow('Not a GPX file')
    expect(() => parseCourse(bytes(gpx({ n: 1 })))).toThrow('holds no track')
    expect(() => parseCourse(bytes('<gpx><wpt lat="0" lon="0"/></gpx>'))).toThrow('holds no track')
    expect(() => parseCourse(bytes(`<gpx><trk><trkseg>${line}</trkseg></trk></gpx>`))).toThrow(
      'no length',
    )
    expect(() => parseCourse(bytes('<gpx><trk>'))).toThrow(RangeError)
  })
})

describe('courseSampleAt', () => {
  const course = parseCourse(bytes(gpx({})))

  test('reads between the samples and clamps at the ends', () => {
    const mid = courseSampleAt(course, course.distanceM / 4)
    expect(mid.gainM).toBeGreaterThanOrEqual(24)
    expect(mid.gainM).toBeLessThanOrEqual(26)
    expect(courseSampleAt(course, -5).distanceM).toBe(0)
    expect(courseSampleAt(course, course.distanceM * 2).gainM).toBe(50)
  })
})
