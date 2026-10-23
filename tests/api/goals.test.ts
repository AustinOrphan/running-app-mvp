import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { ArchivedPlanView, Goal, PlanWithSessions } from '../../shared/types.ts'
import { HttpError } from '../../server/errors.ts'
import { replanActivePlan } from '../../server/services/replan.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// The re-plan that follows a restore is the engine's business and has its own tests; here it is a
// spy that runs the real code unless a test makes it fail.
vi.mock('../../server/services/replan.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/replan.ts')>()
  return { ...original, replanActivePlan: vi.fn(original.replanActivePlan) }
})

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

const valid = { name: 'Harbour 10K', priority: 'A', status: 'target', targetDate: '2027-05-09' }

async function createGoal(over: Record<string, unknown> = {}, who = user): Promise<Goal> {
  const res = await client(ctx, who)
    .post('/api/goals')
    .send({ ...valid, ...over })
  expect(res.status).toBe(201)
  return res.body as Goal
}

describe('goals', () => {
  test('requires a session', async () => {
    const res = await client(ctx).get('/api/goals')
    expect(res.status).toBe(401)
  })

  test('CRUD with trimmed strings, empty strings stored as null, defaults dateProvisional false and isActive false', async () => {
    const created = await createGoal({
      name: '  Harbour 10K  ',
      location: '  Riverside  ',
      successCriteria: '   ',
      notes: '',
      url: '',
      distanceM: 10_000,
    })
    expect(created).toMatchObject({
      name: 'Harbour 10K',
      location: 'Riverside',
      successCriteria: null,
      notes: null,
      url: null,
      distanceM: 10_000,
      dateProvisional: false,
      isActive: false,
      userId: user.id,
    })

    const list = await client(ctx, user).get('/api/goals')
    expect(list.status).toBe(200)
    expect((list.body as Goal[]).map((g) => g.id)).toContain(created.id)

    const one = await client(ctx, user).get(`/api/goals/${created.id}`)
    expect(one.status).toBe(200)
    expect(one.body).toEqual(created)

    const updated = await client(ctx, user)
      .put(`/api/goals/${created.id}`)
      .send({ name: ' Harbour Half ', priority: 'B', dateProvisional: true, location: '' })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({
      name: 'Harbour Half',
      priority: 'B',
      dateProvisional: true,
      location: null,
      distanceM: 10_000,
      targetDate: '2027-05-09',
    })

    const gone = await client(ctx, user).delete(`/api/goals/${created.id}`)
    expect(gone.status).toBe(204)
    const after = await client(ctx, user).get(`/api/goals/${created.id}`)
    expect(after.status).toBe(404)
  })

  test('validation: priority A|B|C, status enum, targetDate real date, distanceM 1..500000, url must be http(s) and at most 500 characters', async () => {
    const post = (over: Record<string, unknown>) =>
      client(ctx, user)
        .post('/api/goals')
        .send({ ...valid, ...over })
    for (const bad of [
      { priority: 'D' },
      { priority: 'a' },
      { status: 'maybe' },
      { targetDate: '2027-02-30' },
      { targetDate: '05/09/2027' },
      { name: '   ' },
      { distanceM: 0 },
      { distanceM: 500_001 },
      { distanceM: 10.5 },
      { url: 'javascript:alert(1)' },
      { url: 'data:text/html,x' },
      { url: 'ftp://example.com' },
      { url: 'not a url' },
      { url: `https://example.com/${'a'.repeat(500)}` },
    ]) {
      const res = await post(bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
      expect((res.body as { error: { code: string } }).error.code).toBe('validation')
    }
    const edges = await post({ distanceM: 500_000, url: 'https://example.com/race' })
    expect(edges.status).toBe(201)
    expect((edges.body as Goal).url).toBe('https://example.com/race')
    const one = await post({ distanceM: 1 })
    expect(one.status).toBe(201)

    const goal = await createGoal()
    const put = await client(ctx, user)
      .put(`/api/goals/${goal.id}`)
      .send({ url: 'javascript:alert(1)' })
    expect(put.status).toBe(400)
  })

  test('activate makes exactly one goal active and never generates a plan', async () => {
    const a = await createGoal({ name: 'Goal A' })
    const b = await createGoal({ name: 'Goal B', priority: 'B' })
    const foreign = await createGoal({ name: 'Foreign' }, other)

    const first = await client(ctx, user).post(`/api/goals/${a.id}/activate`)
    expect(first.status).toBe(200)
    expect((first.body as Goal).isActive).toBe(true)

    const second = await client(ctx, user).post(`/api/goals/${b.id}/activate`)
    expect(second.status).toBe(200)
    const list = (await client(ctx, user).get('/api/goals')).body as Goal[]
    expect(list.filter((g) => g.isActive).map((g) => g.id)).toEqual([b.id])

    // Another user's active goal is untouched.
    await client(ctx, other).post(`/api/goals/${foreign.id}/activate`)
    await client(ctx, user).post(`/api/goals/${a.id}/activate`)
    const otherList = (await client(ctx, other).get('/api/goals')).body as Goal[]
    expect(otherList.find((g) => g.id === foreign.id)?.isActive).toBe(true)

    const plan = await client(ctx, user).get('/api/plan')
    expect(plan.status).toBe(200)
    expect(plan.body).toBeNull()

    const done = await createGoal({ name: 'Done', status: 'done' })
    const dropped = await createGoal({ name: 'Dropped', status: 'dropped' })
    expect((await client(ctx, user).post(`/api/goals/${done.id}/activate`)).status).toBe(409)
    expect((await client(ctx, user).post(`/api/goals/${dropped.id}/activate`)).status).toBe(409)
    expect((await client(ctx, user).post(`/api/goals/${foreign.id}/activate`)).status).toBe(404)

    // Marking the active goal done or dropped also deactivates it.
    const finished = await client(ctx, user).put(`/api/goals/${a.id}`).send({ status: 'done' })
    expect(finished.status).toBe(200)
    expect(finished.body).toMatchObject({ status: 'done', isActive: false })
  })

  test('delete: 204, but 409 while the goal has an active plan; other users get not_found', async () => {
    const goal = await createGoal({ name: 'Plan holder' })
    const foreign = await createGoal({ name: 'Foreign delete' }, other)
    const plan = await ctx.prisma.plan.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        name: 'p',
        startDate: '2027-01-04',
        raceWeekStart: '2027-05-03',
        status: 'active',
        generatorVersion: 1,
      },
    })
    const blocked = await client(ctx, user).delete(`/api/goals/${goal.id}`)
    expect(blocked.status).toBe(409)
    expect((blocked.body as { error: { code: string } }).error.code).toBe('conflict')

    await ctx.prisma.plan.update({ where: { id: plan.id }, data: { status: 'archived' } })
    const ok = await client(ctx, user).delete(`/api/goals/${goal.id}`)
    expect(ok.status).toBe(204)
    expect(await ctx.prisma.plan.count({ where: { id: plan.id } })).toBe(0)

    const cross = await client(ctx, user).delete(`/api/goals/${foreign.id}`)
    expect(cross.status).toBe(404)
    expect((await client(ctx, user).get(`/api/goals/${foreign.id}`)).status).toBe(404)
    expect(
      (await client(ctx, user).put(`/api/goals/${foreign.id}`).send({ name: 'x' })).status,
    ).toBe(404)
  })
})

