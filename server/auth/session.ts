import type { Request, Response } from 'express'
import jwt from 'jsonwebtoken'

export const SESSION_COOKIE = 'rl_session'
export const SESSION_MAX_AGE_SEC = 2_592_000 // 30 days
/** A cookie older than this is renewed by the next authenticated request. */
export const SESSION_RENEW_AFTER_SEC = 86_400 // 24 hours
/** The longest a session lives from the sign-in, however often it is renewed (ADR 0002, addendum). */
export const SESSION_ABSOLUTE_MAX_AGE_SEC = 10_368_000 // 120 days

export interface SessionClaims {
  userId: string
  version: number
  /** When this cookie was issued, in seconds. */
  issuedAt: number
  /** When the runner signed in, in seconds: `sat`, copied on every renewal; `iat` when absent. */
  signedInAt: number
  /** When this cookie expires, in seconds. */
  expiresAt: number
}

/**
 * `version` is the user's `sessionVersion` when the cookie is issued; ending every session of an
 * account is raising that counter, which no cookie signed with the old value matches. A sign-in
 * passes no `signedInAt`; a renewal passes the one it read, so `sat` stays the original sign-in.
 * The cookie ends 30 days after `now` or at the cap from `signedInAt`, whichever comes first.
 * `now` is in seconds and exists for tests.
 */
export function signSession(
  userId: string,
  secret: string,
  version = 0,
  opts: { signedInAt?: number; now?: number } = {},
): string {
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  const signedInAt = opts.signedInAt ?? now
  const exp = Math.min(now + SESSION_MAX_AGE_SEC, signedInAt + SESSION_ABSOLUTE_MAX_AGE_SEC)
  return jwt.sign({ sv: version, sat: signedInAt, iat: now, exp }, secret, {
    algorithm: 'HS256',
    subject: userId,
  })
}

/**
 * Returns the claims of a valid, unexpired token signed with `secret`; otherwise null (a token with
 * no `exp` or `iat` is refused). A token
 * without a version (issued before the counter existed) reads as 0, and one without `sat` (issued
 * before the cap existed) takes its `iat` as the sign-in time.
 */
export function verifySession(token: string, secret: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] })
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || payload.sub === '') {
      return null
    }
    const { sv, sat, iat, exp } = payload as Record<string, unknown>
    // jwt.verify does not require `exp`; a token without one is refused here, so every accepted
    // cookie has an end that the cap bounds.
    if (typeof iat !== 'number' || typeof exp !== 'number') return null
    return {
      userId: payload.sub,
      version: typeof sv === 'number' ? sv : 0,
      issuedAt: iat,
      signedInAt: typeof sat === 'number' ? sat : iat,
      expiresAt: exp,
    }
  } catch {
    return null
  }
}

/** Whether the request came over https, directly or through a proxy that says so. */
export function isSecure(req: Request): boolean {
  return req.secure || req.get('x-forwarded-proto') === 'https'
}

/** `maxAgeSec` defaults to the full life; a renewal near the cap passes what is left of it. */
export function setSessionCookie(
  res: Response,
  token: string,
  secure: boolean,
  maxAgeSec = SESSION_MAX_AGE_SEC,
): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: maxAgeSec * 1000,
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' })
}
