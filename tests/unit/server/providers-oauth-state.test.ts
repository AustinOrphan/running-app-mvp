import { describe, expect, it } from 'vitest'
import { signState, verifyState } from '../../../server/providers/oauthState.ts'

const SECRET = 'test-only-session-secret-0123456789abcdef'
const NOW = new Date('2026-10-22T10:00:00Z')

describe('oauth state', () => {
  it('round-trips the user id', () => {
    const state = signState('user-1', SECRET, NOW)
    expect(verifyState(state, SECRET, NOW)).toBe('user-1')
  })

  it('carries a user id that contains dots', () => {
    const state = signState('a.b.c', SECRET, NOW)
    expect(verifyState(state, SECRET, NOW)).toBe('a.b.c')
  })

  it('differs between calls (nonce)', () => {
    expect(signState('user-1', SECRET, NOW)).not.toBe(signState('user-1', SECRET, NOW))
  })

  it('is valid for 10 minutes and not beyond', () => {
    const state = signState('user-1', SECRET, NOW)
    expect(verifyState(state, SECRET, new Date(NOW.getTime() + 10 * 60_000))).toBe('user-1')
    expect(verifyState(state, SECRET, new Date(NOW.getTime() + 10 * 60_000 + 1))).toBeNull()
  })

  it('rejects a state from the future', () => {
    const state = signState('user-1', SECRET, NOW)
    expect(verifyState(state, SECRET, new Date(NOW.getTime() - 1000))).toBeNull()
  })

  it('rejects another secret, tampering and malformed input', () => {
    const state = signState('user-1', SECRET, NOW)
    expect(verifyState(state, `${SECRET}-rotated`, NOW)).toBeNull()
    const [, ...rest] = state.split('.')
    const forged = [Buffer.from('user-2').toString('base64url'), ...rest].join('.')
    expect(verifyState(forged, SECRET, NOW)).toBeNull()
    for (const bad of ['', 'abc', 'a.b.c', 'a.b.c.d.e', `${state}x`]) {
      expect(verifyState(bad, SECRET, NOW)).toBeNull()
    }
  })
})
