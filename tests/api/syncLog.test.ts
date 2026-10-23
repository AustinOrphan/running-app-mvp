import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PrismaClient } from '../../server/db.ts'
import { createLogger } from '../../server/logger.ts'
import { garminProvider } from '../../server/providers/garmin.ts'
import {
  RateLimitPause,
  WellnessTruncated,
  type RemoteActivityRef,
} from '../../server/providers/types.ts'
import { runFolderJob, runSyncJob } from '../../server/jobs/scheduler.ts'
import { scanFolderIntegration } from '../../server/services/folder.ts'
import {
  SECRET_CHANGED,
  sealSecret,
  settleBackground,
  syncProvider,
} from '../../server/services/sync.ts'
import {
  MAX_FAILURES_STORED,
  MAX_MESSAGE_CHARS,
  MAX_RUNS_KEPT,
  RUN_RETENTION_DAYS,
  recordSyncRun,
} from '../../server/services/syncLog.ts'
import type { SyncRunView, WellnessInput } from '../../shared/types.ts'
import { fakeFetch, type FakeRoute } from '../fakeFetch.ts'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import {
  client,
  createTestCtx,
  noNetwork,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// Every log line the server writes in this file, at every level (the real logger is silent under
// test), so a test can prove a token never reached one. The redaction is the real logger's.
const logged = vi.hoisted(() => ({ lines: [] as string[] }))
vi.mock('../../server/logger.ts', async () => {
  const { pino } = await import('pino')
  return {
    createLogger: () =>
      pino(
        {
          level: 'debug',
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        },
        {
          write: (chunk: string) => {
            logged.lines.push(chunk)
          },
        },
      ),
  }
})

const BASE = 'https://intervals.icu/api/v1'
const DAY_MS = 86_400_000
/** A synthetic credential: every assertion below looks for it in rows, responses and logs. */
const API_KEY = 'synthetic-api-key-0123456789'
const BEARER = 'synthetic-bearer-abcdef012345'

let ctx: TestCtx
let user: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  logged.lines.length = 0
  await ctx.prisma.syncRun.deleteMany()
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.wellnessDay.deleteMany()
  await ctx.prisma.importedFile.deleteMany()
  await ctx.prisma.importBatch.deleteMany()
  await ctx.prisma.integration.deleteMany()
})

afterEach(() => {
  vi.restoreAllMocks()
  ctx.fetch = noNetwork()
})

