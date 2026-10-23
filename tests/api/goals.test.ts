import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Goal } from '../../shared/types.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

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

  test('the race place is both coordinates or neither, on POST and on PUT', async () => {
    const post = (body: Record<string, unknown>) =>
      client(ctx, user)
        .post('/api/goals')
        .send({ name: 'Place', priority: 'A', targetDate: '2027-05-09', ...body })
    const paths = (res: { body: { error: { details: { issues: Array<{ path: string }> } } } }) =>
      res.body.error.details.issues.map((issue) => issue.path)

    const latOnly = await post({ raceLat: 40.12 })
    expect(latOnly.status).toBe(400)
    expect(paths(latOnly)).toEqual(['raceLng'])
    const lngOnly = await post({ raceLng: -105.2, raceLat: null })
    expect(lngOnly.status).toBe(400)
    expect(paths(lngOnly)).toEqual(['raceLat'])
    expect((await post({ raceLat: 40.12, raceLng: -105.2 })).status).toBe(201)
    expect((await post({ raceLat: null, raceLng: null })).status).toBe(201)
    expect((await post({})).status).toBe(201)

    const created = await createGoal({ name: 'Edit place' })
    const put = (body: Record<string, unknown>) =>
      client(ctx, user).put(`/api/goals/${created.id}`).send(body)
    // The pair is judged as saved plus patched.
    const half = await put({ raceLat: 40.12 })
    expect(half.status).toBe(400)
    expect(paths(half)).toEqual(['raceLng'])
    expect((await put({ raceLat: 40.12, raceLng: -105.2 })).status).toBe(200)
    expect((await put({ raceLat: 41.5 })).body).toMatchObject({ raceLat: 41.5, raceLng: -105.2 })
    const cleared = await put({ raceLng: null })
    expect(cleared.status).toBe(400)
    expect(paths(cleared)).toEqual(['raceLng'])
    expect((await put({ raceLat: null, raceLng: null })).body).toMatchObject({
      raceLat: null,
      raceLng: null,
    })
  })

  test('a goal saved with a lone coordinate before the check can still be edited elsewhere', async () => {
    const legacy = await ctx.prisma.goal.create({
      data: {
        userId: user.id,
        name: 'Half place',
        priority: 'B',
        targetDate: '2027-05-09',
        distanceM: 10_000,
        raceLat: 40.12,
      },
    })
    const res = await client(ctx, user).put(`/api/goals/${legacy.id}`).send({ notes: 'Fine.' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ raceLat: 40.12, raceLng: null, notes: 'Fine.' })
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