describe('race descriptors', () => {
  test('defaults: road, aided, finish above 42.2 km and time at or below it', async () => {
    const half = await createGoal({ name: 'Half', distanceM: 21_097 })
    expect(half).toMatchObject({
      surface: 'road',
      supportLevel: 'aided',
      goalType: 'time',
      gainM: null,
      lossM: null,
      targetTimeSec: null,
      startTime: null,
      raceLat: null,
      raceLng: null,
    })
    const marathon = await createGoal({ name: 'Marathon', distanceM: 42_195 })
    expect(marathon.goalType).toBe('time')
    const hundred = await createGoal({ name: 'Hundred', distanceM: 160_934 })
    expect(hundred.goalType).toBe('finish')
    const noDistance = await createGoal({ name: 'Someday' })
    expect(noDistance.goalType).toBe('time')
  })

  test('accepts and stores the descriptors, rounding the race location to 0.01 degrees', async () => {
    const created = await createGoal({
      name: 'Trail 50',
      distanceM: 50_000,
      gainM: 2400,
      lossM: 2350,
      surface: 'trail',
      goalType: 'time',
      targetTimeSec: 31_500,
      startTime: '06:30',
      raceLat: 46.8123,
      raceLng: -8.2356,
      supportLevel: 'self',
    })
    expect(created).toMatchObject({
      gainM: 2400,
      lossM: 2350,
      surface: 'trail',
      goalType: 'time',
      targetTimeSec: 31_500,
      startTime: '06:30',
      raceLat: 46.81,
      raceLng: -8.24,
      supportLevel: 'self',
    })
    const res = await client(ctx, user).get(`/api/goals/${created.id}`)
    expect(res.body).toMatchObject({ gainM: 2400, raceLat: 46.81, raceLng: -8.24 })
  })

  test('validation: ranges, enums, HH:MM and a target time for a time goal', async () => {
    const post = (body: Record<string, unknown>) =>
      client(ctx, user)
        .post('/api/goals')
        .send({ ...valid, distanceM: 10_000, ...body })
    const paths = (res: { body: unknown }) =>
      (
        res.body as { error: { details: { issues: Array<{ path: string }> } } }
      ).error.details.issues.map((i) => i.path)

    for (const [field, value] of [
      ['gainM', -1],
      ['gainM', 30_001],
      ['lossM', 30_001],
      ['gainM', 1.5],
      ['surface', 'sand'],
      ['goalType', 'bonus'],
      ['startTime', '6:30'],
      ['startTime', '24:00'],
      ['raceLat', 91],
      ['raceLng', -181],
      ['supportLevel', 'crewed'],
      ['targetTimeSec', 0],
    ] as const) {
      const res = await post({ [field]: value })
      expect(res.status, `${field} ${String(value)}`).toBe(400)
      expect(paths(res)).toContain(field)
    }
    const noTarget = await post({ goalType: 'time' })
    expect(noTarget.status).toBe(400)
    expect(paths(noTarget)).toContain('targetTimeSec')
    expect((await post({ goalType: 'time', targetTimeSec: null })).status).toBe(400)
    expect((await post({ goalType: 'finish' })).status).toBe(201)
    expect((await post({ gainM: 30_000, lossM: 0 })).status).toBe(201)
  })

  test('PUT changes only the descriptors it carries and can clear them', async () => {
    const created = await createGoal({
      name: 'Hills',
      distanceM: 21_097,
      gainM: 800,
      surface: 'trail',
      goalType: 'time',
      targetTimeSec: 7200,
    })
    const put = (body: Record<string, unknown>) =>
      client(ctx, user).put(`/api/goals/${created.id}`).send(body)

    await put({ raceLat: 46.5, raceLng: 8.25 })
    const notesOnly = await put({ notes: 'Bring gels.' })
    expect(notesOnly.status).toBe(200)
    expect(notesOnly.body).toMatchObject({
      raceLat: 46.5,
      raceLng: 8.25,
      gainM: 800,
      surface: 'trail',
      goalType: 'time',
      targetTimeSec: 7200,
    })

    const cleared = await put({ gainM: null, startTime: '07:00', goalType: 'finish' })
    expect(cleared.body).toMatchObject({ gainM: null, startTime: '07:00', goalType: 'finish' })

    // A time goal keeps its target: switching back reuses it, clearing it is refused.
    const switched = await put({ goalType: 'time' })
    expect(switched.status).toBe(200)
    expect(switched.body).toMatchObject({ goalType: 'time', targetTimeSec: 7200 })
    expect((await put({ targetTimeSec: null })).status).toBe(400)
    expect((await put({ goalType: 'time', targetTimeSec: null })).status).toBe(400)
    expect((await put({ goalType: 'finish', targetTimeSec: null })).status).toBe(200)
    expect((await put({ goalType: 'time' })).status).toBe(400)

    expect((await put({ raceLat: 12.3456 })).body).toMatchObject({ raceLat: 12.35 })
  })

  test('a goal made before the descriptors existed can still be edited without touching the type', async () => {
    const legacy = await ctx.prisma.goal.create({
      data: {
        userId: user.id,
        name: 'Old',
        priority: 'B',
        targetDate: '2027-05-09',
        distanceM: 10_000,
      },
    })
    const res = await client(ctx, user)
      .put(`/api/goals/${legacy.id}`)
      .send({ notes: 'Still fine.' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ goalType: 'time', targetTimeSec: null, notes: 'Still fine.' })
  })
})

