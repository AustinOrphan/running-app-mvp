import bcrypt from 'bcryptjs'
import express from 'express'
import jwt from 'jsonwebtoken'
import { pino } from 'pino'
import request from 'supertest'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { setPasswordByEmail } from '../../server/auth/password.ts'
import { createLoginLimiter } from '../../server/auth/rateLimit.ts'
import { errorHandler } from '../../server/errors.ts'
import { client, createTestCtx, seedUser, type TestCtx } from './helpers.ts'

const PASSWORD = 'correct horse battery staple'
const SLOW = 30_000

const open: TestCtx[] = []

async function ctxFor(overrides: Parameters<typeof createTestCtx>[0] = {}): Promise<TestCtx> {
  const ctx = await createTestCtx(overrides)
  open.push(ctx)
  return ctx
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((ctx) => ctx.close()))
})

function setupBody(overrides: Record<string, unknown> = {}) {
  return { email: 'runner@example.com', password: PASSWORD, ...overrides }
}

function issuePaths(body: unknown): string[] {
  const details = (body as { error?: { details?: { issues?: Array<{ path: string }> } } }).error
    ?.details
  return (details?.issues ?? []).map((issue) => issue.path)
}

test('GET /api/setup flips after the first account', async () => {
  const ctx = await ctxFor()
  const before = await client(ctx).get('/api/setup')
  expect(before.body).toEqual({ needsSetup: true })
  const created = await client(ctx).post('/api/setup').send(setupBody())
  expect(created.status).toBe(201)
  const after = await client(ctx).get('/api/setup')
  expect(after.body).toEqual({ needsSetup: false })
})

test(
  'POST /api/setup creates the account and a 30-day httpOnly SameSite=Lax cookie',
  async () => {
    const ctx = await ctxFor()
    const res = await client(ctx)
      .post('/api/setup')
      .send(setupBody({ email: '  Runner@Example.com ', displayName: 'Sam' }))
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.any(String) as string,
      email: 'runner@example.com',
      displayName: 'Sam',
      units: 'mi',
    })
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')

    const cookie = (res.headers['set-cookie'] as unknown as string[]).join('; ')
    expect(cookie).toContain('rl_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=2592000')
    expect(cookie).not.toContain('Secure')

    const other = await ctxFor()
    const secure = await client(other)
      .post('/api/setup')
      .set('x-forwarded-proto', 'https')
      .send(setupBody())
    expect((secure.headers['set-cookie'] as unknown as string[]).join('; ')).toContain('Secure')
  },
  SLOW,
)

test(
  'setup is closed after the first account unless ALLOW_REGISTRATION is true',
  async () => {
    const closed = await ctxFor()
    await seedUser(closed)
    const refused = await client(closed)
      .post('/api/setup')
      .send(setupBody({ email: 'b@example.com' }))
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ error: { code: 'conflict' } })

    const openCtx = await ctxFor({ allowRegistration: true })
    await seedUser(openCtx)
    const accepted = await client(openCtx)
      .post('/api/setup')
      .send(setupBody({ email: 'b@example.com' }))
    expect(accepted.status).toBe(201)
    const duplicate = await client(openCtx)
      .post('/api/setup')
      .send(setupBody({ email: 'B@Example.com' }))
    expect(duplicate.status).toBe(409)
    expect(duplicate.body).toMatchObject({ error: { code: 'conflict' } })
  },
  SLOW,
)

test(
  'password rules',
  async () => {
    const ctx = await ctxFor({ allowRegistration: true })
    let n = 0
    const post = (body: Record<string, unknown>) =>
      client(ctx)
        .post('/api/setup')
        .send({ email: `runner${++n}@example.com`, ...body })

    const short = await post({ password: 'x'.repeat(11) })
    expect(short.status).toBe(400)
    expect(short.body).toMatchObject({ error: { code: 'validation' } })
    expect(issuePaths(short.body)).toEqual(['password'])
    expect(JSON.stringify(short.body)).toContain('Use at least 12 characters.')

    expect((await post({ password: 'x'.repeat(12) })).status).toBe(201)
    // Characters, not bytes, count toward the minimum: 12 emoji are 48 bytes.
    expect((await post({ password: '🏃'.repeat(12) })).status).toBe(201)
    // 18 emoji are exactly 72 bytes; 19 are 76.
    expect((await post({ password: '🏃'.repeat(18) })).status).toBe(201)
    const tooManyBytes = await post({ password: '🏃'.repeat(19) })
    expect(tooManyBytes.status).toBe(400)
    expect(issuePaths(tooManyBytes.body)).toEqual(['password'])
    expect(JSON.stringify(tooManyBytes.body)).toContain(
      'Use at most 72 bytes; shorten the password.',
    )

    const long = await post({ password: 'a'.repeat(73) })
    expect(long.status).toBe(400)
    expect(long.body).toMatchObject({ error: { code: 'validation' } })

    const badEmail = await post({ email: 'not-an-email', password: PASSWORD })
    expect(badEmail.status).toBe(400)
    expect(issuePaths(badEmail.body)).toEqual(['email'])

    const missing = await client(ctx).post('/api/setup').send({})
    expect(missing.status).toBe(400)
    expect(issuePaths(missing.body).sort()).toEqual(['email', 'password'])
  },
  SLOW,
)

