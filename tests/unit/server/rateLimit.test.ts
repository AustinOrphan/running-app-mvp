import express from 'express'
import { pino } from 'pino'
import request from 'supertest'
import { describe, expect, test } from 'vitest'
import type { Config } from '../../../server/config.ts'
import { errorHandler } from '../../../server/errors.ts'
import {
  NON_PRODUCTION_API_LIMIT,
  PRODUCTION_API_LIMIT,
  apiLimitFor,
  createGlobalLimiter,
} from '../../../server/auth/rateLimit.ts'

/** The `ratelimit-policy` header (`<limit>;w=<window seconds>`) that a global limiter sets. */
async function policyOf(opts: Parameters<typeof createGlobalLimiter>[0]): Promise<string> {
  const app = express()
  app.get('/api/ping', createGlobalLimiter(opts), (_req, res) => {
    res.sendStatus(204)
  })
  app.use(errorHandler(pino({ level: 'silent' })))
  const res = await request(app).get('/api/ping')
  expect(res.status).toBe(204)
  return String(res.headers['ratelimit-policy'])
}

describe('the API limiter budget', () => {
  test('is 1000 requests per window in production and 20000 in any other NODE_ENV', () => {
    expect(PRODUCTION_API_LIMIT).toBe(1000)
    expect(NON_PRODUCTION_API_LIMIT).toBe(20_000)
    const envs: Config['nodeEnv'][] = ['production', 'development', 'test']
    expect(envs.map((env) => apiLimitFor(env))).toEqual([1000, 20_000, 20_000])
  })

  test('the limiter applies it: 1000 in production, 20000 in development and test', async () => {
    expect(await policyOf({ nodeEnv: 'production' })).toBe('1000;w=900')
    expect(await policyOf({ nodeEnv: 'development' })).toBe('20000;w=900')
    expect(await policyOf({ nodeEnv: 'test' })).toBe('20000;w=900')
  })

  test('an unset NODE_ENV counts as production, and an explicit max wins over both', async () => {
    expect(await policyOf({})).toBe('1000;w=900')
    expect(await policyOf({ nodeEnv: 'development', max: 5 })).toBe('5;w=900')
    expect(await policyOf({ nodeEnv: 'production', max: 5 })).toBe('5;w=900')
  })
})
