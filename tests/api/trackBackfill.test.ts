import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runTrackJob } from '../../server/jobs/scheduler.ts'
import { storeParsed } from '../../server/services/activityStore.ts'
import { sealSecret } from '../../server/services/sync.ts'
import { TRACK_MAX_ATTEMPTS, backfillTracks } from '../../server/services/trackBackfill.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { syntheticRun } from '../fixtures/syntheticRoute.ts'
import {
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'track-other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importedFile.deleteMany()
  await ctx.prisma.integration.deleteMany()
  await ctx.prisma.syncRun.deleteMany({ where: { provider: 'track' } })
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

const fixes = syntheticRun(900)

/** Imports a run from a FIT file and then clears its track, as a run imported before M1a. */
async function importOld(
  userId: string,
  serial: number,
  day: number,
  opts: { positions?: boolean } = {},
) {
  const name = `run-${serial}.fit`
  const bytes = buildFit({
    serial,
    sessions: [
      {
        sport: 1,
        startUnix: Date.UTC(2026, 0, day, 7) / 1000,
        durationSec: 900,
        records: fixes.map((f) => ({
          t: f.t,
          distanceM: f.distanceM,
          ...(opts.positions === false ? {} : { lat: f.lat, lng: f.lng }),
        })),
      },
    ],
  })
  const [parsed] = parseActivityFile(name, bytes, { timezone: 'UTC' })
  const { activityId } = await storeParsed(ctx, userId, parsed!, {
    source: 'file',
    importBatchId: null,
    channel: 'upload',
    file: { name, format: 'fit', bytes },
  })
  const imported = await ctx.prisma.activityTrack.findUnique({ where: { activityId } })
  await ctx.prisma.activityTrack.deleteMany({ where: { activityId } })
  await ctx.prisma.activity.update({ where: { id: activityId }, data: { trackV: null } })
  return { id: activityId, imported }
}

async function pulledRun(userId: string, remoteId: string, date: string) {
  return ctx.prisma.activity.create({
    data: {
      userId,
      type: 'run',
      date,
      durationSec: 900,
      source: 'intervals',
      providerKey: `intervals:${remoteId}`,
      startUtc: `${date}T07:00:00Z`,
    },
  })
}

async function connect(over: { pausedUntil?: Date } = {}) {
  return ctx.prisma.integration.create({
    data: {
      userId: user.id,
      provider: 'intervals',
      status: 'connected',
      secret: sealSecret({ apiKey: 'key-123' }, ctx.config.sessionSecret),
      config: JSON.stringify({ athleteId: 'i1001' }),
      pausedUntil: over.pausedUntil ?? null,
    },
  })
}

const BASE = 'https://intervals.icu/api/v1'
const streamsBody = JSON.stringify([
  { type: 'latlng', data: fixes.map((f) => f.lat), data2: fixes.map((f) => f.lng) },
  { type: 'distance', data: fixes.map((f) => f.distanceM) },
])

const trackOf = (id: string) => ctx.prisma.activityTrack.findUnique({ where: { activityId: id } })

describe('backfillTracks from stored originals', () => {
  test('writes the track the import would have, marks the run and never meets it again', async () => {
    const run = await importOld(user.id, 1, 5)
    expect(run.imported).not.toBeNull()
    const before = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })
    const result = await backfillTracks(ctx, user.id)
    expect(result).toMatchObject({ filled: 1, withoutPositions: 0, requests: 0, remaining: 0 })
    const row = await trackOf(run.id)
    expect(row?.polyline).toBe(run.imported!.polyline)
    expect(row?.distM).toBe(run.imported!.distM)
    const after = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })
    expect(after.trackV).toBe(1)
    expect(after.updatedAt).toEqual(before.updatedAt)
    expect(await backfillTracks(ctx, user.id)).toMatchObject({ filled: 0, withoutPositions: 0 })
  })

  test('a file without positions is marked and stores no row', async () => {
    const run = await importOld(user.id, 1, 5, { positions: false })
    const result = await backfillTracks(ctx, user.id)
    expect(result).toMatchObject({ filled: 0, withoutPositions: 1, remaining: 0 })
    expect(await trackOf(run.id)).toBeNull()
    expect(await backfillTracks(ctx, user.id)).toMatchObject({ withoutPositions: 0 })
  })

  test('works in small batches, newest first, and resumes', async () => {
    const runs = [
      await importOld(user.id, 1, 5),
      await importOld(user.id, 2, 6),
      await importOld(user.id, 3, 7),
    ]
    const first = await backfillTracks(ctx, user.id, { fileLimit: 2 })
    expect(first).toMatchObject({ filled: 2, remaining: 1 })
    expect(await trackOf(runs[2]!.id)).not.toBeNull()
    expect(await trackOf(runs[0]!.id)).toBeNull()
    expect(await backfillTracks(ctx, user.id, { fileLimit: 2 })).toMatchObject({
      filled: 1,
      remaining: 0,
    })
  })

  test('an unreadable original is reported, marked and not met again', async () => {
    const run = await importOld(user.id, 1, 5)
    await ctx.prisma.activityFile.update({
      where: { activityId: run.id },
      data: { gz: new Uint8Array([1, 2, 3]) },
    })
    expect(await backfillTracks(ctx, user.id)).toMatchObject({
      filled: 0,
      unreadable: [run.id],
      remaining: 0,
    })
    expect(await backfillTracks(ctx, user.id)).toMatchObject({ unreadable: [] })
  })

  test('leaves other users, treadmill runs, other sports and runs of other sources alone', async () => {
    const mine = await importOld(user.id, 1, 5)
    const theirs = await importOld(other.id, 2, 6)
    const treadmill = await importOld(user.id, 3, 7)
    await ctx.prisma.activity.update({
      where: { id: treadmill.id },
      data: { subtype: 'treadmill' },
    })
    const csv = await ctx.prisma.activity.create({
      data: { userId: user.id, type: 'run', date: '2026-01-08', durationSec: 1800, source: 'csv' },
    })
    const result = await backfillTracks(ctx, user.id)
    expect(result).toMatchObject({ filled: 1, remaining: 0 })
    expect(await trackOf(mine.id)).not.toBeNull()
    for (const id of [theirs.id, treadmill.id, csv.id]) expect(await trackOf(id)).toBeNull()
  })

  test('does not overwrite a run an import marked in the meantime', async () => {
    const run = await importOld(user.id, 1, 5)
    await ctx.prisma.activity.update({ where: { id: run.id }, data: { trackV: 1 } })
    expect(await backfillTracks(ctx, user.id)).toMatchObject({ filled: 0, remaining: 0 })
    expect(await trackOf(run.id)).toBeNull()
  })
})

