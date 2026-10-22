import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runSyncJob } from '../../server/jobs/scheduler.ts'
import { sealSecret, syncProvider } from '../../server/services/sync.ts'
import { fakeFetch, type FakeRoute } from '../fakeFetch.ts'
import { createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

const BASE = 'https://intervals.icu/api/v1'
const NOW = new Date()

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
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.wellnessDay.deleteMany()
  await ctx.prisma.importBatch.deleteMany()
  await ctx.prisma.integration.deleteMany()
})

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

async function connect(
  over: { cursor?: string | null; status?: string; pausedUntil?: Date | null } = {},
) {
  return ctx.prisma.integration.create({
    data: {
      userId: user.id,
      provider: 'intervals',
      status: over.status ?? 'connected',
      secret: sealSecret({ apiKey: 'key-123' }, ctx.config.sessionSecret),
      config: JSON.stringify({ athleteId: 'i1001' }),
      cursor: over.cursor ?? null,
      pausedUntil: over.pausedUntil ?? null,
    },
  })
}

interface Remote {
  id: string
  startUtc: string
  fail?: boolean
}

/** intervals.icu as the provider reads it: no original file, so the streams are used. */
function intervals(remote: Remote[], extra: Record<string, FakeRoute> = {}) {
  const calls: string[] = []
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
      calls.push(r.id)
      if (r.fail) return json({}, 500)
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
  return { fetch: fakeFetch(routes), calls }
}

