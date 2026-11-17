import type { RequestHandler } from 'express'
import type { Deps } from '../app.ts'
import { passwordChangeRequired, unauthorized } from '../errors.ts'
import { runnerDay, type RunnerDay } from '../runnerDay.ts'
import {
  isSecure,
  SESSION_COOKIE,
  SESSION_RENEW_AFTER_SEC,
  setSessionCookie,
  signSession,
  verifySession,
} from './session.ts'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string
      /** The runner's day, resolved once per request in `requireAuth` (D10, ADR 0022). */
      runnerDay: RunnerDay
      /** True while the account still holds a temporary password (read in `requireAuth`). */
      mustChangePassword: boolean
    }
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Cross-site request forgery guard for the cookie session: a mutating request must be
 * same-origin, shown either by `Sec-Fetch-Site: same-origin` or by an `Origin` whose host equals
 * the `Host` header.
 */
export function sameOriginGuard(): RequestHandler {
  return (req, _res, next) => {
    if (!MUTATING.has(req.method)) {
      next()
      return
    }
    if (req.get('sec-fetch-site') === 'same-origin') {
      next()
      return
    }
    const origin = req.get('origin')
    const host = req.get('host')
    if (origin && host) {
      try {
        if (new URL(origin).host === host) {
          next()
          return
        }
      } catch {
        // A malformed Origin is treated as a mismatch.
      }
    }
    next(unauthorized('Cross-site requests are not allowed.', 403))
  }
}

/**
 * The change-password gate (PW1): while the account holds a temporary password (`create-user`,
 * `reset-password`), every route below `requireAuth` answers 403 `auth.password-change-required`.
 * The change-password flow itself (`/api/auth/me`, `PUT /api/auth/password`, logout, `/api/setup`)
 * is routed above `requireAuth`, so it needs no entry here. The one exception is the page's error
 * report, which the change-password page may need to send.
 */
export function requirePasswordChanged(): RequestHandler {
  return (req, _res, next) => {
    const errorReport = req.path === '/client-errors' || req.path.startsWith('/client-errors/')
    if (req.mustChangePassword && !errorReport) {
      next(passwordChangeRequired())
      return
    }
    next()
  }
}

/**
 * Resolves the session cookie to an existing user and sets `req.userId` and `req.runnerDay` (the
 * zone is read with the user row, and `now` once, so one request never mixes two days); otherwise
 * 401.
 */
export function requireAuth(deps: Deps): RequestHandler {
  return async (req, res, next) => {
    try {
      const cookies = req.cookies as Record<string, unknown> | undefined
      const token = cookies?.[SESSION_COOKIE]
      const session =
        typeof token === 'string' ? verifySession(token, deps.config.sessionSecret) : null
      if (!session) {
        next(unauthorized())
        return
      }
      const user = await deps.prisma.user.findUnique({
        where: { id: session.userId },
        select: {
          id: true,
          sessionVersion: true,
          mustChangePassword: true,
          profile: { select: { timezone: true } },
        },
      })
      // A cookie signed with another version than the account's is refused (the counter is raised
      // by a password change or reset).
      if (!user || session.version !== user.sessionVersion) {
        next(unauthorized())
        return
      }
      // Sliding renewal: a cookie more than a day old is replaced by one with the same version and
      // sign-in time, ending at most 30 days on or at the cap from the sign-in. A cookie already at
      // the cap would get the same end, so it is left alone.
      const now = Math.floor(Date.now() / 1000)
      if (now - session.issuedAt > SESSION_RENEW_AFTER_SEC) {
        const renewed = signSession(user.id, deps.config.sessionSecret, user.sessionVersion, {
          signedInAt: session.signedInAt,
          now,
        })
        const claims = verifySession(renewed, deps.config.sessionSecret)
        if (claims && claims.expiresAt > session.expiresAt) {
          setSessionCookie(res, renewed, isSecure(req), claims.expiresAt - now)
        }
      }
      req.userId = user.id
      req.mustChangePassword = user.mustChangePassword
      req.runnerDay = runnerDay(new Date(), user.profile?.timezone, user.id)
      next()
    } catch (error) {
      next(error)
    }
  }
}
