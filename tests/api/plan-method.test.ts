import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import { parsePlanOptions } from '../../server/serialize.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'
import { runsOn, s3Runs } from '../unit/engine/history-fixtures.ts'

// The method preset on a plan (task M2, rules P1 to P4, methods proposal sections 4.3 and 4.5):
// POST /api/plan/generate takes `options.method`, an unknown id is a 400 with its path, the plan
// stores it in `Plan.options` and serves what applies (`PlanWithSessions.method`), and every
// re-plan of the plan carries it. The runner is the synthetic one of appendix A of the loading
// proposal, placed against this week's Monday, as in plan-load.test.ts.

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

const today = todayIso()
const thisMonday = mondayOf(today)
const year = Number(today.slice(0, 4))
const HALF_M = 21_097
const MARATHON_M = 42_195
const WEEKS_AHEAD = 20

async function seedGoal(userId: string, distanceM: number, name: string) {
  return ctx.prisma.goal.create({
    data: {
      userId,
      name,
      priority: 'A',
      status: 'target',
      targetDate: addDays(thisMonday, 7 * WEEKS_AHEAD + 6),
      distanceM,
    },
  })
}

/** A runner of 41 with a year of running and the block of appendix A. */
async function seedRunner(email: string) {
  const user = await seedUser(ctx, { email })
  await client(ctx, user)
    .put('/api/profile')
    .send({ birthYear: year - 41, runningSinceYear: year - 1 })
    .expect(200)
  await ctx.prisma.activity.createMany({
    data: runsOn(thisMonday, s3Runs()).map((a) => ({
      userId: user.id,
      date: a.date,
      type: 'run',
      durationSec: a.durationSec,
      movingSec: a.movingSec,
      distanceM: a.distanceM,
      rpe: 3,
      source: 'manual',
    })),
  })
  return user
}

const generate = (user: TestUser, goalId: string, options?: Record<string, unknown>) =>
  client(ctx, user)
    .post('/api/plan/generate')
    .send({ goalId, ...(options === undefined ? {} : { options }) })
const readPlan = async (user: TestUser) =>
  (await client(ctx, user).get('/api/plan')).body as PlanWithSessions
const storedOptions = async (planId: string): Promise<unknown> =>
  JSON.parse(
    (await ctx.prisma.plan.findUniqueOrThrow({ where: { id: planId } })).options,
  ) as unknown
/** The weeks as a person reads them: Monday, running target, long run, run days. */
const weeksOf = (plan: PlanWithSessions) =>
  plan.weeks.map((w) => [w.weekStart, w.targetRunMin, w.longRunMin, w.runDays] as const)
const ahead = (plan: PlanWithSessions) => plan.weeks.filter((w) => w.weekStart >= thisMonday)

const DEFAULT = { requested: 'default', effective: 'default', reason: null }

