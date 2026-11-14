import type { Deps } from '../app.ts'
import { SecretError } from '../crypto.ts'
import { getProvider } from '../providers/registry.ts'
import { ProviderAuthError, ProviderHttpError, RateLimitPause } from '../providers/types.ts'
import { settleWatchRatings } from './activityStore.ts'
import { isSyncing, openIntegration, providerContext } from './sync.ts'
import { safeMessage, secretValues } from './syncLog.ts'
import { addDays, todayIso } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'

/**
 * intervals.icu activity requests per user per call. With the 5-minute tick that is one request a
 * minute, far under the provider's limits (data preparation, not an engine Param).
 */
export const WATCH_RATING_BATCH = 5
/** Failed requests for one run (a 4xx the provider sent for it) before the run is marked unrated. */
export const WATCH_RATING_MAX_ATTEMPTS = 3
/** How long the job leaves an integration alone after intervals.icu refused its key. */
export const WATCH_RATING_AUTH_BACKOFF_MS = 60 * 60_000

const PROVIDER = 'intervals'
const RUN_TYPES = ['run', 'race']
/** Failed requests per activity since the process started; a restart starts the count again. */
const attempts = new Map<string, number>()
/** When the job may ask an integration again after an auth refusal, with its `updatedAt` then. */
const authBlocked = new Map<string, { until: number; stamp: number }>()

export interface WatchRatingBackfillResult {
  /** Runs that now have a watch rating. */
  filled: number
  /** Runs looked at that hold no rating (or are gone from intervals.icu): marked, no write to `rpe`. */
  unrated: number
  /** intervals.icu requests made. */
  requests: number
  /** Failures that left a run for the next call, as `{ ref, reason }`. */
  failures: Array<{ ref: string; reason: string }>
  /** Set when intervals.icu answered 429 or the integration is paused. */
  pause: { retryAfterSec: number } | null
  /** Set when intervals.icu refused the key: the job stopped and waits for a reconnect or an hour. */
  authRefused: boolean
  /** Runs still waiting for a look. */
  remaining: number
}

/** Pulled intervals.icu runs and races in the history window with no rating, not looked at yet. */
function waiting(userId: string, from: string) {
  return {
    userId,
    rpe: null,
    watchRpeV: null,
    type: { in: RUN_TYPES },
    providerKey: { startsWith: `${PROVIDER}:` },
    date: { gte: from },
  }
}

/**
 * Asks intervals.icu for the watch rating of runs stored before the import read it, or rated on the
 * watch after their first sync (`Activity.rpe` null, pulled from intervals.icu, inside the history
 * window the spread check reads, `P.a5.historyWindowDays`). Newest first, `WATCH_RATING_BATCH` per
 * call, only while the integration is connected, not paused and not syncing. One `/activity/{id}`
 * request each through the provider's `fetchRating` (the injected `fetch`). Idempotent: a run asked
 * about is marked (`watchRpeV`) with or without a rating and never selected again, so a rating
 * entered later in intervals.icu is not picked up for it; a stored rating (`watch` or `app`) is never
 * replaced, since a run with `rpe` is not selected and the write re-checks that it is null.
 *
 * A 429 stops the call and sets the integration's `pausedUntil` as the sync does; a 401 or 403 stops
 * it for an hour (the sync's needs-auth handling owns the reconnect); a 404 or a record with no
 * rating marks the run. A 4xx the provider sent for a run counts toward giving it up (marked after
 * `WATCH_RATING_MAX_ATTEMPTS`); a 5xx, a rejected fetch or a body that is not JSON is an outage, ends
 * the call and never counts. The writes of a call are one transaction at its end.
 */
