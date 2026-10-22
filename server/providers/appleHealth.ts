import { z } from 'zod'
import {
  climbAndDescent,
  emptySamples,
  haversineM,
  nearestValues,
  parseAppleDate,
  roundCoordinate,
  toMetres,
} from '../../shared/importers/appleHealth.ts'
import type { ParsedActivity, WellnessInput } from '../../shared/types.ts'
import { parse } from '../errors.ts'
import type { PushProvider } from './types.ts'

/**
 * Health Auto Export (iOS) REST automation, JSON v2: `{ data: { metrics: [...], workouts: [...] } }`.
 * Only the fields used here are read; everything else is ignored.
 */
const bodySchema = z.object({
  data: z.object({
    metrics: z.array(z.unknown()).default([]),
    workouts: z.array(z.unknown()).default([]),
  }),
})

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** `{ qty, units }` as Health Auto Export writes quantities. */
function quantity(value: unknown): { qty: number; units: string } | null {
  if (!isRecord(value)) return null
  const qty = num(value['qty'])
  return qty === null ? null : { qty, units: str(value['units']) ?? '' }
}

/** Metric names arrive as `Resting Heart Rate` or `resting_heart_rate`; both match. */
function normaliseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const KNOWN_METRICS = new Set([
  'resting_heart_rate',
  'heart_rate_variability',
  'sleep_analysis',
  'weight_body_mass',
  'vo2_max',
])

const KG_PER: Record<string, number> = { kg: 1, lb: 0.45359237, lbs: 0.45359237, g: 0.001 }
const HOURS_TO_SEC: Record<string, number> = { hr: 3600, h: 3600, min: 60, s: 1, sec: 1 }

const round1 = (value: number): number => Math.round(value * 10) / 10

interface DayAcc {
  restingHr?: { ms: number; value: number }
  hrv: number[]
  sleepSec?: number
  weight?: { ms: number; value: number }
  vo2?: { ms: number; value: number }
}

function mapMetrics(
  metrics: unknown[],
  timezone: string,
  ignored: Record<string, number>,
): WellnessInput[] {
  const days = new Map<string, DayAcc>()
  const day = (date: string): DayAcc => {
    let acc = days.get(date)
    if (!acc) {
      acc = { hrv: [] }
      days.set(date, acc)
    }
    return acc
  }

  for (const metric of metrics) {
    if (!isRecord(metric)) continue
    const rawName = str(metric['name'])
    if (rawName === undefined) continue
    const name = normaliseName(rawName)
    const points = Array.isArray(metric['data']) ? metric['data'] : []
    if (!KNOWN_METRICS.has(name)) {
      ignored[name] = (ignored[name] ?? 0) + Math.max(points.length, 1)
      continue
    }
    const units = (str(metric['units']) ?? '').toLowerCase()
    for (const point of points) {
      if (!isRecord(point)) continue
      if (name === 'sleep_analysis') {
        // The night belongs to the wake-up date: `sleepEnd` when given, else the point's date.
        const when = parseAppleDate(str(point['sleepEnd']) ?? str(point['date']), timezone)
        const asleep = num(point['asleep']) ?? num(point['totalSleep'])
        const stages = ['core', 'deep', 'rem'].map((k) => num(point[k]))
        const total =
          asleep ??
          (stages.every((v) => v === null)
            ? null
            : stages.reduce<number>((s, v) => s + (v ?? 0), 0))
        const factor = HOURS_TO_SEC[units || 'hr']
        if (!when || total === null || factor === undefined || total <= 0) continue
        const acc = day(when.date)
        acc.sleepSec = Math.max(acc.sleepSec ?? 0, Math.round(total * factor))
        continue
      }
      const when = parseAppleDate(str(point['date']), timezone)
      const qty = num(point['qty'])
      if (!when || qty === null) continue
      const acc = day(when.date)
      if (name === 'resting_heart_rate') {
        if (!acc.restingHr || when.ms >= acc.restingHr.ms)
          acc.restingHr = { ms: when.ms, value: qty }
      } else if (name === 'heart_rate_variability') {
        acc.hrv.push(qty)
      } else if (name === 'weight_body_mass') {
        const factor = KG_PER[units || 'kg']
        if (factor === undefined) continue
        if (!acc.weight || when.ms >= acc.weight.ms)
          acc.weight = { ms: when.ms, value: qty * factor }
      } else if (!acc.vo2 || when.ms >= acc.vo2.ms) {
        acc.vo2 = { ms: when.ms, value: qty }
      }
    }
  }

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, acc]) => ({
      date,
      restingHr: acc.restingHr ? Math.round(acc.restingHr.value) : null,
      hrvRmssd: null,
      hrvSdnn:
        acc.hrv.length > 0 ? round1(acc.hrv.reduce((s, v) => s + v, 0) / acc.hrv.length) : null,
      sleepSec: acc.sleepSec ?? null,
      sleepScore: null,
      weightKg: acc.weight ? round1(acc.weight.value) : null,
      vo2max: acc.vo2 ? round1(acc.vo2.value) : null,
    }))
}

