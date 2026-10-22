/**
 * Garmin's mobile sign-in and the DI OAuth2 token calls (docs/research/integrations-2026-10.md).
 * Unofficial and undocumented: every function here can break when Garmin changes its login.
 * The password is passed straight to the sign-in request and is never stored, logged or echoed in
 * an error message.
 */
import { z } from 'zod'
import { unauthorized, validationError } from '../errors.ts'
import { RateLimitPause } from './types.ts'

export const SSO_BASE = 'https://sso.garmin.com'
export const DI_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token'
export const API_BASE = 'https://connectapi.garmin.com'
export const SSO_CLIENT_ID = 'GCM_IOS_DARK'
export const SSO_SERVICE_URL = 'https://mobile.integration.garmin.com/gcm/ios'
export const MOBILE_USER_AGENT = 'GCM-Android-5.7.2.1'

/** DI client ids, tried in order until Garmin accepts one. */
export const DI_CLIENT_IDS = [
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI',
  'GARMIN_CONNECT_MOBILE_IOS_DI',
] as const

/** Both the 429 and 403 back-off, in seconds (spec 2.6.4: six hours). */
export const BACKOFF_SEC = 21_600

const DI_GRANT_SERVICE_TICKET =
  'https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket'
const DEFAULT_EXPIRES_IN_SEC = 3600

/** The pair a connection lives on; stored encrypted by the caller. */
export interface GarminTokens {
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  clientId: string
}

/** Cookies kept between the sign-in steps, as name to value. */
export type CookieJar = Record<string, string>

export type SsoOutcome =
  { kind: 'ticket'; ticket: string } | { kind: 'mfa'; method: string; cookies: CookieJar }

const TOKEN_HINT =
  'Import tokens instead: sign in once with python-garminconnect on a trusted machine and paste its token JSON.'

function blocked(status: number): Error {
  return validationError(
    status === 429
      ? `Garmin is rate limiting sign-ins (HTTP 429). Wait a while, or import tokens. ${TOKEN_HINT}`
      : `Garmin blocked the sign-in from this server (HTTP ${status}). ${TOKEN_HINT}`,
  )
}

function mergeCookies(jar: CookieJar, res: Response): void {
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(';', 1)[0] ?? ''
    const eq = pair.indexOf('=')
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

function ssoUrl(path: string): string {
  const query = new URLSearchParams({
    clientId: SSO_CLIENT_ID,
    locale: 'en-US',
    service: SSO_SERVICE_URL,
  })
  return `${SSO_BASE}${path}?${query.toString()}`
}

const ssoResponse = z.object({
  responseStatus: z.object({ type: z.string() }).partial().optional(),
  serviceTicketId: z.string().optional(),
  customerMfaInfo: z.object({ mfaLastMethodUsed: z.string().optional() }).partial().optional(),
})

function ssoHeaders(jar: CookieJar): Record<string, string> {
  const cookie = cookieHeader(jar)
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': MOBILE_USER_AGENT,
    ...(cookie ? { Cookie: cookie } : {}),
  }
}

async function readSso(res: Response): Promise<z.infer<typeof ssoResponse>> {
  if (res.status === 403 || res.status === 429) throw blocked(res.status)
  const parsed = ssoResponse.safeParse(await res.json().catch(() => null))
  if (!parsed.success) {
    throw validationError(`Garmin sent an unexpected sign-in answer (HTTP ${res.status}).`)
  }
  return parsed.data
}

/** Maps the sign-in answer to a ticket, an MFA request or a validation error. */
function outcome(body: z.infer<typeof ssoResponse>, jar: CookieJar): SsoOutcome {
  const type = body.responseStatus?.type
  if (type === 'SUCCESSFUL' && body.serviceTicketId) {
    return { kind: 'ticket', ticket: body.serviceTicketId }
  }
  if (type === 'MFA_REQUIRED') {
    return { kind: 'mfa', method: body.customerMfaInfo?.mfaLastMethodUsed ?? 'email', cookies: jar }
  }
  if (type === 'INVALID_USERNAME_PASSWORD') {
    throw validationError('Garmin rejected the username or password.')
  }
  if (type === 'CAPTCHA_REQUIRED') {
    throw validationError(`Garmin asked for a captcha, which cannot be solved here. ${TOKEN_HINT}`)
  }
  throw validationError(`Garmin did not complete the sign-in${type ? ` (${type})` : ''}.`)
}

