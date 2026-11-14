import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runWatchRatingJob } from '../../server/jobs/scheduler.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { storeParsed } from '../../server/services/activityStore.ts'
import { sealSecret, syncProvider } from '../../server/services/sync.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { syntheticRun } from '../fixtures/syntheticRoute.ts'
import {
  WATCH_RATING_BATCH,
  WATCH_RATING_DEFER_MS,
  backfillWatchRatings,
} from '../../server/services/watchRatingBackfill.ts'
import { P } from '../../shared/engine/params/index.ts'
import { fakeFetch } from '../fakeFetch.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

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
  await ctx.prisma.integration.deleteMany()
  await ctx.prisma.syncRun.deleteMany({ where: { provider: 'watch-rating' } })
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

const BASE = 'https://intervals.icu/api/v1'
const NOW = new Date('2026-02-01T12:00:00Z')

async function run(
  remoteId: string,
  date: string,
  over: Partial<{
    rpe: number | null
    rpeSource: string | null
    source: string
    providerKey: string | null
    type: string
  }> = {},
) {
  const source = over.source ?? 'intervals'
  return ctx.prisma.activity.create({
    data: {
      userId: user.id,
      type: over.type ?? 'run',
      date,
      durationSec: 900,
      source,
      providerKey: over.providerKey === undefined ? `${source}:${remoteId}` : over.providerKey,
      startUtc: `${date}T07:00:00Z`,
      rpe: over.rpe ?? null,
      rpeSource: over.rpeSource ?? null,
    },
  })
}

async function connect() {
  return ctx.prisma.integration.create({
    data: {
      userId: user.id,
      provider: 'intervals',
      status: 'connected',
      secret: sealSecret({ apiKey: 'key-123' }, ctx.config.sessionSecret),
      config: JSON.stringify({ athleteId: 'i1001' }),
    },
  })
}

/** An intervals.icu fake that answers each `/activity/{id}` from `ratings` (absent id: a 404). */
function icu(ratings: Record<string, number | null>, seen: string[] = []) {
  return fakeFetch({
    [`GET ${BASE}/activity/`]: (req) => {
      const id = decodeURIComponent(new URL(req.url).pathname.split('/').pop()!)
      seen.push(id)
      if (!(id in ratings)) return new Response('', { status: 404 })
      return new Response(JSON.stringify({ id, icu_rpe: ratings[id] }), { status: 200 })
    },
  })
}

const get = (id: string) => ctx.prisma.activity.findUniqueOrThrow({ where: { id } })

