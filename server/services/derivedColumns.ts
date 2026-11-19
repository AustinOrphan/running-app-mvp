import type { Deps } from '../app.ts'
import { createLogger } from '../logger.ts'
import { backfillHrQuality } from './hrQualityBackfill.ts'
import { safeMessage } from './syncLog.ts'
import { backfillTerrainBins } from './terrainBackfill.ts'

/**
 * Fills the columns derived from the stored stream (terrain bins, heart-rate quality) for one
 * activity right after the runner changed its type or sub-type (ADR 0026). A run re-typed from
 * cross to run has a stream and no bins, and nothing else would write them until the next start.
 * Each backfill selects only stale rows, so an edit that leaves nothing owed costs one indexed
 * query and writes nothing. A failure is logged and never fails the edit.
 *
 * Runs before the execution pass, which reads the heart-rate quality of the run it assesses.
 */
export async function refreshDerivedAfterEdit(
  deps: Pick<Deps, 'prisma' | 'config'>,
  userId: string,
  activityId: string,
): Promise<void> {
  const ids = [activityId]
  for (const [column, fill] of [
    ['terrain', () => backfillTerrainBins(deps, userId, { ids })],
    ['hr-quality', () => backfillHrQuality(deps, userId, { ids })],
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
}
