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
