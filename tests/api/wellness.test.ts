import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
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

beforeEach(async () => {
  await ctx.prisma.wellnessDay.deleteMany()
})

describe('PUT /api/wellness/:date', () => {
  test('requires a session', async () => {
    await client(ctx).put('/api/wellness/2026-03-02').send({ restingHr: 50 }).expect(401)
  })

  test('creates a manual day and returns it', async () => {
    const res = await client(ctx, user)
      .put('/api/wellness/2026-03-02')
      .send({ restingHr: 49, hrvRmssd: 62.5, sleepSec: 27000, weightKg: 60.4, notes: 'good night' })
      .expect(200)
    expect(res.body).toMatchObject({
      date: '2026-03-02',
      restingHr: 49,
      hrvRmssd: 62.5,
      hrvSdnn: null,
      sleepSec: 27000,
      sleepScore: null,
      weightKg: 60.4,
      vo2max: null,
      notes: 'good night',
      source: 'manual',
    })
    const day = res.body as { id: unknown; updatedAt: unknown }
    expect(typeof day.id).toBe('string')
    expect(typeof day.updatedAt).toBe('string')
  })

  test('merges into an existing day: absent keys stay, nulls clear, source becomes manual', async () => {
    await ctx.prisma.wellnessDay.create({
      data: {
        userId: user.id,
        date: '2026-03-02',
        restingHr: 48,
        hrvSdnn: 55,
        sleepSec: 25000,
        source: 'apple-health',
      },
    })
    const res = await client(ctx, user)
      .put('/api/wellness/2026-03-02')
      .send({ weightKg: 60, sleepSec: null })
      .expect(200)
    expect(res.body).toMatchObject({
      restingHr: 48,
      hrvSdnn: 55,
      weightKg: 60,
      sleepSec: null,
      source: 'manual',
    })
    expect(await ctx.prisma.wellnessDay.count()).toBe(1)
  })

  test('rejects a bad date, unknown keys and out-of-range values', async () => {
    await client(ctx, user).put('/api/wellness/2026-02-30').send({ restingHr: 50 }).expect(400)
    await client(ctx, user).put('/api/wellness/yesterday').send({ restingHr: 50 }).expect(400)
    await client(ctx, user).put('/api/wellness/2026-03-02').send({ mood: 3 }).expect(400)
    for (const body of [
      { restingHr: 24 },
      { restingHr: 111 },
      { hrvRmssd: -1 },
      { sleepSec: 90000 },
      { sleepScore: 101 },
      { weightKg: 29 },
      { vo2max: 9 },
    ]) {
      await client(ctx, user).put('/api/wellness/2026-03-02').send(body).expect(400)
    }
    expect(await ctx.prisma.wellnessDay.count()).toBe(0)
  })
})

describe('GET /api/wellness', () => {
  async function seedDays() {
    for (const [date, restingHr] of [
      ['2026-03-01', 50],
      ['2026-03-02', 51],
      ['2026-03-03', 52],
      ['2026-03-04', 53],
    ] as const) {
      await ctx.prisma.wellnessDay.create({
        data: { userId: user.id, date, restingHr, source: 'intervals' },
      })
    }
  }

  test('requires a session', async () => {
    await client(ctx).get('/api/wellness').expect(401)
  })

  test('lists days oldest first within an inclusive range', async () => {
    await seedDays()
    const res = await client(ctx, user)
      .get('/api/wellness?from=2026-03-02&to=2026-03-03')
      .expect(200)
    expect((res.body as Array<{ date: string }>).map((day) => day.date)).toEqual([
      '2026-03-02',
      '2026-03-03',
    ])
  })

  test('lists everything without a range, and supports one-sided ranges', async () => {
    await seedDays()
    const all = await client(ctx, user).get('/api/wellness').expect(200)
    expect(all.body).toHaveLength(4)
    const from = await client(ctx, user).get('/api/wellness?from=2026-03-04').expect(200)
    expect(from.body).toHaveLength(1)
    const to = await client(ctx, user).get('/api/wellness?to=2026-03-01').expect(200)
    expect(to.body).toHaveLength(1)
  })

  test('rejects a malformed range', async () => {
    await client(ctx, user).get('/api/wellness?from=soon').expect(400)
  })

  test("never shows another user's days", async () => {
    await seedDays()
    const other = await seedUser(ctx, { email: 'other@example.com' })
    const res = await client(ctx, other).get('/api/wellness').expect(200)
    expect(res.body).toEqual([])
  })
})
