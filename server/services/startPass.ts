import type { Deps } from '../app.ts'
import type { createLogger } from '../logger.ts'
import { recordJob, safeMessage } from './syncLog.ts'

type Log = ReturnType<typeof createLogger>

/**
 * One batch of a backfill for one user (ADR 0026). The backfill services return this shape, so
 * `() => backfillTerrainBins(deps, userId)` is a chunk as it stands.
 */
export interface StartPassChunk {
  /** Rows the batch wrote. A batch that wrote none ends the drain. */
  filled: number
  /** References of the rows whose stored source could not be read (they were written as empty). */
  unreadable: readonly string[]
  /** Rows the batch left for the next one. */
  remaining: number
}

export interface DrainResult {
  filled: number
  unreadable: string[]
}

/** Lets the event loop serve requests between two batches. */
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * Calls `chunk` until the user has nothing left. Each call is one existing backfill batch (20 rows
 * in one transaction), so no single step blocks the event loop longer than one tick of the old
 * 5-minute jobs did, and `setImmediate` runs between two of them. The drain stops when nothing
 * remains, when a batch wrote nothing (rows whose guarded write loses a race would otherwise loop
 * for ever), or when `stopped()` is true.
 */
export async function drainUser(
  chunk: () => Promise<StartPassChunk>,
  opts: { stopped?: () => boolean } = {},
): Promise<DrainResult> {
  const total: DrainResult = { filled: 0, unreadable: [] }
  while (opts.stopped?.() !== true) {
    const result = await chunk()
    total.filled += result.filled
    total.unreadable.push(...result.unreadable)
    if (result.remaining === 0 || result.filled === 0) break
    await yieldToLoop()
  }
  return total
}

/**
 * Runs a backfill once for every user, as a start pass (ADR 0026): users are read once, a user's
 * failure is logged and recorded as an error run and the next user still runs. Each user gets at
 * most one `job` run, trigger `catchup`, `accepted` the rows written and `failed` the unreadable
 * sources (a `partial` run when there are any); a pass with nothing to report is not stored
 * (`skipIdle`). The pass ends with one log line of counts only, when anything happened.
 */
export async function runStartPass(
  deps: Deps,
  job: string,
  chunkFor: (userId: string) => () => Promise<StartPassChunk>,
  opts: { stopped?: () => boolean; log?: Log; failureReason?: string } = {},
): Promise<void> {
  const users = await deps.prisma.user.findMany({ select: { id: true } })
  let filled = 0
  let failed = 0
  let errors = 0
  for (const user of users) {
    if (opts.stopped?.() === true) break
    const startedAt = new Date()
    try {
      const result = await drainUser(chunkFor(user.id), { stopped: opts.stopped })
      filled += result.filled
      failed += result.unreadable.length
      await recordJob(deps, job, user.id, startedAt, {
        trigger: 'catchup',
        accepted: result.filled,
        failed: result.unreadable.length,
        status: result.unreadable.length > 0 ? 'partial' : 'ok',
        failures: result.unreadable.map((ref) => ({
          ref,
          reason: opts.failureReason ?? 'the stored stream could not be read',
        })),
        skipIdle: true,
      })
    } catch (error) {
      errors += 1
      opts.log?.warn({ reason: safeMessage(error), userId: user.id, job }, 'start pass failed')
      await recordJob(deps, job, user.id, startedAt, { trigger: 'catchup', error })
    }
  }
  if (filled + failed + errors > 0) {
    opts.log?.info({ job, users: users.length, filled, failed, errors }, 'start pass done')
  }
}
