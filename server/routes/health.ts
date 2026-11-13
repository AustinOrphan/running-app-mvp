import { Router } from 'express'
import type { Deps } from '../app.ts'
import { sqliteFilePath } from '../dbPath.ts'
import { backupDirectory, listOrdinaryBackups } from '../services/backup.ts'

/**
 * The oldest newest-backup that the deep probe still calls healthy: 26 hours. The job runs once a
 * day (02:00), so a healthy install never has a newest copy older than 24 hours; the 2 hours are
 * slack for a copy that starts late (a restart is caught up 30 seconds after start) and for a
 * monitor that polls just before the next copy lands.
 */
export const MAX_BACKUP_AGE_HOURS = 26
const HOUR_S = 3600
/**
 * How long the deep probe reuses its body: 10 seconds. The route is anonymous and reads the backups
 * folder and the job log, so a burst of polls (or a hostile client under the address limit) costs
 * one read per window. A monitor polls every minute or so, and a 10 s lag is invisible against a
 * 26 hour bound.
 */
export const DEEP_HEALTH_CACHE_MS = 10_000

export interface DeepHealth {
  status: 'ok' | 'unavailable'
  database: 'ok' | 'error'
  backup: { ageSeconds: number | null; maxAgeSeconds: number; fresh: boolean }
  jobs: Array<{ job: string; status: string; ageSeconds: number }>
}

const ageSeconds = (now: Date, at: Date): number =>
  Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000))

/**
 * What the operator's monitor reads: whether the database answers `SELECT 1`, the age of the newest
 * ordinary backup file, and the age and status of the last run of each job in the job log. Coarse
 * fields only: no user id, email, path or count of anyone's data. A job name is a constant.
 */
export async function deepHealth(deps: Deps, now: Date): Promise<DeepHealth> {
  let databaseOk = true
  let jobs: DeepHealth['jobs'] = []
  try {
    await deps.prisma.$queryRaw`SELECT 1`
    const latest = await deps.prisma.syncRun.groupBy({
      by: ['provider'],
      where: { channel: 'job' },
      _max: { startedAt: true },
    })
    for (const row of latest) {
      const startedAt = row._max.startedAt
      if (startedAt === null) continue
      const run = await deps.prisma.syncRun.findFirst({
        where: { channel: 'job', provider: row.provider, startedAt },
        orderBy: { id: 'asc' },
        select: { status: true },
      })
      jobs.push({
        job: row.provider,
        status: run?.status ?? 'unknown',
        ageSeconds: ageSeconds(now, startedAt),
      })
    }
    jobs.sort((a, b) => (a.job < b.job ? -1 : 1))
  } catch {
    databaseOk = false
    jobs = []
  }

  let newest: Date | null = null
  try {
    const dir = backupDirectory(sqliteFilePath(deps.config.databaseUrl))
    newest = listOrdinaryBackups(dir)[0]?.at ?? null
  } catch {
    // An unreadable folder is reported as no backup.
  }
  const maxAgeSeconds = MAX_BACKUP_AGE_HOURS * HOUR_S
  const age = newest === null ? null : ageSeconds(now, newest)
  const fresh = age !== null && age <= maxAgeSeconds
  return {
    status: databaseOk && fresh ? 'ok' : 'unavailable',
    database: databaseOk ? 'ok' : 'error',
    backup: { ageSeconds: age, maxAgeSeconds, fresh },
    jobs,
  }
}

export function healthRouter(
  deps: Deps,
  opts: { cacheMs?: number | undefined; now?: () => Date } = {},
): Router {
  const router = Router()
  const cacheMs = opts.cacheMs ?? DEEP_HEALTH_CACHE_MS
  const clock = opts.now ?? (() => new Date())
  let cached: { at: number; body: Promise<DeepHealth> } | null = null
  // The cheap liveness probe: touches nothing.
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  // The operator's monitor: anonymous like the probe above, behind the same address limiter.
  router.get('/health/deep', async (_req, res, next) => {
    try {
      const now = clock()
      if (cached === null || now.getTime() - cached.at >= cacheMs || cacheMs <= 0) {
        const body = deepHealth(deps, now)
        cached = { at: now.getTime(), body }
        // A rejected read is not kept for the window.
        body.catch(() => {
          if (cached?.body === body) cached = null
        })
      }
      const body = await cached.body
      res.status(body.status === 'ok' ? 200 : 503).json(body)
    } catch (error) {
      next(error)
    }
  })
  return router
}
