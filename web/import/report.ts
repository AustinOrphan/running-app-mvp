import type { ImportBatch } from '../../shared/types.ts'

/**
 * Folds the response of one request into the report of the upload so far. A request that carried
 * the batch id comes back as the same batch with its totals already including earlier requests, so
 * it replaces the report; a response for a different batch is added to it.
 */
export function mergeReport(previous: ImportBatch | null, next: ImportBatch): ImportBatch {
  if (previous === null || (next.id === previous.id && next.rowCount >= previous.rowCount)) {
    return next
  }
  return {
    ...next,
    id: previous.id,
    rowCount: previous.rowCount + next.rowCount,
    accepted: previous.accepted + next.accepted,
    skippedDuplicate: previous.skippedDuplicate + next.skippedDuplicate,
    skippedInvalid: previous.skippedInvalid + next.skippedInvalid,
    errors: [...previous.errors, ...next.errors],
  }
}
