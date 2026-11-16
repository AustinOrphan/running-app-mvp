// D10 step 2a (ADR 0022): `requireAuth` carries the runner's day on the request, and Today, state,
// race, paces, plan-inputs and the session user read it. Until step 5 the resolver answers with the
// server's zone for every runner, so the zone here is injected through the resolver's two exports.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { isoDateInZone } from '../../shared/dates.ts'
import type { TodayView } from '../../shared/types.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

const injected = vi.hoisted(() => ({ zone: null as string | null, echo: false }))

/** The echo mode's answer: the east zone for the marker column value, the west zone otherwise. */
function echoZone(stored: string | null | undefined): string {
  return stored === 'Marker/Stored' ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago'
}

vi.mock('../../server/runnerDay.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/runnerDay.ts')>()
  return {
    ...actual,
    runnerZone: (stored: string | null | undefined) =>
      injected.echo ? echoZone(stored) : (injected.zone ?? actual.runnerZone(stored)),
    runnerDay: (now: Date, stored: string | null | undefined) => {
      // The echo mode answers with a zone that tells which stored value was read (a real zone,
      // since step 3 computes slot times in the zone a request carries).
      if (injected.echo) {
        const tz = echoZone(stored)
        return { tz, today: isoDateInZone(now, tz), now }
      }
      const tz = injected.zone ?? actual.runnerZone(stored)
      return { tz, today: isoDateInZone(now, tz), now }
    },
  }
})

// 11:00 UTC on 2026-03-10: Pacific/Kiritimati (+14) reads 01:00 on the 11th and Pacific/Pago_Pago
// (-11) reads 00:00 on the 10th, so the two dates differ.
const NOW = new Date(Date.UTC(2026, 2, 10, 11, 0))
const EAST = 'Pacific/Kiritimati'
const WEST = 'Pacific/Pago_Pago'

let ctx: TestCtx
let user: TestUser

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterEach(() => {
  injected.zone = null
  injected.echo = false
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  vi.useRealTimers()
  await ctx.close()
})

async function today(zone: string): Promise<{ view: TodayView; etag: string }> {
  injected.zone = zone
  const res = await client(ctx, user).get('/api/today')
  expect(res.status).toBe(200)
  return { view: res.body as TodayView, etag: res.headers.etag as string }
}

describe('the runner day on the request', () => {
  test('Today answers with the date and the zone of the resolver', async () => {
    const east = await today(EAST)
    const west = await today(WEST)
    expect(east.view.tz).toBe(EAST)
    expect(east.view.date).toBe('2026-03-11')
    expect(west.view.tz).toBe(WEST)
    expect(west.view.date).toBe('2026-03-10')
  })

  test.each(['/api/today', '/api/state', '/api/plan-inputs', '/api/race/plan', '/api/paces'])(
    'the tag of %s carries the runner day: 304 for its own tag, a body for the other',
    async (url) => {
      injected.zone = EAST
      const first = await client(ctx, user).get(url)
      expect(first.status).toBe(200)
      const tag = first.headers.etag as string
      expect(tag).toBeTruthy()

      const same = await client(ctx, user).get(url).set('If-None-Match', tag)
      expect(same.status).toBe(304)

      injected.zone = WEST
      const other = await client(ctx, user).get(url).set('If-None-Match', tag)
      expect(other.status).toBe(200)
      expect(other.headers.etag).not.toBe(tag)
    },
  )

  test('a zone change that leaves the date alone still changes the Today tag', async () => {
    // Europe/London and Europe/Paris share 2026-03-10 at 11:00 UTC.
    const london = await today('Europe/London')
    const paris = await today('Europe/Paris')
    expect(london.view.date).toBe(paris.view.date)
    expect(paris.etag).not.toBe(london.etag)
  })

  test('the session user carries the resolved zone on /api/auth/me and on sign-in', async () => {
    injected.zone = EAST
    const me = await client(ctx, user).get('/api/auth/me')
    expect((me.body as { tz: string }).tz).toBe(EAST)
    const login = await client(ctx).post('/api/auth/login').send({
      email: 'runner@example.com',
      password: 'correct horse battery staple',
    })
    expect(login.status).toBe(200)
    expect((login.body as { tz: string }).tz).toBe(EAST)
  })

  test('the stored profile zone reaches the resolver', async () => {
    await ctx.prisma.athleteProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, timezone: 'Marker/Stored' },
      update: { timezone: 'Marker/Stored' },
    })
    injected.echo = true
    const res = await client(ctx, user).get('/api/today')
    expect(res.status).toBe(200)
    expect((res.body as TodayView).tz).toBe(EAST)
  })

  // Step 2b: the year of a bound or an age is the year of the runner's day. At 11:00 UTC on 31
  // December 2026 Pacific/Kiritimati reads 1 January 2027 and Pacific/Pago_Pago reads 31 December.
  describe('the year of the runner day', () => {
    const NEW_YEAR_EVE = new Date(Date.UTC(2026, 11, 31, 11, 0))

    test('the birth-year bound follows the runner year', async () => {
      vi.setSystemTime(NEW_YEAR_EVE)
      try {
        // A session minted at the new date: the earlier cookie has expired by then.
        const late = await seedUser(ctx, { email: 'bound@example.com' })
        // The latest birth year is the year minus 10: 2017 in 2027, past the bound in 2026.
        injected.zone = EAST
        const east = await client(ctx, late).put('/api/profile').send({ birthYear: 2017 })
        expect(east.status).toBe(200)
        injected.zone = WEST
        const west = await client(ctx, late).put('/api/profile').send({ birthYear: 2017 })
        expect(west.status).toBe(400)
      } finally {
        vi.setSystemTime(NOW)
      }
    })

    test('the age of the plan notice follows the runner year', async () => {
      vi.setSystemTime(NEW_YEAR_EVE)
      try {
        const late = await seedUser(ctx, { email: 'age@example.com' })
        await ctx.prisma.athleteProfile.upsert({
          where: { userId: late.id },
          create: { userId: late.id, birthYear: 2009 },
          update: { birthYear: 2009 },
        })
        // Born in 2009: 18 in 2027 (the statement is asked for), 17 in 2026 (under age).
        injected.zone = EAST
        const east = await client(ctx, late).get('/api/plan-notice')
        expect((east.body as { age: string }).age).toBe('ask')
        injected.zone = WEST
        const west = await client(ctx, late).get('/api/plan-notice')
        expect((west.body as { age: string }).age).toBe('under')
      } finally {
        vi.setSystemTime(NOW)
      }
    })
  })

  test('setup and the password change answer with the zone', async () => {
    const fresh = await createTestCtx()
    try {
      injected.zone = EAST
      const setup = await client(fresh)
        .post('/api/setup')
        .send({ email: 'new@example.com', password: 'correct horse battery staple' })
      expect(setup.status).toBe(201)
      expect((setup.body as { tz: string }).tz).toBe(EAST)
      const cookie = (setup.headers['set-cookie'] as unknown as string[])[0]?.split(';')[0] ?? ''
      const changed = await client(fresh, { id: '', email: '', cookie })
        .put('/api/auth/password')
        .send({
          currentPassword: 'correct horse battery staple',
          newPassword: 'another long passphrase here',
        })
      expect(changed.status).toBe(200)
      expect((changed.body as { tz: string }).tz).toBe(EAST)
    } finally {
      await fresh.close()
    }
  })
})
