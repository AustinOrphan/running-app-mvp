import { Router } from 'express'
import type { SerializedRequest } from 'pino'
import { todayIso } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { createFeedLimiter } from '../auth/rateLimit.ts'
import { notFound } from '../errors.ts'
import { calendarFeed, userForCalendarToken } from '../services/calendar.ts'

/** What the access log writes in place of a feed token. */
const TOKEN_PLACEHOLDER = ':token'

/**
 * The token segment of a feed URL. Express matches the mount path without regard to case, and the
 * logged URL is the raw request target: an absolute-form target (`http://host/api/calendar/...`)
 * reaches the feed too, and extra slashes after the mount path still carry the token, so the
 * pattern is neither anchored to the start nor limited to one slash.
 */
const FEED_URL = /(\/api\/calendar\/+)[^/?#]+/gi

/**
 * `/api/calendar/<token>/plan.ics` as `/api/calendar/:token/plan.ics`, also behind a scheme and
 * host or an extra slash; other URLs are unchanged.
 */
export function redactFeedToken(url: string): string {
  return url.replace(FEED_URL, `$1${TOKEN_PLACEHOLDER}`)
}

/**
 * The `req` serializer of the access log (`pino-http`): the logged URL, and the route parameters
 * if the framework filled them in by then, name the route and not the token. The token is a bearer
 * credential in a URL path, so a log file must not hold it. Headers and cookies are redacted by
 * the logger itself.
 */
export function redactedRequest(req: SerializedRequest): SerializedRequest {
  req.url = redactFeedToken(req.url)
  const params = req.params as Record<string, unknown> | undefined
  if (typeof params === 'object' && params !== null && 'token' in params) {
    req.params = { ...params, token: TOKEN_PLACEHOLDER }
  }
  return req
}

/**
 * `GET /api/calendar/:token/plan.ics`, the private calendar feed. A calendar app sends neither a
 * cookie nor an Origin, so the router is mounted before the same-origin guard, the session check
 * and every body parser (phase 3a design 4.8) and checks its own token: a request costs one hash
 * lookup, then one deliverable build. A token that is unknown, replaced or revoked is a 404 with
 * the body of any unknown route, never a 401, so the answer says nothing about which tokens have
 * existed. Refusals are rate-limited like sign-in.
 */
export function calendarRouter(deps: Deps): Router {
  const router = Router()

  router.get('/:token/plan.ics', createFeedLimiter(), async (req, res) => {
    const userId = await userForCalendarToken(deps, String(req.params.token))
    if (userId === null) throw notFound()
    const feed = await calendarFeed(deps, { userId, today: todayIso() })
    res
      .status(200)
      .set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex',
        'Content-Disposition': 'inline; filename="plan.ics"',
      })
      .type('text/calendar; charset=utf-8')
      .send(feed)
  })

  return router
}
