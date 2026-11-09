import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { afterEach, describe, expect, test } from 'vitest'
import { setPasswordByEmail } from '../../server/auth/password.ts'
import { signSession } from '../../server/auth/session.ts'
import { client, createTestCtx, seedUser, type TestCtx } from './helpers.ts'

const CURRENT = 'correct horse battery staple'
const NEXT = 'a brand new passphrase'
const SLOW = 30_000

const open: TestCtx[] = []

async function ctxFor(): Promise<TestCtx> {
  const ctx = await createTestCtx()
  open.push(ctx)
  return ctx
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((ctx) => ctx.close()))
})

function issuePaths(body: unknown): string[] {
  const details = (body as { error?: { details?: { issues?: Array<{ path: string }> } } }).error
    ?.details
  return (details?.issues ?? []).map((issue) => issue.path)
}

function flagOf(response: { body: unknown }): unknown {
  return (response.body as { mustChangePassword?: unknown }).mustChangePassword
}

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'] as string[] | undefined
  const pair = header?.[0]?.split(';')[0]
  if (!pair) throw new Error('no session cookie was set')
  return pair
}

describe('PUT /api/auth/password', () => {
  test('needs a session, the same origin and a body in the 16 KB limit', async () => {
    const ctx = await ctxFor()
    const user = await seedUser(ctx)
    const body = { currentPassword: CURRENT, newPassword: NEXT }
    expect((await client(ctx).put('/api/auth/password').send(body)).status).toBe(401)
    const crossSite = await client(ctx, user)
      .put('/api/auth/password')
      .set('Origin', 'http://elsewhere.test')
      .set('Sec-Fetch-Site', 'cross-site')
      .send(body)
    expect(crossSite.status).toBe(403)
    const big = await client(ctx, user)
      .put('/api/auth/password')
      .send({ ...body, filler: 'x'.repeat(20_000) })
    expect(big.status).toBe(413)
  })

  test('a wrong current password is a field error and changes nothing', async () => {
    const ctx = await ctxFor()
    const user = await seedUser(ctx)
    const before = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    const response = await client(ctx, user)
      .put('/api/auth/password')
      .send({ currentPassword: 'not the one at all', newPassword: NEXT })
    expect(response.status).toBe(400)
    expect(issuePaths(response.body)).toEqual(['currentPassword'])
    const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.passwordHash).toBe(before.passwordHash)
  })

  test('a weak new password is refused with the schema message', async () => {
    const ctx = await ctxFor()
    const user = await seedUser(ctx)
    const response = await client(ctx, user)
      .put('/api/auth/password')
      .send({ currentPassword: CURRENT, newPassword: 'short' })
    expect(response.status).toBe(400)
    expect(issuePaths(response.body)).toEqual(['newPassword'])
    expect(JSON.stringify(response.body)).toContain('at least 12 characters')
  })

  test('the same password again is refused', async () => {
    const ctx = await ctxFor()
    const user = await seedUser(ctx)
    const response = await client(ctx, user)
      .put('/api/auth/password')
      .send({ currentPassword: CURRENT, newPassword: CURRENT })
    expect(response.status).toBe(400)
    expect(issuePaths(response.body)).toEqual(['newPassword'])
  })

  test(
    'success stores the new password, clears the flag and keeps this session signed in',
    async () => {
      const ctx = await ctxFor()
      const user = await seedUser(ctx)
      await ctx.prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } })
      const me = await client(ctx, user).get('/api/auth/me')
      expect(flagOf(me)).toBe(true)

      const response = await client(ctx, user)
        .put('/api/auth/password')
        .send({ currentPassword: CURRENT, newPassword: NEXT })
      expect(response.status).toBe(200)
      expect(flagOf(response)).toBe(false)
      expect(JSON.stringify(response.body)).not.toContain(NEXT)

      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(row.mustChangePassword).toBe(false)
      expect(await bcrypt.compare(NEXT, row.passwordHash)).toBe(true)

      // the cookie that came back signs in; the new password signs in; the old one does not
      const fresh = { ...user, cookie: cookieOf(response) }
      expect(flagOf(await client(ctx, fresh).get('/api/auth/me'))).toBe(false)
      const login = (password: string) =>
        client(ctx).post('/api/auth/login').send({ email: user.email, password })
      expect((await login(NEXT)).status).toBe(200)
      expect((await login(CURRENT)).status).toBe(401)
    },
    SLOW,
  )

  test('other sessions of the user end at once, this one stays, and another user is not touched', async () => {
    const ctx = await ctxFor()
    const user = await seedUser(ctx)
    const other = await seedUser(ctx, { email: 'other@example.com' })
    // the cookie another device holds, issued just before the change, in the same second
    const old = { ...user, cookie: `rl_session=${signSession(user.id, ctx.config.sessionSecret)}` }
    expect((await client(ctx, old).get('/api/auth/me')).status).toBe(200)

    const response = await client(ctx, user)
      .put('/api/auth/password')
      .send({ currentPassword: CURRENT, newPassword: NEXT })
    expect(response.status).toBe(200)
    const fresh = { ...user, cookie: cookieOf(response) }

    expect((await client(ctx, fresh).get('/api/auth/me')).status).toBe(200)
    expect((await client(ctx, old).get('/api/auth/me')).status).toBe(401)
    expect((await client(ctx, user).get('/api/auth/me')).status).toBe(401)
    expect((await client(ctx, other).get('/api/auth/me')).status).toBe(200)
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.sessionVersion).toBe(1)
  })

  test('a cookie with no version keeps working for an account at version 0, and a sign-in carries the version', async () => {
    const ctx = await ctxFor()
    const user = await seedUser(ctx)
    const legacy = jwt.sign({}, ctx.config.sessionSecret, { algorithm: 'HS256', subject: user.id })
    expect(
      (await client(ctx, { ...user, cookie: `rl_session=${legacy}` }).get('/api/auth/me')).status,
    ).toBe(200)

    await setPasswordByEmail(ctx.prisma, user.email, NEXT)
    expect(
      (await client(ctx, { ...user, cookie: `rl_session=${legacy}` }).get('/api/auth/me')).status,
    ).toBe(401)
    const login = await client(ctx)
      .post('/api/auth/login')
      .send({ email: user.email, password: NEXT })
    expect(login.status).toBe(200)
    expect(
      (await client(ctx, { ...user, cookie: cookieOf(login) }).get('/api/auth/me')).status,
    ).toBe(200)
  })

  test('reset-password ends every session that was open', async () => {
    const ctx = await ctxFor()
    const user = await seedUser(ctx)
    expect((await client(ctx, user).get('/api/auth/me')).status).toBe(200)
    await setPasswordByEmail(ctx.prisma, user.email, NEXT)
    expect((await client(ctx, user).get('/api/auth/me')).status).toBe(401)
  })

  test('the limiter counts refusals only, per user, and then answers 429', async () => {
    const ctx = await ctxFor()
    const user = await seedUser(ctx)
    const other = await seedUser(ctx, { email: 'other@example.com' })
    const attempt = (who: typeof user, currentPassword: string, newPassword = NEXT) =>
      client(ctx, who).put('/api/auth/password').send({ currentPassword, newPassword })

    // five refusals use the budget; the sixth attempt is stopped before it is read
    for (let i = 0; i < 5; i += 1)
      expect((await attempt(user, 'wrong wrong wrong')).status).toBe(400)
    const blocked = await attempt(user, CURRENT)
    expect(blocked.status).toBe(429)
    expect(
      (blocked.body as { error: { details: { retryAfterSec: number } } }).error.details
        .retryAfterSec,
    ).toBeGreaterThan(0)
    expect(
      bcrypt.compareSync(
        CURRENT,
        (await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash,
      ),
    ).toBe(true)

    // another account has its own budget, and a success does not use any of it
    expect((await attempt(other, CURRENT)).status).toBe(200)
  })

  test(
    'a success does not count against the budget',
    async () => {
      const ctx = await ctxFor()
      const user = await seedUser(ctx)
      let current = CURRENT
      let cookie = user.cookie
      for (let i = 0; i < 6; i += 1) {
        const next = `passphrase number ${String(i)} here`
        const response = await client(ctx, { ...user, cookie })
          .put('/api/auth/password')
          .send({ currentPassword: current, newPassword: next })
        expect(response.status).toBe(200)
        current = next
        cookie = cookieOf(response)
      }
    },
    SLOW,
  )
})
