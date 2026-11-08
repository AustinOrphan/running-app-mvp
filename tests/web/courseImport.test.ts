// Checkpoints proposed from a course file (rule H14): the rows, the climb since the previous row, the
// even spacing when the file names nothing, and the files the page refuses.
import { describe, expect, test } from 'vitest'
import { describeRaceCourseProposal } from '../../shared/copy/racePlan.ts'
import { parseCourse } from '../../shared/importers/files/course.ts'
import {
  COURSE_MERGE_M,
  CourseFileError,
  proposeCheckpoints,
  readCourseFile,
} from '../../web/components/race/courseImport.ts'
import {
  courseAltitude,
  courseGpx,
  courseGpxFrom,
  loopPoints,
  outAndBackPoints,
} from '../fixtures/course/buildCourseGpx.ts'

const bytes = (xml: string) => new TextEncoder().encode(xml)
const ARGS = {
  units: 'km' as const,
  max: 40,
  goalDistanceM: 161_000,
  nameFor: (n: number) => `Point ${String(n)}`,
  passName: (name: string, pass: number) => `${name} (pass ${String(pass)})`,
}

describe('proposeCheckpoints', () => {
  test('makes a row for each waypoint, named, in distance order, with the climb since the previous row', () => {
    const course = parseCourse(
      bytes(
        courseGpx({
          waypoints: [
            { name: 'Station B', at: 100 },
            { name: 'Station A', at: 40 },
          ],
        }),
      ),
    )
    const { rows, facts } = proposeCheckpoints(course, ARGS)
    expect(rows.map((r) => r.name)).toEqual(['Station A', 'Station B'])
    expect(rows[0]!.distanceM).toBeGreaterThan(44_000)
    expect(rows[0]!.distanceM).toBeLessThan(45_000)
    expect(rows.every((r) => r.cutoffSec === null)).toBe(true)
    const up = rows[0]!.gainM! + rows[1]!.gainM!
    expect(up).toBeLessThanOrEqual(course.gainM!)
    expect(up).toBeGreaterThan(0)
    expect(facts).toMatchObject({ basis: 'waypoints', waypoints: 2, edge: 0, merged: 0 })
  })

  test('names an unnamed waypoint by its place in the list', () => {
    const course = parseCourse(
      bytes(courseGpx({ waypoints: [{ at: 30 }, { name: 'Named', at: 60 }] })),
    )
    expect(proposeCheckpoints(course, ARGS).rows.map((r) => r.name)).toEqual(['Point 1', 'Named'])
  })

  test('leaves out waypoints at the start and the finish, and merges two that are one place', () => {
    const course = parseCourse(
      bytes(
        courseGpx({
          points: 146,
          waypoints: [
            { name: 'Start', at: 0 },
            { name: 'Station', at: 50 },
            { name: 'Station drop bag', at: 50 },
            { name: 'Finish', at: 145 },
          ],
        }),
      ),
    )
    const { rows, facts } = proposeCheckpoints(course, ARGS)
    expect(rows.map((r) => r.name)).toEqual(['Station'])
    expect(facts).toMatchObject({ edge: 2, merged: 1, mergeM: COURSE_MERGE_M })
  })

  test('spaces rows evenly, one in about every fifteen km or ten miles, when the file names nothing', () => {
    const course = parseCourse(bytes(courseGpx()))
    const km = proposeCheckpoints(course, ARGS)
    expect(km.facts.basis).toBe('spaced')
    expect(km.rows).toHaveLength(Math.round(course.distanceM / 15_000) - 1)
    expect(km.rows.map((r) => r.name)[0]).toBe('Point 1')
    const gaps = km.rows.map((r, i) => r.distanceM - (km.rows[i - 1]?.distanceM ?? 0))
    for (const gap of gaps) expect(Math.abs(gap - km.facts.spacingM)).toBeLessThan(2)
    const mi = proposeCheckpoints(course, { ...ARGS, units: 'mi' })
    expect(mi.rows).toHaveLength(Math.round(course.distanceM / 16_093) - 1)
  })

  test('never proposes more rows than the limit', () => {
    const course = parseCourse(bytes(courseGpx()))
    expect(proposeCheckpoints(course, { ...ARGS, max: 3 }).rows).toHaveLength(3)
  })

  test('leaves the climb blank for a file with no elevation', () => {
    const course = parseCourse(bytes(courseGpx({ flat: true, waypoints: [{ name: 'A', at: 50 }] })))
    const { rows, facts } = proposeCheckpoints(course, ARGS)
    expect(rows[0]).toMatchObject({ gainM: null, lossM: null })
    expect(facts.gainM).toBeNull()
  })

  test('flags a goal distance that differs from the track by more than two percent', () => {
    const course = parseCourse(bytes(courseGpx()))
    expect(proposeCheckpoints(course, ARGS).facts).toMatchObject({
      lengthDiffers: false,
      goalDistanceM: 161_000,
    })
    expect(proposeCheckpoints(course, { ...ARGS, goalDistanceM: 100_000 }).facts).toMatchObject({
      lengthDiffers: true,
      goalDistanceM: 100_000,
    })
  })

  test('the altitude of the fixture rises, so a flat file is a real difference', () => {
    expect(courseAltitude(100)).toBeGreaterThan(courseAltitude(0))
  })
})