describe('syncProvider', () => {
  test('stores activities and wellness, records one batch and advances the cursor', async () => {
    await connect()
    const remote = intervals([
      { id: 'i1', startUtc: '2026-03-02T07:00:00Z' },
      { id: 'i2', startUtc: '2026-03-05T07:00:00Z' },
    ])
    const batch = await syncProvider(ctx_(), user.id, 'intervals', { fetch: remote.fetch })

    expect(batch).toMatchObject({
      source: 'intervals',
      rowCount: 2,
      accepted: 2,
      skippedDuplicate: 0,
      skippedInvalid: 0,
    })
    const activities = await ctx.prisma.activity.findMany({ orderBy: { startUtc: 'asc' } })
    expect(activities.map((a) => a.providerKey)).toEqual(['intervals:i1', 'intervals:i2'])
    expect(activities.every((a) => a.importBatchId === batch?.id)).toBe(true)
    expect(activities[0]?.source).toBe('intervals')
    const wellness = await ctx.prisma.wellnessDay.findMany()
    expect(wellness).toHaveLength(1)
    expect(wellness[0]).toMatchObject({ date: '2026-03-02', restingHr: 50, source: 'intervals' })

    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.status).toBe('connected')
    expect(row.lastSyncStatus).toBe('ok')
    expect(row.lastError).toBeNull()
    expect(row.lastSyncAt).not.toBeNull()
    expect(new Date(row.cursor ?? '').toISOString()).toBe('2026-03-05T07:00:00.000Z')
  })

  test('a second run downloads nothing again and records no batch', async () => {
    await connect()
    const remote = intervals([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z' }])
    await syncProvider(ctx_(), user.id, 'intervals', { fetch: remote.fetch })
    expect(remote.calls).toEqual(['i1'])

    const again = await syncProvider(ctx_(), user.id, 'intervals', { fetch: remote.fetch })
    expect(again).toBeNull()
    expect(remote.calls).toEqual(['i1'])
    expect(await ctx.prisma.activity.count()).toBe(1)
    expect(await ctx.prisma.importBatch.count()).toBe(1)
  })

  test('a failed activity is reported and the cursor stays just before it', async () => {
    await connect()
    const remote = intervals([
      { id: 'i1', startUtc: '2026-03-02T07:00:00Z' },
      { id: 'i2', startUtc: '2026-03-05T07:00:00Z', fail: true },
      { id: 'i3', startUtc: '2026-03-08T07:00:00Z' },
    ])
    const batch = await syncProvider(ctx_(), user.id, 'intervals', { fetch: remote.fetch })

    expect(batch).toMatchObject({ rowCount: 3, accepted: 2, skippedInvalid: 1 })
    expect(batch?.errors[0]?.reason).toContain('intervals:i2')
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.lastSyncStatus).toBe('partial')
    expect(row.lastError).toContain('1 activity could not be imported')
    expect(new Date(row.cursor ?? '').toISOString()).toBe('2026-03-05T06:59:59.000Z')
  })

  test('a rate limit pauses the provider and keeps the cursor', async () => {
    const cursor = '2026-03-01T00:00:00.000Z'
    await connect({ cursor })
    const limited = fakeFetch({
      [`GET ${BASE}/athlete/i1001/activities`]: () => json({}, 429, { 'retry-after': '120' }),
    })
    const before = Date.now()
    const batch = await syncProvider(ctx_(), user.id, 'intervals', { fetch: limited })

    expect(batch).toBeNull()
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.lastSyncStatus).toBe('paused')
    expect(row.status).toBe('connected')
    expect(row.cursor).toBe(cursor)
    const waitMs = (row.pausedUntil?.getTime() ?? 0) - before
    expect(waitMs).toBeGreaterThan(110_000)
    expect(waitMs).toBeLessThan(130_000)
  })

  test('a rejected key marks the integration as needing a reconnect', async () => {
    await connect()
    const rejected = fakeFetch({
      [`GET ${BASE}/athlete/i1001/activities`]: () => json({}, 401),
    })
    await syncProvider(ctx_(), user.id, 'intervals', { fetch: rejected })
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.status).toBe('needs_auth')
    expect(row.lastSyncStatus).toBe('error')
    expect(row.lastError).toMatch(/reconnect/i)
  })

  test('an outage keeps the integration connected for the next run', async () => {
    await connect()
    const down = fakeFetch({
      [`GET ${BASE}/athlete/i1001/activities`]: () => json({}, 503),
    })
    await syncProvider(ctx_(), user.id, 'intervals', { fetch: down })
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.status).toBe('error')
    expect(row.lastError).toContain('503')

    const ok = intervals([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z' }])
    await syncProvider(ctx_(), user.id, 'intervals', { fetch: ok.fetch })
    expect((await ctx.prisma.integration.findFirstOrThrow()).status).toBe('connected')
  })

  test('a changed SESSION_SECRET sets needs_auth with the reconnect message', async () => {
    await connect()
    const other = {
      prisma: ctx.prisma,
      config: { ...ctx.config, sessionSecret: 'a-different-session-secret-0123456789abc' },
    }
    const never = fakeFetch({})
    expect(await syncProvider(other, user.id, 'intervals', { fetch: never })).toBeNull()
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.status).toBe('needs_auth')
    expect(row.lastError).toBe('Reconnect: the session secret changed.')
  })

  test('a start date reaches back past the cursor', async () => {
    await connect({ cursor: '2026-03-10T00:00:00.000Z' })
    const urls: string[] = []
    const remote = intervals([{ id: 'i1', startUtc: '2026-01-02T07:00:00Z' }], {
      [`GET ${BASE}/athlete/i1001/activities`]: (req) => {
        urls.push(req.url)
        return json([{ id: 'i1', start_date: '2026-01-02T07:00:00Z' }])
      },
    })
    await syncProvider(ctx_(), user.id, 'intervals', { from: '2026-01-01', fetch: remote.fetch })
    expect(urls[0]).toContain('oldest=2025-12-31')
    expect(await ctx.prisma.activity.count()).toBe(1)
  })

  test('runs one at a time per provider', async () => {
    await connect()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const remote = intervals([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z' }], {
      [`GET ${BASE}/athlete/i1001/activities`]: async () => {
        await gate
        return json([{ id: 'i1', start_date: '2026-03-02T07:00:00Z' }])
      },
    })
    const first = syncProvider(ctx_(), user.id, 'intervals', { fetch: remote.fetch })
    // Let the first call take its lock and reach the gated request.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await syncProvider(ctx_(), user.id, 'intervals', { fetch: remote.fetch })).toBeNull()
    release()
    expect((await first)?.accepted).toBe(1)
  })

  test('refuses a provider that is not connected or that cannot pull', async () => {
    await expect(syncProvider(ctx_(), user.id, 'intervals')).rejects.toMatchObject({ status: 404 })
    await expect(syncProvider(ctx_(), user.id, 'apple-health')).rejects.toMatchObject({
      status: 400,
    })
    await connect({ status: 'needs_auth' })
    await expect(syncProvider(ctx_(), user.id, 'intervals')).rejects.toMatchObject({ status: 409 })
  })
})

describe('runSyncJob', () => {
  test('syncs connected providers and skips paused ones and ones that need auth', async () => {
    await connect()
    const remote = intervals([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z' }])
    await runSyncJob(ctx_(), { fetch: remote.fetch })
    expect(await ctx.prisma.activity.count()).toBe(1)

    await ctx.prisma.activity.deleteMany()
    await ctx.prisma.integration.updateMany({
      data: { pausedUntil: new Date(NOW.getTime() + 3_600_000), cursor: null },
    })
    await runSyncJob(ctx_(), { fetch: remote.fetch })
    expect(await ctx.prisma.activity.count()).toBe(0)

    await ctx.prisma.integration.updateMany({
      data: { pausedUntil: null, status: 'needs_auth' },
    })
    await runSyncJob(ctx_(), { fetch: remote.fetch })
    expect(await ctx.prisma.activity.count()).toBe(0)

    await ctx.prisma.integration.updateMany({ data: { status: 'connected' } })
    await runSyncJob(ctx_(), { fetch: remote.fetch })
    expect(await ctx.prisma.activity.count()).toBe(1)
  })
})

function ctx_() {
  return { prisma: ctx.prisma, config: ctx.config }
}