function deps() {
  return { prisma: ctx.prisma, config: ctx.config }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

async function connect(provider = 'intervals', secret: object = { apiKey: API_KEY }) {
  return ctx.prisma.integration.create({
    data: {
      userId: user.id,
      provider,
      status: 'connected',
      secret: sealSecret(secret, ctx.config.sessionSecret),
      config: JSON.stringify({ athleteId: 'i1001' }),
    },
  })
}

interface Remote {
  id: string
  startUtc: string
  fail?: string
}

/** intervals.icu as the provider reads it; `fail` is the text of the error a download throws. */
function intervals(remote: Remote[], extra: Record<string, FakeRoute> = {}) {
  const routes: Record<string, FakeRoute> = {
    [`GET ${BASE}/athlete/i1001/activities`]: () =>
      json(remote.map((r) => ({ id: r.id, start_date: r.startUtc }))),
    [`GET ${BASE}/athlete/i1001/wellness.json`]: () =>
      json([{ id: '2026-03-02', restingHR: 50, hrv: 62.5, sleepSecs: 27_000, weight: 70 }]),
    ...extra,
  }
  for (const r of remote) {
    routes[`GET ${BASE}/activity/${r.id}/file`] = () => json({}, 404)
    routes[`GET ${BASE}/activity/${r.id}/streams.json`] = () => {
      if (r.fail !== undefined) throw new Error(r.fail)
      return json([
        { type: 'time', data: [0, 10, 20, 30, 40, 50, 60] },
        { type: 'distance', data: [0, 30, 60, 90, 120, 150, 180] },
        { type: 'heartrate', data: [120, 125, 130, 130, 132, 135, 136] },
      ])
    }
    routes[`GET ${BASE}/activity/${r.id}`] = () =>
      json({
        id: r.id,
        type: 'Run',
        start_date: r.startUtc,
        start_date_local: r.startUtc.replace('Z', ''),
        distance: 180,
        moving_time: 60,
        elapsed_time: 60,
        average_heartrate: 130,
      })
  }
  return fakeFetch(routes)
}

async function runs(): Promise<SyncRunView[]> {
  const res = await client(ctx, user).get('/api/integrations/intervals/runs')
  expect(res.status).toBe(200)
  return res.body as SyncRunView[]
}

/** Every stored place a token could end up: runs, the integration row and the import reports. */
async function everythingStored(): Promise<string> {
  return JSON.stringify([
    await ctx.prisma.syncRun.findMany(),
    await ctx.prisma.integration.findMany({ select: { lastError: true, config: true } }),
    await ctx.prisma.importBatch.findMany({ select: { errors: true } }),
  ])
}

describe('a pull writes one run', () => {
  test('a run that stores activities and wellness records its counts and its batch', async () => {
    await connect()
    const fetchFn = intervals([
      { id: 'i1', startUtc: '2026-03-02T07:00:00Z' },
      { id: 'i2', startUtc: '2026-03-05T07:00:00Z' },
    ])
    const batch = await syncProvider(deps(), user.id, 'intervals', { fetch: fetchFn })

    const [run, ...rest] = await runs()
    expect(rest).toEqual([])
    expect(run).toMatchObject({
      provider: 'intervals',
      channel: 'pull',
      trigger: 'schedule',
      status: 'ok',
      accepted: 2,
      duplicate: 0,
      failed: 0,
      wellnessStatus: 'read',
      wellnessDays: 1,
      wellnessTotal: null,
      message: null,
      failures: [],
      importBatchId: batch?.id,
    })
    expect(Date.parse(run?.startedAt ?? '')).toBeLessThanOrEqual(Date.parse(run?.finishedAt ?? ''))
  })

  test('an idle run is recorded too, with nothing stored and no batch', async () => {
    await connect()
    const fetchFn = intervals([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z' }])
    await syncProvider(deps(), user.id, 'intervals', { fetch: fetchFn })
    await syncProvider(deps(), user.id, 'intervals', { fetch: fetchFn })

    const [idle, first] = await runs()
    expect(first).toMatchObject({ accepted: 1 })
    expect(idle).toMatchObject({
      status: 'ok',
      accepted: 0,
      duplicate: 0,
      failed: 0,
      importBatchId: null,
    })
  })

  test('the trigger is schedule by default and manual when the owner asks', async () => {
    await connect()
    const fetchFn = intervals([])
    await syncProvider(deps(), user.id, 'intervals', { fetch: fetchFn })
    await syncProvider(deps(), user.id, 'intervals', { fetch: fetchFn, trigger: 'manual' })
    expect((await runs()).map((run) => run.trigger)).toEqual(['manual', 'schedule'])
  })

  test('a failed activity makes a partial run that names it', async () => {
    await connect()
    const fetchFn = intervals([
      { id: 'i1', startUtc: '2026-03-02T07:00:00Z' },
      { id: 'i2', startUtc: '2026-03-05T07:00:00Z', fail: 'stream unreadable' },
    ])
    await syncProvider(deps(), user.id, 'intervals', { fetch: fetchFn })

    const [run] = await runs()
    expect(run).toMatchObject({ status: 'partial', accepted: 1, failed: 1 })
    expect(run?.failures).toHaveLength(1)
    expect(run?.failures[0]?.ref).toBe('intervals:i2')
    expect(run?.failures[0]?.reason).toContain('stream unreadable')
  })

  test('stores the first 10 failures and counts them all', async () => {
    await connect()
    const remote = Array.from({ length: 12 }, (_, i) => ({
      id: `f${String(i)}`,
      startUtc: `2026-03-${String(10 + i)}T07:00:00Z`,
      fail: `unreadable ${String(i)}`,
    }))
    // Five failures in a row stop a run, so the failing activities alternate with good ones.
    const mixed: Remote[] = remote.flatMap((r, i) => [
      r,
      { id: `ok${String(i)}`, startUtc: `2026-03-${String(10 + i)}T09:00:00Z` },
    ])
    await syncProvider(deps(), user.id, 'intervals', { fetch: intervals(mixed) })

    const [run] = await runs()
    expect(run?.failed).toBe(12)
    expect(run?.failures).toHaveLength(MAX_FAILURES_STORED)
  })

  test('a rate limit records a paused run and says wellness waits', async () => {
    await connect()
    const limited = fakeFetch({
      [`GET ${BASE}/athlete/i1001/activities`]: () => json({}, 429, { 'retry-after': '120' }),
    })
    await syncProvider(deps(), user.id, 'intervals', { fetch: limited })

    const [run] = await runs()
    expect(run).toMatchObject({
      status: 'paused',
      wellnessStatus: 'waiting',
      wellnessDays: null,
      wellnessTotal: null,
    })
    expect(run?.message).toBeTruthy()
  })

  test('an outage records an error run with the service text', async () => {
    await connect()
    const down = fakeFetch({ [`GET ${BASE}/athlete/i1001/activities`]: () => json({}, 503) })
    await syncProvider(deps(), user.id, 'intervals', { fetch: down })

    const [run] = await runs()
    expect(run).toMatchObject({ status: 'error', wellnessStatus: 'none' })
    expect(run?.message).toContain('503')
  })

  test('a changed session secret records the reconnect run', async () => {
    await connect()
    const other = {
      prisma: ctx.prisma,
      config: { ...ctx.config, sessionSecret: 'a-different-session-secret-0123456789abc' },
    }
    await syncProvider(other, user.id, 'intervals', { fetch: fakeFetch({}) })
    const [run] = await runs()
    expect(run).toMatchObject({ status: 'error', message: SECRET_CHANGED })
  })

  test('a wellness failure makes a partial run and reads "could not be read"', async () => {
    await connect()
    const fetchFn = intervals([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z' }], {
      [`GET ${BASE}/athlete/i1001/wellness.json`]: () => json({}, 500),
    })
    await syncProvider(deps(), user.id, 'intervals', { fetch: fetchFn })

    const [run] = await runs()
    expect(run).toMatchObject({ status: 'partial', accepted: 1, wellnessStatus: 'error' })
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.lastSyncStatus).toBe('partial')
    expect(row.lastError).toMatch(/^Wellness could not be read: /)
    expect(row.lastError).not.toMatch(/sync failed/)
  })

  test('skipped runs record nothing: already running, not connected, needs reconnecting', async () => {
    await connect()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = intervals([], {
      [`GET ${BASE}/athlete/i1001/activities`]: async () => {
        await gate
        return json([])
      },
    })
    const first = syncProvider(deps(), user.id, 'intervals', { fetch: slow })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await syncProvider(deps(), user.id, 'intervals', { fetch: slow })).toBeNull()
    release()
    await first
    expect(await ctx.prisma.syncRun.count()).toBe(1)

    await expect(syncProvider(deps(), user.id, 'strava')).rejects.toMatchObject({ status: 404 })
    await ctx.prisma.integration.updateMany({ data: { status: 'needs_auth' } })
    await expect(syncProvider(deps(), user.id, 'intervals')).rejects.toMatchObject({ status: 409 })
    expect(await ctx.prisma.syncRun.count()).toBe(1)
  })

  test('the scheduler skips a paused provider and records no run for it', async () => {
    await connect()
    await ctx.prisma.integration.updateMany({
      data: { pausedUntil: new Date(Date.now() + 3_600_000) },
    })
    await runSyncJob(deps(), { fetch: fakeFetch({}) })
    expect(await ctx.prisma.syncRun.count({ where: { channel: 'pull' } })).toBe(0)
  })
})

describe('Garmin wellness that stops early', () => {
  const day: WellnessInput = {
    date: '2026-10-22',
    restingHr: 48,
    hrvRmssd: 61,
    hrvSdnn: null,
    sleepSec: 27_000,
    sleepScore: 80,
    weightKg: null,
    vo2max: null,
  }
  const budget = 'Garmin request budget (200) used up for this run.'

  /** A Garmin activity list with nothing new in it, or one that stops with `failure`. */
  function remoteList(failure?: Error): AsyncIterable<RemoteActivityRef> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          failure ? Promise.reject(failure) : Promise.resolve({ done: true, value: undefined }),
      }),
    }
  }

  function noActivities(): void {
    vi.spyOn(garminProvider, 'listActivities').mockImplementation(() => remoteList())
  }

  test('stores the days it read and records a paused run, never an ok one', async () => {
    await connect('garmin', { accessToken: API_KEY, refreshToken: BEARER })
    noActivities()
    vi.spyOn(garminProvider, 'listWellness').mockRejectedValue(
      new WellnessTruncated(budget, {
        retryAfterSec: 3600,
        rows: [day],
        daysRead: 12,
        daysTotal: 30,
      }),
    )
    const before = Date.now()
    await syncProvider(deps(), user.id, 'garmin')

    expect(await ctx.prisma.wellnessDay.findMany()).toMatchObject([
      { date: '2026-10-22', restingHr: 48, source: 'garmin' },
    ])
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.lastSyncStatus).toBe('paused')
    expect(row.status).toBe('connected')
    expect(row.lastError).toBe(`Wellness stopped after 12 of 30 days: ${budget}`)
    const waitMs = (row.pausedUntil?.getTime() ?? 0) - before
    expect(waitMs).toBeGreaterThan(3_590_000)
    expect(waitMs).toBeLessThan(3_620_000)

    const res = await client(ctx, user).get('/api/integrations/garmin/runs')
    expect(res.body).toMatchObject([
      {
        provider: 'garmin',
        status: 'paused',
        wellnessStatus: 'truncated',
        wellnessDays: 12,
        wellnessTotal: 30,
        message: budget,
      },
    ])
  })

  test('zero days read still pauses and says so', async () => {
    await connect('garmin')
    noActivities()
    vi.spyOn(garminProvider, 'listWellness').mockRejectedValue(
      new WellnessTruncated(budget, { retryAfterSec: 3600, rows: [], daysRead: 0, daysTotal: 30 }),
    )
    await syncProvider(deps(), user.id, 'garmin')
    expect(await ctx.prisma.wellnessDay.count()).toBe(0)
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.lastSyncStatus).toBe('paused')
    expect(row.lastError).toMatch(/^Wellness stopped after 0 of 30 days/)
    const run = await ctx.prisma.syncRun.findFirstOrThrow()
    expect(run).toMatchObject({ status: 'paused', wellnessStatus: 'truncated', wellnessDays: 0 })
  })

  test('a pull whose activity pass paused first leaves wellness waiting and does not call it', async () => {
    await connect('garmin')
    vi.spyOn(garminProvider, 'listActivities').mockImplementation(() =>
      remoteList(
        new RateLimitPause('Garmin answered HTTP 429; pausing before the next attempt.', {
          retryAfterSec: 21_600,
        }),
      ),
    )
    const wellness = vi.spyOn(garminProvider, 'listWellness')
    await syncProvider(deps(), user.id, 'garmin')

    expect(wellness).not.toHaveBeenCalled()
    const run = await ctx.prisma.syncRun.findFirstOrThrow()
    expect(run).toMatchObject({
      status: 'paused',
      wellnessStatus: 'waiting',
      wellnessDays: null,
      wellnessTotal: null,
    })
    expect((await ctx.prisma.integration.findFirstOrThrow()).lastSyncStatus).toBe('paused')
  })

  test('a complete read records ok with the days it read', async () => {
    await connect('garmin')
    noActivities()
    vi.spyOn(garminProvider, 'listWellness').mockResolvedValue([day])
    await syncProvider(deps(), user.id, 'garmin')
    const run = await ctx.prisma.syncRun.findFirstOrThrow()
    expect(run).toMatchObject({ status: 'ok', wellnessStatus: 'read', wellnessDays: 1 })
    expect((await ctx.prisma.integration.findFirstOrThrow()).lastSyncStatus).toBe('ok')
  })

  test('a plain pause while reading wellness is not recorded as a short read', async () => {
    await connect('garmin')
    noActivities()
    vi.spyOn(garminProvider, 'listWellness').mockRejectedValue(
      new RateLimitPause('Garmin answered HTTP 429; pausing before the next attempt.', {
        retryAfterSec: 21_600,
      }),
    )
    await syncProvider(deps(), user.id, 'garmin')
    const run = await ctx.prisma.syncRun.findFirstOrThrow()
    expect(run).toMatchObject({ status: 'paused', wellnessStatus: 'error' })
  })
})

