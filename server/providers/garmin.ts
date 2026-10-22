/**
 * Garmin Connect pull provider (experimental, spec 2.6.4). It speaks the mobile app's undocumented
 * API, so it ships off by default, throttles itself and stops at the first 429 or 403.
 */
import { unzipSync } from 'fflate'
import { z } from 'zod'
import { HttpError, parse, unauthorized, validationError } from '../errors.ts'
import type { ParsedActivity, WellnessInput } from '../../shared/types.ts'
import {
  API_BASE,
  BACKOFF_SEC,
  DI_CLIENT_IDS,
  MOBILE_USER_AGENT,
  exchangeTicket,
  refreshWithToken,
  ssoLogin,
  ssoVerifyMfa,
  type CookieJar,
  type GarminTokens,
} from './garminSso.ts'
import {
  RateLimitPause,
  type FileFormat,
  type ProviderCtx,
  type PullProvider,
  type RemoteActivityRef,
} from './types.ts'

const MFA_WINDOW_MS = 10 * 60_000
const REFRESH_AHEAD_MS = 15 * 60_000
const REQUEST_GAP_MS = 1000
const MAX_REQUESTS_PER_RUN = 200
const BUDGET_BACKOFF_SEC = 3600
const WELLNESS_DAYS = 30
const PAGE_SIZE = 100
const MAX_FIT_BYTES = 64 * 1024 * 1024
const DAY_MS = 86_400_000

/** A run that used its request budget. Wellness returns what it has; activities pause. */
class BudgetExhausted extends RateLimitPause {}

const ack = z.literal(true, {
  error: 'Tick the box to confirm you understand this is unofficial and Garmin may block it.',
})

const connectSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('login'),
    username: z.string().trim().min(1, 'Enter the Garmin username.'),
    password: z.string().min(1, 'Enter the Garmin password.'),
    acknowledgeRisk: ack,
  }),
  z.object({
    mode: z.literal('mfa'),
    code: z.string().trim().min(4, 'Enter the verification code.').max(10),
    acknowledgeRisk: ack,
  }),
  z.object({
    mode: z.literal('tokens'),
    tokens: z.union([z.string().min(2), z.record(z.string(), z.unknown())]),
    clientId: z.string().trim().min(1).optional(),
    acknowledgeRisk: ack,
  }),
])

const secretSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number(),
  clientId: z.string().min(1),
})

// Module state. A pending MFA sign-in, the refresh queue and rotated pairs are per process.
const pendingMfa = new Map<string, { cookies: CookieJar; method: string; expiresAt: number }>()
const refreshQueue = new Map<string, Promise<unknown>>()
const rotatedFrom = new Map<string, GarminTokens>()
const MAX_ROTATIONS_KEPT = 32

interface RunState {
  tokens: GarminTokens | null
  requests: number
}
const runs = new WeakMap<ProviderCtx, RunState>()

function runState(ctx: ProviderCtx): RunState {
  let state = runs.get(ctx)
  if (!state) {
    state = { tokens: null, requests: 0 }
    runs.set(ctx, state)
  }
  return state
}

function toSecret(tokens: GarminTokens): Record<string, unknown> {
  return { ...tokens }
}

/** Reads the stored pair, following rotations another caller already made. */
function loadTokens(ctx: ProviderCtx, state: RunState): GarminTokens {
  if (!state.tokens) {
    const parsed = secretSchema.safeParse(ctx.secret)
    if (!parsed.success) throw unauthorized('Reconnect: no Garmin sign-in is stored.')
    state.tokens = parsed.data
  }
  let tokens = state.tokens
  for (let next = rotatedFrom.get(tokens.refreshToken); next;) {
    tokens = next
    next = rotatedFrom.get(tokens.refreshToken)
  }
  state.tokens = tokens
  return tokens
}

function rememberRotation(stale: GarminTokens, next: GarminTokens): void {
  rotatedFrom.set(stale.refreshToken, next)
  while (rotatedFrom.size > MAX_ROTATIONS_KEPT) {
    const oldest = rotatedFrom.keys().next().value
    if (oldest === undefined) break
    rotatedFrom.delete(oldest)
  }
}

/**
 * Refreshes one user at a time. Refresh tokens rotate, so a caller that queued behind another
 * refresh of the same pair takes the result instead of spending the consumed token again.
 */
