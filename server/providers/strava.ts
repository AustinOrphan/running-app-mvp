// Strava (spec 2.6.3): OAuth with the owner's own API application, activities by `after`
// paging, and one streams call per activity. Every request goes through the injected `fetch`.
import { z } from 'zod'
import type { ActivityType, ParsedActivity } from '../../shared/types.ts'
import { parse, validationError } from '../errors.ts'
import {
  RateLimitPause,
  type ProviderCtx,
  type PullProvider,
  type RemoteActivityRef,
} from './types.ts'

const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize'
const TOKEN_URL = 'https://www.strava.com/oauth/token'
const API = 'https://www.strava.com/api/v3'
const SCOPE = 'read,activity:read_all'
const PER_PAGE = 200
const REFRESH_MARGIN_SEC = 5 * 60
/** Stop a run when either rate-limit window reaches this share of its limit. */
const USAGE_STOP = 0.8
const WINDOW_SEC = 15 * 60
const DAY_SEC = 24 * 60 * 60
const RECONNECT = 'Reconnect Strava from the Integrations page.'

/** Non-secret Strava config: the client id and the optional public base URL. */
export interface StravaConfig {
  clientId: string
  publicBaseUrl?: string
}

const summarySchema = z.object({
  id: z.union([z.number(), z.string()]),
  sport_type: z.string().nullish(),
  type: z.string().nullish(),
  start_date: z.string(),
  start_date_local: z.string().nullish(),
  utc_offset: z.number().nullish(),
  distance: z.number().nullish(),
  moving_time: z.number().nullish(),
  elapsed_time: z.number().nullish(),
  total_elevation_gain: z.number().nullish(),
  average_heartrate: z.number().nullish(),
  max_heartrate: z.number().nullish(),
  average_cadence: z.number().nullish(),
  average_watts: z.number().nullish(),
  device_name: z.string().nullish(),
  start_latlng: z.array(z.number()).nullish(),
  trainer: z.boolean().nullish(),
})

export type StravaSummary = z.infer<typeof summarySchema>

const streamSchema = z.object({ data: z.array(z.number()) })
const streamsSchema = z.object({
  time: streamSchema.optional(),
  distance: streamSchema.optional(),
  heartrate: streamSchema.optional(),
  altitude: streamSchema.optional(),
  cadence: streamSchema.optional(),
  watts: streamSchema.optional(),
})

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number(),
})

/**
 * The ref `listActivities` yields. It carries the list entry so `fetchActivity` needs only the
 * streams call; a plain `{ id, startUtc }` ref still works, at the cost of one more request.
 */
export interface StravaRef extends RemoteActivityRef {
  summary?: StravaSummary
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** The consent-screen URL for `GET https://www.strava.com/oauth/authorize`. */
export function authorizeUrl(config: StravaConfig, redirectUri: string, state: string): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('approval_prompt', 'auto')
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('state', state)
  return url.toString()
}

function credentials(ctx: ProviderCtx): { clientId: string; clientSecret: string } {
  const clientId = text(ctx.config.clientId)
  const clientSecret = text(ctx.secret.clientSecret)
  if (clientId === '' || clientSecret === '') {
    throw validationError('Enter the Strava client id and client secret first.')
  }
  return { clientId, clientSecret }
}

async function tokenRequest(
  ctx: ProviderCtx,
  fields: Record<string, string>,
): Promise<z.infer<typeof tokenSchema> | null> {
  const { clientId, clientSecret } = credentials(ctx)
  const response = await ctx.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...fields }),
  })
  if (!response.ok) return null
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null))
  return parsed.success ? parsed.data : null
}

/** Exchanges an OAuth `code` and returns the new secret (client secret plus tokens). */
export async function exchangeCode(
  code: string,
  redirectUri: string,
  ctx: ProviderCtx,
): Promise<Record<string, unknown>> {
  void redirectUri // Strava's token endpoint does not take it; the code is bound to the consent.
  const tokens = await tokenRequest(ctx, { code, grant_type: 'authorization_code' })
  if (!tokens) {
    throw validationError('Strava rejected the authorization. Start the connection again.')
  }
  return {
    ...ctx.secret,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at,
  }
}

/**
 * Returns a valid access token, refreshing (and saving through `ctx.saveSecret`) when it expires
 * within 5 minutes. The refreshed pair is also written into `ctx.secret`, so later calls in the
 * same run reuse it instead of refreshing again.
 */
