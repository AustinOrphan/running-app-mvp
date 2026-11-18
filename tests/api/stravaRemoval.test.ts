// Strava's API Policy 7.4 work (SC1, ADR 0025): a disconnect revokes at Strava and deletes the
// runner's Strava-sourced activities; a refused token starts a 25-day clock that a reconnect
// cancels and that the daily job acts on; the daily check deletes what Strava no longer lists, after
// a complete listing only. Every Strava call goes through a `fakeFetch`; nothing reaches the network.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { signState } from '../../server/providers/oauthState.ts'
import { runStravaJob } from '../../server/services/stravaRemoval.ts'
import { sealSecret } from '../../server/services/sync.ts'
import { REMOVAL_DAYS, removalDateOf } from '../../shared/domain/stravaRemoval.ts'
import { fakeFetch, type FakeRoute } from '../fakeFetch.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  syncProviderToday,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

const LIST = 'GET https://www.strava.com/api/v3/athlete/activities'
const REVOKE = 'POST https://www.strava.com/oauth/revoke'
const TOKEN = 'POST https://www.strava.com/oauth/token'
const DAY_MS = 86_400_000

const SECRET = {
  clientSecret: 'synthetic-client-secret-0123',
  accessToken: 'synthetic-access-0123456',
  refreshToken: 'synthetic-refresh-0123456',
  expiresAt: 4_102_444_800,
}

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
  await ctx.prisma.fuelLog.deleteMany()
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importBatch.deleteMany()
  await ctx.prisma.syncRun.deleteMany()
  await ctx.prisma.integration.deleteMany()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stub(routes: Record<string, FakeRoute>): void {
  ctx.fetch = fakeFetch(routes)
}

async function connectStrava(over: { status?: string; config?: object } = {}) {
  return ctx.prisma.integration.create({
    data: {
      userId: user.id,
      provider: 'strava',
      status: over.status ?? 'connected',
      secret: sealSecret(SECRET, ctx.config.sessionSecret),
      config: JSON.stringify({ clientId: '12345', ...over.config }),
    },
  })
}

/** A stored run; `day` is 1 to 28 of March 2026. */
async function storeRun(
  source: string,
  key: string | null,
  day: number,
  over: Record<string, unknown> = {},
) {
  const date = `2026-03-${String(day).padStart(2, '0')}`
  return ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date,
      type: 'run',
      durationSec: 1800,
      distanceM: 5000,
      source,
      providerKey: key,
      startUtc: `${date}T07:00:00Z`,
      ...over,
    },
  })
}