async function rotate(
  ctx: ProviderCtx,
  state: RunState,
  stale: GarminTokens,
): Promise<GarminTokens> {
  const prior = refreshQueue.get(ctx.userId) ?? Promise.resolve()
  const run = prior.then(async () => {
    const already = rotatedFrom.get(stale.refreshToken)
    if (already) return already
    const next = await refreshWithToken(ctx.fetch, stale, ctx.now())
    rememberRotation(stale, next)
    await ctx.saveSecret(toSecret(next))
    return next
  })
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  refreshQueue.set(ctx.userId, tail)
  void tail.then(() => {
    if (refreshQueue.get(ctx.userId) === tail) refreshQueue.delete(ctx.userId)
  })
  state.tokens = await run
  return state.tokens
}

function pause(status: number): RateLimitPause {
  return new RateLimitPause(`Garmin answered HTTP ${status}; pausing before the next attempt.`, {
    retryAfterSec: BACKOFF_SEC,
  })
}

async function send(
  ctx: ProviderCtx,
  state: RunState,
  path: string,
  tokens: GarminTokens,
): Promise<Response> {
  if (state.requests >= MAX_REQUESTS_PER_RUN) {
    throw new BudgetExhausted(
      `Garmin request budget (${MAX_REQUESTS_PER_RUN}) used up for this run.`,
      {
        retryAfterSec: BUDGET_BACKOFF_SEC,
      },
    )
  }
  if (state.requests > 0) await ctx.sleep(REQUEST_GAP_MS)
  state.requests += 1
  return ctx.fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'User-Agent': MOBILE_USER_AGENT,
      'DI-Backend': 'connectapi.garmin.com',
      Accept: 'application/json, */*',
    },
  })
}

/** One GET against the Connect API with refresh, throttling and the pause rules applied. */
async function apiGet(ctx: ProviderCtx, path: string): Promise<Response> {
  const state = runState(ctx)
  let tokens = loadTokens(ctx, state)
  if (tokens.expiresAt - ctx.now().getTime() < REFRESH_AHEAD_MS) {
    tokens = await rotate(ctx, state, tokens)
  }
  let res = await send(ctx, state, path, tokens)
  if (res.status === 401) {
    tokens = await rotate(ctx, state, tokens)
    res = await send(ctx, state, path, tokens)
    if (res.status === 401) throw unauthorized('Reconnect: Garmin rejected the refreshed sign-in.')
  }
  if (res.status === 429 || res.status === 403) throw pause(res.status)
  return res
}

// connect -------------------------------------------------------------------------------------

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Reads the token JSON `python-garminconnect` writes (or the same fields pasted by hand). */
function importedTokens(
  raw: string | Record<string, unknown>,
  clientIdInput: string | undefined,
  now: Date,
): GarminTokens {
  let record: unknown = raw
  if (typeof raw === 'string') {
    try {
      record = JSON.parse(raw)
    } catch {
      throw validationError('The pasted tokens are not valid JSON.')
    }
  }
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    throw validationError('The pasted tokens must be a JSON object.')
  }
  const r = record as Record<string, unknown>
  const accessToken = str(r.access_token) ?? str(r.di_token)
  const refreshToken = str(r.refresh_token) ?? str(r.di_refresh_token)
  if (!accessToken || !refreshToken) {
    throw validationError('The pasted tokens need access_token and refresh_token.')
  }
  const clientId = str(r.client_id) ?? str(r.di_client_id) ?? clientIdInput ?? DI_CLIENT_IDS[0]
  const expiresAtRaw = finite(r.expires_at)
  const expiresIn = finite(r.expires_in)
  let expiresAt = 0
  if (expiresAtRaw !== null) expiresAt = expiresAtRaw < 1e12 ? expiresAtRaw * 1000 : expiresAtRaw
  else if (expiresIn !== null) expiresAt = now.getTime() + expiresIn * 1000
  return { accessToken, refreshToken, expiresAt, clientId }
}

