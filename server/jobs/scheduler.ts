import { todayIso } from '../../shared/dates.ts'
import type { SyncStatus, SyncTrigger, WeeklyUpdateStatus } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { PrismaClient } from '../db.ts'
import { createLogger } from '../logger.ts'
import { PROVIDERS } from '../providers/registry.ts'
import { runNightlyMatching } from '../services/execution.ts'
import { scanFolderIntegration } from '../services/folder.ts'
import { replanActivePlan } from '../services/planEngine.ts'
import { ensureWeeklyPrediction } from '../services/predictionLog.ts'
import { syncProvider } from '../services/sync.ts'
import { recordSyncRun, safeMessage } from '../services/syncLog.ts'
import { enrichWeather } from '../services/weather.ts'

const MINUTE_MS = 60_000
export const SYNC_INTERVAL_MS = 60 * MINUTE_MS
export const FOLDER_INTERVAL_MS = 5 * MINUTE_MS
export const WEATHER_INTERVAL_MS = 10 * MINUTE_MS
/** How often the weekly catch-up looks for a plan whose Monday update never ran. */
export const CATCHUP_INTERVAL_MS = 6 * 60 * MINUTE_MS
/** How often the weekly prediction job looks for a week that has no logged prediction. */
export const PREDICTION_INTERVAL_MS = 6 * 60 * MINUTE_MS
/** Activities that get weather per user per run. */
const WEATHER_BATCH = 50
/** The first run waits, so a crash loop never hammers a provider. */
const FIRST_RUN_DELAY_MS = 30_000

type Log = ReturnType<typeof createLogger>

/**
 * Writes the `job` run of one scheduled job for one user (spec 4.7). The job name is the
 * `provider` of the row, so `GET /api/jobs` finds the latest run of each. An error is stored
 * through `safeMessage`.
 */