// ---------------------------------------------------------------------------------------------
// Make active moves the plan; archived plans come back (phase 3a design 5.4)
// ---------------------------------------------------------------------------------------------

const today = todayIso()
const thisMonday = mondayOf(today)

afterEach(() => {
  vi.mocked(replanActivePlan).mockClear()
})

/** Twelve completed weeks of four runs, so the engine has a history to build on. */
async function seedHistory(userId: string): Promise<void> {
  const week = [
    { dow: 1, min: 40, distanceM: 6400 },
    { dow: 3, min: 45, distanceM: 7200 },
    { dow: 5, min: 35, distanceM: 5600 },
    { dow: 6, min: 70, distanceM: 11_000 },
  ]
  const rows = []
  for (let w = 1; w <= 12; w += 1) {
    for (const run of week) {
      rows.push({
        userId,
        date: addDays(thisMonday, -7 * w + run.dow),
        type: 'run',
        durationSec: run.min * 60,
        movingSec: run.min * 60,
        distanceM: run.distanceM,
        rpe: 3,
        source: 'manual',
      })
    }
  }
  await ctx.prisma.activity.createMany({ data: rows })
}

let counter = 0

interface Runner {
  who: TestUser
  /** The plan's goal. */
  half: Goal
  /** A second goal with no plan. */
  tenK: Goal
  plan: PlanWithSessions
}

