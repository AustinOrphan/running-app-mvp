import express from 'express'
import { pino } from 'pino'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { errorHandler, parse, validationError } from '../../server/errors.ts'
import { z } from 'zod'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

let ctx: TestCtx
let user: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterAll(async () => {
  await ctx.close()
})

describe('app skeleton', () => {
  test('GET /api/health answers ok with a request id and security headers', async () => {
    const res = await client(ctx).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
    expect(res.headers['x-request-id']).toBeTruthy()
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
  })

  test('an inbound request id is echoed when it is well formed', async () => {
    const res = await client(ctx).get('/api/health').set('X-Request-Id', 'abc-123')
    expect(res.headers['x-request-id']).toBe('abc-123')
    const bad = await client(ctx).get('/api/health').set('X-Request-Id', 'bad id with spaces')
    expect(bad.headers['x-request-id']).not.toBe('bad id with spaces')
  })

  test('GET /api/setup is public and reports whether an account exists', async () => {
    const fresh = await createTestCtx()
    try {
      const before = await client(fresh).get('/api/setup')
      expect(before.status).toBe(200)
      expect(before.body).toEqual({ needsSetup: true })
      await seedUser(fresh)
      const after = await client(fresh).get('/api/setup')
      expect(after.body).toEqual({ needsSetup: false })
    } finally {
      await fresh.close()
    }
  })

  test('an unknown API path is not_found when signed in', async () => {
    const res = await client(ctx, user).get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ error: { code: 'not_found' } })
  })

  test('a protected route without a cookie is unauthorized', async () => {
    const res = await client(ctx).get('/api/settings')
    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ error: { code: 'unauthorized' } })
  })

  test('a cookie signed with another secret is unauthorized', async () => {
    const forged = { ...user, cookie: 'rl_session=not-a-real-token' }
    const res = await client(ctx, forged).get('/api/settings')
    expect(res.status).toBe(401)
  })

  test('a malformed JSON body is a validation error', async () => {
    const res = await client(ctx, user)
      .put('/api/settings')
      .set('Content-Type', 'application/json')
      .send('{"units":')
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'validation' } })
  })

  test('a 2 MB JSON body is rejected with 413 validation', async () => {
    const res = await client(ctx, user)
      .put('/api/settings')
      .send({ displayName: 'x'.repeat(2 * 1024 * 1024) })
    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ error: { code: 'validation' } })
  })

  test('a POST without Origin or Sec-Fetch-Site is forbidden', async () => {
    const res = await request(ctx.app).post('/api/activities').set('Cookie', user.cookie).send({})
    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ error: { code: 'unauthorized' } })
  })

  test('a POST from another origin is forbidden; Sec-Fetch-Site same-origin is accepted', async () => {
    const cross = await request(ctx.app)
      .post('/api/activities')
      .set('Host', 'app.test')
      .set('Origin', 'http://evil.test')
      .set('Cookie', user.cookie)
      .send({})
    expect(cross.status).toBe(403)

    const same = await request(ctx.app)
      .post('/api/activities')
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Cookie', user.cookie)
      .send({})
    expect(same.status).not.toBe(403)
  })

  test('the same-origin guard applies to a differently-cased /API path', async () => {
    for (const path of ['/API/activities', '/Api/goals', '/API/auth/logout']) {
      const res = await request(ctx.app).post(path).set('Cookie', user.cookie).send({})
      expect(res.status, path).toBe(403)
      const cross = await request(ctx.app)
        .post(path)
        .set('Host', 'app.test')
        .set('Origin', 'http://evil.example')
        .set('Cookie', user.cookie)
        .send({})
      expect(cross.status, path).toBe(403)
    }
  })
})

