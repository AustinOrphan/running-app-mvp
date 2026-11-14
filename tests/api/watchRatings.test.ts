// Watch ratings (rule B1, WR1, owner decision D3 of 2026-11-14): the intervals.icu `icu_rpe` fills
// an empty rating with the source `watch`, the runner's own rating always wins, and the engine's
// snapshot reads a watch rating only after the spread check passes.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runSyncJob } from '../../server/jobs/scheduler.ts'
import { loadAthleteContext } from '../../server/services/athleteState.ts'
import { moveConfirmedLogs } from '../../server/services/duplicates.ts'
import { storeParsed } from '../../server/services/activityStore.ts'
import { sealSecret, syncProvider } from '../../server/services/sync.ts'
import type { ParsedActivity } from '../../shared/types.ts'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { fakeFetch, type FakeRoute } from '../fakeFetch.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

const BASE = 'https://intervals.icu/api/v1'
const TODAY = '2026-03-20'

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
  await ctx.prisma.importBatch.deleteMany()
  await ctx.prisma.integration.deleteMany()
})

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

async function connect() {
  await ctx.prisma.integration.create({
    data: {
      userId: user.id,
      provider: 'intervals',
      status: 'connected',
      secret: sealSecret({ apiKey: 'key-123' }, ctx.config.sessionSecret),
      config: JSON.stringify({ athleteId: 'i1001' }),
    },
  })
}

interface Remote {
  id: string
  startUtc: string
  icuRpe?: unknown
  feel?: number
  /** The original file intervals.icu serves; absent answers 404 and the streams are used. */
  fit?: Uint8Array
  /** The status of the activity record call; 200 by default. */
  detailStatus?: number
}

/** intervals.icu as the provider reads it, each activity carrying the watch's `icu_rpe` and `feel`. */
function intervals(remote: Remote[]) {
  const routes: Record<string, FakeRoute> = {
    [`GET ${BASE}/athlete/i1001/activities`]: () =>
      json(remote.map((r) => ({ id: r.id, start_date: r.startUtc }))),
    [`GET ${BASE}/athlete/i1001/wellness.json`]: () => json([]),
  }
  for (const r of remote) {
    routes[`GET ${BASE}/activity/${r.id}/file`] = () =>
      r.fit
        ? new Response(Buffer.from(r.fit), {
            status: 200,
            headers: { 'content-disposition': `attachment; filename="${r.id}.fit"` },
          })
        : json({}, 404)
    routes[`GET ${BASE}/activity/${r.id}/streams.json`] = () =>
      json([
        { type: 'time', data: [0, 10, 20, 30, 40, 50, 60] },
        { type: 'distance', data: [0, 30, 60, 90, 120, 150, 180] },
        { type: 'heartrate', data: [120, 125, 130, 130, 132, 135, 136] },
      ])
    routes[`GET ${BASE}/activity/${r.id}`] = () =>
      r.detailStatus && r.detailStatus !== 200
        ? json({}, r.detailStatus, r.detailStatus === 429 ? { 'retry-after': '120' } : {})
        : json({
            id: r.id,
            type: 'Run',
            start_date: r.startUtc,
            start_date_local: r.startUtc.replace('Z', ''),
            distance: 180,
            moving_time: 60,
            elapsed_time: 60,
            average_heartrate: 130,
            ...(r.icuRpe === undefined ? {} : { icu_rpe: r.icuRpe }),
            ...(r.feel === undefined ? {} : { feel: r.feel }),
          })
  }
  return fakeFetch(routes)
}

function deps() {
  return { prisma: ctx.prisma, config: ctx.config }
}

async function pull(remote: Remote[]) {
  await connect()
  await syncProvider(deps(), user.id, 'intervals', { fetch: intervals(remote) })
}

function parsedOf(providerKey: string, startUtc: string, watchRpe: number | null): ParsedActivity {
  return {
    providerKey,
    startUtc,
    utcOffsetMin: 0,
    type: 'run',
    subtype: null,
    elapsedSec: 60,
    movingSec: 60,
    distanceM: 180,
    elevationGainM: null,
    elevationLossM: null,
    avgHr: 130,
    maxHr: null,
    avgCadence: null,
    avgPowerW: null,
    deviceName: null,
    watchRpe,
    startLat: null,
    startLng: null,
    samples: {
      t: [0, 10, 20, 30, 40, 50, 60],
      d: [0, 30, 60, 90, 120, 150, 180],
      hr: null,
      alt: null,
      cad: null,
      pwr: null,
    },
    laps: [],
  }
}