async function recordJob(
  deps: Deps,
  job: string,
  userId: string,
  startedAt: Date,
  outcome: {
    trigger?: SyncTrigger
    status?: SyncStatus
    error?: unknown
    accepted?: number
    duplicate?: number
    failed?: number
  } = {},
): Promise<void> {
  const failed = outcome.error !== undefined && outcome.error !== null
  await recordSyncRun(deps, {
    userId,
    provider: job,
    channel: 'job',
    trigger: outcome.trigger ?? 'schedule',
    startedAt,
    status: failed ? 'error' : (outcome.status ?? 'ok'),
    accepted: outcome.accepted ?? 0,
    duplicate: outcome.duplicate ?? 0,
    failed: outcome.failed ?? 0,
    message: failed ? outcome.error : null,
  })
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
  opts: { fetch: typeof fetch; now?: Date },
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
  for (const [userId, providers] of byUser) {
    const startedAt = new Date()
    let thrown: unknown = null
    for (const provider of providers) {
      try {
        // syncProvider records its own failures on the row and in the log; this only keeps the
        // loop going.
        await syncProvider(deps, userId, provider, { fetch: opts.fetch, trigger: 'schedule' })
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
    await recordJob(deps, 'sync', userId, startedAt, {
      status,
      error: thrown ?? (failedRun ? (failedRun.message ?? 'A sync did not finish.') : null),
      accepted: sum('accepted'),
      duplicate: sum('duplicate'),
      failed: sum('failed'),
    })
  }
}

/**
 * Scans the watched folder of every user who set one. Each scan writes its own `folder` run, so
 * the job adds no row of its own.
 */
export async function runFolderJob(deps: Deps, log?: Log): Promise<void> {
  const rows = await deps.prisma.integration.findMany({
    where: { provider: 'folder', status: { in: ['connected', 'error'] } },
    orderBy: { createdAt: 'asc' },
  })
  for (const row of rows) {
    try {
      await scanFolderIntegration(deps, row.userId, { trigger: 'schedule' })
    } catch (error) {
      // The row already holds the message; the next scan retries.
      log?.warn({ reason: safeMessage(error) }, 'folder scan failed')
    }
  }
}

/** Fills weather on the newest activities that lack it, for every user. */
export async function runWeatherJob(
  deps: Deps,
  opts: { fetch: typeof fetch; now?: Date },
  log?: Log,
): Promise<void> {
  const users = await deps.prisma.user.findMany({ select: { id: true } })
  for (const user of users) {
    const startedAt = new Date()
    try {
      const filled = await enrichWeather(deps, user.id, {
        limit: WEATHER_BATCH,
        fetch: opts.fetch,
        now: opts.now ?? new Date(),
      })
      await recordJob(deps, 'weather', user.id, startedAt, { accepted: filled })
    } catch (error) {
      log?.warn({ reason: safeMessage(error) }, 'weather backfill failed')
      await recordJob(deps, 'weather', user.id, startedAt, { error })
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
  opts: { now?: Date } = {},
  log?: Log,
): Promise<void> {
  const today = todayIso(opts.now ?? new Date())
  const users = await deps.prisma.user.findMany({ select: { id: true } })
  for (const user of users) {
    const startedAt = new Date()
    try {
      const outcome = await ensureWeeklyPrediction(deps, user.id, today)
      await recordJob(deps, 'predictions', user.id, startedAt, {
        accepted: outcome === 'created' ? 1 : 0,
      })
    } catch (error) {
      log?.warn({ reason: safeMessage(error), userId: user.id }, 'weekly prediction failed')
      await recordJob(deps, 'predictions', user.id, startedAt, { error })
    }
  }
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
 * Nightly: links the last 7 days of unlinked activities to planned sessions and re-assesses the
 * linked ones, for every user with a version-2 plan [design 4.1].
 */
export async function runMatchingJob(
  deps: Deps,
  opts: { now?: Date } = {},
  log?: Log,
): Promise<void> {
  const users = await activePlanUsers(deps.prisma)
  const startedAt = new Date()
  const errors = new Map<string, unknown>()
  let thrown: Error | null = null
  try {
    await runNightlyMatching(deps, {
      today: todayIso(opts.now ?? new Date()),
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

export interface DailySlot {
  /** 0 Sunday .. 6 Saturday, in the server's local time; every day when absent. */
  weekday?: number
  hour: number
  minute: number
}

/**
 * The slot's occurrence in the current Monday-based week, in the server's local time (ADR 0003), or
 * null when it has not come yet this week.
 */
export function weekSlotStart(now: Date, slot: DailySlot & { weekday: number }): Date | null {
  const daysSinceMonday = (now.getDay() + 6) % 7
  const slotOffset = (slot.weekday + 6) % 7
  const start = new Date(now)
  start.setDate(now.getDate() - daysSinceMonday + slotOffset)
  start.setHours(slot.hour, slot.minute, 0, 0)
  return start.getTime() <= now.getTime() ? start : null
}

/** Revisions that count as the week's automatic update. */
const WEEKLY_REASONS = ['weekly', 'break']

/**
 * Users whose weekly update is due: an active version-2 plan whose goal date has not passed, this
 * week's `REPLAN_SLOT` has come, and no `weekly` or `break` revision exists since it. `userId`
 * narrows the answer to one user.
 */
async function usersDueForWeeklyUpdate(
  prisma: PrismaClient,
  now: Date,
  userId?: string,
): Promise<string[]> {
  const start = weekSlotStart(now, REPLAN_SLOT)
  if (start === null) return []
  const plans = await prisma.plan.findMany({
    where: {
      ...(userId === undefined ? {} : { userId }),
      status: 'active',
      generatorVersion: { gte: 2 },
      goal: { targetDate: { gte: todayIso(now) } },
      revisions: { none: { reason: { in: WEEKLY_REASONS }, createdAt: { gte: start } } },
    },
    select: { userId: true },
  })
  return [...new Set(plans.map((plan) => plan.userId))]
}

/** Whether this week's automatic plan update has run, for `GET /api/jobs` and Today's health note. */
export async function weeklyUpdateStatus(
  prisma: PrismaClient,
  userId: string,
  now: Date,
): Promise<WeeklyUpdateStatus> {
  const last = await prisma.planRevision.findFirst({
    where: { reason: { in: WEEKLY_REASONS }, plan: { userId, status: 'active' } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  const due = (await usersDueForWeeklyUpdate(prisma, now, userId)).length > 0
  return { due, lastRevisionAt: last ? last.createdAt.toISOString() : null }
}

/** Users being re-planned now, so the 03:00 slot and the catch-up never re-plan one twice at once. */
const replanning = new Set<string>()

/**
 * Monday: re-plans every active version-2 plan from the updated state [design 5].
 *
 * With `catchUp`, only the plans whose weekly update is due (see `usersDueForWeeklyUpdate`) are
 * re-planned and the runs are recorded with trigger `catchup`: a server that was down at 03:00 on
 * Monday still makes the week's update when it comes back (ADR 0007). A failed catch-up waits for
 * the next tick. A user whose re-plan is already running is skipped and records nothing.
 */
export async function runReplanJob(
  deps: Deps,
  opts: { now?: Date; catchUp?: boolean } = {},
  log?: Log,
): Promise<void> {
  const now = opts.now ?? new Date()
  const today = todayIso(now)
  const users = opts.catchUp
    ? await usersDueForWeeklyUpdate(deps.prisma, now)
    : await activePlanUsers(deps.prisma)
  const trigger: SyncTrigger = opts.catchUp ? 'catchup' : 'schedule'
  for (const userId of users) {
    if (replanning.has(userId)) continue
    replanning.add(userId)
    const startedAt = new Date()
    try {
      await replanActivePlan(deps, { userId, reason: 'weekly', today })
      await recordJob(deps, 'replan', userId, startedAt, { trigger })
    } catch (error) {
      // A plan that fails its checklist or whose goal has passed stays as it is.
      log?.warn({ reason: safeMessage(error), userId }, 'weekly re-plan failed')
      await recordJob(deps, 'replan', userId, startedAt, { trigger, error })
    } finally {
      replanning.delete(userId)
    }
  }
}

/**
 * The local date (`YYYY-MM-DD`) of the slot that is due at `now`, or null when today's slot has
 * not come yet, is not today's weekday, or was already run (`last`).
 */
export function dueSlot(now: Date, last: string | null, slot: DailySlot): string | null {
  if (slot.weekday !== undefined && now.getDay() !== slot.weekday) return null
  if (now.getHours() * 60 + now.getMinutes() < slot.hour * 60 + slot.minute) return null
  const key = todayIso(now)
  return key === last ? null : key
}

/** How often the daily jobs check whether their slot has come. */
const SLOT_CHECK_MS = 10 * MINUTE_MS
/** Nightly matching runs first, so the Monday re-plan sees the week's links. */
export const MATCHING_SLOT: DailySlot = { hour: 2, minute: 30 }
export const REPLAN_SLOT = { weekday: 1, hour: 3, minute: 0 } satisfies DailySlot

/**
 * Starts the hourly sync, 5-minute folder scan and 10-minute weather jobs, the nightly matching
 * (02:30 local), the Monday re-plan (03:00 local) and its catch-up, and the weekly prediction log
 * (each 30 s after start, then every 6 hours); returns `stop()`.
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

  every('sync', SYNC_INTERVAL_MS, () => runSyncJob(deps, opts, log))
  every('folder', FOLDER_INTERVAL_MS, () => runFolderJob(deps, log))
  every('weather', WEATHER_INTERVAL_MS, () => runWeatherJob(deps, opts, log))
  daily('matching', MATCHING_SLOT, () => runMatchingJob(deps, {}, log))
  daily('replan', REPLAN_SLOT, () => runReplanJob(deps, {}, log))
  // The daily slot is seeded at start, so a restart after 03:00 on Monday would skip the week.
  every('replan-catchup', CATCHUP_INTERVAL_MS, () => runReplanJob(deps, { catchUp: true }, log))
  every('predictions', PREDICTION_INTERVAL_MS, () => runPredictionJob(deps, {}, log))

  return () => {
    stopped = true
    for (const timer of timers) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    timers.clear()
  }
}
