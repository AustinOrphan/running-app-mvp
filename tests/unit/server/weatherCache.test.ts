import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, inject, test, vi } from 'vitest'
import { weatherIndex } from '../../../shared/engine/heat.ts'
import type { Deps } from '../../../server/app.ts'
import type { Config } from '../../../server/config.ts'
import { dataVersionKey } from '../../../server/dataVersion.ts'
import { createPrisma, initSqlite, type PrismaClient } from '../../../server/db.ts'
import { HttpError } from '../../../server/errors.ts'
import {
  BACKOFF_MS,
  cachedForecast,
  CLIMATE_REFRESH_MS,
  climateKeyFor,
  type ClimateGoal,
  ensureClimate,
  fetchOf,
  FORECAST_REFRESH_MS,
  FORECAST_USABLE_MS,
  forecastCellOf,
  forecastStamp,
  getForecastView,
  NO_FORECAST,
  readClimate,
  refreshWeatherCaches,
  settleWeatherCache,
  warmWeatherCaches,
} from '../../../server/services/weatherCache.ts'
import { fakeFetch, type FakeRoute } from '../../fakeFetch.ts'

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const MINUTE = 60_000
// A Friday, local noon; the race below is on 2027-06-12.
const NOW = new Date(2026, 9, 23, 12)
const later = (ms: number): Date => new Date(NOW.getTime() + ms)

let dir: string
let prisma: PrismaClient
let deps: Deps

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rl-weather-cache-'))
  const file = join(dir, 'test.db')
  copyFileSync(inject('templateDbPath'), file)
  prisma = createPrisma(`file:${file}`)
  await initSqlite(prisma)
  const config: Config = {
    databaseUrl: `file:${file}`,
    sessionSecret: 'test-only-session-secret-0123456789abcdef',
    port: 0,
    nodeEnv: 'test',
    allowRegistration: false,
    logLevel: 'silent',
  }
  deps = { prisma, config, fetch: fakeFetch({}) }
})

