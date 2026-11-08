// A synthetic course for tests: a straight track along the equator, with rolling hills and named
// waypoints. No real course, race or place. One degree of longitude on the equator is about 111.2 km,
// so a step of 0.01 degrees is about 1.11 km.

export interface CourseGpxOptions {
  /** Track points, 0.01 degrees apart; 146 points are about 161 km. */
  points?: number
  /** Waypoints placed at the track point with this index. */
  waypoints?: ReadonlyArray<{ name?: string; at: number }>
  /** Leave the altitudes out. */
  flat?: boolean
}

/** The altitude of track point `i`, in metres: a hill every 30 points on a gentle rise. */
export function courseAltitude(i: number): number {
  return Math.round(300 + i * 2 + Math.sin(i / 5) * 60)
}

export function courseGpx(options: CourseGpxOptions = {}): string {
  const count = options.points ?? 146
  const track = Array.from({ length: count }, (_unused, i) => {
    const ele = options.flat === true ? '' : `<ele>${String(courseAltitude(i))}</ele>`
    return `<trkpt lat="0" lon="${(i * 0.01).toFixed(2)}">${ele}</trkpt>`
  }).join('')
  const marks = (options.waypoints ?? [])
    .map((w) => {
      const name = w.name === undefined ? '' : `<name>${w.name}</name>`
      return `<wpt lat="0" lon="${(w.at * 0.01).toFixed(2)}">${name}</wpt>`
    })
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<gpx version="1.1" creator="Example Planner" xmlns="http://www.topografix.com/GPX/1/1">' +
    marks +
    `<trk><name>Example Course</name><trkseg>${track}</trkseg></trk></gpx>`
  )
}

/** One track point by longitude and latitude in degrees, with an altitude in metres. */
export interface CourseFix {
  lon: number
  lat?: number
  ele?: number
}

/** A course from explicit points, for routes that double back or loop. */
export function courseGpxFrom(
  points: readonly CourseFix[],
  waypoints: ReadonlyArray<{ name?: string; lon: number; lat?: number }> = [],
): string {
  const track = points
    .map(
      (p) =>
        `<trkpt lat="${String(p.lat ?? 0)}" lon="${String(p.lon)}">` +
        `${p.ele === undefined ? '' : `<ele>${String(p.ele)}</ele>`}</trkpt>`,
    )
    .join('')
  const marks = waypoints
    .map(
      (w) =>
        `<wpt lat="${String(w.lat ?? 0)}" lon="${String(w.lon)}">` +
        `${w.name === undefined ? '' : `<name>${w.name}</name>`}</wpt>`,
    )
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Example Planner">' +
    `${marks}<trk><trkseg>${track}</trkseg></trk></gpx>`
  )
}

/** Out along the equator to `turn` steps of 0.01 degrees and back by a parallel track `backLat` away. */
export function outAndBackPoints(turn = 50, backLat = 0.0001): CourseFix[] {
  const out = Array.from({ length: turn + 1 }, (_u, i) => ({ lon: i * 0.01, ele: 100 + i }))
  const back = Array.from({ length: turn }, (_u, i) => ({
    lon: (turn - 1 - i) * 0.01,
    lat: backLat,
    ele: 100 + turn - 1 - i,
  }))
  return [...out, ...back]
}

/** `laps` laps of a ring about 7 km round, as `perLap` points each; the start is on the ring. */
export function loopPoints(laps = 3, perLap = 72): CourseFix[] {
  const pts: CourseFix[] = []
  for (let lap = 0; lap < laps; lap += 1) {
    for (let i = 0; i < perLap; i += 1) {
      const a = (2 * Math.PI * i) / perLap
      pts.push({ lon: 0.01 * Math.cos(a), lat: 0.01 * Math.sin(a), ele: 200 })
    }
  }
  const first = pts[0]!
  pts.push({ lon: first.lon, lat: first.lat, ele: 200 })
  return pts
}
