import type { Request, RequestHandler } from 'express'
import { ipKeyGenerator, rateLimit, type RateLimitRequestHandler } from 'express-rate-limit'
import type { ApiErrorCode } from '../../shared/types.ts'
import type { Config } from '../config.ts'
import { hashToken } from '../crypto.ts'
import { HttpError } from '../errors.ts'

interface LimiterOptions {
  /** Requests allowed per window and key (an address, an account, a user or a token). */
  max?: number
  windowMs?: number
}

/** How a limiter counts: every request, or only the ones that were refused (status 400 and up). */
type Counting = 'every-request' | 'refusals'

const WINDOW_MS = 15 * 60_000

/**
 * Fixed-window limiter held in memory, keyed by `req.ip` unless `keyOf` says otherwise. State lives
 * in the returned middleware, so each call (and so each app instance) counts separately. The app
 * sets no trust-proxy value (spec section 7), so `X-Forwarded-For` is ignored and its validation
 * is off: behind a reverse proxy every request has the proxy's address, which is why the tight
 * budgets are keyed by account, user or token and only the loose ones by address.
 */
function createLimiter(
  opts: LimiterOptions,
  defaultMax: number,
  code: ApiErrorCode,
  message: string,
  counting: Counting = 'every-request',
  keyOf?: (req: Request) => string,
  skip?: (req: Request) => boolean,
): RateLimitRequestHandler {
  return rateLimit({
    limit: opts.max ?? defaultMax,
    windowMs: opts.windowMs ?? WINDOW_MS,
    skipSuccessfulRequests: counting === 'refusals',
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    ...(keyOf ? { keyGenerator: keyOf } : {}),
    ...(skip ? { skip } : {}),
    // The library has set Retry-After from the window's reset time just before calling this.
    handler: (_req, res, next, options) => {
      const header = Number(res.getHeader('Retry-After'))
      const retryAfterSec = Number.isFinite(header) && header > 0 ? header : options.windowMs / 1000
      next(new HttpError(429, code, message, { retryAfterSec }))
    },
  })
}

/** Failed sign-in or setup attempts per window and account (lower-cased email). */
export const ACCOUNT_FAILURE_LIMIT = 10

/**
 * Failed sign-in or setup attempts per window and address. Behind a reverse proxy (`trust proxy`
 * stays unset) every runner has the proxy's address, so this is one budget for all of them: a
 * backstop against one client spraying many accounts, set far above what mistyping runners reach.
 * The per-account budget is the tight one.
 */
export const ADDRESS_FAILURE_LIMIT = 100

/** The email of an already-parsed sign-in or setup body, lower-cased; null when it has none. */
function emailOf(req: Request): string | null {
  const body = req.body as { email?: unknown } | undefined
  if (typeof body?.email !== 'string') return null
  const email = body.email.trim().toLowerCase().slice(0, 254)
  return email === '' ? null : email
}

/**
 * Sign-in and setup, per address: 100 failed attempts per 15 minutes, proxy-wide when the app sits
 * behind a proxy. A success is not counted (status under 400). Mount it after the per-account
 * limiter, so an attempt that one refuses never reaches or counts against this budget; a request
 * with no usable email skips the account limiter and is counted here.
 */
export function createSignInAddressLimiter(opts: LimiterOptions = {}): RequestHandler {
  return createLimiter(
    opts,
    ADDRESS_FAILURE_LIMIT,
    'unauthorized',
    'Too many sign-in attempts. Try again later.',
    'refusals',
  )
}

/** Per-account sign-in limiter: the middleware, and how a success clears the account's failures. */
export interface SignInAccountLimiter {
  limit: RequestHandler
  /** Forgets the failures counted against an email; call it after a successful sign-in. */
  reset: (email: string) => void
}

const accountKey = (email: string): string => `account:${email}`

/**
 * Sign-in and setup, per account: 10 failed attempts per 15 minutes against one lower-cased email,
 * read from the body the 16 KB parser has already parsed (so it is mounted after that parser and
 * reads nothing more). Only failures count, and `reset` clears them after a success, so one user's
 * typos never reach another user's budget. A request with no usable email is left to the address
 * limiter. A blocked account stays blocked until the window that began at its first failure has
 * passed, even for the right password.
 */
export function createSignInAccountLimiter(opts: LimiterOptions = {}): SignInAccountLimiter {
  const limiter = createLimiter(
    opts,
    ACCOUNT_FAILURE_LIMIT,
    'unauthorized',
    'Too many sign-in attempts. Try again later.',
    'refusals',
    (req) => accountKey(emailOf(req) ?? ipKeyGenerator(req.ip ?? '')),
    (req) => emailOf(req) === null,
  )
  return {
    limit: limiter,
    reset: (email) => {
      limiter.resetKey(accountKey(email.trim().toLowerCase()))
    },
  }
}

/** Requests per window and user of the API limiter in production. */
export const PRODUCTION_API_LIMIT = 1000

