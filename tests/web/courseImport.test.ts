// Checkpoints proposed from a course file (rule H14): the rows, the climb since the previous row, the
// even spacing when the file names nothing, and the files the page refuses.
import { describe, expect, test } from 'vitest'
import { parseCourse } from '../../shared/importers/files/course.ts'
import {
  COURSE_MERGE_M,
  CourseFileError,
  proposeCheckpoints,
  readCourseFile,
} from '../../web/components/race/courseImport.ts'
import { courseAltitude, courseGpx } from '../fixtures/course/buildCourseGpx.ts'

const bytes = (xml: string) => new TextEncoder().encode(xml)
const ARGS = {
  units: 'km' as const,
  max: 40,
  goalDistanceM: 161_000,
  nameFor: (n: number) => `Point ${String(n)}`,
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

  test('names the goal distance only when it differs from the track by more than two percent', () => {
    const course = parseCourse(bytes(courseGpx()))
    expect(proposeCheckpoints(course, ARGS).facts.goalDistanceM).toBeNull()
    expect(
      proposeCheckpoints(course, { ...ARGS, goalDistanceM: 100_000 }).facts.goalDistanceM,
    ).toBe(100_000)
  })

  test('the altitude of the fixture rises, so a flat file is a real difference', () => {
    expect(courseAltitude(100)).toBeGreaterThan(courseAltitude(0))
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
