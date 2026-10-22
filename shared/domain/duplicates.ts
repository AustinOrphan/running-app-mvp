import type { Activity, ActivitySource } from '../types.ts'

/** Two runs on one day from different sources within this distance are one run (0.05 mi). */
export const DUPLICATE_TOLERANCE_M = 80

const SOURCE_RANK: Record<ActivitySource, number> = { manual: 0, csv: 1, smashrun: 2 }

function isRun(activity: Pick<Activity, 'type'>): boolean {
  return activity.type === 'run' || activity.type === 'race'
}

/**
 * The same-day run, from another source, that `candidate` probably repeats: distance within
 * DUPLICATE_TOLERANCE_M, closest first, ties to the earlier row in `sameDayRuns`. Rows already
 * flagged `possible` or `confirmed` are skipped; `dismissed` rows still match.
 */
export function findPossibleDuplicate(
  candidate: Activity,
  sameDayRuns: Activity[],
): Activity | null {
  if (!isRun(candidate) || candidate.distanceM === null) return null
  let best: Activity | null = null
  let bestGap = Infinity
  for (const other of sameDayRuns) {
    if (other.id === candidate.id || other.date !== candidate.date) continue
    if (other.source === candidate.source || !isRun(other) || other.distanceM === null) continue
    if (other.duplicateStatus === 'possible' || other.duplicateStatus === 'confirmed') continue
    const gap = Math.abs(other.distanceM - candidate.distanceM)
    if (gap <= DUPLICATE_TOLERANCE_M && gap < bestGap) {
      best = other
      bestGap = gap
    }
  }
  return best
}

/**
 * Source precedence manual < csv < smashrun: the lower one is the duplicate. Equal sources
 * (not expected) make `a`, the first argument, the duplicate.
 */
export function pickDuplicate<T extends Pick<Activity, 'id' | 'source'>>(
  a: T,
  b: T,
): { duplicate: T; original: T } {
  return SOURCE_RANK[a.source] <= SOURCE_RANK[b.source]
    ? { duplicate: a, original: b }
    : { duplicate: b, original: a }
}
