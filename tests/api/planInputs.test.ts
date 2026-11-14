// GET /api/plan-inputs (rule T2): the counts of the data the plan reads, derived on read.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import type { PlanInputsView } from '../../shared/domain/planInputs.ts'
import { P } from '../../shared/engine/params/index.ts'
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

const today = todayIso()

function newUser(): Promise<TestUser> {
  users += 1
  return seedUser(ctx, { email: `inputs${String(users)}@example.com` })
}

async function viewOf(user: TestUser): Promise<PlanInputsView> {
  const res = await client(ctx, user).get('/api/plan-inputs')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as PlanInputsView
}

describe('GET /api/plan-inputs', () => {
  test('an anonymous request is a 401', async () => {
    expect((await client(ctx).get('/api/plan-inputs')).status).toBe(401)
  })

  test('an empty log has zero counts and no named source', async () => {
    const view = await viewOf(await newUser())
    expect(view.asOf).toBe(today)
    expect(view.hrv.kind).toBe('none')
    expect(view.runs.count).toBe(0)
    expect(view.sources.named).toEqual([])
    expect(view.zones).toHaveLength(6)
  })

  test('SDNN from Apple Health is counted and kept out of the baseline', async () => {
    const user = await newUser()
    for (let i = 1; i <= 12; i += 1) {
      await ctx.prisma.wellnessDay.create({
        data: { userId: user.id, date: addDays(today, -i), hrvSdnn: 48, source: 'apple-health' },
      })
    }
    const view = await viewOf(user)
    expect(view.hrv.kind).toBe('sdnn')
    expect(view.hrv.sdnnDays).toBe(12)
    expect(view.hrv.baselineReadings).toBe(0)
    expect(view.sources.named).toEqual([
      { key: 'apple-health', label: 'Apple Health', activities: 0, wellnessDays: 12 },
    ])
  })

  test('rMSSD fills the baseline; runs report their stream and sources', async () => {
    const user = await newUser()
    for (let i = 1; i <= 12; i += 1) {
      await ctx.prisma.wellnessDay.create({
        data: {
          userId: user.id,
          date: addDays(today, -i),
          hrvRmssd: 55,
          restingHr: 50,
          source: 'manual',
        },
      })
    }
    const withStream = await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        date: addDays(today, -2),
        type: 'run',
        durationSec: 1800,
        distanceM: 5000,
        source: 'intervals',
      },
    })
    await ctx.prisma.activity.create({
      data: { userId: user.id, date: addDays(today, -4), type: 'run', durationSec: 1800 },
    })
    await ctx.prisma.activityStream.create({
      data: { activityId: withStream.id, sampleSec: 10, data: '{}' },
    })
    const view = await viewOf(user)
    expect(view.hrv.kind).toBe('rmssd')
    expect(view.hrv.baselineReadings).toBe(P.j4.windowDays.value)
    expect(view.restingHr.baselineReadings).toBe(P.j4.windowDays.value)
    expect(view.runs.count).toBe(2)
    expect(view.runs.withStream).toBe(1)
    expect(view.sources.named).toEqual([
      { key: 'intervals', label: 'intervals.icu', activities: 1, wellnessDays: 0 },
    ])
    expect(view.sources.other).toEqual({ activities: 1, wellnessDays: 12 })
  })

  test('a measured maximum heart rate is the tier of its boundary', async () => {
    const user = await newUser()
    await ctx.prisma.athleteProfile.create({
      data: { userId: user.id, hrMax: 190, hrMaxSource: 'measured', birthYear: 1985 },
    })
    const view = await viewOf(user)
    expect(view.zones[0]!.boundary?.source).toBe('hrmax-observed')
  })

  test('the tag follows the data version: the same tag is a 304, a write changes it', async () => {
    const user = await newUser()
    const first = await client(ctx, user).get('/api/plan-inputs')
    const tag = first.headers['etag'] as string
    expect(tag).toMatch(/^W\/"plan-inputs\./)
    const same = await client(ctx, user).get('/api/plan-inputs').set('If-None-Match', tag)
    expect(same.status).toBe(304)
    await ctx.prisma.wellnessDay.create({
      data: { userId: user.id, date: addDays(today, -1), restingHr: 50, source: 'manual' },
    })
    const again = await client(ctx, user).get('/api/plan-inputs').set('If-None-Match', tag)
    expect(again.status).toBe(200)
  })
})
