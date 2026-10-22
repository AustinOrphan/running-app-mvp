import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { hashToken } from '../../server/crypto.ts'
import { signState } from '../../server/providers/oauthState.ts'
import { sealSecret, settleBackground } from '../../server/services/sync.ts'
import { fakeFetch, type FakeRoute } from '../fakeFetch.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

const BASE = 'https://intervals.icu/api/v1'

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

afterEach(() => {
  vi.unstubAllGlobals()
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Replaces the global `fetch`, which the routes resolve per call. */
function stubFetch(routes: Record<string, FakeRoute>): void {
  vi.stubGlobal('fetch', fakeFetch(routes))
}

const intervalsRoutes: Record<string, FakeRoute> = {
  [`GET ${BASE}/athlete/i1001/activities`]: () =>
    json([{ id: 'i1', start_date: '2026-03-02T07:00:00Z' }]),
  [`GET ${BASE}/athlete/i1001/wellness.json`]: () => json([]),
  [`GET ${BASE}/athlete/i1001`]: () => json({ id: 'i1001' }),
  [`GET ${BASE}/activity/i1/file`]: () => json({}, 404),
  [`GET ${BASE}/activity/i1/streams.json`]: () =>
    json([
      { type: 'time', data: [0, 10, 20] },
      { type: 'distance', data: [0, 30, 60] },
    ]),
  [`GET ${BASE}/activity/i1`]: () =>
    json({
      id: 'i1',
      type: 'Run',
      start_date: '2026-03-02T07:00:00Z',
      start_date_local: '2026-03-02T07:00:00',
      distance: 60,
      elapsed_time: 20,
    }),
}

async function connectIntervals() {
  stubFetch(intervalsRoutes)
  return client(ctx, user)
    .put('/api/integrations/intervals')
    .send({ athleteId: 'i1001', apiKey: 'key-123' })
}

describe('GET /api/integrations', () => {
  test('lists every registry provider as disconnected for a new user', async () => {
    const res = await client(ctx, user).get('/api/integrations')
    expect(res.status).toBe(200)
    const body = res.body as Array<{ provider: string; status: string; pushEnabled: boolean }>
    expect(body.map((s) => s.provider)).toEqual([
      'intervals',
      'strava',
      'garmin',
      'apple-health',
      'folder',
    ])
    expect(body.every((s) => s.status === 'disconnected' && !s.pushEnabled)).toBe(true)
  })

  test('requires a session', async () => {
    expect((await client(ctx).get('/api/integrations')).status).toBe(401)
  })

  test('marks a row whose secret no longer decrypts as needing auth', async () => {
    await ctx.prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'intervals',
        status: 'connected',
        secret: sealSecret({ apiKey: 'k' }, 'another-session-secret-0123456789abcdef'),
        config: '{"athleteId":"i1001"}',
      },
    })
    const res = await client(ctx, user).get('/api/integrations')
    const intervals = (res.body as Array<Record<string, unknown>>)[0]
    expect(intervals).toMatchObject({
      status: 'needs_auth',
      lastError: 'Reconnect: the session secret changed.',
    })
  })

  test('keeps push and folder rows connected after a session secret change', async () => {
    const stale = sealSecret({}, 'another-session-secret-0123456789abcdef')
    for (const provider of ['apple-health', 'folder']) {
      await ctx.prisma.integration.create({
        data: { userId: user.id, provider, status: 'connected', secret: stale, config: '{}' },
      })
    }
    const res = await client(ctx, user).get('/api/integrations')
    const byKey = new Map(
      (res.body as Array<{ provider: string; status: string }>).map((s) => [s.provider, s]),
    )
    expect(byKey.get('apple-health')?.status).toBe('connected')
    expect(byKey.get('folder')?.status).toBe('connected')
  })
})

describe('PUT /api/integrations/:provider', () => {
  test('connects intervals.icu and keeps the key encrypted at rest', async () => {
    const res = await connectIntervals()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      provider: 'intervals',
      status: 'connected',
      config: { athleteId: 'i1001' },
    })
    expect(JSON.stringify(res.body)).not.toContain('key-123')

    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.secret.startsWith('v1.')).toBe(true)
    expect(row.secret).not.toContain('key-123')
    expect(row.config).not.toContain('key-123')
  })

  test('answers 400 when intervals.icu rejects the key, and stores nothing', async () => {
    stubFetch({ [`GET ${BASE}/athlete/`]: () => json({}, 401) })
    const res = await client(ctx, user)
      .put('/api/integrations/intervals')
      .send({ athleteId: 'i1001', apiKey: 'bad' })
    expect(res.status).toBe(400)
    expect(await ctx.prisma.integration.count()).toBe(0)
  })

  test('answers 404 for an unknown provider and 400 for a push-only one', async () => {
    expect((await client(ctx, user).put('/api/integrations/nope').send({})).status).toBe(404)
    expect((await client(ctx, user).put('/api/integrations/apple-health').send({})).status).toBe(
      400,
    )
  })

  test('connects a watched folder that exists and rejects one that does not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-folder-'))
    try {
      const ok = await client(ctx, user).put('/api/integrations/folder').send({ path: dir })
      expect(ok.status).toBe(200)
      expect(ok.body).toMatchObject({ status: 'connected', config: { path: dir } })

      const missing = await client(ctx, user)
        .put('/api/integrations/folder')
        .send({ path: join(dir, 'missing') })
      expect(missing.status).toBe(400)
      const relative = await client(ctx, user)
        .put('/api/integrations/folder')
        .send({ path: 'relative/dir' })
      expect(relative.status).toBe(400)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('rejects a file where a folder is expected', async () => {
    const res = await client(ctx, user)
      .put('/api/integrations/folder')
      .send({ path: join(process.cwd(), 'package.json') })
    expect(res.status).toBe(400)
  })
})

