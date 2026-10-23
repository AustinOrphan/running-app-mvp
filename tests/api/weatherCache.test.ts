import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { PlanWithSessions, PredictionView, StateView } from '../../shared/types.ts'
import { runWeatherJob } from '../../server/jobs/scheduler.ts'
import { gatherContextInput } from '../../server/services/engineInput.ts'
import {
  BACKOFF_MS,
  FORECAST_REFRESH_MS,
  FORECAST_USABLE_MS,
  settleWeatherCache,
} from '../../server/services/weatherCache.ts'
import { fakeFetch, type FakeRoute } from '../fakeFetch.ts'
import {
  client,
  createTestCtx,
  noNetwork,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const MINUTE = 60_000

// A Wednesday at noon; only Date is faked, so timers, the database and the promises keep working.
const NOW = new Date(2026, 9, 21, 12)
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(NOW)

const today = todayIso()
const thisMonday = mondayOf(today)

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(async () => {
  await settleWeatherCache()
  vi.unstubAllGlobals()
  vi.setSystemTime(NOW)
  ctx.fetch = noNetwork()
  await ctx.prisma.climateCache.deleteMany()
  await ctx.prisma.forecastCache.deleteMany()
  // The job serves every user, so each test starts with only its own runner.
  await ctx.prisma.user.deleteMany()
})

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/** A runner with 12 weeks of history, a recent race result and a goal with its own place. */
async function runner(
  email: string,
  over: { place?: boolean; home?: boolean; useHome?: boolean } = {},
) {
  const user: TestUser = await seedUser(ctx, { email })
  const week = [
    { dow: 1, min: 40, distanceM: 6400 },
    { dow: 3, min: 45, distanceM: 7200 },
    { dow: 5, min: 35, distanceM: 5600 },
    { dow: 6, min: 70, distanceM: 11_000 },
  ]
  const rows = []
  for (let w = 1; w <= 12; w += 1) {
    for (const run of week) {
      rows.push({
        userId: user.id,
        date: addDays(thisMonday, -7 * w + run.dow),
        type: 'run',
        durationSec: run.min * 60,
        movingSec: run.min * 60,
        distanceM: run.distanceM,
        rpe: 3,
        source: 'manual',
      })
    }
  }
  rows.push({
    userId: user.id,
    date: addDays(today, -30),
    type: 'race',
    durationSec: 3300,
    movingSec: 3300,
    distanceM: 10_000,
    rpe: 9,
    source: 'manual',
  })
  await ctx.prisma.activity.createMany({ data: rows })
  if (over.home !== false) {
    await ctx.prisma.athleteProfile.create({
      data: {
        userId: user.id,
        homeLat: 40.1,
        homeLng: -105.2,
        timezone: 'UTC',
        useHomeWeather: over.useHome ?? true,
      },
    })
  }
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 14 + 5),
      distanceM: 21_097,
      goalType: 'finish',
      startTime: '07:00',
      isActive: true,
      ...(over.place === false ? {} : { raceLat: 40.1, raceLng: -105.2 }),
    },
  })
  return { user, goal }
}

function hoursOf(date: string, days = 1): string[] {
  return Array.from({ length: 24 * days }, (_, i) => {
    const day = addDays(date, Math.floor(i / 24))
    return `${day}T${String(i % 24).padStart(2, '0')}:00`
  })
}

/** Archive hours as hot as the penalty model allows, whatever dates are asked for. */
function archiveRoute(calls: URL[], temperature = 40): FakeRoute {
  return (req) => {
    calls.push(new URL(req.url))
    const times = hoursOf('2025-06-01', 3)
    return Response.json({
      hourly: {
        time: times,
        temperature_2m: times.map(() => temperature),
        relative_humidity_2m: times.map(() => 80),
        wind_speed_10m: times.map(() => 8),
        shortwave_radiation: times.map(() => 900),
      },
    })
  }
}

function forecastRoute(calls: URL[], temperature = 33): FakeRoute {
  return (req) => {
    calls.push(new URL(req.url))
    const times = hoursOf(today, 7)
    return Response.json({
      hourly: {
        time: times,
        temperature_2m: times.map(() => temperature),
        relative_humidity_2m: times.map(() => 60),
        dew_point_2m: times.map(() => 22),
        wind_speed_10m: times.map(() => 5),
      },
    })
  }
}

/** A `fetch` that counts its calls and answers none of them. */
function silent(): { fetchFn: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchFn: typeof fetch = (input) => {
    calls.push(input instanceof Request ? input.url : String(input))
    return Promise.reject(new Error('no network'))
  }
  return { fetchFn, calls }
}

