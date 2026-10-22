import { todayIso } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { createLogger } from '../logger.ts'
import { PROVIDERS } from '../providers/registry.ts'
import { runNightlyMatching } from '../services/execution.ts'
import { scanFolderIntegration } from '../services/folder.ts'
import { replanActivePlan } from '../services/planEngine.ts'
import { syncProvider } from '../services/sync.ts'
import { enrichWeather } from '../services/weather.ts'

const MINUTE_MS = 60_000
export const SYNC_INTERVAL_MS = 60 * MINUTE_MS
export const FOLDER_INTERVAL_MS = 5 * MINUTE_MS
export const WEATHER_INTERVAL_MS = 10 * MINUTE_MS
/** Activities that get weather per user per run. */
const WEATHER_BATCH = 50
/** The first run waits, so a crash loop never hammers a provider. */
const FIRST_RUN_DELAY_MS = 30_000

type Log = ReturnType<typeof createLogger>

/** Pull-syncs every connected provider that is not paused, one after another. */
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
  for (const row of rows) {
    try {
      // syncProvider records its own failures on the row; this only keeps the loop going.
      await syncProvider(deps, row.userId, row.provider, { fetch: opts.fetch })
    } catch (error) {
      log?.warn({ err: error, provider: row.provider }, 'scheduled sync failed')
    }
  }
}

/** Scans the watched folder of every user who set one. */
export async function runFolderJob(deps: Deps, log?: Log): Promise<void> {
  const rows = await deps.prisma.integration.findMany({
    where: { provider: 'folder', status: { in: ['connected', 'error'] } },
    orderBy: { createdAt: 'asc' },
  })
  for (const row of rows) {
    try {
      await scanFolderIntegration(deps, row.userId)
    } catch (error) {
      // The row already holds the message; the next scan retries.
      log?.warn({ err: error }, 'folder scan failed')
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
    try {
      await enrichWeather(deps, user.id, {
        limit: WEATHER_BATCH,
        fetch: opts.fetch,
        now: opts.now ?? new Date(),
      })
    } catch (error) {
      log?.warn({ err: error }, 'weather backfill failed')
    }
  }
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
  await runNightlyMatching(deps, {
    today: todayIso(opts.now ?? new Date()),
    onError: (error, userId) => log?.warn({ err: error, userId }, 'nightly matching failed'),
  })
}

/** Monday: re-plans every active version-2 plan from the updated state [design 5]. */
export async function runReplanJob(
  deps: Deps,
  opts: { now?: Date } = {},
  log?: Log,
): Promise<void> {
  const today = todayIso(opts.now ?? new Date())
  const plans = await deps.prisma.plan.findMany({
    where: { status: 'active', generatorVersion: { gte: 2 } },
    select: { userId: true },
  })
  for (const { userId } of plans) {
    try {
      await replanActivePlan(deps, { userId, reason: 'weekly', today })
    } catch (error) {
      // A plan that fails its checklist or whose goal has passed stays as it is.
      log?.warn({ err: error, userId }, 'weekly re-plan failed')
    }
  }
}

export interface DailySlot {
  /** 0 Sunday .. 6 Saturday, in the server's local time; every day when absent. */
  weekday?: number
  hour: number
  minute: number
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
export const REPLAN_SLOT: DailySlot = { weekday: 1, hour: 3, minute: 0 }

/**
 * Starts the hourly sync, 5-minute folder scan and 10-minute weather jobs, the nightly matching
 * (02:30 local) and the Monday re-plan (03:00 local); returns `stop()`.
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

  return () => {
    stopped = true
    for (const timer of timers) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    timers.clear()
  }
}
