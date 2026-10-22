import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const MAX_AGE_MS = 10 * 60_000
const DOMAIN = 'rl-oauth-state-v1'

function mac(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(DOMAIN)
    .update('\0')
    .update(payload)
    .digest('base64url')
}

/**
 * An HMAC-signed `state` carrying the user id and a nonce; valid for 10 minutes.
 * Format: `<userId b64url>.<issued ms>.<nonce>.<mac>`.
 */
export function signState(userId: string, secret: string, now: Date): string {
  const payload = [
    Buffer.from(userId, 'utf8').toString('base64url'),
    String(now.getTime()),
    randomBytes(12).toString('base64url'),
  ].join('.')
  return `${payload}.${mac(payload, secret)}`
}

/** The user id inside a valid, unexpired `state`; null otherwise. */
export function verifyState(state: string, secret: string, now: Date): string | null {
  const parts = state.split('.')
  if (parts.length !== 4) return null
  const [id = '', issued = '', nonce = '', signature = ''] = parts
  if (id === '' || nonce === '' || !/^\d{1,16}$/.test(issued)) return null
  const expected = Buffer.from(mac(`${id}.${issued}.${nonce}`, secret))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  const age = now.getTime() - Number(issued)
  if (age < 0 || age > MAX_AGE_MS) return null
  return Buffer.from(id, 'base64url').toString('utf8')
}
