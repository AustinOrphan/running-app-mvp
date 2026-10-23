import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { CAUSE_ORDER } from '../../shared/engine/revisionDiff.ts'
import type { Deps } from '../../server/app.ts'
import { replanActivePlan } from '../../server/services/planEngine.ts'
import type {
  PlanPreview,
  PlanRevisionView,
  PlanWithSessions,
  SavedReview,
  UndoResult,
} from '../../shared/types.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// What the revision routes serve for presentation (design 4.2 and 8.6): the cause of every line of a
// diff, the seen marker and the revision a saved review returns. A Monday, as the weekly job's re-plan
// is. Only Date is faked.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 19, 12))

const today = todayIso()
const thisMonday = mondayOf(today)
const nextMonday = addDays(thisMonday, 7)
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

const deps = (): Deps => ({ prisma: ctx.prisma, config: ctx.config })

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

/** Closes the weekday of the first easy run of next week, so the next re-plan has to move runs. */
async function closeBusyDay(f: Fixture): Promise<void> {
  const easy = f.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
  const weekday = WEEKDAYS[(new Date(`${easy.date}T00:00:00Z`).getUTCDay() + 6) % 7]!
  const availability = JSON.stringify({ [weekday]: { available: false, maxMin: null } })
  await ctx.prisma.athleteProfile.upsert({
    where: { userId: f.u.id },
    create: { userId: f.u.id, availability },
    update: { availability },
  })
}

const list = async (f: Fixture): Promise<PlanRevisionView[]> =>
  (await client(ctx, f.u).get('/api/plan/revisions')).body as PlanRevisionView[]

const weekly = (f: Fixture): Promise<PlanRevisionView> =>
  replanActivePlan(deps(), { userId: f.u.id, reason: 'weekly', today: thisMonday })