describe('a course that passes a place more than once', () => {
  const parse = (xml: string) => parseCourse(bytes(xml))

  test('an out-and-back gives a checkpoint for each pass of each station, in order along the course', () => {
    const course = parse(
      courseGpxFrom(outAndBackPoints(), [
        { name: 'A', lon: 0.1 },
        { name: 'B', lon: 0.25 },
        { name: 'C', lon: 0.4 },
      ]),
    )
    const { rows } = proposeCheckpoints(course, ARGS)
    expect(rows.map((r) => r.name)).toEqual([
      'A',
      'B',
      'C',
      'C (pass 2)',
      'B (pass 2)',
      'A (pass 2)',
    ])
    const step = course.distanceM / 99
    const expected = [10, 25, 40, 59, 74, 89].map((i) => i * step)
    rows.forEach((r, i) => {
      expect(Math.abs(r.distanceM - expected[i]!)).toBeLessThan(step * 1.1)
    })
    expect(rows.every((r, i) => i === 0 || r.distanceM > rows[i - 1]!.distanceM)).toBe(true)
    expect(rows.reduce((sum, r) => sum + (r.gainM ?? 0), 0)).toBeLessThanOrEqual(course.gainM!)
  })

  test('three laps of a loop give three checkpoints for one waypoint', () => {
    const course = parse(courseGpxFrom(loopPoints(), [{ name: 'Far side', lon: -0.01, lat: 0 }]))
    expect(course.waypoints).toHaveLength(3)
    const { rows } = proposeCheckpoints(course, ARGS)
    expect(rows.map((r) => r.name)).toEqual(['Far side', 'Far side (pass 2)', 'Far side (pass 3)'])
    const lap = course.distanceM / 3
    rows.forEach((r, i) => {
      expect(Math.abs(r.distanceM - (i + 0.5) * lap)).toBeLessThan(lap * 0.05)
    })
  })

  test('a point-to-point course is as it was: one pass for each waypoint', () => {
    const course = parse(
      courseGpx({
        waypoints: [
          { name: 'A', at: 40 },
          { name: 'B', at: 90 },
        ],
      }),
    )
    expect(course.waypoints.map((w) => [w.pass, w.passes])).toEqual([
      [1, 1],
      [1, 1],
    ])
    expect(proposeCheckpoints(course, ARGS).rows.map((r) => r.name)).toEqual(['A', 'B'])
  })

  test('a waypoint within 300 m of two stretches far apart along the track is two passes', () => {
    // the way back runs 200 m north of the way out; the waypoint lies between, 100 m from each
    const course = parse(
      courseGpxFrom(outAndBackPoints(50, 0.0018), [{ name: 'Between', lon: 0.2, lat: 0.0009 }]),
    )
    expect(course.waypoints).toHaveLength(2)
    expect(course.waypoints[1]!.distanceM - course.waypoints[0]!.distanceM).toBeGreaterThan(50_000)
    expect(course.waypoints.every((w) => w.offTrackM < 300)).toBe(true)
  })

  test('a turn within the snap distance of a waypoint is one pass, not two', () => {
    const course = parse(courseGpxFrom(outAndBackPoints(), [{ name: 'Turn', lon: 0.5 }]))
    expect(course.waypoints).toHaveLength(1)
  })

  test('a waypoint that no stretch of the track is near is left out, and counted once', () => {
    const course = parse(courseGpxFrom(outAndBackPoints(), [{ name: 'Lost', lon: 0.2, lat: 0.05 }]))
    expect(course.waypoints).toEqual([])
    expect(course.offTrack).toBe(1)
  })
})

