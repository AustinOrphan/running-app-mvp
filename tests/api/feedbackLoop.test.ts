import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import type { ExecutionAssessment, WeeklyDecision } from '../../shared/engine/types.ts'
import type {
  Activity,
  PlanRevision,
  PlanWithSessions,
  TodayView,
  WeeklyReview,
} from '../../shared/types.ts'
import { gatherContextInput, resetClimateCache } from '../../server/services/engineInput.ts'
import { resetForecastCache } from '../../server/services/weather.ts'
import request from 'supertest'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// The feedback loop: reviews of version-2 plans use the engine's weekly decision and re-plan,
// activities are matched and assessed the moment they are stored, rated or linked, and the REDs
// screening reaches the engine. A Wednesday; only Date is faked.
vi.useFakeTimers({ toFake: ['Date'] })
const WEDNESDAY = new Date(2026, 9, 21, 12)
vi.setSystemTime(WEDNESDAY)

const today = todayIso()
const thisMonday = mondayOf(today)

let ctx: TestCtx
let deps: { prisma: TestCtx['prisma']; config: TestCtx['config'] }

beforeAll(async () => {
  ctx = await createTestCtx()
  deps = { prisma: ctx.prisma, config: ctx.config }
})

afterAll(async () => {
  await ctx.close()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.setSystemTime(WEDNESDAY)
  resetClimateCache()
  resetForecastCache()
})

type ReviewView = WeeklyReview & {
  signals?: WeeklyDecision['signals']
  revision?: PlanRevision | null
  replanError?: string
}

/** Twelve weeks of four runs before the current week, so the engine has a history to build on. */
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

/** A generated version-2 plan for a user with history. */
async function generatedPlan(email: string) {
  const u = await seedUser(ctx, { email })
  await seedHistory(u.id)
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 14 + 5),
      distanceM: 21_097,
      goalType: 'finish',
    },
  })
  const res = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return { u, goal, plan: res.body as PlanWithSessions }
}

/** Logs each planned run of a week as done, at the planned minutes scaled by `share`. */
async function runWeek(userId: string, plan: PlanWithSessions, weekStart: string, share: number) {
  for (const s of plan.sessions.filter((x) => x.weekStart === weekStart)) {
    if (s.kind === 'strength' || s.kind === 'mobility' || s.kind === 'rest') continue
    await ctx.prisma.activity.create({
      data: {
        userId,
        date: s.date,
        type: 'run',
        durationSec: Math.round(s.durationMin * 60 * share),
        movingSec: Math.round(s.durationMin * 60 * share),
        distanceM: 8000,
        rpe: 3,
        source: 'manual',
      },
    })
  }
}

/** Running minutes of a week's stored sessions on or after `from` (strength and rest are not running). */
async function runMinutes(planId: string, weekStart: string, from: string): Promise<number> {
  const rows = await ctx.prisma.planSession.findMany({
    where: { planId, weekStart, date: { gte: from } },
  })
  return rows
    .filter((r) => !['strength', 'mobility', 'rest', 'cross', 'race'].includes(r.kind))
    .reduce((sum, r) => sum + r.durationMin, 0)
}

const TARGET = JSON.stringify({
  zone: 'z1',
  rpe: [2, 3],
  hr: null,
  paceSecPerKm: null,
  heatNote: null,
})

/** A version-2 plan with hand-made sessions, so each test controls exactly what is planned. */
async function planWith(
  email: string,
  sessions: Array<{ date: string; kind: string; min: number }>,
): Promise<{ u: TestUser; sessionIds: string[] }> {
  const u = await seedUser(ctx, { email })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 12 + 5),
      distanceM: 21_097,
    },
  })
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: u.id,
      goalId: goal.id,
      name: goal.name,
      startDate: thisMonday,
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: 2,
      weeks: {
        create: [
          {
            weekStart: thisMonday,
            index: 0,
            phase: 'build',
            baselineRunMin: 200,
            targetRunMin: 200,
            longRunMin: 70,
            runDays: 4,
            strengthSessions: 0,
          },
        ],
      },
    },
  })
  const sessionIds: string[] = []
  for (const [i, s] of sessions.entries()) {
    const row = await ctx.prisma.planSession.create({
      data: {
        planId: plan.id,
        weekStart: mondayOf(s.date),
        date: s.date,
        order: i,
        kind: s.kind,
        title: `${s.kind} run`,
        durationMin: s.min,
        structure: '[]',
        target: TARGET,
        purpose: 'Synthetic.',
        status: 'planned',
      },
    })
    sessionIds.push(row.id)
  }
  return { u, sessionIds }
}

