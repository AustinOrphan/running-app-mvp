// GET /api/race/plan and the Today slot `race` (rule H14, ADR 0018, steps 2 and 3 of the design).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import { summaryOf } from '../../shared/engine/racePlan.ts'
import type { RacePlanView, TodayView } from '../../shared/types.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { climateKeyFor } from '../../server/services/weatherCache.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

let ctx: TestCtx
let users = 0

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  await ctx.close()
})

/** A runner of their own, so that one test's rows never reach another's. */
function newUser(): Promise<TestUser> {
  users += 1
  return seedUser(ctx, { email: `racer${String(users)}@example.com` })
}

const today = todayIso()
const HOUR = 3600

interface GoalSpec {
  daysAhead?: number
  distanceM?: number
  supportLevel?: 'aided' | 'self'
  startTime?: string | null
  withClimate?: number | null
}

/** An active goal with a place, so that its race climate can be cached. */
async function newGoal(user: TestUser, spec: GoalSpec = {}) {
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic 100 miler',
      priority: 'A',
      isActive: true,
      targetDate: addDays(today, spec.daysAhead ?? 3),
      distanceM: spec.distanceM ?? 160_934,
      gainM: 5_000,
      lossM: 5_000,
      surface: 'trail',
      goalType: 'finish',
      startTime: spec.startTime === undefined ? '06:00' : spec.startTime,
      raceLat: 40.01,
      raceLng: -105.27,
      supportLevel: spec.supportLevel ?? 'aided',
    },
  })
  if (spec.withClimate !== undefined && spec.withClimate !== null) {
    const key = climateKeyFor(goal, { lat: null, lng: null, use: false })
    if (key === null) throw new Error('the goal has no place')
    await ctx.prisma.climateCache.create({
      data: { ...key, wbgtC: spec.withClimate, samples: 10, yearsRead: 3, complete: true },
    })
  }
  return goal
}

async function planOf(user: TestUser): Promise<RacePlanView> {
  const res = await client(ctx, user).get('/api/race/plan')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as RacePlanView
}

async function todayOf(user: TestUser, query = ''): Promise<TodayView> {
  const res = await client(ctx, user).get(`/api/today${query}`)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as TodayView
}

afterEach(async () => {
  await ctx.prisma.climateCache.deleteMany()
})

describe('GET /api/race/plan: access and shape', () => {
  test('an anonymous request is a 401, with a query or without', async () => {
    expect((await client(ctx).get('/api/race/plan')).status).toBe(401)
    expect((await client(ctx).get('/api/race/plan?x=1')).status).toBe(401)
  })

  test('takes no query: an unknown parameter is a 400', async () => {
    const user = await newUser()
    const res = await client(ctx, user).get('/api/race/plan?goalId=x')
    expect(res.status).toBe(400)
  })

  test('says why there is no plan, for each case', async () => {
    const none = await newUser()
    expect(await planOf(none)).toEqual({ plan: null, reason: 'no-goal' })

    const marathon = await newUser()
    await newGoal(marathon, { distanceM: 42_195 })
    expect(await planOf(marathon)).toEqual({ plan: null, reason: 'not-ultra' })

    const over = await newUser()
    await newGoal(over, { daysAhead: -1 })
    expect(await planOf(over)).toEqual({ plan: null, reason: 'race-over' })

    const noDistance = await newUser()
    await ctx.prisma.goal.create({
      data: {
        userId: noDistance.id,
        name: 'Synthetic goal',
        priority: 'A',
        isActive: true,
        targetDate: addDays(today, 30),
        distanceM: null,
        goalType: 'finish',
      },
    })
    expect(await planOf(noDistance)).toEqual({ plan: null, reason: 'no-distance' })
  })

  test('gives the plan of an ultra goal with its climate normal, and writes nothing', async () => {
    const user = await newUser()
    const goal = await newGoal(user, { withClimate: 21.5 })
    const before = await dataVersionKey(ctx.prisma)
    const { plan, reason } = await planOf(user)
    expect(reason).toBeNull()
    expect(plan?.goalId).toBe(goal.id)
    expect(plan?.daysToRace).toBe(3)
    expect(plan?.heat.wbgtC).toBe(21.5)
    expect(plan?.heat.source).toBe('climate-normal')
    expect(plan?.thirds).toHaveLength(P.r1.thirds.value)
    expect(plan?.raceWeek?.carbGPerKgDay).toEqual(P.k6.carbLoadGPerKgDay.value)
    expect(plan?.notices).toEqual(expect.arrayContaining(['no-prediction']))
    expect(await dataVersionKey(ctx.prisma)).toEqual(before)
  })

  test('says nothing about heat while the race climate is not cached', async () => {
    const user = await newUser()
    await newGoal(user)
    const { plan } = await planOf(user)
    expect(plan?.heat.wbgtC).toBeNull()
    expect(plan?.notices).toContain('no-climate')
  })

  test('carries the support level of the goal', async () => {
    const user = await newUser()
    await newGoal(user, { supportLevel: 'self' })
    expect((await planOf(user)).plan?.supportLevel).toBe('self')
  })

  test('is each runner’s own: another runner sees no goal', async () => {
    const owner = await newUser()
    const other = await newUser()
    await newGoal(owner)
    expect((await planOf(owner)).plan).not.toBeNull()
    expect(await planOf(other)).toEqual({ plan: null, reason: 'no-goal' })
  })
})

