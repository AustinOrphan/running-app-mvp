// The one removal of a runner's Strava-sourced activities (SC1, ADR 0025): Disconnect, a refused
// token (in `sync.ts` and in the daily check) all come here. It imports no sync code, so `sync.ts`
// can call it. Callers hold the runner's Strava lock (`withProviderLock`), and the removal is
// idempotent besides: a row that is already gone is skipped.
import type { Deps } from '../app.ts'
import { STRAVA_KEY } from '../../shared/domain/stravaRemoval.ts'
import { deleteActivities } from './activityStore.ts'

export const PREFIX = `${STRAVA_KEY}:`

/** Activities that came from Strava: the source is the provider key, as `sync.ts` stores it. */
export function stravaWhere(userId: string) {
  return { userId, source: STRAVA_KEY, providerKey: { startsWith: PREFIX } }
}

/** How many activities a disconnect would delete; the confirmation sheet shows it. */
export async function countStravaActivities(deps: Deps, userId: string): Promise<number> {
  return deps.prisma.activity.count({ where: stravaWhere(userId) })
}

/**
 * Deletes every activity that came from Strava, with the import batches and sync runs that name
 * them, and returns the number of activities. Strava-only runs go; a run another source also holds
 * keeps that copy (`deleteActivities`).
 */
export async function removeStravaActivities(deps: Deps, userId: string): Promise<number> {
  const { prisma } = deps
  const rows = await prisma.activity.findMany({ where: stravaWhere(userId), select: { id: true } })
  const removed = await deleteActivities(
    deps,
    userId,
    rows.map((row) => row.id),
  )
  await prisma.importBatch.deleteMany({ where: { userId, source: STRAVA_KEY } })
  await prisma.syncRun.deleteMany({ where: { userId, provider: STRAVA_KEY, channel: 'pull' } })
  return removed
}
