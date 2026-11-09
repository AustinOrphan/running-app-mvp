import { afterEach, describe, expect, test } from 'vitest'
import { createUser } from '../../server/auth/createUser.ts'
import { signSession } from '../../server/auth/session.ts'
import { client, createTestCtx, seedUser, type TestCtx } from './helpers.ts'

const SLOW = 30_000
const BROWSER = { units: 'km', weightUnit: 'kg', timezone: 'Europe/Berlin' }

const open: TestCtx[] = []

async function ctxFor(): Promise<TestCtx> {
  const ctx = await createTestCtx()
  open.push(ctx)
  return ctx
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((ctx) => ctx.close()))
})

/** An account made the way `create-user` makes it, with a cookie for it. */
async function invited(ctx: TestCtx, input: Parameters<typeof createUser>[1]) {
  const created = await createUser(ctx.prisma, input)
  return {
    id: created.id,
    email: created.email,
    cookie: `rl_session=${signSession(created.id, ctx.config.sessionSecret)}`,
  }
}

async function stored(ctx: TestCtx, id: string) {
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id } })
  const profile = await ctx.prisma.athleteProfile.findUnique({ where: { userId: id } })
  return {
    units: user.units,
    weightUnit: user.weightUnit,
    timezone: profile?.timezone ?? null,
    flags: [user.unitsFromBrowser, user.zoneFromBrowser],
  }
}

describe('POST /api/settings/browser-defaults', () => {
  test(
    'an account with nothing given takes the browser units and zone once',
    async () => {
      const ctx = await ctxFor()
      const user = await invited(ctx, { email: 'a@example.com' })
      const me = await client(ctx, user).get('/api/auth/me')
      expect(me.body).toMatchObject({ unitsFromBrowser: true, zoneFromBrowser: true })

      const response = await client(ctx, user).post('/api/settings/browser-defaults').send(BROWSER)
      expect(response.status).toBe(200)
      expect(await stored(ctx, user.id)).toEqual({
        units: 'km',
        weightUnit: 'kg',
        timezone: 'Europe/Berlin',
        flags: [false, false],
      })
      expect((await client(ctx, user).get('/api/profile')).body).toMatchObject({
        timezone: 'Europe/Berlin',
      })
    },
    SLOW,
  )

  test('a second call, after the runner chose otherwise, changes nothing', async () => {
    const ctx = await ctxFor()
    const user = await invited(ctx, { email: 'a@example.com' })
    await client(ctx, user).post('/api/settings/browser-defaults').send(BROWSER)
    await client(ctx, user).put('/api/settings').send({ units: 'mi', weightUnit: 'lb' })
    await client(ctx, user).put('/api/profile').send({ timezone: 'America/Chicago' })

    const again = await client(ctx, user)
      .post('/api/settings/browser-defaults')
      .send({ units: 'km', weightUnit: 'kg', timezone: 'Asia/Tokyo' })
    expect(again.status).toBe(200)
    expect(await stored(ctx, user.id)).toMatchObject({
      units: 'mi',
      weightUnit: 'lb',
      timezone: 'America/Chicago',
    })
  })

  test('units and zone given to create-user are kept', async () => {
    const ctx = await ctxFor()
    const user = await invited(ctx, {
      email: 'a@example.com',
      units: 'mi',
      timezone: 'Pacific/Auckland',
    })
    await client(ctx, user).post('/api/settings/browser-defaults').send(BROWSER)
    expect(await stored(ctx, user.id)).toEqual({
      units: 'mi',
      weightUnit: 'lb',
      timezone: 'Pacific/Auckland',
      flags: [false, false],
    })
  })

  test('only the zone is taken when the units were given, and only the units when the zone was', async () => {
    const ctx = await ctxFor()
    const unitsGiven = await invited(ctx, { email: 'a@example.com', units: 'mi' })
    await client(ctx, unitsGiven).post('/api/settings/browser-defaults').send(BROWSER)
    expect(await stored(ctx, unitsGiven.id)).toMatchObject({
      units: 'mi',
      weightUnit: 'lb',
      timezone: 'Europe/Berlin',
    })
    const zoneGiven = await invited(ctx, { email: 'b@example.com', timezone: 'Asia/Tokyo' })
    await client(ctx, zoneGiven).post('/api/settings/browser-defaults').send(BROWSER)
    expect(await stored(ctx, zoneGiven.id)).toMatchObject({
      units: 'km',
      weightUnit: 'kg',
      timezone: 'Asia/Tokyo',
    })
  })

  test('a zone the runner already set is not replaced, though the flag is cleared', async () => {
    const ctx = await ctxFor()
    const user = await invited(ctx, { email: 'a@example.com' })
    await client(ctx, user).put('/api/profile').send({ timezone: 'America/Denver' })
    await client(ctx, user).post('/api/settings/browser-defaults').send(BROWSER)
    expect(await stored(ctx, user.id)).toMatchObject({
      timezone: 'America/Denver',
      flags: [false, false],
    })
  })

  test('an account that no flag marks, such as the first one, is left as it is', async () => {
    const ctx = await ctxFor()
    const user = await seedUser(ctx)
    await client(ctx, user).post('/api/settings/browser-defaults').send(BROWSER)
    expect(await stored(ctx, user.id)).toMatchObject({ units: 'mi', weightUnit: 'lb' })
  })

  test('refuses a bad zone, bad units and a session-less call', async () => {
    const ctx = await ctxFor()
    const user = await invited(ctx, { email: 'a@example.com' })
    const post = (body: unknown) =>
      client(ctx, user)
        .post('/api/settings/browser-defaults')
        .send(body as object)
    expect((await post({ ...BROWSER, timezone: 'Mars/Olympus' })).status).toBe(400)
    expect((await post({ ...BROWSER, units: 'yd' })).status).toBe(400)
    expect((await post({ units: 'km' })).status).toBe(400)
    expect((await client(ctx).post('/api/settings/browser-defaults').send(BROWSER)).status).toBe(
      401,
    )
    expect((await stored(ctx, user.id)).flags).toEqual([true, true])
  })
})