const STRENGTH = /strength|weight ?lifting|core training|functional/i
const RUN = /\brun(ning)?\b/i

function mapType(
  name: string,
  location: string | undefined,
): { type: ParsedActivity['type']; subtype: string | null } {
  if (RUN.test(name)) {
    if (/indoor|treadmill/i.test(name) || /indoor/i.test(location ?? '')) {
      return { type: 'run', subtype: 'treadmill' }
    }
    return { type: 'run', subtype: /trail/i.test(name) ? 'trail' : null }
  }
  if (STRENGTH.test(name)) return { type: 'strength', subtype: null }
  return { type: 'cross', subtype: null }
}

interface RoutePoint {
  t: number
  lat: number
  lng: number
  alt: number | null
}

function mapRoute(
  route: unknown,
  startMs: number,
  elapsedSec: number,
  timezone: string,
): RoutePoint[] {
  if (!Array.isArray(route)) return []
  const points: RoutePoint[] = []
  for (const raw of route) {
    if (!isRecord(raw)) continue
    const lat = num(raw['latitude'])
    const lng = num(raw['longitude'])
    const when = parseAppleDate(str(raw['timestamp']), timezone)
    if (lat === null || lng === null || !when) continue
    const t = Math.round((when.ms - startMs) / 1000)
    if (t < 0 || t > elapsedSec) continue
    if (points.length > 0 && t < (points[points.length - 1]?.t ?? 0)) continue
    points.push({ t, lat, lng, alt: num(raw['altitude']) })
  }
  return points
}

