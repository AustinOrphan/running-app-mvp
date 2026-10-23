import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ForecastView } from '../../shared/types.ts'
import { enrichWeather } from '../../server/services/weather.ts'
import { settleWeatherCache } from '../../server/services/weatherCache.ts'
import { fakeFetch } from '../fakeFetch.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const NOW = new Date('2026-03-20T12:00:00Z')

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
  await ctx.prisma.athleteProfile.deleteMany()
  await ctx.prisma.forecastCache.deleteMany()
})

afterEach(async () => {
  await settleWeatherCache()
  vi.useRealTimers()
  expectNoRefusedFetches(ctx)
})

/** Hours of every date from `start` to `end` inclusive, as Open-Meteo writes them (GMT). */
function hoursBetween(start: string, end: string): string[] {
  const times: string[] = []
  for (let day = new Date(`${start}T00:00:00Z`); ; day = new Date(day.getTime() + 86_400_000)) {
    const date = day.toISOString().slice(0, 10)
    for (let hour = 0; hour < 24; hour++) times.push(`${date}T${String(hour).padStart(2, '0')}:00`)
    if (date >= end) break
  }
  return times
}

/** Values follow the hour of day, so a test can tell which hour was picked. */
function openMeteoBody(times: string[]) {
  const hour = (time: string) => Number(time.slice(11, 13))
  return {
    latitude: 0,
    longitude: 0,
    hourly_units: { temperature_2m: '°C', wind_speed_10m: 'km/h' },
    hourly: {
      time: times,
      temperature_2m: times.map((t) => hour(t)),
      relative_humidity_2m: times.map((t) => 50 + hour(t)),
      dew_point_2m: times.map((t) => hour(t) - 5),
      wind_speed_10m: times.map((t) => hour(t) * 2),
      shortwave_radiation: times.map((t) => hour(t) * 10),
    },
  }
}

function archiveRoute(calls: URL[]) {
  return (req: Request) => {
    const url = new URL(req.url)
    calls.push(url)
    return Response.json(
      openMeteoBody(
        hoursBetween(url.searchParams.get('start_date')!, url.searchParams.get('end_date')!),
      ),
    )
  }
}

function forecastRoute(calls: URL[]) {
  return (req: Request) => {
    const url = new URL(req.url)
    calls.push(url)
    const past = Number(url.searchParams.get('past_days') ?? 0)
    const ahead = Number(url.searchParams.get('forecast_days') ?? 7)
    const day = (offset: number) =>
      new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
    return Response.json(openMeteoBody(hoursBetween(day(-past), day(ahead - 1))))
  }
}

async function addActivity(data: {
  date: string
  startUtc: string | null
  durationSec?: number
  startLat?: number | null
  startLng?: number | null
  tempC?: number | null
  weatherSource?: string | null
  subtype?: string | null
  providerKey?: string
}) {
  return ctx.prisma.activity.create({
    data: {
      userId: user.id,
      type: 'run',
      durationSec: 1800,
      source: 'file',
      ...data,
    },
  })
}

