import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type {
  AdjustResult,
  PlanRevisionView,
  PlanSession,
  PlanWithSessions,
  TodayView,
} from '../../shared/types.ts'
import {
  adjustAt as adjustTo,
  errorOf,
  only,
  planFixture,
  postTo,
  type Fixture,
} from './adjustFixture.ts'
import { client, createTestCtx, expectNoRefusedFetches, type TestCtx } from './helpers.ts'

// What a shortened session means to the rest of the app, and the older PUT that now goes through
// the adjust action [phase 3a design 9.4, 9.5; task E5-6]. A Wednesday, so that the current week
// has sessions left; only Date is faked.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 21, 12))

const today = todayIso()
const nextMonday = addDays(mondayOf(today), 7)

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(() => {
  vi.setSystemTime(new Date(2026, 9, 21, 12))
  expectNoRefusedFetches(ctx)
})

const fixture = (email: string) => planFixture(ctx, email)
const adjustAt = (f: Fixture, id: string, body: object) => adjustTo(ctx, f, id, body)
const post = (f: Fixture, url: string, body: object = {}) => postTo(ctx, f, url, body)

describe('PUT /api/plan/sessions/:id, the older edit', () => {
  test('goes through the same guards and answers the session as before', async () => {
    const f = await fixture('adjust-put@example.com')
    const easy = only(f, 'easy', 1)
    const threshold = only(f, 'threshold')

    // the refusal is the adjust action's first guard
    const dry = (
      await adjustAt(f, easy.id, {
        adjustment: { type: 'move', date: threshold.date },
        dryRun: true,
      })
    ).body as AdjustResult
    const refused = await client(ctx, f.u)
      .put(`/api/plan/sessions/${easy.id}`)
      .send({ date: threshold.date })
    expect(refused.status).toBe(409)
    expect(errorOf(refused).message).toBe(dry.guards[0]!.message)

    // a shortened session is movable, as a moved one is
    expect(
      (await adjustAt(f, easy.id, { adjustment: { type: 'shorten', durationMin: 22 } })).status,
    ).toBe(200)
    const free = addDays(nextMonday, 3)
    const moved = await client(ctx, f.u).put(`/api/plan/sessions/${easy.id}`).send({ date: free })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    expect(moved.body).toMatchObject({ id: easy.id, date: free, status: 'moved', durationMin: 22 })
    const revisions = (await client(ctx, f.u).get('/api/plan/revisions').send())
      .body as PlanRevisionView[]
    expect(revisions[0]).toMatchObject({ reason: 'owner' })
    expect(revisions[0]!.summary).toMatch(/^Moved /)

    // skip and restore answer the session
    const skipped = await client(ctx, f.u).put(`/api/plan/sessions/${easy.id}`).send({ skip: true })
    expect(skipped.body).toMatchObject({ id: easy.id, status: 'skipped' })
    const restored = await client(ctx, f.u)
      .put(`/api/plan/sessions/${easy.id}`)
      .send({ skip: false })
    // restored to the status that keeps the move
    expect(restored.body).toMatchObject({ id: easy.id, status: 'moved', date: free })
    // a kind swap through the older edit
    const swapped = await client(ctx, f.u)
      .put(`/api/plan/sessions/${only(f, 'easy', 0).id}`)
      .send({ kind: 'long' })
    expect(swapped.status, JSON.stringify(swapped.body)).toBe(200)
    expect(swapped.body).toMatchObject({ kind: 'long', status: 'moved' })
  })
})

describe('a shortened session', () => {
  test('survives a re-plan, adds no minutes elsewhere and is read as still to run', async () => {
    const f = await fixture('adjust-adjusted@example.com')
    // The first session after today: Today's next session, and a run that can be downloaded.
    const upcoming = f.plan.sessions.filter((s) => s.date > today && s.kind !== 'rest')
    const first = upcoming[0]!
    expect(['easy', 'recovery', 'long', 'threshold', 'intervals', 'hills']).toContain(first.kind)
    // And a session next week, for the re-plan: its week must not be filled up again.
    const target = only(f, 'easy', 1)
    const weekMinutes = (sessions: PlanSession[]) =>
      sessions
        .filter(
          (s) =>
            s.weekStart === target.weekStart &&
            s.status !== 'skipped' &&
            !['strength', 'mobility', 'rest', 'race', 'hike'].includes(s.kind),
        )
        .reduce((n, s) => n + s.durationMin, 0)
    const total = weekMinutes(f.plan.sessions)
    const cut = 8
    expect(
      (
        await adjustAt(f, target.id, {
          adjustment: { type: 'shorten', durationMin: target.durationMin - cut },
        })
      ).status,
    ).toBe(200)
    const firstMin = Math.max(first.durationMin - 10, 20)
    if (first.id !== target.id && first.durationMin > 20) {
      expect(
        (await adjustAt(f, first.id, { adjustment: { type: 'shorten', durationMin: firstMin } }))
          .status,
      ).toBe(200)
    }

    const replan = await post(f, '/api/plan/replan')
    expect(replan.status, JSON.stringify(replan.body)).toBe(200)

    const plan = (await client(ctx, f.u).get('/api/plan').send()).body as PlanWithSessions
    const kept = plan.sessions.find((s) => s.id === target.id)!
    expect(kept).toMatchObject({
      status: 'adjusted',
      durationMin: target.durationMin - cut,
      externalId: target.externalId,
    })
    // the minutes that were cut are not made up elsewhere in the week
    expect(weekMinutes(plan.sessions)).toBeLessThanOrEqual(total - cut)

    // the readers of a status: the workout file, and Today's next session
    const file = await client(ctx, f.u).get(`/api/plan/sessions/${target.id}/workout.fit`).send()
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toContain('application/octet-stream')
    const day = (await client(ctx, f.u).get('/api/today').send()).body as TodayView
    if (first.id !== target.id) {
      expect(day.coach.next?.id).toBe(first.id)
      expect(day.coach.next?.status).toBe('adjusted')
    }

    // a session that is skipped is settled, and is neither
    expect((await adjustAt(f, target.id, { adjustment: { type: 'skip' } })).status).toBe(200)
    const settled = await client(ctx, f.u).get(`/api/plan/sessions/${target.id}/workout.fit`).send()
    expect(settled.status).toBe(409)
  })
})
