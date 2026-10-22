// Open-Meteo client (no key). Every call takes the injected `fetch`; hours are requested in GMT so
// they line up with `Activity.startUtc`.

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const HOURLY = 'temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m'

export interface WeatherHour {
  /** The hour, `YYYY-MM-DDTHH:00:00Z`. */
  time: string
  tempC: number | null
  dewPointC: number | null
  humidityPct: number | null
  windKph: number | null
}

interface OpenMeteoBody {
  hourly?: {
    time?: unknown
    temperature_2m?: unknown
    relative_humidity_2m?: unknown
    dew_point_2m?: unknown
    wind_speed_10m?: unknown
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

async function request(fetchFn: typeof fetch, base: string, params: URLSearchParams) {
  params.set('hourly', HOURLY)
  params.set('timezone', 'GMT')
  params.set('wind_speed_unit', 'kmh')
  const response = await fetchFn(`${base}?${params.toString()}`)
  if (!response.ok) throw new Error(`Open-Meteo answered HTTP ${response.status}.`)
  let body: OpenMeteoBody
  try {
    body = (await response.json()) as OpenMeteoBody
  } catch {
    throw new Error('Open-Meteo sent a response that is not JSON.')
  }
  const times = body.hourly?.time
  if (!Array.isArray(times)) throw new Error('Open-Meteo sent no hourly data.')
  const temp = column(body.hourly?.temperature_2m, times.length)
  const humidity = column(body.hourly?.relative_humidity_2m, times.length)
  const dew = column(body.hourly?.dew_point_2m, times.length)
  const wind = column(body.hourly?.wind_speed_10m, times.length)
  const hours: WeatherHour[] = []
  times.forEach((time, index) => {
    // "2026-03-02T07:00" in GMT.
    if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)) return
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