function mapWorkout(raw: Json, timezone: string): ParsedActivity | null {
  const start = parseAppleDate(str(raw['start']), timezone)
  const end = parseAppleDate(str(raw['end']), timezone)
  if (!start || !end) return null
  const elapsedSec = Math.round((end.ms - start.ms) / 1000)
  if (elapsedSec <= 0) return null
  const startUtc = new Date(start.ms).toISOString()
  const id = str(raw['id'])
  const { type, subtype } = mapType(str(raw['name']) ?? '', str(raw['location']))

  // Heart-rate points outside [start, end] are dropped; recovery readings land after the end.
  const hrPoints: Array<{ t: number; avg: number; max: number }> = []
  for (const point of Array.isArray(raw['heartRateData']) ? raw['heartRateData'] : []) {
    if (!isRecord(point)) continue
    const when = parseAppleDate(str(point['date']), timezone)
    const avg = num(point['Avg']) ?? num(point['avg'])
    if (!when || avg === null || avg <= 0) continue
    if (when.ms < start.ms || when.ms > end.ms) continue
    hrPoints.push({
      t: Math.round((when.ms - start.ms) / 1000),
      avg: Math.round(avg),
      max: Math.round(num(point['Max']) ?? num(point['max']) ?? avg),
    })
  }
  hrPoints.sort((a, b) => a.t - b.t)

  const route = mapRoute(raw['route'], start.ms, elapsedSec, timezone)

  let distanceM: number | null = null
  const distance = quantity(raw['distance'])
  if (distance) distanceM = toMetres(distance.qty, distance.units || 'm')
  const routeLength = route.slice(1).reduce((sum, p, i) => {
    const prev = route[i]
    return prev ? sum + haversineM(prev.lat, prev.lng, p.lat, p.lng) : sum
  }, 0)
  if (distanceM === null && route.length > 1) distanceM = routeLength

  const alts = route.map((p) => p.alt).filter((a): a is number => a !== null)
  const climb = alts.length === route.length ? climbAndDescent(alts) : null
  const up = quantity(raw['elevationUp'])
  const elevationGainM = up ? toMetres(up.qty, up.units || 'm') : (climb?.gain ?? null)

  const avgHrStat = quantity(raw['avgHeartRate'])
  const maxHrStat = quantity(raw['maxHeartRate'])
  const avgHr =
    avgHrStat?.qty ??
    (hrPoints.length > 0 ? hrPoints.reduce((s, p) => s + p.avg, 0) / hrPoints.length : null)
  const maxHr =
    maxHrStat?.qty ?? (hrPoints.length > 0 ? Math.max(...hrPoints.map((p) => p.max)) : null)

  const duration = num(raw['duration'])
  const samples = emptySamples()
  if (route.length > 0) {
    let cumulative = 0
    const d = route.map((p, i) => {
      const prev = route[i - 1]
      if (prev) cumulative += haversineM(prev.lat, prev.lng, p.lat, p.lng)
      return Math.round(cumulative * 10) / 10
    })
    samples.t = route.map((p) => p.t)
    samples.d = d
    samples.alt = alts.length === route.length ? alts : null
    if (hrPoints.length > 0) {
      samples.hr = nearestValues(
        samples.t,
        hrPoints.map((p) => p.t),
        hrPoints.map((p) => p.avg),
      )
    }
  } else if (hrPoints.length > 0) {
    samples.t = hrPoints.map((p) => p.t)
    samples.hr = hrPoints.map((p) => p.avg)
  }

  const first = route[0]
  return {
    providerKey: `apple:${id ?? startUtc}`,
    startUtc,
    utcOffsetMin: start.offsetMin,
    type,
    subtype,
    elapsedSec,
    movingSec:
      duration !== null && duration > 0 ? Math.min(elapsedSec, Math.round(duration)) : null,
    distanceM: distanceM === null ? null : Math.round(distanceM),
    elevationGainM: elevationGainM === null ? null : Math.round(elevationGainM),
    elevationLossM: climb ? Math.round(climb.loss) : null,
    avgHr: avgHr === null ? null : Math.round(avgHr),
    maxHr: maxHr === null ? null : Math.round(maxHr),
    avgCadence: null,
    avgPowerW: null,
    deviceName: null,
    startLat: first ? roundCoordinate(first.lat) : null,
    startLng: first ? roundCoordinate(first.lng) : null,
    samples,
    laps: [],
  }
}

export const appleHealthPush: PushProvider = {
  parsePush(body, ctx) {
    const { data } = parse(bodySchema, body)
    const ignored: Record<string, number> = {}
    const wellness = mapMetrics(data.metrics, ctx.timezone, ignored)
    const activities: ParsedActivity[] = []
    for (const workout of data.workouts) {
      const mapped = isRecord(workout) ? mapWorkout(workout, ctx.timezone) : null
      if (mapped) activities.push(mapped)
      else ignored['workout:unreadable'] = (ignored['workout:unreadable'] ?? 0) + 1
    }
    return { activities, wellness, ignored }
  },
}