/** A runner with a history, a half-marathon goal that has the plan, and a 10K goal that has none. */
async function runnerWithPlan(options: Record<string, unknown> = {}): Promise<Runner> {
  counter += 1
  const who = await seedUser(ctx, { email: `switch${String(counter)}@example.com` })
  await seedHistory(who.id)
  const half = await createGoal(
    {
      name: 'Spring half',
      distanceM: 21_097,
      goalType: 'finish',
      targetDate: addDays(thisMonday, 7 * 12 + 5),
    },
    who,
  )
  const tenK = await createGoal(
    {
      name: 'Autumn 10K',
      distanceM: 10_000,
      goalType: 'finish',
      targetDate: addDays(thisMonday, 7 * 10 + 5),
    },
    who,
  )
  const generated = await client(ctx, who)
    .post('/api/plan/generate')
    .send({ goalId: half.id, options })
  expect(generated.status, JSON.stringify(generated.body)).toBe(201)
  return { who, half, tenK, plan: generated.body as PlanWithSessions }
}

const activate = (who: TestUser, goalId: string, body?: Record<string, unknown> | unknown[]) => {
  const call = client(ctx, who).post(`/api/goals/${goalId}/activate`)
  return body === undefined ? call : call.send(body)
}

const planRows = (userId: string) =>
  ctx.prisma.plan.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })

const activeGoalIds = async (userId: string) =>
  (await ctx.prisma.goal.findMany({ where: { userId, isActive: true } })).map((g) => g.id)