const manualRun = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  type: 'run',
  durationSec: 3600,
  distanceM: 9000,
  ...over,
})

function feedback(who: TestUser, id: string, body: object) {
  return request(ctx.app)
    .patch(`/api/activities/${id}/feedback`)
    .set('Host', 'app.test')
    .set('Origin', 'http://app.test')
    .set('Cookie', who.cookie)
    .send(body)
}

async function sessionRow(id: string) {
  return ctx.prisma.planSession.findUniqueOrThrow({ where: { id } })
}

describe('screening reaches the engine input and state', () => {
  test('the latest screening sets screeningFlags and risk.redsFlags', async () => {
    const u = await seedUser(ctx, { email: 'screen-input@example.com' })
    const c = client(ctx, u)
    const none = await gatherContextInput(deps, { userId: u.id, today, goalId: null })
    expect(none.screeningFlags).toBe(0)

    await c
      .post('/api/screenings')
      .send({ date: addDays(today, -90), answers: { a: true, b: true } })
    const held = await gatherContextInput(deps, { userId: u.id, today, goalId: null })
    expect(held.screeningFlags).toBe(2)
    expect(estimateState(held).risk.redsFlags).toBe(2)

    await c.post('/api/screenings').send({ date: addDays(today, -1), answers: { a: false } })
    const latest = await gatherContextInput(deps, { userId: u.id, today, goalId: null })
    expect(latest.screeningFlags).toBe(0)
    expect(estimateState(latest).risk.redsFlags).toBe(0)
  })
})

