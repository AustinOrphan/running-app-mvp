import type { ImportBatch, ParsedActivity, WellnessInput } from '../../shared/types.ts'
import type { ImportParsedRequest } from '../api/imports.ts'
import { mergeReport } from './report.ts'

/** Activities per request; each carries up to a few thousand samples. */
export const MAX_PARSED_ACTIVITIES = 200
/** Keeps a request under the server's 16 MB JSON limit even when the activities are large. */
export const MAX_PARSED_JSON_CHARS = 8 * 1024 * 1024
const WELLNESS_PER_REQUEST = 500

export interface ParsedUploadProgress {
  sent: number
  total: number
}

export interface ParsedUploadSummary {
  /** The server's report for the whole upload, `null` when there was nothing to send. */
  batch: ImportBatch | null
  wellnessDays: number
}

/** Groups activities into requests of at most 200 activities and about 8 MB of JSON. */
export function batchParsed(activities: readonly ParsedActivity[]): ParsedActivity[][] {
  const batches: ParsedActivity[][] = []
  let current: ParsedActivity[] = []
  let chars = 0
  for (const activity of activities) {
    const size = JSON.stringify(activity).length
    if (
      current.length > 0 &&
      (current.length >= MAX_PARSED_ACTIVITIES || chars + size > MAX_PARSED_JSON_CHARS)
    ) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(activity)
    chars += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * Sends client-parsed activities, then the wellness rows, in bounded requests. Later requests
 * carry the id of the batch the first one created; the last response is the report.
 */
export async function uploadParsed(
  source: string,
  activities: readonly ParsedActivity[],
  wellness: readonly WellnessInput[],
  send: (request: ImportParsedRequest) => Promise<ImportBatch>,
  opts: { onProgress?: (progress: ParsedUploadProgress) => void; signal?: AbortSignal } = {},
): Promise<ParsedUploadSummary> {
  const requests: Array<Pick<ImportParsedRequest, 'activities' | 'wellness'>> = [
    ...batchParsed(activities).map((batch) => ({ activities: batch, wellness: [] })),
  ]
  for (let i = 0; i < wellness.length; i += WELLNESS_PER_REQUEST) {
    requests.push({ activities: [], wellness: wellness.slice(i, i + WELLNESS_PER_REQUEST) })
  }

  let batch: ImportBatch | null = null
  const total = activities.length + wellness.length
  let sent = 0
  for (const request of requests) {
    if (opts.signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError')
    batch = mergeReport(
      batch,
      await send({ ...(batch ? { batchId: batch.id } : {}), source, ...request }),
    )
    sent += request.activities.length + request.wellness.length
    opts.onProgress?.({ sent, total })
  }
  return { batch, wellnessDays: wellness.length }
}
