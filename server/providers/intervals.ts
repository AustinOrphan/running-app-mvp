import { gunzipSync } from 'fflate'
import { z } from 'zod'
import { parse, validationError } from '../errors.ts'
import type { ActivityType, ParsedActivity, WellnessInput } from '../../shared/types.ts'
import {
  RateLimitPause,
  type FileFormat,
  type ProviderCtx,
  type PullProvider,
  type RemoteActivityRef,
} from './types.ts'

const BASE_URL = 'https://intervals.icu/api/v1'
/** Longest span asked for in one activities request. */
const WINDOW_DAYS = 180
const DAY_MS = 24 * 3600 * 1000
const STREAM_TYPES = 'time,distance,heartrate,altitude,cadence,watts'
const DEFAULT_RETRY_AFTER_SEC = 60

const connectBody = z.object({
  athleteId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]+$/, 'Use the athlete id from the intervals.icu settings page.'),
  apiKey: z.string().trim().min(1, 'Enter the API key.'),
})

/** The fields of an intervals.icu activity that this provider reads. */
interface RemoteActivity {
  id?: string | number
  type?: string | null
  source?: string | null
  start_date?: string | null
  start_date_local?: string | null
  distance?: number | null
  moving_time?: number | null
  elapsed_time?: number | null
  total_elevation_gain?: number | null
  average_heartrate?: number | null
  max_heartrate?: number | null
  average_cadence?: number | null
  icu_average_watts?: number | null
  device_name?: string | null
  start_lat?: number | null
  start_lng?: number | null
}

