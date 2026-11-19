import { basename } from 'node:path'
import { clockInZone, instantAtWallTime, isoDateInZone, todayIso } from '../../shared/dates.ts'
import { runnerDays, type RunnerDay } from '../runnerDay.ts'
import { FOLDER_SCAN_MINUTES } from '../../shared/limits.ts'
import type { SyncStatus, SyncTrigger } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { PrismaClient } from '../db.ts'
import { sqliteFilePath } from '../dbPath.ts'
import { createLogger } from '../logger.ts'
import { PROVIDERS } from '../providers/registry.ts'
import {
  backupDirectory,
  createBackup,
  listOrdinaryBackups,
  pruneBackups,
  prunePreMigrateBackups,
  prunePreRestoreBackups,
} from '../services/backup.ts'
import { generateBrief } from '../services/brief.ts'
import { runNightlyMatching } from '../services/execution.ts'
import { installOwnerId } from '../installOwner.ts'
import { scanFolderIntegration } from '../services/folder.ts'
import { replanActivePlan } from '../services/planEngine.ts'
import { ensureWeeklyPrediction } from '../services/predictionLog.ts'
import { CHANNEL as PUBLISH_CHANNEL, isPublishDue, publishForUser } from '../services/publish.ts'
import { runStravaJob } from '../services/stravaRemoval.ts'
import { syncProvider } from '../services/sync.ts'
import { runStartPass } from '../services/startPass.ts'
import { recordJob, safeMessage, syncMessage } from '../services/syncLog.ts'
import { backfillHrQuality } from '../services/hrQualityBackfill.ts'
import { backfillSurfaceBins } from '../services/surfaceBackfill.ts'
import { backfillTerrainBins } from '../services/terrainBackfill.ts'
import { backfillTracks } from '../services/trackBackfill.ts'
import { backfillWatchRatings } from '../services/watchRatingBackfill.ts'
import { enrichWeather } from '../services/weather.ts'
import { refreshWeatherCaches } from '../services/weatherCache.ts'
import {
  REPLAN_SLOT,
  usersDueForWeeklyUpdate,
  weekSlotStart,
  weekUpdated,
  type DailySlot,
} from './weeklyUpdate.ts'

export { REPLAN_SLOT, weekSlotStart, weeklyUpdateStatus, type DailySlot } from './weeklyUpdate.ts'

const MINUTE_MS = 60_000
export const SYNC_INTERVAL_MS = 60 * MINUTE_MS
export const FOLDER_INTERVAL_MS = FOLDER_SCAN_MINUTES * MINUTE_MS
export const WEATHER_INTERVAL_MS = 10 * MINUTE_MS
/** How long after a failed weekly re-plan the one retry runs (armed by the failure, ADR 0026). */
export const WEEKLY_RETRY_MS = 6 * 60 * MINUTE_MS
/** How often the weekly prediction job looks for a week that has no logged prediction. */
export const PREDICTION_INTERVAL_MS = 6 * 60 * MINUTE_MS
/** How often the publisher checks whether a runner's calendar is due (design 6.8). */
export const PUBLISH_INTERVAL_MS = 2 * MINUTE_MS
/** How often the track backfill reads stored originals and asks intervals.icu for a few streams. */
export const TRACK_INTERVAL_MS = 5 * MINUTE_MS
/** How often the watch-rating backfill asks intervals.icu for a few activity records. */
export const WATCH_RATING_INTERVAL_MS = 5 * MINUTE_MS
/** How often the surface job matches a batch of tracks to the downloaded map area. */
export const SURFACE_INTERVAL_MS = 5 * MINUTE_MS
/** Activities that get weather per user per run. */
const WEATHER_BATCH = 50
/** The first run waits, so a crash loop never hammers a provider. */
const FIRST_RUN_DELAY_MS = 30_000

type Log = ReturnType<typeof createLogger>

/**
 * The day of each runner in `ids` for a job (D10, ADR 0022): the `days` a test passes, with any
 * runner it leaves out read from the profiles, so a job always has one `today` per runner.
 */
async function daysFor(
  deps: Deps,
  now: Date,
  ids: readonly string[],
  given?: ReadonlyMap<string, RunnerDay>,
): Promise<Map<string, RunnerDay>> {
  if (given === undefined) return runnerDays(deps.prisma, now, [...ids])
  const missing = ids.filter((id) => !given.has(id))
  const read = missing.length === 0 ? [] : [...(await runnerDays(deps.prisma, now, missing))]
  return new Map([...read, ...given])
}

/** The worst status of the runs a job caused, in the order error, paused, partial, ok. */
function worstStatus(statuses: readonly string[]): SyncStatus {
  for (const status of ['error', 'paused', 'partial'] as const) {
    if (statuses.includes(status)) return status
  }
  return 'ok'
}

/**
 * Pull-syncs every connected provider that is not paused, one after another. Each pull writes its
 * own run; the `sync` job run of a user sums them up (the worst status, the counts).
 */
