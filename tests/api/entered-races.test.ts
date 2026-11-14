import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { PARAMS_VERSION } from '../../shared/engine/params/index.ts'
import type { PlanRevisionView, PlanWithSessions } from '../../shared/types.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'
import { weeks } from '../unit/engine/history-fixtures.ts'
import { runsOn } from '../unit/engine/history-fixtures.ts'

// A goal the runner enters with priority B or C before the goal race re-plans the active plan
// around it (rules K6, H12, task SR1, owner decision D6, 2026-11-14): a race session, the easing
// before it, the recovery after it; moving, changing or removing it re-plans again, each one
// revision with a templated summary, and the race leaves the plan with the goal.

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
const GOAL_DATE = addDays(thisMonday, 7 * 20 + 6)
const TUNE_UP = addDays(thisMonday, 7 * 8 + 5)
const TUNE_UP_M = 40_000

async function seedPlan(email: string) {
  const user = await seedUser(ctx, { email })
  await client(ctx, user)
    .put('/api/profile')
    .send({ birthYear: year - 41, runningSinceYear: year - 1 })
    .expect(200)
  await ctx.prisma.activity.createMany({
    data: runsOn(thisMonday, weeks(12, 1, [50, 50, 50, 70])).map((a) => ({
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
      targetDate: GOAL_DATE,
      distanceM: 42_195,
    },
  })
  const created = await client(ctx, user).post('/api/plan/generate').send({ goalId: goal.id })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  expect((await client(ctx, user).post('/api/plan/replan').send({})).status).toBe(200)
  return user
}

const readPlan = async (user: TestUser) =>
  (await client(ctx, user).get('/api/plan')).body as PlanWithSessions
const revisions = async (user: TestUser) =>
  (await client(ctx, user).get('/api/plan/revisions?limit=50')).body as PlanRevisionView[]
const shape = (plan: PlanWithSessions) =>
  plan.sessions
    .filter((s) => s.date >= addDays(thisMonday, 14))
    .map((s) => [s.date, s.kind, s.durationMin] as const)
const addGoal = (user: TestUser, over: Record<string, unknown> = {}) =>
  client(ctx, user)
    .post('/api/goals')
    .send({
      name: 'Synthetic Tune-up',
      priority: 'B',
      status: 'target',
      targetDate: TUNE_UP,
      distanceM: TUNE_UP_M,
      goalType: 'finish',
      ...over,
    })
const raceDays = (plan: PlanWithSessions) =>
  plan.sessions.filter((s) => s.kind === 'race').map((s) => s.date)

describe('a B goal entered before the goal race', () => {
  test('re-plans with a revision, then moving, changing and removing it re-plan again', async () => {
    const user = await seedPlan('races-b@example.com')
    const before = await readPlan(user)
    expect(raceDays(before)).toEqual([GOAL_DATE])
    const revisionsBefore = (await revisions(user)).length

    // added
    const created = await addGoal(user)
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const goalId = (created.body as { id: string }).id
    const withRace = await readPlan(user)
    expect(raceDays(withRace)).toEqual([TUNE_UP, GOAL_DATE])
    const added = (await revisions(user))[0]!
    expect((await revisions(user)).length).toBe(revisionsBefore + 1)
    expect(added.reason).toBe('races-changed')
    expect(added.auto).toBe(false)
    expect(added.summary).toMatch(/^Plan drawn around the race Synthetic Tune-up on .+\./)
    assertCleanCopy(added.summary)
    // RV1: the write redrew the plan through the engine, so it records the rules it was drawn under
    const row = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: added.id } })
    expect(row.paramsVersion).toBe(PARAMS_VERSION)
    // the day after the race is the rest of its recovery
    expect(
      withRace.sessions.filter((s) => s.date === addDays(TUNE_UP, 1)).map((s) => s.kind),
    ).toEqual(['rest'])
    // the plan before the easing is the plan it was
    const easing = addDays(TUNE_UP, -2)
    expect(shape(withRace).filter(([date]) => date < easing)).toEqual(
      shape(before).filter(([date]) => date < easing),
    )

    // changed priority, same date
    const changed = await client(ctx, user).put(`/api/goals/${goalId}`).send({ priority: 'C' })
    expect(changed.status).toBe(200)
    expect((await revisions(user))[0]!.summary).toMatch(
      /^Plan drawn again for the race Synthetic Tune-up on /,
    )

    // moved a week later
    const moved = await client(ctx, user)
      .put(`/api/goals/${goalId}`)
      .send({ targetDate: addDays(TUNE_UP, 7) })
    expect(moved.status).toBe(200)
    expect((await revisions(user))[0]!.summary).toMatch(
      /^Plan drawn around the race Synthetic Tune-up, now on /,
    )
    expect(raceDays(await readPlan(user))).toEqual([addDays(TUNE_UP, 7), GOAL_DATE])

    // a change the plan does not read writes no revision
    const count = (await revisions(user)).length
    await client(ctx, user).put(`/api/goals/${goalId}`).send({ notes: 'a note' }).expect(200)
    expect((await revisions(user)).length).toBe(count)

    // removed: the race leaves the plan with the easing and the recovery
    await client(ctx, user).delete(`/api/goals/${goalId}`).expect(204)
    const removed = (await revisions(user))[0]!
    expect(removed.reason).toBe('races-changed')
    expect(removed.summary).toBe('The race Synthetic Tune-up is no longer in the plan.')
    const restored = await readPlan(user)
    expect(raceDays(restored)).toEqual([GOAL_DATE])
    expect(shape(restored)).toEqual(shape(before))
  })

  test('the revision can be undone; the next re-plan draws the entered race again', async () => {
    const user = await seedPlan('races-undo@example.com')
    const before = await readPlan(user)
    await addGoal(user).expect(201)
    const [added] = await revisions(user)
    const undone = await client(ctx, user).post(`/api/plan/revisions/${added!.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(shape(await readPlan(user))).toEqual(shape(before))
    // the goal is still entered, so any later re-plan draws it again
    expect((await client(ctx, user).post('/api/plan/replan').send({})).status).toBe(200)
    expect(raceDays(await readPlan(user))).toEqual([TUNE_UP, GOAL_DATE])
  })
})

describe('goals the plan is not drawn around', () => {
  test.each([
    ['one still being considered', { status: 'considering' }],
    ['an A-priority goal other than the plan goal', { priority: 'A' }],
    ['a race after the goal race', { targetDate: addDays(GOAL_DATE, 14) }],
    ['a race that has passed', { targetDate: addDays(today, -3) }],
  ])('%s writes no revision and no race session', async (_label, over) => {
    const user = await seedPlan(`races-skip-${String(Math.random()).slice(2, 8)}@example.com`)
    const count = (await revisions(user)).length
    const before = await readPlan(user)
    await addGoal(user, over).expect(201)
    expect((await revisions(user)).length).toBe(count)
    expect(shape(await readPlan(user))).toEqual(shape(before))
  })

  test('a goal entered with no active plan writes nothing', async () => {
    const user = await seedUser(ctx, { email: 'races-noplan@example.com' })
    await addGoal(user).expect(201)
    expect(await ctx.prisma.planRevision.count({ where: { plan: { userId: user.id } } })).toBe(0)
  })
})
