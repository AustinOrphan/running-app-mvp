import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { saveDoneActivity } from '../../server/services/activityStore.ts'
import { addDays, todayIso } from '../../shared/dates.ts'
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

  test('Done on a session clears what the runner unlinked from it', async () => {
    const session = await ctx.prisma.planSession.findFirstOrThrow({
      where: { planId: fx.plan.id, kind: { in: [...RUN_KINDS] }, activityId: null },
    })
    await ctx.prisma.planSession.update({
      where: { id: session.id },
      data: { refusedActivityIds: JSON.stringify(['unlinked-earlier']) },
    })
    const id = randomUUID()
    const res = await client(ctx, fx.u)
      .put(`/api/activities/done/${id}`)
      .send(body(session.date, { sessionId: session.id }))
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(
      await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).toMatchObject({ activityId: id, linkSource: 'owner', refusedActivityIds: null })
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

  test('two phones marking one session done at once store exactly one run', async () => {
    const session = await ctx.prisma.planSession.findFirst({
      where: { planId: fx.plan.id, kind: { in: [...RUN_KINDS] }, activityId: null },
      orderBy: { date: 'asc' },
    })
    if (!session) throw new Error('The fixture plan has no open run session.')
    const ids = [randomUUID(), randomUUID()]
    const results = await Promise.all(
      ids.map((id) =>
        client(ctx, fx.u)
          .put(`/api/activities/done/${id}`)
          .send(body(session.date, { sessionId: session.id })),
      ),
    )
    expect(results.map((r) => r.status).sort()).toEqual([201, 409])
    expect(await ctx.prisma.activity.count({ where: { id: { in: ids } } })).toBe(1)
    const linked = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(ids).toContain(linked.activityId)
  })

  test('the 409 for a logged session carries its own code, a kind that no longer fits does not', async () => {
    const open = await ctx.prisma.planSession.findFirst({
      where: { planId: fx.plan.id, kind: { in: [...RUN_KINDS] }, activityId: null },
      orderBy: { date: 'desc' },
    })
    if (!open) throw new Error('The fixture plan has no open run session.')
    await client(ctx, fx.u)
      .put(`/api/activities/done/${randomUUID()}`)
      .send(body(open.date, { sessionId: open.id }))
    const taken = await client(ctx, fx.u)
      .put(`/api/activities/done/${randomUUID()}`)
      .send(body(open.date, { sessionId: open.id }))
    expect(taken.status).toBe(409)
    expect((taken.body as { error: { details: { code: string } } }).error.details.code).toBe(
      'session-logged',
    )

    // A re-plan turned another session into strength: the run no longer fits it.
    const other = await ctx.prisma.planSession.findFirst({
      where: { planId: fx.plan.id, kind: { in: [...RUN_KINDS] }, activityId: null },
    })
    if (!other) throw new Error('The fixture plan has no second open run session.')
    await ctx.prisma.planSession.update({ where: { id: other.id }, data: { kind: 'strength' } })
    const wrongKind = await client(ctx, fx.u)
      .put(`/api/activities/done/${randomUUID()}`)
      .send(body(other.date, { sessionId: other.id }))
    expect(wrongKind.status).toBe(409)
    expect(
      (wrongKind.body as { error: { details?: { code?: string } } }).error.details?.code,
    ).toBeUndefined()
  })

  test('a session a re-plan removes between the check and the claim keeps the run unlinked', async () => {
    const session = await ctx.prisma.planSession.findFirst({
      where: { planId: fx.plan.id, kind: { in: [...RUN_KINDS] }, activityId: null },
      orderBy: { date: 'asc' },
    })
    if (!session) throw new Error('The fixture plan has no open run session.')
    const id = randomUUID()
    // The check finds the session; a re-plan then removes it before the create claims it.
    const original = ctx.prisma.planSession.findFirst.bind(ctx.prisma.planSession)
    const spy = vi.spyOn(ctx.prisma.planSession, 'findFirst').mockImplementation(((
      ...args: Parameters<typeof original>
    ) => {
      spy.mockRestore()
      return original(...args).then(async (found) => {
        await ctx.prisma.planSession.delete({ where: { id: session.id } })
        return found
      })
    }) as never)
    const saved = await saveDoneActivity(
      ctx,
      fx.u.id,
      id,
      {
        date: session.date,
        startTime: null,
        type: 'run',
        durationSec: 1800,
        distanceM: 5000,
        rpe: null,
        avgHr: null,
        maxHr: null,
        elevationGainM: null,
        notes: null,
      },
      session.id,
    )
    expect(saved.created).toBe(true)
    expect(await ctx.prisma.activity.count({ where: { id } })).toBe(1)
  })

  test('a replay assesses a linked run whose assessment never happened', async () => {
    const session = await ctx.prisma.planSession.findFirst({
      where: { planId: fx.plan.id, kind: { in: [...RUN_KINDS] }, activityId: null },
      orderBy: { date: 'asc' },
    })
    if (!session) throw new Error('The fixture plan has no open run session.')
    // Assessment reads runs up to today, so the session sits on yesterday.
    const day = addDays(todayIso(), -1)
    await ctx.prisma.planSession.update({ where: { id: session.id }, data: { date: day } })
    const id = randomUUID()
    const send = () =>
      client(ctx, fx.u)
        .put(`/api/activities/done/${id}`)
        .send(body(day, { sessionId: session.id }))
    expect((await send()).status).toBe(201)
    const assessed = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(assessed.execution).not.toBeNull()
    await ctx.prisma.planSession.update({ where: { id: session.id }, data: { execution: null } })
    expect((await send()).status).toBe(200)
    const again = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(again.execution).not.toBeNull()
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

  test('stores the heat mark (rule I8), replays to the same row, and keeps it when a rating omits it', async () => {
    const id = randomUUID()
    const made = await client(ctx, fx.u)
      .put(`/api/activities/done/${id}`)
      .send(body(aRun(fx.plan).date))
    expect((made.body as Activity).heatExposure).toBeNull()
    const send = (payload: Record<string, unknown>) =>
      client(ctx, fx.u).put(`/api/activities/${id}/feedback`).send(payload)
    const first = await send({ rpe: 3, heatExposure: 'passive' })
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect((first.body as Activity).heatExposure).toBe('passive')
    // a replay of the queued write is the same write
    expect((await send({ rpe: 3, heatExposure: 'passive' })).status).toBe(200)
    expect((await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })).heatExposure).toBe(
      'passive',
    )
    // a rating that does not name the mark leaves it
    await send({ feel: 1 })
    expect((await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })).heatExposure).toBe(
      'passive',
    )
    // the other kind replaces it, and null clears it
    expect(((await send({ heatExposure: 'warm-room' })).body as Activity).heatExposure).toBe(
      'warm-room',
    )
    expect(((await send({ heatExposure: null })).body as Activity).heatExposure).toBeNull()
    expect((await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })).heatExposure).toBeNull()
    // the activity read carries it too
    const read = await client(ctx, fx.u).get(`/api/activities/${id}`)
    expect((read.body as Activity).heatExposure).toBeNull()
  })

  test('refuses a mark that is not one of the two, and a key the route does not know', async () => {
    const id = randomUUID()
    await client(ctx, fx.u)
      .put(`/api/activities/done/${id}`)
      .send(body(aRun(fx.plan).date))
    const bad = await client(ctx, fx.u)
      .put(`/api/activities/${id}/feedback`)
      .send({ heatExposure: 'sauna' })
    expect(bad.status).toBe(400)
    const stray = await client(ctx, fx.u)
      .put(`/api/activities/${id}/feedback`)
      .send({ heat: 'passive' })
    expect(stray.status).toBe(400)
    expect((await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })).heatExposure).toBeNull()
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
