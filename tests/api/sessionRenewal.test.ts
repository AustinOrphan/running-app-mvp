import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, describe, expect, test } from 'vitest'
import {
  SESSION_ABSOLUTE_MAX_AGE_SEC,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  signSession,
} from '../../server/auth/session.ts'
import { createTestCtx, expectNoRefusedFetches, seedUser, type TestCtx } from './helpers.ts'

const DAY = 86_400
const PASSWORD = 'correct horse battery staple'
const open: TestCtx[] = []

afterEach(async () => {
  for (const ctx of open) expectNoRefusedFetches(ctx)
  await Promise.all(open.splice(0).map((ctx) => ctx.close()))
})

async function setup(appOpts: Parameters<typeof createTestCtx>[1] = {}) {
  const ctx = await createTestCtx({}, appOpts)
  open.push(ctx)
  const user = await seedUser(ctx)
  return { ctx, user }
}

const nowSec = () => Math.floor(Date.now() / 1000)

function me(ctx: TestCtx, token: string, path = '/api/auth/me') {
  return request(ctx.app)
    .get(path)
    .set('Host', 'app.test')
    .set('Cookie', `${SESSION_COOKIE}=${token}`)
}

function setCookieLines(res: request.Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []
}

function renewedToken(res: request.Response): string | null {
  const line = setCookieLines(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))
  return line ? (line.split(';')[0]!.split('=')[1] ?? null) : null
}

function claims(token: string) {
  return jwt.decode(token) as { iat: number; exp: number; sat: number; sv: number }
}

describe('sliding session (SS1)', () => {
  test('a cookie older than 24 h is renewed with a later iat and the same sign-in time', async () => {
    const { ctx, user } = await setup()
    const signedIn = nowSec() - 10 * DAY
    const old = signSession(user.id, ctx.config.sessionSecret, 0, {
      signedInAt: signedIn,
      now: signedIn,
    })
    const res = await me(ctx, old)
    expect(res.status).toBe(200)
    const token = renewedToken(res)
    expect(token).not.toBeNull()
    const c = claims(token!)
    expect(c.iat).toBeGreaterThan(claims(old).iat)
    expect(c.sat).toBe(signedIn)
    expect(c.exp - c.iat).toBe(SESSION_MAX_AGE_SEC)
    const line = setCookieLines(res)[0]!
    expect(line).toMatch(/HttpOnly/)
    expect(line).toMatch(/SameSite=Lax/)
    expect(line).toMatch(/Max-Age=2592000/)
    expect(line).not.toMatch(/Secure/)
  })

  test('the renewed cookie keeps the Secure flag behind https', async () => {
    const { ctx, user } = await setup()
    const old = signSession(user.id, ctx.config.sessionSecret, 0, { now: nowSec() - 2 * DAY })
    const res = await me(ctx, old).set('X-Forwarded-Proto', 'https')
    expect(setCookieLines(res)[0]).toMatch(/Secure/)
  })

  test('a fresh cookie gets no Set-Cookie', async () => {
    const { ctx, user } = await setup()
    const res = await request(ctx.app)
      .get('/api/auth/me')
      .set('Host', 'app.test')
      .set('Cookie', user.cookie)
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  test('a cookie near the cap is renewed only up to the cap', async () => {
    const { ctx, user } = await setup()
    const signedIn = nowSec() - (SESSION_ABSOLUTE_MAX_AGE_SEC - 5 * DAY)
    // Issued 27 days ago, so its own end (3 days out) is short of the cap (5 days out).
    const old = signSession(user.id, ctx.config.sessionSecret, 0, {
      signedInAt: signedIn,
      now: nowSec() - 27 * DAY,
    })
    const res = await me(ctx, old)
    expect(res.status).toBe(200)
    const c = claims(renewedToken(res)!)
    expect(c.sat).toBe(signedIn)
    expect(c.exp).toBe(signedIn + SESSION_ABSOLUTE_MAX_AGE_SEC)
    expect(c.exp - nowSec()).toBeLessThan(SESSION_MAX_AGE_SEC)
    expect(setCookieLines(res)[0]).toMatch(/Max-Age=\d+/)
  })

  test('a cookie that reached the cap is refused and not renewed', async () => {
    const { ctx, user } = await setup()
    const signedIn = nowSec() - SESSION_ABSOLUTE_MAX_AGE_SEC - 60
    const token = signSession(user.id, ctx.config.sessionSecret, 0, {
      signedInAt: signedIn,
      now: nowSec() - 2 * DAY,
    })
    expect(claims(token).exp).toBe(signedIn + SESSION_ABSOLUTE_MAX_AGE_SEC)
    const res = await me(ctx, token)
    expect(res.status).toBe(401)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  test('a cookie already ending at the cap is not renewed', async () => {
    const { ctx, user } = await setup()
    const signedIn = nowSec() - SESSION_ABSOLUTE_MAX_AGE_SEC + 3600
    const token = signSession(user.id, ctx.config.sessionSecret, 0, {
      signedInAt: signedIn,
      now: nowSec() - 2 * DAY,
    })
    expect(claims(token).exp).toBe(signedIn + SESSION_ABSOLUTE_MAX_AGE_SEC)
    const res = await me(ctx, token)
    expect(res.status).toBe(200)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  test('a changed sessionVersion is still refused, old or fresh', async () => {
    const { ctx, user } = await setup()
    await ctx.prisma.user.update({ where: { id: user.id }, data: { sessionVersion: 1 } })
    const old = signSession(user.id, ctx.config.sessionSecret, 0, { now: nowSec() - 5 * DAY })
    const res = await me(ctx, old)
    expect(res.status).toBe(401)
    expect(res.headers['set-cookie']).toBeUndefined()
    expect((await me(ctx, signSession(user.id, ctx.config.sessionSecret, 0))).status).toBe(401)
  })

  test('a cookie from before the claim reads iat as the sign-in time', async () => {
    const { ctx, user } = await setup()
    const iat = nowSec() - 10 * DAY
    const legacy = jwt.sign({ sv: 0, iat }, ctx.config.sessionSecret, {
      algorithm: 'HS256',
      subject: user.id,
      expiresIn: SESSION_MAX_AGE_SEC,
    })
    expect(claims(legacy).sat).toBeUndefined()
    const res = await me(ctx, legacy)
    expect(res.status).toBe(200)
    const c = claims(renewedToken(res)!)
    expect(c.sat).toBe(iat)
    expect(c.exp - c.iat).toBe(SESSION_MAX_AGE_SEC)
  })

  test('the user limiter still counts a renewing request', async () => {
    // `/api/auth/me` sits above the user limiter; `/api/settings` is counted by it.
    const { ctx, user } = await setup({ userLimit: 2 })
    const old = () => signSession(user.id, ctx.config.sessionSecret, 0, { now: nowSec() - 3 * DAY })
    expect((await me(ctx, old(), '/api/settings')).status).toBe(200)
    expect((await me(ctx, old(), '/api/settings')).status).toBe(200)
    expect((await me(ctx, old(), '/api/settings')).status).toBe(429)
  })

  test('sign-in sets sat equal to iat', async () => {
    const { ctx, user } = await setup()
    const res = await request(ctx.app)
      .post('/api/auth/login')
      .set('Host', 'app.test')
      .set('Origin', 'http://app.test')
      .send({ email: user.email, password: PASSWORD })
    expect(res.status).toBe(200)
    const c = claims(renewedToken(res)!)
    expect(c.sat).toBe(c.iat)
  })
})