describe('POST /api/goals/:id/activate while a plan follows another goal', () => {
  test('answers 409 with what it takes and changes nothing; the body is optional and strict', async () => {
    const { who, half, tenK, plan } = await runnerWithPlan()
    const revisions = await ctx.prisma.planRevision.count({ where: { planId: plan.id } })

    for (const body of [undefined, {}, { replacePlan: false }]) {
      const res = await activate(who, tenK.id, body)
      expect(res.status).toBe(409)
      expect(res.body).toMatchObject({
        error: {
          code: 'conflict',
          message: expect.stringContaining('The plan follows Spring half.') as unknown,
          details: { requires: 'replacePlan', planGoalId: half.id, planGoalName: 'Spring half' },
        },
      })
    }
    expect(await activeGoalIds(who.id)).toEqual([half.id])
    expect((await planRows(who.id)).map((p) => [p.id, p.status])).toEqual([[plan.id, 'active']])
    expect(await ctx.prisma.planRevision.count({ where: { planId: plan.id } })).toBe(revisions)

    for (const body of [{ replacePlan: 'yes' }, { replacePlan: true, extra: 1 }, []]) {
      expect((await activate(who, tenK.id, body)).status).toBe(400)
    }
    expect(await planRows(who.id)).toHaveLength(1)
  })

  test('replacePlan builds the plan for the goal, archives the old one and writes a goal-switch revision', async () => {
    const { who, half, tenK, plan } = await runnerWithPlan({
      strengthSessions: 0,
      recoveryCycle: '2:1',
    })
    const before = await ctx.prisma.planSession.findMany({ where: { planId: plan.id } })

    const res = await activate(who, tenK.id, { replacePlan: true })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({ id: tenK.id, isActive: true })
    expect(await activeGoalIds(who.id)).toEqual([tenK.id])

    const [old, built] = await planRows(who.id)
    expect(old).toMatchObject({ id: plan.id, status: 'archived', goalId: half.id })
    expect(built).toMatchObject({ status: 'active', goalId: tenK.id, generatorVersion: 2 })
    // The runner's options carry over to the plan for the new goal.
    expect(JSON.parse(built!.options)).toEqual({ strengthSessions: 0, recoveryCycle: '2:1' })
    const served = (await client(ctx, who).get('/api/plan')).body as PlanWithSessions
    expect(served.id).toBe(built!.id)

    // One revision, written with the plan through `recordPlanWrite`: no diff, nothing to undo.
    const revisions = await ctx.prisma.planRevision.findMany({ where: { planId: built!.id } })
    expect(revisions).toHaveLength(1)
    expect(revisions[0]).toMatchObject({
      reason: 'goal-switch',
      summary: expect.stringContaining('Plan switched to Autumn 10K') as unknown,
      auto: false,
      diff: null,
      undo: null,
    })
    expect(await ctx.prisma.planRevision.count({ where: { planId: plan.id } })).toBe(1)

    // A session that stays on its day and kind keeps its externalId; no id is used twice.
    const after = await ctx.prisma.planSession.findMany({ where: { planId: built!.id } })
    const oldKey = new Map(before.map((r) => [r.externalId, `${r.date}|${r.kind}`]))
    const shared = after.filter((r) => oldKey.has(r.externalId))
    expect(shared.length).toBeGreaterThan(0)
    for (const row of shared) expect(oldKey.get(row.externalId)).toBe(`${row.date}|${row.kind}`)
    expect(new Set(after.map((r) => r.externalId)).size).toBe(after.length)
    // The archived plan keeps its rows, ids and externalIds as they were.
    const archivedRows = await ctx.prisma.planSession.findMany({ where: { planId: plan.id } })
    expect(archivedRows.map((r) => [r.id, r.externalId]).sort()).toEqual(
      before.map((r) => [r.id, r.externalId]).sort(),
    )
  })

  test('a plan that cannot be built changes nothing', async () => {
    const { who, half, tenK, plan } = await runnerWithPlan()
    await ctx.prisma.goal.update({ where: { id: tenK.id }, data: { distanceM: null } })
    const revisions = await ctx.prisma.planRevision.count()

    const noDistance = await activate(who, tenK.id, { replacePlan: true })
    expect(noDistance.status).toBe(400)
    expect(noDistance.body).toMatchObject({ error: { code: 'validation' } })

    await ctx.prisma.goal.update({
      where: { id: tenK.id },
      data: { distanceM: 10_000, targetDate: addDays(today, -1) },
    })
    const passed = await activate(who, tenK.id, { replacePlan: true })
    expect(passed.status).toBe(400)

    expect(await activeGoalIds(who.id)).toEqual([half.id])
    expect((await planRows(who.id)).map((p) => [p.id, p.status])).toEqual([[plan.id, 'active']])
    expect(await ctx.prisma.planRevision.count()).toBe(revisions)
  })

  test('a finished or dropped goal is refused, with or without replacePlan', async () => {
    const { who, half, plan } = await runnerWithPlan()
    const done = await createGoal({ name: 'Done', status: 'done' }, who)
    const dropped = await createGoal({ name: 'Dropped', status: 'dropped' }, who)
    for (const goal of [done, dropped]) {
      for (const body of [undefined, { replacePlan: true }]) {
        expect((await activate(who, goal.id, body)).status).toBe(409)
      }
    }
    expect(await activeGoalIds(who.id)).toEqual([half.id])
    expect((await planRows(who.id)).map((p) => p.id)).toEqual([plan.id])
  })

  test('another runner s goal is not found', async () => {
    const { who } = await runnerWithPlan()
    const theirs = await createGoal({ name: 'Theirs' }, other)
    expect((await activate(who, theirs.id, { replacePlan: true })).status).toBe(404)
    expect((await activate(who, 'no-such-goal')).status).toBe(404)
  })
})

