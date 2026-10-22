import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ActivityType, ApiErrorBody, WeekRow } from '../../shared/types.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

let ctx: TestCtx
let user: TestUser

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0))
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterEach(async () => {
  vi.useRealTimers()
  await ctx.close()
})

async function seed(
  date: string,
  over: { type?: ActivityType; minutes?: number; duplicateStatus?: string; userId?: string } = {},
): Promise<void> {
  await ctx.prisma.activity.create({
    data: {
      userId: over.userId ?? user.id,
      date,
      type: over.type ?? 'run',
      durationSec: (over.minutes ?? 60) * 60,
      distanceM: over.type === 'strength' ? null : 10000,
      duplicateStatus: over.duplicateStatus ?? 'none',
    },
  })
}

async function get(
  query: string,
  as: TestUser | null = user,
): Promise<{ status: number; body: WeekRow[] & ApiErrorBody }> {
  const res = await client(ctx, as ?? undefined).get(`/api/weeks${query}`)
  return { status: res.status, body: res.body as WeekRow[] & ApiErrorBody }
}

describe('GET /api/weeks', () => {
  test('GET /weeks aggregates server-side and excludes flagged duplicates', async () => {
    await seed('2026-03-02', { minutes: 60 })
    await seed('2026-03-04', { minutes: 90 })
    await seed('2026-03-05', { type: 'strength', minutes: 30 })
    await seed('2026-03-06', { type: 'cross', minutes: 45 })
    await seed('2026-03-07', { type: 'race', minutes: 100 })
    await seed('2026-03-07', { minutes: 60, duplicateStatus: 'possible' })
    await seed('2026-03-07', { minutes: 60, duplicateStatus: 'confirmed' })
    await seed('2026-03-08', { minutes: 20, duplicateStatus: 'dismissed' })
    await seed('2026-03-10', { minutes: 40 })

    const res = await get('?from=2026-03-02&to=2026-03-09')
    expect(res.status).toBe(200)
    const rows = res.body
    expect(rows.map((r) => r.weekStart)).toEqual(['2026-03-02', '2026-03-09'])
    expect(rows[0]).toMatchObject({
      runMin: 170,
      runM: 30000,
      runSessions: 3,
      runDays: 3,
      strengthSessions: 1,
      crossMin: 45,
      raceMin: 100,
      longestRunMin: 90,
    })
    expect(rows[0]?.longRunShare).toBeCloseTo(90 / 170)
    expect(rows[1]).toMatchObject({ runMin: 40, runSessions: 1 })
  })

  test('from and to need not be Mondays', async () => {
    const res = await get('?from=2026-03-04&to=2026-03-12')
    expect(res.body.map((r) => r.weekStart)).toEqual(['2026-03-02', '2026-03-09'])
  })

  test('defaults to the twelve weeks ending this week', async () => {
    const res = await get('')
    const rows = res.body
    expect(rows).toHaveLength(12)
    expect(rows[0]?.weekStart).toBe('2025-12-29')
    expect(rows[11]?.weekStart).toBe('2026-03-16')
  })

  test('activities after the range do not count', async () => {
    await seed('2026-03-02')
    await seed('2026-03-10')
    const res = await get('?from=2026-03-02&to=2026-03-02')
    expect(res.body).toHaveLength(1)
    expect(res.body[0]?.runSessions).toBe(1)
  })

  test('avg4wRunMin and streak3Plus look back before from', async () => {
    // Three runs a week (Mon, Wed, Fri) for four weeks, 60 min each.
    const weeks = ['2026-02-16', '2026-02-23', '2026-03-02', '2026-03-09']
    const days = [0, 2, 4]
    for (const monday of weeks) {
      const base = Date.parse(`${monday}T00:00:00Z`)
      for (const offset of days) {
        await seed(new Date(base + offset * 86_400_000).toISOString().slice(0, 10))
      }
    }

    const res = await get('?from=2026-03-09&to=2026-03-09')
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ runMin: 180, avg4wRunMin: 180, streak3Plus: 4 })
  })

  test('range: from after to -> 400; more than 260 weeks -> 400; malformed date -> 400', async () => {
    expect((await get('?from=2026-03-09&to=2026-03-02')).status).toBe(400)
    expect((await get('?from=2026-03-08&to=2026-03-02')).status).toBe(400)
    const same = await get('?from=2026-03-02&to=2026-03-08')
    expect(same.status).toBe(200)
    expect(same.body).toHaveLength(1)

    expect((await get('?from=2020-01-06&to=2026-03-16')).status).toBe(400)
    const exactly260 = await get('?from=2021-03-29&to=2026-03-16')
    expect(exactly260.status).toBe(200)
    expect(exactly260.body).toHaveLength(260)
    expect((await get('?from=2021-03-22&to=2026-03-16')).status).toBe(400)

    for (const bad of ['?from=yesterday', '?to=2026-13-01', '?from=2026-02-30', '?from=']) {
      const res = await get(bad)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('validation')
    }
  })

  test('empty account -> rows of zeros', async () => {
    const res = await get('?from=2026-03-02&to=2026-03-16')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    for (const row of res.body) {
      expect(row).toMatchObject({
        runMin: 0,
        runM: 0,
        runSessions: 0,
        runDays: 0,
        strengthSessions: 0,
        crossMin: 0,
        raceMin: 0,
        longestRunMin: 0,
        longRunShare: null,
        avg4wRunMin: 0,
        streak3Plus: 0,
      })
    }
  })

  test("another user's activities are never counted", async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await seed('2026-03-02', { userId: other.id, minutes: 500 })
    await seed('2026-03-03', { minutes: 30 })
    const res = await get('?from=2026-03-02&to=2026-03-02')
    expect(res.body[0]).toMatchObject({ runMin: 30, runSessions: 1 })
  })

  test('requires a session', async () => {
    expect((await get('', null)).status).toBe(401)
  })
})