export async function refreshIfNeeded(ctx: ProviderCtx): Promise<string> {
  const accessToken = text(ctx.secret.accessToken)
  const refreshToken = text(ctx.secret.refreshToken)
  const expiresAt = typeof ctx.secret.expiresAt === 'number' ? ctx.secret.expiresAt : 0
  if (accessToken === '' || refreshToken === '') {
    throw new Error(`Strava is not connected. ${RECONNECT}`)
  }
  const nowSec = Math.floor(ctx.now().getTime() / 1000)
  if (expiresAt - nowSec > REFRESH_MARGIN_SEC) return accessToken

  const tokens = await tokenRequest(ctx, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  if (!tokens) throw new Error(`Strava rejected the refresh token. ${RECONNECT}`)
  const next = {
    ...ctx.secret,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at,
  }
  await ctx.saveSecret(next)
  Object.assign(ctx.secret, next)
  return tokens.access_token
}

function numbers(header: string | null): number[] {
  return (header ?? '').split(',').map((part) => Number(part.trim()))
}

/** Seconds to wait when a window is at or over 80% of its limit; null while both have room. */
function pauseSeconds(headers: Headers, now: Date): number | null {
  const limits = numbers(headers.get('X-RateLimit-Limit'))
  const usage = numbers(headers.get('X-RateLimit-Usage'))
  const nowSec = Math.floor(now.getTime() / 1000)
  const full = (i: number): boolean => {
    const limit = limits[i]
    const used = usage[i]
    return limit !== undefined && used !== undefined && limit > 0 && used >= limit * USAGE_STOP
  }
  const waits: number[] = []
  if (full(0)) waits.push(WINDOW_SEC - (nowSec % WINDOW_SEC))
  if (full(1)) waits.push(DAY_SEC - (nowSec % DAY_SEC))
  return waits.length === 0 ? null : Math.max(...waits)
}

function pauseError(retryAfterSec: number, cursor: string | undefined): RateLimitPause {
  return new RateLimitPause('Strava rate limit reached; the next run continues.', {
    retryAfterSec,
    ...(cursor === undefined ? {} : { cursor }),
  })
}

/**
 * One authenticated GET. `body` is null for a 404. `pause` is set when the response shows a
 * window at 80%: the caller decides what to do with the data it just received.
 */
async function get(
  ctx: ProviderCtx,
  url: string,
  cursor?: string,
): Promise<{ body: unknown; pause: number | null }> {
  const token = await refreshIfNeeded(ctx)
  const response = await ctx.fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (response.status === 429) {
    throw pauseError(pauseSeconds(response.headers, ctx.now()) ?? WINDOW_SEC, cursor)
  }
  if (response.status === 401) throw new Error(`Strava rejected the access token. ${RECONNECT}`)
  if (response.status === 404) return { body: null, pause: null }
  if (!response.ok) throw new Error(`Strava request failed: HTTP ${response.status}`)
  const body: unknown = await response.json().catch(() => null)
  return { body, pause: pauseSeconds(response.headers, ctx.now()) }
}

function unexpected(): Error {
  return new Error('Strava returned a response in an unexpected shape.')
}

const round = (n: number | null | undefined): number | null =>
  n === null || n === undefined ? null : Math.round(n)

/** Coordinates are stored at 0.01 degrees; `+ 0` turns a rounded -0 into 0. */
const coarse = (n: number): number => Math.round(n * 100) / 100 + 0

const SPORTS: Record<string, { type: ActivityType; subtype: string | null }> = {
  Run: { type: 'run', subtype: 'road' },
  TrailRun: { type: 'run', subtype: 'trail' },
  VirtualRun: { type: 'run', subtype: 'treadmill' },
  Walk: { type: 'cross', subtype: 'walk' },
  Hike: { type: 'cross', subtype: 'hike' },
  Ride: { type: 'cross', subtype: 'bike' },
  MountainBikeRide: { type: 'cross', subtype: 'bike' },
  GravelRide: { type: 'cross', subtype: 'bike' },
  EBikeRide: { type: 'cross', subtype: 'bike' },
  VirtualRide: { type: 'cross', subtype: 'bike' },
  Swim: { type: 'cross', subtype: 'swim' },
  Elliptical: { type: 'cross', subtype: 'elliptical' },
  NordicSki: { type: 'cross', subtype: 'ski' },
  BackcountrySki: { type: 'cross', subtype: 'ski' },
  AlpineSki: { type: 'cross', subtype: 'ski' },
  WeightTraining: { type: 'strength', subtype: null },
}

/** Unmapped sports are kept as cross-training so a sync never drops an activity. */
function sportOf(summary: StravaSummary): { type: ActivityType; subtype: string | null } {
  const sport = summary.sport_type ?? summary.type ?? ''
  const mapped = SPORTS[sport] ?? { type: 'cross' as const, subtype: 'other' }
  if (sport === 'Run' && summary.trainer === true) return { type: 'run', subtype: 'treadmill' }
  return mapped
}

function offsetMin(summary: StravaSummary): number | null {
  if (summary.utc_offset !== null && summary.utc_offset !== undefined) {
    return Math.round(summary.utc_offset / 60)
  }
  if (summary.start_date_local) {
    // Strava labels the local wall-clock time with a Z, so the difference is the offset.
    const diff = Date.parse(summary.start_date_local) - Date.parse(summary.start_date)
    if (Number.isFinite(diff)) return Math.round(diff / 60_000)
  }
  return null
}

type Streams = z.infer<typeof streamsSchema>

function toParsed(summary: StravaSummary, streams: Streams | null): ParsedActivity {
  const { type, subtype } = sportOf(summary)
  // Strava reports running cadence per leg (rpm); the app stores steps per minute.
  const cadenceFactor = type === 'run' ? 2 : 1
  const t = streams?.time?.data ?? []
  const aligned = (stream: { data: number[] } | undefined, factor = 1): number[] | null =>
    stream && t.length > 0 && stream.data.length === t.length
      ? stream.data.map((v) => v * factor)
      : null
  const [lat, lng] = summary.start_latlng ?? []
  const cadence = summary.average_cadence
  return {
    providerKey: `strava:${summary.id}`,
    startUtc: summary.start_date,
    utcOffsetMin: offsetMin(summary),
    type,
    subtype,
    elapsedSec: Math.round(summary.elapsed_time ?? summary.moving_time ?? 0),
    movingSec: round(summary.moving_time),
    distanceM: round(summary.distance),
    elevationGainM: round(summary.total_elevation_gain),
    elevationLossM: null,
    avgHr: round(summary.average_heartrate),
    maxHr: round(summary.max_heartrate),
    avgCadence:
      cadence === null || cadence === undefined ? null : Math.round(cadence * cadenceFactor),
    avgPowerW: round(summary.average_watts),
    deviceName: summary.device_name ?? null,
    startLat: lat !== undefined && lng !== undefined ? coarse(lat) : null,
    startLng: lat !== undefined && lng !== undefined ? coarse(lng) : null,
    samples: {
      t,
      d: aligned(streams?.distance),
      hr: aligned(streams?.heartrate),
      alt: aligned(streams?.altitude),
      cad: aligned(streams?.cadence, cadenceFactor),
      pwr: aligned(streams?.watts),
    },
    laps: [],
  }
}

/** One second before `startUtc`, so the next run lists the activity again (`after` is exclusive). */
function justBefore(startUtc: string): string | undefined {
  const ms = Date.parse(startUtc)
  return Number.isFinite(ms) ? new Date(ms - 1000).toISOString().replace('.000Z', 'Z') : undefined
}

const connectSchema = z.object({
  clientId: z.string().trim().min(1, 'Enter the client id.'),
  clientSecret: z.string().trim().min(1, 'Enter the client secret.'),
  publicBaseUrl: z.union([z.literal(''), z.url()]).optional(),
})

function connectForm(input: unknown): { config: object; secret: object } {
  const form = parse(connectSchema, input)
  const base = form.publicBaseUrl?.replace(/\/+$/, '')
  return {
    config: { clientId: form.clientId, ...(base ? { publicBaseUrl: base } : {}) },
    secret: { clientSecret: form.clientSecret },
  }
}

export const stravaProvider: PullProvider = {
  /** Stores the app credentials; the tokens arrive through the OAuth callback (`exchangeCode`). */
  connect(input) {
    return Promise.resolve().then(() => connectForm(input))
  },

  async *listActivities(since, ctx) {
    const sinceMs = Date.parse(since)
    const after = Number.isFinite(sinceMs) ? Math.floor(sinceMs / 1000) : 0
    for (let page = 1; ; page += 1) {
      const url = `${API}/athlete/activities?after=${after}&page=${page}&per_page=${PER_PAGE}`
      const { body, pause } = await get(ctx, url)
      const parsed = z.array(summarySchema).safeParse(body)
      if (!parsed.success) throw unexpected()
      let newest: string | undefined
      for (const summary of parsed.data) {
        if (newest === undefined || summary.start_date > newest) newest = summary.start_date
        const ref: StravaRef = { id: String(summary.id), startUtc: summary.start_date, summary }
        yield ref
      }
      if (parsed.data.length < PER_PAGE) return
      // The consumer has handled every ref above before this point, so `newest` is safe to resume at.
      if (pause !== null) throw pauseError(pause, newest)
    }
  },

  async fetchActivity(ref, ctx) {
    const cursor = justBefore(ref.startUtc)
    let summary = (ref as StravaRef).summary
    if (!summary) {
      const detail = await get(
        ctx,
        `${API}/activities/${encodeURIComponent(ref.id)}?include_all_efforts=false`,
        cursor,
      )
      if (detail.body === null) return null
      const parsed = summarySchema.safeParse(detail.body)
      if (!parsed.success) throw unexpected()
      summary = parsed.data
      if (detail.pause !== null) throw pauseError(detail.pause, cursor)
    }
    const keys = 'time,distance,heartrate,altitude,cadence,watts'
    const { body, pause } = await get(
      ctx,
      `${API}/activities/${encodeURIComponent(ref.id)}/streams?keys=${keys}&key_by_type=true`,
      cursor,
    )
    // Without state across calls, only a throw stops the run; this activity is fetched again.
    if (pause !== null) throw pauseError(pause, cursor)
    let streams: Streams | null = null
    if (body !== null) {
      const parsed = streamsSchema.safeParse(body)
      if (!parsed.success) throw unexpected()
      streams = parsed.data
    }
    return { parsed: toParsed(summary, streams) }
  },
}