describe('Strava OAuth', () => {
  const stravaRoutes: Record<string, FakeRoute> = {
    'POST https://www.strava.com/oauth/token': () =>
      json({ access_token: 'a-1', refresh_token: 'r-1', expires_at: 4_102_444_800 }),
  }

  async function startStrava() {
    return client(ctx, user)
      .put('/api/integrations/strava')
      .send({ clientId: '12345', clientSecret: 'secret-xyz' })
  }

  test('stores the app credentials and returns the consent URL', async () => {
    const res = await startStrava()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ provider: 'strava', status: 'needs_auth' })
    const url = new URL((res.body as { authorizeUrl: string }).authorizeUrl)
    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('12345')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://app.test/api/integrations/strava/callback',
    )
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.secret).not.toContain('secret-xyz')
  })

  test('uses the configured public base URL for the redirect', async () => {
    const res = await client(ctx, user).put('/api/integrations/strava').send({
      clientId: '12345',
      clientSecret: 'secret-xyz',
      publicBaseUrl: 'https://run.example.com/',
    })
    const url = new URL((res.body as { authorizeUrl: string }).authorizeUrl)
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://run.example.com/api/integrations/strava/callback',
    )
  })

  test('the callback exchanges the code and redirects to the integrations page', async () => {
    const started = await startStrava()
    const state = new URL((started.body as { authorizeUrl: string }).authorizeUrl).searchParams.get(
      'state',
    )
    stubFetch(stravaRoutes)
    const res = await client(ctx, user).get(
      `/api/integrations/strava/callback?code=abc&state=${encodeURIComponent(state ?? '')}`,
    )
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/integrations?connected=strava')
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.status).toBe('connected')
    expect(row.secret).not.toContain('a-1')
  })

  test('the callback refuses a state signed for someone else or a denied consent', async () => {
    await startStrava()
    const forged = signState('another-user', ctx.config.sessionSecret, new Date())
    const bad = await client(ctx, user).get(
      `/api/integrations/strava/callback?code=abc&state=${encodeURIComponent(forged)}`,
    )
    expect(bad.status).toBe(302)
    expect(bad.headers.location).toMatch(/^\/integrations\?error=/)

    const denied = await client(ctx, user).get(
      '/api/integrations/strava/callback?error=access_denied',
    )
    expect(denied.headers.location).toMatch(/^\/integrations\?error=/)
    expect((await ctx.prisma.integration.findFirstOrThrow()).status).toBe('needs_auth')
  })

  test('the callback reports a refused code on the integrations page', async () => {
    const started = await startStrava()
    const state = new URL((started.body as { authorizeUrl: string }).authorizeUrl).searchParams.get(
      'state',
    )
    stubFetch({ 'POST https://www.strava.com/oauth/token': () => json({}, 400) })
    const res = await client(ctx, user).get(
      `/api/integrations/strava/callback?code=bad&state=${encodeURIComponent(state ?? '')}`,
    )
    expect(res.headers.location).toMatch(/^\/integrations\?error=/)
    expect((await ctx.prisma.integration.findFirstOrThrow()).status).toBe('needs_auth')
  })
})

describe('POST /api/integrations/:provider/sync', () => {
  test('answers 202 and syncs in the background', async () => {
    await connectIntervals()
    const res = await client(ctx, user).post('/api/integrations/intervals/sync').send({})
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ provider: 'intervals' })
    await settleBackground()
    const activities = await ctx.prisma.activity.findMany()
    expect(activities.map((a) => a.providerKey)).toEqual(['intervals:i1'])
    const status = await client(ctx, user).get('/api/integrations')
    expect((status.body as Array<Record<string, unknown>>)[0]).toMatchObject({
      status: 'connected',
      lastSyncStatus: 'ok',
    })
  })

  test('validates the start date', async () => {
    await connectIntervals()
    const res = await client(ctx, user)
      .post('/api/integrations/intervals/sync')
      .send({ from: 'yesterday' })
    expect(res.status).toBe(400)
  })

  test('answers 409 when the provider is not connected or is paused', async () => {
    expect((await client(ctx, user).post('/api/integrations/intervals/sync').send({})).status).toBe(
      409,
    )
    await connectIntervals()
    await ctx.prisma.integration.updateMany({
      data: { pausedUntil: new Date(Date.now() + 3_600_000), lastSyncStatus: 'paused' },
    })
    expect((await client(ctx, user).post('/api/integrations/intervals/sync').send({})).status).toBe(
      409,
    )
  })

  test('answers 400 for a provider that cannot pull', async () => {
    await client(ctx, user).post('/api/integrations/apple-health/push-token').send({})
    const res = await client(ctx, user).post('/api/integrations/apple-health/sync').send({})
    expect(res.status).toBe(400)
  })
})