// ---------------------------------------------------------------------------------------------
// No request waits on Open-Meteo
// ---------------------------------------------------------------------------------------------

describe('request paths read the cache and never fetch', () => {
  test('Today, predictions, zones, state, plan, weeks and re-plan make no call on empty caches', async () => {
    const { user, goal } = await runner('reads@example.com')
    ctx.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute([]) })
    const generated = await client(ctx, user).post('/api/plan/generate').send({ goalId: goal.id })
    expect(generated.status, JSON.stringify(generated.body)).toBe(201)

    // The caches are empty again and every fetch, injected or global, fails and is counted.
    await ctx.prisma.climateCache.deleteMany()
    await ctx.prisma.forecastCache.deleteMany()
    const { fetchFn, calls } = silent()
    ctx.fetch = fetchFn
    vi.stubGlobal('fetch', fetchFn)

    const c = client(ctx, user)
    for (const url of [
      '/api/today',
      `/api/predictions?goalId=${goal.id}`,
      '/api/zones',
      '/api/zones/proposals',
      '/api/state',
      '/api/plan',
      '/api/weeks',
      '/api/reviews',
    ]) {
      const res = await c.get(url)
      expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(200)
    }
    const replan = await c.post('/api/plan/replan').send({})
    expect(replan.status, JSON.stringify(replan.body)).toBe(200)

    expect(calls).toEqual([])
    expect(await ctx.prisma.climateCache.count()).toBe(0)
    expect(await ctx.prisma.forecastCache.count()).toBe(0)
  })

  test('generating a plan on a warm cache makes no call, on a cold one waits for the race climate', async () => {
    const { user, goal } = await runner('generate@example.com')
    const archive: URL[] = []
    ctx.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(archive) })

    // Cold: the plan asks the archive and carries the race heat (a hot day is above the model).
    const cold = await client(ctx, user).post('/api/plan/generate').send({ goalId: goal.id })
    expect(cold.status, JSON.stringify(cold.body)).toBe(201)
    expect((cold.body as PlanWithSessions).warnings.map((w) => w.code)).toContain(
      'heat-above-model-range',
    )
    expect(archive).toHaveLength(3)

    // Warm: the same plan again asks nobody.
    const { fetchFn, calls } = silent()
    ctx.fetch = fetchFn
    const warm = await client(ctx, user).post('/api/plan/generate').send({ goalId: goal.id })
    expect(warm.status).toBe(201)
    expect((warm.body as PlanWithSessions).warnings.map((w) => w.code)).toContain(
      'heat-above-model-range',
    )
    expect(calls).toEqual([])
  })

  test('a plan is still made when the archive is down, without the race heat', async () => {
    const { user, goal } = await runner('down@example.com')
    ctx.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: () => new Response('busy', { status: 503 }) })
    const res = await client(ctx, user).post('/api/plan/generate').send({ goalId: goal.id })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect((res.body as PlanWithSessions).warnings.map((w) => w.code)).not.toContain(
      'heat-above-model-range',
    )
  })

  test('the engine reads the cached forecast and ignores one older than 24 hours', async () => {
    const { user } = await runner('forecast@example.com')
    const calls: URL[] = []
    ctx.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls) })
    await runWeatherJob(ctx, { fetch: ctx.fetch })
    expect(calls).toHaveLength(1)

    const { fetchFn, calls: stray } = silent()
    ctx.fetch = fetchFn
    const input = () =>
      gatherContextInput(ctx, { userId: user.id, today, goalId: null }, { forecast: true })

    expect((await input()).forecast).toHaveLength(168)
    vi.setSystemTime(new Date(NOW.getTime() + FORECAST_USABLE_MS))
    expect((await input()).forecast).toHaveLength(168)
    vi.setSystemTime(new Date(NOW.getTime() + FORECAST_USABLE_MS + MINUTE))
    expect((await input()).forecast).toBeNull()
    expect(stray).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// Warming on writes
// ---------------------------------------------------------------------------------------------

