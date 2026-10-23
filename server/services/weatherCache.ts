// The Open-Meteo cache (ADR 0009, phase 3a design 5.3 and 5.8). The weather job fills two tables,
// `ForecastCache` (the 7-day hourly forecast at home) and `ClimateCache` (race-window WBGT
// climatology), and everything else reads them: engine input, predictions, zones, Today and plan
// generation never wait on Open-Meteo. The waits that remain are the ones the runner asked for: the
// forecast route when its cell is empty (5 s) and plan generation on a cold race climate (8 s).
// Every request goes through the injected `fetch` (`Deps.fetch`, else the global one, looked up at
// each call), so a test hands in synthetic responses and none touches the network.
import { addDays, todayIso } from '../../shared/dates.ts'
import { weatherIndex } from '../../shared/engine/heat.ts'
import type { ForecastView } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { PrismaClient } from '../db.ts'
import { HttpError } from '../errors.ts'
import {
  fetchClimateHours,
  fetchForecast,
  type ClimateHour,
  type WeatherHour,
} from '../providers/openMeteo.ts'
import { safeMessage } from './syncLog.ts'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** A forecast this old is stale: the route says so and refreshes it in the background. */
export const FORECAST_REFRESH_MS = 60 * MINUTE_MS
/** The engine treats a forecast older than this as absent, so a long outage never advises on it. */
export const FORECAST_USABLE_MS = 24 * HOUR_MS
/** A climate row is read again after this long, or at once when it is incomplete. */
export const CLIMATE_REFRESH_MS = 30 * DAY_MS
/** After a failed attempt a cell is not asked again for this long; its old data stays in use. */
export const BACKOFF_MS = 15 * MINUTE_MS
/** The forecast route waits this long for a cell that has never been filled, then answers 502. */
export const FORECAST_WAIT_MS = 5_000
/** Plan generation waits this long for a race climate that is not cached yet. */
export const CLIMATE_WAIT_MS = 8_000
/** What `forecastStamp` is while no usable forecast exists. */
export const NO_FORECAST = 'none'

const FORECAST_DAYS = 7
const CLIMATE_YEARS = 3
/** Days around the race date that the climatology averages over. */
const CLIMATE_SPREAD_DAYS = 1
/** The archive trails real time by a few days. */
const ARCHIVE_LAG_DAYS = 6
/** The first year Open-Meteo's archive covers; the search for past years stops here. */
const ARCHIVE_FIRST_YEAR = 1940
const DEFAULT_START_HOUR = 8
const MAX_WINDOW_HOURS = 12
/** A rough 6 min/km, used only to size the climatology window when the goal has no time target. */
const ROUGH_SEC_PER_M = 0.36

// ---------------------------------------------------------------------------------------------
// Cells and keys
// ---------------------------------------------------------------------------------------------

/** A home forecast cell: integer tenths of a degree, so a unique key never compares floats. */
export interface ForecastCell {
  latE1: number
  lngE1: number
}

/** A race climate row: a 0.01 degree cell, the race's month and day, and its clock window. */
export interface ClimateKey {
  latE2: number
  lngE2: number
  /** `MM-DD` of the race date. */
  monthDay: string
  startHour: number
  windowHours: number
}

/** What the climate of a goal depends on: its place, date, start time and length. */
export interface ClimateGoal {
  targetDate: string
  startTime: string | null
  targetTimeSec: number | null
  distanceM: number | null
  raceLat: number | null
  raceLng: number | null
}

/** The runner's home, used for a race that has no place of its own when the profile allows it. */
export interface ClimateHome {
  lat: number | null
  lng: number | null
  use: boolean
}

export interface RaceClimate {
  wbgtC: number
  source: 'climatology'
}

/** Degrees to integer steps of `1 / scale` degree; never negative zero. */
function steps(value: number, scale: number): number {
  const rounded = Math.round(value * scale)
  return rounded === 0 ? 0 : rounded
}

export function forecastCellOf(lat: number, lng: number): ForecastCell {
  return { latE1: steps(lat, 10), lngE1: steps(lng, 10) }
}