interface RemoteWellness {
  id?: string
  restingHR?: number | null
  hrv?: number | null
  sleepSecs?: number | null
  sleepScore?: number | null
  weight?: number | null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function dateOnly(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** `2026-03-02T07:00:00.000Z` becomes `2026-03-02T07:00:00Z`; null for an unreadable value. */
function isoUtc(value: string | null | undefined): string | null {
  if (!value) return null
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString().replace(/\.000Z$/, 'Z')
}

function credentials(ctx: ProviderCtx): { athleteId: string; apiKey: string } {
  const { athleteId } = ctx.config
  const { apiKey } = ctx.secret
  if (typeof athleteId !== 'string' || typeof apiKey !== 'string' || apiKey === '') {
    throw new Error('intervals.icu is not connected.')
  }
  return { athleteId, apiKey }
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`
}

function send(ctx: ProviderCtx, path: string, apiKey: string): Promise<Response> {
  return ctx.fetch(`${BASE_URL}${path}`, {
    headers: { authorization: authHeader(apiKey), accept: 'application/json' },
  })
}

/** Sends an authenticated GET for a pull call; a 404 is returned, any other failure throws. */
async function pullGet(ctx: ProviderCtx, path: string): Promise<Response> {
  const response = await send(ctx, path, credentials(ctx).apiKey)
  if (response.ok || response.status === 404) return response
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'))
    throw new RateLimitPause('intervals.icu is rate limiting requests.', {
      retryAfterSec:
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_SEC,
    })
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('intervals.icu rejected the API key. Reconnect with a new key.')
  }
  throw new Error(`intervals.icu answered HTTP ${response.status}.`)
}

async function pullJson(ctx: ProviderCtx, path: string): Promise<unknown> {
  const response = await pullGet(ctx, path)
  if (response.status === 404) return null
  return (await response.json()) as unknown
}

function mapType(type: string | null | undefined): {
  type: ActivityType
  subtype: string | null
} {
  switch (type) {
    case 'Run':
      return { type: 'run', subtype: null }
    case 'TrailRun':
      return { type: 'run', subtype: 'trail' }
    case 'VirtualRun':
      return { type: 'run', subtype: 'treadmill' }
    case 'WeightTraining':
      return { type: 'strength', subtype: null }
    case 'Walk':
      return { type: 'cross', subtype: 'walk' }
    case 'Hike':
      return { type: 'cross', subtype: 'hike' }
    case 'Ride':
    case 'VirtualRide':
    case 'GravelRide':
    case 'MountainBikeRide':
    case 'EBikeRide':
      return { type: 'cross', subtype: 'bike' }
    case 'Swim':
    case 'OpenWaterSwim':
      return { type: 'cross', subtype: 'swim' }
    case 'NordicSki':
    case 'AlpineSki':
    case 'BackcountrySki':
      return { type: 'cross', subtype: 'ski' }
    case 'Elliptical':
      return { type: 'cross', subtype: 'elliptical' }
    default:
      return { type: 'cross', subtype: 'other' }
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100 + 0
}

function fileNameFrom(response: Response, fallback: string): string {
  const header = response.headers.get('content-disposition') ?? ''
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)
  const name = match?.[1]?.trim()
  return name ? name.replace(/[/\\]/g, '_') : fallback
}

function formatOf(name: string, bytes: Uint8Array): FileFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (ext === 'fit' || ext === 'gpx' || ext === 'tcx') return ext
  const head = new TextDecoder().decode(bytes.subarray(0, 512))
  if (bytes.length > 12 && new TextDecoder().decode(bytes.subarray(8, 12)) === '.FIT') return 'fit'
  if (head.includes('TrainingCenterDatabase')) return 'tcx'
  if (head.includes('<gpx')) return 'gpx'
  return null
}

/** Downloads the original file; null when intervals.icu has none or it does not parse. */
async function fromOriginalFile(
  ref: RemoteActivityRef,
  ctx: ProviderCtx,
): Promise<{
  parsed: ParsedActivity
  file?: { name: string; format: FileFormat; bytes: Uint8Array }
} | null> {
  const response = await pullGet(ctx, `/activity/${encodeURIComponent(ref.id)}/file`)
  if (response.status === 404) return null
  let bytes = new Uint8Array(await response.arrayBuffer())
  let name = fileNameFrom(response, `${ref.id}.fit`)
  try {
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      bytes = gunzipSync(bytes)
      name = name.replace(/\.gz$/i, '')
    }
    const [first] = ctx.parseFile(name, bytes)
    if (!first) return null
    const parsed = { ...first, providerKey: `intervals:${ref.id}` }
    const format = formatOf(name, bytes)
    return format ? { parsed, file: { name, format, bytes } } : { parsed }
  } catch {
    // An unreadable original is not fatal: the streams still describe the activity.
    return null
  }
}

function channel(streams: Map<string, number[]>, key: string, scale = 1): number[] | null {
  const data = streams.get(key)
  if (!data || data.length === 0) return null
  return scale === 1 ? data : data.map((value) => Math.round(value * scale))
}

async function fromStreams(
  ref: RemoteActivityRef,
  ctx: ProviderCtx,
): Promise<{ parsed: ParsedActivity } | null> {
  const id = encodeURIComponent(ref.id)
  const detail = (await pullJson(ctx, `/activity/${id}`)) as RemoteActivity | null
  if (!detail || detail.source === 'STRAVA') return null
  const startUtc = isoUtc(detail.start_date) ?? ref.startUtc
  const { type, subtype } = mapType(detail.type)
  // intervals.icu reports running cadence as strides per minute; the app stores steps.
  const cadenceScale = type === 'run' ? 2 : 1

  const raw = await pullJson(ctx, `/activity/${id}/streams.json?types=${STREAM_TYPES}`)
  const streams = new Map<string, number[]>()
  if (Array.isArray(raw)) {
    for (const entry of raw as Array<{ type?: unknown; data?: unknown }>) {
      if (typeof entry.type === 'string' && Array.isArray(entry.data)) {
        streams.set(
          entry.type,
          entry.data.map((value) => (typeof value === 'number' ? value : 0)),
        )
      }
    }
  }
  const length = Math.max(0, ...[...streams.values()].map((data) => data.length))
  const t = channel(streams, 'time') ?? Array.from({ length }, (_, i) => i)
  const distance = channel(streams, 'distance')
  const elapsedSec =
    num(detail.elapsed_time) ??
    num(detail.moving_time) ??
    (t.length > 0 ? (t[t.length - 1] ?? 0) : 0)
  if (elapsedSec <= 0) return null

  const localMs = detail.start_date_local ? Date.parse(`${detail.start_date_local}Z`) : NaN
  const utcMs = Date.parse(startUtc)
  const offset = Number.isNaN(localMs) || Number.isNaN(utcMs) ? null : (localMs - utcMs) / 60000
  const lat = num(detail.start_lat)
  const lng = num(detail.start_lng)
  const cadence = num(detail.average_cadence)

  return {
    parsed: {
      providerKey: `intervals:${ref.id}`,
      startUtc,
      utcOffsetMin: offset !== null && Number.isInteger(offset) ? offset : null,
      type,
      subtype,
      elapsedSec: Math.round(elapsedSec),
      movingSec: num(detail.moving_time) === null ? null : Math.round(num(detail.moving_time) ?? 0),
      distanceM:
        num(detail.distance) ?? (distance ? (distance[distance.length - 1] ?? null) : null),
      elevationGainM: num(detail.total_elevation_gain),
      elevationLossM: null,
      avgHr: num(detail.average_heartrate),
      maxHr: num(detail.max_heartrate),
      avgCadence: cadence === null ? null : Math.round(cadence * cadenceScale),
      avgPowerW: num(detail.icu_average_watts),
      deviceName: detail.device_name ?? null,
      startLat: lat !== null && lng !== null ? round2(lat) : null,
      startLng: lat !== null && lng !== null ? round2(lng) : null,
      samples: {
        t,
        d: distance,
        hr: channel(streams, 'heartrate'),
        alt: channel(streams, 'altitude'),
        cad: channel(streams, 'cadence', cadenceScale),
        pwr: channel(streams, 'watts'),
      },
      laps: [],
    },
  }
}

export const intervalsProvider: PullProvider = {
  async connect(input, ctx) {
    const { athleteId, apiKey } = parse(connectBody, input)
    const response = await send(ctx, `/athlete/${encodeURIComponent(athleteId)}`, apiKey)
    if (response.status === 401 || response.status === 403) {
      throw validationError('intervals.icu rejected the API key')
    }
    if (response.status === 404) {
      throw validationError('intervals.icu does not know that athlete id')
    }
    if (!response.ok) throw new Error(`intervals.icu answered HTTP ${response.status}.`)
    return { config: { athleteId }, secret: { apiKey } }
  },

  async *listActivities(since, ctx) {
    const { athleteId } = credentials(ctx)
    const sinceMs = Date.parse(since)
    if (Number.isNaN(sinceMs)) throw new Error(`Unreadable sync start: ${since}`)
    // One day of slack covers the gap between local and UTC dates.
    const startMs = Date.UTC(...ymd(sinceMs)) - DAY_MS
    const endMs = Date.UTC(...ymd(ctx.now().getTime())) + DAY_MS
    const seen = new Set<string>()
    for (let oldest = startMs; oldest <= endMs; oldest += (WINDOW_DAYS + 1) * DAY_MS) {
      const newest = Math.min(oldest + WINDOW_DAYS * DAY_MS, endMs)
      const rows = await pullJson(
        ctx,
        `/athlete/${encodeURIComponent(athleteId)}/activities?oldest=${dateOnly(oldest)}&newest=${dateOnly(newest)}`,
      )
      const refs: RemoteActivityRef[] = []
      for (const row of Array.isArray(rows) ? (rows as RemoteActivity[]) : []) {
        const startUtc = isoUtc(row.start_date)
        if (row.id === undefined || startUtc === null) continue
        // Strava-sourced activities are stubs here; the Strava provider covers them.
        if (row.source === 'STRAVA') continue
        const id = String(row.id)
        if (seen.has(id)) continue
        seen.add(id)
        refs.push({ id, startUtc })
      }
      refs.sort((a, b) => a.startUtc.localeCompare(b.startUtc))
      yield* refs
    }
  },

  async fetchActivity(ref, ctx) {
    return (await fromOriginalFile(ref, ctx)) ?? (await fromStreams(ref, ctx))
  },

  async listWellness(from, to, ctx): Promise<WellnessInput[]> {
    const { athleteId } = credentials(ctx)
    const rows = await pullJson(
      ctx,
      `/athlete/${encodeURIComponent(athleteId)}/wellness.json?oldest=${from}&newest=${to}`,
    )
    const out: WellnessInput[] = []
    for (const row of Array.isArray(rows) ? (rows as RemoteWellness[]) : []) {
      if (typeof row.id !== 'string') continue
      const entry: WellnessInput = {
        date: row.id,
        restingHr: num(row.restingHR),
        hrvRmssd: num(row.hrv),
        hrvSdnn: null,
        sleepSec: num(row.sleepSecs),
        sleepScore: num(row.sleepScore),
        weightKg: num(row.weight),
        vo2max: null,
      }
      const hasData = [
        entry.restingHr,
        entry.hrvRmssd,
        entry.sleepSec,
        entry.sleepScore,
        entry.weightKg,
      ].some((value) => value !== null)
      if (hasData) out.push(entry)
    }
    return out
  },
}

function ymd(ms: number): [number, number, number] {
  const date = new Date(ms)
  return [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()]
}
