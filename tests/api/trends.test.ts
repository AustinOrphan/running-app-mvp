import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { TrendsView } from '../../shared/types.ts'
import { loadWeightSeries } from '../../server/serialize.ts'
import { cacheSizes } from '../../server/services/athleteState.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// The real loader, wrapped so a test can see whether the route called it.
vi.mock('../../server/serialize.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/serialize.ts')>()
  return { ...original, loadWeightSeries: vi.fn(original.loadWeightSeries) }
})

let ctx: TestCtx
let user: TestUser

beforeEach(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterEach(async () => {
  vi.restoreAllMocks()
  expectNoRefusedFetches(ctx)
  await ctx.close()
})

const TODAY = todayIso()
const LAST = mondayOf(TODAY)

/** The reading of a night `back` days before this week's Monday: HRV alternates 58 and 62. */
const hrvAt = (back: number) => (back % 2 === 0 ? 58 : 62)

/** Twenty-one nights before this week's Monday, each with rMSSD, resting heart rate and sleep. */
async function seedNights(userId = user.id): Promise<void> {
  await ctx.prisma.wellnessDay.createMany({
    data: Array.from({ length: 21 }, (_, i) => {
      const back = i + 1
      return {
        userId,
        date: addDays(LAST, -back),
        hrvRmssd: hrvAt(back),
        restingHr: back % 2 === 0 ? 49 : 53,
        sleepSec: 7.5 * 3600,
        source: 'manual',
      }
    }),
  })
}

const getTrends = (as: TestUser | null = user, search = '') =>
  client(ctx, as ?? undefined).get(`/api/trends${search}`)

const sampleSd = (values: number[]) => {
  const m = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1))
}

describe('GET /api/trends', () => {
  test('needs a session and takes no query', async () => {
    const anonymous = await getTrends(null)
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toMatchObject({ error: { code: 'unauthorized' } })

    const unknown = await getTrends(user, '?weight=1')
    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ error: { code: 'validation' } })
  })

  test('is three empty series for a runner with no wellness rows, and has no weight key', async () => {
    const res = await getTrends()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      asOf: TODAY,
      recovery: { hrv: [], restingHr: [], sleep: [], cycleBaseline: false },
    })
    expect(JSON.stringify(res.body)).not.toMatch(/weight/i)
  })

  test('answers 104 weeks, oldest first, with the real weekly means and ranges', async () => {
    await seedNights()
    const res = await getTrends()
    expect(res.status).toBe(200)
    const view = res.body as TrendsView
    expect(Object.keys(view.recovery).sort()).toEqual([
      'cycleBaseline',
      'hrv',
      'restingHr',
      'sleep',
    ])
    expect(view.recovery.hrv).toHaveLength(104)
    expect(view.recovery.hrv[0]!.weekStart).toBe(addDays(LAST, -7 * 103))
    expect(view.recovery.hrv.at(-1)!.weekStart).toBe(LAST)

    // The current week has no night yet (every seeded night is before this Monday).
    expect(view.recovery.hrv.at(-1)).toMatchObject({ mean: null, nights: 0 })

    // Last week: seven nights, the days -7 to -1. The band is built at its Monday from the ten
    // newest nights before it, days -17 to -8.
    const lastWeek = view.recovery.hrv.at(-2)!
    const days7 = [1, 2, 3, 4, 5, 6, 7].map(hrvAt)
    const geometric = Math.exp(days7.reduce((s, v) => s + Math.log(v), 0) / 7)
    const baseline = Array.from({ length: 10 }, (_, k) => Math.log(hrvAt(8 + k)))
    const m = baseline.reduce((a, b) => a + b, 0) / 10
    expect(lastWeek).toEqual({
      weekStart: addDays(LAST, -7),
      mean: Math.round(geometric * 10) / 10,
      nights: 7,
      low: Math.round(Math.exp(m - sampleSd(baseline)) * 10) / 10,
      high: Math.round(Math.exp(m + sampleSd(baseline)) * 10) / 10,
      readings: 10,
    })

    // The week before: only seven earlier nights exist, so there is no range yet.
    expect(view.recovery.hrv.at(-3)).toMatchObject({
      nights: 7,
      low: null,
      high: null,
      readings: 7,
    })

    // Resting heart rate and sleep follow the same weeks; sleep carries no range.
    expect(view.recovery.restingHr.at(-2)).toMatchObject({ mean: 51.3, nights: 7 })
    expect(view.recovery.sleep.at(-2)).toEqual({
      weekStart: addDays(LAST, -7),
      mean: 7.5,
      nights: 7,
      low: null,
      high: null,
      readings: null,
    })
  })

  test('a history with only SDNN gives no HRV series', async () => {
    await ctx.prisma.wellnessDay.createMany({
      data: Array.from({ length: 21 }, (_, i) => ({
        userId: user.id,
        date: addDays(LAST, -(i + 1)),
        hrvSdnn: 55,
        restingHr: 50,
        source: 'manual',
      })),
    })
    const view = (await getTrends()).body as TrendsView
    expect(view.recovery.hrv).toEqual([])
    expect(view.recovery.restingHr).not.toEqual([])
    expect(view.recovery.sleep).toEqual([])
  })

  test('draws the cycle baseline of 35 days for a female profile', async () => {
    // Twelve nights 34 to 23 days before last week's Monday: outside 21 days, inside 35.
    await ctx.prisma.wellnessDay.createMany({
      data: [
        ...Array.from({ length: 12 }, (_, i) => ({
          userId: user.id,
          date: addDays(LAST, -(41 - i)),
          hrvRmssd: 50 + (i % 3),
          source: 'manual',
        })),
        ...Array.from({ length: 7 }, (_, i) => ({
          userId: user.id,
          date: addDays(LAST, -7 + i),
          hrvRmssd: 60,
          source: 'manual',
        })),
      ],
    })
    const plain = (await getTrends()).body as TrendsView
    expect(plain.recovery.hrv.at(-2)).toMatchObject({ low: null, readings: 0 })

    await ctx.prisma.athleteProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, sex: 'female' },
      update: { sex: 'female' },
    })
    const cyclic = (await getTrends()).body as TrendsView
    expect(cyclic.recovery.cycleBaseline).toBe(true)
    expect(plain.recovery.cycleBaseline).toBe(false)
    expect(cyclic.recovery.hrv.at(-2)!.readings).toBe(12)
    expect(cyclic.recovery.hrv.at(-2)!.low).not.toBeNull()
  })

  test('is scoped to the signed-in runner', async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await seedNights(other.id)
    expect(((await getTrends(user)).body as TrendsView).recovery.hrv).toEqual([])
    expect(((await getTrends(other)).body as TrendsView).recovery.hrv).toHaveLength(104)
  })
})

