import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type {
  PlanRevisionView,
  PlanWithSessions,
  RaiseResult,
  ReviewView,
  UndoResult,
} from '../../shared/types.ts'
import { replanActivePlan } from '../../server/services/planEngine.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// The offer to raise the plan to match recent weeks (rule E7, owner decision 2026-11-09): the weekly
// review carries it on the last finished week when the recent weeks were run above the plan; Not now
// is remembered by the server; Raise is one re-plan and one revision with a diff and an undo, and
// nothing raises a plan on its own. A marathon plan made four Mondays ago, each week run 60% over.
// Only Date is faked.
vi.useFakeTimers({ toFake: ['Date'] })
const START = new Date(2026, 9, 12, 12)
const NOW = new Date(2026, 10, 9, 12)
vi.setSystemTime(NOW)

const startMonday = mondayOf(todayIso(START))
const now = todayIso(NOW)
const thisMonday = mondayOf(now)
const lastWeek = addDays(thisMonday, -7)

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterEach(() => {
  vi.setSystemTime(NOW)
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  await ctx.close()
})

interface Fixture {
  u: TestUser
  planId: string
}

/** The days of a week the minutes are shared over, as shares of the week. */
const SHARES = [
  { dow: 0, share: 0.2 },
  { dow: 2, share: 0.25 },
  { dow: 4, share: 0.2 },
  { dow: 5, share: 0.35 },
]

/**
 * A user with twelve steady weeks (190 min) before `startMonday`, a marathon 20 weeks on and the
 * plan the engine builds on `startMonday`; the four weeks after it are then run at `factor` times
 * their planned minutes. The clock stands on `now`, four Mondays on.
 */
async function ranAbove(email: string, factor: number): Promise<Fixture> {
  vi.setSystemTime(START)
  const u = await seedUser(ctx, { email })
  const week = [
    { dow: 1, min: 40 },
    { dow: 3, min: 45 },
    { dow: 5, min: 35 },
    { dow: 6, min: 70 },
  ]
  const rows = []
  for (let w = 1; w <= 12; w += 1) {
    for (const run of week) {
      rows.push({
        userId: u.id,
        date: addDays(startMonday, -7 * w + run.dow),
        type: 'run',
        durationSec: run.min * 60,
        movingSec: run.min * 60,
        distanceM: run.min * 160,
        rpe: 3,
        source: 'manual',
      })
    }
  }
  await ctx.prisma.activity.createMany({ data: rows })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic marathon',
      priority: 'A',
      targetDate: addDays(startMonday, 7 * 20 + 6),
      distanceM: 42_195,
      goalType: 'finish',
    },
  })
  const made = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
  expect(made.status, JSON.stringify(made.body)).toBe(201)
  const plan = made.body as PlanWithSessions
  // Each Monday the weekly job re-plans, and the week just ended has been run at `factor` times
  // the minutes the plan held for it. The last re-plan is the one of `now`.
  const deps = { prisma: ctx.prisma, config: ctx.config, fetch: ctx.fetch }
  for (let w = 0; w < 4; w += 1) {
    const weekStart = addDays(startMonday, 7 * w)
    const stored = await ctx.prisma.planWeek.findFirstOrThrow({
      where: { planId: plan.id, weekStart },
    })
    const planned = stored.targetRunMin
    await ctx.prisma.activity.createMany({
      data: SHARES.map(({ dow, share }) => {
        const min = Math.round(planned * factor * share)
        return {
          userId: u.id,
          date: addDays(weekStart, dow),
          type: 'run',
          durationSec: min * 60,
          movingSec: min * 60,
          distanceM: min * 160,
          rpe: 3,
          source: 'manual',
        }
      }),
    })
    vi.setSystemTime(new Date(START.getTime() + 7 * 24 * 3600 * 1000 * (w + 1)))
    await replanActivePlan(deps, { userId: u.id, reason: 'weekly', today: todayIso() })
  }
  vi.setSystemTime(NOW)
  return { u, planId: plan.id }
}

