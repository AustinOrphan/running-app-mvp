import type { RequestHandler } from 'express'
import type { Deps } from '../app.ts'
import { unauthorized } from '../errors.ts'
import { SESSION_COOKIE, verifySession } from './session.ts'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string
    }
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Cross-site request forgery guard for the cookie session: a mutating request under /api must be
 * same-origin, shown either by `Sec-Fetch-Site: same-origin` or by an `Origin` whose host equals
 * the `Host` header.
 */
export function sameOriginGuard(): RequestHandler {
  return (req, _res, next) => {
    if (!MUTATING.has(req.method) || !req.originalUrl.startsWith('/api')) {
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

/** Resolves the session cookie to an existing user and sets `req.userId`; otherwise 401. */
export function requireAuth(deps: Deps): RequestHandler {
  return async (req, _res, next) => {
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
        select: { id: true },
      })
      if (!user) {
        next(unauthorized())
        return
      }
      req.userId = user.id
      next()
    } catch (error) {
      next(error)
    }
  }
}
