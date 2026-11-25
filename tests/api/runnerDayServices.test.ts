import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import {
  isPublishDue,
  publishChangeKey,
  publishForUser,
  CHANNEL as PUBLISH_CHANNEL,
} from '../../server/services/publish.ts'
import { backfillWatchRatings } from '../../server/services/watchRatingBackfill.ts'
import { refreshWeatherCaches } from '../../server/services/weatherCache.ts'
import { sealSecret } from '../../server/services/sync.ts'
import { fakeFetch } from '../fakeFetch.ts'
import {
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'
import {
  connectIntervals,
  enablePublishing,
  fakeIntervals,
  place,
  seedRunner,
  type FakeIntervals,
} from './wristFixtures.ts'

// D10 step 3 (ADR 0022): the services below the jobs take the runner's day from the caller. These
// cases run the real publisher, watch-rating backfill and weather sweep with a day one day behind
// the server's, which is the case of a runner west of the server, and with the server's own day as
// the control.
const NOW = new Date('2026-10-21T12:00:00Z')
const serverDay = todayIso(NOW)
const runnerDay = addDays(serverDay, -1)

let ctx: TestCtx
let fake: FakeIntervals

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  fake = fakeIntervals()
  await ctx.prisma.user.deleteMany()
  await ctx.prisma.climateCache.deleteMany()
  await ctx.prisma.climateFailure.deleteMany()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

let counter = 0

async function publishingRunner() {
  counter += 1
  const seeded = await seedRunner(ctx, `svc${String(counter)}@example.com`, serverDay)
  await connectIntervals(ctx, seeded.u.id)
  await enablePublishing(ctx, seeded.u.id)
  return seeded
}

describe('the publisher on the runner is day', () => {
  test('keeps a session dated the runner is today in the window, and counts it past on the server is day', async () => {
    const mine = await publishingRunner()
    await place(ctx, mine.planId, [{ date: runnerDay, kind: 'easy' }])
    const result = await publishForUser(ctx, mine.u.id, {
      fetch: fake.fetch,
      trigger: 'schedule',
      now: NOW,
      today: runnerDay,
    })
    expect(result).toMatchObject({ ran: true, status: 'ok', sent: 1 })
    expect(fake.events.size).toBe(1)

    const control = await publishingRunner()
    await place(ctx, control.planId, [{ date: runnerDay, kind: 'easy' }])
    const other = fakeIntervals()
    const past = await publishForUser(ctx, control.u.id, {
      fetch: other.fetch,
      trigger: 'schedule',
      now: NOW,
      today: serverDay,
    })
    expect(past).toMatchObject({ sent: 0 })
    expect(other.events.size).toBe(0)
  })

  test('isPublishDue counts a waiting row dated the runner is today and not one dated before it', async () => {
    const { u, planId } = await publishingRunner()
    const [session] = await place(ctx, planId, [{ date: runnerDay, kind: 'easy' }])
    await ctx.prisma.wristPublication.create({
      data: {
        userId: u.id,
        channel: PUBLISH_CHANNEL,
        externalId: session!.externalId,
        date: runnerDay,
        kind: 'easy',
        title: 'Easy run',
        state: 'pending',
        desiredHash: 'h',
        nextAttemptAt: new Date(NOW.getTime() - 60_000),
      },
    })
    const due = async (today: string) => {
      // The key already matches the day asked about and the last run was a minute ago, so only the
      // waiting row can make the channel due.
      await ctx.prisma.deliveryChannel.updateMany({
        where: { userId: u.id },
        data: {
          dataKey: await publishChangeKey(ctx, u.id, today),
          lastRunAt: new Date(NOW.getTime() - 60_000),
        },
      })
      const channel = await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } })
      return isPublishDue(ctx, channel, NOW, today)
    }
    expect(await due(runnerDay)).toBe(true)
    expect(await due(serverDay)).toBe(false)
  })
})