describe('backfillTracks from intervals.icu streams', () => {
  test('asks for latlng and distance once per run, newest first, within the batch', async () => {
    await connect()
    const runs = [
      await pulledRun(user.id, 'i1', '2026-01-05'),
      await pulledRun(user.id, 'i2', '2026-01-06'),
      await pulledRun(user.id, 'i3', '2026-01-07'),
    ]
    const urls: string[] = []
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: (req) => {
        urls.push(req.url)
        return new Response(streamsBody, { status: 200 })
      },
    })
    const first = await backfillTracks(ctx, user.id, { streamLimit: 2 })
    expect(first).toMatchObject({ filled: 2, requests: 2, remaining: 1, pause: null })
    expect(urls).toEqual([
      `${BASE}/activity/i3/streams.json?types=latlng,distance,time`,
      `${BASE}/activity/i2/streams.json?types=latlng,distance,time`,
    ])
    expect(await trackOf(runs[2]!.id)).not.toBeNull()
    expect(await trackOf(runs[0]!.id)).toBeNull()
    expect(await backfillTracks(ctx, user.id, { streamLimit: 2 })).toMatchObject({
      filled: 1,
      requests: 1,
      remaining: 0,
    })
    expect(await backfillTracks(ctx, user.id)).toMatchObject({ requests: 0 })
  })

  test('a 404 or an answer without positions is marked and not asked again', async () => {
    await connect()
    const run = await pulledRun(user.id, 'i1', '2026-01-05')
    ctx.fetch = fakeFetch({ [`GET ${BASE}/activity/`]: () => new Response('{}', { status: 404 }) })
    expect(await backfillTracks(ctx, user.id)).toMatchObject({
      filled: 0,
      withoutPositions: 1,
      requests: 1,
      remaining: 0,
    })
    expect(await trackOf(run.id)).toBeNull()
    expect(await backfillTracks(ctx, user.id)).toMatchObject({ requests: 0 })
  })

  test('a 429 stops the batch, pauses the integration and waits it out', async () => {
    const integration = await connect()
    const run = await pulledRun(user.id, 'i1', '2026-01-05')
    await pulledRun(user.id, 'i2', '2026-01-06')
    let calls = 0
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: () => {
        calls += 1
        return new Response('', { status: 429, headers: { 'retry-after': '120' } })
      },
    })
    const now = new Date('2026-02-01T12:00:00Z')
    const result = await backfillTracks(ctx, user.id, { now })
    expect(result).toMatchObject({ filled: 0, requests: 1, pause: { retryAfterSec: 120 } })
    expect(calls).toBe(1)
    const row = await ctx.prisma.integration.findUniqueOrThrow({ where: { id: integration.id } })
    expect(row.pausedUntil).toEqual(new Date('2026-02-01T12:02:00Z'))
    // Still paused a minute later: no request.
    const later = await backfillTracks(ctx, user.id, { now: new Date('2026-02-01T12:01:00Z') })
    expect(later).toMatchObject({ requests: 0, pause: { retryAfterSec: 60 } })
    expect(calls).toBe(1)
    expect(await trackOf(run.id)).toBeNull()
  })

  test('another failure ends the part and leaves the run for the next call', async () => {
    await connect()
    const run = await pulledRun(user.id, 'i1', '2026-01-05')
    ctx.fetch = fakeFetch({ [`GET ${BASE}/activity/`]: () => new Response('', { status: 500 }) })
    const result = await backfillTracks(ctx, user.id)
    expect(result.failures).toEqual([
      { ref: 'intervals:i1', reason: 'intervals.icu answered HTTP 500.' },
    ])
    expect(result.remaining).toBe(1)
    expect(
      (await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })).trackV,
    ).toBeNull()
  })

  test('a run that fails every tick is given up after the attempt limit and the next one goes on', async () => {
    await connect()
    const bad = await pulledRun(user.id, 'bad', '2026-01-06')
    const good = await pulledRun(user.id, 'good', '2026-01-05')
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/bad/`]: () => new Response('', { status: 500 }),
      [`GET ${BASE}/activity/good/`]: () => new Response(streamsBody, { status: 200 }),
    })
    for (let tick = 1; tick < TRACK_MAX_ATTEMPTS; tick++) {
      const result = await backfillTracks(ctx, user.id)
      expect(result.failures).toHaveLength(1)
      expect(await trackOf(good.id)).toBeNull()
    }
    const last = await backfillTracks(ctx, user.id)
    expect(last.failures[0]!.reason).toContain('given up')
    expect(last).toMatchObject({ withoutPositions: 1, filled: 1 })
    expect((await ctx.prisma.activity.findUniqueOrThrow({ where: { id: bad.id } })).trackV).toBe(1)
    expect(await trackOf(bad.id)).toBeNull()
    expect(await trackOf(good.id)).not.toBeNull()
  })

  test('a 401 stops the stream part for the integration and is not a per-run failure', async () => {
    await connect()
    const run = await pulledRun(user.id, 'i1', '2026-01-05')
    let calls = 0
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: () => {
        calls += 1
        return new Response('', { status: 401 })
      },
    })
    const now = new Date('2026-02-01T12:00:00Z')
    const first = await backfillTracks(ctx, user.id, { now })
    expect(first.failures).toEqual([])
    expect(calls).toBe(1)
    // Within the back-off nothing is asked again.
    await backfillTracks(ctx, user.id, { now: new Date('2026-02-01T12:05:00Z') })
    expect(calls).toBe(1)
    expect(
      (await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })).trackV,
    ).toBeNull()
  })

  test('an edit made while the stream was fetched is not rewound; the run is retried', async () => {
    await connect()
    const run = await pulledRun(user.id, 'i1', '2026-01-05')
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: async () => {
        await ctx.prisma.activity.update({ where: { id: run.id }, data: { notes: 'felt good' } })
        return new Response(streamsBody, { status: 200 })
      },
    })
    const first = await backfillTracks(ctx, user.id)
    expect(first).toMatchObject({ filled: 0, withoutPositions: 0 })
    const edited = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })
    expect(edited.notes).toBe('felt good')
    expect(edited.updatedAt.getTime()).toBeGreaterThanOrEqual(run.updatedAt.getTime())
    expect(edited.trackV).toBeNull()
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: () => new Response(streamsBody, { status: 200 }),
    })
    expect(await backfillTracks(ctx, user.id)).toMatchObject({ filled: 1 })
    const done = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })
    expect(done.updatedAt).toEqual(edited.updatedAt)
  })

  test('no integration, no request: the run waits', async () => {
    await pulledRun(user.id, 'i1', '2026-01-05')
    expect(await backfillTracks(ctx, user.id)).toMatchObject({ requests: 0 })
  })
})

describe('runTrackJob', () => {
  const jobRuns = () =>
    ctx.prisma.syncRun.findMany({
      where: { userId: user.id, channel: 'job', provider: 'track' },
    })

  test('records a run that wrote tracks and stays quiet when idle', async () => {
    await importOld(user.id, 1, 5)
    await runTrackJob(ctx)
    const [run, ...rest] = await jobRuns()
    expect(rest).toEqual([])
    expect(run).toMatchObject({ status: 'ok', accepted: 1, failed: 0 })
    await runTrackJob(ctx)
    expect(await jobRuns()).toHaveLength(1)
  })

  test('an unreadable original makes a partial run', async () => {
    const run = await importOld(user.id, 1, 5)
    await ctx.prisma.activityFile.update({
      where: { activityId: run.id },
      data: { gz: new Uint8Array([1, 2, 3]) },
    })
    await runTrackJob(ctx)
    const [stored] = await jobRuns()
    expect(stored).toMatchObject({ status: 'partial', failed: 1 })
  })
})
