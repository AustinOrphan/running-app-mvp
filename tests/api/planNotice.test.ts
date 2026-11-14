import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { PLAN_NOTICE_VERSION } from '../../shared/domain/planNotice.ts'
import type { Goal, PlanNoticeView, PlanWithSessions } from '../../shared/types.ts'
import { client, createTestCtx, seedUser, type TestCtx } from './helpers.ts'

// The health notice before a first plan (FS1): plan generation is refused until the confirmation is
// stored, an account that already has a plan is never blocked, and a birth year under 18 closes it.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 10, 13, 12))

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(async () => {
  await ctx.prisma.user.deleteMany()
})

async function newRunner(planNotice = false) {
  const user = await seedUser(ctx, { planNotice })
  const goal = (
    await client(ctx, user)
      .post('/api/goals')
      .send({
        name: 'Spring half',
        priority: 'A',
        targetDate: '2027-03-06',
        distanceM: 21098,
      })
      .expect(201)
  ).body as Goal
  return { user, goal }
}

/** The `{ error }` body of a refused call. */
function errorOf(response: { body: unknown }): { code: string; details: unknown } {
  return (response.body as { error: { code: string; details: unknown } }).error
}

const generate = (user: Awaited<ReturnType<typeof newRunner>>['user'], goalId: string) =>
  client(ctx, user).post('/api/plan/generate').send({ goalId })

describe('plan generation and the health notice', () => {
  test('is refused until the confirmation is stored, then allowed', async () => {
    const { user, goal } = await newRunner()

    const refused = await generate(user, goal.id).expect(409)
    expect(errorOf(refused).code).toBe('conflict')
    expect(errorOf(refused).details).toEqual({ code: 'plan-notice-required' })
    expect(await ctx.prisma.plan.count()).toBe(0)

    const before = (await client(ctx, user).get('/api/plan-notice').expect(200))
      .body as PlanNoticeView
    expect(before).toMatchObject({
      version: PLAN_NOTICE_VERSION,
      confirmedVersion: null,
      confirmedAt: null,
      required: true,
      age: 'ask',
    })

    await client(ctx, user)
      .put('/api/plan-notice')
      .send({ version: PLAN_NOTICE_VERSION, ageConfirmed: true })
      .expect(200)
    const created = (await generate(user, goal.id).expect(201)).body as PlanWithSessions
    expect(created.goalId).toBe(goal.id)
  })

  test('stores the version and the time of the confirmation', async () => {
    const { user } = await newRunner()
    const view = (
      await client(ctx, user)
        .put('/api/plan-notice')
        .send({ version: PLAN_NOTICE_VERSION, ageConfirmed: true })
        .expect(200)
    ).body as PlanNoticeView
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.planNoticeVersion).toBe(PLAN_NOTICE_VERSION)
    expect(row.planNoticeAt?.toISOString()).toBe(new Date(2026, 10, 13, 12).toISOString())
    expect(view).toMatchObject({
      confirmedVersion: PLAN_NOTICE_VERSION,
      confirmedAt: new Date(2026, 10, 13, 12).toISOString(),
      required: false,
    })
  })

  test('refuses a confirmation of other words than the server holds', async () => {
    const { user } = await newRunner()
    const response = await client(ctx, user)
      .put('/api/plan-notice')
      .send({ version: PLAN_NOTICE_VERSION + 1, ageConfirmed: true })
      .expect(409)
    expect(errorOf(response).details).toEqual({ code: 'stale-notice' })
    expect((await ctx.prisma.user.findFirstOrThrow()).planNoticeVersion).toBeNull()
  })

  test('an older stored version no longer counts for a runner with no plan', async () => {
    const { user, goal } = await newRunner()
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { planNoticeVersion: PLAN_NOTICE_VERSION - 1, planNoticeAt: new Date() },
    })
    await generate(user, goal.id).expect(409)
  })

  test('an account that already has a plan is not blocked and keeps it', async () => {
    const { user, goal } = await newRunner(true)
    const first = (await generate(user, goal.id).expect(201)).body as PlanWithSessions
    // The account is from before the notice: it has a plan and no confirmation.
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { planNoticeVersion: null, planNoticeAt: null },
    })
    const view = (await client(ctx, user).get('/api/plan-notice').expect(200))
      .body as PlanNoticeView
    expect(view).toMatchObject({ confirmedAt: null, required: false })

    const again = (await generate(user, goal.id).expect(201)).body as PlanWithSessions
    expect(again.goalId).toBe(first.goalId)
    expect(await ctx.prisma.plan.count({ where: { userId: user.id } })).toBe(2)
    // It sees the notice once and confirms it without losing the plan.
    await client(ctx, user)
      .put('/api/plan-notice')
      .send({ version: PLAN_NOTICE_VERSION, ageConfirmed: true })
      .expect(200)
    expect(
      ((await client(ctx, user).get('/api/plan').expect(200)).body as PlanWithSessions).id,
    ).toBe(again.id)
  })
})