describe('readCourseFile', () => {
  const file = (text: string) => new File([text], 'course.gpx', { type: 'application/gpx+xml' })

  test('reads a file and proposes rows', async () => {
    const read = await readCourseFile(file(courseGpx({ waypoints: [{ name: 'A', at: 50 }] })), ARGS)
    expect(read.rows.map((r) => r.name)).toEqual(['A'])
  })

  test('refuses what is not a course with the reason "unreadable"', async () => {
    await expect(readCourseFile(file('not xml'), ARGS)).rejects.toMatchObject({
      reason: 'unreadable',
    })
    await expect(readCourseFile(file('<gpx></gpx>'), ARGS)).rejects.toBeInstanceOf(CourseFileError)
  })

  test('refuses a file over the size limit before reading it', async () => {
    const big = { size: 30 * 1024 * 1024 } as unknown as Blob
    await expect(readCourseFile(big, ARGS)).rejects.toMatchObject({ reason: 'large' })
  })
})

describe('a proposal Save would accept', () => {
  const course = parseCourse(
    bytes(
      courseGpx({
        waypoints: [20, 40, 60, 80, 100, 120, 140].map((at) => ({ name: `S${String(at)}`, at })),
      }),
    ),
  )

  test('keeps the first rows that fit the room, and counts the rest', () => {
    const { rows, facts } = proposeCheckpoints(course, { ...ARGS, max: 4 })
    expect(rows.map((r) => r.name)).toEqual(['S20', 'S40', 'S60', 'S80'])
    expect(facts).toMatchObject({ capped: 3, max: 4, beyondGoal: 0 })
  })

  test('leaves out a waypoint at or past the goal distance, and counts it', () => {
    const { rows, facts } = proposeCheckpoints(course, { ...ARGS, goalDistanceM: 100_000 })
    expect(rows.every((r) => r.distanceM < 100_000)).toBe(true)
    expect(rows.map((r) => r.name)).toEqual(['S20', 'S40', 'S60', 'S80'])
    expect(facts.beyondGoal).toBe(3)
  })

  test("every row of a proposal passes the editor's own checks", async () => {
    const { parseDrafts, draftFrom } = await import('../../web/components/race/checkpointForm.ts')
    const { rows } = proposeCheckpoints(course, { ...ARGS, goalDistanceM: 150_000 })
    const parsed = parseDrafts(
      rows.map((r, i) => draftFrom(r, String(i), 'km')),
      { units: 'km', courseM: 150_000, startMin: null },
    )
    expect(parsed.ok).toBe(true)
  })
})

describe('proposals at the edges of what Save accepts', () => {
  test('counts a waypoint past a goal that is within two percent of the track, and says so', () => {
    // a goal 50 m short of the last waypoint, on a track within two percent of the goal
    const course = parseCourse(
      bytes(
        courseGpx({
          points: 101,
          waypoints: [
            { name: 'In', at: 50 },
            { name: 'Out', at: 99 },
          ],
        }),
      ),
    )
    const goal = course.waypoints[1]!.distanceM - 50
    const { rows, facts } = proposeCheckpoints(course, { ...ARGS, goalDistanceM: goal })
    expect(rows.map((r) => r.name)).toEqual(['In'])
    expect(facts).toMatchObject({ beyondGoal: 1, lengthDiffers: false, goalDistanceM: goal })
    expect(describeRaceCourseProposal(facts, 'km').notices.join(' ')).toMatch(/left out: 1/)
  })

  test('compares the rounded distance, as the row will be sent', () => {
    const course = parseCourse(bytes(courseGpx({ waypoints: [{ name: 'Edge', at: 90 }] })))
    const at = course.waypoints[0]!.distanceM
    // a goal whose distance rounds to the waypoint's: the row would be at the goal, which Save refuses
    const goal = Math.round(at)
    const { rows, facts } = proposeCheckpoints(course, { ...ARGS, goalDistanceM: goal })
    expect(rows).toEqual([])
    expect(facts.beyondGoal).toBe(1)
    const roomy = proposeCheckpoints(course, { ...ARGS, goalDistanceM: goal + 1 })
    expect(roomy.rows).toHaveLength(1)
  })

  test('shortens a long base name, not the suffix, so two passes never share a name', () => {
    const long = 'L'.repeat(60)
    const course = parseCourse(bytes(courseGpxFrom(outAndBackPoints(), [{ name: long, lon: 0.2 }])))
    const { rows } = proposeCheckpoints(course, ARGS)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.name).toBe(long)
    expect(rows[1]!.name.length).toBeLessThanOrEqual(60)
    expect(rows[1]!.name).toMatch(/ \(pass 2\)$/)
    expect(rows[1]!.name).not.toBe(rows[0]!.name)
  })
})
