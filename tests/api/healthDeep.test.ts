import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { sqliteFilePath } from '../../server/dbPath.ts'
import {
  DEEP_HEALTH_CACHE_MS,
  MAX_BACKUP_AGE_HOURS,
  type DeepHealth,
} from '../../server/routes/health.ts'
import { backupDirectory, backupName } from '../../server/services/backup.ts'
import { client, createTestCtx, expectNoRefusedFetches, seedUser, type TestCtx } from './helpers.ts'

// Every line the server logs, at every level (the real logger is silent under test).
const logged = vi.hoisted(() => ({ lines: [] as string[] }))
vi.mock('../../server/logger.ts', async () => {
  const { pino } = await import('pino')
  return {
    createLogger: () =>
      pino({ level: 'debug' }, { write: (chunk: string) => void logged.lines.push(chunk) }),
  }
})

const HOUR_MS = 3_600_000

let ctx: TestCtx
const dir = () => backupDirectory(sqliteFilePath(ctx.config.databaseUrl))

function seedBackup(hoursAgo: number): void {
  mkdirSync(dir(), { recursive: true })
  writeFileSync(join(dir(), backupName('ordinary', new Date(Date.now() - hoursAgo * HOUR_MS))), '')
}

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterEach(async () => {
  vi.restoreAllMocks()
  rmSync(dir(), { recursive: true, force: true })
  await ctx.prisma.syncRun.deleteMany()
  logged.lines.length = 0
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  await ctx.close()
})

describe('GET /api/health/deep', () => {
  test('answers 200 with the stated fields when the database answers and the backup is fresh', async () => {
    const user = await seedUser(ctx)
    seedBackup(3)
    const at = new Date(Date.now() - 2 * HOUR_MS)
    await ctx.prisma.syncRun.create({
      data: {
        userId: user.id,
        provider: 'weather',
        channel: 'job',
        trigger: 'schedule',
        startedAt: at,
        finishedAt: at,
        status: 'partial',
      },
    })
    await ctx.prisma.syncRun.create({
      data: {
        userId: user.id,
        provider: 'intervals',
        channel: 'pull',
        trigger: 'schedule',
        startedAt: at,
        finishedAt: at,
        status: 'ok',
      },
    })

    const res = await client(ctx).get('/api/health/deep')
    expect(res.status).toBe(200)
    const body = res.body as DeepHealth
    expect(Object.keys(body).sort()).toEqual(['backup', 'database', 'jobs', 'status'])
    expect(res.body).toMatchObject({
      status: 'ok',
      database: 'ok',
      backup: { maxAgeSeconds: MAX_BACKUP_AGE_HOURS * 3600, fresh: true },
    })
    expect(Object.keys(body.backup).sort()).toEqual(['ageSeconds', 'fresh', 'maxAgeSeconds'])
    expect(Math.abs((body.backup.ageSeconds ?? 0) - 3 * 3600)).toBeLessThan(60)
    // Only job runs, and only a name, a status and an age; nothing that names a user.
    expect(body.jobs).toHaveLength(1)
    expect(Object.keys(body.jobs[0] ?? {}).sort()).toEqual(['ageSeconds', 'job', 'status'])
    expect(body.jobs[0]).toMatchObject({ job: 'weather', status: 'partial' })
    const text = JSON.stringify(body)
    expect(text).not.toContain(user.id)
    expect(text).not.toContain(user.email)
    expect(text).not.toContain(dir())
  })

  test('answers 503 when there is no backup', async () => {
    const res = await client(ctx).get('/api/health/deep')
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({
      status: 'unavailable',
      database: 'ok',
      backup: { ageSeconds: null, fresh: false },
    })
  })

  test('answers 503 when the newest backup is older than the bound, 200 just inside it', async () => {
    seedBackup(MAX_BACKUP_AGE_HOURS + 1)
    const old = await client(ctx).get('/api/health/deep')
    expect(old.status).toBe(503)
    expect((old.body as DeepHealth).backup.fresh).toBe(false)

    seedBackup(MAX_BACKUP_AGE_HOURS - 1)
    expect((await client(ctx).get('/api/health/deep')).status).toBe(200)
  })

  test('answers 503 when the database does not answer', async () => {
    seedBackup(1)
    vi.spyOn(ctx.prisma, '$queryRaw').mockRejectedValue(new Error('disk I/O error at /secret/x.db'))
    const res = await client(ctx).get('/api/health/deep')
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ status: 'unavailable', database: 'error', jobs: [] })
    expect(JSON.stringify(res.body)).not.toContain('secret')
  })

  test('needs no cookie, and the cheap probe still touches nothing', async () => {
    const spy = vi.spyOn(ctx.prisma, '$queryRaw')
    const res = await client(ctx).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
    expect(spy).not.toHaveBeenCalled()
  })

  test('neither probe appears in the request log, another route does', async () => {
    await client(ctx).get('/api/health')
    await client(ctx).get('/api/health/deep')
    await client(ctx).get('/api/health?x=1')
    expect(logged.lines.join('')).not.toContain('/api/health')
    await client(ctx).get('/api/nothing-here')
    expect(logged.lines.join('')).toContain('/api/nothing-here')
  })
})

describe('the deep probe cache', () => {
  let cached: TestCtx

  beforeAll(async () => {
    cached = await createTestCtx({}, { healthCacheMs: DEEP_HEALTH_CACHE_MS })
  })
  afterAll(async () => {
    vi.useRealTimers()
    await cached.close()
  })

  test('two probes inside the window read once; one after it reads again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 17, 12))
    const spy = vi.spyOn(cached.prisma, '$queryRaw')
    const first = await client(cached).get('/api/health/deep')
    vi.setSystemTime(new Date(2026, 5, 17, 12, 0, DEEP_HEALTH_CACHE_MS / 1000 - 1))
    const second = await client(cached).get('/api/health/deep')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(second.status).toBe(first.status)
    expect(second.body).toEqual(first.body)

    vi.setSystemTime(new Date(2026, 5, 17, 12, 0, DEEP_HEALTH_CACHE_MS / 1000))
    await client(cached).get('/api/health/deep')
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
    expectNoRefusedFetches(cached)
  })
})