/**
 * The key of a goal's race climate, or null while it has no place: the race's own coordinates when
 * both are set, else home when the profile allows it and both home coordinates are set. A place is
 * a pair, so one race coordinate never combines with a home one into a point that is neither.
 */
export function climateKeyFor(goal: ClimateGoal, home: ClimateHome): ClimateKey | null {
  let place: { lat: number; lng: number } | null = null
  if (goal.raceLat !== null && goal.raceLng !== null) {
    place = { lat: goal.raceLat, lng: goal.raceLng }
  } else if (home.use && home.lat !== null && home.lng !== null) {
    place = { lat: home.lat, lng: home.lng }
  }
  if (place === null) return null
  const startMatch = goal.startTime === null ? null : /^(\d{2}):\d{2}$/.exec(goal.startTime)
  const startHour = startMatch ? Number(startMatch[1]) : DEFAULT_START_HOUR
  const durationSec = goal.targetTimeSec ?? (goal.distanceM ?? 0) * ROUGH_SEC_PER_M
  const windowHours = Math.min(MAX_WINDOW_HOURS, Math.max(1, Math.ceil(durationSec / 3600)))
  return {
    latE2: steps(place.lat, 100),
    lngE2: steps(place.lng, 100),
    monthDay: goal.targetDate.slice(5),
    startHour,
    windowHours,
  }
}

function climateWhere(key: ClimateKey) {
  return { latE2_lngE2_monthDay_startHour_windowHours: key }
}

function forecastWhere(cell: ForecastCell) {
  return { latE1_lngE1: cell }
}

/** The fetch of this deps: the injected one, else the global, looked up now rather than at start. */
export function fetchOf(deps: Pick<Deps, 'fetch'>): typeof fetch {
  return deps.fetch ?? ((input, init) => fetch(input, init))
}

function ageMs(at: Date, now: Date): number {
  return now.getTime() - at.getTime()
}

/** True while the last attempt on a row failed less than `BACKOFF_MS` ago (success clears it). */
function backedOff(row: { failedAt: Date | null } | null, now: Date): boolean {
  return row?.failedAt != null && ageMs(row.failedAt, now) < BACKOFF_MS
}

function failureText(message: string | null): string {
  return `Open-Meteo request failed: ${message ?? 'no answer.'}`
}

// ---------------------------------------------------------------------------------------------
// Single flight, deadlines and background work
// ---------------------------------------------------------------------------------------------

const flights = new WeakMap<object, Map<string, Promise<unknown>>>()

/** One run per key at a time per client: callers that arrive meanwhile share its result. */
function singleFlight<T>(prisma: PrismaClient, key: string, run: () => Promise<T>): Promise<T> {
  let byKey = flights.get(prisma)
  if (!byKey) {
    byKey = new Map()
    flights.set(prisma, byKey)
  }
  const known = byKey.get(key) as Promise<T> | undefined
  if (known) return known
  const started = run().finally(() => {
    if (byKey.get(key) === started) byKey.delete(key)
  })
  byKey.set(key, started)
  return started
}

type Waited<T> = { done: true; value: T } | { done: false }

/** `promise`'s value, or `{ done: false }` once `ms` have passed; the promise itself keeps going. */
async function within<T>(promise: Promise<T>, ms: number): Promise<Waited<T>> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<Waited<T>>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms)
  })
  try {
    return await Promise.race([promise.then((value) => ({ done: true as const, value })), late])
  } finally {
    clearTimeout(timer)
  }
}

const background = new Set<Promise<unknown>>()

/** Runs `work` after the response; a failure is already recorded on the cache row. */
function inBackground(work: Promise<unknown>): void {
  const tracked = work
    .catch(() => undefined)
    .finally(() => {
      background.delete(tracked)
    })
  background.add(tracked)
}

/** Resolves when every background refresh started so far has finished; tests await it. */
export async function settleWeatherCache(): Promise<void> {
  while (background.size > 0) await Promise.all([...background])
}

// ---------------------------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------------------------

interface ForecastRow {
  hours: string
  fetchedAt: Date | null
  failedAt: Date | null
  lastError: string | null
}

/** The home coordinates a profile holds; either may be missing. */
export interface HomeCoordinates {
  homeLat: number | null
  homeLng: number | null
}