afterEach(async () => {
  vi.useRealTimers()
  await settleWeatherCache()
  await prisma.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

async function seedUser(home: { lat: number; lng: number; use?: boolean } | null = null) {
  const user = await prisma.user.create({
    data: { email: `runner-${Math.random().toString(36).slice(2)}@example.com`, passwordHash: 'x' },
  })
  if (home) {
    await prisma.athleteProfile.create({
      data: {
        userId: user.id,
        homeLat: home.lat,
        homeLng: home.lng,
        useHomeWeather: home.use ?? true,
      },
    })
  }
  return user
}

function seedGoal(userId: string, over: Record<string, unknown> = {}) {
  return prisma.goal.create({
    data: {
      userId,
      name: 'Synthetic half',
      priority: 'A',
      status: 'target',
      targetDate: '2027-06-12',
      distanceM: 21_097,
      goalType: 'time',
      targetTimeSec: 7200,
      startTime: '07:00',
      raceLat: 40.12,
      raceLng: -105.234,
      ...over,
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Synthetic Open-Meteo answers
// ---------------------------------------------------------------------------------------------

function dayHours(date: string): string[] {
  return Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`)
}

/** Every hour of each date from `start` to `end`. */
function hoursBetween(start: string, end: string): string[] {
  const times: string[] = []
  for (
    let ms = Date.parse(`${start}T00:00:00Z`);
    ms <= Date.parse(`${end}T00:00:00Z`);
    ms += 864e5
  ) {
    times.push(...dayHours(new Date(ms).toISOString().slice(0, 10)))
  }
  return times
}

const hourOf = (time: string): number => Number(time.slice(11, 13))
/** The archive's values follow the hour of day, so a test can tell which hours were averaged. */
const archiveHour = (hour: number) => ({
  tempC: 20 + hour,
  humidityPct: 50,
  windKph: 6,
  shortwaveWm2: hour * 30,
})

function archiveRoute(calls: URL[], status = 200): FakeRoute {
  return (req) => {
    const url = new URL(req.url)
    calls.push(url)
    if (status !== 200) return new Response('no', { status })
    const times = hoursBetween(
      url.searchParams.get('start_date')!,
      url.searchParams.get('end_date')!,
    )
    return Response.json({
      hourly: {
        time: times,
        temperature_2m: times.map((t) => archiveHour(hourOf(t)).tempC),
        relative_humidity_2m: times.map((t) => archiveHour(hourOf(t)).humidityPct),
        wind_speed_10m: times.map((t) => archiveHour(hourOf(t)).windKph),
        shortwave_radiation: times.map((t) => archiveHour(hourOf(t)).shortwaveWm2),
      },
    })
  }
}

function forecastRoute(calls: URL[], status = 200): FakeRoute {
  return (req) => {
    calls.push(new URL(req.url))
    if (status !== 200) return new Response('no', { status })
    const times = hoursBetween('2026-10-23', '2026-10-29')
    return Response.json({
      hourly: {
        time: times,
        temperature_2m: times.map((t) => hourOf(t)),
        relative_humidity_2m: times.map(() => 60),
        dew_point_2m: times.map(() => 8),
        wind_speed_10m: times.map(() => 10),
      },
    })
  }
}

/** The mean WBGT the climate row should hold for hours `from` to `to` (exclusive) of the day. */
function expectedWbgt(from: number, to: number): number {
  const values: number[] = []
  for (let hour = from; hour < to; hour++) values.push(weatherIndex(archiveHour(hour)).value)
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
}

// ---------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------

describe('cells and keys', () => {
  test('the home cell is integer tenths of a degree, with no negative zero', () => {
    expect(forecastCellOf(20.5, -30.12)).toEqual({ latE1: 205, lngE1: -301 })
    expect(forecastCellOf(-0.04, 0.04)).toEqual({ latE1: 0, lngE1: 0 })
    expect(Object.is(forecastCellOf(-0.04, 0).latE1, 0)).toBe(true)
  })

  const race: ClimateGoal = {
    targetDate: '2027-06-12',
    startTime: '07:30',
    targetTimeSec: 7200,
    distanceM: 21_097,
    raceLat: 40.126,
    raceLng: -105.234,
  }
  const noHome = { lat: null, lng: null, use: true }

  test('the race cell is integer hundredths, with the month and day and the clock window', () => {
    expect(climateKeyFor(race, noHome)).toEqual({
      latE2: 4013,
      lngE2: -10523,
      monthDay: '06-12',
      startHour: 7,
      windowHours: 2,
    })
  })

  test('the window follows the target time, else a rough pace over the distance, in 1 to 12 hours', () => {
    const windowOf = (over: Partial<typeof race>) =>
      climateKeyFor({ ...race, ...over }, noHome)?.windowHours
    expect(windowOf({ targetTimeSec: 90 * 60 })).toBe(2)
    expect(windowOf({ targetTimeSec: 60 })).toBe(1)
    expect(windowOf({ targetTimeSec: null, distanceM: 42_195 })).toBe(5)
    expect(windowOf({ targetTimeSec: null, distanceM: 160_934 })).toBe(12)
    expect(climateKeyFor({ ...race, startTime: null }, noHome)?.startHour).toBe(8)
  })

  test('a race without a place uses home only when the profile allows it', () => {
    const open = { ...race, raceLat: null, raceLng: null }
    expect(climateKeyFor(open, noHome)).toBeNull()
    expect(climateKeyFor(open, { lat: 10, lng: 20, use: false })).toBeNull()
    expect(climateKeyFor(open, { lat: 10.004, lng: 20, use: true })).toMatchObject({
      latE2: 1000,
      lngE2: 2000,
    })
    // The race's own coordinates win over home.
    expect(climateKeyFor(race, { lat: 10, lng: 20, use: true })?.latE2).toBe(4013)
  })
})

// ---------------------------------------------------------------------------------------------
// The forecast
// ---------------------------------------------------------------------------------------------

describe('the home forecast', () => {
  test('is fetched for the 0.1 degree home cell and stored with its fetch time', async () => {
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls) })

    const outcome = await refreshWeatherCaches(deps, user.id, { now: NOW })

    expect(outcome).toEqual({ refreshed: 1, failed: 0, error: null })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.searchParams.get('latitude')).toBe('20.5')
    expect(calls[0]!.searchParams.get('longitude')).toBe('-30.1')
    const row = await prisma.forecastCache.findFirstOrThrow()
    expect(row).toMatchObject({ latE1: 205, lngE1: -301, fetchedAt: NOW, failedAt: null })
    expect(JSON.parse(row.hours)).toHaveLength(168)
  })

  test('is read again only after 60 minutes', async () => {
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })

    await refreshWeatherCaches(deps, user.id, { now: later(FORECAST_REFRESH_MS - MINUTE) })
    expect(calls).toHaveLength(1)
    await refreshWeatherCaches(deps, user.id, { now: later(FORECAST_REFRESH_MS) })
    expect(calls).toHaveLength(2)
  })

  test('two users at one cell share a row and a request', async () => {
    const first = await seedUser({ lat: 20.5, lng: -30.12 })
    const second = await seedUser({ lat: 20.54, lng: -30.08 })
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls) })

    await refreshWeatherCaches(deps, first.id, { now: NOW })
    await refreshWeatherCaches(deps, second.id, { now: NOW })

    expect(calls).toHaveLength(1)
    expect(await prisma.forecastCache.count()).toBe(1)
  })

  test('concurrent refreshes of one cell make one request', async () => {
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    const calls: URL[] = []
    const slow = forecastRoute(calls)
    deps.fetch = fakeFetch({
      [`GET ${FORECAST}`]: async (req) => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return slow(req)
      },
    })

    await Promise.all([
      refreshWeatherCaches(deps, user.id, { now: NOW }),
      refreshWeatherCaches(deps, user.id, { now: NOW }),
    ])

    expect(calls).toHaveLength(1)
  })

  test('a failure keeps the old hours, is reported, and waits out the back-off', async () => {
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })
    const before = await prisma.forecastCache.findFirstOrThrow()

    const down = later(FORECAST_REFRESH_MS)
    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls, 503) })
    const failed = await refreshWeatherCaches(deps, user.id, { now: down })
    expect(failed).toMatchObject({ refreshed: 0, failed: 1 })
    expect(failed.error).toBeInstanceOf(Error)
    const kept = await prisma.forecastCache.findFirstOrThrow()
    expect(kept).toMatchObject({ hours: before.hours, fetchedAt: NOW, failedAt: down })
    expect(kept.lastError).toMatch(/HTTP 503/)
    expect(calls).toHaveLength(2)

    // Inside the back-off nothing is asked, yet the run still reports the stale cell as failed.
    const held = await refreshWeatherCaches(deps, user.id, {
      now: later(FORECAST_REFRESH_MS + 14 * MINUTE),
    })
    expect(held).toMatchObject({ refreshed: 0, failed: 1, error: kept.lastError })
    expect(calls).toHaveLength(2)

    // After it the cell is asked again, and success clears the failure.
    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls) })
    const retry = later(FORECAST_REFRESH_MS + BACKOFF_MS)
    expect(await refreshWeatherCaches(deps, user.id, { now: retry })).toMatchObject({
      refreshed: 1,
      failed: 0,
    })
    expect(await prisma.forecastCache.findFirstOrThrow()).toMatchObject({
      fetchedAt: retry,
      failedAt: null,
      lastError: null,
    })
  })

  test('a first failure leaves an empty row with no fetch time', async () => {
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute([], 500) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })
    expect(await prisma.forecastCache.findFirstOrThrow()).toMatchObject({
      hours: '[]',
      fetchedAt: null,
      failedAt: NOW,
    })
    expect(await cachedForecast(prisma, user.id, NOW)).toBeNull()
  })

  test('is not fetched without a home', async () => {
    const user = await seedUser()
    expect(await refreshWeatherCaches(deps, user.id, { now: NOW })).toEqual({
      refreshed: 0,
      failed: 0,
      error: null,
    })
    expect(await prisma.forecastCache.count()).toBe(0)
  })

  test('the engine ignores a forecast older than 24 hours', async () => {
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute([]) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })

    expect((await cachedForecast(prisma, user.id, NOW))?.hours).toHaveLength(168)
    expect(await cachedForecast(prisma, user.id, later(FORECAST_USABLE_MS))).not.toBeNull()
    expect(await cachedForecast(prisma, user.id, later(FORECAST_USABLE_MS + 1))).toBeNull()
  })

  test('a caller that holds the profile passes its home and the profile is not read again', async () => {
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute([]) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })

    const profileRead = vi.spyOn(prisma.athleteProfile, 'findUnique')
    const home = { homeLat: 20.5, homeLng: -30.12 }
    expect((await cachedForecast(prisma, user.id, NOW, home))?.hours).toHaveLength(168)
    // Another cell holds nothing, and a profile without a home has no forecast at all.
    expect(await cachedForecast(prisma, user.id, NOW, { homeLat: 41, homeLng: 2 })).toBeNull()
    expect(await cachedForecast(prisma, user.id, NOW, { homeLat: null, homeLng: null })).toBeNull()
    expect(profileRead).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------------------------
// forecastStamp and the data version
// ---------------------------------------------------------------------------------------------

describe('forecastStamp', () => {
  test('is the fetch time of the home cell, and none without a usable forecast', async () => {
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    const nobody = await seedUser()
    expect(await forecastStamp(prisma, user.id, NOW)).toBe(NO_FORECAST)
    expect(await forecastStamp(prisma, nobody.id, NOW)).toBe(NO_FORECAST)

    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute([]) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })
    expect(await forecastStamp(prisma, user.id, NOW)).toBe(NOW.toISOString())
    expect(await forecastStamp(prisma, nobody.id, NOW)).toBe(NO_FORECAST)

    // A refresh moves the stamp; a forecast the engine no longer uses is none again.
    const next = later(FORECAST_REFRESH_MS)
    await refreshWeatherCaches(deps, user.id, { now: next })
    expect(await forecastStamp(prisma, user.id, next)).toBe(next.toISOString())
    expect(
      await forecastStamp(prisma, user.id, later(FORECAST_REFRESH_MS + FORECAST_USABLE_MS + 1)),
    ).toBe(NO_FORECAST)
  })

  test('a forecast refresh leaves the data version alone', async () => {
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute([]) })
    const before = await dataVersionKey(prisma)

    await refreshWeatherCaches(deps, user.id, { now: NOW })

    expect(await prisma.forecastCache.count()).toBe(1)
    expect(await dataVersionKey(prisma)).toEqual(before)
  })

  test('a climate refresh moves the data version, so a memoised prediction is dropped', async () => {
    const user = await seedUser()
    await seedGoal(user.id)
    deps.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute([]) })
    const before = await dataVersionKey(prisma)

    await refreshWeatherCaches(deps, user.id, { now: NOW })

    expect(await prisma.climateCache.count()).toBe(1)
    expect((await dataVersionKey(prisma)).n).toBeGreaterThan(before.n)
  })
})

// ---------------------------------------------------------------------------------------------
// Race climate
// ---------------------------------------------------------------------------------------------

describe('the race climate', () => {
  test('averages the race window over the last three archive years', async () => {
    const user = await seedUser()
    const goal = await seedGoal(user.id)
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })

    const outcome = await refreshWeatherCaches(deps, user.id, { now: NOW })

    expect(outcome).toEqual({ refreshed: 1, failed: 0, error: null })
    // 2026-06-12 is already in the archive on 2026-10-23, so the years are 2026, 2025 and 2024.
    expect(
      calls.map((url) => [url.searchParams.get('start_date'), url.searchParams.get('end_date')]),
    ).toEqual([
      ['2026-06-11', '2026-06-13'],
      ['2025-06-11', '2025-06-13'],
      ['2024-06-11', '2024-06-13'],
    ])
    expect(calls[0]!.searchParams.get('latitude')).toBe('40.12')
    expect(calls[0]!.searchParams.get('longitude')).toBe('-105.23')
    expect(calls[0]!.searchParams.get('timezone')).toBe('auto')

    const row = await prisma.climateCache.findFirstOrThrow()
    expect(row).toMatchObject({
      latE2: 4012,
      lngE2: -10523,
      monthDay: '06-12',
      startHour: 7,
      windowHours: 2,
      samples: 3 * 3 * 2,
      yearsRead: 3,
      complete: true,
      fetchedAt: NOW,
      failedAt: null,
    })
    // Only the 07:00 and 08:00 hours count.
    expect(row.wbgtC).toBe(expectedWbgt(7, 9))
    expect(await readClimate(prisma, goal, { lat: null, lng: null, use: false })).toEqual({
      wbgtC: expectedWbgt(7, 9),
      source: 'climatology',
    })
  })

  test('counts back from today, so a race later this year still has three years', async () => {
    const user = await seedUser()
    await seedGoal(user.id, { targetDate: '2026-12-05' })
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })
    expect(calls.map((url) => url.searchParams.get('start_date'))).toEqual([
      '2025-12-04',
      '2024-12-04',
      '2023-12-04',
    ])
  })

  test('a 29 February race reads 28 February in a year that has none', async () => {
    const user = await seedUser()
    await seedGoal(user.id, { targetDate: '2028-02-29' })
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })
    expect(calls.map((url) => url.searchParams.get('end_date'))).toEqual([
      '2026-03-01',
      '2025-03-01',
      '2024-03-01',
    ])
  })

  test('is read again after 30 days, not before', async () => {
    const user = await seedUser()
    await seedGoal(user.id)
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })
    expect(calls).toHaveLength(3)

    await refreshWeatherCaches(deps, user.id, { now: later(CLIMATE_REFRESH_MS - MINUTE) })
    expect(calls).toHaveLength(3)
    await refreshWeatherCaches(deps, user.id, { now: later(CLIMATE_REFRESH_MS) })
    expect(calls).toHaveLength(6)
  })

  test('goals that share a place, date and window share a row and one set of requests', async () => {
    const user = await seedUser()
    await seedGoal(user.id, { name: 'First' })
    await seedGoal(user.id, { name: 'Second' })
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })
    expect(calls).toHaveLength(3)
    expect(await prisma.climateCache.count()).toBe(1)
  })

  test('only open future goals with a distance and a place are read', async () => {
    const user = await seedUser({ lat: 10, lng: 20, use: false })
    await seedGoal(user.id, { name: 'Done', status: 'done' })
    await seedGoal(user.id, { name: 'Dropped', status: 'dropped' })
    await seedGoal(user.id, { name: 'Past', targetDate: '2026-10-22' })
    await seedGoal(user.id, { name: 'No distance', distanceM: null })
    await seedGoal(user.id, { name: 'No place', raceLat: null, raceLng: null })
    const calls: URL[] = []
    deps.fetch = fakeFetch({
      [`GET ${ARCHIVE}`]: archiveRoute(calls),
      [`GET ${FORECAST}`]: forecastRoute(calls),
    })

    await refreshWeatherCaches(deps, user.id, { now: NOW })

    expect(calls.filter((url) => url.href.startsWith(ARCHIVE))).toHaveLength(0)
    expect(await prisma.climateCache.count()).toBe(0)
  })

  test('a race without a place uses the home cell when the profile allows it', async () => {
    const user = await seedUser({ lat: 10.123, lng: 20.456, use: true })
    await seedGoal(user.id, { raceLat: null, raceLng: null })
    const calls: URL[] = []
    deps.fetch = fakeFetch({
      [`GET ${ARCHIVE}`]: archiveRoute(calls),
      [`GET ${FORECAST}`]: forecastRoute(calls),
    })
    await refreshWeatherCaches(deps, user.id, { now: NOW })
    const archive = calls.filter((url) => url.href.startsWith(ARCHIVE))
    expect(archive[0]!.searchParams.get('latitude')).toBe('10.12')
    expect(archive[0]!.searchParams.get('longitude')).toBe('20.46')
  })

  test('a year that fails leaves an incomplete row that is retried after the back-off', async () => {
    const user = await seedUser()
    await seedGoal(user.id)
    const calls: URL[] = []
    let failYear: string | null = '2025'
    const route = archiveRoute(calls)
    deps.fetch = fakeFetch({
      [`GET ${ARCHIVE}`]: (req) => {
        if (!failYear || !new URL(req.url).searchParams.get('start_date')!.startsWith(failYear)) {
          return route(req)
        }
        calls.push(new URL(req.url))
        return new Response('busy', { status: 503 })
      },
    })

    const first = await refreshWeatherCaches(deps, user.id, { now: NOW })
    expect(first).toMatchObject({ refreshed: 0, failed: 1 })
    // Nothing better is stored, so the two years that answered stand for now.
    expect(await prisma.climateCache.findFirstOrThrow()).toMatchObject({
      yearsRead: 2,
      samples: 2 * 3 * 2,
      complete: false,
      failedAt: NOW,
      wbgtC: expectedWbgt(7, 9),
    })
    expect(calls).toHaveLength(3)

    // Held by the back-off: no request, still reported.
    const held = await refreshWeatherCaches(deps, user.id, { now: later(BACKOFF_MS - MINUTE) })
    expect(held).toMatchObject({ refreshed: 0, failed: 1 })
    expect(calls).toHaveLength(3)

    failYear = null
    const retry = later(BACKOFF_MS)
    expect(await refreshWeatherCaches(deps, user.id, { now: retry })).toMatchObject({
      refreshed: 1,
      failed: 0,
    })
    expect(await prisma.climateCache.findFirstOrThrow()).toMatchObject({
      yearsRead: 3,
      complete: true,
      fetchedAt: retry,
      failedAt: null,
      lastError: null,
    })
  })

  test('a failed read keeps an earlier complete value', async () => {
    const user = await seedUser()
    await seedGoal(user.id)
    deps.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute([]) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })
    const stored = await prisma.climateCache.findFirstOrThrow()

    // Two of three years answer on the refresh 30 days on: the better, older value stays.
    const route = archiveRoute([])
    deps.fetch = fakeFetch({
      [`GET ${ARCHIVE}`]: (req) =>
        new URL(req.url).searchParams.get('start_date')!.startsWith('2024')
          ? new Response('busy', { status: 500 })
          : route(req),
    })
    const due = later(CLIMATE_REFRESH_MS)
    expect(await refreshWeatherCaches(deps, user.id, { now: due })).toMatchObject({ failed: 1 })
    expect(await prisma.climateCache.findFirstOrThrow()).toMatchObject({
      wbgtC: stored.wbgtC,
      yearsRead: 3,
      complete: true,
      fetchedAt: NOW,
      failedAt: due,
    })
  })

  test('a first read that fails entirely stores no value and reads as no climate', async () => {
    const user = await seedUser()
    const goal = await seedGoal(user.id)
    deps.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute([], 503) })
    await refreshWeatherCaches(deps, user.id, { now: NOW })
    expect(await prisma.climateCache.findFirstOrThrow()).toMatchObject({
      wbgtC: null,
      yearsRead: 0,
      complete: false,
      fetchedAt: null,
      failedAt: NOW,
    })
    expect(await readClimate(prisma, goal, { lat: null, lng: null, use: false })).toBeNull()
  })

  test('hours without a temperature are skipped and no hours at all gives a complete empty row', async () => {
    const user = await seedUser()
    await seedGoal(user.id)
    deps.fetch = fakeFetch({
      [`GET ${ARCHIVE}`]: () =>
        Response.json({
          hourly: {
            time: ['2025-06-12T07:00', '2025-06-12T08:00'],
            temperature_2m: [null, null],
          },
        }),
    })
    await refreshWeatherCaches(deps, user.id, { now: NOW })
    expect(await prisma.climateCache.findFirstOrThrow()).toMatchObject({
      wbgtC: null,
      samples: 0,
      yearsRead: 3,
      complete: true,
    })
  })
})

// ---------------------------------------------------------------------------------------------
// Waits
// ---------------------------------------------------------------------------------------------

describe('ensureClimate', () => {
  test('fills a cold cache before it returns', async () => {
    const user = await seedUser()
    const goal = await seedGoal(user.id)
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls) })

    await ensureClimate(deps, { userId: user.id, goalId: goal.id, now: NOW })

    expect(calls).toHaveLength(3)
    expect((await readClimate(prisma, goal, { lat: null, lng: null, use: false }))?.wbgtC).toBe(
      expectedWbgt(7, 9),
    )
    // A warm cache is left alone.
    await ensureClimate(deps, { userId: user.id, goalId: goal.id, now: NOW })
    expect(calls).toHaveLength(3)
  })

  test('waits at most the given time, and the read carries on and fills the cache', async () => {
    const user = await seedUser()
    const goal = await seedGoal(user.id)
    const route = archiveRoute([])
    deps.fetch = fakeFetch({
      [`GET ${ARCHIVE}`]: async (req) => {
        await new Promise((resolve) => setTimeout(resolve, 60))
        return route(req)
      },
    })

    const started = Date.now()
    await ensureClimate(deps, { userId: user.id, goalId: goal.id, now: NOW, waitMs: 20 })
    expect(Date.now() - started).toBeLessThan(150)
    expect(await prisma.climateCache.count()).toBe(0)

    await settleWeatherCache()
    expect((await prisma.climateCache.findFirstOrThrow()).complete).toBe(true)
  })

  test('never throws, and leaves a failed cell alone until the back-off ends', async () => {
    const user = await seedUser()
    const goal = await seedGoal(user.id)
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${ARCHIVE}`]: archiveRoute(calls, 503) })

    await expect(
      ensureClimate(deps, { userId: user.id, goalId: goal.id, now: NOW }),
    ).resolves.toBeUndefined()
    expect(calls).toHaveLength(3)
    await ensureClimate(deps, { userId: user.id, goalId: goal.id, now: later(MINUTE) })
    expect(calls).toHaveLength(3)
    await ensureClimate(deps, { userId: user.id, goalId: goal.id, now: later(BACKOFF_MS) })
    expect(calls).toHaveLength(6)
  })

  test('does nothing for an unknown goal, another users goal or a goal without a place', async () => {
    const user = await seedUser()
    const other = await seedUser()
    const foreign = await seedGoal(other.id)
    const open = await seedGoal(user.id, { raceLat: null, raceLng: null })
    deps.fetch = fakeFetch({})
    for (const goalId of ['no-such-goal', foreign.id, open.id]) {
      await ensureClimate(deps, { userId: user.id, goalId, now: NOW })
    }
    expect(await prisma.climateCache.count()).toBe(0)
  })
})