describe('causes on the served revisions', () => {
  test('every line of a diff has a cause, keyed by externalId and Monday', async () => {
    const f = await fourWeekPlan('presentation-causes@example.com')
    await closeBusyDay(f)
    const made = (await client(ctx, f.u).post('/api/plan/replan').send({})).body as PlanRevisionView
    expect(made.diff?.empty).toBe(false)
    expect(made.causes).not.toBeNull()

    const served = (await list(f)).find((v) => v.id === made.id)!
    expect(served.causes).toEqual(made.causes)
    const { sessions, weeks } = served.causes!
    expect(Object.keys(sessions).sort()).toEqual(
      served.diff!.sessions.map((line) => line.externalId).sort(),
    )
    expect(Object.keys(weeks).sort()).toEqual(
      served.diff!.weeks.map((line) => line.weekStart).sort(),
    )
    for (const causes of [...Object.values(sessions), ...Object.values(weeks)]) {
      expect(causes.length).toBeGreaterThan(0)
      for (const cause of causes) expect(CAUSE_ORDER).toContain(cause)
    }
  })

  test("an edit of one session and its undo are the runner's own change", async () => {
    const f = await fourWeekPlan('presentation-edit@example.com')
    const easy = f.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
    await client(ctx, f.u).put(`/api/plan/sessions/${easy.id}`).send({ skip: true })
    const [edit] = await list(f)
    expect(edit).toMatchObject({ reason: 'owner' })
    expect(edit!.causes).toEqual({ sessions: { [easy.externalId]: ['owner-edit'] }, weeks: {} })

    const undone = await client(ctx, f.u).post(`/api/plan/revisions/${edit!.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    const { revision } = undone.body as UndoResult
    expect(revision.causes).toEqual({ sessions: { [easy.externalId]: ['owner-edit'] }, weeks: {} })
  })

  test('a revision with no diff has no causes', async () => {
    const f = await fourWeekPlan('presentation-no-diff@example.com')
    const [generated] = await list(f)
    expect(generated).toMatchObject({ reason: 'generate', diff: null, causes: null })
  })

  test('names the weekly decision for the week it caps, from the week the revision was written in', async () => {
    const f = await fourWeekPlan('presentation-decision@example.com')
    await closeBusyDay(f)
    const made = await weekly(f)
    expect(made.diff?.empty).toBe(false)
    const hold = JSON.stringify({ decision: 'hold', signals: [], nextWeekTargetMin: 100 })
    // Written on a day of next week, so next week is the week the decision caps.
    await ctx.prisma.planRevision.update({
      where: { id: made.id },
      data: { decision: hold, createdAt: new Date(`${addDays(nextMonday, 1)}T12:00:00`) },
    })
    const served = (await list(f)).find((v) => v.id === made.id)!
    const inWeek = served.diff!.sessions.filter((line) => line.weekStart === nextMonday)
    expect(inWeek.length).toBeGreaterThan(0)
    for (const line of inWeek) {
      expect(served.causes!.sessions[line.externalId], line.externalId).toContain('decision-hold')
    }
    for (const line of served.diff!.sessions.filter((l) => l.weekStart !== nextMonday)) {
      expect(served.causes!.sessions[line.externalId], line.externalId).not.toContain(
        'decision-hold',
      )
    }
  })

  test('names the own target of the runner for a week the re-plan kept at their number', async () => {
    const f = await fourWeekPlan('presentation-owner@example.com')
    await closeBusyDay(f)
    const set = await client(ctx, f.u)
      .put(`/api/plan/weeks/${nextMonday}`)
      .send({ targetRunMin: 150, overrideNote: 'A work trip.' })
    expect(set.status, JSON.stringify(set.body)).toBe(200)
    const made = await weekly(f)
    const served = (await list(f)).find((v) => v.id === made.id)!
    const lines = served.diff!.sessions.filter((line) => line.weekStart === nextMonday)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(served.causes!.sessions[line.externalId], line.externalId).toContain(
        'owner-target-kept',
      )
    }
  })
})

describe('the seen marker', () => {
  test('a revision the runner asked for is seen when it is written, and one the scheduler wrote waits', async () => {
    const f = await fourWeekPlan('presentation-seen-born@example.com')
    await closeBusyDay(f)
    const requested = (await client(ctx, f.u).post('/api/plan/replan').send({}))
      .body as PlanRevisionView
    expect(requested).toMatchObject({ auto: false })
    expect(requested.seenAt).toEqual(expect.any(String))

    const skip = f.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
    await client(ctx, f.u).put(`/api/plan/sessions/${skip.id}`).send({ skip: true })

    const scheduled = await weekly(f)
    expect(scheduled).toMatchObject({ auto: true, seenAt: null })

    // The weekly update may have nothing left to change: its empty revision is listed on request.
    const all = (await client(ctx, f.u).get('/api/plan/revisions?include=empty'))
      .body as PlanRevisionView[]
    const byReason = Object.fromEntries(all.map((v) => [v.id, v.seenAt]))
    expect(Object.values(byReason).filter((seenAt) => seenAt === null)).toHaveLength(1)
    expect(byReason[scheduled.id]).toBeNull()
  })

  test('undoing an update marks the update and the undo as seen', async () => {
    const f = await fourWeekPlan('presentation-seen-undo@example.com')
    await closeBusyDay(f)
    await client(ctx, f.u).post('/api/plan/replan').send({})
    await ctx.prisma.athleteProfile.update({
      where: { userId: f.u.id },
      data: { availability: '{}' },
    })
    const scheduled = await weekly(f)
    expect(scheduled).toMatchObject({ auto: true, seenAt: null })
    expect(scheduled.diff?.empty).toBe(false)

    const preview = (
      await client(ctx, f.u)
        .post('/api/plan/preview')
        .send({ type: 'undo', revisionId: scheduled.id })
    ).body as PlanPreview
    expect(preview.blocked, JSON.stringify(preview.reasons)).toBe(false)
    const undone = await client(ctx, f.u)
      .post(`/api/plan/revisions/${scheduled.id}/undo`)
      .send({ expectHash: preview.hash })
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    const { revision, target } = undone.body as UndoResult
    expect(revision).toMatchObject({ reason: 'undo', undoOf: scheduled.id })
    expect(revision.seenAt).toEqual(expect.any(String))
    expect(target.seenAt).toEqual(expect.any(String))
    expect(target.undo.undoneAt).toEqual(expect.any(String))
    const stored = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: scheduled.id } })
    expect(stored.seenAt).not.toBeNull()
  })

  test('undoing leaves the stamp of a revision that was already seen alone', async () => {
    const f = await fourWeekPlan('presentation-seen-kept@example.com')
    await closeBusyDay(f)
    await client(ctx, f.u).post('/api/plan/replan').send({})
    await ctx.prisma.athleteProfile.update({
      where: { userId: f.u.id },
      data: { availability: '{}' },
    })
    const scheduled = await weekly(f)
    const stamp = new Date('2026-10-19T09:00:00Z')
    await ctx.prisma.planRevision.update({ where: { id: scheduled.id }, data: { seenAt: stamp } })
    const undone = await client(ctx, f.u).post(`/api/plan/revisions/${scheduled.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    const stored = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: scheduled.id } })
    expect(stored.seenAt?.getTime()).toBe(stamp.getTime())
  })
})

describe('the revision a saved review returns', () => {
  test('is the revision as the list serves it, with its undo state and causes', async () => {
    const f = await fourWeekPlan('presentation-review@example.com')
    const last = addDays(thisMonday, -7)
    const saved = await client(ctx, f.u).put(`/api/reviews/${last}`).send({
      dataStatus: 'complete',
      fatigue: 3,
      symptoms: 'none',
      finalDecision: 'hold',
      finalNextMin: 150,
    })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    const { revision } = saved.body as SavedReview
    expect(revision).toMatchObject({ reason: 'review', auto: false })
    expect(revision!.seenAt).toEqual(expect.any(String))
    expect(revision!.undo).toBeDefined()
    expect(revision!.causes === null).toBe(revision!.diff === null)

    const served = (await list(f)).find((v) => v.id === revision!.id)
    expect(served).toEqual(revision)
  })
})