export async function backfillWatchRatings(
  deps: Deps,
  userId: string,
  opts: { limit?: number; now?: Date } = {},
): Promise<WatchRatingBackfillResult> {
  const { prisma } = deps
  const now = opts.now ?? new Date()
  const from = addDays(todayIso(now), -P.a5.historyWindowDays.value)
  const result: WatchRatingBackfillResult = {
    filled: 0,
    unrated: 0,
    requests: 0,
    failures: [],
    pause: null,
    authRefused: false,
    remaining: 0,
  }

  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  })
  const pull = getProvider(PROVIDER).pull
  if (!integration || !pull?.fetchRating || integration.status !== 'connected') return result

  const where = waiting(userId, from)
  const block = authBlocked.get(integration.id)
  if (integration.pausedUntil !== null && integration.pausedUntil > now) {
    result.pause = {
      retryAfterSec: Math.ceil((integration.pausedUntil.getTime() - now.getTime()) / 1000),
    }
  } else if (
    block !== undefined &&
    block.until > now.getTime() &&
    block.stamp === integration.updatedAt.getTime()
  ) {
    // intervals.icu refused the key a moment ago; the sync's needs-auth handling takes it from here.
  } else if (!isSyncing(userId, PROVIDER)) {
    await askForRatings(integration)
  }

  async function askForRatings(row: NonNullable<typeof integration>): Promise<void> {
    let opened: ReturnType<typeof openIntegration>
    try {
      opened = openIntegration(row, deps.config.sessionSecret)
    } catch (error) {
      if (error instanceof SecretError) return
      throw error
    }
    const secrets = secretValues(opened.secret)
    const ctx = await providerContext(deps, userId, PROVIDER, opened)
    const runs = await prisma.activity.findMany({
      where,
      select: { id: true, providerKey: true, startUtc: true, updatedAt: true },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      take: opts.limit ?? WATCH_RATING_BATCH,
    })
    const settled: Array<{ id: string; updatedAt: Date; rating: number | null }> = []
    try {
      for (const run of runs) {
        const remoteId = run.providerKey!.slice(PROVIDER.length + 1)
        try {
          result.requests += 1
          const rating = await pull!.fetchRating!(
            { id: remoteId, startUtc: run.startUtc ?? now.toISOString() },
            ctx,
          )
          attempts.delete(run.id)
          settled.push({ id: run.id, updatedAt: run.updatedAt, rating })
        } catch (error) {
          if (error instanceof RateLimitPause) {
            const until = new Date(now.getTime() + error.retryAfterSec * 1000)
            await prisma.integration.updateMany({
              where: { id: row.id, userId },
              data: { pausedUntil: until },
            })
            result.pause = { retryAfterSec: error.retryAfterSec }
            return
          }
          if (error instanceof ProviderAuthError) {
            authBlocked.set(row.id, {
              until: now.getTime() + WATCH_RATING_AUTH_BACKOFF_MS,
              stamp: row.updatedAt.getTime(),
            })
            result.authRefused = true
            result.failures.push({ ref: run.providerKey!, reason: safeMessage(error, secrets) })
            return
          }
          const reason = safeMessage(error, secrets)
          const runSpecific =
            error instanceof ProviderHttpError && error.status >= 400 && error.status < 500
          const tries = (attempts.get(run.id) ?? 0) + 1
          if (!runSpecific || tries < WATCH_RATING_MAX_ATTEMPTS) {
            if (runSpecific) attempts.set(run.id, tries)
            result.failures.push({ ref: run.providerKey!, reason })
            return
          }
          // A run that fails every tick would block the ones behind it: give it up like a 404.
          attempts.delete(run.id)
          result.failures.push({
            ref: run.providerKey!,
            reason: `${reason} (given up after ${String(tries)} attempts)`,
          })
          settled.push({ id: run.id, updatedAt: run.updatedAt, rating: null })
        }
      }
    } finally {
      // Whatever was learned before a pause, a refused key or an outage is kept.
      result.filled = await settleWatchRatings(deps, userId, settled)
      result.unrated = settled.length - result.filled
    }
  }

  result.remaining = await prisma.activity.count({ where })
  return result
}
