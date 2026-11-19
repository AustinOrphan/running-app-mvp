import { daysBetween } from '../dates.ts'
import type { Activity } from '../types.ts'
import { comparableKind } from './duplicates.ts'

/**
 * How far apart (days) two entries of one session may be dated: a late session logged after
 * midnight, or a zone shift between the app and the watch.
 */
export const MERGE_MAX_DAYS = 1

type MergeFields = Pick<Activity, 'id' | 'type' | 'date' | 'duplicateStatus' | 'duplicateOfId'>

/** Why a manual merge is refused, or `null`. The words are `mergeRefusalText`. */
export type MergeRefusal = 'same' | 'kind' | 'days' | 'copy'

/** What a candidate in the picker needs, as `GET /api/activities/:id/merge-candidates` sends it. */
export interface MergeCandidate {
  id: string
  date: string
  startTime: string | null
  type: Activity['type']
  durationSec: number
  source: string
  avgHr: number | null
}

/**
 * Whether `a` and `b` are already one session by hand or by the pass: one is a confirmed duplicate
 * of the other. A merge of such a pair changes nothing.
 */
export function alreadyMerged(a: MergeFields, b: MergeFields): boolean {
  return (
    (a.duplicateStatus === 'confirmed' && a.duplicateOfId === b.id) ||
    (b.duplicateStatus === 'confirmed' && b.duplicateOfId === a.id)
  )
}

/** True for a confirmed duplicate of an activity other than `other`. */
function copyOfAnother(row: MergeFields, other: MergeFields): boolean {
  return row.duplicateStatus === 'confirmed' && row.duplicateOfId !== other.id
}

/**
 * The reason two entries cannot be merged by hand, or `null`: a run (a race is one) only with a run
 * and a strength session only with a strength session, dated within `MERGE_MAX_DAYS`, and neither
 * already a confirmed duplicate of something else. The start instants and the lengths are not
 * compared: the runner has said these are one session, and the automatic pass would not have.
 */
export function mergeRefusal(a: MergeFields, b: MergeFields): MergeRefusal | null {
  if (a.id === b.id) return 'same'
  const kind = comparableKind(a)
  if (kind === null || kind !== comparableKind(b)) return 'kind'
  if (Math.abs(daysBetween(a.date, b.date)) > MERGE_MAX_DAYS) return 'days'
  if (copyOfAnother(a, b) || copyOfAnother(b, a)) return 'copy'
  return null
}