const idsLeft = async (): Promise<string[]> =>
  (await ctx.prisma.activity.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(
    (row) => row.id,
  )

/** A Strava list entry: the two fields the provider needs. */
const entry = (id: number, day: number) => ({
  id,
  start_date: `2026-03-${String(day).padStart(2, '0')}T07:00:00Z`,
})

async function jobRun(job: string) {
  return ctx.prisma.syncRun.findFirst({
    where: { userId: user.id, channel: 'job', provider: job },
    orderBy: { startedAt: 'desc' },
  })
}

// ---------------------------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------------------------

describe('DELETE /api/integrations/strava', () => {
  test('revokes at Strava and deletes only what Strava alone holds', async () => {
    await connectStrava()
    const requests: { auth: string | null; body: string }[] = []
    stub({
      [REVOKE]: async (req) => {
        requests.push({ auth: req.headers.get('authorization'), body: await req.text() })
        return json({})
      },
    })
    const batch = await ctx.prisma.importBatch.create({
      data: {
        userId: user.id,
        source: 'strava',
        rowCount: 0,
        accepted: 0,
        skippedDuplicate: 0,
        skippedInvalid: 0,
        errors: '[]',
      },
    })
    // Strava alone.
    const alone = await storeRun('strava', 'strava:1', 1, { importBatchId: batch.id })
    // A Strava copy of a run that a file also holds: the file is the original and stays.
    const file = await storeRun('file', 'file:f', 2)
    const copy = await storeRun('strava', 'strava:2', 2, {
      duplicateOfId: file.id,
      duplicateStatus: 'confirmed',
    })
    // A Strava original that a file copy duplicates: the copy takes the run's fuel log.
    const original = await storeRun('strava', 'strava:3', 3)
    const survivor = await storeRun('file', 'file:g', 3, {
      duplicateOfId: original.id,
      duplicateStatus: 'confirmed',
    })
    await ctx.prisma.fuelLog.create({
      data: { userId: user.id, activityId: original.id, skipped: true },
    })
    const other = await storeRun('file', 'file:h', 4)

    const preview = await client(ctx, user).get('/api/integrations/strava/removal')
    expect(preview.status).toBe(200)
    expect(preview.body).toEqual({ count: 3, deleteAt: null })

    const res = await client(ctx, user).delete('/api/integrations/strava')
    expect(res.status).toBe(204)

    expect(await idsLeft()).toEqual([file.id, survivor.id, other.id].sort())
    expect(alone.id).not.toBe(copy.id)
    const kept = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: survivor.id } })
    expect(kept.duplicateOfId).toBeNull()
    expect(kept.duplicateStatus).toBe('none')
    expect((await ctx.prisma.fuelLog.findFirstOrThrow()).activityId).toBe(survivor.id)
    expect(await ctx.prisma.integration.count()).toBe(0)
    expect(await ctx.prisma.importBatch.count({ where: { source: 'strava' } })).toBe(0)

    expect(requests).toHaveLength(1)
    const basic = Buffer.from('12345:synthetic-client-secret-0123').toString('base64')
    expect(requests[0]?.auth).toBe(`Basic ${basic}`)
    expect(new URLSearchParams(requests[0]?.body).get('token')).toBe(SECRET.refreshToken)
    const run = await jobRun('strava-removal')
    expect(run).toMatchObject({ status: 'ok', accepted: 3 })
  })

  test('still deletes when Strava does not accept the revoke, and records a partial run', async () => {
    await connectStrava()
    stub({ [REVOKE]: () => json({}, 503) })
    await storeRun('strava', 'strava:1', 1)
    expect((await client(ctx, user).delete('/api/integrations/strava')).status).toBe(204)
    expect(await ctx.prisma.activity.count()).toBe(0)
    expect(await ctx.prisma.integration.count()).toBe(0)
    expect(await jobRun('strava-removal')).toMatchObject({ status: 'partial', accepted: 1 })
  })

  test('a runner with no Strava activities is asked about none and loses none', async () => {
    await connectStrava()
    stub({ [REVOKE]: () => json({}) })
    await storeRun('file', 'file:a', 1)
    const preview = await client(ctx, user).get('/api/integrations/strava/removal')
    expect(preview.body).toEqual({ count: 0, deleteAt: null })
    expect((await client(ctx, user).delete('/api/integrations/strava')).status).toBe(204)
    expect(await ctx.prisma.activity.count()).toBe(1)
  })

  test('the removal preview is for Strava only', async () => {
    expect((await client(ctx, user).get('/api/integrations/garmin/removal')).status).toBe(404)
  })
})

// ---------------------------------------------------------------------------------------------
// A refused token starts the clock; connecting again cancels it
// ---------------------------------------------------------------------------------------------

