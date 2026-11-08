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