describe('backfillWatchRatings', () => {
  test('fills null ratings newest first within the cap and marks every run asked', async () => {
    await connect()
    const rows = []
    for (let i = 1; i <= WATCH_RATING_BATCH + 2; i += 1) {
      rows.push(await run(`i${String(i)}`, `2026-01-${String(i).padStart(2, '0')}`))
    }
    const seen: string[] = []
    ctx.fetch = icu(Object.fromEntries(rows.map((_, i) => [`i${String(i + 1)}`, 6])), seen)
    const result = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(result).toMatchObject({
      filled: WATCH_RATING_BATCH,
      requests: WATCH_RATING_BATCH,
      remaining: 2,
    })
    // The newest days first.
    expect(seen).toEqual(['i7', 'i6', 'i5', 'i4', 'i3'])
    const newest = await get(rows[6]!.id)
    expect(newest).toMatchObject({ rpe: 6, rpeSource: 'watch', watchRpeV: 1 })
    expect(await get(rows[0]!.id)).toMatchObject({ rpe: null, watchRpeV: null })
  })

  test('is idempotent across ticks: asked runs are not asked again', async () => {
    await connect()
    await run('i1', '2026-01-05')
    await run('i2', '2026-01-06')
    const seen: string[] = []
    ctx.fetch = icu({ i1: 7 }, seen)
    const first = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(first).toMatchObject({ filled: 1, unrated: 1, requests: 2, remaining: 0 })
    const second = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(second).toMatchObject({ filled: 0, requests: 0 })
    expect(seen).toHaveLength(2)
  })

  test('never overwrites an app or watch rating', async () => {
    await connect()
    const app = await run('i1', '2026-01-05', { rpe: 3, rpeSource: 'app' })
    const watch = await run('i2', '2026-01-06', { rpe: 4, rpeSource: 'watch' })
    const unknown = await run('i3', '2026-01-07', { rpe: 5, rpeSource: null })
    ctx.fetch = icu({ i1: 9, i2: 9, i3: 9 })
    const result = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(result).toMatchObject({ filled: 0, requests: 0 })
    expect(await get(app.id)).toMatchObject({ rpe: 3, rpeSource: 'app', watchRpeV: null })
    expect(await get(watch.id)).toMatchObject({ rpe: 4, rpeSource: 'watch' })
    expect(await get(unknown.id)).toMatchObject({ rpe: 5, rpeSource: null })
  })

  test('a rating the runner enters while the request is out is kept', async () => {
    await connect()
    const row = await run('i1', '2026-01-05')
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: async () => {
        await ctx.prisma.activity.update({
          where: { id: row.id },
          data: { rpe: 2, rpeSource: 'app' },
        })
        return new Response(JSON.stringify({ icu_rpe: 8 }), { status: 200 })
      },
    })
    await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(await get(row.id)).toMatchObject({ rpe: 2, rpeSource: 'app' })
  })

  test('skips other sources, other types, other users and runs outside the window', async () => {
    await connect()
    await run('f1', '2026-01-05', { source: 'file', providerKey: 'file:f1' })
    await run('g1', '2026-01-05', { source: 'garmin' })
    await run('n1', '2026-01-05', { providerKey: null })
    await run('s1', '2026-01-05', { type: 'strength' })
    const old = '2024-01-05'
    await run('o1', old)
    const other = await seedUser(ctx, { email: 'watch-rating-other@example.com' })
    await ctx.prisma.activity.create({
      data: {
        userId: other.id,
        type: 'run',
        date: '2026-01-05',
        durationSec: 900,
        source: 'intervals',
        providerKey: 'intervals:x1',
      },
    })
    expect(P.a5.historyWindowDays.value).toBeLessThan(700)
    const seen: string[] = []
    ctx.fetch = icu({}, seen)
    const result = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(result).toMatchObject({ requests: 0, remaining: 0 })
    expect(seen).toEqual([])
    // A race counts.
    await run('r1', '2026-01-08', { type: 'race' })
    ctx.fetch = icu({ r1: 9 }, seen)
    expect(await backfillWatchRatings(ctx, user.id, { now: NOW })).toMatchObject({ filled: 1 })
    expect(seen).toEqual(['r1'])
  })

  test('a 404 and a record with no rating mark the run without a rating', async () => {
    await connect()
    const gone = await run('i1', '2026-01-05')
    const unrated = await run('i2', '2026-01-06')
    const odd = await run('i3', '2026-01-07')
    ctx.fetch = icu({ i2: null, i3: 5.5 })
    const result = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(result).toMatchObject({ filled: 0, unrated: 3, requests: 3, remaining: 0 })
    for (const row of [gone, unrated, odd]) {
      const after = await get(row.id)
      expect(after).toMatchObject({ rpe: null, rpeSource: null, watchRpeV: 1 })
      expect(after.updatedAt).toEqual(row.updatedAt)
    }
  })

  test('a 429 stops the call, keeps what was read and pauses the integration', async () => {
    const integration = await connect()
    const first = await run('i2', '2026-01-06')
    const second = await run('i1', '2026-01-05')
    let calls = 0
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: () => {
        calls += 1
        if (calls === 1) return new Response(JSON.stringify({ icu_rpe: 4 }), { status: 200 })
        return new Response('', { status: 429, headers: { 'retry-after': '120' } })
      },
    })
    const result = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(result).toMatchObject({ filled: 1, requests: 2, pause: { retryAfterSec: 120 } })
    expect(await get(first.id)).toMatchObject({ rpe: 4, rpeSource: 'watch' })
    expect(await get(second.id)).toMatchObject({ rpe: null, watchRpeV: null })
    const row = await ctx.prisma.integration.findUniqueOrThrow({ where: { id: integration.id } })
    expect(row.pausedUntil).toEqual(new Date('2026-02-01T12:02:00Z'))
    const later = await backfillWatchRatings(ctx, user.id, {
      now: new Date('2026-02-01T12:01:00Z'),
    })
    expect(later).toMatchObject({ requests: 0, pause: { retryAfterSec: 60 } })
    expect(calls).toBe(2)
  })

  test('a 401 stops the job for the integration and marks nothing', async () => {
    await connect()
    const row = await run('i1', '2026-01-05')
    let calls = 0
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: () => {
        calls += 1
        return new Response('', { status: 401 })
      },
    })
    const first = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(first.authRefused).toBe(true)
    expect(calls).toBe(1)
    await backfillWatchRatings(ctx, user.id, { now: new Date('2026-02-01T12:05:00Z') })
    expect(calls).toBe(1)
    expect(await get(row.id)).toMatchObject({ rpe: null, watchRpeV: null })
  })

  test('an outage ends the call and leaves the run; repeated 4xx for one run give it up', async () => {
    await connect()
    const row = await run('i1', '2026-01-05')
    ctx.fetch = fakeFetch({ [`GET ${BASE}/activity/`]: () => new Response('', { status: 500 }) })
    for (let i = 0; i < 3; i += 1) {
      const result = await backfillWatchRatings(ctx, user.id, { now: NOW })
      expect(result.failures).toEqual([
        { ref: 'intervals:i1', reason: 'intervals.icu answered HTTP 500.' },
      ])
    }
    // Not marked: the rating is asked for again once the run is no longer passed over.
    expect(await get(row.id)).toMatchObject({ watchRpeV: null })
    expect(await backfillWatchRatings(ctx, user.id, { now: NOW })).toMatchObject({ requests: 0 })
    const later = new Date(NOW.getTime() + WATCH_RATING_DEFER_MS + 1000)
    expect(await backfillWatchRatings(ctx, user.id, { now: later })).toMatchObject({ requests: 1 })

    ctx.fetch = fakeFetch({ [`GET ${BASE}/activity/`]: () => new Response('', { status: 400 }) })
    await backfillWatchRatings(ctx, user.id, { now: NOW })
    await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(await get(row.id)).toMatchObject({ watchRpeV: null })
    const last = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(last.failures[0]!.reason).toContain('given up after 3 attempts')
    expect(await get(row.id)).toMatchObject({ rpe: null, watchRpeV: 1 })
  })

  test('no connected integration, no request', async () => {
    await run('i1', '2026-01-05')
    expect(await backfillWatchRatings(ctx, user.id, { now: NOW })).toMatchObject({ requests: 0 })
    await ctx.prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'intervals',
        status: 'needs_auth',
        secret: sealSecret({ apiKey: 'k' }, ctx.config.sessionSecret),
        config: '{}',
      },
    })
    expect(await backfillWatchRatings(ctx, user.id, { now: NOW })).toMatchObject({ requests: 0 })
  })

  test('a rating write raises the data version', async () => {
    await connect()
    await run('i1', '2026-01-05')
    const before = (await dataVersionKey(ctx.prisma)).key
    ctx.fetch = icu({ i1: 6 })
    await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect((await dataVersionKey(ctx.prisma)).key).not.toBe(before)
  })
})

