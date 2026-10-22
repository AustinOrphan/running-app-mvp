import type { Deps } from '../app.ts'
import { createLogger } from '../logger.ts'
import { PROVIDERS } from '../providers/registry.ts'
import { scanFolderIntegration } from '../services/folder.ts'
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
 * Starts the hourly sync, 5-minute folder scan and 10-minute weather jobs; returns `stop()`.
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

  every('sync', SYNC_INTERVAL_MS, () => runSyncJob(deps, opts, log))
  every('folder', FOLDER_INTERVAL_MS, () => runFolderJob(deps, log))
  every('weather', WEATHER_INTERVAL_MS, () => runWeatherJob(deps, opts, log))

  return () => {
    stopped = true
    for (const timer of timers) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    timers.clear()
  }
}
