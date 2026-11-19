import type { Deps } from '../app.ts'
import { SecretError } from '../crypto.ts'
import { getProvider } from '../providers/registry.ts'
import { ProviderAuthError, ProviderHttpError, RateLimitPause } from '../providers/types.ts'
import { settleWatchRatings } from './activityStore.ts'
import { runExecutionQuietly } from './execution.ts'
import { isSyncing, openIntegration, providerContext, TAIL_SYSTEMIC_4XX } from './sync.ts'
import { safeMessage, secretValues } from './syncLog.ts'
import { addDays } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'

/**
 * intervals.icu activity requests per user per call (data preparation, not an engine Param). A
 * pass after the hourly sync (`runWatchRatingPass`) calls until `WATCH_RATING_PASS_MAX` is spent.
 */
export const WATCH_RATING_BATCH = 5
/**
 * intervals.icu activity requests per user per sync tail: 60 an hour, the budget the retired
 * 5-minute job spent (5 every 5 minutes), far under the provider's limits.
 */
export const WATCH_RATING_PASS_MAX = 60
/** Failed requests for one run (a 4xx the provider sent for it) before the run is marked unrated. */
export const WATCH_RATING_MAX_ATTEMPTS = 3
/** How long the job leaves an integration alone after intervals.icu refused its key. */
export const WATCH_RATING_AUTH_BACKOFF_MS = 60 * 60_000

/**
 * How long a run is passed over after `WATCH_RATING_MAX_ATTEMPTS` failures that say nothing about
 * the run (an outage, a body that is not JSON, a refused key). It is not marked, so the rating is
 * asked for again later; the newest-first selection no longer meets it first every tick.
 */
export const WATCH_RATING_DEFER_MS = 6 * 60 * 60_000

const PROVIDER = 'intervals'
/** Runs passed over until the given time (ms) after repeated failures; a restart clears it. */
const deferred = new Map<string, number>()
/** The integration's `updatedAt` at the last call, to notice a reconnect. */
const integrationStamp = new Map<string, number>()
const RUN_TYPES = ['run', 'race']
/** Failed requests per activity since the process started; a restart starts the count again. */
const attempts = new Map<string, number>()
/** Failures that say nothing about the run, per activity since the process started. */
const outages = new Map<string, number>()
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
  /**
   * Set when the call met a pause, a refused key, an outage (a failure that says nothing about the
   * run) or `TAIL_SYSTEMIC_4XX` run-specific 4xx answers in a row: a pass stops. A run-specific
   * 4xx alone does not set it, so one bad run never holds the ratings behind it.
   */
  halt: boolean
  /** Ids of the runs asked in this call, for a pass to leave out of its next call. */
  asked: string[]
  /** Runs still waiting for a look. */
  remaining: number
}

