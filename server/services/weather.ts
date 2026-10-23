import type { Deps } from '../app.ts'
import { fetchArchive, fetchForecast, type WeatherHour } from '../providers/openMeteo.ts'
import { loadProfile } from '../serialize.ts'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
/** The archive lags real time by a few days; newer activities come from the forecast model. */
const ARCHIVE_AFTER_DAYS = 5
/** The forecast endpoint is asked for this many past days (its documented range is wider). */
const RECENT_PAST_DAYS = 7
/** One archive request never spans more than this many days. */
const MAX_RANGE_DAYS = 90
/** Words in an activity's subtype that mark it as indoors (matched without regard to case). */
const INDOOR_SUBTYPES = ['treadmill', 'virtual', 'indoor']

interface Place {
  lat: number
  lng: number
}

interface Pending {
  id: string
  hourKey: string
  date: string
}

/** Weather is looked up per 0.1 degree cell, about 11 km, which is finer than weather varies. */
function cell(value: number): number {
  const rounded = Math.round(value * 10) / 10
  return rounded === 0 ? 0 : rounded
}

function hourKey(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 13)}:00:00Z`
}

function failure(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`Open-Meteo request failed: ${message}`)
}

/** Splits sorted `YYYY-MM-DD` dates into runs of consecutive days, each at most MAX_RANGE_DAYS long. */
function dateRanges(dates: string[]): Array<{ start: string; end: string }> {
  const sorted = [...new Set(dates)].sort()
  const ranges: Array<{ start: string; end: string }> = []
  for (const date of sorted) {
    const last = ranges[ranges.length - 1]
    const ms = Date.parse(`${date}T00:00:00Z`)
    if (
      last &&
      ms - Date.parse(`${last.end}T00:00:00Z`) <= DAY_MS &&
      ms - Date.parse(`${last.start}T00:00:00Z`) <= (MAX_RANGE_DAYS - 1) * DAY_MS
    ) {
      last.end = date
    } else {
      ranges.push({ start: date, end: date })
    }
  }
  return ranges
}

/**
 * Fills weather on up to `limit` activities that have none; returns how many were updated.
 * An activity is looked up at its start location, else at the home location when the profile
 * allows it; one without either is left alone. A failed lookup skips its group and is thrown only
 * when nothing at all could be filled, so the scheduler records it as the last error.
 */
export async function enrichWeather(
  deps: Deps,
  userId: string,
  opts: { limit: number; fetch: typeof fetch; now: Date },
): Promise<number> {
  const { prisma } = deps
  const profile = await loadProfile(prisma, userId)
  const home: Place | null =
    profile.useHomeWeather && profile.homeLat !== null && profile.homeLng !== null
      ? { lat: profile.homeLat, lng: profile.homeLng }
      : null

  const rows = await prisma.activity.findMany({
    where: {
      userId,
      tempC: null,
      weatherSource: null,
      startUtc: { lt: opts.now.toISOString() },
      // Nothing outside shaped a treadmill, virtual or indoor session, so it gets no weather.
      OR: [
        { subtype: null },
        { NOT: INDOOR_SUBTYPES.map((word) => ({ subtype: { contains: word } })) },
      ],
      ...(home ? {} : { startLat: { not: null }, startLng: { not: null } }),
    },
    orderBy: [{ date: 'desc' }, { startTime: 'desc' }, { createdAt: 'desc' }],
    take: opts.limit,
  })

  // Group by mode and place so that one request serves many activities.
  const groups = new Map<string, { mode: 'archive' | 'recent'; place: Place; items: Pending[] }>()
  for (const row of rows) {
    const startMs = row.startUtc ? Date.parse(row.startUtc) : Number.NaN
    if (Number.isNaN(startMs)) continue
    const midMs = startMs + row.durationSec * 500
    if (midMs > opts.now.getTime()) continue
    const origin =
      row.startLat !== null && row.startLng !== null
        ? { lat: row.startLat, lng: row.startLng }
        : home
    if (!origin) continue
    const place = { lat: cell(origin.lat), lng: cell(origin.lng) }
    const mode = opts.now.getTime() - midMs > ARCHIVE_AFTER_DAYS * DAY_MS ? 'archive' : 'recent'
    const key = `${mode} ${place.lat},${place.lng}`
    const nearest = Math.round(midMs / HOUR_MS) * HOUR_MS
    const group = groups.get(key) ?? { mode, place, items: [] }
    group.items.push({ id: row.id, hourKey: hourKey(nearest), date: hourKey(nearest).slice(0, 10) })
    groups.set(key, group)
  }

  let updated = 0
  let firstError: unknown = null

  async function apply(items: Pending[], hours: WeatherHour[]): Promise<void> {
    const byTime = new Map(hours.map((hour) => [hour.time, hour]))
    for (const item of items) {
      const hour = byTime.get(item.hourKey)
      if (!hour || hour.tempC === null) continue
      await prisma.activity.update({
        where: { id: item.id },
        data: {
          tempC: hour.tempC,
          dewPointC: hour.dewPointC,
          humidityPct: hour.humidityPct,
          windKph: hour.windKph,
          weatherSource: 'open-meteo',
        },
      })
      updated += 1
    }
  }

  for (const group of groups.values()) {
    try {
      if (group.mode === 'recent') {
        const hours = await fetchForecast(opts.fetch, {
          ...group.place,
          pastDays: RECENT_PAST_DAYS,
          forecastDays: 1,
        })
        await apply(group.items, hours)
        continue
      }
      for (const range of dateRanges(group.items.map((item) => item.date))) {
        const items = group.items.filter(
          (item) => item.date >= range.start && item.date <= range.end,
        )
        try {
          await apply(items, await fetchArchive(opts.fetch, { ...group.place, ...range }))
        } catch (error) {
          firstError ??= error
        }
      }
    } catch (error) {
      firstError ??= error
    }
  }

  if (updated === 0 && firstError !== null) throw failure(firstError)
  return updated
}