test(
  'hash cost',
  async () => {
    const ctx = await ctxFor()
    const res = await client(ctx).post('/api/setup').send(setupBody())
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'runner@example.com' } })
    expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/)

    const login = await client(ctx)
      .post('/api/auth/login')
      .send({ email: 'runner@example.com', password: PASSWORD })
    const me = await client(ctx)
      .get('/api/auth/me')
      .set('Cookie', `rl_session=${cookieValue(login.headers['set-cookie'])}`)
    for (const response of [res, login, me]) {
      expect(JSON.stringify(response.body)).not.toContain(row.passwordHash)
      expect(JSON.stringify(response.body)).not.toContain('passwordHash')
    }
  },
  SLOW,
)

function cookieValue(setCookie: unknown): string {
  const header = (setCookie as string[]).find((line) => line.startsWith('rl_session='))
  const value = header?.split(';')[0]?.slice('rl_session='.length)
  if (!value) throw new Error('no rl_session cookie')
  return value
}

test(
  'login success and failure share one message',
  async () => {
    const ctx = await ctxFor()
    await seedUser(ctx)

    const ok = await client(ctx)
      .post('/api/auth/login')
      .send({ email: 'runner@example.com', password: PASSWORD })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ email: 'runner@example.com', units: 'mi' })
    expect(ok.body).not.toHaveProperty('passwordHash')
    expect((ok.headers['set-cookie'] as unknown as string[]).join('; ')).toContain('rl_session=')

    const caseInsensitive = await client(ctx)
      .post('/api/auth/login')
      .send({ email: ' RUNNER@Example.com ', password: PASSWORD })
    expect(caseInsensitive.status).toBe(200)

    const wrongPassword = await client(ctx)
      .post('/api/auth/login')
      .send({ email: 'runner@example.com', password: 'not the password' })
    const unknownEmail = await client(ctx)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD })
    const expected = { error: { code: 'unauthorized', message: 'Invalid email or password' } }
    expect(wrongPassword.status).toBe(401)
    expect(wrongPassword.body).toEqual(expected)
    expect(unknownEmail.status).toBe(401)
    expect(unknownEmail.body).toEqual(expected)
    expect(wrongPassword.headers['set-cookie']).toBeUndefined()

    // bcrypt reads only 72 bytes: the stored 72-byte password plus a suffix must not sign in.
    const full = 'p'.repeat(72)
    expect(await setPasswordByEmail(ctx.prisma, 'runner@example.com', full)).toBe(true)
    const exact = await client(ctx)
      .post('/api/auth/login')
      .send({ email: 'runner@example.com', password: full })
    expect(exact.status).toBe(200)
    const extended = await client(ctx)
      .post('/api/auth/login')
      .send({ email: 'runner@example.com', password: `${full}-suffix` })
    expect(extended.status).toBe(401)
    expect(extended.body).toEqual(expected)
  },
  SLOW,
)

describe('rate limit: 10 attempts per 15 minutes per IP', () => {
  const MINUTE = 60_000

  test('limiter unit test with a mocked clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const app = express()
      app.post('/login', createLoginLimiter(), (_req, res) => {
        res.sendStatus(204)
      })
      app.use(errorHandler(pino({ level: 'silent' })))

      for (let attempt = 1; attempt <= 10; attempt++) {
        expect((await request(app).post('/login')).status).toBe(204)
      }
      const blocked = await request(app).post('/login')
      expect(blocked.status).toBe(429)
      expect(blocked.body).toMatchObject({
        error: { code: 'unauthorized', details: { retryAfterSec: 900 } },
      })
      expect(blocked.headers['retry-after']).toBe('900')
      expect(blocked.headers['ratelimit-policy']).toBe('10;w=900')

      vi.advanceTimersByTime(14 * MINUTE + 59_000)
      const stillBlocked = await request(app).post('/login')
      expect(stillBlocked.status).toBe(429)
      expect(stillBlocked.headers['retry-after']).toBe('1')

      vi.advanceTimersByTime(1_000)
      expect((await request(app).post('/login')).status).toBe(204)
    } finally {
      vi.useRealTimers()
    }
  })

  test('each limiter keeps its own counter', async () => {
    const make = () => {
      const app = express()
      app.post('/login', createLoginLimiter({ max: 1 }), (_req, res) => {
        res.sendStatus(204)
      })
      app.use(errorHandler(pino({ level: 'silent' })))
      return app
    }
    const first = make()
    expect((await request(first).post('/login')).status).toBe(204)
    expect((await request(first).post('/login')).status).toBe(429)
    expect((await request(make()).post('/login')).status).toBe(204)
  })

  test('POST /api/setup shares the sign-in budget', async () => {
    const ctx = await ctxFor({ allowRegistration: true })
    for (let i = 0; i < 10; i++) {
      await client(ctx).post('/api/setup').send({})
    }
    const res = await client(ctx).post('/api/setup').send(setupBody())
    expect(res.status).toBe(429)
  })

  test('integration: the 11th bad login is 429', async () => {
    const ctx = await ctxFor()
    await seedUser(ctx)
    const attempt = () =>
      client(ctx).post('/api/auth/login').send({ email: 'runner@example.com', password: 'wrong' })
    for (let i = 0; i < 10; i++) {
      expect((await attempt()).status).toBe(401)
    }
    const res = await attempt()
    expect(res.status).toBe(429)
    expect(res.body).toMatchObject({ error: { code: 'unauthorized' } })
    expect(res.headers['retry-after']).toBeTruthy()
  })
})