describe('getForecastView', () => {
  test('is null without a home', async () => {
    const user = await seedUser()
    expect(await getForecastView(deps, user.id, { now: NOW })).toBeNull()
  })

  test('answers 502 when the first fetch is late, and the fetch carries on and fills the cell', async () => {
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    const route = forecastRoute([])
    deps.fetch = fakeFetch({
      [`GET ${FORECAST}`]: async (req) => {
        await new Promise((resolve) => setTimeout(resolve, 60))
        return route(req)
      },
    })

    const late = getForecastView(deps, user.id, { now: NOW, waitMs: 20 })
    await expect(late).rejects.toBeInstanceOf(HttpError)
    await expect(late).rejects.toMatchObject({ status: 502 })

    await settleWeatherCache()
    expect(await getForecastView(deps, user.id, { now: NOW })).toMatchObject({
      fetchedAt: NOW.toISOString(),
      stale: false,
    })
  })

  test('an empty cell inside the back-off answers 502 without asking again', async () => {
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    const calls: URL[] = []
    deps.fetch = fakeFetch({ [`GET ${FORECAST}`]: forecastRoute(calls, 503) })
    await expect(getForecastView(deps, user.id, { now: NOW })).rejects.toMatchObject({
      status: 502,
    })
    await expect(getForecastView(deps, user.id, { now: later(MINUTE) })).rejects.toMatchObject({
      status: 502,
    })
    expect(calls).toHaveLength(1)
    await expect(getForecastView(deps, user.id, { now: later(BACKOFF_MS) })).rejects.toMatchObject({
      status: 502,
    })
    expect(calls).toHaveLength(2)
  })
})

