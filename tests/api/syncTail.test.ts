import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runSyncJob } from '../../server/jobs/scheduler.ts'
import { sealSecret } from '../../server/services/sync.ts'
import { addDays, todayIso } from '../../shared/dates.ts'
import { fakeFetch, type FakeRoute } from '../fakeFetch.ts'
import { syntheticRun } from '../fixtures/syntheticRoute.ts'
import {
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// The tails of the hourly intervals.icu sync (ADR 0026): the owed track streams, then the watch
// ratings of the runs that existed before the sync started.

const BASE = 'https://intervals.icu/api/v1'
const fixes = syntheticRun(900)
const streamsBody = JSON.stringify([
  { type: 'latlng', data: fixes.map((f) => f.lat), data2: fixes.map((f) => f.lng) },
  { type: 'distance', data: fixes.map((f) => f.distanceM) },
])

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'tail-other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.integration.deleteMany()
  await ctx.prisma.syncRun.deleteMany()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

async function connect(
  who: TestUser,
  over: { status?: string; pausedUntil?: Date | null } = {},
): Promise<{ id: string }> {
  return ctx.prisma.integration.create({
    data: {
      userId: who.id,
      provider: 'intervals',
      status: over.status ?? 'connected',
      secret: sealSecret({ apiKey: 'key-123' }, ctx.config.sessionSecret),
      config: JSON.stringify({ athleteId: 'i1001' }),
      pausedUntil: over.pausedUntil ?? null,
    },
  })
}

/** A pulled run with no original: owed a track and a watch rating. */
function pulledRun(who: TestUser, remoteId: string, daysAgo: number, createdAt?: Date) {
  const date = addDays(todayIso(), -daysAgo)
  return ctx.prisma.activity.create({
    data: {
      // Older than the sync that follows, as a run from an earlier sync is; the rating tail skips a
      // row created in the same millisecond as the sync's start. A run imported during the sync
      // passes the current time.
      createdAt: createdAt ?? new Date(Date.now() - 60_000),
      userId: who.id,
      type: 'run',
      date,
      durationSec: 900,
      source: 'intervals',
      providerKey: `intervals:${remoteId}`,
      startUtc: `${date}T07:00:00Z`,
    },
  })
}

interface Remote {
  streams: string[]
  records: string[]
  fetch: typeof fetch
}

/**
 * intervals.icu with an empty activity list. `during` runs while the list is read, so a row it
 * writes is created after the sync started, as an import is. Streams and records are answered
 * by `streams` and `record`, which default to a route and a rating of 6.
 */
function remote(
  over: { streams?: FakeRoute; record?: FakeRoute; during?: () => Promise<void> } = {},
): Remote {
  const streams: string[] = []
  const records: string[] = []
  const answer = fakeFetch({
    [`GET ${BASE}/athlete/i1001/activities`]: async () => {
      await over.during?.()
      return new Response('[]', { status: 200 })
    },
    [`GET ${BASE}/athlete/i1001/wellness.json`]: () => new Response('[]', { status: 200 }),
    [`GET ${BASE}/activity/`]: (req) => {
      const path = new URL(req.url).pathname
      const id = path.split('/')[4]!
      if (path.endsWith('/streams.json')) {
        streams.push(id)
        return (over.streams ?? (() => new Response(streamsBody, { status: 200 })))(req)
      }
      records.push(id)
      return (
        over.record ?? (() => new Response(JSON.stringify({ id, icu_rpe: 6 }), { status: 200 }))
      )(req)
    },
  })
  return { streams, records, fetch: answer }
}

const sync = (r: Remote) => {
  ctx.fetch = r.fetch
  return runSyncJob(ctx, { fetch: r.fetch })
}
const get = (id: string) => ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
const trackOf = (id: string) => ctx.prisma.activityTrack.findUnique({ where: { activityId: id } })
const jobRuns = (job: string) =>
  ctx.prisma.syncRun.findMany({
    where: { userId: user.id, channel: 'job', provider: job },
    orderBy: { startedAt: 'asc' },
  })

describe('the intervals.icu sync tail', () => {
  test('fetches every owed track, asks only runs that predate the sync, and keeps the second chance', async () => {
    await connect(user)
    const old = await pulledRun(user, 'old', 3)
    const made: { id?: string } = {}
    const icu = remote({
      during: async () => {
        // A run the sync imports unrated: created after the sync started.
        made.id ??= (await pulledRun(user, 'new', 2, new Date())).id
      },
    })

    await sync(icu)
    const importedId = made.id!
    expect(icu.streams.sort()).toEqual(['new', 'old'])
    expect(await trackOf(old.id)).not.toBeNull()
    expect(await trackOf(importedId)).not.toBeNull()
    // The rating is asked for the run that was there before, and not for the one just imported.
    expect(icu.records).toEqual(['old'])
    expect(await get(old.id)).toMatchObject({ rpe: 6, rpeSource: 'watch', watchRpeV: 1 })
    expect(await get(importedId)).toMatchObject({ rpe: null, watchRpeV: null })
    expect(await jobRuns('track')).toMatchObject([
      { status: 'ok', accepted: 2, trigger: 'schedule' },
    ])
    expect(await jobRuns('watch-rating')).toMatchObject([{ status: 'ok', accepted: 1 }])

    // The next sync: the run is older than the sync now, so it is asked, and nothing else is.
    await sync(icu)
    expect(icu.records).toEqual(['old', 'new'])
    expect(icu.streams).toHaveLength(2)
    expect(await get(importedId)).toMatchObject({ rpe: 6, rpeSource: 'watch', watchRpeV: 1 })
  })

  test('a pass drains more than one batch of ratings in one tail', async () => {
    await connect(user)
    for (let i = 1; i <= 12; i += 1) await pulledRun(user, `r${String(i)}`, i)
    const icu = remote({ streams: () => new Response('{}', { status: 404 }) })
    await sync(icu)
    expect(icu.records).toHaveLength(12)
    expect(await ctx.prisma.activity.count({ where: { rpe: 6 } })).toBe(12)
  })

  test('a 429 on a stream pauses the integration, the ratings wait and the next sync skips it', async () => {
    const integration = await connect(user)
    const run = await pulledRun(user, 'i1', 3)
    const icu = remote({
      streams: () => new Response('', { status: 429, headers: { 'retry-after': '600' } }),
    })
    await sync(icu)
    const row = await ctx.prisma.integration.findUniqueOrThrow({ where: { id: integration.id } })
    expect(row.pausedUntil!.getTime()).toBeGreaterThan(Date.now())
    expect(icu.streams).toEqual(['i1'])
    expect(icu.records).toEqual([])
    expect(await get(run.id)).toMatchObject({ rpe: null, watchRpeV: null, trackV: null })
    expect(await jobRuns('track')).toMatchObject([{ status: 'paused' }])

    const before = icu.streams.length + icu.records.length
    await sync(icu)
    expect(icu.streams.length + icu.records.length).toBe(before)
  })

  test('a 429 on a rating pauses the next sync, and the streams of the first tail were kept', async () => {
    const integration = await connect(user)
    const run = await pulledRun(user, 'i1', 3)
    const icu = remote({
      record: () => new Response('', { status: 429, headers: { 'retry-after': '600' } }),
    })
    await sync(icu)
    expect(await trackOf(run.id)).not.toBeNull()
    expect(icu.records).toEqual(['i1'])
    expect(await jobRuns('watch-rating')).toMatchObject([{ status: 'paused' }])
    const row = await ctx.prisma.integration.findUniqueOrThrow({ where: { id: integration.id } })
    expect(row.pausedUntil!.getTime()).toBeGreaterThan(Date.now())
    const before = icu.streams.length + icu.records.length
    await sync(icu)
    expect(icu.streams.length + icu.records.length).toBe(before)
  })

  test('a failing stream tail does not stop the rating tail', async () => {
    await connect(user)
    const run = await pulledRun(user, 'i1', 3)
    const icu = remote({ streams: () => new Response('', { status: 500 }) })
    await sync(icu)
    expect(await get(run.id)).toMatchObject({ rpe: 6, rpeSource: 'watch', trackV: null })
    expect(await jobRuns('track')).toMatchObject([{ status: 'partial', failed: 1 }])
    expect(await jobRuns('watch-rating')).toMatchObject([{ status: 'ok', accepted: 1 }])
  })

  test('a runner without a connected intervals.icu gets no tail, and an idle tail stores nothing', async () => {
    // Needs reconnecting: the sync skips it, so the tails do too.
    await connect(other, { status: 'needs_auth' })
    await pulledRun(other, 'o1', 3)
    await connect(user)
    const icu = remote()
    await sync(icu)
    expect(icu.streams).toEqual([])
    expect(icu.records).toEqual([])
    // The connected runner's idle tails store at most the first idle row (recordSyncRunUnlessIdle).
    expect(await jobRuns('track')).toMatchObject([{ status: 'ok', accepted: 0, failed: 0 }])
    expect(await jobRuns('watch-rating')).toMatchObject([{ status: 'ok', accepted: 0 }])
    expect(await ctx.prisma.syncRun.count({ where: { userId: other.id, channel: 'job' } })).toBe(0)
  })
})