describe('POST /api/goals/:id/activate when no plan has to move', () => {
  test('the plan s own goal only has its flag set, even when another goal was marked active', async () => {
    const { who, half, tenK, plan } = await runnerWithPlan()
    await ctx.prisma.goal.updateMany({ where: { userId: who.id }, data: { isActive: false } })
    await ctx.prisma.goal.update({ where: { id: tenK.id }, data: { isActive: true } })

    const res = await activate(who, half.id)
    expect(res.status).toBe(200)
    expect(await activeGoalIds(who.id)).toEqual([half.id])
    expect((await planRows(who.id)).map((p) => [p.id, p.status])).toEqual([[plan.id, 'active']])
    expect(await ctx.prisma.planRevision.count({ where: { planId: plan.id } })).toBe(1)
    // replacePlan changes nothing when the plan is already on this goal.
    expect((await activate(who, half.id, { replacePlan: true })).status).toBe(200)
    expect(await planRows(who.id)).toHaveLength(1)
  })

  test('a plan from the version-1 generator does not hold the goal: only the flag moves', async () => {
    counter += 1
    const who = await seedUser(ctx, { email: `legacy${String(counter)}@example.com` })
    const a = await createGoal({ name: 'Legacy A', distanceM: 10_000 }, who)
    const b = await createGoal({ name: 'Legacy B', distanceM: 10_000 }, who)
    const legacy = await ctx.prisma.plan.create({
      data: {
        userId: who.id,
        goalId: a.id,
        name: a.name,
        startDate: thisMonday,
        raceWeekStart: thisMonday,
        generatorVersion: 1,
      },
    })
    const res = await activate(who, b.id, { replacePlan: true })
    expect(res.status).toBe(200)
    expect(await activeGoalIds(who.id)).toEqual([b.id])
    expect((await planRows(who.id)).map((p) => [p.id, p.status])).toEqual([[legacy.id, 'active']])
  })
})