describe('reviews of version-2 plans use the weekly decision and re-plan', () => {
  test('a finished week returns the engine decision with signals and the next-week target; the current week is in progress', async () => {
    const { u, plan } = await generatedPlan('review-v2@example.com')
    expect(plan.generatorVersion).toBe(2)
    await runWeek(u.id, plan, thisMonday, 1)
    vi.setSystemTime(new Date(2026, 9, 28, 12))
    const next = addDays(thisMonday, 7)

    const res = await client(ctx, u).get(`/api/reviews?from=${thisMonday}&to=${next}`)
    expect(res.status).toBe(200)
    const [finished, current] = res.body as ReviewView[]
    expect(finished!.weekStart).toBe(thisMonday)
    expect(['progress', 'hold', 'reduce']).toContain(finished!.suggestedAction)
    expect(finished!.suggestedNextMin).toBeGreaterThan(0)
    expect(finished!.suggestedReason).toBeTruthy()
    expect(Array.isArray(finished!.signals)).toBe(true)
    expect(current!.suggestedAction).toBe('in_progress')
  })

  test('a week run well under the plan holds, with the completion signal and its rules', async () => {
    const { u, plan } = await generatedPlan('review-hold@example.com')
    await runWeek(u.id, plan, thisMonday, 0.4)
    vi.setSystemTime(new Date(2026, 9, 28, 12))

    const res = await client(ctx, u).get(`/api/reviews?from=${thisMonday}&to=${thisMonday}`)
    const [review] = res.body as ReviewView[]
    expect(review!.suggestedAction).toBe('hold')
    const completion = review!.signals!.find((s) => s.code === 'completion-low')
    expect(completion).toBeDefined()
    expect(completion!.rules).toEqual(['J5', 'G-6'])
    // The remaining minutes are never added later.
    expect(completion!.detail).not.toMatch(/behind|missed/i)
  })

  test('two REDs flags hold the weekly decision', async () => {
    const { u, plan } = await generatedPlan('review-reds@example.com')
    await runWeek(u.id, plan, thisMonday, 1)
    await client(ctx, u)
      .post('/api/screenings')
      .send({ answers: { a: true, b: true } })
    vi.setSystemTime(new Date(2026, 9, 28, 12))

    const res = await client(ctx, u).get(`/api/reviews?from=${thisMonday}&to=${thisMonday}`)
    const [review] = res.body as ReviewView[]
    expect(review!.suggestedAction).toBe('hold')
    expect(review!.signals!.map((s) => s.code)).toContain('reds')
  })

  test('possible duplicates and missing data come before the decision', async () => {
    const { u, plan } = await generatedPlan('review-gates@example.com')
    await runWeek(u.id, plan, thisMonday, 1)
    vi.setSystemTime(new Date(2026, 9, 28, 12))
    const c = client(ctx, u)
    await c.put(`/api/reviews/${thisMonday}`).send({ dataStatus: 'missing' })
    const missing = (await c.get(`/api/reviews?from=${thisMonday}&to=${thisMonday}`))
      .body as ReviewView[]
    expect(missing[0]!.suggestedAction).toBe('await_data')
    await ctx.prisma.activity.updateMany({
      where: { userId: u.id, date: plan.sessions.find((s) => s.weekStart === thisMonday)!.date },
      data: { duplicateStatus: 'possible' },
    })
    await c.put(`/api/reviews/${thisMonday}`).send({ dataStatus: 'complete' })
    const dup = (await c.get(`/api/reviews?from=${thisMonday}&to=${thisMonday}`))
      .body as ReviewView[]
    expect(dup[0]!.suggestedAction).toBe('review_duplicates')
  })

  test('saving a finished, decided week re-plans and returns the new revision; other saves do not', async () => {
    const { u, plan } = await generatedPlan('review-save@example.com')
    await runWeek(u.id, plan, thisMonday, 1)
    vi.setSystemTime(new Date(2026, 9, 28, 12))
    const c = client(ctx, u)
    const revisions = () => ctx.prisma.planRevision.count({ where: { planId: plan.id } })
    const before = await revisions()

    // A draft of the review changes nothing in the plan.
    const draft = await c.put(`/api/reviews/${thisMonday}`).send({ fatigue: 4 })
    expect(draft.status).toBe(200)
    expect((draft.body as ReviewView).revision).toBeNull()
    expect(await revisions()).toBe(before)

    const saved = await c
      .put(`/api/reviews/${thisMonday}`)
      .send({ dataStatus: 'complete', symptoms: 'none', finalDecision: 'hold', finalNextMin: 200 })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    const body = saved.body as ReviewView
    expect(body.reviewedAt).not.toBeNull()
    expect(body.revision).toMatchObject({ planId: plan.id, reason: 'review' })
    expect(body.revision!.summary).toMatch(/change|No changes/)
    expect(body.revision!.summary).toMatch(/Last week's decision/)
    expect(await revisions()).toBe(before + 1)
    expect(
      await ctx.prisma.planRevision.count({ where: { planId: plan.id, reason: 'review' } }),
    ).toBe(1)

    // The owner's decided minutes stay on next week's target while inside the limit.
    const week = await ctx.prisma.planWeek.findFirstOrThrow({
      where: { planId: plan.id, weekStart: addDays(thisMonday, 7) },
    })
    expect(week.targetRunMin).toBeLessThanOrEqual(200)
    // ... and so do the sessions still to run that week.
    expect(await runMinutes(plan.id, thisMonday, '2026-10-28')).toBeLessThanOrEqual(200)
  })

  test('the suggested next week follows the ramp of the profile: 5% over the week run after a bone stress injury', async () => {
    const clean = await generatedPlan('review-ramp-clean@example.com')
    const bsi = await generatedPlan('review-ramp-bsi@example.com')
    const injuries = JSON.stringify([
      { area: 'tibia', side: 'left', year: 2025, month: 4, kind: 'bone-stress', notes: null },
    ])
    await ctx.prisma.athleteProfile.upsert({
      where: { userId: bsi.u.id },
      create: { userId: bsi.u.id, injuries },
      update: { injuries },
    })
    const suggested = async ({ u, plan }: typeof clean) => {
      await runWeek(u.id, plan, thisMonday, 0.5)
      const acts = await ctx.prisma.activity.findMany({
        where: { userId: u.id, date: { gte: thisMonday } },
      })
      const actual = acts.reduce((sum, a) => sum + a.durationSec / 60, 0)
      vi.setSystemTime(new Date(2026, 9, 28, 12))
      const res = await client(ctx, u).get(`/api/reviews?from=${thisMonday}&to=${thisMonday}`)
      vi.setSystemTime(WEDNESDAY)
      return { actual, next: (res.body as ReviewView[])[0]!.suggestedNextMin }
    }
    const a = await suggested(clean)
    const b = await suggested(bsi)
    expect(a.next).toBe(Math.floor(a.actual * 1.1 + 1e-9))
    expect(b.next).toBe(Math.floor(b.actual * 1.05 + 1e-9))
  })

  test('a decided lower target for next week sizes the sessions, not only the week row', async () => {
    const { u, plan } = await generatedPlan('review-sessions@example.com')
    await runWeek(u.id, plan, thisMonday, 1)
    // The Monday after the reviewed week: all of the next week is still to run.
    const monday = addDays(thisMonday, 7)
    vi.setSystemTime(new Date(2026, 9, 26, 12))
    const planned = await runMinutes(plan.id, monday, monday)
    expect(planned).toBeGreaterThan(100)

    const saved = await client(ctx, u)
      .put(`/api/reviews/${thisMonday}`)
      .send({ dataStatus: 'complete', finalDecision: 'reduce', finalNextMin: 80 })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect((saved.body as ReviewView).revision).not.toBeNull()
    const after = await runMinutes(plan.id, monday, monday)
    expect(after).toBeLessThanOrEqual(80)
    expect(after).toBeGreaterThan(0)
  })

  test('an illness check-in makes next week lighter than a clean week', async () => {
    const clean = await generatedPlan('review-clean@example.com')
    const ill = await generatedPlan('review-ill@example.com')
    const lastWeek = addDays(thisMonday, 7)
    for (const { u, plan } of [clean, ill]) {
      await runWeek(u.id, plan, thisMonday, 1)
      await runWeek(u.id, plan, lastWeek, 1)
    }
    await ctx.prisma.wellnessDay.create({
      data: {
        userId: ill.u.id,
        date: addDays(lastWeek, 2),
        illness: true,
        painScore: 7,
        source: 'manual',
      },
    })
    // The Monday after the week with the illness.
    vi.setSystemTime(new Date(2026, 10, 2, 12))
    const monday = addDays(thisMonday, 14)
    for (const { u } of [clean, ill]) {
      const res = await client(ctx, u).post('/api/plan/replan').send({})
      expect(res.status, JSON.stringify(res.body)).toBe(200)
    }
    const cleanMin = await runMinutes(clean.plan.id, monday, monday)
    const illMin = await runMinutes(ill.plan.id, monday, monday)
    expect(cleanMin).toBeGreaterThan(0)
    expect(illMin).toBeGreaterThan(0)
    expect(illMin).toBeLessThan(cleanMin)
  })

  test('a hold decision trims the next quality session of the week after it, stored as eased', async () => {
    const { u, plan } = await generatedPlan('replan-hold@example.com')
    const quality = ['threshold', 'intervals', 'hills', 'race-pace', 'long-fast-finish']
    // The first week after this one that holds a quality session; every week before it is run in
    // full, and the week just before it at half, so the decision for it is a hold.
    const target = plan.weeks.find(
      (w) =>
        w.weekStart > thisMonday &&
        plan.sessions.some((s) => s.weekStart === w.weekStart && quality.includes(s.kind)),
    )!.weekStart
    for (let week = thisMonday; week < target; week = addDays(week, 7)) {
      await runWeek(u.id, plan, week, week === addDays(target, -7) ? 0.5 : 1)
    }
    // noon local time on that Monday
    vi.setSystemTime(new Date(`${target}T12:00:00`))
    const res = await client(ctx, u).post('/api/plan/replan').send({})
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect((res.body as PlanRevision).summary).toMatch(/decision: hold/)
    const rows = await ctx.prisma.planSession.findMany({
      where: { planId: plan.id, weekStart: target },
    })
    const trimmed = rows.filter((r) => (JSON.parse(r.rules) as string[]).includes('design-4.3'))
    expect(trimmed).toHaveLength(1)
    expect(trimmed[0]!.status).toBe('downgraded')
    expect(quality).toContain(trimmed[0]!.kind)
  })

  test('a re-plan that cannot run does not fail the save', async () => {
    const { u, plan, goal } = await generatedPlan('review-noreplan@example.com')
    await runWeek(u.id, plan, thisMonday, 1)
    vi.setSystemTime(new Date(2026, 9, 28, 12))
    // The goal date has passed, so the engine refuses to re-plan.
    await ctx.prisma.goal.update({ where: { id: goal.id }, data: { targetDate: '2026-10-25' } })

    const saved = await client(ctx, u)
      .put(`/api/reviews/${thisMonday}`)
      .send({ dataStatus: 'complete', finalDecision: 'hold', finalNextMin: 150 })
    expect(saved.status).toBe(200)
    const body = saved.body as ReviewView
    expect(body.reviewedAt).not.toBeNull()
    expect(body.revision).toBeNull()
    expect(body.replanError).toMatch(/goal date has passed/i)
  })

  test('a version-1 plan keeps the version-1 suggestion and returns a plain review', async () => {
    const u = await seedUser(ctx, { email: 'review-v1@example.com' })
    const goal = await ctx.prisma.goal.create({
      data: {
        userId: u.id,
        name: 'Old',
        priority: 'A',
        targetDate: addDays(thisMonday, 70),
        distanceM: 21_097,
      },
    })
    const plan = await ctx.prisma.plan.create({
      data: {
        userId: u.id,
        goalId: goal.id,
        name: 'Old',
        startDate: addDays(thisMonday, -7),
        raceWeekStart: addDays(thisMonday, 63),
        generatorVersion: 1,
      },
    })
    for (const [index, weekStart] of [addDays(thisMonday, -7), thisMonday].entries()) {
      await ctx.prisma.planWeek.create({
        data: {
          planId: plan.id,
          weekStart,
          index,
          phase: 'base2',
          baselineRunMin: 300,
          targetRunMin: 300,
          longRunMin: 90,
          runDays: 4,
          strengthSessions: 0,
        },
      })
    }
    const c = client(ctx, u)
    const last = addDays(thisMonday, -7)
    const list = (await c.get(`/api/reviews?from=${last}&to=${last}`)).body as ReviewView[]
    expect(list[0]!.suggestedAction).toBe('await_data')
    expect('signals' in list[0]!).toBe(false)
    const saved = await c.put(`/api/reviews/${last}`).send({ dataStatus: 'complete' })
    expect(saved.status).toBe(200)
    expect('revision' in (saved.body as object)).toBe(false)
    expect(await ctx.prisma.planRevision.count({ where: { planId: plan.id } })).toBe(0)
  })
})

describe('execution runs as soon as an activity is stored, edited, rated or linked', () => {
  test('a manual activity fulfils the session of its day at once', async () => {
    const { u, sessionIds } = await planWith('trigger-create@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const res = await client(ctx, u).post('/api/activities').send(manualRun(today))
    expect(res.status).toBe(201)
    const row = await sessionRow(sessionIds[0]!)
    expect(row).toMatchObject({
      activityId: (res.body as Activity).id,
      linkSource: 'auto',
      status: 'completed',
    })
    expect(JSON.parse(row.execution!)).toMatchObject({ completion: 'completed' })
  })

  test('editing the activity re-assesses its session', async () => {
    const { u, sessionIds } = await planWith('trigger-edit@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const c = client(ctx, u)
    const created = (await c.post('/api/activities').send(manualRun(today))).body as Activity
    expect((await sessionRow(sessionIds[0]!)).status).toBe('completed')

    const edited = await c
      .put(`/api/activities/${created.id}`)
      .send(manualRun(today, { durationSec: 1800 }))
    expect(edited.status).toBe(200)
    const row = await sessionRow(sessionIds[0]!)
    expect(row.status).toBe('partial')
    expect(JSON.parse(row.execution!)).toMatchObject({ completion: 'partial' })
  })

  test('an edit that moves the activity onto a planned day links it there', async () => {
    const { u, sessionIds } = await planWith('trigger-move@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const c = client(ctx, u)
    const created = (await c.post('/api/activities').send(manualRun(addDays(today, -4))))
      .body as Activity
    expect((await sessionRow(sessionIds[0]!)).activityId).toBeNull()
    await c.put(`/api/activities/${created.id}`).send(manualRun(today))
    expect((await sessionRow(sessionIds[0]!)).activityId).toBe(created.id)
  })

  test('an edit that moves the activity away from its session unlinks it and clears the assessment', async () => {
    const { u, sessionIds } = await planWith('rematch-away@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const c = client(ctx, u)
    const created = (await c.post('/api/activities').send(manualRun(today))).body as Activity
    expect((await sessionRow(sessionIds[0]!)).status).toBe('completed')

    const edited = await c.put(`/api/activities/${created.id}`).send(manualRun(addDays(today, -4)))
    expect(edited.status).toBe(200)
    expect(await sessionRow(sessionIds[0]!)).toMatchObject({
      activityId: null,
      linkSource: null,
      execution: null,
      status: 'planned',
    })
  })

  test('a date change within a day keeps the link and re-assesses', async () => {
    const { u, sessionIds } = await planWith('rematch-near@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const c = client(ctx, u)
    const created = (await c.post('/api/activities').send(manualRun(today))).body as Activity
    await c
      .put(`/api/activities/${created.id}`)
      .send(manualRun(addDays(today, -1), { durationSec: 1800 }))
    expect(await sessionRow(sessionIds[0]!)).toMatchObject({
      activityId: created.id,
      linkSource: 'auto',
      status: 'partial',
    })
  })

  test('a freed session is matched again to another run beside it', async () => {
    const { u, sessionIds } = await planWith('rematch-other@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const c = client(ctx, u)
    const created = (await c.post('/api/activities').send(manualRun(today))).body as Activity
    const nearby = (await c.post('/api/activities').send(manualRun(addDays(today, -1))))
      .body as Activity
    // the run of the day takes the session; the run of the day before stays free
    expect((await sessionRow(sessionIds[0]!)).activityId).toBe(created.id)

    await c.put(`/api/activities/${created.id}`).send(manualRun(addDays(today, -6)))
    expect(await sessionRow(sessionIds[0]!)).toMatchObject({
      activityId: nearby.id,
      linkSource: 'auto',
      status: 'completed',
    })
  })

  test('a change of type that no longer fits the session unlinks it', async () => {
    const { u, sessionIds } = await planWith('rematch-type@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const c = client(ctx, u)
    const created = (await c.post('/api/activities').send(manualRun(today))).body as Activity
    await c.put(`/api/activities/${created.id}`).send(manualRun(today, { type: 'strength' }))
    expect(await sessionRow(sessionIds[0]!)).toMatchObject({ activityId: null, status: 'planned' })
  })

  test('an owner link on the same date stays through an edit; one moved out of reach is unlinked', async () => {
    const { u, sessionIds } = await planWith('rematch-owner@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const c = client(ctx, u)
    const created = (await c.post('/api/activities').send(manualRun(addDays(today, -3))))
      .body as Activity
    await ctx.prisma.planSession.update({
      where: { id: sessionIds[0]! },
      data: { activityId: created.id, linkSource: 'owner' },
    })
    // the date is untouched: nothing is reconsidered, the owner's link stays and is re-assessed
    await c.put(`/api/activities/${created.id}`).send(manualRun(addDays(today, -3), { rpe: 4 }))
    expect(await sessionRow(sessionIds[0]!)).toMatchObject({
      activityId: created.id,
      linkSource: 'owner',
    })
    // on the session's date it fits, so a date edit onto it keeps the link
    await c.put(`/api/activities/${created.id}`).send(manualRun(today))
    expect(await sessionRow(sessionIds[0]!)).toMatchObject({
      activityId: created.id,
      linkSource: 'owner',
    })
    // a type edit on the same date keeps the owner's link, even to a kind the matcher would refuse
    await c.put(`/api/activities/${created.id}`).send(manualRun(today, { type: 'strength' }))
    expect(await sessionRow(sessionIds[0]!)).toMatchObject({
      activityId: created.id,
      linkSource: 'owner',
    })
    // a date edit out of reach unlinks it
    await c.put(`/api/activities/${created.id}`).send(manualRun(addDays(today, -5)))
    expect(await sessionRow(sessionIds[0]!)).toMatchObject({ activityId: null, linkSource: null })
  })

  test('a feedback change re-assesses the linked session', async () => {
    const { u, sessionIds } = await planWith('trigger-feedback@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const c = client(ctx, u)
    const created = (await c.post('/api/activities').send(manualRun(today))).body as Activity
    const first = JSON.parse((await sessionRow(sessionIds[0]!)).execution!) as ExecutionAssessment
    expect(first.effort.parts.feel).toBeNull()

    const rated = await feedback(u, created.id, { feel: -2, rpe: 8 })
    expect(rated.status).toBe(200)
    const second = JSON.parse((await sessionRow(sessionIds[0]!)).execution!) as ExecutionAssessment
    expect(second.effort.parts.feel).toBe(-2)
    expect(second.effort.parts.rpeDelta).not.toBeNull()
  })

  test('feedback on an activity older than the sweep still re-assesses its owner-linked session', async () => {
    const old = addDays(today, -12)
    const { u, sessionIds } = await planWith('trigger-old@example.com', [
      { date: old, kind: 'easy', min: 60 },
    ])
    const activity = await ctx.prisma.activity.create({
      data: {
        userId: u.id,
        date: old,
        type: 'run',
        durationSec: 3600,
        distanceM: 9000,
        source: 'manual',
      },
    })
    await ctx.prisma.planSession.update({
      where: { id: sessionIds[0]! },
      data: { activityId: activity.id, linkSource: 'owner' },
    })
    const rated = await feedback(u, activity.id, { feel: 2 })
    expect(rated.status).toBe(200)
    const row = await sessionRow(sessionIds[0]!)
    expect(row.status).toBe('completed')
    expect((JSON.parse(row.execution!) as ExecutionAssessment).effort.parts.feel).toBe(2)
  })

  test('linking by hand assesses at once', async () => {
    const { u, sessionIds } = await planWith('trigger-link@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const activity = await ctx.prisma.activity.create({
      data: {
        userId: u.id,
        date: addDays(today, -4),
        type: 'run',
        durationSec: 3000,
        distanceM: 8000,
        source: 'manual',
      },
    })
    const res = await client(ctx, u)
      .post(`/api/plan/sessions/${sessionIds[0]}/link`)
      .send({ activityId: activity.id })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'completed', linkSource: 'owner' })
    expect((res.body as { execution: ExecutionAssessment | null }).execution).not.toBeNull()
  })

  test('pain of 4 or more on an activity reaches the assessment and the Today red flags at once', async () => {
    const { u, sessionIds } = await planWith('trigger-pain@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const c = client(ctx, u)
    const created = (await c.post('/api/activities').send(manualRun(today))).body as Activity
    const before = (await c.get('/api/today')).body as TodayView
    expect(before.readiness.redFlags.map((f) => f.code)).not.toContain('pain')

    await feedback(u, created.id, { pain: 5 })
    const execution = JSON.parse(
      (await sessionRow(sessionIds[0]!)).execution!,
    ) as ExecutionAssessment
    expect(execution.flags).toContain('pain')
    const after = (await c.get('/api/today')).body as TodayView
    expect(after.readiness.redFlags.map((f) => f.code)).toContain('pain')
  })

  test('a user without a plan can still store and rate activities', async () => {
    const u = await seedUser(ctx, { email: 'trigger-noplan@example.com' })
    const c = client(ctx, u)
    const created = await c.post('/api/activities').send(manualRun(today))
    expect(created.status).toBe(201)
    const rated = await feedback(u, (created.body as Activity).id, { feel: 1 })
    expect(rated.status).toBe(200)
  })
})