describe('GET /api/trends reads', () => {
  /** The calls of the Trends loader: the wellness read with the four-column select. */
  function loaderCalls(calls: readonly unknown[][]): unknown[][] {
    return calls.filter((call) => {
      const args = call[0] as { select?: Record<string, boolean> } | undefined
      return args?.select !== undefined && 'hrvRmssd' in args.select
    })
  }

  test('a cold request reads four wellness columns once, a warm one reads none', async () => {
    await seedNights()
    const findMany = vi.spyOn(ctx.prisma.wellnessDay, 'findMany')
    expect(cacheSizes(ctx.prisma).memos).toBe(0)

    const first = await getTrends()
    expect(first.status).toBe(200)
    const calls = loaderCalls(findMany.mock.calls)
    expect(calls).toHaveLength(1)
    const args = calls[0]![0] as { select: object; where: { userId: string } }
    expect(args.select).toEqual({ date: true, restingHr: true, hrvRmssd: true, sleepSec: true })
    expect(args.where.userId).toBe(user.id)
    expect(cacheSizes(ctx.prisma).memos).toBe(1)

    findMany.mockClear()
    const second = await getTrends()
    expect(second.body).toEqual(first.body)
    expect(findMany).not.toHaveBeenCalled()
  })

  test('a wellness write recomputes the series', async () => {
    await seedNights()
    const before = (await getTrends()).body as TrendsView
    const findMany = vi.spyOn(ctx.prisma.wellnessDay, 'findMany')

    await client(ctx, user)
      .put(`/api/wellness/${addDays(LAST, -1)}`)
      .send({ hrvRmssd: 100 })
      .expect(200)
    findMany.mockClear()
    const after = (await getTrends()).body as TrendsView
    expect(loaderCalls(findMany.mock.calls)).toHaveLength(1)
    expect(after.recovery.hrv.at(-2)!.mean).not.toBe(before.recovery.hrv.at(-2)!.mean)
  })
})

