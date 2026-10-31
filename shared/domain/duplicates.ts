import type { Activity, DuplicateStatus } from '../types.ts'

/** Two runs on one day from different sources within this distance are one run (0.05 mi). */
export const DUPLICATE_TOLERANCE_M = 80

/** Two start instants this close (seconds) are one start. */
export const START_TOLERANCE_SEC = 120

/** Distances (or, without distance, durations) this close, as a fraction of the larger, match. */
export const RELATIVE_TOLERANCE = 0.05

/** Richness of a source: the lower-ranked activity is the duplicate of the higher-ranked one. */
export const SOURCE_RANK: Record<string, number> = {
  file: 5,
  garmin: 5,
  intervals: 4,
  'apple-health': 4,
  strava: 3,
  smashrun: 2,
  csv: 1,
  manual: 0,
}

/** Sources outside the table rank with csv. */
export function sourceRank(source: string): number {
  return SOURCE_RANK[source] ?? 1
}

/**
 * What `matchActivities` reads. `type` is optional: a row without one is read as a run, which is
 * how a pair of runs was always compared.
 */
type MatchFields = Pick<Activity, 'date' | 'startUtc' | 'distanceM' | 'durationSec'> & {
  type?: string
}

function isRun(activity: Pick<Activity, 'type'>): boolean {
  return activity.type === 'run' || activity.type === 'race'
}

function isStrength(activity: { type?: string }): boolean {
  return activity.type === 'strength'
}

/**
 * The kinds of activity the duplicate pass compares: a run (a race is one) only with a run, a
 * strength session only with a strength session. Cross-training has no rule.
 */
function comparableKind(activity: Pick<Activity, 'type'>): 'run' | 'strength' | null {
  if (isRun(activity)) return 'run'
  return isStrength(activity) ? 'strength' : null
}

function withinRelative(a: number, b: number): boolean {
  return Math.abs(a - b) <= RELATIVE_TOLERANCE * Math.max(a, b)
}

/**
 * How two activities match, or `null`. `'start'`: both have a start instant within
 * START_TOLERANCE_SEC and their distances are within 5% (both without distance: durations within
 * 5%). Two activities that both have a start instant match only that way. Otherwise `'date'`:
 * the same date and distances within DUPLICATE_TOLERANCE_M. A strength session is compared with a
 * strength session only, by `matchStrength`, and never with a run.
 */
export function matchActivities(a: MatchFields, b: MatchFields): 'start' | 'date' | null {
  if (isStrength(a) || isStrength(b)) {
    return isStrength(a) && isStrength(b) ? matchStrength(a, b) : null
  }
  if (a.startUtc !== null && b.startUtc !== null) {
    const gapSec = Math.abs(Date.parse(a.startUtc) - Date.parse(b.startUtc)) / 1000
    if (Number.isNaN(gapSec) || gapSec > START_TOLERANCE_SEC) return null
    if (a.distanceM !== null && b.distanceM !== null) {
      return withinRelative(a.distanceM, b.distanceM) ? 'start' : null
    }
    if (a.distanceM === null && b.distanceM === null) {
      return withinRelative(a.durationSec, b.durationSec) ? 'start' : null
    }
    return null
  }
  if (a.date !== b.date || a.distanceM === null || b.distanceM === null) return null
  return Math.abs(a.distanceM - b.distanceM) <= DUPLICATE_TOLERANCE_M ? 'date' : null
}

/**
 * How two strength sessions match, or `null`. A session has no distance, so the start instant or
 * the duration decides, with the constants of the run rule. Both with a start instant: `'start'`
 * within START_TOLERANCE_SEC, and no match otherwise. Without one on both sides: `'date'` for the
 * same date and durations within RELATIVE_TOLERANCE.
 */
function matchStrength(a: MatchFields, b: MatchFields): 'start' | 'date' | null {
  if (a.startUtc !== null && b.startUtc !== null) {
    const gapSec = Math.abs(Date.parse(a.startUtc) - Date.parse(b.startUtc)) / 1000
    return Number.isNaN(gapSec) || gapSec > START_TOLERANCE_SEC ? null : 'start'
  }
  return a.date === b.date && withinRelative(a.durationSec, b.durationSec) ? 'date' : null
}

/**
 * `confirmed` when both sources are automated (rank 1 or more) and the pair matched on start
 * instant; otherwise `possible`.
 */
export function duplicateStatusFor(
  kind: 'start' | 'date',
  a: Pick<Activity, 'source'>,
  b: Pick<Activity, 'source'>,
): Extract<DuplicateStatus, 'possible' | 'confirmed'> {
  return kind === 'start' && sourceRank(a.source) >= 1 && sourceRank(b.source) >= 1
    ? 'confirmed'
    : 'possible'
}

/** Smaller is closer: distance gap, or duration gap when either lacks distance or is strength. */
function closeness(a: Activity, b: Activity): number {
  return a.type !== 'strength' && a.distanceM !== null && b.distanceM !== null
    ? Math.abs(a.distanceM - b.distanceM)
    : Math.abs(a.durationSec - b.durationSec)
}

/**
 * The activity that `candidate` probably repeats (see matchActivities): a run for a run, a strength
 * session for a strength session, never one for the other. A match from the same source counts
 * only on a start-instant match: importers of one source give the same run different provider
 * keys (an Apple Health export and its push, a FIT and a GPX file), but two runs of similar length
 * on one day are not one, and neither are two strength sessions of similar length. A match on
 * start instant beats a same-date match; then the closest, ties to the earlier row in `others`.
 * Rows already flagged `possible` or `confirmed` are skipped; `dismissed` rows still match.
 */
export function findPossibleDuplicate(candidate: Activity, others: Activity[]): Activity | null {
  const kindOfCandidate = comparableKind(candidate)
  if (kindOfCandidate === null) return null
  let best: Activity | null = null
  let bestKind = Infinity
  let bestGap = Infinity
  for (const other of others) {
    if (other.id === candidate.id) continue
    if (comparableKind(other) !== kindOfCandidate) continue
    if (other.duplicateStatus === 'possible' || other.duplicateStatus === 'confirmed') continue
    const kind = matchActivities(candidate, other)
    if (kind === null || (kind === 'date' && other.source === candidate.source)) continue
    const kindRank = kind === 'start' ? 0 : 1
    const gap = closeness(candidate, other)
    if (kindRank < bestKind || (kindRank === bestKind && gap < bestGap)) {
      best = other
      bestKind = kindRank
      bestGap = gap
    }
  }
  return best
}

/**
 * Source rank decides: the lower one is the duplicate. Equal ranks make `a`, the first argument,
 * the duplicate.
 */
export function pickDuplicate<T extends Pick<Activity, 'id' | 'source'>>(
  a: T,
  b: T,
): { duplicate: T; original: T } {
  return sourceRank(a.source) <= sourceRank(b.source)
    ? { duplicate: a, original: b }
    : { duplicate: b, original: a }
}