describe('warmWeatherCaches', () => {
  test('fills the cells in the background and never throws', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const user = await seedUser({ lat: 20.5, lng: -30.12 })
    await seedGoal(user.id)
    const calls: URL[] = []
    deps.fetch = fakeFetch({
      [`GET ${FORECAST}`]: forecastRoute(calls),
      [`GET ${ARCHIVE}`]: archiveRoute(calls, 503),
    })

    warmWeatherCaches(deps, user.id)
    await settleWeatherCache()

    expect(await prisma.forecastCache.count()).toBe(1)
    expect(await prisma.climateCache.count()).toBe(1)
    expect((await prisma.climateCache.findFirstOrThrow()).complete).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// Who talks to Open-Meteo
// ---------------------------------------------------------------------------------------------

describe('the injected fetch', () => {
  test('is read from the deps at each call, else the global is looked up when the request is made', async () => {
    const seen: string[] = []
    const make = (label: string): typeof fetch => {
      return () => {
        seen.push(label)
        return Promise.resolve(new Response('{}'))
      }
    }
    const holder: Pick<Deps, 'fetch'> = {}

    // Without an injected one, the wrapper calls whatever the global is at that moment.
    const wrapper = fetchOf(holder)
    vi.stubGlobal('fetch', make('global one'))
    await wrapper('https://example.com/a')
    vi.stubGlobal('fetch', make('global two'))
    await wrapper('https://example.com/b')

    // An injected one is picked up by the next call that asks the deps, and replaced the same way.
    holder.fetch = make('injected one')
    await fetchOf(holder)('https://example.com/c')
    holder.fetch = make('injected two')
    await fetchOf(holder)('https://example.com/d')
    vi.unstubAllGlobals()

    expect(seen).toEqual(['global one', 'global two', 'injected one', 'injected two'])
  })
})

describe('who talks to Open-Meteo', () => {
  const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
  const sources = readdirSync(join(ROOT, 'server'), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts'))
    .map((path) => ({
      path: join('server', path),
      text: readFileSync(join(ROOT, 'server', path), 'utf8'),
    }))
  const named = (pattern: RegExp) =>
    sources
      .filter((source) => pattern.test(source.text))
      .map((source) => source.path)
      .sort()

  test('only the client, the cache and the weather job reach for the service', () => {
    expect(named(/open-meteo|openMeteo/)).toEqual([
      'server/providers/openMeteo.ts',
      // The job's activity backfill; no request handler imports it.
      'server/services/weather.ts',
      'server/services/weatherCache.ts',
    ])
    for (const route of sources.filter((source) => source.path.startsWith('server/routes/'))) {
      expect(route.text, route.path).not.toMatch(/providers\/openMeteo|services\/weather\.ts/)
    }
  })

  test('the global fetch is looked up in three places only, each at the moment of the call', () => {
    expect(named(/(^|[^.\w])fetch\(/m)).toEqual([
      'server/index.ts',
      'server/services/sync.ts',
      'server/services/weatherCache.ts',
    ])
  })

  test('engine input has no fetch, archive address, in-memory cache or reset function', () => {
    const engineInput = sources.find((source) => source.path === 'server/services/engineInput.ts')
    expect(engineInput).toBeDefined()
    expect(engineInput!.text).not.toMatch(/fetch|archive-api|new Map|reset\w*Cache/i)
    expect(sources.some((source) => source.path.endsWith('raceClimate.ts'))).toBe(false)
  })
})
