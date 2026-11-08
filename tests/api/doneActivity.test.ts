import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Activity, PlanWithSessions } from '../../shared/types.ts'
import { planFixture, type Fixture } from './adjustFixture.ts'
import { client, createTestCtx, seedUser, type TestCtx } from './helpers.ts'

// The idempotent Done and the PUT rating the outbox queues (ADR 0012, queued writes): the client
// chooses the activity's id, so a replay is the same write.

let ctx: TestCtx
let fx: Fixture

beforeAll(async () => {
  ctx = await createTestCtx()
  fx = await planFixture(ctx, 'done-offline@example.com')
})

afterAll(async () => {
  await ctx.close()
})

const RUN_KINDS = new Set(['easy', 'long', 'recovery', 'steady'])

function aRun(plan: PlanWithSessions) {
  const found = plan.sessions.find((s) => RUN_KINDS.has(s.kind) && s.activityId === null)
  if (!found) throw new Error('The fixture plan has no open run session.')
  return found
}

const body = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  type: 'run',
  durationSec: 1800,
  distanceM: 5000,
  rpe: 4,
  feel: 0,
  pain: 2,
  ...over,
})

describe('PUT /api/activities/done/:activityId', () => {
  test('a replay of the same id is one write', async () => {
    const session = aRun(fx.plan)
    const id = randomUUID()
    const send = () =>
      client(ctx, fx.u)
        .put(`/api/activities/done/${id}`)
        .send(body(session.date, { sessionId: session.id }))
    const first = await send()
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    const second = await send()
    expect(second.status).toBe(200)
    expect((second.body as Activity).id).toBe(id)
    expect(await ctx.prisma.activity.count({ where: { id } })).toBe(1)
    expect(
      await ctx.prisma.activity.count({ where: { userId: fx.u.id, date: session.date } }),
    ).toBe(1)
    const stored = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
    expect([stored.rpe, stored.feel, stored.pain]).toEqual([4, 0, 2])
    const linked = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(linked.activityId).toBe(id)
  })

  test('two sends at once store one activity', async () => {
    const session = aRun(fx.plan)
    const other = fx.plan.sessions.find((s) => RUN_KINDS.has(s.kind) && s.id !== session.id)
    const id = randomUUID()
    const date = other?.date ?? session.date
    const results = await Promise.all(
      [1, 2].map(() => client(ctx, fx.u).put(`/api/activities/done/${id}`).send(body(date))),
    )
    expect(results.map((r) => r.status).sort()).toEqual([200, 201])
    expect(await ctx.prisma.activity.count({ where: { id } })).toBe(1)
  })

  test('a repeat does not undo a later edit', async () => {
    const id = randomUUID()
    const date = aRun(fx.plan).date
    await client(ctx, fx.u)
      .put(`/api/activities/done/${id}`)
      .send(body(date, { rpe: 3 }))
    await client(ctx, fx.u).put(`/api/activities/${id}/feedback`).send({ rpe: 7 })
    await client(ctx, fx.u)
      .put(`/api/activities/done/${id}`)
      .send(body(date, { rpe: 3 }))
    const stored = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
    expect(stored.rpe).toBe(7)
  })

  test('a second device marking the same session done gets a conflict and no activity', async () => {
    // Read from the database: the tests above have linked sessions the fixture still shows open.
    const session = await ctx.prisma.planSession.findFirst({
      where: { planId: fx.plan.id, kind: { in: [...RUN_KINDS] }, activityId: null },
      orderBy: { date: 'desc' },
    })
    if (!session) throw new Error('The fixture plan has no open run session.')
    const phone = randomUUID()
    const laptop = randomUUID()
    const first = await client(ctx, fx.u)
      .put(`/api/activities/done/${phone}`)
      .send(body(session.date, { sessionId: session.id }))
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    const second = await client(ctx, fx.u)
      .put(`/api/activities/done/${laptop}`)
      .send(body(session.date, { sessionId: session.id }))
    expect(second.status).toBe(409)
    expect((second.body as { error: { message: string } }).error.message).toMatch(
      /already has a run logged/,
    )
    expect(await ctx.prisma.activity.count({ where: { id: laptop } })).toBe(0)
  })

  test('a session the plan no longer holds does not lose the run', async () => {
    const id = randomUUID()
    const res = await client(ctx, fx.u)
      .put(`/api/activities/done/${id}`)
      .send(body(aRun(fx.plan).date, { sessionId: 'gone-session' }))
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(await ctx.prisma.activity.count({ where: { id } })).toBe(1)
  })

  test("another runner's id is unknown, and a malformed id is refused", async () => {
    const id = randomUUID()
    const date = aRun(fx.plan).date
    await client(ctx, fx.u).put(`/api/activities/done/${id}`).send(body(date))
    const stranger = await seedUser(ctx, { email: 'stranger-done@example.com' })
    const taken = await client(ctx, stranger).put(`/api/activities/done/${id}`).send(body(date))
    expect(taken.status).toBe(404)
    const bad = await client(ctx, fx.u).put('/api/activities/done/x').send(body(date))
    expect(bad.status).toBe(400)
  })

  test('answers 401 before any body is read when signed out', async () => {
    const res = await client(ctx).put(`/api/activities/done/${randomUUID()}`).send({})
    expect(res.status).toBe(401)
  })
})

describe('PUT /api/activities/:id/feedback', () => {
  test('stores the named keys, leaves the others, and a repeat changes nothing', async () => {
    const id = randomUUID()
    await client(ctx, fx.u)
      .put(`/api/activities/done/${id}`)
      .send(body(aRun(fx.plan).date, { rpe: null, feel: null, pain: 1 }))
    const send = () =>
      client(ctx, fx.u).put(`/api/activities/${id}/feedback`).send({ rpe: 5, feel: 1 })
    expect((await send()).status).toBe(200)
    expect((await send()).status).toBe(200)
    const stored = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
    expect([stored.rpe, stored.feel, stored.pain]).toEqual([5, 1, 1])
  })

  test("404 for another runner's activity", async () => {
    const id = randomUUID()
    await client(ctx, fx.u)
      .put(`/api/activities/done/${id}`)
      .send(body(aRun(fx.plan).date))
    const stranger = await seedUser(ctx, { email: 'stranger-rate@example.com' })
    const res = await client(ctx, stranger).put(`/api/activities/${id}/feedback`).send({ rpe: 2 })
    expect(res.status).toBe(404)
  })
})
