// Back-test scorer (rule L7, phase 3a design section 11.5). Pure and deterministic: it compares the
// predictions the app logged with a recorded race result and describes the difference. It never
// changes a prediction, the model or the minimum band (L6); a recalibration from results would be a
// separate rule that the runner accepts first.
//
// SIGN CONVENTION. Every error in this module is the result minus the prediction:
//   errorSec = resultSec - predictedSec
//   errorPct = errorSec / predictedSec * 100
// A positive error means the runner finished slower than predicted; a negative error means faster;
// zero means the result matched. The difference has a direction and is never pass or fail.
//
// What is scored, and what is not:
//   - only predictions logged before race day (`loggedBeforeRaceDay`); a prediction made on or after
//     the day, or after the fact, is never scored;
//   - only predictions for a comparable course (`isComparableCourse`);
//   - a did-not-finish is recorded and not scored.
//
// The caller passes at most one prediction per local week (the newest of the week, collapsed before
// scoring); this module scores what it is given.
//
// Counting. Coverage is counted per race on the final (headline) prediction, and a result that lies
// on the edge of the range is inside. The weekly predictions of one race depend on each other, so
// the cross-race summary takes one point per race (its headline) and shows a pattern only from
// `P.l7.minRacesForSummary` scored races (G3).
import { daysBetween, mondayOf } from '../dates.ts'
import { P } from './params/index.ts'

const DAYS_PER_WEEK = 7

export type RaceOutcome = 'finished' | 'did-not-finish'

/** The course a prediction was made for. `null` fields are unknown. */
export interface CourseSnapshot {
  distanceM: number | null
  gainM: number | null
}

/** One logged prediction, as scoring needs it. `course` is null for rows logged before snapshots. */
export interface LoggedPrediction {
  /** Monday of the local week the prediction belongs to. */
  weekStart: string
  /** Local day (`YYYY-MM-DD`) the prediction was made. */
  loggedOn: string
  predictedSec: number
  lowSec: number
  highSec: number
  course: CourseSnapshot | null
}

/** A recorded race result, as scoring needs it. */
export interface RaceResultInput {
  /** Race day, `YYYY-MM-DD`. */
  date: string
  outcome: RaceOutcome
  /** Official finish time; only read when the outcome is `finished`. */
  timeSec: number | null
  /** The raced distance. */
  distanceM: number
  gainM: number | null
}

/** One prediction held against the result. Errors follow the sign convention above. */
export interface ScoredPrediction {
  weekStart: string
  loggedOn: string
  /** Whole days from the day the prediction was made to race day; at least 1. */
  daysBefore: number
  /** Calendar weeks from the prediction's week to the race week; 0 in the race week. */
  weeksBefore: number
  predictedSec: number
  lowSec: number
  highSec: number
  /** Result minus prediction, seconds; negative is faster. */
  errorSec: number
  /** `errorSec` as a share of the prediction, percent, not rounded. */
  errorPct: number
  /** The result lies in the range; the edges count as inside. */
  inside: boolean
}

/** All the predictions of one goal held against its race. */
export interface RaceScore {
  date: string
  outcome: RaceOutcome
  /** The finish time when it was scored; null for a did-not-finish or a missing time. */
  resultSec: number | null
  /** Scored predictions, oldest first. */
  points: ScoredPrediction[]
  /** The last scored prediction before race day, or null when nothing was scored. */
  headline: ScoredPrediction | null
  /** Per-race coverage: the headline's range held the result. Null when nothing was scored. */
  inside: boolean | null
  /** Predictions logged before race day that were not scored (a did-not-finish, another course). */
  unscoredCount: number
}

/** The cross-race summary. The pattern fields stay null until there are enough scored races. */
export interface RecordSummary {
  /** Races with a scored headline. */
  raceCount: number
  /** Races whose headline range held the result; null until `enough`. */
  insideCount: number | null
  /** Median of the headlines' signed errors, percent (negative is faster); null until `enough`. */
  medianSignedPct: number | null
  /** Median of the headlines' absolute errors, percent; null until `enough`. */
  medianAbsPct: number | null
  enough: boolean
  /** Scored races still missing before the summary shows; 0 once `enough`. */
  needed: number
}

/** Whole days from the day a prediction was made to race day; negative after race day. */
export function daysBefore(raceDate: string, loggedOn: string): number {
  return daysBetween(loggedOn, raceDate)
}

/**
 * Whether a prediction logged on `loggedOn` counts as made before race day: at least one whole day
 * before. The scorer and the `actualSec` column of the log both use this one rule.
 */
export function loggedBeforeRaceDay(raceDate: string, loggedOn: string): boolean {
  return daysBefore(raceDate, loggedOn) >= 1
}

/** Calendar weeks (Monday to Monday) from the week of `loggedOn` to the race week. */
export function weeksBefore(raceDate: string, loggedOn: string): number {
  return Math.round(daysBetween(mondayOf(loggedOn), mondayOf(raceDate)) / DAYS_PER_WEEK)
}

/** The median of the values, or null for none; an even count averages the middle two. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/** |predicted - raced| within `tolerancePct` percent of `raced`, in integer-safe arithmetic. */
function within(predicted: number, raced: number, tolerancePct: number): boolean {
  return raced > 0 && Math.abs(predicted - raced) * 100 <= tolerancePct * raced
}

