import type { Response } from 'express'
import jwt from 'jsonwebtoken'

export const SESSION_COOKIE = 'rl_session'
export const SESSION_MAX_AGE_SEC = 2_592_000 // 30 days

export function signSession(userId: string, secret: string): string {
  return jwt.sign({}, secret, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: SESSION_MAX_AGE_SEC,
  })
}

/** Returns the user id for a valid, unexpired token signed with `secret`; otherwise null. */
export function verifySession(token: string, secret: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] })
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || payload.sub === '') {
      return null
    }
    return { userId: payload.sub }
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