const offerOf = async (f: Fixture): Promise<ReviewView | undefined> => {
  const res = await client(ctx, f.u).get(`/api/reviews?from=${lastWeek}&to=${lastWeek}`)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return (res.body as ReviewView[])[0]
}
const weekRows = (f: Fixture) =>
  ctx.prisma.planWeek.findMany({ where: { planId: f.planId }, orderBy: { weekStart: 'asc' } })
const revisions = (f: Fixture) => ctx.prisma.planRevision.count({ where: { planId: f.planId } })

describe('the offer on the weekly review', () => {
  test('appears on the last finished week with both figures when the recent weeks ran above plan', async () => {
    const f = await ranAbove('raise-offer@example.com', 1.6)
    const review = await offerOf(f)
    expect(review?.raise).toBeDefined()
    const offer = review!.raise!
    expect(offer.weekStart).toBe(lastWeek)
    expect(offer.fromWeek >= thisMonday).toBe(true)
    expect(offer.raisedMin).toBeGreaterThan(offer.currentMin)
    // the current figure is the one the plan holds for that week
    const row = (await weekRows(f)).find((w) => w.weekStart === offer.fromWeek)!
    expect(row.targetRunMin).toBe(offer.currentMin)
  })

  test('is on no other week of the list, and writes nothing by being read', async () => {
    const f = await ranAbove('raise-read@example.com', 1.6)
    const before = { weeks: await weekRows(f), revisions: await revisions(f) }
    const res = await client(ctx, f.u).get(
      `/api/reviews?from=${addDays(lastWeek, -14)}&to=${thisMonday}`,
    )
    const rows = res.body as ReviewView[]
    expect(rows.filter((r) => r.raise !== undefined).map((r) => r.weekStart)).toEqual([lastWeek])
    expect(await weekRows(f)).toEqual(before.weeks)
    expect(await revisions(f)).toBe(before.revisions)
  })

  test('is absent when the weeks were run as planned', async () => {
    const f = await ranAbove('raise-asplanned@example.com', 1)
    expect((await offerOf(f))?.raise).toBeUndefined()
  })

  test('is absent when pain was reported in those weeks', async () => {
    const f = await ranAbove('raise-pain@example.com', 1.6)
    expect((await offerOf(f))?.raise).toBeDefined()
    const day = addDays(startMonday, 9)
    const res = await client(ctx, f.u).put(`/api/checkins/${day}`).send({ painScore: 2 })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    expect((await offerOf(f))?.raise).toBeUndefined()
  })
})

describe('Not now', () => {
  test('is remembered for the finished week and changes nothing in the plan', async () => {
    const f = await ranAbove('raise-decline@example.com', 1.6)
    expect((await offerOf(f))?.raise).toBeDefined()
    const before = { weeks: await weekRows(f), revisions: await revisions(f) }

    const res = await client(ctx, f.u)
      .put(`/api/reviews/${lastWeek}/raise`)
      .send({ answer: 'declined' })
    expect(res.status, JSON.stringify(res.body)).toBe(204)
    expect((await offerOf(f))?.raise).toBeUndefined()
    // the same answer again is accepted and still changes nothing
    const again = await client(ctx, f.u)
      .put(`/api/reviews/${lastWeek}/raise`)
      .send({ answer: 'declined' })
    expect(again.status).toBe(204)
    expect(await weekRows(f)).toEqual(before.weeks)
    expect(await revisions(f)).toBe(before.revisions)
    // the answer is stored with the user, so another device finds the same
    const row = await ctx.prisma.weeklyReview.findFirstOrThrow({
      where: { userId: f.u.id, weekStart: lastWeek },
    })
    expect(row.raiseAnswer).toBe('declined')
  })

  test('takes only a decline, and only for the last finished week', async () => {
    const f = await ranAbove('raise-decline-bad@example.com', 1.6)
    const put = (week: string, body: unknown) =>
      client(ctx, f.u)
        .put(`/api/reviews/${week}/raise`)
        .send(body as object)
    expect((await put(lastWeek, { answer: 'raised' })).status).toBe(400)
    expect((await put(lastWeek, {})).status).toBe(400)
    expect((await put(lastWeek, { answer: 'declined', extra: 1 })).status).toBe(400)
    expect((await put('2026-11-10', { answer: 'declined' })).status).toBe(400)
    expect((await put(addDays(lastWeek, -7), { answer: 'declined' })).status).toBe(400)
    expect((await offerOf(f))?.raise).toBeDefined()
  })
})