describe('errorHandler', () => {
  const app = express()
  app.get('/boom', () => {
    throw new Error('secret internal detail')
  })
  app.get('/invalid', () => {
    parse(z.object({ password: z.string().min(12, 'Use at least 12 characters.') }), {
      password: 'short',
    })
  })
  app.get('/custom', () => {
    throw validationError('Nope.')
  })
  app.use(errorHandler(pino({ level: 'silent' })))

  test('unknown errors become a generic 500 internal without a stack', async () => {
    const res = await request(app).get('/boom')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      error: { code: 'internal', message: 'Something went wrong on the server.' },
    })
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail')
  })

  test('parse reports every issue with a dot-joined path', async () => {
    const res = await request(app).get('/invalid')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: {
        code: 'validation',
        message: 'Some fields need attention.',
        details: { issues: [{ path: 'password', message: 'Use at least 12 characters.' }] },
      },
    })
  })

  test('HttpError keeps its status and omits absent details', async () => {
    const res = await request(app).get('/custom')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: { code: 'validation', message: 'Nope.' } })
  })
})

/** Paths that `mountStatic` serves (assets, root files, the index fallback), not the API. */
const STATIC_PATHS = [
  '/assets/index-abc123.js',
  '/assets/index-abc123.css',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/robots.txt',
  '/',
  '/some/page',
]

/** The `remaining` value of a `RateLimit: limit=…, remaining=…, reset=…` header (draft 7). */
function remainingBudget(res: { headers: Record<string, unknown> }): number {
  const header = res.headers['ratelimit']
  const match = typeof header === 'string' ? /remaining=(\d+)/.exec(header) : null
  if (!match?.[1]) throw new Error(`No ratelimit header with a remaining count: ${String(header)}`)
  return Number(match[1])
}

describe('global rate limit', () => {
  test('static files and the SPA fallback leave the budget alone, API calls spend it', async () => {
    const limited = await createTestCtx({}, { globalLimit: 20 })
    try {
      const first = remainingBudget(await client(limited).get('/api/health'))
      expect(first).toBe(19)

      for (const path of STATIC_PATHS) {
        const res = await client(limited).get(path)
        expect(res.status, path).not.toBe(429)
        expect(res.headers['ratelimit'], path).toBeUndefined()
      }
      const afterStatic = remainingBudget(await client(limited).get('/api/health'))
      // One API call since `first`, and none of the static requests.
      expect(afterStatic).toBe(first - 1)

      const afterApi = remainingBudget(await client(limited).get('/api/health'))
      expect(afterApi).toBe(afterStatic - 1)
    } finally {
      await limited.close()
    }
  })

  test('the request after the limit gets 429 with the standard error body', async () => {
    const limited = await createTestCtx({}, { globalLimit: 3 })
    try {
      for (let i = 0; i < 3; i++) {
        expect((await client(limited).get('/api/health')).status).toBe(200)
      }
      const res = await client(limited).get('/api/health')
      expect(res.status).toBe(429)
      expect(res.body).toMatchObject({
        error: { code: 'internal', details: { retryAfterSec: 900 } },
      })
      expect(res.headers['retry-after']).toBeTruthy()
      // Every API path shares the budget, including unknown ones.
      expect((await client(limited).get('/api/no-such-route')).status).toBe(429)
      expect((await client(limited).post('/api/auth/logout')).status).toBe(429)
      // The SPA fallback and the static files sit outside it.
      for (const path of STATIC_PATHS) {
        expect((await client(limited).get(path)).status, path).not.toBe(429)
      }
    } finally {
      await limited.close()
    }
  })

  test('in production the default allows 1000 requests per window and blocks the 1001st', async () => {
    const fresh = await createTestCtx({ nodeEnv: 'production' })
    try {
      const agent = client(fresh)
      for (let i = 0; i < 1000; i++) {
        const res = await agent.get('/api/health')
        if (res.status !== 200)
          throw new Error(`request ${String(i + 1)} got ${String(res.status)}`)
      }
      expect((await agent.get('/api/health')).status).toBe(429)
    } finally {
      await fresh.close()
    }
  }, 60_000)

  test('outside production the default is 20000, so the e2e suite does not reach it', async () => {
    // The Playwright server runs with NODE_ENV=development and spends about 950 requests today.
    for (const nodeEnv of ['development', 'test'] as const) {
      const fresh = await createTestCtx({ nodeEnv })
      try {
        const res = await client(fresh).get('/api/health')
        expect(res.headers['ratelimit-policy'], nodeEnv).toBe('20000;w=900')
        expect(remainingBudget(res), nodeEnv).toBe(19_999)
      } finally {
        await fresh.close()
      }
    }
  })
})
