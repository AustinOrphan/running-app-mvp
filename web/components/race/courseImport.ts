// Checkpoints proposed from a course GPX file (rule H14, ADR 0018). The file is read here, in the
// browser; the track is never sent. The Race page loads this module with import() when a file is
// chosen, so the XML parser stays out of the entry's static graph. What comes back is plain data:
// the thinned profile for the chart, and the rows the checkpoint editor starts from.
import type { RaceCourseProposalFacts } from '../../../shared/copy/racePlan.ts'
import {
  COURSE_MAX_OFF_TRACK_M,
  courseSampleAt,
  parseCourse,
  type Course,
} from '../../../shared/importers/files/course.ts'
import { RACE_CHECKPOINT_NAME_MAX } from '../../../shared/limits.ts'
import type { RaceCheckpointRow, Units } from '../../../shared/types.ts'
import { readBlobBytes } from '../../import/blobs.ts'

/** A file over this is refused before it is read: a course is a few hundred kilobytes. */
export const COURSE_FILE_MAX_MB = 25
export const COURSE_FILE_MAX_BYTES = COURSE_FILE_MAX_MB * 1024 * 1024

/** Waypoints closer than this to the start or the finish are the start and the finish. */
const NAME_MAX = RACE_CHECKPOINT_NAME_MAX
const EDGE_M = 100
/** Two waypoints this close are one place (a station and its drop bag). */
export const COURSE_MERGE_M = 50
/** The gap between evenly spaced rows when the file holds no waypoints: ten miles, else fifteen km. */
const SPACING_M: Record<Units, number> = { mi: 16_093, km: 15_000 }
/** The goal's distance is named when it differs from the track's by more than this share. */
const LENGTH_DIFFERS = 0.02

export type CourseFileProblem = 'large' | 'unreadable'

/** A file the page cannot use; `reason` picks the sentence. */
export class CourseFileError extends Error {
  readonly reason: CourseFileProblem
  constructor(reason: CourseFileProblem) {
    super(`Course file refused: ${reason}`)
    this.name = 'CourseFileError'
    this.reason = reason
  }
}

export interface CourseImport {
  course: Course
  /** The proposed rows in distance order, without cutoffs. */
  rows: RaceCheckpointRow[]
  facts: RaceCourseProposalFacts
}

export interface ProposeArgs {
  units: Units
  /** The most rows one goal may hold (`r1.maxCheckpoints`); bounds the evenly spaced proposal. */
  max: number
  /** The goal's distance in metres. */
  goalDistanceM: number
  /** The name of the nth unnamed point. */
  nameFor: (n: number) => string
  /** A name for a later pass of a place the course passes more than once: "Station (2nd pass)". */
  passName: (name: string, pass: number) => string
}

interface Place {
  name: string | null
  pass: number
  distanceM: number
  gainM: number
  lossM: number
}

/**
 * Rows from a course. The climb and descent of a row are those since the previous row (the start
 * for the first), as the editor's fields are; the stretch after the last row to the finish has no
 * row, the engine derives it from the goal.
 */
export function proposeCheckpoints(course: Course, args: ProposeArgs): CourseImport {
  const inside = course.waypoints.filter(
    (w) => w.distanceM >= EDGE_M && w.distanceM <= course.distanceM - EDGE_M,
  )
  const edge = course.waypoints.length - inside.length

  let places: Place[] = []
  let merged = 0
  for (const w of inside) {
    const last = places[places.length - 1]
    if (last !== undefined && w.distanceM - last.distanceM < COURSE_MERGE_M) merged += 1
    else
      places.push({
        name: w.name,
        pass: w.pass,
        distanceM: w.distanceM,
        gainM: w.gainM,
        lossM: w.lossM,
      })
  }

  const spaced = places.length === 0
  let spacingM = 0
  if (spaced) {
    const wanted = Math.round(course.distanceM / SPACING_M[args.units]) - 1
    const n = Math.max(1, Math.min(args.max, wanted))
    spacingM = course.distanceM / (n + 1)
    places = Array.from({ length: n }, (_unused, k) => {
      const sample = courseSampleAt(course, (k + 1) * spacingM)
      return {
        name: null,
        pass: 1,
        distanceM: sample.distanceM,
        gainM: sample.gainM,
        lossM: sample.lossM,
      }
    })
  }

  // Save refuses a row at or past the goal's distance and a table over the room for it, so the
  // proposal never opens in a state it cannot be saved from.
  const fits = (place: Place) => args.goalDistanceM <= 0 || place.distanceM < args.goalDistanceM
  const beyondGoal = places.filter((place) => !fits(place)).length
  places = places.filter(fits)
  const capped = Math.max(0, places.length - args.max)
  places = places.slice(0, args.max)

  const known = course.gainM !== null
  let previous = { gainM: 0, lossM: 0 }
  const named = (place: Place, index: number): string => {
    const base = place.name ?? args.nameFor(index + 1)
    return place.pass > 1 ? args.passName(base, place.pass).slice(0, NAME_MAX) : base
  }
  const rows = places.map((place, index): RaceCheckpointRow => {
    const row: RaceCheckpointRow = {
      name: named(place, index),
      distanceM: Math.round(place.distanceM),
      gainM: known ? Math.max(0, place.gainM - previous.gainM) : null,
      lossM: known ? Math.max(0, place.lossM - previous.lossM) : null,
      cutoffSec: null,
    }
    previous = place
    return row
  })

  const differs =
    args.goalDistanceM > 0 &&
    Math.abs(course.distanceM - args.goalDistanceM) / args.goalDistanceM > LENGTH_DIFFERS
  return {
    course,
    rows,
    facts: {
      distanceM: course.distanceM,
      gainM: course.gainM,
      lossM: course.lossM,
      basis: spaced ? 'spaced' : 'waypoints',
      waypoints: places.length,
      spacingM: Math.round(spacingM),
      offTrack: course.offTrack,
      offTrackM: COURSE_MAX_OFF_TRACK_M,
      merged,
      mergeM: COURSE_MERGE_M,
      edge,
      beyondGoal,
      capped,
      max: args.max,
      goalDistanceM: differs ? args.goalDistanceM : null,
    },
  }
}

/** Reads a chosen file and proposes rows from it; throws `CourseFileError` for a file it cannot use. */
export async function readCourseFile(file: Blob, args: ProposeArgs): Promise<CourseImport> {
  if (file.size > COURSE_FILE_MAX_BYTES) throw new CourseFileError('large')
  let course: Course
  try {
    course = parseCourse(await readBlobBytes(file))
  } catch (error) {
    if (error instanceof RangeError) throw new CourseFileError('unreadable')
    throw error
  }
  return proposeCheckpoints(course, args)
}
