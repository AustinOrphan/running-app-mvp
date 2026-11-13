import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { PlanWithWeeks } from '../../shared/types.ts'
import { writeReplannedSessions } from '../../server/services/planEngine.ts'
import { writeReplannedWeeks } from '../../server/services/replan.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

/**
 * SW1: every write names the runner as well as the row, so a second runner's request answers what
 * it always did (404) and the first runner's row stays as it was. The last test goes under the
 * route: the write helpers that take a plan id write nothing when handed another runner's id.
 */

let ctx: TestCtx
let owner: TestUser
let intruder: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  owner = await seedUser(ctx, { email: 'owner@example.com' })
  intruder = await seedUser(ctx, { email: 'intruder@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

const run = { date: '2026-03-02', type: 'run', durationSec: 1800, distanceM: 5000 }

describe('a second runner cannot write the first runner rows', () => {
  test('goals: PUT and DELETE answer 404 and leave the goal alone', async () => {
    const goal = await ctx.prisma.goal.create({
      data: { userId: owner.id, name: 'Owner goal', priority: 'A', targetDate: '2027-05-09' },
    })
    const c = client(ctx, intruder)
    expect((await c.put(`/api/goals/${goal.id}`).send({ name: 'Taken' })).status).toBe(404)
    expect((await c.delete(`/api/goals/${goal.id}`)).status).toBe(404)
    const after = await ctx.prisma.goal.findUniqueOrThrow({ where: { id: goal.id } })
    expect(after.name).toBe('Owner goal')
  })

  test('activities: PUT, PATCH and PUT feedback, DELETE and duplicate resolution answer 404', async () => {
    const created = await client(ctx, owner).post('/api/activities').send(run)
    expect(created.status).toBe(201)
    const id = (created.body as { id: string }).id
    const c = client(ctx, intruder)
    expect((await c.put(`/api/activities/${id}`).send({ ...run, distanceM: 1 })).status).toBe(404)
    expect((await c.put(`/api/activities/${id}/feedback`).send({ rpe: 9 })).status).toBe(404)
    expect((await c.patch(`/api/activities/${id}/feedback`).send({ rpe: 9 })).status).toBe(404)
    expect(
      (await c.post(`/api/activities/${id}/duplicate`).send({ status: 'confirmed' })).status,
    ).toBe(404)
    expect((await c.delete(`/api/activities/${id}`)).status).toBe(404)
    const after = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
    expect(after).toMatchObject({ userId: owner.id, distanceM: 5000, rpe: null })
  })

  test('fuel products: PUT and DELETE answer 404 and leave the product alone', async () => {
    const gel = {
      name: 'Synthetic gel',
      kind: 'gel',
      servingLabel: '1 gel',
      carbsG: 40,
      sodiumMg: 100,
      kcal: 160,
      multiCarb: true,
    }
    const made = await client(ctx, owner).post('/api/fuel/products').send(gel)
    expect(made.status).toBe(201)
    const product = made.body as { id: string; name: string }
    const c = client(ctx, intruder)
    const body = { ...gel, name: 'Taken', carbsG: 1 }
    expect((await c.put(`/api/fuel/products/${product.id}`).send(body)).status).toBe(404)
    expect((await c.delete(`/api/fuel/products/${product.id}`)).status).toBe(404)
    const after = await ctx.prisma.fuelProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(after).toMatchObject({ name: 'Synthetic gel', archived: false })
  })

  test('plan weeks: PUT answers 404 to a runner with no plan and leaves the week alone', async () => {
    const monday = mondayOf(todayIso())
    const goal = await ctx.prisma.goal.create({
      data: {
        userId: owner.id,
        name: 'Plan goal',
        priority: 'A',
        targetDate: addDays(monday, 7 * 14 + 6),
        distanceM: 21_097,
      },
    })
    const generated = await client(ctx, owner)
      .post('/api/plan/generate')
      .send({ goalId: goal.id, baselineRunMin: 150 })
    expect(generated.status).toBe(201)
    const week = (generated.body as PlanWithWeeks).weeks[2]!
    const res = await client(ctx, intruder)
      .put(`/api/plan/weeks/${week.weekStart}`)
      .send({ focus: 'Taken' })
    expect(res.status).toBe(404)
    const after = await ctx.prisma.planWeek.findFirstOrThrow({
      where: { planId: week.planId, weekStart: week.weekStart },
    })
    expect(after.focus).toBe(week.focus)
  })

  test('the plan write helpers write nothing for another runner', async () => {
    const plan = await ctx.prisma.plan.findFirstOrThrow({ where: { userId: owner.id } })
    const weeksBefore = await ctx.prisma.planWeek.findMany({ where: { planId: plan.id } })
    const sessionsBefore = await ctx.prisma.planSession.findMany({ where: { planId: plan.id } })
    const today = todayIso()
    await ctx.prisma
      .$transaction(async (tx) => {
        // An empty draft deletes the future rows of the plan when the owner writes it.
        await writeReplannedWeeks(tx, {
          userId: intruder.id,
          planId: plan.id,
          today,
          weeks: [],
        })
        await writeReplannedSessions(tx, {
          userId: intruder.id,
          planId: plan.id,
          today,
          sessions: [],
        })
      })
      .catch(() => undefined)
    expect(await ctx.prisma.planWeek.findMany({ where: { planId: plan.id } })).toEqual(weeksBefore)
    expect(await ctx.prisma.planSession.findMany({ where: { planId: plan.id } })).toEqual(
      sessionsBefore,
    )
  })
})
