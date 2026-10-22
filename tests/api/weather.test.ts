import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { enrichWeather, getForecast, resetForecastCache } from '../../server/services/weather.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

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
  resetForecastCache()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
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

  test('falls back to the home location when the profile allows it', async () => {
    const calls: URL[] = []
    const fetchFn = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    await ctx.prisma.athleteProfile.create({
      data: { userId: user.id, homeLat: 51.5, homeLng: -0.12, useHomeWeather: true },
    })
    const run = await addActivity({ date: '2026-03-02', startUtc: '2026-03-02T07:00:00Z' })

    expect(await enrichWeather(ctx, user.id, { limit: 10, fetch: fetchFn, now: NOW })).toBe(1)

    expect(calls[0]!.searchParams.get('latitude')).toBe('51.5')
    expect(calls[0]!.searchParams.get('longitude')).toBe('-0.1')
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })
    expect(row.weatherSource).toBe('open-meteo')
  })

  test('skips activities without a location when home weather is off or there is no home', async () => {
    const calls: URL[] = []
    const fetchFn = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    await addActivity({ date: '2026-03-02', startUtc: '2026-03-02T07:00:00Z' })

    expect(await enrichWeather(ctx, user.id, { limit: 10, fetch: fetchFn, now: NOW })).toBe(0)

    await ctx.prisma.athleteProfile.create({
      data: { userId: user.id, homeLat: 51.5, homeLng: -0.12, useHomeWeather: false },
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

describe('getForecast', () => {
  async function setHome() {
    await ctx.prisma.athleteProfile.create({
      data: { userId: user.id, homeLat: 51.5, homeLng: -0.12 },
    })
  }

  test('is null without a home location', async () => {
    const fetchFn = fakeFetch({})
    expect(await getForecast(ctx, user.id, fetchFn)).toBeNull()
  })

  test('returns seven days of hours at home', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const calls: URL[] = []
    const fetchFn = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls) })
    await setHome()

    const forecast = await getForecast(ctx, user.id, fetchFn)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.searchParams.get('latitude')).toBe('51.5')
    expect(calls[0]!.searchParams.get('longitude')).toBe('-0.1')
    expect(calls[0]!.searchParams.get('forecast_days')).toBe('7')
    expect(calls[0]!.searchParams.get('past_days')).toBeNull()
    expect(forecast!.hours).toHaveLength(168)
    expect(forecast!.hours[0]).toEqual({
      time: '2026-03-20T00:00:00Z',
      tempC: 0,
      dewPointC: -5,
      humidityPct: 50,
      windKph: 0,
    })
    expect(forecast!.hours[13]).toMatchObject({ time: '2026-03-20T13:00:00Z', tempC: 13 })
  })

  test('caches for one hour per user and place', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const calls: URL[] = []
    const fetchFn = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls) })
    await setHome()

    await getForecast(ctx, user.id, fetchFn)
    vi.setSystemTime(new Date(NOW.getTime() + 59 * 60_000))
    await getForecast(ctx, user.id, fetchFn)
    expect(calls).toHaveLength(1)

    vi.setSystemTime(new Date(NOW.getTime() + 61 * 60_000))
    await getForecast(ctx, user.id, fetchFn)
    expect(calls).toHaveLength(2)

    await ctx.prisma.athleteProfile.update({
      where: { userId: user.id },
      data: { homeLat: 52.5 },
    })
    await getForecast(ctx, user.id, fetchFn)
    expect(calls).toHaveLength(3)
  })

  test('turns a failed request into an error', async () => {
    const fetchFn = fakeFetch({ [`GET ${FORECAST}`]: () => new Response('no', { status: 503 }) })
    await setHome()
    await expect(getForecast(ctx, user.id, fetchFn)).rejects.toThrow(/Open-Meteo/)
  })
})

describe('GET /api/weather/forecast', () => {
  test('requires a session', async () => {
    await client(ctx).get('/api/weather/forecast').expect(401)
  })

  test('answers 404 without a home location', async () => {
    await client(ctx, user).get('/api/weather/forecast').expect(404)
  })

  test('returns the hours at home', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.stubGlobal('fetch', fakeFetch({ [`GET ${FORECAST}`]: forecastRoute([]) }))
    await ctx.prisma.athleteProfile.create({
      data: { userId: user.id, homeLat: 51.5, homeLng: -0.12 },
    })

    const res = await client(ctx, user).get('/api/weather/forecast').expect(200)

    const { hours } = res.body as { hours: unknown[] }
    expect(hours).toHaveLength(168)
    expect(hours[0]).toMatchObject({ time: '2026-03-20T00:00:00Z', tempC: 0 })
  })

  test('answers 502 when the weather service fails', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch({ [`GET ${FORECAST}`]: () => new Response('no', { status: 500 }) }),
    )
    await ctx.prisma.athleteProfile.create({
      data: { userId: user.id, homeLat: 51.5, homeLng: -0.12 },
    })
    await client(ctx, user).get('/api/weather/forecast').expect(502)
  })
})