describe('the weather sweep on the runner is day', () => {
  const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'

  function archive(calls: URL[]) {
    return fakeFetch({
      [`GET ${ARCHIVE}`]: (req) => {
        const url = new URL(req.url)
        calls.push(url)
        const date = url.searchParams.get('start_date')!
        const times = Array.from(
          { length: 24 },
          (_, h) => `${date}T${String(h).padStart(2, '0')}:00`,
        )
        return Response.json({
          hourly: {
            time: times,
            temperature_2m: times.map(() => 18),
            relative_humidity_2m: times.map(() => 50),
            wind_speed_10m: times.map(() => 6),
            shortwave_radiation: times.map(() => 100),
          },
        })
      },
    })
  }

  async function runnerWithGoal(targetDate: string): Promise<TestUser> {
    counter += 1
    const user = await seedUser(ctx, { email: `wx${String(counter)}@example.com` })
    await ctx.prisma.goal.create({
      data: {
        userId: user.id,
        name: 'Synthetic half',
        priority: 'A',
        status: 'target',
        targetDate,
        distanceM: 21_097,
        goalType: 'time',
        targetTimeSec: 7200,
        startTime: '07:00',
        raceLat: 40.12,
        raceLng: -105.234,
      },
    })
    return user
  }

  test('sweeps a goal dated the runner is today, which the server is day has already passed', async () => {
    const user = await runnerWithGoal(runnerDay)
    const calls: URL[] = []
    const outcome = await refreshWeatherCaches(ctx, user.id, {
      fetch: archive(calls),
      now: NOW,
      today: runnerDay,
    })
    expect(outcome).toMatchObject({ failed: 0, error: null })
    expect(calls.length).toBeGreaterThan(0)
    expect(await ctx.prisma.climateCache.count()).toBe(1)
  })

  test('skips the same goal for a runner whose day is the server is', async () => {
    const user = await runnerWithGoal(runnerDay)
    const calls: URL[] = []
    const outcome = await refreshWeatherCaches(ctx, user.id, {
      fetch: archive(calls),
      now: NOW,
      today: serverDay,
    })
    expect(outcome).toEqual({ refreshed: 0, failed: 0, error: null })
    expect(calls).toEqual([])
    expect(await ctx.prisma.climateCache.count()).toBe(0)
  })
})

describe('the watch-rating backfill on the given day', () => {
  const BASE = 'https://intervals.icu/api/v1'

  test('reads the window from the given day', async () => {
    const user = await seedUser(ctx, { email: 'rating@example.com' })
    await ctx.prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'intervals',
        status: 'connected',
        secret: sealSecret({ apiKey: 'key-123' }, ctx.config.sessionSecret),
        config: JSON.stringify({ athleteId: 'i1001' }),
      },
    })
    // A run on the first day of the window that starts at the runner's day.
    const edge = addDays(runnerDay, -P.a5.historyWindowDays.value)
    await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        type: 'run',
        date: edge,
        durationSec: 900,
        source: 'intervals',
        providerKey: 'intervals:edge',
        startUtc: `${edge}T07:00:00Z`,
      },
    })
    const seen: string[] = []
    ctx.fetch = fakeFetch({
      [`GET ${BASE}/activity/`]: (req) => {
        seen.push(decodeURIComponent(new URL(req.url).pathname.split('/').pop()!))
        return new Response(JSON.stringify({ id: 'intervals:edge', icu_rpe: 6 }), { status: 200 })
      },
    })

    // One day later the run falls out of the window.
    const outside = await backfillWatchRatings(ctx, user.id, { now: NOW, today: serverDay })
    expect(outside).toMatchObject({ requests: 0 })
    expect(seen).toEqual([])

    const inside = await backfillWatchRatings(ctx, user.id, { now: NOW, today: runnerDay })
    expect(inside).toMatchObject({ requests: 1, filled: 1 })
    expect(seen).toHaveLength(1)
  })
})