describe('runWatchRatingJob', () => {
  const jobRuns = () =>
    ctx.prisma.syncRun.findMany({
      where: { userId: user.id, channel: 'job', provider: 'watch-rating' },
      orderBy: { startedAt: 'asc' },
    })

  test('records a run that wrote ratings and stays quiet when idle', async () => {
    await connect()
    await run('i1', '2026-01-05')
    ctx.fetch = icu({ i1: 6 })
    await runWatchRatingJob(ctx, undefined, { now: NOW })
    const [stored, ...rest] = await jobRuns()
    expect(rest).toEqual([])
    expect(stored).toMatchObject({ status: 'ok', accepted: 1, failed: 0 })
    await runWatchRatingJob(ctx, undefined, { now: NOW })
    expect(await jobRuns()).toHaveLength(1)
  })

  test('records paused for a 429 and error for a refused key', async () => {
    const integration = await connect()
    await run('i1', '2026-01-05')
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: () => new Response('', { status: 429 }),
    })
    await runWatchRatingJob(ctx, undefined, { now: NOW })
    expect((await jobRuns()).at(-1)).toMatchObject({ status: 'paused' })
    await ctx.prisma.integration.update({
      where: { id: integration.id },
      data: { pausedUntil: null },
    })
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: () => new Response('', { status: 401 }),
    })
    await runWatchRatingJob(ctx, undefined, { now: NOW })
    expect((await jobRuns()).at(-1)).toMatchObject({ status: 'error', failed: 1 })
  })
})

