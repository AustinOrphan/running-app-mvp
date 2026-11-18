// What Strava's API Policy asks the app to do with a runner's Strava data (SC1, ADR 0025):
// - disconnect: revoke at Strava and delete the runner's Strava-sourced activities (7.4);
// - a refused token: delete them at once (`sync.ts`, and the daily check below), no grace period;
// - the daily check: delete local Strava runs that Strava no longer lists (6.3), after a complete
//   listing only.
// Activities go through `deleteActivities` (`activityStore.ts`), the one delete path with the
// duplicate and plan-link care, so a run another source also holds keeps that copy.
import type { Deps } from '../app.ts'
import { SecretError } from '../crypto.ts'
import { getProvider } from '../providers/registry.ts'
import { revokeAccess } from '../providers/strava.ts'
import { ProviderAuthError, RateLimitPause } from '../providers/types.ts'
import { syncMessage, recordSyncRun, safeMessage, secretValues } from './syncLog.ts'
import { deleteActivities } from './activityStore.ts'
import { PREFIX, removeStravaActivities, stravaWhere } from './stravaPurge.ts'
import { openIntegration, providerContext, withProviderLock } from './sync.ts'
import { STRAVA_KEY, withRefusal } from '../../shared/domain/stravaRemoval.ts'
import type { SyncStatus, SyncTrigger } from '../../shared/types.ts'

export { countStravaActivities, removeStravaActivities } from './stravaPurge.ts'

/** The job names in the sync log. */
export const REMOVAL_JOB = 'strava-removal'
export const RECONCILE_JOB = 'strava-reconcile'

async function record(
  deps: Deps,
  userId: string,
  job: string,
  startedAt: Date,
  outcome: {
    trigger: SyncTrigger
    status: SyncStatus
    accepted?: number
    message?: string
  },
): Promise<void> {
  await recordSyncRun(deps, {
    userId,
    provider: job,
    channel: 'job',
    trigger: outcome.trigger,
    startedAt,
    status: outcome.status,
    accepted: outcome.accepted ?? 0,
    ...(outcome.message === undefined
      ? {}
      : { failures: [{ ref: STRAVA_KEY, reason: outcome.message }] }),
  })
}

/**
 * Disconnects Strava for a runner: revokes the token at Strava (best effort), deletes the activities
 * that came from Strava and the row. Returns how many activities were deleted. A revoke that Strava
 * did not accept is recorded as a `partial` run so the runner can remove the app at strava.com.
 */
export async function disconnectStrava(deps: Deps, userId: string, fetchFn?: typeof fetch) {
  const { prisma } = deps
  const startedAt = new Date()
  const row = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: STRAVA_KEY } },
  })
  let revoked = true
  if (row) {
    revoked = false
    try {
      const opened = openIntegration(row, deps.config.sessionSecret)
      const ctx = await providerContext(deps, userId, STRAVA_KEY, { ...opened, fetch: fetchFn })
      revoked = await revokeAccess(ctx)
    } catch (error) {
      // A secret that cannot be read (a changed session secret) has no token to revoke.
      if (!(error instanceof SecretError)) throw error
    }
  }
  const removed = await removeStravaActivities(deps, userId)
  await prisma.integration.deleteMany({ where: { userId, provider: STRAVA_KEY } })
  if (row) {
    await record(deps, userId, REMOVAL_JOB, startedAt, {
      trigger: 'manual',
      status: revoked ? 'ok' : 'partial',
      accepted: removed,
      ...(revoked ? {} : { message: syncMessage('sync.msg.strava-revoke-failed', {}) }),
    })
  }
  return { removed, revoked }
}

/**
 * The daily check (03:30): each connected Strava row is compared with Strava (`reconcile`); a row
 * that needs signing in has nothing to compare and nothing left to delete. Failures are logged and
 * never thrown; the next day tries again.
 */
export async function runStravaJob(
  deps: Deps,
  opts: { fetch?: typeof fetch; now?: Date } = {},
  log?: { warn(obj: object, msg: string): void },
): Promise<void> {
  const now = opts.now ?? new Date()
  const rows = await deps.prisma.integration.findMany({
    where: { provider: STRAVA_KEY },
    orderBy: { createdAt: 'asc' },
  })
  for (const row of rows) {
    try {
      if (row.status !== 'needs_auth') {
        await reconcile(deps, row.userId, row.id, { fetch: opts.fetch, now })
      }
    } catch (error) {
      log?.warn({ reason: safeMessage(error) }, 'strava daily check failed')
    }
  }
}

