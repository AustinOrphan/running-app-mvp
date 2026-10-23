// Race-day climate from Open-Meteo's archive, for the goal model and the prediction: the mean WBGT
// over the race window on the race date in each of the last three years. Moved out of
// `engineInput.ts` unchanged, so the athlete snapshot and the gather adapters share it without
// importing each other. The weather cache of phase 3a (task E3-3) replaces this module.
import { addDays } from '../../shared/dates.ts'
import { weatherIndex } from '../../shared/engine/heat.ts'

const FORECAST_TTL_MS = 24 * 3_600_000
const CLIMATE_YEARS = 3
/** Days around the race date that the climatology averages over. */
const CLIMATE_SPREAD_DAYS = 1
/** The archive trails real time by a few days. */
const ARCHIVE_LAG_DAYS = 6
const DEFAULT_START_HOUR = 8
const MAX_WINDOW_HOURS = 12
/** A rough 6 min/km, used only to size the climatology window when the goal has no time target. */
const ROUGH_SEC_PER_M = 0.36
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'

const climateCache = new Map<string, { at: number; wbgtC: number | null }>()

/** Empties the climatology cache; tests use it. */
export function resetClimateCache(): void {
  climateCache.clear()
}

interface ArchiveBody {
  hourly?: {
    time?: unknown
    temperature_2m?: unknown
    relative_humidity_2m?: unknown
    wind_speed_10m?: unknown
    shortwave_radiation?: unknown
  }
}

function numbers(value: unknown): Array<number | null> {
  return Array.isArray(value)
    ? (value as unknown[]).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
    : []
}

/** Mean race-window WBGT of one archive day range, in local time; null without usable hours. */
async function archiveWbgt(
  place: { lat: number; lng: number },
  range: { start: string; end: string },
  window: { startHour: number; hours: number },
): Promise<number[]> {
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lng),
    start_date: range.start,
    end_date: range.end,
    hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation',
    timezone: 'auto',
    wind_speed_unit: 'kmh',
  })
  const response = await fetch(`${ARCHIVE_URL}?${params.toString()}`)
  if (!response.ok) throw new Error(`Open-Meteo answered HTTP ${response.status}.`)
  const body = (await response.json()) as ArchiveBody
  const times = Array.isArray(body.hourly?.time) ? (body.hourly.time as unknown[]) : []
  const temp = numbers(body.hourly?.temperature_2m)
  const humidity = numbers(body.hourly?.relative_humidity_2m)
  const wind = numbers(body.hourly?.wind_speed_10m)
  const sun = numbers(body.hourly?.shortwave_radiation)
  const out: number[] = []
  times.forEach((time, i) => {
    if (typeof time !== 'string') return
    const hour = Number(time.slice(11, 13))
    if (hour < window.startHour || hour >= window.startHour + window.hours) return
    const t = temp[i]
    if (t === null || t === undefined) return
    const index = weatherIndex({
      tempC: t,
      humidityPct: humidity[i] ?? null,
      windKph: wind[i] ?? null,
      shortwaveWm2: sun[i] ?? null,
    })
    out.push(index.value)
  })
  return out
}

/**
 * Race-day climate from Open-Meteo's archive: the mean WBGT over the race window on the race date
 * (and a day either side) in each of the last three years. Null when the race has no location
 * (race coordinates, else home) or no year could be read; a failed request never fails a plan.
 */
export async function raceClimate(
  goal: {
    targetDate: string
    startTime: string | null
    targetTimeSec: number | null
    distanceM: number | null
    raceLat: number | null
    raceLng: number | null
  },
  home: { lat: number | null; lng: number | null; use: boolean },
  today: string,
): Promise<{ wbgtC: number; source: 'climatology' } | null> {
  const lat = goal.raceLat ?? (home.use ? home.lat : null)
  const lng = goal.raceLng ?? (home.use ? home.lng : null)
  if (lat === null || lng === null) return null
  const place = { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 }
  const startMatch = goal.startTime === null ? null : /^(\d{2}):\d{2}$/.exec(goal.startTime)
  const startHour = startMatch ? Number(startMatch[1]) : DEFAULT_START_HOUR
  const durationSec = goal.targetTimeSec ?? (goal.distanceM ?? 0) * ROUGH_SEC_PER_M
  const hours = Math.min(MAX_WINDOW_HOURS, Math.max(1, Math.ceil(durationSec / 3600)))
  const key = `${place.lat},${place.lng} ${goal.targetDate.slice(5)} ${startHour}+${hours}`
  const cached = climateCache.get(key)
  if (cached && Date.now() - cached.at < FORECAST_TTL_MS) {
    return cached.wbgtC === null ? null : { wbgtC: cached.wbgtC, source: 'climatology' }
  }

  const goalYear = Number(goal.targetDate.slice(0, 4))
  const samples: number[] = []
  let failed = false
  for (let back = 1; back <= CLIMATE_YEARS; back++) {
    const date = `${goalYear - back}${goal.targetDate.slice(4)}`
    if (date > addDays(today, -ARCHIVE_LAG_DAYS - CLIMATE_SPREAD_DAYS)) continue
    try {
      samples.push(
        ...(await archiveWbgt(
          place,
          { start: addDays(date, -CLIMATE_SPREAD_DAYS), end: addDays(date, CLIMATE_SPREAD_DAYS) },
          { startHour, hours },
        )),
      )
    } catch {
      // Keep the years that did answer.
      failed = true
    }
  }
  const wbgtC =
    samples.length === 0
      ? null
      : Math.round((samples.reduce((sum, v) => sum + v, 0) / samples.length) * 10) / 10
  // A partial or failed read is not cached, so the next plan asks the archive again.
  if (!failed) climateCache.set(key, { at: Date.now(), wbgtC })
  return wbgtC === null ? null : { wbgtC, source: 'climatology' }
}