/**
 * Whether a prediction was made for the course that was raced: the distance lies within
 * `tolerancePct` of the raced distance. When both courses state their climb, the climb counts as
 * flat distance (L5) in the comparison, so a goal re-entered with very different gain does not
 * compare. A course the log did not record (rows from before snapshots, an unknown distance) is
 * taken as comparable: nothing says it differs. Weather is a condition, not part of the course.
 */
export function isComparableCourse(
  predicted: CourseSnapshot | null,
  raced: CourseSnapshot,
  tolerancePct: number = P.l7.courseTolerancePct.value,
): boolean {
  if (predicted === null || predicted.distanceM === null || raced.distanceM === null) return true
  // The climb enters only when both courses state it, so a missing figure never decides alone.
  const withClimb = predicted.gainM !== null && raced.gainM !== null
  const flat = (distanceM: number, gainM: number | null): number =>
    withClimb ? distanceM + (gainM ?? 0) * P.l5.gainEquivalentM.value : distanceM
  return within(
    flat(predicted.distanceM, predicted.gainM),
    flat(raced.distanceM, raced.gainM),
    tolerancePct,
  )
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** A prediction with times that can be divided by and compared. */
function isUsable(p: LoggedPrediction): boolean {
  return (
    isFiniteNumber(p.predictedSec) &&
    p.predictedSec > 0 &&
    isFiniteNumber(p.lowSec) &&
    isFiniteNumber(p.highSec) &&
    p.lowSec <= p.highSec
  )
}

/** The finish time to score against, or null when the result has none to compare. */
function finishSec(result: RaceResultInput): number | null {
  if (result.outcome !== 'finished') return null
  return isFiniteNumber(result.timeSec) && result.timeSec > 0 ? result.timeSec : null
}

/** Predictions logged before race day, oldest first (a stable sort keeps the input order). */
function beforeRaceDay(
  predictions: readonly LoggedPrediction[],
  result: RaceResultInput,
): LoggedPrediction[] {
  return predictions
    .filter((p) => loggedBeforeRaceDay(result.date, p.loggedOn))
    .sort((a, b) => (a.loggedOn < b.loggedOn ? -1 : a.loggedOn > b.loggedOn ? 1 : 0))
}

/**
 * Holds each prediction against a finished result, oldest first. Returns nothing for a
 * did-not-finish or a result without a time, and skips predictions made on or after race day,
 * for another course or with unusable times.
 */
export function scorePredictions(
  predictions: readonly LoggedPrediction[],
  result: RaceResultInput,
): ScoredPrediction[] {
  const resultSec = finishSec(result)
  if (resultSec === null) return []
  const raced: CourseSnapshot = { distanceM: result.distanceM, gainM: result.gainM }
  return beforeRaceDay(predictions, result)
    .filter((p) => isUsable(p) && isComparableCourse(p.course, raced))
    .map((p) => {
      const errorSec = resultSec - p.predictedSec
      return {
        weekStart: p.weekStart,
        loggedOn: p.loggedOn,
        daysBefore: daysBefore(result.date, p.loggedOn),
        weeksBefore: weeksBefore(result.date, p.loggedOn),
        predictedSec: p.predictedSec,
        lowSec: p.lowSec,
        highSec: p.highSec,
        errorSec,
        errorPct: (errorSec / p.predictedSec) * 100,
        inside: p.lowSec <= resultSec && resultSec <= p.highSec,
      }
    })
}

/**
 * One goal's predictions against its race: the scored points, the headline (the last scored
 * prediction before race day), per-race coverage on that headline, and how many predictions logged
 * before race day were left unscored.
 */
export function scoreRace(
  predictions: readonly LoggedPrediction[],
  result: RaceResultInput,
): RaceScore {
  const points = scorePredictions(predictions, result)
  const headline = points.length === 0 ? null : (points[points.length - 1] as ScoredPrediction)
  return {
    date: result.date,
    outcome: result.outcome,
    resultSec: finishSec(result),
    points,
    headline,
    inside: headline === null ? null : headline.inside,
    unscoredCount: beforeRaceDay(predictions, result).length - points.length,
  }
}

/**
 * The cross-race summary from each race's headline only: one point per race. Races with nothing
 * scored (a did-not-finish) do not count. The pattern (inside count, medians) is null until
 * `minRaces` races are scored.
 */
export function summariseRecord(
  races: readonly RaceScore[],
  minRaces: number = P.l7.minRacesForSummary.value,
): RecordSummary {
  const headlines = races.flatMap((race) => (race.headline === null ? [] : [race.headline]))
  const raceCount = headlines.length
  const enough = raceCount >= minRaces
  return {
    raceCount,
    insideCount: enough ? headlines.filter((h) => h.inside).length : null,
    medianSignedPct: enough ? median(headlines.map((h) => h.errorPct)) : null,
    medianAbsPct: enough ? median(headlines.map((h) => Math.abs(h.errorPct))) : null,
    enough,
    needed: Math.max(0, minRaces - raceCount),
  }
}