describe('the minimum age', () => {
  async function withBirthYear(birthYear: number) {
    const runner = await newRunner()
    await client(ctx, runner.user).put('/api/profile').send({ birthYear }).expect(200)
    return runner
  }

  test('without a birth year the confirmation must carry the age statement', async () => {
    const { user } = await newRunner()
    const response = await client(ctx, user)
      .put('/api/plan-notice')
      .send({ version: PLAN_NOTICE_VERSION })
      .expect(409)
    expect(errorOf(response).details).toEqual({ code: 'age-statement-required' })
    expect((await ctx.prisma.user.findFirstOrThrow()).planNoticeVersion).toBeNull()
  })

  test('a birth year that makes the runner 19 or older needs no statement', async () => {
    const { user, goal } = await withBirthYear(1990)
    const view = (await client(ctx, user).get('/api/plan-notice').expect(200))
      .body as PlanNoticeView
    expect(view.age).toBe('ok')
    await client(ctx, user)
      .put('/api/plan-notice')
      .send({ version: PLAN_NOTICE_VERSION })
      .expect(200)
    await generate(user, goal.id).expect(201)
  })

  test('a birth year that leaves 17 or 18 as the age still asks for the statement', async () => {
    const { user } = await withBirthYear(2026 - 18)
    const view = (await client(ctx, user).get('/api/plan-notice').expect(200))
      .body as PlanNoticeView
    expect(view.age).toBe('ask')
  })

  test('a runner under 18 by the birth year is told so and no plan is generated', async () => {
    const { user, goal } = await withBirthYear(2026 - 17)
    const view = (await client(ctx, user).get('/api/plan-notice').expect(200))
      .body as PlanNoticeView
    expect(view).toMatchObject({ age: 'under', required: true })

    const confirm = await client(ctx, user)
      .put('/api/plan-notice')
      .send({ version: PLAN_NOTICE_VERSION, ageConfirmed: true })
      .expect(409)
    expect(errorOf(confirm).details).toEqual({ code: 'under-age' })
    expect((await ctx.prisma.user.findFirstOrThrow()).planNoticeVersion).toBeNull()

    const refused = await generate(user, goal.id).expect(409)
    expect(errorOf(refused).details).toEqual({ code: 'under-age' })
    expect(await ctx.prisma.plan.count()).toBe(0)
  })

  test('a stored confirmation does not open the gate for a birth year under 18', async () => {
    const { user, goal } = await newRunner(true)
    await client(ctx, user)
      .put('/api/profile')
      .send({ birthYear: 2026 - 16 })
      .expect(200)
    const refused = await generate(user, goal.id).expect(409)
    expect(errorOf(refused).details).toEqual({ code: 'under-age' })
  })
})

test('the notice is not served to anonymous requests', async () => {
  await client(ctx).get('/api/plan-notice').expect(401)
  await client(ctx).put('/api/plan-notice').send({ version: 1 }).expect(401)
})
