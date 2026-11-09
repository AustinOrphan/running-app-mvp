// The arrival ranges of a race plan's checkpoint table (rule H14 and L5, ADR 0018; design
// 2026-11-07, step 4). One pure function of the course, the expected range of the race plan and the
// runner's own rows. It scales the expected range by each row's share of the course, and it does
// not model the course: the weights are defaults, and the corpus holds no study of segment times in
// an ultra (gap R3), so no row is wider than the plain scaling makes it.
//
// What it does not do, on purpose: no downhill credit (I11, G6), no time at an aid station (R2), no
// late-race slowdown (R1), no widening of an interior row (R3) and no comparison of a cutoff with
// an arrival range. A cutoff is carried through as the runner's own fact.
//
// Pure: no clock, no I/O. Every number comes from `P`.
import type { SupportLevel } from '../types.ts'
import type { ClimbBlend } from './types.ts'
import { spreadOverUnentered } from './legSpread.ts'
import { clockAt, type RaceClock } from './raceClock.ts'
import { P } from './params/index.ts'

const SEC_PER_MIN = 60
const SEC_PER_HOUR = 3600
const MIN_PER_HOUR = 60
const MIN_PER_DAY = 1440

/** One row of the runner's table: a course point, as the runner entered it. */
export interface CheckpointInput {
  name: string
  /** From the start, metres; the finish is implicit. */
  distanceM: number
  /** Climb since the previous row, metres; null when the runner left it out. */
  gainM: number | null
  /** Descent since the previous row, metres; shown, never credited (I11). */
  lossM: number | null
  /** Elapsed seconds from the start; the runner's own fact. */
  cutoffSec: number | null
}

export interface SplitsInput {
  /** The course distance in metres; the finish row sits here. */
  distanceM: number
  /** The course climb in metres from the goal; 0 when the goal holds none. */
  courseGainM: number
  supportLevel: SupportLevel
  checkpoints: readonly CheckpointInput[]
  /** The race plan's expected range (rounded outward) and the time it is drawn from. */
  expected: { lowSec: number; highSec: number; midSec: number }
  /** Minutes after midnight of the start, or null without a start time. */
  startMin: number | null
  /** The carbohydrate rate in grams per hour, low to high (the tolerated rung). */
  rateGPerH: readonly [number, number]
  /**
   * What the runner's own climbing did to the prediction behind the expected range (rule L5); its
   * `usedM` replaces `l5.gainEquivalentM` in the weights. Absent: the default weighs the climb.
   */
  climb?: ClimbBlend | null
}

export interface SplitRow {
  /** The runner's name for the point; null on the finish row. */
  name: string | null
  finish: boolean
  distanceM: number
  /** Metres since the previous row (or the start). */
  segmentM: number
  /** The climb of the segment the weights used: the runner's, else the spread share. */
  gainM: number
  /** The runner entered this segment's climb. */
  gainEntered: boolean
  /** The descent the runner entered; shown, never credited. */
  lossM: number | null
  /** The arrival range in elapsed seconds, rounded outward to `r1.arrivalRoundMin`. */
  lowSec: number
  highSec: number
  /** The clock at each end of the range; null without a start time. */
  clock: { from: RaceClock; to: RaceClock } | null
  /** The middle of the range falls outside the D1 daylight clock; null without a start time. */
  night: boolean | null
  /** Carbohydrate for the segment, low to high, in grams; null unless the race is aided. */
  carryG: [number, number] | null
  /** The segment climbs at `h4.climbNoteGainPerHourM` or more per hour of its expected time. */
  climbByEffort: boolean
  /** The runner's cutoff in elapsed seconds, or null. */
  cutoffSec: number | null
  /** The cutoff as a time of day; null without a cutoff or without a start time. */
  cutoffClock: RaceClock | null
}

export interface RaceSplits {
  /** The runner's rows in distance order, then the finish. */
  rows: SplitRow[]
  /** Rows at or past the finish (or at the start) that the table leaves out. */
  ignored: number
  /** The goal holds a course climb, so segments without a climb of their own get a share of it. */
  courseGainKnown: boolean
  /** The climb of the rows adds up to more than the course climb. */
  climbOverCourse: boolean
  /** Some segment has no climb of its own and no course climb to share. */
  climbUnknown: boolean
  /** The runner's own climbing moved the weights (rule L5); null when the default weighed the climb. */
  climb: ClimbBlend | null
  rules: string[]
}

/** The weight of a segment: its distance plus its climb at `gainEquivalentM` flat metres each. */
function weightOf(segmentM: number, gainM: number, gainEquivalentM: number): number {
  return segmentM + gainEquivalentM * gainM
}

/** Whether the minute of the day (from midnight) lies inside the D1 daylight clock. */
function isDaylight(minuteOfDay: number): boolean {
  return (
    minuteOfDay >= P.d1Dark.dawnHour.value * MIN_PER_HOUR &&
    minuteOfDay < P.d1Dark.duskHour.value * MIN_PER_HOUR
  )
}