describe('enrichWeather', () => {
  test('uses the archive for activities older than five days, at the hour nearest the midpoint', async () => {
    const calls: URL[] = []
    const fetchFn = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    // 07:40 + 15 min = 07:55, so the 08:00 reading applies.
    const run = await addActivity({
      date: '2026-03-02',
      startUtc: '2026-03-02T07:40:00Z',
      startLat: 10.12,
      startLng: -20.34,
    })

    const updated = await enrichWeather(ctx, user.id, { limit: 10, fetch: fetchFn, now: NOW })

    expect(updated).toBe(1)
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })
    expect(row).toMatchObject({
      tempC: 8,
      dewPointC: 3,
      humidityPct: 58,
      windKph: 16,
      weatherSource: 'open-meteo',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.searchParams.get('latitude')).toBe('10.1')
    expect(calls[0]!.searchParams.get('longitude')).toBe('-20.3')
    expect(calls[0]!.searchParams.get('start_date')).toBe('2026-03-02')
    expect(calls[0]!.searchParams.get('end_date')).toBe('2026-03-02')
    expect(calls[0]!.searchParams.get('hourly')).toBe(
      'temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m',
    )
    expect(calls[0]!.searchParams.get('timezone')).toBe('GMT')
  })

  test('attaches no weather to treadmill, virtual or indoor activities', async () => {
    const calls: URL[] = []
    const fetchFn = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    const indoors = ['treadmill', 'virtual', 'Indoor cycling'] as const
    for (const [i, subtype] of indoors.entries()) {
      await addActivity({
        date: '2026-03-02',
        startUtc: `2026-03-02T0${String(i + 5)}:00:00Z`,
        startLat: 10.12,
        startLng: -20.34,
        subtype,
        providerKey: `in-${String(i)}`,
      })
    }
    const outside = await addActivity({
      date: '2026-03-02',
      startUtc: '2026-03-02T09:00:00Z',
      startLat: 10.12,
      startLng: -20.34,
      subtype: 'trail',
      providerKey: 'out',
    })
    const plain = await addActivity({
      date: '2026-03-02',
      startUtc: '2026-03-02T10:00:00Z',
      startLat: 10.12,
      startLng: -20.34,
      subtype: null,
      providerKey: 'plain',
    })

    // The limit counts outdoor activities only: indoor ones never use up its places.
    const updated = await enrichWeather(ctx, user.id, { limit: 2, fetch: fetchFn, now: NOW })

    expect(updated).toBe(2)
    const rows = await ctx.prisma.activity.findMany({ where: { tempC: { not: null } } })
    expect(rows.map((r) => r.id).sort()).toEqual([outside.id, plain.id].sort())
    expect(await ctx.prisma.activity.count({ where: { weatherSource: null } })).toBe(3)
  })

  test('uses the forecast endpoint with past days for recent activities', async () => {
    const archiveCalls: URL[] = []
    const forecastCalls: URL[] = []
    const fetchFn = fakeFetch({
      [`GET ${ARCHIVE}`]: archiveRoute(archiveCalls),
      [`GET ${FORECAST}`]: forecastRoute(forecastCalls),
    })
    const run = await addActivity({
      date: '2026-03-18',
      startUtc: '2026-03-18T17:00:00Z',
      startLat: 10.12,
      startLng: -20.34,
    })

    await enrichWeather(ctx, user.id, { limit: 10, fetch: fetchFn, now: NOW })

    expect(archiveCalls).toHaveLength(0)
    expect(forecastCalls).toHaveLength(1)
    expect(forecastCalls[0]!.searchParams.get('past_days')).toBe('7')
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })
    // 17:00 + 15 min is nearer 17:00 than 18:00.
    expect(row).toMatchObject({ tempC: 17, weatherSource: 'open-meteo' })
  })

  test('groups activities by 0.1 degree location and contiguous dates into one request', async () => {
    const calls: URL[] = []
    const fetchFn = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    await addActivity({
      date: '2026-03-01',
      startUtc: '2026-03-01T07:00:00Z',
      startLat: 10.12,
      startLng: -20.34,
      providerKey: 'a',
    })
    await addActivity({
      date: '2026-03-02',
      startUtc: '2026-03-02T07:00:00Z',
      startLat: 10.14,
      startLng: -20.31,
      providerKey: 'b',
    })
    await addActivity({
      date: '2026-03-03',
      startUtc: '2026-03-03T07:00:00Z',
      startLat: 10.12,
      startLng: -20.34,
      providerKey: 'c',
    })
    // Same place, but a week later: a separate range, not one long request.
    await addActivity({
      date: '2026-03-10',
      startUtc: '2026-03-10T07:00:00Z',
      startLat: 10.12,
      startLng: -20.34,
      providerKey: 'd',
    })
    // Elsewhere.
    await addActivity({
      date: '2026-03-02',
      startUtc: '2026-03-02T09:00:00Z',
      startLat: 30.5,
      startLng: 40.5,
      providerKey: 'e',
    })

    const updated = await enrichWeather(ctx, user.id, { limit: 50, fetch: fetchFn, now: NOW })

    expect(updated).toBe(5)
    const ranges = calls
      .map(
        (url) =>
          `${url.searchParams.get('latitude')},${url.searchParams.get('longitude')} ` +
          `${url.searchParams.get('start_date')}..${url.searchParams.get('end_date')}`,
      )
      .sort()
    expect(ranges).toEqual([
      '10.1,-20.3 2026-03-01..2026-03-03',
      '10.1,-20.3 2026-03-10..2026-03-10',
      '30.5,40.5 2026-03-02..2026-03-02',
    ])
  })

  test('splits a long run of consecutive days into archive requests of at most 90 days', async () => {
    const calls: URL[] = []
    const fetchFn = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    const first = Date.parse('2025-10-01T07:00:00Z')
    await ctx.prisma.activity.createMany({
      data: Array.from({ length: 91 }, (_, index) => {
        const startUtc = new Date(first + index * 86_400_000).toISOString()
        return {
          userId: user.id,
          type: 'run',
          durationSec: 1800,
          source: 'file',
          date: startUtc.slice(0, 10),
          startUtc,
          startLat: 10.12,
          startLng: -20.34,
          providerKey: `day-${index}`,
        }
      }),
    })

    expect(await enrichWeather(ctx, user.id, { limit: 100, fetch: fetchFn, now: NOW })).toBe(91)

    const ranges = calls
      .map((url) => `${url.searchParams.get('start_date')}..${url.searchParams.get('end_date')}`)
      .sort()
    expect(ranges).toEqual(['2025-10-01..2025-12-29', '2025-12-30..2025-12-30'])
  })

  test('falls back to the home location when the profile allows it', async () => {
    const calls: URL[] = []
    const fetchFn = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    await ctx.prisma.athleteProfile.create({
      data: { userId: user.id, homeLat: 20.5, homeLng: -30.12, useHomeWeather: true },
    })
    const run = await addActivity({ date: '2026-03-02', startUtc: '2026-03-02T07:00:00Z' })

    expect(await enrichWeather(ctx, user.id, { limit: 10, fetch: fetchFn, now: NOW })).toBe(1)

    expect(calls[0]!.searchParams.get('latitude')).toBe('20.5')
    expect(calls[0]!.searchParams.get('longitude')).toBe('-30.1')
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })
    expect(row.weatherSource).toBe('open-meteo')
  })

  test('skips activities without a location when home weather is off or there is no home', async () => {
    const calls: URL[] = []
    const fetchFn = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    await addActivity({ date: '2026-03-02', startUtc: '2026-03-02T07:00:00Z' })

    expect(await enrichWeather(ctx, user.id, { limit: 10, fetch: fetchFn, now: NOW })).toBe(0)

    await ctx.prisma.athleteProfile.create({
      data: { userId: user.id, homeLat: 20.5, homeLng: -30.12, useHomeWeather: false },
    })
    expect(await enrichWeather(ctx, user.id, { limit: 10, fetch: fetchFn, now: NOW })).toBe(0)
    expect(calls).toHaveLength(0)
  })

  test('leaves activities that have weather, no start instant or a future midpoint', async () => {
    const calls: URL[] = []
    const fetchFn = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    const loc = { startLat: 10.12, startLng: -20.34 }
    const keep = await addActivity({
      date: '2026-03-02',
      startUtc: '2026-03-02T07:00:00Z',
      weatherSource: 'provider',
      tempC: 3,
      providerKey: 'keep',
      ...loc,
    })
    await addActivity({ date: '2026-03-02', startUtc: null, providerKey: 'no-start', ...loc })
    const future = await addActivity({
      date: '2026-03-21',
      startUtc: '2026-03-21T07:00:00Z',
      providerKey: 'future',
      ...loc,
    })

    expect(await enrichWeather(ctx, user.id, { limit: 10, fetch: fetchFn, now: NOW })).toBe(0)

    expect(calls).toHaveLength(0)
    const kept = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: keep.id } })
    expect(kept).toMatchObject({ tempC: 3, weatherSource: 'provider' })
    const pending = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: future.id } })
    expect(pending.weatherSource).toBeNull()
  })

  test('fills at most `limit` activities, newest first', async () => {
    const fetchFn = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute([]) })
    const loc = { startLat: 10.12, startLng: -20.34 }
    const older = await addActivity({
      date: '2026-03-01',
      startUtc: '2026-03-01T07:00:00Z',
      providerKey: 'older',
      ...loc,
    })
    const newer = await addActivity({
      date: '2026-03-02',
      startUtc: '2026-03-02T07:00:00Z',
      providerKey: 'newer',
      ...loc,
    })

    expect(await enrichWeather(ctx, user.id, { limit: 1, fetch: fetchFn, now: NOW })).toBe(1)

    expect(
      (await ctx.prisma.activity.findUniqueOrThrow({ where: { id: newer.id } })).weatherSource,
    ).toBe('open-meteo')
    expect(
      (await ctx.prisma.activity.findUniqueOrThrow({ where: { id: older.id } })).weatherSource,
    ).toBeNull()
  })

  test("never touches another user's activities", async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    const theirs = await ctx.prisma.activity.create({
      data: {
        userId: other.id,
        date: '2026-03-02',
        type: 'run',
        durationSec: 1800,
        startUtc: '2026-03-02T07:00:00Z',
        startLat: 10.12,
        startLng: -20.34,
      },
    })
    const fetchFn = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute([]) })

    expect(await enrichWeather(ctx, user.id, { limit: 10, fetch: fetchFn, now: NOW })).toBe(0)

    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: theirs.id } })
    expect(row.weatherSource).toBeNull()
  })

  test('skips hours the service has no reading for', async () => {
    const fetchFn = fakeFetch({
      [`GET ${ARCHIVE}`]: () => {
        const body = openMeteoBody(hoursBetween('2026-03-02', '2026-03-02'))
        body.hourly.temperature_2m = body.hourly.temperature_2m.map(() => null as never)
        return Response.json(body)
      },
    })
    const run = await addActivity({
      date: '2026-03-02',
      startUtc: '2026-03-02T07:00:00Z',
      startLat: 10.12,
      startLng: -20.34,
    })

    expect(await enrichWeather(ctx, user.id, { limit: 10, fetch: fetchFn, now: NOW })).toBe(0)

    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })
    expect(row.weatherSource).toBeNull()
  })

  test('keeps going past a failed group and reports an error only when nothing was filled', async () => {
    const loc = { startLng: -20.34 }
    const good = await addActivity({
      date: '2026-03-02',
      startUtc: '2026-03-02T07:00:00Z',
      startLat: 10.12,
      providerKey: 'good',
      ...loc,
    })
    await addActivity({
      date: '2026-03-02',
      startUtc: '2026-03-02T07:00:00Z',
      startLat: 40.12,
      providerKey: 'bad',
      ...loc,
    })
    const flaky = fakeFetch({
      [`GET ${ARCHIVE}`]: (req) =>
        new URL(req.url).searchParams.get('latitude') === '40.1'
          ? new Response('busy', { status: 500 })
          : archiveRoute([])(req),
    })

    expect(await enrichWeather(ctx, user.id, { limit: 10, fetch: flaky, now: NOW })).toBe(1)
    expect(
      (await ctx.prisma.activity.findUniqueOrThrow({ where: { id: good.id } })).weatherSource,
    ).toBe('open-meteo')

    const down = fakeFetch({ [`GET ${ARCHIVE}`]: () => new Response('busy', { status: 500 }) })
    await expect(enrichWeather(ctx, user.id, { limit: 10, fetch: down, now: NOW })).rejects.toThrow(
      /Open-Meteo/,
    )
  })
})