describe('GET /api/race/plan: the change key', () => {
  test('answers 304 to the current tag, private and varying by cookie', async () => {
    const user = await newUser()
    await newGoal(user)
    const first = await client(ctx, user).get('/api/race/plan')
    expect(first.status).toBe(200)
    const tag = first.headers['etag'] as string
    expect(tag).toMatch(/^W\/"race\./)
    expect(first.headers['cache-control']).toBe('private, no-cache')
    expect(first.headers['vary']).toMatch(/Cookie/)
    const again = await client(ctx, user).get('/api/race/plan').set('If-None-Match', tag)
    expect(again.status).toBe(304)
  })

  test('changes with the data: a tolerated run moves the fuel rate on the next read', async () => {
    const user = await newUser()
    await newGoal(user)
    const first = await client(ctx, user).get('/api/race/plan')
    const tag = first.headers['etag'] as string
    const before = (first.body as RacePlanView).plan
    expect(before?.fuel.basis).toBe('floor')

    const product = await client(ctx, user).post('/api/fuel/products').send({
      name: 'Synthetic gel',
      kind: 'gel',
      servingLabel: '1 gel',
      carbsG: 40,
      sodiumMg: 100,
      kcal: 160,
      multiCarb: true,
    })
    expect(product.status).toBe(201)
    for (const offset of [10, 9]) {
      const run = await ctx.prisma.activity.create({
        data: {
          userId: user.id,
          date: addDays(today, -offset),
          type: 'run',
          durationSec: 3 * HOUR,
          distanceM: 30_000,
          source: 'manual',
        },
      })
      const put = await client(ctx, user)
        .put(`/api/fuel/logs/${run.id}`)
        .send({ items: [{ productId: (product.body as { id: string }).id, servings: 7 }], gut: 0 })
      expect(put.status, JSON.stringify(put.body)).toBe(200)
    }
    const stale = await client(ctx, user).get('/api/race/plan').set('If-None-Match', tag)
    expect(stale.status).toBe(200)
    const after = (stale.body as RacePlanView).plan
    expect(after?.fuel.basis).toBe('tolerated')
    expect(after?.fuel.rungIndex).toBeGreaterThan(0)
  })

  test('follows the goal: a new place or date is read on the next request', async () => {
    const user = await newUser()
    const goal = await newGoal(user, { daysAhead: 3 })
    expect((await planOf(user)).plan?.daysToRace).toBe(3)
    await ctx.prisma.goal.update({
      where: { id: goal.id },
      data: { targetDate: addDays(today, 5) },
    })
    expect((await planOf(user)).plan?.daysToRace).toBe(5)
  })
})

describe('GET /api/today: coach.slots.race', () => {
  test('is null before race week, for a goal that is not an ultra and without a goal', async () => {
    const far = await newUser()
    await newGoal(far, { daysAhead: P.r1.raceWeekCardDays.value + 3 })
    expect((await todayOf(far)).coach.slots.race).toBeNull()

    const marathon = await newUser()
    await newGoal(marathon, { distanceM: 42_195, daysAhead: 2 })
    expect((await todayOf(marathon)).coach.slots.race).toBeNull()

    const none = await newUser()
    expect((await todayOf(none)).coach.slots.race).toBeNull()
  })

  test('holds the race week summary from r1.raceWeekCardDays days before, cut from the plan', async () => {
    const user = await newUser()
    await newGoal(user, { daysAhead: P.r1.raceWeekCardDays.value, withClimate: 14 })
    const view = await todayOf(user)
    const slot = view.coach.slots.race
    const { plan } = await planOf(user)
    expect(slot?.daysToRace).toBe(P.r1.raceWeekCardDays.value)
    expect(slot?.carbLineDue).toBe(false)
    if (plan === null) throw new Error('expected a plan')
    expect(slot).toEqual(JSON.parse(JSON.stringify(summaryOf(plan, today))))
  })

  test('has the carbohydrate line due in the final window and the same objects as the page', async () => {
    const user = await newUser()
    await newGoal(user, { daysAhead: 1, withClimate: 14 })
    const slot = (await todayOf(user)).coach.slots.race
    const { plan } = await planOf(user)
    expect(slot?.carbLineDue).toBe(true)
    expect(slot?.effort).toEqual(plan?.effort)
    expect(slot?.fuel).toEqual(plan?.fuel)
    expect(slot?.fluid).toEqual(plan?.fluid)
    expect(slot?.raceWeek).toEqual(plan?.raceWeek)
    expect(slot?.eahStronger).toBe(plan?.eahStronger)
  })

  test('counts the days from the viewed day on a preview', async () => {
    const user = await newUser()
    await newGoal(user, { daysAhead: 6 })
    const preview = await todayOf(user, `?date=${addDays(today, 2)}`)
    expect(preview.coach.slots.race?.daysToRace).toBe(4)
    expect(preview.coach.preview).toBe(true)
  })

  test('is null on the day after the race', async () => {
    const user = await newUser()
    await newGoal(user, { daysAhead: 1 })
    expect((await todayOf(user, `?date=${addDays(today, 1)}`)).coach.slots.race?.daysToRace).toBe(0)
    expect((await todayOf(user, `?date=${addDays(today, 2)}`)).coach.slots.race).toBeNull()
  })

  test('is a plain read: Today and the plan make the same data version', async () => {
    const user = await newUser()
    await newGoal(user, { daysAhead: 2 })
    await todayOf(user)
    const before = await dataVersionKey(ctx.prisma)
    await todayOf(user)
    await planOf(user)
    expect(await dataVersionKey(ctx.prisma)).toEqual(before)
  })
})

describe('private data', () => {
  test('the plan names the goal and the runner’s own numbers and nothing of another runner', async () => {
    const owner = await newUser()
    const other = await newUser()
    await newGoal(owner)
    await ctx.prisma.goal.create({
      data: {
        userId: other.id,
        name: 'Another runner’s race',
        priority: 'A',
        isActive: true,
        targetDate: addDays(today, 2),
        distanceM: 100_000,
        goalType: 'finish',
      },
    })
    const mine = JSON.stringify(await planOf(owner))
    expect(mine).not.toContain('Another runner')
    const theirs = JSON.stringify(await planOf(other))
    expect(theirs).not.toContain('Synthetic 100 miler')
  })
})