export async function runSyncJob(
  deps: Deps,
  opts: { fetch: typeof fetch; now?: Date; days?: ReadonlyMap<string, RunnerDay> },
  log?: Log,
): Promise<void> {
  const now = opts.now ?? new Date()
  const pullKeys = Object.values(PROVIDERS)
    .filter((provider) => provider.pull)
    .map((provider) => provider.info.key)
  const rows = await deps.prisma.integration.findMany({
    where: {
      provider: { in: pullKeys },
      status: { in: ['connected', 'error'] },
      OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
  })
  const byUser = new Map<string, string[]>()
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.provider])
  const days = await daysFor(deps, now, [...byUser.keys()], opts.days)
  for (const [userId, providers] of byUser) {
    const day = days.get(userId)
    if (day === undefined) continue
    const startedAt = new Date()
    let thrown: unknown = null
    for (const provider of providers) {
      try {
        // syncProvider records its own failures on the row and in the log; this only keeps the
        // loop going.
        await syncProvider(deps, userId, provider, {
          today: day.today,
          fetch: opts.fetch,
          trigger: 'schedule',
        })
      } catch (error) {
        thrown ??= error
        log?.warn({ reason: safeMessage(error), provider }, 'scheduled sync failed')
      }
    }
    const runs = await deps.prisma.syncRun.findMany({
      where: { userId, channel: 'pull', trigger: 'schedule', startedAt: { gte: startedAt } },
      select: { status: true, accepted: true, duplicate: true, failed: true, message: true },
    })
    const sum = (key: 'accepted' | 'duplicate' | 'failed'): number =>
      runs.reduce((total, run) => total + run[key], 0)
    const status = worstStatus(runs.map((run) => run.status))
    const failedRun = runs.find((run) => run.status === 'error')
    // A run can fail with an empty message; the job still says in words that a sync did not finish.
    const failedText = failedRun?.message
      ? failedRun.message
      : syncMessage('sync.msg.sync-unfinished', {})
    await recordJob(deps, 'sync', userId, startedAt, {
      status,
      error: thrown ?? (failedRun ? failedText : null),
      accepted: sum('accepted'),
      duplicate: sum('duplicate'),
      failed: sum('failed'),
    })
  }
}

/**
 * Scans the import folder for the install owner when the owner turned it on (F1); the row of any
 * other account is skipped and records nothing. Each scan writes its own `folder` run, so the job
 * adds no row of its own.
 */
export async function runFolderJob(
  deps: Deps,
  log?: Log,
  opts: { now?: Date; days?: ReadonlyMap<string, RunnerDay> } = {},
): Promise<void> {
  const rows = await deps.prisma.integration.findMany({
    where: { provider: 'folder', status: { in: ['connected', 'error'] } },
    orderBy: { createdAt: 'asc' },
  })
  const owner = await installOwnerId(deps.prisma)
  const days = await daysFor(
    deps,
    opts.now ?? new Date(),
    rows.map((row) => row.userId).filter((id) => id === owner),
    opts.days,
  )
  for (const row of rows) {
    if (row.userId !== owner) continue
    const day = days.get(row.userId)
    if (day === undefined) continue
    try {
      await scanFolderIntegration(deps, row.userId, { today: day.today, trigger: 'schedule' })
    } catch (error) {
      // The row already holds the message; the next scan retries.
      log?.warn({ reason: safeMessage(error) }, 'folder scan failed')
    }
  }
}

/**
 * The 10-minute weather job, for every user: fills weather on the newest activities that lack it,
 * then refreshes the Open-Meteo caches (home forecast older than 60 minutes; race climates that are
 * missing, incomplete or older than 30 days) through the injected `fetch`. This is the only place
 * that fills those caches on a schedule; request handlers read them. The run counts the activities
 * and the cache rows it stored, and is an error when either step failed.
 */
export async function runWeatherJob(
  deps: Deps,
  opts: { fetch: typeof fetch; now?: Date; days?: ReadonlyMap<string, RunnerDay> },
  log?: Log,
): Promise<void> {
  const users = await deps.prisma.user.findMany({ select: { id: true } })
  const days = await daysFor(
    deps,
    opts.now ?? new Date(),
    users.map((user) => user.id),
    opts.days,
  )
  for (const user of users) {
    const startedAt = new Date()
    const now = opts.now ?? new Date()
    const day = days.get(user.id)
    if (day === undefined) continue
    let filled = 0
    let error: unknown = null
    try {
      filled = await enrichWeather(deps, user.id, { limit: WEATHER_BATCH, fetch: opts.fetch, now })
    } catch (failure) {
      log?.warn({ reason: safeMessage(failure) }, 'weather backfill failed')
      error = failure
    }
    const caches = await refreshWeatherCaches(deps, user.id, {
      fetch: opts.fetch,
      now,
      today: day.today,
    }).catch((failure: unknown) => ({ refreshed: 0, failed: 1, error: failure }))
    if (caches.error !== null) {
      log?.warn({ reason: safeMessage(caches.error) }, 'weather cache refresh failed')
    }
    await recordJob(deps, 'weather', user.id, startedAt, {
      accepted: filled + caches.refreshed,
      failed: caches.failed,
      error: error ?? caches.error,
      skipIdle: true,
    })
  }
}

/**
 * Computes the trail, paved-path and road shares of runs inside the runner's downloaded map area
 * (M1d), one small batch per user per tick (`backfillSurfaceBins`). A user with no area costs one
 * read. A tick that fills something (or meets an unreadable track) records a `surface` run,
 * `accepted` the runs filled and `failed` the unreadable tracks (a `partial` run when there are any);
 * an idle tick is not stored. Idempotent and resumable: filled runs are never selected again. Never uses the network.
 */