describe('a folder scan writes one run', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rl-log-scan-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  async function watch(path: string) {
    await ctx.prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'folder',
        status: 'connected',
        secret: sealSecret({}, ctx.config.sessionSecret),
        config: JSON.stringify({ path }),
      },
    })
  }

  function put(name: string, bytes: Uint8Array | string): void {
    const path = join(dir, name)
    writeFileSync(path, bytes)
    utimesSync(path, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
  }

  /** A synthetic one-session run. */
  function fitBytes(): Uint8Array {
    const startUnix = Date.UTC(2026, 0, 5, 7, 0, 0) / 1000
    return buildFit({
      serial: 7,
      timeCreatedUnix: startUnix,
      sessions: [
        {
          sport: 1,
          startUnix,
          durationSec: 600,
          distanceM: 1800,
          records: Array.from({ length: 11 }, (_, i) => ({
            t: i * 60,
            distanceM: i * 180,
            speedMps: 3,
            hr: 140 + i,
          })),
        },
      ],
    })
  }

  async function folderRuns(): Promise<SyncRunView[]> {
    const res = await client(ctx, user).get('/api/integrations/folder/runs')
    expect(res.status).toBe(200)
    return res.body as SyncRunView[]
  }

  test('a scheduled scan that finds nothing is stored once, not every five minutes', async () => {
    await watch(dir)
    await scanFolderIntegration(deps(), user.id)
    await scanFolderIntegration(deps(), user.id)
    await scanFolderIntegration(deps(), user.id)
    const [only, ...rest] = await folderRuns()
    expect(rest).toEqual([])
    expect(only).toMatchObject({
      channel: 'folder',
      trigger: 'schedule',
      status: 'ok',
      accepted: 0,
      duplicate: 0,
      failed: 0,
      importBatchId: null,
    })
    // The integration row still tells when the last scan ran.
    expect((await ctx.prisma.integration.findFirstOrThrow()).lastSyncAt).not.toBeNull()

    // A manual scan is the owner asking, so it is stored even when it finds nothing.
    await scanFolderIntegration(deps(), user.id, { trigger: 'manual' })
    expect((await folderRuns()).map((run) => run.trigger)).toEqual(['manual', 'schedule'])
  })

  test('a scan with an unreadable file is partial and names it; the idle scan after it is stored once', async () => {
    await watch(dir)
    put('broken.fit', new Uint8Array([1, 2, 3, 4]))
    await scanFolderIntegration(deps(), user.id, { trigger: 'manual' })
    for (let scan = 0; scan < 3; scan += 1) await scanFolderIntegration(deps(), user.id)

    const [recovery, partial, ...rest] = await folderRuns()
    expect(rest).toEqual([])
    expect(partial).toMatchObject({
      channel: 'folder',
      trigger: 'manual',
      status: 'partial',
      failed: 1,
    })
    expect(partial?.failures[0]?.ref).toBe('broken.fit')
    expect(partial?.importBatchId).toBeTruthy()
    // The file is remembered as invalid, so the next scans find nothing; the first of them is
    // stored, so that the newest row shows the recovery, and the rest are not.
    expect(recovery).toMatchObject({ trigger: 'schedule', status: 'ok', accepted: 0, failed: 0 })
  })

  test('a scan with new files is stored, and so is every failed scan', async () => {
    await watch(dir)
    put('a.fit', fitBytes())
    await scanFolderIntegration(deps(), user.id)
    expect(await folderRuns()).toMatchObject([{ status: 'ok', accepted: 1 }])

    await ctx.prisma.integration.updateMany({
      data: { config: JSON.stringify({ path: join(dir, 'missing') }) },
    })
    await runFolderJob(deps())
    await runFolderJob(deps())
    expect((await folderRuns()).map((run) => run.status)).toEqual(['error', 'error', 'ok'])
  })

  test('an unreadable folder records an error run', async () => {
    await watch(join(dir, 'missing'))
    await expect(runFolderJob(deps())).resolves.toBeUndefined()
    const run = await ctx.prisma.syncRun.findFirstOrThrow()
    expect(run).toMatchObject({ channel: 'folder', status: 'error', accepted: 0 })
    expect(run.message).toContain('not a readable directory')
  })
})