const reimport = (key: string, startUtc: string, watchRpe: number | null) =>
  storeParsed(deps(), user.id, parsedOf(key, startUtc, watchRpe), {
    source: 'intervals',
    importBatchId: null,
    channel: 'provider',
  })

describe('the intervals.icu pull', () => {
  test('fills an empty rating from icu_rpe with the source watch, and leaves feel alone', async () => {
    await pull([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z', icuRpe: 7, feel: 4 }])
    const row = await ctx.prisma.activity.findFirstOrThrow()
    expect(row).toMatchObject({ rpe: 7, rpeSource: 'watch', feel: null })
    expectNoRefusedFetches(ctx)
  })

  test('shows the rating at once on the activity', async () => {
    await pull([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z', icuRpe: 6 }])
    const row = await ctx.prisma.activity.findFirstOrThrow()
    const res = await client(ctx, user).get(`/api/activities/${row.id}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ rpe: 6, rpeSource: 'watch' })
  })

  test.each([0, 11, 7.5, '7', null])('reads %j as no rating', async (icuRpe) => {
    await pull([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z', icuRpe }])
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: null,
      rpeSource: null,
    })
  })

  describe('with an original FIT file', () => {
    const fit = () =>
      buildFit({
        serial: 7,
        sessions: [
          {
            sport: 1,
            startUnix: Date.UTC(2026, 2, 2, 7) / 1000,
            durationSec: 900,
            records: [0, 30, 60, 90].map((t) => ({ t, distanceM: t * 3 })),
          },
        ],
      })

    test('the rating from the activity record is merged into the file import', async () => {
      await pull([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z', icuRpe: 8, fit: fit() }])
      const row = await ctx.prisma.activity.findFirstOrThrow()
      expect(row).toMatchObject({ rpe: 8, rpeSource: 'watch', providerKey: 'intervals:i1' })
      // The file itself was stored, so this is the file path and not the streams one.
      expect(await ctx.prisma.activityFile.count()).toBe(1)
      expectNoRefusedFetches(ctx)
    })

    test('a failed record call does not fail the import', async () => {
      await pull([
        { id: 'i1', startUtc: '2026-03-02T07:00:00Z', icuRpe: 8, fit: fit(), detailStatus: 500 },
      ])
      expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
        rpe: null,
        rpeSource: null,
      })
      expect(await ctx.prisma.activityFile.count()).toBe(1)
    })

    test('a rate-limited record call pauses the pull: no row stored, the cursor held', async () => {
      const cursor = '2026-03-01T00:00:00.000Z'
      await ctx.prisma.integration.create({
        data: {
          userId: user.id,
          provider: 'intervals',
          status: 'connected',
          secret: sealSecret({ apiKey: 'key-123' }, ctx.config.sessionSecret),
          config: JSON.stringify({ athleteId: 'i1001' }),
          cursor,
        },
      })
      const remote = [
        { id: 'i1', startUtc: '2026-03-02T07:00:00Z', icuRpe: 8, fit: fit(), detailStatus: 429 },
      ]
      const before = Date.now()
      await syncProvider(deps(), user.id, 'intervals', { fetch: intervals(remote) })
      expect(await ctx.prisma.activity.count()).toBe(0)
      const row = await ctx.prisma.integration.findFirstOrThrow()
      expect(row).toMatchObject({ lastSyncStatus: 'paused', status: 'connected', cursor })
      expect((row.pausedUntil?.getTime() ?? 0) - before).toBeGreaterThan(110_000)
    })

    test('a rejected key on the record call fails that activity: no row stored, the cursor held', async () => {
      const cursor = '2026-03-01T00:00:00.000Z'
      await ctx.prisma.integration.create({
        data: {
          userId: user.id,
          provider: 'intervals',
          status: 'connected',
          secret: sealSecret({ apiKey: 'key-123' }, ctx.config.sessionSecret),
          config: JSON.stringify({ athleteId: 'i1001' }),
          cursor,
        },
      })
      const remote = [
        { id: 'i1', startUtc: '2026-03-02T07:00:00Z', icuRpe: 8, fit: fit(), detailStatus: 401 },
      ]
      await syncProvider(deps(), user.id, 'intervals', { fetch: intervals(remote) })
      expect(await ctx.prisma.activity.count()).toBe(0)
      expect(await ctx.prisma.integration.findFirstOrThrow()).toMatchObject({
        // A failed activity is reported as a partial run, as for any per-activity failure.
        status: 'connected',
        lastSyncStatus: 'partial',
        cursor,
      })
    })

    test('a missing record (404) leaves the file import unrated', async () => {
      await pull([
        { id: 'i1', startUtc: '2026-03-02T07:00:00Z', icuRpe: 8, fit: fit(), detailStatus: 404 },
      ])
      expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({ rpe: null })
    })
  })

  test('an activity with no icu_rpe stays unrated', async () => {
    await pull([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z' }])
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: null,
      rpeSource: null,
    })
  })

  test('the scheduled job stores it the same way', async () => {
    await connect()
    await runSyncJob(deps(), {
      fetch: intervals([{ id: 'i9', startUtc: '2026-03-03T07:00:00Z', icuRpe: 4 }]),
    })
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 4,
      rpeSource: 'watch',
    })
  })
})

describe('who wins', () => {
  async function stored(icuRpe: number | null = 7) {
    await pull([{ id: 'i1', startUtc: '2026-03-02T07:00:00Z', icuRpe }])
    return ctx.prisma.activity.findFirstOrThrow()
  }

  test('an in-app rating sets the source app, and a re-import never overwrites it', async () => {
    const row = await stored(7)
    const res = await client(ctx, user).put(`/api/activities/${row.id}/feedback`).send({ rpe: 3 })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ rpe: 3, rpeSource: 'app' })

    await reimport('intervals:i1', '2026-03-02T07:00:00Z', 9)
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 3,
      rpeSource: 'app',
    })
  })

  test('a rating sent to the feedback route is the app’s, even at the watch value', async () => {
    const row = await stored(7)
    await client(ctx, user).patch(`/api/activities/${row.id}/feedback`).send({ rpe: 7, pain: 1 })
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 7,
      rpeSource: 'app',
      pain: 1,
    })
  })

  test('a pain-only save leaves the watch rating and its source', async () => {
    const row = await stored(7)
    await client(ctx, user).patch(`/api/activities/${row.id}/feedback`).send({ pain: 2 })
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 7,
      rpeSource: 'watch',
      pain: 2,
    })
  })

  test('a feel-only save keeps the watch rating and its source', async () => {
    const row = await stored(7)
    const res = await client(ctx, user).put(`/api/activities/${row.id}/feedback`).send({ feel: 1 })
    expect(res.body).toMatchObject({ rpe: 7, rpeSource: 'watch', feel: 1 })
  })

  test('an explicit new rating sets the source app', async () => {
    const row = await stored(7)
    await client(ctx, user).patch(`/api/activities/${row.id}/feedback`).send({ rpe: 4 })
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 4,
      rpeSource: 'app',
    })
  })

  test('a strength copy rated in the app wins over a watch rating on the original when its log moves', async () => {
    const base = { userId: user.id, date: '2026-03-02', type: 'strength', durationSec: 2400 }
    const original = await ctx.prisma.activity.create({
      data: { ...base, rpe: 7, rpeSource: 'watch', source: 'intervals' },
    })
    const copy = await ctx.prisma.activity.create({
      data: {
        ...base,
        rpe: 3,
        rpeSource: 'app',
        source: 'manual',
        duplicateOfId: original.id,
        duplicateStatus: 'confirmed',
      },
    })
    await ctx.prisma.strengthLog.create({
      data: { id: 'log-wr1', userId: user.id, activityId: copy.id, prescribed: '{}' },
    })
    await moveConfirmedLogs(ctx.prisma, user.id, original.id)
    expect(
      await ctx.prisma.activity.findUniqueOrThrow({ where: { id: original.id } }),
    ).toMatchObject({
      rpe: 3,
      rpeSource: 'app',
    })
  })

  test('clearing the rating clears the source, and a later import may fill it again', async () => {
    const row = await stored(7)
    await client(ctx, user).put(`/api/activities/${row.id}/feedback`).send({ rpe: null })
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: null,
      rpeSource: null,
    })
    await reimport('intervals:i1', '2026-03-02T07:00:00Z', 5)
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 5,
      rpeSource: 'watch',
    })
  })

  test('a re-import refreshes an earlier watch rating', async () => {
    await stored(7)
    await reimport('intervals:i1', '2026-03-02T07:00:00Z', 8)
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 8,
      rpeSource: 'watch',
    })
  })

  test('a re-import without a rating changes nothing', async () => {
    await stored(7)
    await reimport('intervals:i1', '2026-03-02T07:00:00Z', null)
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 7,
      rpeSource: 'watch',
    })
  })

  test('a rating of unknown source (a row from before the column) is never replaced', async () => {
    await stored(null)
    await ctx.prisma.activity.updateMany({ data: { rpe: 4, rpeSource: null } })
    await reimport('intervals:i1', '2026-03-02T07:00:00Z', 9)
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 4,
      rpeSource: null,
    })
  })

  test('a full edit that keeps the watch value keeps the source; a changed value is the app’s', async () => {
    const row = await stored(7)
    const body = { date: row.date, type: 'run', durationSec: row.durationSec, rpe: 7 }
    await client(ctx, user).put(`/api/activities/${row.id}`).send(body)
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 7,
      rpeSource: 'watch',
    })
    await client(ctx, user)
      .put(`/api/activities/${row.id}`)
      .send({ ...body, rpe: 5 })
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 5,
      rpeSource: 'app',
    })
  })

  test('a rating entered by hand is the app’s', async () => {
    const res = await client(ctx, user)
      .post('/api/activities')
      .send({ date: '2026-03-04', type: 'run', durationSec: 1800, rpe: 6 })
    expect(res.status).toBe(201)
    expect(await ctx.prisma.activity.findFirstOrThrow()).toMatchObject({
      rpe: 6,
      rpeSource: 'app',
    })
  })
})

describe("Today's rating card", () => {
  test('offers a run with a held watch rating, and stops once the runner picks the watch value', async () => {
    const date = new Date().toISOString().slice(0, 10)
    const run = await ctx.prisma.activity.create({
      data: { userId: user.id, date, type: 'run', durationSec: 1800, rpe: 6, rpeSource: 'watch' },
    })
    const unrated = async () =>
      ((await client(ctx, user).get('/api/today')).body as { unrated: { id: string }[] }).unrated
    expect((await unrated()).map((a) => a.id)).toContain(run.id)

    // The card sends the picked rpe, here the watch value itself.
    await client(ctx, user)
      .put(`/api/activities/${run.id}/feedback`)
      .send({ rpe: 6, feel: null, pain: null })
    expect(await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      rpe: 6,
      rpeSource: 'app',
    })
    expect((await unrated()).map((a) => a.id)).not.toContain(run.id)
  })
})

describe('the snapshot the engine reads', () => {
  async function seedWatchRuns(ratings: number[]) {
    for (const [i, rpe] of ratings.entries()) {
      await ctx.prisma.activity.create({
        data: {
          userId: user.id,
          date: `2026-03-${String(i + 1).padStart(2, '0')}`,
          type: 'run',
          durationSec: 1800,
          rpe,
          rpeSource: 'watch',
        },
      })
    }
  }

  test('reads watch ratings as empty below the check, and an in-app rating as stored', async () => {
    await seedWatchRuns([5, 6])
    await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        date: '2026-03-10',
        type: 'run',
        durationSec: 1800,
        rpe: 8,
        rpeSource: 'app',
      },
    })
    const context = await loadAthleteContext(deps(), { userId: user.id, today: TODAY })
    expect(context.watchRatings).toMatchObject({ count: 2, usable: false })
    expect(context.activities.map((a) => a.rpe)).toEqual([null, null, 8])
  })

  test('reads them like in-app ratings once the spread check passes', async () => {
    await seedWatchRuns([3, 5, 7, 4, 6, 8, 5, 6, 7, 4, 5, 6])
    const context = await loadAthleteContext(deps(), { userId: user.id, today: TODAY })
    expect(context.watchRatings.usable).toBe(true)
    expect(context.activities.map((a) => a.rpe)).toEqual([3, 5, 7, 4, 6, 8, 5, 6, 7, 4, 5, 6])
  })

  test('twelve identical watch ratings (a default tap) stay unread', async () => {
    await seedWatchRuns(Array.from({ length: 12 }, () => 5))
    const context = await loadAthleteContext(deps(), { userId: user.id, today: TODAY })
    expect(context.watchRatings).toMatchObject({ count: 12, distinct: 1, usable: false })
    expect(context.activities.every((a) => a.rpe === null)).toBe(true)
  })
})