function cellOfHome(home: HomeCoordinates | null): ForecastCell | null {
  return home?.homeLat != null && home.homeLng != null
    ? forecastCellOf(home.homeLat, home.homeLng)
    : null
}

async function homeCellOf(prisma: PrismaClient, userId: string): Promise<ForecastCell | null> {
  return cellOfHome(
    await prisma.athleteProfile.findUnique({
      where: { userId },
      select: { homeLat: true, homeLng: true },
    }),
  )
}

/** The stored hours. Rows written before the forecast carried radiation read it as null. */
function parseHours(text: string): WeatherHour[] {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return []
    return (parsed as Array<Partial<WeatherHour>>).map(
      (hour) =>
        ({
          ...hour,
          shortwaveWm2: typeof hour.shortwaveWm2 === 'number' ? hour.shortwaveWm2 : null,
        }) as WeatherHour,
    )
  } catch {
    return []
  }
}

/** Whether the engine may use a forecast fetched at `fetchedAt`: not older than 24 hours. */
function isUsable(fetchedAt: Date, now: Date): boolean {
  return ageMs(fetchedAt, now) <= FORECAST_USABLE_MS
}

/** Whether a cell's forecast should be fetched: never filled, or `FORECAST_REFRESH_MS` old. */
function forecastDue(row: ForecastRow | null, now: Date): boolean {
  return row === null || row.fetchedAt === null || ageMs(row.fetchedAt, now) >= FORECAST_REFRESH_MS
}

/**
 * Fetches the cell's forecast and stores it. A failure keeps the old hours, records the time and
 * the reason for the back-off, and throws. Concurrent callers share one request.
 */
function refreshForecast(
  prisma: PrismaClient,
  fetchFn: typeof fetch,
  cell: ForecastCell,
  now: Date,
): Promise<{ hours: WeatherHour[]; fetchedAt: Date }> {
  return singleFlight(prisma, `forecast ${cell.latE1},${cell.lngE1}`, async () => {
    try {
      const hours = await fetchForecast(fetchFn, {
        lat: cell.latE1 / 10,
        lng: cell.lngE1 / 10,
        forecastDays: FORECAST_DAYS,
      })
      const data = { hours: JSON.stringify(hours), fetchedAt: now, failedAt: null, lastError: null }
      await prisma.forecastCache.upsert({
        where: forecastWhere(cell),
        create: { ...cell, ...data },
        update: data,
      })
      return { hours, fetchedAt: now }
    } catch (error) {
      const lastError = safeMessage(error)
      await prisma.forecastCache.upsert({
        where: forecastWhere(cell),
        create: { ...cell, failedAt: now, lastError },
        update: { failedAt: now, lastError },
      })
      throw new Error(lastError)
    }
  })
}

/**
 * The home forecast that the engine may use: the cached hours, or null without a home, without a
 * filled cell, or when the forecast is older than `FORECAST_USABLE_MS`. Never fetches. A caller
 * that already holds the profile passes its home as `home`, which saves the profile read.
 */
export async function cachedForecast(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
  home?: HomeCoordinates,
): Promise<{ hours: WeatherHour[]; fetchedAt: Date } | null> {
  const cell = home === undefined ? await homeCellOf(prisma, userId) : cellOfHome(home)
  if (!cell) return null
  const row = await prisma.forecastCache.findUnique({ where: forecastWhere(cell) })
  if (!row?.fetchedAt || !isUsable(row.fetchedAt, now)) return null
  return { hours: parseHours(row.hours), fetchedAt: row.fetchedAt }
}

/**
 * What a deliverable that depends on the forecast adds to its change key, next to the data version
 * and the day (`dataVersionKey + today + forecastStamp`): the fetch time of the home cell's
 * forecast, or `NO_FORECAST` without a home or a usable forecast. `ForecastCache` is not state, so
 * a refresh moves this stamp and nothing else; a memoised value that reads the forecast puts the
 * stamp in its `memoByVersion` name.
 */