describe('a revoked Strava grant', () => {
  test('schedules the removal 25 days out and keeps the runs for now', async () => {
    await connectStrava()
    await storeRun('strava', 'strava:1', 1)
    stub({ [LIST]: () => json({}, 401) })
    const before = Date.now()
    await syncProviderToday(ctx, user.id, 'strava')
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.status).toBe('needs_auth')
    const due = removalDateOf(JSON.parse(row.config) as Record<string, unknown>)
    expect(due).not.toBeNull()
    expect(due!.getTime() - before).toBeGreaterThanOrEqual(REMOVAL_DAYS * DAY_MS - 1000)
    expect(due!.getTime() - Date.now()).toBeLessThanOrEqual(REMOVAL_DAYS * DAY_MS)
    expect(await ctx.prisma.activity.count()).toBe(1)
    const status = await client(ctx, user).get('/api/integrations/strava/removal')
    expect(status.body).toMatchObject({ count: 1, deleteAt: due!.toISOString() })
  })

  test('a refused refresh token starts it too, and a network error does not', async () => {
    await connectStrava()
    // The access token has run out, so the refresh is asked for and Strava answers 400.
    await ctx.prisma.integration.updateMany({
      data: { secret: sealSecret({ ...SECRET, expiresAt: 1 }, ctx.config.sessionSecret) },
    })
    stub({ [TOKEN]: () => json({}, 400) })
    await syncProviderToday(ctx, user.id, 'strava')
    const refused = await ctx.prisma.integration.findFirstOrThrow()
    expect(refused.status).toBe('needs_auth')
    expect(removalDateOf(JSON.parse(refused.config) as Record<string, unknown>)).not.toBeNull()

    await ctx.prisma.integration.deleteMany()
    await connectStrava()
    stub({ [LIST]: () => json({}, 500) })
    await syncProviderToday(ctx, user.id, 'strava')
    const outage = await ctx.prisma.integration.findFirstOrThrow()
    expect(outage.status).not.toBe('needs_auth')
    expect(removalDateOf(JSON.parse(outage.config) as Record<string, unknown>)).toBeNull()
  })

  test('opening the form keeps the clock and the callback cancels it', async () => {
    const clock = new Date(Date.now() + 10 * DAY_MS).toISOString()
    await connectStrava({ status: 'needs_auth', config: { deleteAt: clock } })
    const form = await client(ctx, user)
      .put('/api/integrations/strava')
      .send({ clientId: '12345', clientSecret: 'synthetic-client-secret-0123' })
    expect(form.status).toBe(200)
    const kept = await ctx.prisma.integration.findFirstOrThrow()
    expect(kept.status).toBe('needs_auth')
    expect((JSON.parse(kept.config) as Record<string, unknown>).deleteAt).toBe(clock)

    stub({
      [TOKEN]: () => json({ access_token: 'a-1', refresh_token: 'r-1', expires_at: 4_102_444_800 }),
    })
    const state = signState(user.id, ctx.config.sessionSecret, new Date())
    const res = await client(ctx, user).get(
      `/api/integrations/strava/callback?code=abc&state=${encodeURIComponent(state)}`,
    )
    expect(res.headers.location).toBe('/integrations?connected=strava')
    const back = await ctx.prisma.integration.findFirstOrThrow()
    expect(back.status).toBe('connected')
    expect(removalDateOf(JSON.parse(back.config) as Record<string, unknown>)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// The daily job: the date passing
// ---------------------------------------------------------------------------------------------

describe('the daily job and a scheduled removal', () => {
  test('deletes the runs once the date has passed, not the minute before', async () => {
    const due = new Date('2026-12-01T12:00:00.000Z')
    await connectStrava({ status: 'needs_auth', config: { deleteAt: due.toISOString() } })
    const strava = await storeRun('strava', 'strava:1', 1)
    const file = await storeRun('file', 'file:a', 2)

    await runStravaJob(ctx, { now: new Date(due.getTime() - 60_000) })
    expect(await idsLeft()).toEqual([strava.id, file.id].sort())
    expect(await jobRun('strava-removal')).toBeNull()

    await runStravaJob(ctx, { now: due })
    expect(await idsLeft()).toEqual([file.id])
    expect(await jobRun('strava-removal')).toMatchObject({ status: 'ok', accepted: 1 })
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.status).toBe('needs_auth')
    expect(removalDateOf(JSON.parse(row.config) as Record<string, unknown>)).toBeNull()
  })

  test('never starts a clock of its own: a row with no date loses nothing', async () => {
    await connectStrava({ status: 'needs_auth' })
    await storeRun('strava', 'strava:1', 1)
    await runStravaJob(ctx, { now: new Date('2030-01-01T00:00:00Z') })
    expect(await ctx.prisma.activity.count()).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------
// The daily job: what Strava no longer lists
// ---------------------------------------------------------------------------------------------

describe('the daily check against Strava', () => {
  test('deletes the runs Strava dropped after a complete listing, and only those', async () => {
    await connectStrava()
    const kept = await storeRun('strava', 'strava:1', 1)
    await storeRun('strava', 'strava:2', 2)
    const alsoKept = await storeRun('strava', 'strava:3', 3)
    const file = await storeRun('file', 'file:a', 2)
    stub({ [LIST]: () => json([entry(1, 1), entry(3, 3)]) })
    await runStravaJob(ctx)
    expect(await idsLeft()).toEqual([kept.id, alsoKept.id, file.id].sort())
    expect(await jobRun('strava-reconcile')).toMatchObject({ status: 'ok', accepted: 1 })
  })

  test('deletes nothing after a partial listing and records a partial run', async () => {
    await connectStrava()
    await storeRun('strava', 'strava:1', 1)
    // A full first page, then Strava fails: the rest of the list was never read.
    const page1 = Array.from({ length: 200 }, (_, i) => entry(1000 + i, 5))
    stub({
      [LIST]: (req) =>
        new URL(req.url).searchParams.get('page') === '1' ? json(page1) : json({}, 500),
    })
    await runStravaJob(ctx)
    expect(await ctx.prisma.activity.count()).toBe(1)
    expect(await jobRun('strava-reconcile')).toMatchObject({ status: 'partial', accepted: 0 })
  })

  test('deletes nothing when Strava answers a rate limit, and pauses the runner', async () => {
    await connectStrava()
    await storeRun('strava', 'strava:1', 1)
    stub({ [LIST]: () => json({}, 429) })
    await runStravaJob(ctx)
    expect(await ctx.prisma.activity.count()).toBe(1)
    expect(await jobRun('strava-reconcile')).toMatchObject({ status: 'partial' })
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.pausedUntil!.getTime()).toBeGreaterThan(Date.now())
  })

  test('deletes nothing while the runner is paused, and makes no request', async () => {
    await connectStrava()
    await ctx.prisma.integration.updateMany({
      data: { pausedUntil: new Date(Date.now() + 3600_000) },
    })
    await storeRun('strava', 'strava:1', 1)
    await runStravaJob(ctx)
    expect(await ctx.prisma.activity.count()).toBe(1)
    expect(await jobRun('strava-reconcile')).toMatchObject({ status: 'partial' })
  })

  test('an empty list while runs are stored deletes nothing and is an error', async () => {
    await connectStrava()
    await storeRun('strava', 'strava:1', 1)
    stub({ [LIST]: () => json([]) })
    await runStravaJob(ctx)
    expect(await ctx.prisma.activity.count()).toBe(1)
    expect(await jobRun('strava-reconcile')).toMatchObject({ status: 'error' })
  })

  test('a refused token found by the check starts the clock and deletes nothing', async () => {
    await connectStrava()
    await storeRun('strava', 'strava:1', 1)
    stub({ [LIST]: () => json({}, 401) })
    await runStravaJob(ctx)
    expect(await ctx.prisma.activity.count()).toBe(1)
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.status).toBe('needs_auth')
    expect(removalDateOf(JSON.parse(row.config) as Record<string, unknown>)).not.toBeNull()
  })

  test('a runner with no Strava runs is not listed at all', async () => {
    await connectStrava()
    await storeRun('file', 'file:a', 1)
    // `ctx.fetch` still refuses every call, so a request would fail the test.
    await runStravaJob(ctx)
    expect(await jobRun('strava-reconcile')).toBeNull()
  })
})
