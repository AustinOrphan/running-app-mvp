import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import { client, createTestCtx, seedUser, type TestCtx } from './helpers.ts'
import { runsOn, weeks } from '../unit/engine/history-fixtures.ts'

// A re-plan after a change to an entered race that fails leaves the goal write standing and tells
// the runner on the Plan page (task SR1): a warning on the stored plan, not only a log line.

vi.mock('../../server/services/replan.ts', async (original) => ({
  ...(await original<typeof import('../../server/services/replan.ts')>()),
  replanActivePlan: vi.fn(() => Promise.reject(new Error('the plan did not pass'))),
}))

let ctx: TestCtx
beforeAll(async () => {
  ctx = await createTestCtx()
})
afterAll(async () => {
  await ctx.close()
})

test('the goal is saved and the Plan page carries a warning that the plan has not taken it', async () => {
  const today = todayIso()
  const monday = mondayOf(today)
  const user = await seedUser(ctx, { email: 'races-failure@example.com' })
  await client(ctx, user)
    .put('/api/profile')
    .send({
      birthYear: Number(today.slice(0, 4)) - 41,
      runningSinceYear: Number(today.slice(0, 4)) - 1,
    })
    .expect(200)
  await ctx.prisma.activity.createMany({
    data: runsOn(monday, weeks(12, 1, [50, 50, 50, 70])).map((a) => ({
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
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic Marathon',
      priority: 'A',
      status: 'target',
      targetDate: addDays(monday, 146),
      distanceM: 42_195,
    },
  })
  await client(ctx, user).post('/api/plan/generate').send({ goalId: goal.id }).expect(201)

  const created = await client(ctx, user)
    .post('/api/goals')
    .send({
      name: 'Synthetic Tune-up',
      priority: 'B',
      status: 'target',
      targetDate: addDays(monday, 61),
      distanceM: 40_000,
      goalType: 'finish',
    })
  expect(created.status).toBe(201)
  const plan = (await client(ctx, user).get('/api/plan')).body as PlanWithSessions
  expect(plan.warnings.map((w) => w.code)).toContain('races-replan-pending')
  expect(plan.warnings.find((w) => w.code === 'races-replan-pending')!.message).toMatch(
    /not in the plan yet/,
  )
})