/**
 * The table of arrival ranges for the runner's checkpoints and the finish, or null when the runner
 * entered no row.
 *
 * 1. Rows at or past the finish, or at the start, are dropped and counted; the rest are sorted and
 *    the finish is appended.
 * 2. A segment's climb is the runner's, else `r1.unenteredClimbShare` of the course climb left after
 *    the entered rows, spread over the segments without one by distance (0 without a course climb).
 * 3. A segment weighs its distance plus `l5.gainEquivalentM` metres per metre of climb (the figure
 *    the prediction used, when the runner's own climbing moved it, rule L5); the share
 *    of the race at a row is the weight up to it over the weight of the course.
 * 4. The arrival range at a row is the expected range times that share, rounded outward to
 *    `r1.arrivalRoundMin`; the finish row is the expected range itself, so an interior row lies
 *    inside it and the rows never run backwards.
 */
export function splitsFor(input: SplitsInput): RaceSplits | null {
  if (input.checkpoints.length === 0) return null
  const rows = input.checkpoints
    .filter((row) => row.distanceM > 0 && row.distanceM < input.distanceM)
    .toSorted((a, b) => a.distanceM - b.distanceM)
  const ignored = input.checkpoints.length - rows.length

  const stops: Array<{ checkpoint: CheckpointInput | null; distanceM: number }> = [
    ...rows.map((checkpoint) => ({ checkpoint, distanceM: checkpoint.distanceM })),
    { checkpoint: null, distanceM: input.distanceM },
  ]
  const segments = stops.map((stop, i) => ({
    ...stop,
    segmentM: stop.distanceM - (stops[i - 1]?.distanceM ?? 0),
    entered: stop.checkpoint?.gainM ?? null,
  }))

  const courseGainKnown = input.courseGainM > 0
  const enteredSum = segments.reduce((sum, s) => sum + (s.entered ?? 0), 0)
  const gains = spreadOverUnentered(
    segments.map((s) => s.entered),
    segments.map((s) => s.segmentM),
    input.courseGainM,
    P.r1.unenteredClimbShare.value,
  )

  const gainEquivalentM = input.climb?.usedM ?? P.l5.gainEquivalentM.value
  const weights = segments.map((s, i) => weightOf(s.segmentM, gains[i] ?? 0, gainEquivalentM))
  const total = weights.reduce((sum, w) => sum + w, 0)

  const step = P.r1.arrivalRoundMin.value * SEC_PER_MIN
  const { lowSec, highSec, midSec } = input.expected
  const [rateLow, rateHigh] = input.rateGPerH
  const aided = input.supportLevel === 'aided'
  const startMin = input.startMin

  let cumulative = 0
  let previousShare = 0
  const out = segments.map((s, i): SplitRow => {
    const finish = s.checkpoint === null
    cumulative += weights[i] ?? 0
    // The finish is exactly the expected range: no rounding error may move it.
    const share = finish ? 1 : cumulative / total
    const low = finish ? lowSec : Math.floor((lowSec * share) / step) * step
    const high = finish ? highSec : Math.ceil((highSec * share) / step) * step
    const hours = (midSec * (share - previousShare)) / SEC_PER_HOUR
    previousShare = share
    const gain = gains[i] ?? 0
    return {
      name: s.checkpoint?.name ?? null,
      finish,
      distanceM: s.distanceM,
      segmentM: s.segmentM,
      gainM: gain,
      gainEntered: s.entered !== null,
      lossM: s.checkpoint?.lossM ?? null,
      lowSec: low,
      highSec: high,
      clock:
        startMin === null ? null : { from: clockAt(startMin, low), to: clockAt(startMin, high) },
      night:
        startMin === null
          ? null
          : !isDaylight(Math.floor(startMin + (midSec * share) / SEC_PER_MIN) % MIN_PER_DAY),
      carryG: aided ? [rateLow * hours, rateHigh * hours] : null,
      climbByEffort: hours > 0 && gain / hours >= P.h4.climbNoteGainPerHourM.value,
      cutoffSec: s.checkpoint?.cutoffSec ?? null,
      cutoffClock:
        startMin === null || s.checkpoint?.cutoffSec == null
          ? null
          : clockAt(startMin, s.checkpoint.cutoffSec),
    }
  })

  const rules = ['H14', 'L5']
  if (aided) rules.push('H7')
  if (out.some((row) => row.climbByEffort)) rules.push('H4')
  return {
    rows: out,
    ignored,
    courseGainKnown,
    climbOverCourse: courseGainKnown && enteredSum > input.courseGainM,
    climbUnknown: !courseGainKnown && segments.some((s) => s.entered === null),
    climb: input.climb ?? null,
    rules,
  }
}