describe('POST /api/plan/raise', () => {
  test('writes one revision with a diff and an undo, and the Plan shows the raised weeks', async () => {
    const f = await ranAbove('raise-apply@example.com', 1.6)
    const offer = (await offerOf(f))!.raise!
    const before = await weekRows(f)
    const count = await revisions(f)

    const res = await client(ctx, f.u)
      .post('/api/plan/raise')
      .send({ weekStart: offer.weekStart, raisedMin: offer.raisedMin })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { revision } = res.body as RaiseResult
    expect(revision.reason).toBe('raise-to-match')
    expect(revision.auto).toBe(false)
    expect(revision.summary).toMatch(/^Raised to match recent weeks: /)
    assertCleanCopy(revision.summary, 'revision summary')
    expect(revision.undo.available).toBe(true)
    expect(await revisions(f)).toBe(count + 1)

    const after = await weekRows(f)
    expect(after.find((w) => w.weekStart === offer.fromWeek)!.targetRunMin).toBe(offer.raisedMin)
    // the weeks before the current one are untouched
    for (const week of after) {
      const was = before.find((w) => w.weekStart === week.weekStart)
      if (was === undefined) continue
      if (week.weekStart < thisMonday) expect(week.targetRunMin).toBe(was.targetRunMin)
    }
    const stored = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: revision.id } })
    expect((JSON.parse(stored.diff!) as { weeks: unknown[] }).weeks.length).toBeGreaterThan(0)

    // the offer is answered for the same weeks
    expect((await offerOf(f))?.raise).toBeUndefined()
    // the revision is in the Plan's list with its reason
    const list = await client(ctx, f.u).get('/api/plan/revisions')
    const items = list.body as PlanRevisionView[]
    expect(items.find((r) => r.id === revision.id)?.reason).toBe('raise-to-match')
  })

  test('undoes through the existing undo path', async () => {
    const f = await ranAbove('raise-undo@example.com', 1.6)
    const offer = (await offerOf(f))!.raise!
    const before = await weekRows(f)
    const res = await client(ctx, f.u)
      .post('/api/plan/raise')
      .send({ weekStart: offer.weekStart, raisedMin: offer.raisedMin })
    const { revision } = res.body as RaiseResult
    const undone = await client(ctx, f.u).post(`/api/plan/revisions/${revision.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect((undone.body as UndoResult).revision.reason).toBe('undo')
    const after = await weekRows(f)
    for (const week of before) {
      expect(after.find((w) => w.weekStart === week.weekStart)?.targetRunMin, week.weekStart).toBe(
        week.targetRunMin,
      )
    }
  })

  test('is refused with a 409 and writes nothing when the figure moved or the offer is gone', async () => {
    const f = await ranAbove('raise-stale@example.com', 1.6)
    const offer = (await offerOf(f))!.raise!
    const before = { weeks: await weekRows(f), revisions: await revisions(f) }
    const post = (body: object) => client(ctx, f.u).post('/api/plan/raise').send(body)

    expect(
      (await post({ weekStart: offer.weekStart, raisedMin: offer.raisedMin + 5 })).status,
    ).toBe(409)
    expect(
      (await post({ weekStart: addDays(lastWeek, -7), raisedMin: offer.raisedMin })).status,
    ).toBe(409)
    expect(await weekRows(f)).toEqual(before.weeks)
    expect(await revisions(f)).toBe(before.revisions)

    // after Not now, a yes from a stale screen is refused too
    await client(ctx, f.u).put(`/api/reviews/${lastWeek}/raise`).send({ answer: 'declined' })
    expect((await post({ weekStart: offer.weekStart, raisedMin: offer.raisedMin })).status).toBe(
      409,
    )
    expect(await revisions(f)).toBe(before.revisions)
  })

  test('is refused with a 409 when the recent weeks were run as planned', async () => {
    const f = await ranAbove('raise-notabove@example.com', 1)
    const count = await revisions(f)
    const res = await client(ctx, f.u)
      .post('/api/plan/raise')
      .send({ weekStart: lastWeek, raisedMin: 300 })
    expect(res.status).toBe(409)
    expect(await revisions(f)).toBe(count)
  })

  test('validates the body with Zod', async () => {
    const f = await ranAbove('raise-body@example.com', 1.6)
    const post = (body: unknown) =>
      client(ctx, f.u)
        .post('/api/plan/raise')
        .send(body as object)
    for (const body of [
      {},
      { weekStart: lastWeek },
      { raisedMin: 300 },
      { weekStart: '2026-11-10', raisedMin: 300 },
      { weekStart: lastWeek, raisedMin: 300.5 },
      { weekStart: lastWeek, raisedMin: 0 },
      { weekStart: lastWeek, raisedMin: '300' },
      { weekStart: lastWeek, raisedMin: 300, extra: true },
    ]) {
      const res = await post(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body).toMatchObject({ error: { code: 'validation' } })
    }
  })

  test('answers 401 before reading the body and 403 from another origin', async () => {
    const f = await ranAbove('raise-guard@example.com', 1.6)
    const count = await revisions(f)
    const anonymous = await client(ctx).post('/api/plan/raise').send({ not: 'checked' })
    expect(anonymous.status).toBe(401)
    const noOrigin = await request(ctx.app)
      .post('/api/plan/raise')
      .set('Cookie', f.u.cookie)
      .send({ weekStart: lastWeek, raisedMin: 300 })
    expect(noOrigin.status).toBe(403)
    const cross = await request(ctx.app)
      .post('/api/plan/raise')
      .set('Host', 'app.test')
      .set('Origin', 'http://evil.test')
      .set('Cookie', f.u.cookie)
      .send({ weekStart: lastWeek, raisedMin: 300 })
    expect(cross.status).toBe(403)
    const declineCross = await request(ctx.app)
      .put(`/api/reviews/${lastWeek}/raise`)
      .set('Host', 'app.test')
      .set('Origin', 'http://evil.test')
      .set('Cookie', f.u.cookie)
      .send({ answer: 'declined' })
    expect(declineCross.status).toBe(403)
    expect(await revisions(f)).toBe(count)
    expect((await offerOf(f))?.raise).toBeDefined()
  })
})

describe('nothing raises a plan on its own', () => {
  test('a weekly re-plan leaves the plan as the stored weeks carry it, and the offer stays open', async () => {
    const f = await ranAbove('raise-never-auto@example.com', 1.6)
    const deps = { prisma: ctx.prisma, config: ctx.config, fetch: ctx.fetch }
    const offer = (await offerOf(f))!.raise!
    await replanActivePlan(deps, { userId: f.u.id, reason: 'weekly', today: now })
    const row = (await weekRows(f)).find((w) => w.weekStart === offer.fromWeek)!
    // the weekly re-plan is not the runner's yes: the week is below what the raise would give
    expect(row.targetRunMin).toBeLessThan(offer.raisedMin)
    expect((await offerOf(f))?.raise).toBeDefined()
  })
})