/** Confirms the pair works (refreshing it first when it has expired) and returns the live pair. */
async function verifyTokens(ctx: ProviderCtx, tokens: GarminTokens): Promise<GarminTokens> {
  const probe: ProviderCtx = {
    ...ctx,
    secret: toSecret(tokens),
    // The refreshed pair is returned to the caller, which stores it with the connection.
    saveSecret: () => Promise.resolve(),
  }
  try {
    const res = await apiGet(probe, '/userprofile-service/socialProfile')
    if (!res.ok) throw validationError(`Garmin did not accept those tokens (HTTP ${res.status}).`)
  } catch (error) {
    if (error instanceof RateLimitPause) {
      throw validationError('Garmin is rate limiting this server. Try again later.')
    }
    if (error instanceof HttpError && error.code === 'unauthorized') {
      throw validationError('Garmin did not accept those tokens. Paste a fresh set.')
    }
    throw error
  }
  return loadTokens(probe, runState(probe))
}

function connected(tokens: GarminTokens, via: 'login' | 'tokens') {
  return { config: { clientId: tokens.clientId, via }, secret: toSecret(tokens) }
}

async function connect(
  input: unknown,
  ctx: ProviderCtx,
): Promise<{ config: object; secret: object }> {
  const body = parse(connectSchema, input)
  const now = ctx.now()

  if (body.mode === 'tokens') {
    pendingMfa.delete(ctx.userId)
    const imported = importedTokens(body.tokens, body.clientId, now)
    return connected(await verifyTokens(ctx, imported), 'tokens')
  }

  if (body.mode === 'mfa') {
    const pending = pendingMfa.get(ctx.userId)
    if (!pending || pending.expiresAt < now.getTime()) {
      pendingMfa.delete(ctx.userId)
      throw validationError('The Garmin sign-in expired. Sign in again.')
    }
    const ticket = await ssoVerifyMfa(ctx.fetch, pending.cookies, pending.method, body.code)
    pendingMfa.delete(ctx.userId)
    return connected(await exchangeTicket(ctx.fetch, ticket, now), 'login')
  }

  pendingMfa.delete(ctx.userId)
  const step = await ssoLogin(ctx.fetch, body.username, body.password)
  if (step.kind === 'mfa') {
    pendingMfa.set(ctx.userId, {
      cookies: step.cookies,
      method: step.method,
      expiresAt: now.getTime() + MFA_WINDOW_MS,
    })
    return { config: { mfaRequired: true, method: step.method }, secret: {} }
  }
  return connected(await exchangeTicket(ctx.fetch, step.ticket, now), 'login')
}

// activities ----------------------------------------------------------------------------------

const dateOnly = /^\d{4}-\d{2}-\d{2}$/

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function gmtToIso(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function* listActivities(since: string, ctx: ProviderCtx): AsyncGenerator<RemoteActivityRef> {
  const isDate = dateOnly.test(since)
  const sinceMs = isDate ? Date.parse(`${since}T00:00:00Z`) : Date.parse(since)
  if (Number.isNaN(sinceMs)) throw validationError(`Unusable sync start: ${since}`)
  // Garmin filters by local date, so start a day early; the timestamp filter below is exact.
  const startDate = isoDay(sinceMs - DAY_MS)
  const endDate = isoDay(ctx.now().getTime() + DAY_MS)

  const found = new Map<string, RemoteActivityRef>()
  for (let start = 0; ; start += PAGE_SIZE) {
    const query = new URLSearchParams({
      start: String(start),
      limit: String(PAGE_SIZE),
      startDate,
      endDate,
    })
    const res = await apiGet(ctx, `/activitylist-service/activities/search/activities?${query}`)
    if (!res.ok) throw new Error(`Garmin activity list failed (HTTP ${res.status}).`)
    const page: unknown = await res.json()
    if (!Array.isArray(page)) throw new Error('Garmin activity list was not an array.')
    for (const item of page as Array<Record<string, unknown>>) {
      const id = finite(item.activityId)
      const startUtc = gmtToIso(item.startTimeGMT)
      if (id === null || startUtc === null) continue
      if (!isDate && Date.parse(startUtc) <= sinceMs) continue
      found.set(String(id), { id: String(id), startUtc })
    }
    if (page.length < PAGE_SIZE) break
  }
  // Garmin answers newest first; the sync cursor advances with the oldest-first order.
  const ordered = [...found.values()].sort((a, b) => a.startUtc.localeCompare(b.startUtc))
  for (const ref of ordered) yield ref
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The first `.fit` in Garmin's ZIP, or the bytes themselves when Garmin sent a bare FIT. */
function extractFit(id: string, bytes: Uint8Array): { name: string; bytes: Uint8Array } | null {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!isZip) {
    const bareFit = String.fromCharCode(...bytes.subarray(8, 12)) === '.FIT'
    return bareFit ? { name: `${id}.fit`, bytes } : null
  }
  let taken = false
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (taken || !file.name.toLowerCase().endsWith('.fit')) return false
        if (file.originalSize > MAX_FIT_BYTES) return false
        taken = true
        return true
      },
    })
  } catch {
    return null
  }
  const entry = Object.entries(files)[0]
  return entry ? { name: basename(entry[0]), bytes: entry[1] } : null
}