describe('writes that change a place or a date warm the cache after the response', () => {
  /** A fetch that answers when the test lets it, so a test can look before the answer arrives. */
  function gated(routes: Record<string, FakeRoute>) {
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const fetchFn = fakeFetch(
      Object.fromEntries(
        Object.entries(routes).map(([key, route]) => [
          key,
          async (req: Request) => {
            await gate
            return route(req)
          },
        ]),
      ),
    )
    return { fetchFn, open }
  }

  test('a new home location fills the forecast cell, a repeated one asks nobody', async () => {
    const user = await seedUser(ctx, { email: 'warm-home@example.com' })
    const calls: URL[] = []
    const { fetchFn, open } = gated({ [`GET ${FORECAST}`]: forecastRoute(calls) })
    ctx.fetch = fetchFn

    await client(ctx, user)
      .put('/api/profile')
      .send({ homeLat: 40.12, homeLng: -105.23 })
      .expect(200)
    // The response is out while the fetch is still waiting.
    expect(await ctx.prisma.forecastCache.count()).toBe(0)
    open()
    await settleWeatherCache()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.searchParams.get('latitude')).toBe('40.1')
    expect(await ctx.prisma.forecastCache.count()).toBe(1)

    await client(ctx, user)
      .put('/api/profile')
      .send({ homeLat: 40.12, homeLng: -105.23, hrMax: 190 })
      .expect(200)
    await settleWeatherCache()
    expect(calls).toHaveLength(1)
  })

  test('a goal with a race place, and a new date, fill the race climate', async () => {
    const user = await seedUser(ctx, { email: 'warm-goal@example.com' })
    const calls: URL[] = []
    ctx.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    const created = await client(ctx, user)
      .post('/api/goals')
      .send({
        name: 'Synthetic half',
        priority: 'A',
        targetDate: '2027-04-18',
        distanceM: 21_097,
        raceLat: 40.12,
        raceLng: -105.23,
      })
      .expect(201)
    await settleWeatherCache()
    expect(calls).toHaveLength(3)
    expect(await ctx.prisma.climateCache.findMany({ select: { monthDay: true } })).toEqual([
      { monthDay: '04-18' },
    ])

    // A rename touches no place, date, time or distance.
    const id = (created.body as { id: string }).id
    await client(ctx, user).put(`/api/goals/${id}`).send({ name: 'Renamed' }).expect(200)
    await settleWeatherCache()
    expect(calls).toHaveLength(3)

    // A new date is a new row; the old one stays for goals that still use it.
    await client(ctx, user).put(`/api/goals/${id}`).send({ targetDate: '2027-05-02' }).expect(200)
    await settleWeatherCache()
    expect(calls).toHaveLength(6)
    expect(
      (await ctx.prisma.climateCache.findMany({ select: { monthDay: true } }))
        .map((row) => row.monthDay)
        .sort(),
    ).toEqual(['04-18', '05-02'])
  })

  test('a failed warm-up never fails the write', async () => {
    const user = await seedUser(ctx, { email: 'warm-down@example.com' })
    ctx.fetch = fakeFetch({ [`GET ${FORECAST}`]: () => new Response('no', { status: 500 }) })
    await client(ctx, user).put('/api/profile').send({ homeLat: 1, homeLng: 2 }).expect(200)
    await settleWeatherCache()
    expect(await ctx.prisma.forecastCache.findFirstOrThrow()).toMatchObject({
      fetchedAt: null,
      failedAt: NOW,
    })
  })
})

// ---------------------------------------------------------------------------------------------
// The weather job
// ---------------------------------------------------------------------------------------------