describe('push tokens', () => {
  test('creates a token once, stores only its hash, and replaces it on the next call', async () => {
    const first = await client(ctx, user).post('/api/integrations/apple-health/push-token').send({})
    expect(first.status).toBe(200)
    const token = (first.body as { token: string }).token
    expect(token.length).toBeGreaterThanOrEqual(43)
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.ingestTokenHash).toBe(hashToken(token))
    expect(JSON.stringify(row)).not.toContain(token)

    const status = await client(ctx, user).get('/api/integrations')
    expect((status.body as Array<Record<string, unknown>>)[3]).toMatchObject({
      provider: 'apple-health',
      pushEnabled: true,
    })

    const second = await client(ctx, user)
      .post('/api/integrations/apple-health/push-token')
      .send({})
    const next = (second.body as { token: string }).token
    expect(next).not.toBe(token)
    expect((await ctx.prisma.integration.findFirstOrThrow()).ingestTokenHash).toBe(hashToken(next))
  })

  test('is refused for a provider that does not accept pushes', async () => {
    const res = await client(ctx, user).post('/api/integrations/intervals/push-token').send({})
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/integrations/:provider', () => {
  test('forgets the credentials and keeps the imported activities', async () => {
    await connectIntervals()
    await client(ctx, user).post('/api/integrations/intervals/sync').send({})
    await settleBackground()
    expect(await ctx.prisma.activity.count()).toBe(1)

    const res = await client(ctx, user).delete('/api/integrations/intervals')
    expect(res.status).toBe(204)
    expect(await ctx.prisma.integration.count()).toBe(0)
    expect(await ctx.prisma.activity.count()).toBe(1)
    const list = await client(ctx, user).get('/api/integrations')
    expect((list.body as Array<Record<string, unknown>>)[0]).toMatchObject({
      status: 'disconnected',
    })
  })

  test('is idempotent', async () => {
    expect((await client(ctx, user).delete('/api/integrations/intervals')).status).toBe(204)
  })
})

describe('POST /api/ingest/:provider', () => {
  /** Phone automations send neither Origin nor cookie. */
  const bare = () => request(ctx.app).post('/api/ingest/apple-health')

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
        {
          name: 'step_count',
          units: 'count',
          data: [{ date: '2026-03-03 00:00:00 -0500', qty: 8000 }],
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

  test('answers 401 without a token or with a wrong one', async () => {
    await pushToken()
    expect((await bare().send(payload)).status).toBe(401)
    expect((await bare().set('Authorization', 'Bearer nope').send(payload)).status).toBe(401)
    expect((await bare().set('Authorization', 'Basic abc').send(payload)).status).toBe(401)
    expect(await ctx.prisma.activity.count()).toBe(0)
  })

  test('stores the pushed activities and wellness and reports what it ignored', async () => {
    const token = await pushToken()
    const res = await bare().set('Authorization', `Bearer ${token}`).send(payload)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ activities: 1, wellness: 1, ignored: { step_count: 1 } })

    const activity = await ctx.prisma.activity.findFirstOrThrow()
    expect(activity).toMatchObject({
      source: 'apple-health',
      providerKey: 'apple:00000000-0000-4000-8000-0000000000aa',
      type: 'run',
    })
    expect(await ctx.prisma.wellnessDay.count()).toBe(1)
    const batch = await ctx.prisma.importBatch.findFirstOrThrow()
    expect(batch).toMatchObject({ source: 'apple-health', accepted: 1 })

    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.lastSyncStatus).toBe('ok')
    expect(row.lastSyncAt).not.toBeNull()
  })

  test('is idempotent when the automation sends the same workout again', async () => {
    const token = await pushToken()
    await bare().set('Authorization', `Bearer ${token}`).send(payload)
    const again = await bare().set('Authorization', `Bearer ${token}`).send(payload)
    expect(again.status).toBe(200)
    expect(await ctx.prisma.activity.count()).toBe(1)
  })

  test('rejects a token after it is replaced, and a body that is not the provider format', async () => {
    const old = await pushToken()
    const fresh = await pushToken()
    expect((await bare().set('Authorization', `Bearer ${old}`).send(payload)).status).toBe(401)
    const bad = await bare().set('Authorization', `Bearer ${fresh}`).send({ nope: true })
    expect(bad.status).toBe(400)
  })

  test('answers 404 for a provider without a push channel and for an unknown one', async () => {
    expect((await request(ctx.app).post('/api/ingest/intervals').send({})).status).toBe(404)
    expect((await request(ctx.app).post('/api/ingest/nope').send({})).status).toBe(404)
  })
})