describe('a push writes one run', () => {
  async function pushToken(): Promise<string> {
    const res = await client(ctx, user).post('/api/integrations/apple-health/push-token').send({})
    return (res.body as { token: string }).token
  }

  const payload = {
    data: {
      metrics: [
        {
          name: 'resting_heart_rate',
          units: 'count/min',
          data: [{ date: '2026-03-03 00:00:00 -0500', qty: 53 }],
        },
      ],
      workouts: [
        {
          id: '00000000-0000-4000-8000-0000000000aa',
          name: 'Outdoor Run',
          start: '2026-03-04 07:00:00 -0500',
          end: '2026-03-04 07:30:00 -0500',
          distance: { qty: 5, units: 'km' },
        },
      ],
    },
  }

  test('records the stored counts, the wellness days and the push trigger', async () => {
    const token = await pushToken()
    await request(ctx.app)
      .post('/api/ingest/apple-health')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(200)
    // A push that carries nothing is still a run.
    await request(ctx.app)
      .post('/api/ingest/apple-health')
      .set('Authorization', `Bearer ${token}`)
      .send({ data: { metrics: [], workouts: [] } })
      .expect(200)

    const res = await client(ctx, user).get('/api/integrations/apple-health/runs')
    const [again, first] = res.body as SyncRunView[]
    expect(first).toMatchObject({
      channel: 'push',
      trigger: 'push',
      status: 'ok',
      accepted: 1,
      duplicate: 0,
      wellnessStatus: 'read',
      wellnessDays: 1,
    })
    expect(first?.importBatchId).toBeTruthy()
    expect(again).toMatchObject({
      channel: 'push',
      accepted: 0,
      duplicate: 0,
      status: 'ok',
      wellnessStatus: 'none',
      importBatchId: null,
    })
  })

  test('a body the provider cannot read records an error run and still answers 400', async () => {
    const token = await pushToken()
    const bad = await request(ctx.app)
      .post('/api/ingest/apple-health')
      .set('Authorization', `Bearer ${token}`)
      .send({ nope: true })
    expect(bad.status).toBe(400)
    const run = await ctx.prisma.syncRun.findFirstOrThrow()
    expect(run).toMatchObject({ channel: 'push', trigger: 'push', status: 'error' })
    expect(run.message).toBeTruthy()
  })

  test('a push with a wrong token records nothing', async () => {
    await pushToken()
    await request(ctx.app)
      .post('/api/ingest/apple-health')
      .set('Authorization', 'Bearer nope')
      .send(payload)
      .expect(401)
    expect(await ctx.prisma.syncRun.count()).toBe(0)
  })
})