/** Mobile SSO login. The password goes into one request body and nowhere else. */
export async function ssoLogin(
  fetchFn: typeof fetch,
  username: string,
  password: string,
): Promise<SsoOutcome> {
  const jar: CookieJar = {}
  const page = await fetchFn(ssoUrl('/mobile/sso/en/sign-in'), {
    headers: { 'User-Agent': MOBILE_USER_AGENT, Accept: 'text/html' },
  })
  if (page.status === 403 || page.status === 429) throw blocked(page.status)
  mergeCookies(jar, page)

  const res = await fetchFn(ssoUrl('/mobile/api/login'), {
    method: 'POST',
    headers: ssoHeaders(jar),
    body: JSON.stringify({ username, password, rememberMe: false, captchaToken: '' }),
  })
  mergeCookies(jar, res)
  return outcome(await readSso(res), jar)
}

/** Second step of a login that answered `MFA_REQUIRED`; returns the service ticket. */
export async function ssoVerifyMfa(
  fetchFn: typeof fetch,
  cookies: CookieJar,
  method: string,
  code: string,
): Promise<string> {
  const jar = { ...cookies }
  const res = await fetchFn(ssoUrl('/mobile/api/mfa/verifyCode'), {
    method: 'POST',
    headers: ssoHeaders(jar),
    body: JSON.stringify({
      mfaMethod: method,
      mfaVerificationCode: code,
      rememberMyBrowser: false,
      reconsentList: [],
      mfaSetup: false,
    }),
  })
  const body = await readSso(res)
  if (body.responseStatus?.type === 'SUCCESSFUL' && body.serviceTicketId) {
    return body.serviceTicketId
  }
  throw validationError('Garmin rejected that verification code.')
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
})

function basicAuth(clientId: string): string {
  return `Basic ${Buffer.from(`${clientId}:`).toString('base64')}`
}

async function postToken(
  fetchFn: typeof fetch,
  clientId: string,
  form: Record<string, string>,
): Promise<Response> {
  return fetchFn(DI_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': MOBILE_USER_AGENT,
      Authorization: basicAuth(clientId),
      'Cache-Control': 'no-cache',
    },
    body: new URLSearchParams({ client_id: clientId, ...form }).toString(),
  })
}

function toTokens(
  body: z.infer<typeof tokenResponse>,
  clientId: string,
  fallbackRefresh: string | null,
  now: Date,
): GarminTokens | null {
  const refreshToken = body.refresh_token ?? fallbackRefresh
  if (!refreshToken) return null
  return {
    accessToken: body.access_token,
    refreshToken,
    expiresAt: now.getTime() + (body.expires_in ?? DEFAULT_EXPIRES_IN_SEC) * 1000,
    clientId,
  }
}

/** Exchanges a service ticket for DI tokens, trying each client id until one is accepted. */
export async function exchangeTicket(
  fetchFn: typeof fetch,
  ticket: string,
  now: Date,
): Promise<GarminTokens> {
  for (const clientId of DI_CLIENT_IDS) {
    const res = await postToken(fetchFn, clientId, {
      grant_type: DI_GRANT_SERVICE_TICKET,
      service_ticket: ticket,
      service_url: SSO_SERVICE_URL,
    })
    if (res.status === 403 || res.status === 429) throw blocked(res.status)
    if (!res.ok) continue
    const parsed = tokenResponse.safeParse(await res.json().catch(() => null))
    const tokens = parsed.success ? toTokens(parsed.data, clientId, null, now) : null
    if (tokens) return tokens
  }
  throw validationError(`Garmin accepted the sign-in but refused to issue tokens. ${TOKEN_HINT}`)
}

/**
 * Trades the refresh token for a new pair (Garmin rotates them). A 429 or 403 pauses the provider;
 * any other refusal means the stored sign-in is dead and the integration needs a reconnect.
 */
export async function refreshWithToken(
  fetchFn: typeof fetch,
  tokens: GarminTokens,
  now: Date,
): Promise<GarminTokens> {
  const res = await postToken(fetchFn, tokens.clientId, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  })
  if (res.status === 429 || res.status === 403) {
    throw new RateLimitPause(`Garmin refused the token refresh (HTTP ${res.status}).`, {
      retryAfterSec: BACKOFF_SEC,
    })
  }
  if (!res.ok) throw unauthorized('Reconnect: Garmin rejected the stored sign-in.')
  const parsed = tokenResponse.safeParse(await res.json().catch(() => null))
  const next = parsed.success
    ? toTokens(parsed.data, tokens.clientId, tokens.refreshToken, now)
    : null
  if (!next) throw unauthorized('Reconnect: Garmin sent an unreadable token answer.')
  return next
}
