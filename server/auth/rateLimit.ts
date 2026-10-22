import type { RequestHandler } from 'express'
import { HttpError } from '../errors.ts'

interface Bucket {
  count: number
  resetAt: number
}

/**
 * Fixed-window limiter for sign-in attempts, keyed by `req.ip` and held in memory. Every attempt
 * counts, successful or not; the attempt after `max` gets 429 until the window that began at the
 * first attempt has passed.
 */
export function createLoginLimiter(
  opts: { max?: number; windowMs?: number; now?: () => number } = {},
): RequestHandler {
  const max = opts.max ?? 10
  const windowMs = opts.windowMs ?? 15 * 60_000
  const now = opts.now ?? Date.now
  const buckets = new Map<string, Bucket>()

  return (req, res, next) => {
    const time = now()
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= time) buckets.delete(key)
    }

    const key = req.ip ?? 'unknown'
    const bucket = buckets.get(key) ?? { count: 0, resetAt: time + windowMs }
    buckets.set(key, bucket)

    if (bucket.count >= max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - time) / 1000)
      res.set('Retry-After', String(retryAfterSec))
      next(
        new HttpError(429, 'unauthorized', 'Too many sign-in attempts. Try again later.', {
          retryAfterSec,
        }),
      )
      return
    }
    bucket.count += 1
    next()
  }
}