describe('the weather job fills the caches', () => {
  async function jobRuns(userId: string) {
    return ctx.prisma.syncRun.findMany({
      where: { userId, channel: 'job', provider: 'weather' },
      orderBy: { startedAt: 'asc' },
    })
  }

  /** Runs the job as of `at`: the clock and the job's own `now` agree, so each run is dated. */
  async function runAt(fetchFn: typeof fetch, at: Date): Promise<void> {
    vi.setSystemTime(at)
    await runWeatherJob(ctx, { fetch: fetchFn, now: at })
  }

  test('through the injected fetch, on the ages of the design, and records each busy run', async () => {
    const { user } = await runner('job@example.com')
    const calls: URL[] = []
    const fetchFn = fakeFetch({
      [`GET ${ARCHIVE}`]: archiveRoute(calls),
      [`GET ${FORECAST}`]: forecastRoute(calls),
    })

    await runAt(fetchFn, NOW)
    // One forecast, then one archive request per year of the race climate.
    expect(calls.map((url) => url.origin + url.pathname)).toEqual([
      FORECAST,
      ARCHIVE,
      ARCHIVE,
      ARCHIVE,
    ])
    expect(await ctx.prisma.forecastCache.count()).toBe(1)
    expect(await ctx.prisma.climateCache.count()).toBe(1)

    // Nothing is due 59 minutes later; the forecast alone is due at 60.
    await runAt(fetchFn, new Date(NOW.getTime() + 59 * MINUTE))
    expect(calls).toHaveLength(4)
    await runAt(fetchFn, new Date(NOW.getTime() + FORECAST_REFRESH_MS))
    expect(calls).toHaveLength(5)

    // The run 59 minutes later had nothing to report after an ok run: an idle run is not stored.
    expect((await jobRuns(user.id)).map((run) => [run.status, run.accepted, run.failed])).toEqual([
      ['ok', 2, 0],
      ['ok', 1, 0],
    ])
  })

  test('a failure keeps the old data, is recorded as an error and backs off', async () => {
    const { user, goal } = await runner('job-down@example.com')
    // Only the forecast is in play: a dropped goal needs no race climate.
    await ctx.prisma.goal.update({ where: { id: goal.id }, data: { status: 'dropped' } })
    await runAt(fakeFetch({ [`GET ${FORECAST}`]: forecastRoute([]) }), NOW)
    const stored = await ctx.prisma.forecastCache.findFirstOrThrow()

    const down: URL[] = []
    const failing = fakeFetch({
      [`GET ${FORECAST}`]: (req) => {
        down.push(new URL(req.url))
        return new Response('no', { status: 503 })
      },
    })
    const due = new Date(NOW.getTime() + FORECAST_REFRESH_MS)
    await runAt(failing, due)
    await runAt(failing, new Date(due.getTime() + MINUTE))
    expect(down).toHaveLength(1)
    await runAt(failing, new Date(due.getTime() + BACKOFF_MS))
    expect(down).toHaveLength(2)

    // The old hours are still served, and every run since the failure says it failed.
    expect(await ctx.prisma.forecastCache.findFirstOrThrow()).toMatchObject({
      hours: stored.hours,
      fetchedAt: NOW,
    })
    const runs = await jobRuns(user.id)
    expect(runs.map((run) => run.status)).toEqual(['ok', 'error', 'error', 'error'])
    expect(runs[1]?.message).toMatch(/HTTP 503/)
  })
})

// ---------------------------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------------------------

describe('the athlete snapshot and the caches', () => {
  async function state(user: TestUser, etag?: string) {
    const request = client(ctx, user).get('/api/state')
    if (etag) request.set('If-None-Match', etag)
    return request
  }

  test('a climate refresh recomputes the memoised prediction; a forecast refresh does not', async () => {
    // At first the race has no place of its own and home is not used for it: only a forecast.
    const { user, goal } = await runner('memo@example.com', { place: false, useHome: false })
    const first = await state(user)
    expect(first.status).toBe(200)
    const before = (first.body as StateView).prediction
    expect(before?.predictedSec).toBeGreaterThan(0)
    expect(before?.conditions.join(' ')).not.toMatch(/WBGT/)
    const etag = first.headers.etag as string
    expect((await state(user, etag)).status).toBe(304)

    // The forecast is not state: the same tag still matches.
    await runWeatherJob(ctx, {
      fetch: fakeFetch({ [`GET ${FORECAST}`]: forecastRoute([]) }),
      now: NOW,
    })
    expect(await ctx.prisma.forecastCache.count()).toBe(1)
    expect((await state(user, etag)).status).toBe(304)

    // The race gets a place: the picture is rebuilt, but no climate is cached yet.
    await ctx.prisma.goal.update({
      where: { id: goal.id },
      data: { raceLat: 40.1, raceLng: -105.2 },
    })
    const placed = await state(user, etag)
    expect(placed.status).toBe(200)
    expect((placed.body as StateView).prediction?.conditions.join(' ')).not.toMatch(/WBGT/)
    const placedTag = placed.headers.etag as string
    expect((await state(user, placedTag)).status).toBe(304)

    // The race climate is state: the tag moves, and the prediction carries the race-day heat.
    await runWeatherJob(ctx, {
      fetch: fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute([]) }),
      now: NOW,
    })
    const second = await state(user, placedTag)
    expect(second.status).toBe(200)
    expect(second.headers.etag).not.toBe(placedTag)
    const after = (second.body as StateView).prediction
    expect(after?.conditions.join(' ')).toMatch(/Race-day WBGT/)
    expect(after!.predictedSec).toBeGreaterThan(before!.predictedSec)

    // The predictions route reads the same cache and agrees.
    const route = (await client(ctx, user).get(`/api/predictions?goalId=${goal.id}`))
      .body as PredictionView
    expect(route.prediction).toEqual(after)
  })
})