describe('GET /api/plan/archived', () => {
  test('lists the archived plan with the goal, the race week and whether it can come back', async () => {
    const { who, half, tenK, plan } = await runnerWithPlan()
    expect(((await client(ctx, who).get('/api/plan/archived')).body as unknown[]).length).toBe(0)
    await activate(who, tenK.id, { replacePlan: true })

    const res = await client(ctx, who).get('/api/plan/archived')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        id: plan.id,
        goalId: half.id,
        goalName: 'Spring half',
        raceWeekStart: mondayOf(half.targetDate),
        archivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
        restorable: true,
        reason: null,
      },
    ])
    expect((await client(ctx).get('/api/plan/archived')).status).toBe(401)
  })

  test('says why a plan cannot come back: finished goal, passed race date, older generator', async () => {
    const { who, half, tenK, plan } = await runnerWithPlan()
    await activate(who, tenK.id, { replacePlan: true })
    const list = async () =>
      (await client(ctx, who).get('/api/plan/archived')).body as ArchivedPlanView[]

    await ctx.prisma.goal.update({ where: { id: half.id }, data: { status: 'done' } })
    expect((await list())[0]).toMatchObject({
      restorable: false,
      reason: 'The goal is finished or dropped, so its plan cannot be restored.',
    })
    await ctx.prisma.goal.update({
      where: { id: half.id },
      data: { status: 'target', targetDate: addDays(today, -1) },
    })
    expect((await list())[0]).toMatchObject({
      restorable: false,
      reason: 'The race date has passed, so this plan cannot be restored.',
    })
    await ctx.prisma.goal.update({
      where: { id: half.id },
      data: { targetDate: addDays(today, 70) },
    })
    await ctx.prisma.plan.update({ where: { id: plan.id }, data: { generatorVersion: 1 } })
    expect((await list())[0]).toMatchObject({
      restorable: false,
      reason: 'This plan was made by an earlier version of the app, so it cannot be restored.',
    })
  })

  test('lists at most the five newest, scoped to the runner', async () => {
    counter += 1
    const who = await seedUser(ctx, { email: `archive${String(counter)}@example.com` })
    const goal = await createGoal({ name: 'Many plans', distanceM: 10_000 }, who)
    const theirs = await createGoal({ name: 'Theirs', distanceM: 10_000 }, other)
    const make = (userId: string, goalId: string, minute: number) =>
      ctx.prisma.plan.create({
        data: {
          userId,
          goalId,
          name: 'p',
          startDate: thisMonday,
          raceWeekStart: thisMonday,
          generatorVersion: 2,
          status: 'archived',
          updatedAt: new Date(2026, 0, 1, 0, minute),
        },
      })
    const ids: string[] = []
    for (let minute = 0; minute < 7; minute += 1) ids.push((await make(who.id, goal.id, minute)).id)
    await make(other.id, theirs.id, 30)
    const listed = (await client(ctx, who).get('/api/plan/archived')).body as ArchivedPlanView[]
    expect(listed.map((p) => p.id)).toEqual(ids.slice(2).reverse())
  })
})