describe('recordSyncRun', () => {
  const base = {
    channel: 'pull' as const,
    trigger: 'schedule' as const,
    status: 'ok' as const,
    provider: 'intervals',
  }

  test('never throws, whatever goes wrong', async () => {
    const broken = {
      prisma: {
        syncRun: {
          create: () => Promise.reject(new Error(`disk full (Authorization: Bearer ${BEARER})`)),
        },
      } as unknown as PrismaClient,
      config: ctx.config,
    }
    await expect(
      recordSyncRun(broken, { ...base, userId: user.id, startedAt: new Date() }),
    ).resolves.toBeUndefined()
    // The failure to write is logged without the text that failed, which here held a token.
    expect(logged.lines.join('')).toContain('recording a sync run failed')
    expect(logged.lines.join('')).not.toContain(BEARER)
  })

  // `textOf` falls back to JSON.stringify, which throws for both of these before anything is
  // written: a log that cannot make text of a message must not fail the sync that finished.
  const hostile: Array<[string, () => unknown]> = [
    [
      'a toJSON that throws',
      () => ({
        toJSON(): never {
          throw new Error('no text')
        },
      }),
    ],
    [
      'a circular object',
      () => {
        const loop: Record<string, unknown> = {}
        loop.self = loop
        return loop
      },
    ],
  ]

  test.each(hostile)('%s is swallowed: no row, one log line, no throw', async (_label, make) => {
    await expect(
      recordSyncRun(deps(), { ...base, userId: user.id, startedAt: new Date(), message: make() }),
    ).resolves.toBeUndefined()
    expect(await ctx.prisma.syncRun.count()).toBe(0)
    expect(
      logged.lines.filter((line) => line.includes('recording a sync run failed')),
    ).toHaveLength(1)

    logged.lines.length = 0
    await expect(
      recordSyncRun(deps(), {
        ...base,
        userId: user.id,
        startedAt: new Date(),
        failures: [{ ref: 'intervals:i1', reason: make() }],
      }),
    ).resolves.toBeUndefined()
    expect(await ctx.prisma.syncRun.count()).toBe(0)
    expect(
      logged.lines.filter((line) => line.includes('recording a sync run failed')),
    ).toHaveLength(1)
  })

  test('keeps the newest 200 rows per user and provider', async () => {
    const now = Date.now()
    await ctx.prisma.syncRun.createMany({
      data: Array.from({ length: MAX_RUNS_KEPT + 50 }, (_, i) => ({
        userId: user.id,
        provider: 'intervals',
        channel: 'pull',
        trigger: 'schedule',
        status: 'ok',
        startedAt: new Date(now - (MAX_RUNS_KEPT + 50 - i) * 60_000),
        finishedAt: new Date(now - (MAX_RUNS_KEPT + 50 - i) * 60_000),
      })),
    })
    await ctx.prisma.syncRun.create({
      data: {
        userId: user.id,
        provider: 'strava',
        channel: 'pull',
        trigger: 'schedule',
        status: 'ok',
        startedAt: new Date(now - 10 * DAY_MS),
        finishedAt: new Date(now - 10 * DAY_MS),
      },
    })
    await recordSyncRun(deps(), { ...base, userId: user.id, startedAt: new Date() })

    expect(await ctx.prisma.syncRun.count({ where: { provider: 'intervals' } })).toBe(MAX_RUNS_KEPT)
    // The 251 rows (250 seeded and the new one) shrink to the newest 200; the oldest 51 went, and
    // another provider's rows are untouched.
    const kept = await ctx.prisma.syncRun.findMany({
      where: { provider: 'intervals' },
      orderBy: { startedAt: 'asc' },
    })
    expect(kept[0]?.startedAt.getTime()).toBe(now - (MAX_RUNS_KEPT - 1) * 60_000)
    expect(await ctx.prisma.syncRun.count({ where: { provider: 'strava' } })).toBe(1)
  })

  test('drops rows older than 90 days', async () => {
    const old = new Date(Date.now() - (RUN_RETENTION_DAYS + 1) * DAY_MS)
    const recent = new Date(Date.now() - (RUN_RETENTION_DAYS - 1) * DAY_MS)
    await ctx.prisma.syncRun.createMany({
      data: [old, old, recent].map((startedAt) => ({
        userId: user.id,
        provider: 'intervals',
        channel: 'pull',
        trigger: 'schedule',
        status: 'ok',
        startedAt,
        finishedAt: startedAt,
      })),
    })
    await recordSyncRun(deps(), { ...base, userId: user.id, startedAt: new Date() })
    const rows = await ctx.prisma.syncRun.findMany({ orderBy: { startedAt: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows[0]?.startedAt.getTime()).toBe(recent.getTime())
  })

  test('cuts a long message and strips secrets before anything is stored', async () => {
    await recordSyncRun(deps(), {
      ...base,
      userId: user.id,
      startedAt: new Date(),
      status: 'error',
      message: `${'x'.repeat(400)} ${API_KEY}`,
      secrets: [API_KEY],
      failures: Array.from({ length: 15 }, (_, i) => ({
        ref: `intervals:${String(i)}`,
        reason: `Bearer ${BEARER} refused ${API_KEY}`,
      })),
    })
    const row = await ctx.prisma.syncRun.findFirstOrThrow()
    expect(row.message?.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS)
    const stored = JSON.stringify(row)
    expect(stored).not.toContain(API_KEY)
    expect(stored).not.toContain(BEARER)
    expect(JSON.parse(row.failures) as unknown[]).toHaveLength(MAX_FAILURES_STORED)
  })
})

describe('tokens never reach a row, a response or a log line', () => {
  /** Searches every place a token could end up: rows, responses and the captured log lines. */
  async function expectNoLeak(leaks: readonly string[]): Promise<void> {
    const stored = await everythingStored()
    const bodies = {
      runs: JSON.stringify(await runs()),
      integrations: JSON.stringify((await client(ctx, user).get('/api/integrations')).body),
      imports: JSON.stringify((await client(ctx, user).get('/api/imports')).body),
      jobs: JSON.stringify((await client(ctx, user).get('/api/jobs')).body),
      log: logged.lines.join(''),
    }
    for (const leak of leaks) {
      expect(stored, `stored: ${leak}`).not.toContain(leak)
      for (const [name, text] of Object.entries(bodies)) {
        expect(text, `${name}: ${leak}`).not.toContain(leak)
      }
    }
  }

  test('a provider error that echoes the key and a bearer token is scrubbed everywhere', async () => {
    await connect()
    const fetchFn = intervals(
      [
        {
          id: 'i1',
          startUtc: '2026-03-02T07:00:00Z',
          fail: `GET ${BASE}/activity/i1/streams.json?api_key=${API_KEY} refused: Authorization: Bearer ${BEARER}`,
        },
        { id: 'i2', startUtc: '2026-03-03T07:00:00Z' },
      ],
      {
        [`GET ${BASE}/athlete/i1001/wellness.json`]: () => {
          throw new Error(`wellness endpoint said no to ${API_KEY} (access_token=${BEARER})`)
        },
      },
    )
    const log = createLogger(ctx.config)
    await runSyncJob(deps(), { fetch: fetchFn }, log)

    await expectNoLeak([API_KEY, BEARER])
    // The log is captured at every level: the requests above wrote lines, so the search had text.
    expect(logged.lines.length).toBeGreaterThan(0)
    // The failure itself is still reported.
    const [run] = await runs()
    expect(run?.failures[0]?.ref).toBe('intervals:i1')
    expect(run?.wellnessStatus).toBe('error')
  })

  test('an error that leaves a sync is logged by the scheduler without the token', async () => {
    await connect()
    // The write that ends a pull is the one failure `syncProvider` does not catch itself, so the
    // scheduler logs it; the message holds a header and a key the way a client error can.
    vi.spyOn(ctx.prisma.integration, 'updateMany').mockRejectedValueOnce(
      new Error(`write refused: Authorization: Bearer ${BEARER} api_key=${API_KEY}`),
    )
    await runSyncJob(deps(), { fetch: intervals([]) }, createLogger(ctx.config))

    // Positive control: the line exists and names the failure, so the search below has a target.
    const line = logged.lines.find((text) => text.includes('scheduled sync failed'))
    expect(line, 'the scheduler logs the sync that threw').toBeDefined()
    expect(line).toContain('write refused')
    await expectNoLeak([API_KEY, BEARER])
    const [run] = await runs()
    expect(run).toMatchObject({ status: 'error' })
    expect(run?.message).toContain('write refused')
  })
})

describe('GET /api/integrations/:provider/runs', () => {
  async function seedRuns(count: number, provider = 'intervals', userId = user.id): Promise<void> {
    const now = Date.now()
    await ctx.prisma.syncRun.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        userId,
        provider,
        channel: 'pull',
        trigger: 'schedule',
        status: 'ok',
        accepted: i,
        startedAt: new Date(now - (count - i) * 60_000),
        finishedAt: new Date(now - (count - i) * 60_000 + 1000),
      })),
    })
  }

  test('lists the newest 20 first and honours limit', async () => {
    await seedRuns(30)
    const res = await client(ctx, user).get('/api/integrations/intervals/runs')
    expect(res.status).toBe(200)
    const list = res.body as SyncRunView[]
    expect(list).toHaveLength(20)
    expect(list.map((run) => run.accepted)).toEqual(Array.from({ length: 20 }, (_, i) => 29 - i))

    const few = await client(ctx, user).get('/api/integrations/intervals/runs?limit=3')
    expect((few.body as SyncRunView[]).map((run) => run.accepted)).toEqual([29, 28, 27])
    const all = await client(ctx, user).get('/api/integrations/intervals/runs?limit=100')
    expect(all.body).toHaveLength(30)
  })

  test.each(['0', '101', '-1', '2.5', 'many', ''])('rejects limit=%s with 400', async (limit) => {
    const res = await client(ctx, user).get(`/api/integrations/intervals/runs?limit=${limit}`)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'validation' } })
  })

  test('is scoped to the signed-in user and to the provider', async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await seedRuns(2, 'intervals')
    await seedRuns(3, 'intervals', other.id)
    await seedRuns(4, 'strava')
    expect(
      ((await client(ctx, user).get('/api/integrations/intervals/runs')).body as unknown[]).length,
    ).toBe(2)
    expect(
      ((await client(ctx, other).get('/api/integrations/intervals/runs')).body as unknown[]).length,
    ).toBe(3)
    expect(
      ((await client(ctx, user).get('/api/integrations/strava/runs')).body as unknown[]).length,
    ).toBe(4)
    await ctx.prisma.user.delete({ where: { id: other.id } })
  })

  test('answers 404 for an unknown provider and 401 without a session; job rows are not provider runs', async () => {
    expect((await client(ctx, user).get('/api/integrations/nope/runs')).status).toBe(404)
    expect((await client(ctx).get('/api/integrations/intervals/runs')).status).toBe(401)
    await ctx.prisma.syncRun.create({
      data: {
        userId: user.id,
        provider: 'intervals',
        channel: 'job',
        trigger: 'schedule',
        status: 'ok',
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    })
    expect((await client(ctx, user).get('/api/integrations/intervals/runs')).body).toEqual([])
  })

  test('both directions of one provider share the list', async () => {
    const now = Date.now()
    for (const [channel, trigger, offset] of [
      ['pull', 'schedule', 3],
      ['publish', 'manual', 2],
    ] as const) {
      await ctx.prisma.syncRun.create({
        data: {
          userId: user.id,
          provider: 'intervals',
          channel,
          trigger,
          status: 'ok',
          startedAt: new Date(now - offset * 60_000),
          finishedAt: new Date(now - offset * 60_000),
        },
      })
    }
    const list = (await client(ctx, user).get('/api/integrations/intervals/runs'))
      .body as SyncRunView[]
    expect(list.map((run) => run.channel)).toEqual(['publish', 'pull'])
  })

  test('POST sync from the owner is recorded with the manual trigger', async () => {
    await connect()
    ctx.fetch = intervals([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z' }])
    const res = await client(ctx, user).post('/api/integrations/intervals/sync').send({})
    expect(res.status).toBe(202)
    await settleBackground()
    const [run] = await runs()
    expect(run).toMatchObject({ trigger: 'manual', status: 'ok', accepted: 1 })
  })

  test('a deleted user takes their runs along', async () => {
    const doomed = await seedUser(ctx, { email: 'doomed@example.com' })
    await seedRuns(2, 'intervals', doomed.id)
    await ctx.prisma.user.delete({ where: { id: doomed.id } })
    expect(await ctx.prisma.syncRun.count({ where: { userId: doomed.id } })).toBe(0)
  })
})