/**
 * Lists the runner's Strava activities from the oldest stored one (one listing per runner per day,
 * about 2 to 3 reads) and deletes the stored Strava runs that Strava no longer lists. Only a
 * complete listing deletes: a pause, an error, a token Strava refuses or an empty list while runs
 * are stored deletes nothing and records a `partial` (or `error`, for the empty list) run.
 * A run stored after the listing began is never deleted by it.
 */
async function reconcile(
  deps: Deps,
  userId: string,
  rowId: string,
  opts: { fetch?: typeof fetch; now: Date },
): Promise<void> {
  const { prisma } = deps
  const stored = await prisma.activity.findMany({
    where: { ...stravaWhere(userId), startUtc: { not: null } },
    select: { id: true, providerKey: true, startUtc: true, createdAt: true },
  })
  if (stored.length === 0) return
  const row = await prisma.integration.findFirst({ where: { id: rowId, userId } })
  if (!row || row.status === 'needs_auth') return
  const startedAt = new Date()
  const failed = (status: SyncStatus, message: string) =>
    record(deps, userId, RECONCILE_JOB, startedAt, { trigger: 'schedule', status, message })
  if (row.pausedUntil !== null && row.pausedUntil.getTime() > opts.now.getTime()) {
    await failed('partial', syncMessage('sync.msg.strava-check-paused', {}))
    return
  }
  const pull = getProvider(STRAVA_KEY).pull
  if (!pull) return
  const oldest = stored.reduce(
    (min, activity) => Math.min(min, Date.parse(activity.startUtc ?? '')),
    Number.POSITIVE_INFINITY,
  )
  if (!Number.isFinite(oldest)) return
  const since = new Date(oldest - 1000).toISOString()

  // A sync of this runner holds the lock: the check then waits for the next day.
  await withProviderLock(userId, STRAVA_KEY, async () => {
    let opened: ReturnType<typeof openIntegration>
    try {
      opened = openIntegration(row, deps.config.sessionSecret)
    } catch (error) {
      if (!(error instanceof SecretError)) throw error
      await failed('partial', syncMessage('sync.msg.strava-check-incomplete', {}))
      return
    }
    const secrets = secretValues(opened.secret)
    const ctx = await providerContext(deps, userId, STRAVA_KEY, {
      ...opened,
      fetch: opts.fetch,
    })
    const listedAt = ctx.now()
    const listed = new Set<string>()
    try {
      for await (const ref of pull.listActivities(since, ctx)) listed.add(ref.id)
    } catch (error) {
      if (error instanceof ProviderAuthError) {
        // The check found the refusal first: the runs go at once, as they do in a sync, and a
        // reconnect reads the last year again (the cursor is cleared).
        const removed = await removeStravaActivities(deps, userId)
        await prisma.integration.updateMany({
          where: { id: row.id, userId },
          data: {
            status: 'needs_auth',
            cursor: null,
            lastError: safeMessage(error, secrets),
            config: JSON.stringify(withRefusal(opened.config, listedAt)),
          },
        })
        await record(deps, userId, REMOVAL_JOB, startedAt, {
          trigger: 'schedule',
          status: 'ok',
          accepted: removed,
        })
        await failed('partial', syncMessage('sync.msg.strava-check-refused', {}))
      } else if (error instanceof RateLimitPause) {
        await prisma.integration.updateMany({
          where: { id: row.id, userId },
          data: { pausedUntil: new Date(listedAt.getTime() + error.retryAfterSec * 1000) },
        })
        await failed('partial', syncMessage('sync.msg.strava-check-paused', {}))
      } else {
        await failed('partial', syncMessage('sync.msg.strava-check-incomplete', {}))
      }
      return
    }
    if (listed.size === 0) {
      await failed('error', syncMessage('sync.msg.strava-check-empty', {}))
      return
    }
    const gone = stored.filter(
      (activity) =>
        activity.createdAt.getTime() <= listedAt.getTime() &&
        !listed.has(activity.providerKey?.slice(PREFIX.length) ?? ''),
    )
    const removed = await deleteActivities(
      deps,
      userId,
      gone.map((activity) => activity.id),
    )
    await record(deps, userId, RECONCILE_JOB, startedAt, {
      trigger: 'schedule',
      status: 'ok',
      accepted: removed,
    })
  })
}