/**
 * Requests per window and user of the API limiter outside production. The Playwright server runs
 * with `NODE_ENV=development` and the suite sends one user's whole run through the window (942 of
 * 1000 requests at wave 5, about 1,170 of 20000 at wave 6, about 1,450 at wave 7), so a spec added
 * later must not exhaust it.
 */
export const NON_PRODUCTION_API_LIMIT = 20_000

/** The default request budget per user of the API limiter for a `NODE_ENV`. */
export function apiLimitFor(nodeEnv: Config['nodeEnv']): number {
  return nodeEnv === 'production' ? PRODUCTION_API_LIMIT : NON_PRODUCTION_API_LIMIT
}

/** How many times the per-user budget the per-address API limiter allows. */
export const ADDRESS_LIMIT_FACTOR = 10

/** The default request budget per address of the API limiter for a `NODE_ENV`. */
export function addressApiLimitFor(nodeEnv: Config['nodeEnv']): number {
  return apiLimitFor(nodeEnv) * ADDRESS_LIMIT_FACTOR
}

/**
 * Per-address limiter of `/api`, mounted ahead of authentication, so the anonymous and
 * token-checked routes (health, ingest, the calendar feed, the unknown-route 404) are bounded
 * without a session. It allows ten times the per-user budget (10,000 per 15 minutes in production,
 * 200,000 in any other `NODE_ENV`) because users behind one proxy share an address. `opts.max`
 * overrides it. The app mounts it on `/api` only; static files and the SPA fallback are outside
 * the budget.
 */
export function createAddressLimiter(
  opts: LimiterOptions & { nodeEnv?: Config['nodeEnv'] } = {},
): RequestHandler {
  return createLimiter(
    opts,
    // An unset `nodeEnv` counts as production: the strict budget is the safe default.
    addressApiLimitFor(opts.nodeEnv ?? 'production'),
    'internal',
    'Too many requests. Try again later.',
  )
}

/**
 * Per-user limiter of the API (1000 requests per 15 minutes per user in production, 20000 in any
 * other `NODE_ENV`) that no normal use reaches. Mount it below `requireAuth`: it keys on
 * `req.userId`, so users behind one address do not share it. `opts.max` overrides the budget.
 */
export function createUserLimiter(
  opts: LimiterOptions & { nodeEnv?: Config['nodeEnv'] } = {},
): RequestHandler {
  return createLimiter(
    opts,
    apiLimitFor(opts.nodeEnv ?? 'production'),
    'internal',
    'Too many requests. Try again later.',
    'every-request',
    (req) => `user:${req.userId}`,
  )
}

/** Refusals per window and calendar token hash. */
export const FEED_TOKEN_REFUSAL_LIMIT = 10

/** Refusals per window and address of the calendar feed, which bounds guessing many tokens. */
export const FEED_ADDRESS_REFUSAL_LIMIT = 100

/**
 * Limiters of the private calendar feed, counted on refusals only: a calendar app that holds the
 * right token polls for years and must not use the budget up. A token is a guess like a password,
 * so there are two: 10 refusals per 15 minutes per token hash, so one dead subscription cannot
 * exhaust another's, and 100 per address, so that guessing many different tokens is still slowed.
 * Mount both on the route that has the `:token` parameter, in this order.
 */
export function createFeedLimiters(opts: LimiterOptions = {}): RequestHandler[] {
  const message = 'Too many requests. Try again later.'
  return [
    createLimiter(
      { windowMs: opts.windowMs },
      FEED_ADDRESS_REFUSAL_LIMIT,
      'unauthorized',
      message,
      'refusals',
    ),
    createLimiter(
      opts,
      FEED_TOKEN_REFUSAL_LIMIT,
      'unauthorized',
      message,
      'refusals',
      (req) => `token:${hashToken(String(req.params.token))}`,
    ),
  ]
}

/**
 * Limiter of the password change: 5 refusals per 15 minutes per signed-in user (it sits after
 * `requireAuth`). A success does not count, so changing a password once never uses the budget, and
 * the key is the user id, so a second device or address does not get a fresh one.
 */
export function createPasswordChangeLimiter(opts: LimiterOptions = {}): RequestHandler {
  return createLimiter(
    opts,
    5,
    'unauthorized',
    'Too many attempts. Try again later.',
    'refusals',
    (req) => `password:${req.userId}`,
  )
}

/** Error reports per window and user. */
export const CLIENT_ERROR_LIMIT = 5

/**
 * Limiter of `POST /api/client-errors`: 5 reports per minute per signed-in user (it sits after
 * `requireAuth`), so a page that fails in a loop cannot fill the log. Every request counts.
 */
export function createClientErrorLimiter(opts: LimiterOptions = {}): RequestHandler {
  return createLimiter(
    { windowMs: 60_000, ...opts },
    CLIENT_ERROR_LIMIT,
    'internal',
    'Too many reports. Try again later.',
    'every-request',
    (req) => `client-error:${req.userId}`,
  )
}
