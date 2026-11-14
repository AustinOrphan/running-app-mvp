import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { rulesChangedSummary } from '../../shared/copy/revision.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { PARAMS_VERSION } from '../../shared/engine/params/index.ts'
import type { Deps } from '../../server/app.ts'
import { replanActivePlan } from '../../server/services/planEngine.ts'
import type { PlanRevisionView, PlanWithSessions, UndoResult } from '../../shared/types.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// RV1: every revision records the PARAMS_VERSION it was drawn under, and a summary says so when
// that version differs from the previous revision of the plan that recorded one. Only Date is faked.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 19, 12))

const today = todayIso()
const thisMonday = mondayOf(today)
const nextMonday = addDays(thisMonday, 7)

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  await ctx.close()
})

const deps = (): Deps => ({ prisma: ctx.prisma, config: ctx.config, fetch: ctx.fetch })

interface Fixture {
  u: TestUser
  plan: PlanWithSessions
}

/** A user with twelve weeks of runs, a four-week goal and the plan the engine builds for it today. */
async function fourWeekPlan(email: string): Promise<Fixture> {
  const u = await seedUser(ctx, { email })
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
        userId: u.id,
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
  await ctx.prisma.activity.create({
    data: {
      userId: u.id,
      date: addDays(today, -30),
      type: 'race',
      durationSec: 3300,
      movingSec: 3300,
      distanceM: 10_000,
      rpe: 9,
      source: 'manual',
    },
  })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 3 + 5),
      distanceM: 21_097,
      goalType: 'finish',
    },
  })
  const res = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return { u, plan: res.body as PlanWithSessions }
}

const LINE = rulesChangedSummary(PARAMS_VERSION)
const rows = (planId: string) =>
  ctx.prisma.planRevision.findMany({
    where: { planId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
/** Marks every stored revision of the plan as drawn under another version of the rules. */
const ageRevisions = (planId: string, paramsVersion: string | null) =>
  ctx.prisma.planRevision.updateMany({ where: { planId }, data: { paramsVersion } })

describe('the rules a revision was drawn under', () => {
  test('every path that records a revision writes the current version and no line when equal', async () => {
    const f = await fourWeekPlan('rv1-paths@example.com')
    const easy = f.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
    const api = client(ctx, f.u)
    // owner edit, then its undo
    expect((await api.put(`/api/plan/sessions/${easy.id}`).send({ skip: true })).status).toBe(200)
    const [edit] = await ctx.prisma.planRevision.findMany({
      where: { planId: f.plan.id, reason: 'owner' },
    })
    const undone = await api.post(`/api/plan/revisions/${edit!.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect((undone.body as UndoResult).revision.reason).toBe('undo')
    // a request re-plan, a method change and the weekly re-plan
    expect((await api.post('/api/plan/replan').send({})).status).toBe(200)
    expect((await api.put('/api/plan/method').send({ method: 'three-run-days' })).status).toBe(200)
    await replanActivePlan(deps(), { userId: f.u.id, reason: 'weekly', today: thisMonday })

    const all = await rows(f.plan.id)
    expect(new Set(all.map((r) => r.reason))).toEqual(
      new Set(
        ['generate', 'owner', 'undo', 'method-change', 'weekly', 'review'].filter((r) =>
          all.some((a) => a.reason === r),
        ),
      ),
    )
    expect(all.length).toBeGreaterThanOrEqual(5)
    for (const row of all) {
      expect(row.paramsVersion, row.reason).toBe(PARAMS_VERSION)
      expect(row.summary, row.reason).not.toContain(LINE)
    }
  })

  test('a changed version adds the line once, to the revision drawn under the new rules', async () => {
    const f = await fourWeekPlan('rv1-changed@example.com')
    await ageRevisions(f.plan.id, '2026-01-01.1')
    const easy = f.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
    const api = client(ctx, f.u)
    const first = await api.put(`/api/plan/sessions/${easy.id}`).send({ skip: true })
    expect(first.status).toBe(200)
    const other = f.plan.sessions.find(
      (s) => s.date >= today && s.kind === 'easy' && s.id !== easy.id,
    )!
    const second = await api.put(`/api/plan/sessions/${other.id}`).send({ skip: true })
    expect(second.status).toBe(200)
    const [, ...owner] = await rows(f.plan.id)
    expect(owner).toHaveLength(2)
    expect(owner[0]!.paramsVersion).toBe(PARAMS_VERSION)
    expect(owner[0]!.summary.endsWith(LINE)).toBe(true)
    expect(owner[1]!.summary).not.toContain(LINE)
    expect(LINE).toBe(`Drawn under updated plan rules (${PARAMS_VERSION}).`)
  })

  test('a revision with no recorded version before it says nothing', async () => {
    const f = await fourWeekPlan('rv1-unknown@example.com')
    await ageRevisions(f.plan.id, null)
    const easy = f.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
    await client(ctx, f.u).put(`/api/plan/sessions/${easy.id}`).send({ skip: true })
    const all = await rows(f.plan.id)
    const last = all[all.length - 1]!
    expect(last.paramsVersion).toBe(PARAMS_VERSION)
    expect(last.summary).not.toContain(LINE)
    expect(all.slice(0, -1).every((r) => r.paramsVersion === null)).toBe(true)
    const served = (await client(ctx, f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(served.length).toBe(all.length)
  })
})
