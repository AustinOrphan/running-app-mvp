import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { rulesChangedSummary } from '../../shared/copy/revision.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { PARAMS_VERSION } from '../../shared/engine/params/index.ts'
import type { Deps } from '../../server/app.ts'
import { replanActivePlan } from '../../server/services/planEngine.ts'
import type { PlanWithSessions, UndoResult } from '../../shared/types.ts'
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
const OLD = '2026-01-01.1'
const rows = (planId: string) =>
  ctx.prisma.planRevision.findMany({
    where: { planId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
/** The plan, and the revisions it already has, as drawn under another version of the rules. */
const ageRules = async (planId: string, paramsVersion: string | null) => {
  await ctx.prisma.plan.update({ where: { id: planId }, data: { paramsVersion } })
  await ctx.prisma.planRevision.updateMany({ where: { planId }, data: { paramsVersion } })
}

describe('the rules a revision was drawn under', () => {
  test('only a revision that redrew the plan records the version; none says it changed when equal', async () => {
    const f = await fourWeekPlan('rv1-paths@example.com')
    const easy = f.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
    const api = client(ctx, f.u)
    // owner edit (no redraw), its undo (recomputes the plan), a request re-plan, a method change
    // and the weekly re-plan (all redraw)
    expect((await api.put(`/api/plan/sessions/${easy.id}`).send({ skip: true })).status).toBe(200)
    const [edit] = await ctx.prisma.planRevision.findMany({
      where: { planId: f.plan.id, reason: 'owner' },
    })
    const undone = await api.post(`/api/plan/revisions/${edit!.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect((undone.body as UndoResult).revision.reason).toBe('undo')
    expect((await api.post('/api/plan/replan').send({})).status).toBe(200)
    expect((await api.put('/api/plan/method').send({ method: 'three-run-days' })).status).toBe(200)
    await replanActivePlan(deps(), { userId: f.u.id, reason: 'weekly', today: thisMonday })

    const all = await rows(f.plan.id)
    expect(all.length).toBeGreaterThanOrEqual(5)
    for (const row of all) {
      expect(row.paramsVersion, row.reason).toBe(row.id === edit!.id ? null : PARAMS_VERSION)
      expect(row.summary, row.reason).not.toContain(LINE)
    }
    // A new plan's first draw compares against nothing.
    expect(all[0]).toMatchObject({ reason: 'generate', paramsVersion: PARAMS_VERSION })
  })

  test('a skip after a bump has no line and no version; the next re-plan has the line once', async () => {
    const f = await fourWeekPlan('rv1-changed@example.com')
    await ageRules(f.plan.id, OLD)
    const easy = f.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
    const api = client(ctx, f.u)
    expect((await api.put(`/api/plan/sessions/${easy.id}`).send({ skip: true })).status).toBe(200)
    const skip = (await rows(f.plan.id)).at(-1)!
    expect(skip).toMatchObject({ reason: 'owner', paramsVersion: null })
    expect(skip.summary).not.toContain(LINE)

    expect((await api.post('/api/plan/replan').send({})).status).toBe(200)
    const redraw = (await rows(f.plan.id)).at(-1)!
    expect(redraw.paramsVersion).toBe(PARAMS_VERSION)
    expect(redraw.summary.endsWith(LINE)).toBe(true)
    expect(LINE).toBe(`Drawn under updated plan rules (${PARAMS_VERSION}).`)

    // The plan now holds the new version, so the next redraw says nothing.
    expect((await api.post('/api/plan/replan').send({})).status).toBe(200)
    expect((await rows(f.plan.id)).at(-1)!.summary).not.toContain(LINE)
  })

  test('an undo of a revision that carried the line does not repeat it', async () => {
    const f = await fourWeekPlan('rv1-undo@example.com')
    await ageRules(f.plan.id, OLD)
    const api = client(ctx, f.u)
    await api.put('/api/plan/method').send({ method: 'three-run-days' }).expect(200)
    const changed = (await rows(f.plan.id)).at(-1)!
    expect(changed.summary).toContain(LINE)
    await ctx.prisma.plan.update({ where: { id: f.plan.id }, data: { paramsVersion: OLD } })
    const undone = await api.post(`/api/plan/revisions/${changed.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    const summary = (undone.body as UndoResult).revision.summary
    expect(summary.split(LINE)).toHaveLength(2)
  })

  test('a plan with no recorded version says nothing on its next redraw', async () => {
    const f = await fourWeekPlan('rv1-unknown@example.com')
    await ctx.prisma.plan.update({ where: { id: f.plan.id }, data: { paramsVersion: null } })
    await client(ctx, f.u).post('/api/plan/replan').send({}).expect(200)
    const last = (await rows(f.plan.id)).at(-1)!
    expect(last.paramsVersion).toBe(PARAMS_VERSION)
    expect(last.summary).not.toContain(LINE)
  })
})
