import type { RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import type { ApiErrorCode } from '../../shared/types.ts'
import type { Config } from '../config.ts'
import { HttpError } from '../errors.ts'

interface LimiterOptions {
  /** Requests allowed per window and IP. */
  max?: number
  windowMs?: number
}

/** How a limiter counts: every request, or only the ones that were refused (status 400 and up). */
type Counting = 'every-request' | 'refusals'

const WINDOW_MS = 15 * 60_000

/**
 * Fixed-window limiter held in memory and keyed by `req.ip`. State lives in the returned
 * middleware, so each call (and so each app instance) counts separately. The app sets no
 * trust-proxy value (spec section 7), so `X-Forwarded-For` is ignored and its validation is off.
 */
function createLimiter(
  opts: LimiterOptions,
  defaultMax: number,
  code: ApiErrorCode,
  message: string,
  counting: Counting = 'every-request',
): RequestHandler {
  return rateLimit({
    limit: opts.max ?? defaultMax,
    windowMs: opts.windowMs ?? WINDOW_MS,
    skipSuccessfulRequests: counting === 'refusals',
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    // The library has set Retry-After from the window's reset time just before calling this.
    handler: (_req, res, next, options) => {
      const header = Number(res.getHeader('Retry-After'))
      const retryAfterSec = Number.isFinite(header) && header > 0 ? header : options.windowMs / 1000
      next(new HttpError(429, code, message, { retryAfterSec }))
    },
  })
}

/**
 * Sign-in limiter: 10 attempts per 15 minutes per IP. Every attempt counts, successful or not;
 * the attempt after `max` gets 429 until the window that began at the first attempt has passed.
 */
export function createLoginLimiter(opts: LimiterOptions = {}): RequestHandler {
  return createLimiter(opts, 10, 'unauthorized', 'Too many sign-in attempts. Try again later.')
}

/** Requests per window and IP of the API limiter in production. */
export const PRODUCTION_API_LIMIT = 1000

/**
 * Requests per window and IP of the API limiter outside production. The Playwright server runs
 * with `NODE_ENV=development` and the suite sends one IP's whole run through the window (942 of
 * 1000 requests at wave 5, about 1,170 of 20000 at wave 6), so a spec added later must not exhaust it.
 */
export const NON_PRODUCTION_API_LIMIT = 20_000

/** The default request budget of the API limiter for a `NODE_ENV`. */
export function apiLimitFor(nodeEnv: Config['nodeEnv']): number {
  return nodeEnv === 'production' ? PRODUCTION_API_LIMIT : NON_PRODUCTION_API_LIMIT
}

/**
 * Generous limiter of the API (1000 requests per 15 minutes per IP in production, 20000 in any
 * other `NODE_ENV`) that no normal use reaches. `opts.max` overrides the budget. The app mounts it
 * on `/api` only; static files and the SPA fallback are outside the budget.
 */
export function createGlobalLimiter(
  opts: LimiterOptions & { nodeEnv?: Config['nodeEnv'] } = {},
): RequestHandler {
  return createLimiter(
    opts,
    // An unset `nodeEnv` counts as production: the strict budget is the safe default.
    apiLimitFor(opts.nodeEnv ?? 'production'),
    'internal',
    'Too many requests. Try again later.',
  )
}

/**
 * Limiter of the private calendar feed: the budget and window of sign-in (10 per 15 minutes per
 * IP), counted on refusals only. A token is a guess like a password, but a calendar app that holds
 * the right one polls for years and must not use the budget up; only a refusal counts.
 */
export function createFeedLimiter(opts: LimiterOptions = {}): RequestHandler {
  return createLimiter(opts, 10, 'unauthorized', 'Too many requests. Try again later.', 'refusals')
}