export async function forecastStamp(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<string> {
  const cell = await homeCellOf(prisma, userId)
  if (!cell) return NO_FORECAST
  // Only the time is read: the key is composed on every publish tick and needs no hours.
  const row = await prisma.forecastCache.findUnique({
    where: forecastWhere(cell),
    select: { fetchedAt: true },
  })
  return row?.fetchedAt && isUsable(row.fetchedAt, now) ? row.fetchedAt.toISOString() : NO_FORECAST
}

/**
 * `GET /api/weather/forecast`: the cached hours with their age; null without a home. A stale cell
 * answers at once and is refreshed in the background. A cell that was never filled waits for one
 * fetch, at most `waitMs`, and answers 502 when it fails or is late (the fetch carries on and
 * fills the cell). This is the one request path that may wait on Open-Meteo: the runner asked for
 * the forecast.
 */
export async function getForecastView(
  deps: Deps,
  userId: string,
  opts: { now?: Date; waitMs?: number } = {},
): Promise<ForecastView | null> {
  const { prisma } = deps
  const now = opts.now ?? new Date()
  const cell = await homeCellOf(prisma, userId)
  if (!cell) return null
  const row = await prisma.forecastCache.findUnique({ where: forecastWhere(cell) })

  if (row?.fetchedAt) {
    const stale = forecastDue(row, now)
    if (stale && !backedOff(row, now)) {
      inBackground(refreshForecast(prisma, fetchOf(deps), cell, now))
    }
    return {
      hours: parseHours(row.hours),
      fetchedAt: row.fetchedAt.toISOString(),
      stale,
    }
  }

  if (backedOff(row, now)) throw new HttpError(502, 'internal', failureText(row?.lastError ?? null))
  const attempt = refreshForecast(prisma, fetchOf(deps), cell, now)
  inBackground(attempt)
  const outcome = await within(
    attempt.then(
      (fresh) => ({ fresh }),
      (error: unknown) => ({ error }),
    ),
    opts.waitMs ?? FORECAST_WAIT_MS,
  )
  if (!outcome.done) {
    throw new HttpError(502, 'internal', failureText('no answer in time.'))
  }
  if ('error' in outcome.value) {
    throw new HttpError(502, 'internal', failureText(safeMessage(outcome.value.error)))
  }
  const { fresh } = outcome.value
  return { hours: fresh.hours, fetchedAt: fresh.fetchedAt.toISOString(), stale: false }
}

// ---------------------------------------------------------------------------------------------
// Race climate
// ---------------------------------------------------------------------------------------------

interface ClimateRow {
  wbgtC: number | null
  complete: boolean
  fetchedAt: Date | null
  failedAt: Date | null
  lastError: string | null
}

/** Whether a race climate should be fetched: never read, incomplete, or older than 30 days. */
function climateDue(row: ClimateRow | null, now: Date): boolean {
  return (
    row === null ||
    !row.complete ||
    row.fetchedAt === null ||
    ageMs(row.fetchedAt, now) >= CLIMATE_REFRESH_MS
  )
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * The race dates of the last three years whose window the archive already holds, newest first.
 * They count back from today, not from the goal's year, so one row serves every goal that shares
 * its place, date and clock window.
 */
function archiveDates(monthDay: string, today: string): string[] {
  const latest = addDays(today, -(ARCHIVE_LAG_DAYS + CLIMATE_SPREAD_DAYS))
  const dates: string[] = []
  for (let year = Number(today.slice(0, 4)); dates.length < CLIMATE_YEARS; year--) {
    if (year < ARCHIVE_FIRST_YEAR) break
    // A 29 February race reads 28 February in a year that has none.
    const day = monthDay === '02-29' && !isLeapYear(year) ? '02-28' : monthDay
    const date = `${year}-${day}`
    if (date <= latest) dates.push(date)
  }
  return dates
}

/** WBGT of each archive hour that falls in the race's clock window. */
function windowWbgt(
  hours: ClimateHour[],
  key: Pick<ClimateKey, 'startHour' | 'windowHours'>,
): number[] {
  const values: number[] = []
  for (const hour of hours) {
    const clock = Number(hour.time.slice(11, 13))
    if (clock < key.startHour || clock >= key.startHour + key.windowHours) continue
    if (hour.tempC === null) continue
    values.push(
      weatherIndex({
        tempC: hour.tempC,
        humidityPct: hour.humidityPct,
        windKph: hour.windKph,
        shortwaveWm2: hour.shortwaveWm2,
      }).value,
    )
  }
  return values
}

/**
 * Reads the race window of the last three archive years and stores the mean WBGT. A year that
 * fails leaves the row incomplete, so it is read again after the back-off; when an earlier
 * complete value exists, a failed or partial attempt keeps it. Throws when any year failed, after
 * the row is written. Concurrent callers share one run.
 */
function refreshClimate(
  prisma: PrismaClient,
  fetchFn: typeof fetch,
  key: ClimateKey,
  now: Date,
): Promise<void> {
  const id = `climate ${key.latE2},${key.lngE2} ${key.monthDay} ${key.startHour}+${key.windowHours}`
  return singleFlight(prisma, id, async () => {
    const place = { lat: key.latE2 / 100, lng: key.lngE2 / 100 }
    const values: number[] = []
    let yearsRead = 0
    let firstError: unknown = null
    for (const date of archiveDates(key.monthDay, todayIso(now))) {
      try {
        const hours = await fetchClimateHours(fetchFn, {
          ...place,
          start: addDays(date, -CLIMATE_SPREAD_DAYS),
          end: addDays(date, CLIMATE_SPREAD_DAYS),
        })
        values.push(...windowWbgt(hours, key))
        yearsRead += 1
      } catch (error) {
        firstError ??= error
      }
    }

    const read = {
      wbgtC:
        values.length === 0
          ? null
          : Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10,
      samples: values.length,
      yearsRead,
      fetchedAt: now,
    }
    if (firstError === null) {
      const data = { ...read, complete: true, failedAt: null, lastError: null }
      await prisma.climateCache.upsert({
        where: climateWhere(key),
        create: { ...key, ...data },
        update: data,
      })
      return
    }

    const lastError = safeMessage(firstError)
    const existing = await prisma.climateCache.findUnique({ where: climateWhere(key) })
    if (existing?.complete === true || yearsRead === 0) {
      // Old data is kept: a complete value is better than a partial one, and nothing was read.
      await prisma.climateCache.upsert({
        where: climateWhere(key),
        create: { ...key, failedAt: now, lastError },
        update: { failedAt: now, lastError },
      })
    } else {
      // Nothing better is stored, so the years that did answer stand until the rest follow.
      const data = { ...read, complete: false, failedAt: now, lastError }
      await prisma.climateCache.upsert({
        where: climateWhere(key),
        create: { ...key, ...data },
        update: data,
      })
    }
    throw new Error(lastError)
  })
}

/**
 * The cached race climate of a goal: the mean WBGT over the race window on the race date in the
 * last three archive years, null while the goal has no place or the cell has not been read yet.
 * Never fetches; a row that is stale or incomplete is still used until the job replaces it.
 */
export async function readClimate(
  prisma: PrismaClient,
  goal: ClimateGoal,
  home: ClimateHome,
): Promise<RaceClimate | null> {
  const key = climateKeyFor(goal, home)
  if (key === null) return null
  const row = await prisma.climateCache.findUnique({ where: climateWhere(key) })
  return row?.wbgtC == null ? null : { wbgtC: row.wbgtC, source: 'climatology' }
}

/**
 * Plan generation's wait: fills the goal's race climate when it is missing, incomplete or old,
 * for at most `waitMs`, so a plan on a cold cache carries the race heat. Never throws and never
 * waits when the cell is fresh, the goal has no place or the last attempt failed within the
 * back-off. A cell that already holds a value is refreshed in the background and the plan reads
 * that value (as `readClimate` does for any stale or incomplete row); only a cell with nothing
 * usable is waited for. A read that outlives the wait carries on and fills the cache for the next
 * plan.
 */
export async function ensureClimate(
  deps: Deps,
  args: { userId: string; goalId: string; now?: Date; waitMs?: number },
): Promise<void> {
  const { prisma } = deps
  const now = args.now ?? new Date()
  const goal = await prisma.goal.findFirst({ where: { id: args.goalId, userId: args.userId } })
  if (!goal) return
  const profile = await prisma.athleteProfile.findUnique({
    where: { userId: args.userId },
    select: { homeLat: true, homeLng: true, useHomeWeather: true },
  })
  const key = climateKeyFor(goal, {
    lat: profile?.homeLat ?? null,
    lng: profile?.homeLng ?? null,
    use: profile?.useHomeWeather ?? false,
  })
  if (key === null) return
  const row = await prisma.climateCache.findUnique({ where: climateWhere(key) })
  if (!climateDue(row, now) || backedOff(row, now)) return
  const attempt = refreshClimate(prisma, fetchOf(deps), key, now)
  inBackground(attempt)
  if (row?.wbgtC != null) return
  await within(
    attempt.catch(() => undefined),
    args.waitMs ?? CLIMATE_WAIT_MS,
  )
}

// ---------------------------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------------------------

export interface RefreshOutcome {
  /** Cache rows that were fetched and stored. */
  refreshed: number
  /** Rows that are due and could not be fetched: this attempt failed, or the back-off holds. */
  failed: number
  /** The first failure, for the job's run record; null when nothing failed. */
  error: unknown
}

/**
 * The end of the 10-minute weather job for one user (spec 5.8): refreshes the home forecast when it
 * is older than 60 minutes, and the race climate of each open goal that is missing, incomplete or
 * older than 30 days. A failed row keeps its old data and waits out a 15-minute back-off; a row
 * that is due but held by the back-off counts as failed, so the run does not look healthy while
 * the data ages. Goals are the user's targets and considered races that have not passed.
 */
export async function refreshWeatherCaches(
  deps: Deps,
  userId: string,
  opts: { fetch?: typeof fetch; now?: Date } = {},
): Promise<RefreshOutcome> {
  const { prisma } = deps
  const fetchFn = opts.fetch ?? fetchOf(deps)
  const now = opts.now ?? new Date()
  const outcome: RefreshOutcome = { refreshed: 0, failed: 0, error: null }
  const fail = (error: unknown): void => {
    outcome.failed += 1
    outcome.error ??= error
  }

  const profile = await prisma.athleteProfile.findUnique({
    where: { userId },
    select: { homeLat: true, homeLng: true, useHomeWeather: true },
  })
  const home: ClimateHome = {
    lat: profile?.homeLat ?? null,
    lng: profile?.homeLng ?? null,
    use: profile?.useHomeWeather ?? false,
  }

  if (home.lat !== null && home.lng !== null) {
    const cell = forecastCellOf(home.lat, home.lng)
    const row = await prisma.forecastCache.findUnique({ where: forecastWhere(cell) })
    if (forecastDue(row, now)) {
      if (backedOff(row, now)) {
        fail(row?.lastError ?? 'The forecast could not be read.')
      } else {
        try {
          await refreshForecast(prisma, fetchFn, cell, now)
          outcome.refreshed += 1
        } catch (error) {
          fail(error)
        }
      }
    }
  }

  const goals = await prisma.goal.findMany({
    where: {
      userId,
      status: { in: ['target', 'considering'] },
      targetDate: { gte: todayIso(now) },
      distanceM: { not: null },
    },
    orderBy: [{ targetDate: 'asc' }, { id: 'asc' }],
  })
  const seen = new Set<string>()
  for (const goal of goals) {
    const key = climateKeyFor(goal, home)
    if (key === null) continue
    const id = JSON.stringify(key)
    if (seen.has(id)) continue
    seen.add(id)
    const row = await prisma.climateCache.findUnique({ where: climateWhere(key) })
    if (!climateDue(row, now)) continue
    if (backedOff(row, now)) {
      fail(row?.lastError ?? 'The race climate could not be read.')
      continue
    }
    try {
      await refreshClimate(prisma, fetchFn, key, now)
      outcome.refreshed += 1
    } catch (error) {
      fail(error)
    }
  }
  return outcome
}

/**
 * After a write that changes a home or race place, date, start time or distance: fills the cells
 * the new values need, without making the request wait. A failure stays on the cache row, where
 * the weather job's back-off finds it.
 */
export function warmWeatherCaches(deps: Deps, userId: string): void {
  inBackground(refreshWeatherCaches(deps, userId))
}
