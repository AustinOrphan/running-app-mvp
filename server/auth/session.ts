import type { Response } from 'express'
import jwt from 'jsonwebtoken'

export const SESSION_COOKIE = 'rl_session'
export const SESSION_MAX_AGE_SEC = 2_592_000 // 30 days

/**
 * `version` is the user's `sessionVersion` when the cookie is issued; ending every session of an
 * account is raising that counter, which no cookie signed with the old value matches.
 */
export function signSession(userId: string, secret: string, version = 0): string {
  return jwt.sign({ sv: version }, secret, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: SESSION_MAX_AGE_SEC,
  })
}

/**
 * Returns the user id and the session version, for a valid, unexpired token signed with `secret`;
 * otherwise null. A token without a version (issued before the counter existed) reads as 0.
 */
export function verifySession(
  token: string,
  secret: string,
): { userId: string; version: number } | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] })
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || payload.sub === '') {
      return null
    }
    const version: unknown = payload['sv']
    return { userId: payload.sub, version: typeof version === 'number' ? version : 0 }
  } catch {
    return null
  }
}

export function setSessionCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC * 1000,
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' })
}
