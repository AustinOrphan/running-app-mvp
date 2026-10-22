import { describe, expect, it } from 'vitest'
import { HttpError } from '../../../server/errors.ts'
import { getProvider, PROVIDERS } from '../../../server/providers/registry.ts'
import { RateLimitPause } from '../../../server/providers/types.ts'

describe('provider registry', () => {
  it('lists the five providers of this release in display order', () => {
    expect(Object.keys(PROVIDERS)).toEqual([
      'intervals',
      'strava',
      'garmin',
      'apple-health',
      'folder',
    ])
  })

  it('keys every entry by its info.key and gives each a label and docs link', () => {
    for (const [key, provider] of Object.entries(PROVIDERS)) {
      expect(provider.info.key).toBe(key)
      expect(provider.info.label).not.toBe('')
      expect(provider.info.docsUrl).toMatch(/^https:\/\//)
    }
  })

  it('declares channels, wellness and the experimental flag as spec 2.6.1 does', () => {
    const summary = Object.fromEntries(
      Object.entries(PROVIDERS).map(([key, { info }]) => [
        key,
        [info.channels, info.wellness, info.experimental],
      ]),
    )
    expect(summary).toEqual({
      intervals: [['pull'], true, false],
      strava: [['pull'], false, false],
      garmin: [['pull'], true, true],
      'apple-health': [['push', 'upload'], true, false],
      folder: [['folder'], false, false],
    })
  })

  it('implements a module for each pull and push channel it declares', () => {
    for (const { info, pull, push } of Object.values(PROVIDERS)) {
      expect(Boolean(pull)).toBe(info.channels.includes('pull'))
      expect(Boolean(push)).toBe(info.channels.includes('push'))
    }
  })

  it('returns a provider by key and throws notFound otherwise', () => {
    expect(getProvider('strava').info.label).toBe('Strava')
    expect(() => getProvider('nope')).toThrow(HttpError)
    expect(() => getProvider('__proto__')).toThrow(HttpError)
    expect(() => getProvider('toString')).toThrow(HttpError)
  })
})

describe('RateLimitPause', () => {
  it('carries the retry delay and an optional cursor', () => {
    const pause = new RateLimitPause('slow down', { retryAfterSec: 21600, cursor: '2026-01-01' })
    expect(pause).toBeInstanceOf(Error)
    expect(pause.name).toBe('RateLimitPause')
    expect(pause.retryAfterSec).toBe(21600)
    expect(pause.cursor).toBe('2026-01-01')
    expect(new RateLimitPause('x', { retryAfterSec: 1 }).cursor).toBeUndefined()
  })
})