describe('POST /api/plan/generate with a method preset', () => {
  test('refuses an unknown method with a 400 that names the field', async () => {
    const user = await seedRunner('method-unknown@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    for (const method of ['shorter-long-run', 'Default', 'three_run_days', '', 3, null]) {
      const res = await generate(user, goal.id, { method })
      expect(res.status, JSON.stringify(method)).toBe(400)
      const { error } = res.body as {
        error: { code: string; details: { issues: Array<{ path: string }> } }
      }
      expect(error.code).toBe('validation')
      expect(error.details.issues.map((issue) => issue.path)).toEqual(['options.method'])
    }
    // nothing was written
    expect(await ctx.prisma.plan.count({ where: { userId: user.id } })).toBe(0)
  })

  test('reads an absent method and `default` as the same plan, both served as the default', async () => {
    const user = await seedRunner('method-default@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    const none = await generate(user, goal.id)
    expect(none.status, JSON.stringify(none.body)).toBe(201)
    const noneBody = none.body as PlanWithSessions
    expect(noneBody.method).toEqual(DEFAULT)
    expect(await storedOptions(noneBody.id)).toEqual({})

    const chosen = await generate(user, goal.id, { method: 'default' })
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(201)
    const chosenBody = chosen.body as PlanWithSessions
    expect(chosenBody.method).toEqual(DEFAULT)
    expect(await storedOptions(chosenBody.id)).toEqual({ method: 'default' })
    expect(weeksOf(chosenBody)).toEqual(weeksOf(noneBody))
    expect(chosenBody.sessions.map((s) => [s.date, s.kind, s.durationMin])).toEqual(
      noneBody.sessions.map((s) => [s.date, s.kind, s.durationMin]),
    )
    expect((await readPlan(user)).method).toEqual(DEFAULT)
  })

  test('stores a preset with the plan, serves it, and plans it: three run days for a half marathon', async () => {
    const user = await seedRunner('method-p2@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    const before = await generate(user, goal.id)
    const base = before.body as PlanWithSessions
    expect(Math.max(...ahead(base).map((w) => w.runDays))).toBeGreaterThan(3)

    const res = await generate(user, goal.id, { method: 'three-run-days' })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const plan = res.body as PlanWithSessions
    expect(await storedOptions(plan.id)).toEqual({ method: 'three-run-days' })
    const method = { requested: 'three-run-days', effective: 'three-run-days', reason: null }
    expect(plan.method).toEqual(method)
    expect((await readPlan(user)).method).toEqual(method)
    expect(Math.max(...ahead(plan).map((w) => w.runDays))).toBeLessThanOrEqual(3)
    expect(plan.checklist.every((item) => item.ok)).toBe(true)
  })

  test('stores an inapplicable preset as chosen and serves it as the default, with the reason', async () => {
    const user = await seedRunner('method-marathon@example.com')
    const goal = await seedGoal(user.id, MARATHON_M, 'Test Marathon')
    const none = (await generate(user, goal.id)).body as PlanWithSessions

    const res = await generate(user, goal.id, { method: 'three-run-days' })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const plan = res.body as PlanWithSessions
    expect(await storedOptions(plan.id)).toEqual({ method: 'three-run-days' })
    const method = { requested: 'three-run-days', effective: 'default', reason: 'not-applicable' }
    expect(plan.method).toEqual(method)
    expect((await readPlan(user)).method).toEqual(method)
    // read as the default, the plan is the default's
    expect(weeksOf(plan)).toEqual(weeksOf(none))
    expect(plan.sessions.map((s) => [s.date, s.kind, s.durationMin])).toEqual(
      none.sessions.map((s) => [s.date, s.kind, s.durationMin]),
    )
  })

  test('applies longer-base to a marathon and serves it as chosen', async () => {
    const user = await seedRunner('method-p4@example.com')
    const goal = await seedGoal(user.id, MARATHON_M, 'Test Marathon')
    const none = (await generate(user, goal.id)).body as PlanWithSessions

    const res = await generate(user, goal.id, { method: 'longer-base' })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const plan = res.body as PlanWithSessions
    expect(plan.method).toEqual({
      requested: 'longer-base',
      effective: 'longer-base',
      reason: null,
    })
    const phases = (p: PlanWithSessions, phase: string) =>
      p.weeks.filter((w) => w.phase === phase).length
    expect(phases(plan, 'base')).toBeGreaterThan(phases(none, 'base'))
    expect(phases(plan, 'build')).toBeLessThan(phases(none, 'build'))
    expect(plan.checklist.every((item) => item.ok)).toBe(true)
    // no week asks for more than the default's
    plan.weeks.forEach((week, i) => {
      expect(week.targetRunMin).toBeLessThanOrEqual(none.weeks[i]!.targetRunMin)
    })
  })

  test('reads the preset as the default while a recent injury is on file, and applies it again after', async () => {
    const user = await seedRunner('method-held@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    const created = await generate(user, goal.id, { method: 'three-run-days' })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect((created.body as PlanWithSessions).method?.reason).toBeNull()

    await client(ctx, user)
      .put('/api/profile')
      .send({
        injuries: [{ area: 'knee', side: null, year, month: 1, kind: 'joint', notes: null }],
      })
      .expect(200)
    // the read follows the profile at once; the choice stays stored
    const held = await readPlan(user)
    expect(held.method).toEqual({
      requested: 'three-run-days',
      effective: 'default',
      reason: 'held:recent-injury',
    })
    expect(await storedOptions(held.id)).toEqual({ method: 'three-run-days' })

    await client(ctx, user).put('/api/profile').send({ injuries: [] }).expect(200)
    expect((await readPlan(user)).method).toEqual({
      requested: 'three-run-days',
      effective: 'three-run-days',
      reason: null,
    })
  })
})

describe('the stored preset', () => {
  test('survives a re-plan and a change of the load setting, and the weeks keep its shape', async () => {
    const user = await seedRunner('method-replan@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    const created = await generate(user, goal.id, { method: 'three-run-days' })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const planId = (created.body as PlanWithSessions).id
    const method = { requested: 'three-run-days', effective: 'three-run-days', reason: null }

    const replanned = await client(ctx, user).post('/api/plan/replan').send({})
    expect(replanned.status, JSON.stringify(replanned.body)).toBe(200)
    expect(await storedOptions(planId)).toEqual({ method: 'three-run-days' })
    const afterReplan = await readPlan(user)
    expect(afterReplan.id).toBe(planId)
    expect(afterReplan.method).toEqual(method)
    expect(Math.max(...ahead(afterReplan).map((w) => w.runDays))).toBeLessThanOrEqual(3)

    // the load setting is a re-plan of the same plan: the preset rides along in the options
    const standard = await client(ctx, user)
      .put('/api/plan/load')
      .send({ loadAppetite: 'standard' })
    expect(standard.status, JSON.stringify(standard.body)).toBe(200)
    expect(await storedOptions(planId)).toEqual({
      method: 'three-run-days',
      loadAppetite: 'standard',
    })
    const afterLoad = await readPlan(user)
    expect(afterLoad.method).toEqual(method)
    expect(Math.max(...ahead(afterLoad).map((w) => w.runDays))).toBeLessThanOrEqual(3)
  })

  test('is read from the options of a stored plan, and dropped when it is not a preset', () => {
    expect(parsePlanOptions('{"method":"longer-base","recoveryCycle":"2:1"}')).toEqual({
      method: 'longer-base',
      recoveryCycle: '2:1',
    })
    expect(parsePlanOptions('{"method":"default","loadAppetite":"upper"}')).toEqual({
      method: 'default',
      loadAppetite: 'upper',
    })
    // a value that is not a preset reads as no choice, which is the default
    expect(parsePlanOptions('{"method":"shorter-long-run","recoveryCycle":"2:1"}')).toEqual({
      recoveryCycle: '2:1',
    })
    expect(parsePlanOptions('{"method":3}')).toEqual({})
    expect(parsePlanOptions('{"method":null,"loadAppetite":"extreme"}')).toEqual({})
  })
})