/** Pulled intervals.icu runs and races in the history window with no rating, not looked at yet. */
function waiting(userId: string, from: string, skip: string[] = [], createdBefore?: Date) {
  return {
    ...(skip.length > 0 ? { id: { notIn: skip } } : {}),
    ...(createdBefore === undefined ? {} : { createdAt: { lt: createdBefore } }),
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
 * call, only while the integration is connected, not paused and not syncing. With `createdBefore`
 * (the tail of a sync passes the sync's start), a run the sync has just imported is left for the
 * next sync, an hour on: that is the second chance of a run rated on the watch after its first
 * sync, which a pass straight after the import would spend within seconds. One `/activity/{id}`
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
  opts: {
    limit?: number
    now?: Date
    today: string
    /** The sync's fetch, so a sync and its tail use the same one (default: the deps' fetch). */
    fetch?: typeof fetch
    createdBefore?: Date
    /** Runs a pass already asked in an earlier call, so a failed one is not asked twice in a sync. */
    exclude?: readonly string[]
  },
): Promise<WatchRatingBackfillResult> {
  const { prisma } = deps
  const now = opts.now ?? new Date()
  // The runner's day (D10, ADR 0022); the job passes it.
  const { today } = opts
  const from = addDays(today, -P.a5.historyWindowDays.value)
  const result: WatchRatingBackfillResult = {
    filled: 0,
    unrated: 0,
    requests: 0,
    failures: [],
    pause: null,
    authRefused: false,
    halt: false,
    asked: [],
    remaining: 0,
  }

  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  })
  const pull = getProvider(PROVIDER).pull
  if (!integration || !pull?.fetchRating || integration.status !== 'connected') return result

  // A reconnect (or any rewrite of the integration row) lifts the passing over and the failure counts,
  // so a refused key does not leave runs deferred after the runner fixed it.
  const seenStamp = integrationStamp.get(integration.id)
  integrationStamp.set(integration.id, integration.updatedAt.getTime())
  if (seenStamp !== undefined && seenStamp !== integration.updatedAt.getTime()) {
    deferred.clear()
    outages.clear()
  }
  for (const [id, until] of deferred) if (until <= now.getTime()) deferred.delete(id)
  const where = waiting(
    userId,
    from,
    [...deferred.keys(), ...(opts.exclude ?? [])],
    opts.createdBefore,
  )
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

  /** Counts a failure that says nothing about the run; after the cap the run is passed over for a while. */
  function countFailure(id: string): void {
    const tries = (outages.get(id) ?? 0) + 1
    if (tries < WATCH_RATING_MAX_ATTEMPTS) {
      outages.set(id, tries)
      return
    }
    outages.delete(id)
    deferred.set(id, now.getTime() + WATCH_RATING_DEFER_MS)
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
    const ctx = await providerContext(deps, userId, PROVIDER, {
      ...opened,
      ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
    })
    const runs = await prisma.activity.findMany({
      where,
      select: { id: true, providerKey: true, startUtc: true, updatedAt: true },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      take: opts.limit ?? WATCH_RATING_BATCH,
    })
    const settled: Array<{ id: string; updatedAt: Date; rating: number | null }> = []
    /** Run-specific 4xx answers not yet charged to a run (see `flushPending`). */
    const pending: Array<{ run: (typeof runs)[number]; reason: string }> = []
    /** Charges the held-back 4xx answers to their runs (a success broke the streak). */
    function flushPending(): void {
      for (const { run, reason } of pending.splice(0)) {
        const tries = (attempts.get(run.id) ?? 0) + 1
        if (tries < WATCH_RATING_MAX_ATTEMPTS) {
          attempts.set(run.id, tries)
          result.failures.push({ ref: run.providerKey!, reason })
          continue
        }
        // A run that fails every sync would block the ones behind it: give it up like a 404.
        attempts.delete(run.id)
        result.failures.push({
          ref: run.providerKey!,
          reason: `${reason} (given up after ${String(tries)} attempts)`,
        })
        settled.push({ id: run.id, updatedAt: run.updatedAt, rating: null })
      }
    }
    try {
      for (const run of runs) {
        const remoteId = run.providerKey!.slice(PROVIDER.length + 1)
        try {
          result.requests += 1
          result.asked.push(run.id)
          const rating = await pull!.fetchRating!(
            { id: remoteId, startUtc: run.startUtc ?? now.toISOString() },
            ctx,
          )
          flushPending()
          attempts.delete(run.id)
          outages.delete(run.id)
          settled.push({ id: run.id, updatedAt: run.updatedAt, rating })
        } catch (error) {
          if (error instanceof RateLimitPause) {
            const until = new Date(now.getTime() + error.retryAfterSec * 1000)
            await prisma.integration.updateMany({
              where: { id: row.id, userId },
              data: { pausedUntil: until },
            })
            result.pause = { retryAfterSec: error.retryAfterSec }
            result.halt = true
            return
          }
          if (error instanceof ProviderAuthError) {
            authBlocked.set(row.id, {
              until: now.getTime() + WATCH_RATING_AUTH_BACKOFF_MS,
              stamp: row.updatedAt.getTime(),
            })
            result.authRefused = true
            result.halt = true
            result.failures.push({ ref: run.providerKey!, reason: safeMessage(error, secrets) })
            countFailure(run.id)
            return
          }
          const reason = safeMessage(error, secrets)
          const runSpecific =
            error instanceof ProviderHttpError && error.status >= 400 && error.status < 500
          if (!runSpecific) {
            result.failures.push({ ref: run.providerKey!, reason })
            countFailure(run.id)
            result.halt = true
            return
          }
          // Hourly, three tries take three hours: the runs behind this one go on meanwhile. The try
          // is held back until a success shows the answer was about the run; a streak of
          // `TAIL_SYSTEMIC_4XX` such answers says the service refuses everything, so the call
          // stops and no run is charged for it.
          pending.push({ run, reason })
          if (pending.length >= TAIL_SYSTEMIC_4XX) {
            pending.length = 0
            result.halt = true
            result.failures.push({
              ref: PROVIDER,
              reason: `${reason} (${String(TAIL_SYSTEMIC_4XX)} answers in a row; stopped for this sync)`,
            })
            return
          }
        }
      }
      flushPending()
    } finally {
      // Whatever was learned before a pause, a refused key or an outage is kept.
      const changed = await settleWatchRatings(deps, userId, settled)
      const filled = settled.filter((item) => changed.includes(item.id)).length
      result.filled = filled
      result.unrated = settled.length - filled
      // A new rating changes the assessment of the session the run fulfils, as saveFeedback does.
      for (const id of changed) await runExecutionQuietly(deps, { userId, activityId: id, today })
    }
  }

  result.remaining = await prisma.activity.count({ where })
  return result
}