describe('GET /api/weather/forecast', () => {
  async function setHome() {
    await ctx.prisma.athleteProfile.create({
      data: { userId: user.id, homeLat: 20.5, homeLng: -30.12 },
    })
  }

  function atMinutes(minutes: number): void {
    vi.setSystemTime(new Date(NOW.getTime() + minutes * 60_000))
  }

  async function forecast(): Promise<ForecastView> {
    const res = await client(ctx, user).get('/api/weather/forecast').expect(200)
    return res.body as ForecastView
  }

  test('requires a session', async () => {
    await client(ctx).get('/api/weather/forecast').expect(401)
  })

  test('answers 404 without a home location', async () => {
    await client(ctx, user).get('/api/weather/forecast').expect(404)
  })

  test('an empty cache waits for one fetch of seven days at the 0.1 degree home cell', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const calls: URL[] = []
    ctx.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls) })
    await setHome()

    const view = await forecast()

    expect(calls).toHaveLength(1)
    expect(calls[0]!.searchParams.get('latitude')).toBe('20.5')
    expect(calls[0]!.searchParams.get('longitude')).toBe('-30.1')
    expect(calls[0]!.searchParams.get('forecast_days')).toBe('7')
    expect(calls[0]!.searchParams.get('past_days')).toBeNull()
    expect(calls[0]!.searchParams.get('hourly')).toContain('shortwave_radiation')
    expect(view).toMatchObject({ fetchedAt: NOW.toISOString(), stale: false })
    expect(view.hours).toHaveLength(168)
    expect(view.hours[0]).toEqual({
      time: '2026-03-20T00:00:00Z',
      tempC: 0,
      dewPointC: -5,
      humidityPct: 50,
      windKph: 0,
      shortwaveWm2: 0,
    })
    expect(view.hours[13]).toMatchObject({
      time: '2026-03-20T13:00:00Z',
      tempC: 13,
      shortwaveWm2: 130,
    })
  })

  test('a filled cell answers from the cache without a request, fresh for an hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const calls: URL[] = []
    ctx.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls) })
    await setHome()
    await forecast()

    atMinutes(59)
    expect(await forecast()).toMatchObject({ fetchedAt: NOW.toISOString(), stale: false })
    expect(calls).toHaveLength(1)
  })

  test('a stale cell answers at once as stale and refreshes in the background', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const calls: URL[] = []
    ctx.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls) })
    await setHome()
    await forecast()

    atMinutes(61)
    expect(await forecast()).toMatchObject({ fetchedAt: NOW.toISOString(), stale: true })
    await settleWeatherCache()
    expect(calls).toHaveLength(2)
    expect(await forecast()).toMatchObject({
      fetchedAt: new Date(NOW.getTime() + 61 * 60_000).toISOString(),
      stale: false,
    })
  })

  test('a failed refresh keeps the old hours and waits out the back-off', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    let calls = 0
    let down = false
    ctx.fetch = fakeFetch({
      [`GET ${FORECAST}`]: (req) => {
        calls += 1
        return down ? new Response('no', { status: 503 }) : forecastRoute([])(req)
      },
    })
    await setHome()
    await forecast()

    down = true
    atMinutes(61)
    await forecast()
    await settleWeatherCache()
    expect(calls).toBe(2)

    // Inside the 15 minutes the stale hours are served and nobody asks again.
    atMinutes(70)
    const view = await forecast()
    await settleWeatherCache()
    expect(view).toMatchObject({ fetchedAt: NOW.toISOString(), stale: true })
    expect(view.hours).toHaveLength(168)
    expect(calls).toBe(2)

    down = false
    atMinutes(77)
    await forecast()
    await settleWeatherCache()
    expect(calls).toBe(3)
  })

  test('answers 502 when an empty cache cannot be filled', async () => {
    ctx.fetch = fakeFetch({ [`GET ${FORECAST}`]: () => new Response('no', { status: 500 }) })
    await setHome()
    const res = await client(ctx, user).get('/api/weather/forecast').expect(502)
    expect(JSON.stringify(res.body)).toMatch(/Open-Meteo/)
  })
})