describe('GET /api/trends weight', () => {
  /** A weigh-in on each of the two days after the Monday `weeksBack` weeks before this week's. */
  async function seedWeighIns(weeksBack: number, kgs: [number, number]): Promise<void> {
    const monday = addDays(LAST, -7 * weeksBack)
    for (const [i, weightKg] of kgs.entries()) {
      await ctx.prisma.wellnessDay.upsert({
        where: { userId_date: { userId: user.id, date: addDays(monday, i) } },
        create: { userId: user.id, date: addDays(monday, i), weightKg, source: 'manual' },
        update: { weightKg },
      })
    }
  }
  const turn = (showBodyWeight: boolean) =>
    client(ctx, user).put('/api/settings').send({ showBodyWeight }).expect(200)
  const screen = (answers: Record<string, boolean>) =>
    client(ctx, user).post('/api/screenings').send({ date: TODAY, answers }).expect(201)
  // The snapshot's own wellness read has no select, so weightKg is loaded there whatever the
  // setting (ADR 0019); what the route controls is its own weight query and the payload.
  beforeEach(() => {
    vi.mocked(loadWeightSeries).mockClear()
  })

  test('has no weight key while the switch is off, and the route never calls the weight loader', async () => {
    await seedWeighIns(1, [70, 71])
    const res = await getTrends()
    expect(Object.keys(res.body as object).sort()).toEqual(['asOf', 'recovery'])
    expect(loadWeightSeries).not.toHaveBeenCalled()
  })

  test('carries the weekly means in grams once the switch is on, with gaps as null', async () => {
    await seedWeighIns(1, [70, 71])
    await ctx.prisma.wellnessDay.create({
      data: { userId: user.id, date: addDays(LAST, -14), weightKg: 80, source: 'manual' },
    })
    await turn(true)
    const body = (await getTrends()).body as TrendsView
    expect(body.weightGate).toBeUndefined()
    expect(body.weight).toHaveLength(104)
    const byWeek = new Map(body.weight!.map((w) => [w.weekStart, w]))
    expect(byWeek.get(addDays(LAST, -7))).toEqual({
      weekStart: addDays(LAST, -7),
      grams: 70500,
      weighIns: 2,
    })
    // One weigh-in is under the minimum: no mean, and the count says why.
    expect(byWeek.get(addDays(LAST, -14))).toEqual({
      weekStart: addDays(LAST, -14),
      grams: null,
      weighIns: 1,
    })
    expect(byWeek.get(addDays(LAST, -21))!.grams).toBeNull()
  })

  test('turning the switch off again drops the key and deletes no weigh-in', async () => {
    await seedWeighIns(1, [70, 71])
    await turn(true)
    expect((await getTrends()).body).toHaveProperty('weight')
    await turn(false)
    expect(Object.keys((await getTrends()).body as object).sort()).toEqual(['asOf', 'recovery'])
    expect(await ctx.prisma.wellnessDay.count({ where: { weightKg: { not: null } } })).toBe(2)
  })

  test('at two open flags the switch gives the reason and no series, and calls no weight loader', async () => {
    await seedWeighIns(1, [70, 71])
    await turn(true)
    await screen({ weightLoss: true, cycle: false, fatigue: true })
    const body = (await getTrends()).body as TrendsView
    expect(body.weightGate).toBe('reds')
    expect(body).not.toHaveProperty('weight')
    expect(loadWeightSeries).not.toHaveBeenCalled()
  })

  test('one open flag does not gate, and a clearer screening lifts the gate', async () => {
    await seedWeighIns(1, [70, 71])
    await turn(true)
    await screen({ weightLoss: true })
    expect((await getTrends()).body).toHaveProperty('weight')
    await screen({ weightLoss: true, fatigue: true })
    expect((await getTrends()).body).toHaveProperty('weightGate', 'reds')
    await screen({ weightLoss: false })
    expect((await getTrends()).body).toHaveProperty('weight')
  })

  test('is scoped to the signed-in runner', async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await ctx.prisma.wellnessDay.createMany({
      data: [0, 1].map((i) => ({
        userId: other.id,
        date: addDays(LAST, -7 + i),
        weightKg: 90,
        source: 'manual',
      })),
    })
    await turn(true)
    expect((await getTrends()).body).toMatchObject({ weight: [] })
  })
})