describe('what the backfill leaves alone or hands on', () => {
  test('a rating cleared in the app after an import that read the record is not written back', async () => {
    await connect()
    const fixes = syntheticRun(900)
    const bytes = buildFit({
      serial: 77,
      sessions: [
        {
          sport: 1,
          startUnix: Date.UTC(2026, 0, 5, 7) / 1000,
          durationSec: 900,
          records: fixes.map((f) => ({ t: f.t, distanceM: f.distanceM })),
        },
      ],
    })
    const [parsed] = parseActivityFile('run-77.fit', bytes, { timezone: 'UTC' })
    const { activityId } = await storeParsed(
      ctx,
      user.id,
      { ...parsed!, providerKey: 'intervals:x77', watchRpe: 6 },
      { source: 'intervals', importBatchId: null, channel: 'pull' },
    )
    expect(await get(activityId)).toMatchObject({ rpe: 6, rpeSource: 'watch', watchRpeV: 1 })
    const cleared = await client(ctx, user)
      .patch(`/api/activities/${activityId}/feedback`)
      .send({ rpe: null })
    expect(cleared.status).toBe(200)
    const seen: string[] = []
    ctx.fetch = icu({ x77: 8 }, seen)
    const result = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(result.requests).toBe(0)
    expect(seen).toEqual([])
    expect(await get(activityId)).toMatchObject({ rpe: null, rpeSource: null })
  })

  test('a rating cleared in the app on a run never asked about is marked and not written back', async () => {
    await connect()
    const row = await run('i1', '2026-01-05', { rpe: 5, rpeSource: 'app' })
    const cleared = await client(ctx, user)
      .patch(`/api/activities/${row.id}/feedback`)
      .send({ rpe: null })
    expect(cleared.status).toBe(200)
    ctx.fetch = icu({ i1: 8 })
    expect(await backfillWatchRatings(ctx, user.id, { now: NOW })).toMatchObject({ requests: 0 })
    expect(await get(row.id)).toMatchObject({ rpe: null, watchRpeV: 1 })
  })

  test('a rating filled on a flagged duplicate copy reaches the counted original', async () => {
    await connect()
    const original = await run('o1', '2026-01-05', { source: 'file', providerKey: 'file:o1' })
    const copy = await run('c1', '2026-01-05')
    await ctx.prisma.activity.update({
      where: { id: copy.id },
      data: { duplicateOfId: original.id, duplicateStatus: 'possible' },
    })
    ctx.fetch = icu({ c1: 7 })
    await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(await get(copy.id)).toMatchObject({ rpe: 7, rpeSource: 'watch' })
    expect(await get(original.id)).toMatchObject({ rpe: 7, rpeSource: 'watch' })
  })

  test('an app rating on the original stays when the copy gets a watch rating', async () => {
    await connect()
    const original = await run('o1', '2026-01-05', {
      source: 'file',
      providerKey: 'file:o1',
      rpe: 3,
      rpeSource: 'app',
    })
    const copy = await run('c1', '2026-01-05')
    await ctx.prisma.activity.update({
      where: { id: copy.id },
      data: { duplicateOfId: original.id, duplicateStatus: 'confirmed' },
    })
    ctx.fetch = icu({ c1: 7 })
    await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(await get(copy.id)).toMatchObject({ rpe: 7, rpeSource: 'watch' })
    expect(await get(original.id)).toMatchObject({ rpe: 3, rpeSource: 'app' })
  })

  test('a 403 stops the job like a 401, and the run is passed over after repeated refusals', async () => {
    await connect()
    const first = await run('i2', '2026-01-06')
    const second = await run('i1', '2026-01-05')
    const seen: string[] = []
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: (req) => {
        seen.push(new URL(req.url).pathname.split('/').pop()!)
        return new Response('', { status: 403 })
      },
    })
    const result = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(result.authRefused).toBe(true)
    expect(seen).toEqual(['i2'])
    // Within the back-off nothing is asked.
    await backfillWatchRatings(ctx, user.id, { now: new Date(NOW.getTime() + 60_000) })
    expect(seen).toHaveLength(1)
    // After the back-off the same newest run is tried until it is passed over; then the next one.
    for (let i = 1; i <= 2; i += 1) {
      await backfillWatchRatings(ctx, user.id, { now: new Date(NOW.getTime() + i * 61 * 60_000) })
    }
    expect(seen).toEqual(['i2', 'i2', 'i2'])
    await backfillWatchRatings(ctx, user.id, { now: new Date(NOW.getTime() + 3 * 61 * 60_000) })
    expect(seen.at(-1)).toBe('i1')
    expect(await get(first.id)).toMatchObject({ rpe: null, watchRpeV: null })
    expect(await get(second.id)).toMatchObject({ rpe: null, watchRpeV: null })
  })

  test('a sync in progress keeps the job from asking', async () => {
    await connect()
    await run('i1', '2026-01-05')
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/athlete/`]: async () => {
        await gate
        return new Response('[]', { status: 200 })
      },
      [`GET ${BASE}/activity/`]: () => {
        throw new Error('the backfill must not ask during a sync')
      },
    })
    const syncing = syncProvider(ctx, user.id, 'intervals')
    await new Promise((resolve) => setTimeout(resolve, 50))
    const result = await backfillWatchRatings(ctx, user.id, { now: NOW })
    expect(result.requests).toBe(0)
    release()
    await syncing
  })
})