async function fetchActivity(
  ref: RemoteActivityRef,
  ctx: ProviderCtx,
): ReturnType<PullProvider['fetchActivity']> {
  let res: Response
  try {
    res = await apiGet(ctx, `/download-service/files/activity/${encodeURIComponent(ref.id)}`)
  } catch (error) {
    if (error instanceof RateLimitPause) {
      // Re-include this activity next run: the list filter is strictly after the cursor.
      error.cursor = new Date(Date.parse(ref.startUtc) - 1).toISOString()
    }
    throw error
  }
  if (res.status === 404 || res.status === 204) return null
  if (!res.ok) throw new Error(`Garmin download failed for ${ref.id} (HTTP ${res.status}).`)

  const fit = extractFit(ref.id, new Uint8Array(await res.arrayBuffer()))
  if (!fit) return null
  const first = ctx.parseFile(fit.name, fit.bytes)[0]
  if (!first) return null
  const parsed: ParsedActivity = { ...first, providerKey: `garmin:${ref.id}` }
  return { parsed, file: { name: fit.name, format: 'fit' satisfies FileFormat, bytes: fit.bytes } }
}

// wellness ------------------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function positive(value: unknown): number | null {
  const n = finite(value)
  return n !== null && n > 0 ? n : null
}

async function json(res: Response): Promise<Record<string, unknown> | null> {
  if (!res.ok) return null
  return record(await res.json().catch(() => null))
}

async function listWellness(from: string, to: string, ctx: ProviderCtx): Promise<WellnessInput[]> {
  if (!dateOnly.test(from) || !dateOnly.test(to)) {
    throw validationError('Wellness dates must be YYYY-MM-DD.')
  }
  const last = Date.parse(`${to}T00:00:00Z`)
  const first = Math.max(Date.parse(`${from}T00:00:00Z`), last - (WELLNESS_DAYS - 1) * DAY_MS)
  const days: WellnessInput[] = []
  try {
    for (let ms = first; ms <= last; ms += DAY_MS) {
      const date = isoDay(ms)
      const sleepBody = await json(
        await apiGet(ctx, `/sleep-service/sleep/dailySleepData?date=${date}`),
      )
      if (!sleepBody) continue
      const dto = record(sleepBody.dailySleepDTO)
      const sleepSec = positive(dto.sleepTimeSeconds)
      const score = positive(record(record(dto.sleepScores).overall).value)
      const restingHr = positive(sleepBody.restingHeartRate)
      let hrv = positive(sleepBody.avgOvernightHrv)
      if (hrv === null && (sleepSec !== null || restingHr !== null)) {
        const hrvBody = await json(await apiGet(ctx, `/hrv-service/hrv/${date}`))
        hrv = positive(record(hrvBody?.hrvSummary).lastNightAvg)
      }
      if (sleepSec === null && restingHr === null && hrv === null) continue
      days.push({
        date,
        restingHr: restingHr === null ? null : Math.round(restingHr),
        hrvRmssd: hrv,
        hrvSdnn: null,
        sleepSec: sleepSec === null ? null : Math.round(sleepSec),
        sleepScore: score === null ? null : Math.round(score),
        weightKg: null,
        vo2max: null,
      })
    }
  } catch (error) {
    // A spent request budget is not a failure: hand back the days read so far.
    if (!(error instanceof BudgetExhausted)) throw error
  }
  return days
}

export const garminProvider: PullProvider = {
  connect,
  listActivities,
  fetchActivity,
  listWellness,
}
