import { describe, expect, test } from 'vitest'
import { loadConfig } from '../../../server/config.ts'

const SECRET = 'x'.repeat(32)

describe('loadConfig', () => {
  test('applies defaults when only SESSION_SECRET is set', () => {
    expect(loadConfig({ SESSION_SECRET: SECRET })).toEqual({
      databaseUrl: 'file:./data/app.db',
      sessionSecret: SECRET,
      port: 3001,
      nodeEnv: 'development',
      allowRegistration: false,
      logLevel: 'info',
    })
  })

  test('requires a SESSION_SECRET of at least 32 characters', () => {
    expect(() => loadConfig({})).toThrow(/SESSION_SECRET/)
    expect(() => loadConfig({ SESSION_SECRET: 'x'.repeat(31) })).toThrow(/SESSION_SECRET/)
  })

  test('treats an empty value as unset', () => {
    const config = loadConfig({ SESSION_SECRET: SECRET, PORT: '', DATABASE_URL: '' })
    expect(config.port).toBe(3001)
    expect(config.databaseUrl).toBe('file:./data/app.db')
  })

  test('parses ALLOW_REGISTRATION strictly', () => {
    expect(
      loadConfig({ SESSION_SECRET: SECRET, ALLOW_REGISTRATION: 'true' }).allowRegistration,
    ).toBe(true)
    expect(() => loadConfig({ SESSION_SECRET: SECRET, ALLOW_REGISTRATION: '1' })).toThrow(
      /ALLOW_REGISTRATION/,
    )
  })

  test('rejects a non-numeric PORT and an unknown NODE_ENV', () => {
    expect(() => loadConfig({ SESSION_SECRET: SECRET, PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadConfig({ SESSION_SECRET: SECRET, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/)
  })
})
