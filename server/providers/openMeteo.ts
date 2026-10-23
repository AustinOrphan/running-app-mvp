// Open-Meteo client (no key). Every call takes the injected `fetch`; hours are requested in GMT so
// they line up with `Activity.startUtc`, except the climatology, which is read in the place's local
// time because a race window is a clock window. Only `services/weatherCache.ts` and the weather
// job's activity backfill (`services/weather.ts`) call it; a request handler never does.

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const HOURLY = 'temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m'
const CLIMATE_HOURLY = 'temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation'
/** One request never waits longer, so a hung connection cannot hold a scheduled job for good. */
export const REQUEST_TIMEOUT_MS = 20_000
/** "2026-03-02T07:00": the label of one hour in a response. */
const HOUR_LABEL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

export interface WeatherHour {
  /** The hour, `YYYY-MM-DDTHH:00:00Z`. */
  time: string
  tempC: number | null
  dewPointC: number | null
  humidityPct: number | null
  windKph: number | null
}

/** One archive hour in the place's local time, as the race climatology reads it. */
export interface ClimateHour {
  /** The hour, `YYYY-MM-DDTHH:00` in local time. */
  time: string
  tempC: number | null
  humidityPct: number | null
  windKph: number | null
  shortwaveWm2: number | null
}

interface OpenMeteoBody {
  hourly?: {
    time?: unknown
    temperature_2m?: unknown
    relative_humidity_2m?: unknown
    dew_point_2m?: unknown
    wind_speed_10m?: unknown
    shortwave_radiation?: unknown
  }
}

function column(value: unknown, length: number): Array<number | null> {
  const list = Array.isArray(value) ? (value as unknown[]) : []
  return Array.from({ length }, (_, index) => {
    const entry = list[index]
    return typeof entry === 'number' && Number.isFinite(entry) ? entry : null
  })
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10
}

/** The parsed JSON of one GET; an error status, a timeout or a body that is not JSON throws. */
async function getJson(
  fetchFn: typeof fetch,
  base: string,
  params: URLSearchParams,
): Promise<OpenMeteoBody> {
  const response = await fetchFn(`${base}?${params.toString()}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Open-Meteo answered HTTP ${response.status}.`)
  try {
    return (await response.json()) as OpenMeteoBody
  } catch {
    throw new Error('Open-Meteo sent a response that is not JSON.')
  }
}

function hourLabels(body: OpenMeteoBody): unknown[] {
  const times = body.hourly?.time
  if (!Array.isArray(times)) throw new Error('Open-Meteo sent no hourly data.')
  return times as unknown[]
}

async function request(fetchFn: typeof fetch, base: string, params: URLSearchParams) {
  params.set('hourly', HOURLY)
  params.set('timezone', 'GMT')
  params.set('wind_speed_unit', 'kmh')
  const body = await getJson(fetchFn, base, params)
  const times = hourLabels(body)
  const temp = column(body.hourly?.temperature_2m, times.length)
  const humidity = column(body.hourly?.relative_humidity_2m, times.length)
  const dew = column(body.hourly?.dew_point_2m, times.length)
  const wind = column(body.hourly?.wind_speed_10m, times.length)
  const hours: WeatherHour[] = []
  times.forEach((time, index) => {
    // "2026-03-02T07:00" in GMT.
    if (typeof time !== 'string' || !HOUR_LABEL.test(time)) return
    const humidityValue = humidity[index] ?? null
    hours.push({
      time: `${time}:00Z`,
      tempC: round1(temp[index] ?? null),
      dewPointC: round1(dew[index] ?? null),
      humidityPct: humidityValue === null ? null : Math.round(humidityValue),
      windKph: round1(wind[index] ?? null),
    })
  })
  return hours
}

/** Observed hours for `start`..`end` (inclusive `YYYY-MM-DD`), from the historical archive. */
export function fetchArchive(
  fetchFn: typeof fetch,
  where: { lat: number; lng: number; start: string; end: string },
): Promise<WeatherHour[]> {
  return request(
    fetchFn,
    ARCHIVE_URL,
    new URLSearchParams({
      latitude: String(where.lat),
      longitude: String(where.lng),
      start_date: where.start,
      end_date: where.end,
    }),
  )
}

/** The last `pastDays` days and the next `forecastDays` days of hours, from the forecast model. */
export function fetchForecast(
  fetchFn: typeof fetch,
  where: { lat: number; lng: number; pastDays?: number; forecastDays?: number },
): Promise<WeatherHour[]> {
  const params = new URLSearchParams({
    latitude: String(where.lat),
    longitude: String(where.lng),
  })
  if (where.pastDays) params.set('past_days', String(where.pastDays))
  if (where.forecastDays) params.set('forecast_days', String(where.forecastDays))
  return request(fetchFn, FORECAST_URL, params)
}

/**
 * Observed hours for `start`..`end` (inclusive `YYYY-MM-DD`) in the place's local time, with
 * shortwave radiation, from the historical archive. Values are as the archive sends them, so the
 * race-window WBGT is computed from unrounded numbers.
 */
export async function fetchClimateHours(
  fetchFn: typeof fetch,
  where: { lat: number; lng: number; start: string; end: string },
): Promise<ClimateHour[]> {
  const body = await getJson(
    fetchFn,
    ARCHIVE_URL,
    new URLSearchParams({
      latitude: String(where.lat),
      longitude: String(where.lng),
      start_date: where.start,
      end_date: where.end,
      hourly: CLIMATE_HOURLY,
      timezone: 'auto',
      wind_speed_unit: 'kmh',
    }),
  )
  const times = hourLabels(body)
  const temp = column(body.hourly?.temperature_2m, times.length)
  const humidity = column(body.hourly?.relative_humidity_2m, times.length)
  const wind = column(body.hourly?.wind_speed_10m, times.length)
  const sun = column(body.hourly?.shortwave_radiation, times.length)
  const hours: ClimateHour[] = []
  times.forEach((time, index) => {
    if (typeof time !== 'string' || !HOUR_LABEL.test(time)) return
    hours.push({
      time,
      tempC: temp[index] ?? null,
      humidityPct: humidity[index] ?? null,
      windKph: wind[index] ?? null,
      shortwaveWm2: sun[index] ?? null,
    })
  })
  return hours
}