test('logout clears the cookie and works without a session', async () => {
  const ctx = await ctxFor()
  const user = await seedUser(ctx)
  for (const res of [
    await client(ctx, user).post('/api/auth/logout'),
    await client(ctx).post('/api/auth/logout'),
  ]) {
    expect(res.status).toBe(204)
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join('; ')
    expect(cookie).toContain('rl_session=;')
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970')
  }
})

test('me', async () => {
  const ctx = await ctxFor()
  const user = await seedUser(ctx)
  const secret = ctx.config.sessionSecret
  const sub = user.id
  const getMe = (token?: string) =>
    client(ctx, token === undefined ? undefined : { ...user, cookie: `rl_session=${token}` }).get(
      '/api/auth/me',
    )

  const valid = await client(ctx, user).get('/api/auth/me')
  expect(valid.status).toBe(200)
  expect(valid.body).toEqual({
    id: user.id,
    email: 'runner@example.com',
    displayName: null,
    units: 'mi',
  })

  const noneToken = [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
      'base64url',
    ),
    '',
  ].join('.')
  // HS512 with the right secret is still refused: only HS256 is accepted.
  const hs512 = jwt.sign({ sub }, secret, { algorithm: 'HS512', expiresIn: 3600 })

  const rejected = [
    await getMe(),
    await getMe('garbage'),
    await getMe(jwt.sign({ sub }, 'a-different-secret-a-different-secret-1', { expiresIn: 3600 })),
    await getMe(jwt.sign({ sub, exp: Math.floor(Date.now() / 1000) - 60 }, secret)),
    await getMe(noneToken),
    await getMe(hs512),
  ]
  for (const res of rejected) {
    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ error: { code: 'unauthorized' } })
  }

  await ctx.prisma.user.delete({ where: { id: user.id } })
  const deleted = await client(ctx, user).get('/api/auth/me')
  expect(deleted.status).toBe(401)
})

test('same-origin guard', async () => {
  const ctx = await ctxFor()
  const post = () => request(ctx.app).post('/api/auth/logout').set('Host', 'app.test')

  expect((await post()).status).toBe(403)
  expect((await post().set('Origin', 'http://evil.example')).status).toBe(403)
  expect((await post().set('Origin', 'http://app.test')).status).toBe(204)
  expect((await post().set('Sec-Fetch-Site', 'same-origin')).status).toBe(204)
  expect((await post().set('Sec-Fetch-Site', 'cross-site')).status).toBe(403)
  expect((await request(ctx.app).get('/api/setup')).status).toBe(200)
})

test(
  'setPasswordByEmail',
  async () => {
    const ctx = await ctxFor()
    await seedUser(ctx)
    const next = 'a-brand-new-password-123'

    expect(await setPasswordByEmail(ctx.prisma, 'Runner@Example.com', next)).toBe(true)
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'runner@example.com' } })
    expect(await bcrypt.compare(next, row.passwordHash)).toBe(true)
    expect(await bcrypt.compare(PASSWORD, row.passwordHash)).toBe(false)
    expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/)

    const newLogin = await client(ctx)
      .post('/api/auth/login')
      .send({ email: 'runner@example.com', password: next })
    expect(newLogin.status).toBe(200)
    const oldLogin = await client(ctx)
      .post('/api/auth/login')
      .send({ email: 'runner@example.com', password: PASSWORD })
    expect(oldLogin.status).toBe(401)

    expect(await setPasswordByEmail(ctx.prisma, 'nobody@example.com', next)).toBe(false)
    await expect(
      setPasswordByEmail(ctx.prisma, 'runner@example.com', 'short'),
    ).rejects.toMatchObject({ code: 'validation' })
  },
  SLOW,
)
