import type { Deps } from '../app.ts'
import { createLogger } from '../logger.ts'
import { drainUser, type StartPassChunk } from './startPass.ts'
import { backfillSurfaceBins, newWayIndexHolder, openSurfaceArea } from './surfaceBackfill.ts'
import { recordJob, safeMessage } from './syncLog.ts'

type SurfaceDeps = Pick<Deps, 'prisma' | 'config'>

/**
 * Trail and road shares follow their events (ADR 0026): a finished map download, an import or a
 * track fill that wrote a track, and a type edit each call `queueSurfaceFill`, and the start pass
 * (`surfaceChunkFor`) applies a `SURFACE_VERSION` bump or catches up what predates the column.
 * Nothing polls.
 */

/** Per user: the batch in flight, so two never run at once. */
const tails = new Map<string, Promise<unknown>>()

function locked<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const run = (tails.get(userId) ?? Promise.resolve()).then(work, work)
  const tail = run.catch(() => undefined)
  tails.set(userId, tail)
  void tail.then(() => {
    if (tails.get(userId) === tail) tails.delete(userId)
  })
  return run
}

/** The start pass's batch for each user: one `backfillSurfaceBins` call, one way index per user. */
export function surfaceChunkFor(
  deps: SurfaceDeps,
): (userId: string) => () => Promise<StartPassChunk> {
  return (userId) => {
    const wayIndex = newWayIndexHolder()
    return () => locked(userId, () => backfillSurfaceBins(deps, userId, { wayIndex }))
  }
}

interface Flight {
  promise: Promise<void>
  /** Set by a call that arrives while the drain runs: the drain goes once more. */
  again: boolean
}

const flights = new Map<string, Flight>()
const background = new Set<Promise<unknown>>()

/**
 * Computes the trail and road shares of the user's runs in the background and returns at once with
 * the drain's promise, which never rejects. One drain runs per user: a call during a drain only
 * sets a flag, and the drain goes round once more after it (a download or an import that landed
 * mid-drain is picked up). A drain builds the way index once, calls `backfillSurfaceBins` batch
 * after batch with a yield between them, and records one `surface` run, trigger `event`, unless
 * the user has no map area or nothing was owed. A failure is recorded as an error run.
 */
export function queueSurfaceFill(deps: SurfaceDeps, userId: string): Promise<void> {
  const flying = flights.get(userId)
  if (flying) {
    flying.again = true
    return flying.promise
  }
  const flight: Flight = { again: false, promise: Promise.resolve() }
  flight.promise = (async () => {
    do {
      flight.again = false
      await drainOnce(deps, userId)
    } while (flight.again)
  })().finally(() => {
    flights.delete(userId)
    background.delete(flight.promise)
  })
  flights.set(userId, flight)
  background.add(flight.promise)
  return flight.promise
}

async function drainOnce(deps: SurfaceDeps, userId: string): Promise<void> {
  const startedAt = new Date()
  try {
    // Most imports and edits belong to a runner who never downloaded a map: no row, no log entry.
    if ((await openSurfaceArea(deps.prisma, userId)) === null) return
    const wayIndex = newWayIndexHolder()
    const result = await drainUser(() =>
      locked(userId, () => backfillSurfaceBins(deps, userId, { wayIndex })),
    )
    await recordJob(deps, 'surface', userId, startedAt, {
      trigger: 'event',
      accepted: result.filled,
      failed: result.unreadable.length,
      status: result.unreadable.length > 0 ? 'partial' : 'ok',
      failures: result.unreadable.map((ref) => ({
        ref,
        reason: 'the stored track could not be read',
      })),
      skipIdle: true,
    })
  } catch (error) {
    try {
      createLogger(deps.config).warn({ reason: safeMessage(error), userId }, 'surface fill failed')
      await recordJob(deps, 'surface', userId, startedAt, { trigger: 'event', error })
    } catch {
      // The log itself is broken (or the database is closing); nothing else to do.
    }
  }
}

/** Resolves when every drain started so far has finished; tests await it before closing. */
export async function settleSurfaceFill(): Promise<void> {
  while (background.size > 0) await Promise.all([...background])
}