describe('POST /api/plan/archived/:id/restore', () => {
  const restore = (who: TestUser, planId: string) =>
    client(ctx, who).post(`/api/plan/archived/${planId}/restore`)

  test('brings the plan and its goal back, keeps every id and externalId and writes a Plan restored revision', async () => {
    const { who, half, tenK, plan } = await runnerWithPlan()
    const original = await ctx.prisma.planSession.findMany({ where: { planId: plan.id } })
    await activate(who, tenK.id, { replacePlan: true })
    const [, switched] = await planRows(who.id)

    const res = await restore(who, plan.id)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toEqual({ planId: plan.id, goalId: half.id, replanned: true, message: null })
    expect(vi.mocked(replanActivePlan)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(replanActivePlan).mock.calls[0]?.[1]).toMatchObject({
      userId: who.id,
      reason: 'owner',
      today,
    })

    expect((await planRows(who.id)).map((p) => [p.id, p.status])).toEqual([
      [plan.id, 'active'],
      [switched!.id, 'archived'],
    ])
    expect(await activeGoalIds(who.id)).toEqual([half.id])
    expect(((await client(ctx, who).get('/api/plan')).body as PlanWithSessions).id).toBe(plan.id)

    // Nothing about the data changed since the plan was made, so the re-plan moves no session.
    const after = await ctx.prisma.planSession.findMany({ where: { planId: plan.id } })
    expect(after.map((r) => [r.id, r.externalId]).sort()).toEqual(
      original.map((r) => [r.id, r.externalId]).sort(),
    )

    const revisions = await ctx.prisma.planRevision.findMany({
      where: { planId: plan.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(revisions.map((r) => [r.reason, r.summary])).toEqual([
      ['generate', expect.any(String) as unknown],
      ['owner', 'Plan restored.'],
      ['owner', expect.any(String) as unknown],
    ])
    expect(revisions[1]).toMatchObject({ auto: false, diff: null, undo: null })

    // The plan for the other goal is now the one in the archive, and can come back in turn.
    const archived = (await client(ctx, who).get('/api/plan/archived')).body as ArchivedPlanView[]
    expect(archived).toMatchObject([{ id: switched!.id, goalId: tenK.id, restorable: true }])
  })

  test('answers 409 for a finished goal, a passed race date, an older plan and the active plan', async () => {
    const { who, half, tenK, plan } = await runnerWithPlan()
    expect((await restore(who, plan.id)).status).toBe(409)
    await activate(who, tenK.id, { replacePlan: true })

    await ctx.prisma.goal.update({ where: { id: half.id }, data: { status: 'dropped' } })
    const closed = await restore(who, plan.id)
    expect(closed.status).toBe(409)
    expect(closed.body).toMatchObject({
      error: { message: 'The goal is finished or dropped, so its plan cannot be restored.' },
    })
    await ctx.prisma.goal.update({
      where: { id: half.id },
      data: { status: 'target', targetDate: addDays(today, -2) },
    })
    expect((await restore(who, plan.id)).status).toBe(409)
    await ctx.prisma.goal.update({
      where: { id: half.id },
      data: { targetDate: addDays(today, 70) },
    })
    await ctx.prisma.plan.update({ where: { id: plan.id }, data: { generatorVersion: 1 } })
    expect((await restore(who, plan.id)).status).toBe(409)

    // Every refusal left the plan for the 10K as the active one.
    expect((await planRows(who.id)).map((p) => p.status)).toEqual(['archived', 'active'])
    expect(await activeGoalIds(who.id)).toEqual([tenK.id])
    expect(vi.mocked(replanActivePlan)).not.toHaveBeenCalled()
  })

  test('is not found for another runner s plan and needs a session', async () => {
    const { plan } = await runnerWithPlan()
    const { who } = await runnerWithPlan()
    expect((await restore(who, plan.id)).status).toBe(404)
    expect((await restore(who, 'no-such-plan')).status).toBe(404)
    expect((await client(ctx).post(`/api/plan/archived/${plan.id}/restore`)).status).toBe(401)
  })

  test('a re-plan that the checklist blocks leaves the plan restored and says so', async () => {
    const { who, half, tenK, plan } = await runnerWithPlan()
    await activate(who, tenK.id, { replacePlan: true })
    const message = 'The plan did not pass the quality checklist (G-1), so it was not published.'
    vi.mocked(replanActivePlan).mockRejectedValueOnce(
      new HttpError(422, 'validation', message, { checklist: [] }),
    )

    const res = await restore(who, plan.id)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ planId: plan.id, goalId: half.id, replanned: false, message })
    expect((await planRows(who.id)).map((p) => p.status)).toEqual(['active', 'archived'])
    expect(await activeGoalIds(who.id)).toEqual([half.id])
    const revisions = await ctx.prisma.planRevision.findMany({ where: { planId: plan.id } })
    expect(revisions.map((r) => r.summary)).toContain('Plan restored.')
  })

  test('an unexpected failure of the re-plan is an error, not a quiet replanned: false', async () => {
    const { who, tenK, plan } = await runnerWithPlan()
    await activate(who, tenK.id, { replacePlan: true })
    vi.mocked(replanActivePlan).mockRejectedValueOnce(new Error('the engine is down'))
    expect((await restore(who, plan.id)).status).toBe(500)
  })
})
