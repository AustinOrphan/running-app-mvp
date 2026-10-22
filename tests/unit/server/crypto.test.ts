import { describe, expect, it } from 'vitest'
import {
  decryptSecret,
  encryptSecret,
  hashToken,
  newToken,
  SecretError,
  tokensEqual,
} from '../../../server/crypto.ts'

const SECRET = 'test-only-session-secret-0123456789abcdef'

describe('encryptSecret and decryptSecret', () => {
  it('round-trips text', () => {
    const blob = encryptSecret('{"apiKey":"k-123"}', SECRET)
    expect(blob).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]*$/)
    expect(blob).not.toContain('k-123')
    expect(decryptSecret(blob, SECRET)).toBe('{"apiKey":"k-123"}')
  })

  it('round-trips the empty string and non-ASCII text', () => {
    expect(decryptSecret(encryptSecret('', SECRET), SECRET)).toBe('')
    expect(decryptSecret(encryptSecret('clé ✓', SECRET), SECRET)).toBe('clé ✓')
  })

  it('throws SecretError when the tag is tampered with', () => {
    const [version, iv, tag = '', data] = encryptSecret('hello', SECRET).split('.')
    const flipped = `${tag.startsWith('A') ? 'B' : 'A'}${tag.slice(1)}`
    expect(() => decryptSecret([version, iv, flipped, data].join('.'), SECRET)).toThrow(SecretError)
  })

  it('throws SecretError for another session secret', () => {
    const blob = encryptSecret('hello', SECRET)
    expect(() => decryptSecret(blob, `${SECRET}-rotated`)).toThrow(SecretError)
  })

  it('throws SecretError for malformed blobs', () => {
    for (const blob of ['', 'v1.a.b', 'v2.a.b.c', 'v1...', 'plain text']) {
      expect(() => decryptSecret(blob, SECRET)).toThrow(SecretError)
    }
  })

  it('produces a different blob for each encryption of the same text', () => {
    expect(encryptSecret('same', SECRET)).not.toBe(encryptSecret('same', SECRET))
  })
})

describe('tokens', () => {
  it('generates distinct 32-byte base64url tokens', () => {
    const a = newToken()
    expect(a).toMatch(/^[\w-]{43}$/)
    expect(newToken()).not.toBe(a)
  })

  it('hashes to the SHA-256 hex digest', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('compares tokens without throwing on a length mismatch', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true)
    expect(tokensEqual('abc', 'abd')).toBe(false)
    expect(tokensEqual('abc', 'abcd')).toBe(false)
  })
})
