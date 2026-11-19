import type { Deps } from '../app.ts'
import { createLogger } from '../logger.ts'
import { backfillHrQuality } from './hrQualityBackfill.ts'
import { queueSurfaceFill } from './surfaceFill.ts'
import { safeMessage } from './syncLog.ts'
import { backfillTerrainBins } from './terrainBackfill.ts'
import { backfillTracks } from './trackBackfill.ts'

/**
 * Fills the columns derived from the stored stream and original (terrain bins, heart-rate quality,
 * the route track, then the trail and road shares in the background) for one
 * activity right after the runner changed its type or sub-type (ADR 0026). A run re-typed from
 * cross to run has a stream and no bins, and nothing else would write them until the next start.
 * Each backfill selects only stale rows, so an edit that leaves nothing owed costs one indexed
 * query and writes nothing. A failure is logged and never fails the edit.
 *
 * Runs before the execution pass, which reads the heart-rate quality of the run it assesses.
 */
export async function refreshDerivedAfterEdit(
  deps: Deps,
  userId: string,
  activityId: string,
): Promise<void> {
  const ids = [activityId]
  for (const [column, fill] of [
    ['terrain', () => backfillTerrainBins(deps, userId, { ids })],
    ['hr-quality', () => backfillHrQuality(deps, userId, { ids })],
    // A run re-typed from cross to run has an original and no look for positions yet: parse it
    // here, locally. The stream part (intervals.icu) is not asked inside a request.
    [
      'track',
      () =>
        backfillTracks(deps, userId, {
          activityIds: ids,
          parts: { files: true, streams: false },
        }),
    ],
  ] as const) {
    try {
      await fill()
    } catch (error) {
      createLogger(deps.config).warn(
        { reason: safeMessage(error), userId, column },
        'derived column refresh after an edit failed',
      )
    }
  }
  // A run re-typed to run keeps its track, and its shares were cleared while it had another type
  // (`surfaceBackfill.ts` selects runs and races only). Fire and forget; no map area costs one read.
  void queueSurfaceFill(deps, userId)
}