export async function runSurfaceJob(deps: Deps, log?: Log): Promise<void> {
  const users = await deps.prisma.user.findMany({ select: { id: true } })
  for (const user of users) {
    const startedAt = new Date()
    try {
      const result = await backfillSurfaceBins(deps, user.id)
      await recordJob(deps, 'surface', user.id, startedAt, {
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
      log?.warn({ reason: safeMessage(error), userId: user.id }, 'surface job failed')
      await recordJob(deps, 'surface', user.id, startedAt, { error })
    }
  }
}

/**
 * Fills the route tracks of runs imported before `ActivityTrack` existed (M1a): stored originals
 * first, then a few intervals.icu streams per tick (`backfillTracks`). A tick that fills something,
 * meets an unreadable file or makes a request records a `track` run: `accepted` the tracks written,
 * `failed` the unreadable files and failed requests, `partial` when there are any and `paused` while
 * intervals.icu is rate limiting; a tick with nothing to do is not stored. A user's failure is
 * recorded as an error run and the job goes on. Idempotent and resumable: a run that was looked at
 * is never selected again.
 */
export async function runTrackJob(deps: Deps, log?: Log, opts: { now?: Date } = {}): Promise<void> {
  const users = await deps.prisma.user.findMany({ select: { id: true } })
  for (const user of users) {
    const startedAt = new Date()
    try {
      const result = await backfillTracks(deps, user.id, opts)
      const failures = [
        ...result.unreadable.map((ref) => ({ ref, reason: 'the stored file could not be read' })),
        ...result.failures,
      ]
      await recordJob(deps, 'track', user.id, startedAt, {
        accepted: result.filled,
        failed: failures.length,
        // Only a 429 met in this tick is a `paused` run; waiting out an earlier pause is idle.
        status:
          result.pause && result.requests > 0 ? 'paused' : failures.length > 0 ? 'partial' : 'ok',
        failures,
        skipIdle: true,
      })
    } catch (error) {
      log?.warn({ reason: safeMessage(error), userId: user.id }, 'track backfill failed')
      await recordJob(deps, 'track', user.id, startedAt, { error })
    }
  }
}

/**
 * Fills the watch rating of intervals.icu runs stored without one (WB1), a few `/activity/{id}`
 * requests per user per tick (`backfillWatchRatings`). A tick that fills a rating, fails a
 * request or meets a pause or a refused key records a `watch-rating` run: `accepted` the ratings
 * written, `failed` the failed requests, `partial` when there are any, `paused` while intervals.icu is
 * rate limiting and `error` when it refused the key. A tick that only marks runs (no rating held) is
 * idle and not stored, like one with nothing to do. A user's failure is recorded as
 * an error run and the job goes on. Idempotent and resumable: a run that was asked about is never
 * selected again.
 */
export async function runWatchRatingJob(
  deps: Deps,
  log?: Log,
  opts: { now?: Date; days?: ReadonlyMap<string, RunnerDay> } = {},
): Promise<void> {
  const users = await deps.prisma.user.findMany({ select: { id: true } })
  const days = await daysFor(
    deps,
    opts.now ?? new Date(),
    users.map((user) => user.id),
    opts.days,
  )
  for (const user of users) {
    const startedAt = new Date()
    const day = days.get(user.id)
    if (day === undefined) continue
    try {
      const result = await backfillWatchRatings(deps, user.id, {
        ...(opts.now === undefined ? {} : { now: opts.now }),
        today: day.today,
      })
      const status = result.authRefused
        ? 'error'
        : result.pause && result.requests > 0
          ? 'paused'
          : result.failures.length > 0
            ? 'partial'
            : 'ok'
      await recordJob(deps, 'watch-rating', user.id, startedAt, {
        accepted: result.filled,
        failed: result.failures.length,
        status,
        failures: result.failures,
        skipIdle: true,
      })
    } catch (error) {
      log?.warn({ reason: safeMessage(error), userId: user.id }, 'watch rating backfill failed')
      await recordJob(deps, 'watch-rating', user.id, startedAt, { error })
    }
  }
}

/**
 * Makes sure each user's current goal has this week's prediction in the log (spec 11.7), so a
 * missed night or a goal without a plan never leaves a week out of the record. A week that already
 * has its row costs no engine work. A user whose prediction fails is recorded as an error run and
 * the job goes on; every run is recorded, idle ones too, with the rows it wrote as `accepted`.
 */
export async function runPredictionJob(
  deps: Deps,
  opts: { now?: Date; days?: ReadonlyMap<string, RunnerDay> } = {},
  log?: Log,
): Promise<void> {
  const users = await deps.prisma.user.findMany({ select: { id: true } })
  const days = await daysFor(
    deps,
    opts.now ?? new Date(),
    users.map((user) => user.id),
    opts.days,
  )
  for (const user of users) {
    const startedAt = new Date()
    const day = days.get(user.id)
    if (day === undefined) continue
    try {
      const outcome = await ensureWeeklyPrediction(deps, user.id, day.today)
      await recordJob(deps, 'predictions', user.id, startedAt, {
        accepted: outcome === 'created' ? 1 : 0,
      })
    } catch (error) {
      log?.warn({ reason: safeMessage(error), userId: user.id }, 'weekly prediction failed')
      await recordJob(deps, 'predictions', user.id, startedAt, { error })
    }
  }
}

/**
 * Copies the database into `backups/` beside it and prunes the older ordinary backups by the
 * default retention rule (`server/services/backup.ts`). The copy is one for the whole database, so
 * each user gets a `backup` run that says how it went: `accepted` 1 for a copy that passed
 * `integrity_check`, an error run otherwise. A failure is recorded and logged, never thrown, and
 * prunes nothing. Nothing in a request handler calls this; only the daily slot does.
 */
export async function runBackupJob(
  deps: Deps,
  opts: { now?: Date; trigger?: SyncTrigger } = {},
  log?: Log,
): Promise<void> {
  const startedAt = new Date()
  let failure: unknown = null
  try {
    const file = sqliteFilePath(deps.config.databaseUrl)
    const copy = await createBackup(file, { kind: 'ordinary', now: opts.now })
    const pruned = pruneBackups(backupDirectory(file), undefined, basename(copy.path))
    const prunedSafety: Record<string, number> = {}
    for (const [kind, prune] of [
      ['pre-migrate', prunePreMigrateBackups],
      ['pre-restore', prunePreRestoreBackups],
    ] as const) {
      prunedSafety[kind] = 0
      try {
        const result = prune(backupDirectory(file), opts.now)
        prunedSafety[kind] = result.removed.length
        if (result.failed.length > 0) {
          log?.warn({ files: result.failed }, `${kind} copies could not be removed`)
        }
      } catch (error) {
        // Housekeeping never fails the backup run.
        log?.warn({ reason: safeMessage(error) }, `${kind} copies were not pruned`)
      }
    }
    log?.info(
      {
        bytes: copy.bytes,
        pruned: pruned.length,
        prunedPreMigrate: prunedSafety['pre-migrate'],
        prunedPreRestore: prunedSafety['pre-restore'],
      },
      'database backed up',
    )
  } catch (error) {
    log?.warn({ reason: safeMessage(error) }, 'scheduled backup failed')
    failure = error
  }
  const users = await deps.prisma.user.findMany({ select: { id: true } })
  for (const user of users) {
    await recordJob(deps, 'backup', user.id, startedAt, {
      ...(opts.trigger === undefined ? {} : { trigger: opts.trigger }),
      accepted: failure === null ? 1 : 0,
      error: failure,
    })
  }
}

/** The start of the latest `slot` at or before `now`, in the process's local time. */
export function lastSlotStart(now: Date, slot: DailySlot): Date {
  const start = new Date(now)
  start.setHours(slot.hour, slot.minute, 0, 0)
  if (start.getTime() > now.getTime()) start.setDate(start.getDate() - 1)
  return start
}

/**
 * When the newest backup the server can vouch for was made: the later of the newest successful
 * `backup` job run and the newest ordinary file in `backups/` (a manual `npm run backup` counts),
 * or null when there is neither. A failed run is not a backup.
 */
export async function newestBackupAt(deps: Deps): Promise<Date | null> {
  const run = await deps.prisma.syncRun.findFirst({
    where: { channel: 'job', provider: 'backup', status: 'ok', accepted: { gt: 0 } },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  })
  let file: Date | null = null
  try {
    file =
      listOrdinaryBackups(backupDirectory(sqliteFilePath(deps.config.databaseUrl)))[0]?.at ?? null
  } catch {
    // An unreadable folder counts as no copy; the run below then decides.
  }
  const times = [run?.startedAt, file].filter((at): at is Date => at != null)
  return times.length === 0 ? null : new Date(Math.max(...times.map((at) => at.getTime())))
}

/**
 * Makes the day's backup that a restart skipped (the daily slot is seeded at start): when the newest
 * backup is older than the latest 02:00 slot, runs one, recorded as a `backup` run with trigger
 * `catchup`. Returns whether it ran. Failures are recorded by `runBackupJob`, never thrown; a read
 * error on the check is logged and skips the catch-up.
 */
export async function runBackupCatchUp(
  deps: Deps,
  opts: { now?: Date } = {},
  log?: Log,
): Promise<boolean> {
  const now = opts.now ?? new Date()
  try {
    const newest = await newestBackupAt(deps)
    if (newest !== null && newest.getTime() >= lastSlotStart(now, BACKUP_SLOT).getTime()) {
      return false
    }
  } catch (error) {
    log?.warn({ reason: safeMessage(error) }, 'backup catch-up check failed')
    return false
  }
  await runBackupJob(deps, { now, trigger: 'catchup' }, log)
  return true
}

/** A runner a per-runner slot serves, and when what makes it serve the runner came into being. */
export interface ServedRunner {
  userId: string
  since: Date
}

/** The runners with an active version-2 plan, each with the creation time of the newest one. */
async function activePlanRunners(prisma: PrismaClient): Promise<ServedRunner[]> {
  const plans = await prisma.plan.findMany({
    where: { status: 'active', generatorVersion: { gte: 2 } },
    select: { userId: true, createdAt: true },
  })
  const since = new Map<string, Date>()
  for (const { userId, createdAt } of plans) {
    const known = since.get(userId)
    if (known === undefined || createdAt > known) since.set(userId, createdAt)
  }
  return [...since].map(([userId, at]) => ({ userId, since: at }))
}

/** Users with an active version-2 plan: whom the nightly matching and the Monday re-plan serve. */
async function activePlanUsers(prisma: PrismaClient): Promise<string[]> {
  const plans = await prisma.plan.findMany({
    where: { status: 'active', generatorVersion: { gte: 2 } },
    select: { userId: true },
  })
  return [...new Set(plans.map((plan) => plan.userId))]
}

/**
 * What the per-runner jobs share: `now`, the runners the slot found due (`userIds`, every one with
 * a plan when absent) and each runner's day (`days`, read from the profiles for any runner left
 * out; tests fill it with other zones).
 */
interface RunnerJobOptions {
  now?: Date
  userIds?: readonly string[]
  days?: ReadonlyMap<string, RunnerDay>
}

/**
 * Nightly: links the last 7 days of unlinked activities to planned sessions and re-assesses the
 * linked ones, for every user with a version-2 plan [design 4.1], each on the runner's own day.
 */
export async function runMatchingJob(
  deps: Deps,
  opts: RunnerJobOptions = {},
  log?: Log,
): Promise<void> {
  const planned = await activePlanUsers(deps.prisma)
  const users =
    opts.userIds === undefined ? planned : planned.filter((id) => opts.userIds?.includes(id))
  const days = await daysFor(deps, opts.now ?? new Date(), users, opts.days)
  const todays = new Map<string, string>()
  for (const id of users) {
    const day = days.get(id)
    if (day !== undefined) todays.set(id, day.today)
  }
  const startedAt = new Date()
  const errors = new Map<string, unknown>()
  let thrown: Error | null = null
  try {
    await runNightlyMatching(deps, {
      todays,
      onError: (error, userId) => {
        errors.set(userId, error)
        log?.warn({ reason: safeMessage(error), userId }, 'nightly matching failed')
      },
    })
  } catch (error) {
    thrown = error instanceof Error ? error : new Error(safeMessage(error))
  }
  for (const userId of users) {
    await recordJob(deps, 'matching', userId, startedAt, { error: errors.get(userId) ?? thrown })
  }
  if (thrown !== null) throw thrown
}

/**
 * Sends the next 14 days of run sessions to intervals.icu for every runner who turned publishing
 * on (design 6.8). A tick runs the publisher for a runner whose composed change key moved, whose
 * retry is due, or after 30 minutes; with `force` (the 04:45 slot, after matching and the Monday
 * re-plan) every such runner is run regardless. Each run that happens records one `publish` run in
 * the sync log; a tick that finds nothing due records nothing.
 */
export async function runPublishJob(
  deps: Deps,
  opts: { fetch: typeof fetch; force?: boolean } & RunnerJobOptions,
  log?: Log,
): Promise<void> {
  const now = opts.now ?? new Date()
  const channels = await deps.prisma.deliveryChannel.findMany({
    where: {
      channel: PUBLISH_CHANNEL,
      enabled: true,
      ...(opts.userIds === undefined ? {} : { userId: { in: [...opts.userIds] } }),
    },
    orderBy: { id: 'asc' },
  })
  const days = await daysFor(
    deps,
    now,
    channels.map((channel) => channel.userId),
    opts.days,
  )
  for (const channel of channels) {
    const day = days.get(channel.userId)
    if (day === undefined) continue
    try {
      if (!opts.force && !(await isPublishDue(deps, channel, now, day.today))) continue
      await publishForUser(deps, channel.userId, {
        trigger: 'schedule',
        fetch: opts.fetch,
        today: day.today,
        ...(opts.now === undefined ? {} : { now: opts.now }),
      })
    } catch (error) {
      // The run recorded the failure itself; this only keeps the loop going.
      log?.warn({ reason: safeMessage(error) }, 'scheduled publishing failed')
    }
  }
}

/** Whether the active plan of `userId` already has its update for the week of `day`. */
async function weekAlreadyUpdated(
  prisma: PrismaClient,
  userId: string,
  day: RunnerDay,
): Promise<boolean> {
  const plan = await prisma.plan.findFirst({
    where: { userId, status: 'active', generatorVersion: { gte: 2 } },
    select: { id: true },
  })
  return plan !== null && (await weekUpdated(prisma, { userId, planId: plan.id, day }))
}

/** Users being re-planned now, so the 03:00 slot and the catch-up never re-plan one twice at once. */
const replanning = new Set<string>()

/**
 * Monday: re-plans every active version-2 plan from the updated state [design 5], then writes the
 * week's brief for that runner (`generateBrief`): from the revision the re-plan wrote, or, when the
 * re-plan was refused or failed, with a note that says why the plan was not updated. The brief has a
 * try/catch of its own, so one that cannot be written never fails the re-plan (design 8.7).
 *
 * With `catchUp`, only the plans whose weekly update is due (see `usersDueForWeeklyUpdate`) are
 * re-planned and the runs are recorded with trigger `catchup`: a server that was down at 03:00 on
 * Monday still makes the week's update when it comes back (ADR 0007). The runners whose re-plan
 * threw come back in `failed`; the caller arms the one retry (`armWeeklyRetry`). A user whose
 * re-plan is already running is skipped and records nothing.
 */
export async function runReplanJob(
  deps: Deps,
  opts: { catchUp?: boolean } & RunnerJobOptions = {},
  log?: Log,
): Promise<{ failed: string[] }> {
  const now = opts.now ?? new Date()
  const failed: string[] = []
  let users: string[]
  if (opts.catchUp) {
    const everyone = await runnerDays(
      deps.prisma,
      now,
      opts.userIds === undefined ? undefined : [...opts.userIds],
    )
    const days = new Map([...everyone, ...(opts.days ?? [])])
    const only = opts.userIds?.length === 1 ? opts.userIds[0] : undefined
    users = await usersDueForWeeklyUpdate(deps.prisma, now, only, days)
  } else {
    users = await activePlanUsers(deps.prisma)
  }
  if (opts.userIds !== undefined) users = users.filter((id) => opts.userIds?.includes(id))
  const days = await daysFor(deps, now, users, opts.days)
  const trigger: SyncTrigger = opts.catchUp ? 'catchup' : 'schedule'
  for (const userId of users) {
    const day = days.get(userId)
    if (day === undefined) continue
    const { today } = day
    // The claim is synchronous (no await between the check and the add), so two flows for one
    // runner (the slot, the start pass, the retry, a route hook) never both pass it.
    if (replanning.has(userId)) continue
    replanning.add(userId)
    const startedAt = new Date()
    // What the brief describes: the revision the re-plan wrote, or the error that stopped it.
    let outcome: { revisionId: string } | { failure: unknown } | undefined
    try {
      // The slot and the catch-up never make a second update in one local week: a runner who moved
      // zone across Monday's slot, or whose zone differs from the server's, would otherwise get one,
      // and a flow that finished since this one listed its runners has already made it. Read inside
      // the claim.
      if (await weekAlreadyUpdated(deps.prisma, userId, day)) continue
      try {
        const revision = await replanActivePlan(deps, { userId, reason: 'weekly', today })
        outcome = { revisionId: revision.id }
        await recordJob(deps, 'replan', userId, startedAt, { trigger })
      } catch (error) {
        // A plan that fails its checklist or whose goal has passed stays as it is.
        outcome ??= { failure: error }
        failed.push(userId)
        log?.warn({ reason: safeMessage(error), userId }, 'weekly re-plan failed')
        await recordJob(deps, 'replan', userId, startedAt, { trigger, error })
      }
      // The brief comes after the re-plan returns and has a try/catch of its own: a brief that
      // cannot be written never fails the re-plan (design 8.7).
      if (outcome !== undefined) await writeBrief(deps, { userId, day, ...outcome }, log)
    } finally {
      replanning.delete(userId)
    }
  }
  return { failed }
}

/**
 * The owner writes that can make a week owed (a restored plan, a goal date moved off a passed one)
 * call this after the write: the weekly update for that runner if it is due, nothing otherwise.
 * Best effort: the write has succeeded, so a failure is logged and goes no further.
 */
export async function catchUpWeekFor(deps: Deps, userId: string, day: RunnerDay): Promise<void> {
  try {
    await runReplanJob(
      deps,
      { catchUp: true, userIds: [userId], days: new Map([[userId, day]]) },
      createLogger(deps.config),
    )
  } catch (error) {
    createLogger(deps.config).warn({ reason: safeMessage(error), userId }, 'weekly catch-up failed')
  }
}

/** Writes the week's brief after a re-plan; a failure is logged and goes no further. */
async function writeBrief(
  deps: Deps,
  args:
    | { userId: string; day: RunnerDay; revisionId: string }
    | { userId: string; day: RunnerDay; failure: unknown },
  log?: Log,
): Promise<void> {
  try {
    const { day, ...rest } = args
    await generateBrief(deps, { ...rest, today: day.today, tz: day.tz })
  } catch (error) {
    log?.warn({ reason: safeMessage(error), userId: args.userId }, 'weekly brief failed')
  }
}

/**
 * The date (`YYYY-MM-DD`, the server's zone) of the slot that is due at `now`, or null when today's
 * slot has not come yet, is not today's weekday, or was already run (`last`). The backup's slot
 * only: the per-runner slots use `dueRunners`.
 */
export function dueSlot(now: Date, last: string | null, slot: DailySlot): string | null {
  if (slot.weekday !== undefined && now.getDay() !== slot.weekday) return null
  if (now.getHours() * 60 + now.getMinutes() < slot.hour * 60 + slot.minute) return null
  const key = todayIso(now)
  return key === last ? null : key
}

/**
 * The runners whose `slot` is due at `now`, each with the local date of the slot (D10, ADR 0022).
 * A runner is due when the wall clock of the runner's zone is at or past the slot's minute (a slot
 * with a weekday: at or past its occurrence in the current Monday-based week, on any later day of
 * it) and the slot's date is not the one in `last` (the date the runner's slot last ran). Pure:
 * the clock is `now` and the zones are the runners'. On a spring-forward night the slot is due at
 * the first check after the skipped wall time; on a fall-back night the date in `last` stops a
 * repeat.
 */
export function dueRunners(
  now: Date,
  runners: ReadonlyArray<{ userId: string; tz: string }>,
  last: ReadonlyMap<string, string>,
  slot: DailySlot,
): Array<{ userId: string; date: string }> {
  const due: Array<{ userId: string; date: string }> = []
  for (const { userId, tz } of runners) {
    if (slot.weekday !== undefined) {
      // A weekday slot is due for the whole week, not only on its day, so a host suspended through
      // Monday or a zone jump past it still makes the update (the date is the slot's own day).
      // `weekAlreadyUpdated` stops a second update.
      const start = weekSlotStart(now, { ...slot, weekday: slot.weekday }, tz)
      if (start === null) continue
      const date = isoDateInZone(start, tz)
      if (last.get(userId) === date) continue
      due.push({ userId, date })
      continue
    }
    const clock = clockInZone(now, tz)
    if (clock.minute < slot.hour * 60 + slot.minute) continue
    if (last.get(userId) === clock.date) continue
    due.push({ userId, date: clock.date })
  }
  return due
}

/** What `dueAtCheck` remembers for one per-runner slot: the date each runner's slot last ran. */
export interface SlotState {
  last: Map<string, string>
  /** The runners seen at an earlier check. */
  seen: Set<string>
}

export function newSlotState(): SlotState {
  return { last: new Map(), seen: new Set() }
}

/**
 * One check of a per-runner slot: the due runners with the local date, and the new `last` entries
 * for them (D10, ADR 0022).
 *
 * - A runner absent from this check is forgotten (`last` and `seen`), so one who leaves and comes
 *   back is treated as new.
 * - A runner seen for the first time whose slot is already past is marked as done when this is the
 *   start-up check (a restart never repeats a slot) or when what serves the runner (`since`, the
 *   plan) came into being at or after that slot instant (it was made from that day's data). A
 *   runner who existed before the slot instant stays due and runs in this pass, as a job that
 *   lists every plan at the slot would have run it.
 * - `atStart` only seeds; nothing is due from it.
 */
export function dueAtCheck(
  state: SlotState,
  now: Date,
  runners: ReadonlyArray<{ userId: string; tz: string; since: Date }>,
  slot: DailySlot,
  atStart: boolean,
): Array<{ userId: string; date: string }> {
  const present = new Set(runners.map((runner) => runner.userId))
  for (const id of [...state.seen]) {
    if (!present.has(id)) state.seen.delete(id)
  }
  for (const id of [...state.last.keys()]) {
    if (!present.has(id)) state.last.delete(id)
  }
  for (const runner of runners.filter((r) => !state.seen.has(r.userId))) {
    state.seen.add(runner.userId)
    const [pastSlot] = dueRunners(now, [runner], new Map(), slot)
    if (pastSlot === undefined) continue
    const slotAt = instantAtWallTime(pastSlot.date, slot.hour * 60 + slot.minute, runner.tz)
    if (atStart || runner.since.getTime() >= slotAt.getTime()) {
      state.last.set(runner.userId, pastSlot.date)
    }
  }
  if (atStart) return []
  const due = dueRunners(now, runners, state.last, slot)
  for (const { userId, date } of due) state.last.set(userId, date)
  return due
}

/** How often the daily jobs check whether their slot has come. */
export const SLOT_CHECK_MS = 10 * MINUTE_MS
/** The database copy comes first, before the night's matching and the Monday re-plan write. */
export const BACKUP_SLOT: DailySlot = { hour: 2, minute: 0 }
/** Nightly matching runs before the Monday re-plan, so the re-plan sees the week's links. */
export const MATCHING_SLOT: DailySlot = { hour: 2, minute: 30 }
/**
 * The daily Strava check (SC1, ADR 0025): lists each connected runner's Strava activities once to
 * delete what Strava dropped.
 * After the re-plan (03:00), so a deletion never lands in the middle of one.
 */
export const STRAVA_SLOT: DailySlot = { hour: 3, minute: 30 }
/** After matching (02:30) and the Monday re-plan (03:00): the morning's forced publish. */
export const PUBLISH_MORNING_SLOT: DailySlot = { hour: 4, minute: 45 }

/**
 * Starts the hourly sync, 5-minute folder scan and 10-minute weather jobs, the 5-minute track
 * backfill, a start pass 30 s after start for the terrain bins and the heart-rate quality (ADR
 * 0026; edits and imports fill them as they happen), the daily database
 * backup (02:00 local), the nightly matching (02:30 local), the Monday re-plan (03:00 local) and
 * its catch-up (once 30 s after start, then one retry 6 hours after a failure), the daily Strava
 * check (03:30 local), and the weekly prediction log (each 30 s after start, then every 6 hours), the
 * publisher's 2-minute check and its forced 04:45 run; returns `stop()`.
 * A job never overlaps itself: a tick that finds its previous run still going does nothing.
 * Called from `server/index.ts` only, never in tests.
 */
export function startScheduler(deps: Deps, opts: { fetch: typeof fetch }): () => void {
  const log = createLogger(deps.config)
  let stopped = false
  const timers = new Set<NodeJS.Timeout>()

  function every(name: string, intervalMs: number, job: () => Promise<void>): void {
    let active = false
    const tick = (): void => {
      if (stopped || active) return
      active = true
      job()
        .catch((error: unknown) => log.error({ err: error, job: name }, 'scheduled job failed'))
        .finally(() => {
          active = false
        })
    }
    const first = setTimeout(() => {
      timers.delete(first)
      tick()
      const repeat = setInterval(tick, intervalMs)
      repeat.unref()
      timers.add(repeat)
    }, FIRST_RUN_DELAY_MS)
    first.unref()
    timers.add(first)
  }

  /** Runs `job` once, after the first-run delay and off the start-up path (ADR 0026). */
  function once(name: string, job: () => Promise<void>): void {
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (stopped) return
      job().catch((error: unknown) => log.error({ err: error, job: name }, 'scheduled job failed'))
    }, FIRST_RUN_DELAY_MS)
    timer.unref()
    timers.add(timer)
  }

  /** Runs `job` once per local day (and weekday) after its slot; a restart never repeats a slot. */
  function daily(name: string, slot: DailySlot, job: () => Promise<void>): void {
    let last = dueSlot(new Date(), null, slot)
    let active = false
    const timer = setInterval(() => {
      const key = dueSlot(new Date(), last, slot)
      if (stopped || active || key === null) return
      last = key
      active = true
      job()
        .catch((error: unknown) => log.error({ err: error, job: name }, 'scheduled job failed'))
        .finally(() => {
          active = false
        })
    }, SLOT_CHECK_MS)
    timer.unref()
    timers.add(timer)
  }

  /**
   * Runs `job` once per runner and local day after the slot, on each runner's own clock (D10,
   * ADR 0022). `serves` lists the runners the job is for. `last` holds the date each runner's slot
   * last ran; a runner seen for the first time (at start, or later when a plan appears) is seeded
   * with the date `dueRunners` would give, so a restart, or a plan made after the slot, never runs
   * that day's slot. The job gets the due runners and everyone's day.
   */
  function dailyPerRunner(
    name: string,
    slot: DailySlot,
    serves: () => Promise<ServedRunner[]>,
    job: (userIds: string[], days: Map<string, RunnerDay>) => Promise<void>,
  ): void {
    const state = newSlotState()
    let active = false
    const check = async (atStart: boolean): Promise<void> => {
      const now = new Date()
      const served = await serves()
      const days = await runnerDays(
        deps.prisma,
        now,
        served.map((runner) => runner.userId),
      )
      const runners = served.flatMap(({ userId, since }) => {
        const day = days.get(userId)
        return day === undefined ? [] : [{ userId, tz: day.tz, since }]
      })
      const due = dueAtCheck(state, now, runners, slot, atStart)
      if (due.length === 0) return
      await job(
        due.map((runner) => runner.userId),
        days,
      )
    }
    const ready = check(true).catch((error: unknown) =>
      log.error({ err: error, job: name }, 'scheduled job failed'),
    )
    const timer = setInterval(() => {
      if (stopped || active) return
      active = true
      ready
        .then(() => check(false))
        .catch((error: unknown) => log.error({ err: error, job: name }, 'scheduled job failed'))
        .finally(() => {
          active = false
        })
    }, SLOT_CHECK_MS)
    timer.unref()
    timers.add(timer)
  }

  every('sync', SYNC_INTERVAL_MS, () => runSyncJob(deps, opts, log))
  every('folder', FOLDER_INTERVAL_MS, () => runFolderJob(deps, log))
  every('weather', WEATHER_INTERVAL_MS, () => runWeatherJob(deps, opts, log))
  every('track', TRACK_INTERVAL_MS, () => runTrackJob(deps, log))
  every('watch-rating', WATCH_RATING_INTERVAL_MS, () => runWatchRatingJob(deps, log))
  every('surface', SURFACE_INTERVAL_MS, () => runSurfaceJob(deps, log))
  // The daily slot and the start-up catch-up share this flag, so two copies never run at once.
  let backingUp = false
  const exclusiveBackup = async (job: () => Promise<unknown>): Promise<void> => {
    if (backingUp) return
    backingUp = true
    try {
      await job()
    } finally {
      backingUp = false
    }
  }
  daily('backup', BACKUP_SLOT, () => exclusiveBackup(() => runBackupJob(deps, {}, log)))
  // Seeded like the daily slot, a start after 02:00 would skip that day's copy: one catch-up after
  // the first-run delay, off the start-up path.
  once('backup-catchup', () => exclusiveBackup(() => runBackupCatchUp(deps, {}, log)))
  // Start passes (ADR 0026): backfills for rows that predate a column or a version run once, after
  // the first-run delay and in sequence, each in its own catch so one failure never skips the next.
  // Later columns append their pass here; track goes before surface, which matches its tracks.
  once('start-passes', async () => {
    const passes: Array<[string, () => Promise<void>]> = [
      [
        'terrain',
        () =>
          runStartPass(deps, 'terrain', (userId) => () => backfillTerrainBins(deps, userId), {
            stopped: () => stopped,
            log,
          }),
      ],
      [
        'hr-quality',
        () =>
          runStartPass(deps, 'hr-quality', (userId) => () => backfillHrQuality(deps, userId), {
            stopped: () => stopped,
            log,
          }),
      ],
    ]
    for (const [name, pass] of passes) {
      if (stopped) return
      await pass().catch((error: unknown) =>
        log.error({ err: error, job: name }, 'start pass failed'),
      )
    }
  })
  daily('strava', STRAVA_SLOT, () => runStravaJob(deps, { fetch: opts.fetch }, log))
  const planUsers = (): Promise<ServedRunner[]> => activePlanRunners(deps.prisma)
  dailyPerRunner('matching', MATCHING_SLOT, planUsers, (userIds, days) =>
    runMatchingJob(deps, { userIds, days }, log),
  )
  // One retry at most is pending: a failed weekly re-plan (a stale-write 409, a busy database, a
  // checklist 422) may clear with time, and no event announces it. Armed only by a failure, so a
  // week with nothing owed has no timer (ADR 0026). The route hooks (restore, goal date) do not
  // arm it: their failure shows on Today and the next start or Monday makes the update.
  let weeklyRetry: NodeJS.Timeout | null = null
  const armWeeklyRetry = (): void => {
    if (stopped || weeklyRetry !== null) return
    const timer = setTimeout(() => {
      weeklyRetry = null
      timers.delete(timer)
      if (!stopped) void weeklyCatchUp()
    }, WEEKLY_RETRY_MS)
    timer.unref()
    weeklyRetry = timer
    timers.add(timer)
  }
  /** Runs a weekly re-plan job and arms the retry when a runner failed or the job rejected. */
  const armOnFailure = async (
    name: string,
    run: () => Promise<{ failed: string[] }>,
  ): Promise<void> => {
    try {
      const { failed } = await run()
      if (failed.length > 0) armWeeklyRetry()
    } catch (error) {
      // Rejected before the per-user catch (listing the plans or the days): nothing was recorded.
      log.error({ err: error, job: name }, 'scheduled job failed')
      armWeeklyRetry()
    }
  }
  const weeklyCatchUp = (): Promise<void> =>
    armOnFailure('replan-catchup', () => runReplanJob(deps, { catchUp: true }, log))
  dailyPerRunner('replan', REPLAN_SLOT, planUsers, (userIds, days) =>
    armOnFailure('replan', () => runReplanJob(deps, { userIds, days }, log)),
  )
  // The slot is seeded at start, so a restart after 03:00 on Monday would skip the week: one
  // catch-up after the first-run delay, off the start-up path.
  once('replan-catchup', weeklyCatchUp)
  every('predictions', PREDICTION_INTERVAL_MS, () => runPredictionJob(deps, {}, log))
  every('publish', PUBLISH_INTERVAL_MS, () => runPublishJob(deps, opts, log))
  dailyPerRunner(
    'publish-morning',
    PUBLISH_MORNING_SLOT,
    async () =>
      (
        await deps.prisma.deliveryChannel.findMany({
          where: { channel: PUBLISH_CHANNEL, enabled: true },
          select: { userId: true },
        })
      ).map((channel) => ({ userId: channel.userId, since: new Date(0) })),
    (userIds, days) => runPublishJob(deps, { ...opts, force: true, userIds, days }, log),
  )

  return () => {
    stopped = true
    for (const timer of timers) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    timers.clear()
  }
}
