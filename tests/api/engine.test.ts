import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type {
  Checkin,
  PlanRevision,
  PlanSession,
  PlanWithSessions,
  PredictionView,
  ResearchParams,
  Screening,
  TodayView,
} from '../../shared/types.ts'
import { resetClimateCache } from '../../server/services/engineInput.ts'
import { resetForecastCache } from '../../server/services/weather.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// Lets one test force a failed checklist; every other call goes to the real engine.
const force = vi.hoisted(() => ({ failChecklist: false }))
vi.mock('../../shared/engine/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../shared/engine/index.ts')>()
  return {
    ...real,
    buildPlan: (input: Parameters<typeof real.buildPlan>[0]) => {
      const draft = real.buildPlan(input)
      return force.failChecklist
        ? {
            ...draft,
            checklist: [{ id: 'spike-guard', ok: false, detail: 'forced', rules: ['g-1'] }],
          }
        : draft
    },
  }
})

let ctx: TestCtx
let user: TestUser

// A Wednesday, so the current week always has sessions left and the tests do not depend on the
// day they run. Only Date is faked; timers and promises keep working.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 21, 12))

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const today = todayIso()
const thisMonday = mondayOf(today)

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterAll(async () => {
  await ctx.close()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetClimateCache()
  resetForecastCache()
})

/** Twelve completed weeks of four runs, so the engine has a history to build on. */
async function seedHistory(userId: string, prisma = ctx.prisma): Promise<void> {
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
  await prisma.activity.createMany({ data: rows })
}

async function seedGoal(userId: string, over: { weeks?: number; distanceM?: number } = {}) {
  return ctx.prisma.goal.create({
    data: {
      userId,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * (over.weeks ?? 14) + 5),
      distanceM: over.distanceM ?? 21_097,
      goalType: 'finish',
    },
  })
}

async function generated(who: TestUser, goalId: string): Promise<PlanWithSessions> {
  const res = await client(ctx, who).post('/api/plan/generate').send({ goalId })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body as PlanWithSessions
}

describe('version-2 plan generation', () => {
  test('generate persists weeks, sessions, a revision and a prediction', async () => {
    const u = await seedUser(ctx, { email: 'gen@example.com' })
    await seedHistory(u.id)
    // A race result gives the prediction something to stand on.
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
    const goal = await seedGoal(u.id)
    const plan = await generated(u, goal.id)

    expect(plan).toMatchObject({ generatorVersion: 2, status: 'active', goalId: goal.id })
    expect(plan.paramsVersion).toMatch(/^\d{4}-\d{2}-\d{2}/)
    expect(plan.weeks.length).toBeGreaterThan(10)
    expect(plan.weeks[0]?.weekStart).toBe(thisMonday)
    expect(plan.weeks.every((w) => w.targetRunMin === w.baselineRunMin)).toBe(true)
    expect(plan.weeks.every((w) => w.targetSource === 'baseline')).toBe(true)
    expect(plan.sessions.length).toBeGreaterThan(30)
    expect(plan.sessions.every((s) => s.date >= today)).toBe(true)
    expect(plan.sessions.filter((s) => s.kind === 'race')).toHaveLength(1)
    expect(plan.checklist.length).toBeGreaterThan(0)
    expect(plan.checklist.every((c) => c.ok)).toBe(true)
    expect(plan.feasibility?.label).toBeDefined()
    expect(plan.zones).not.toBeNull()

    const stored = (await client(ctx, u).get('/api/plan')).body as PlanWithSessions
    expect(stored.id).toBe(plan.id)
    expect(stored.sessions).toHaveLength(plan.sessions.length)
    expect(stored.zones).not.toBeNull()

    const revisions = (await client(ctx, u).get('/api/plan/revisions')).body as PlanRevision[]
    expect(revisions).toHaveLength(1)
    expect(revisions[0]).toMatchObject({ reason: 'generate', changes: [] })

    const predictions = (await client(ctx, u).get(`/api/predictions?goalId=${goal.id}`))
      .body as PredictionView
    expect(predictions.log).toHaveLength(1)
    expect(predictions.prediction?.predictedSec).toBeGreaterThan(0)
  })

  test('generated on a Saturday, the week packs no spike into its last two days', async () => {
    // 8 weeks of 40-minute runs on six days, the day 3 days ahead closed, a marathon 20 weeks out:
    // the rest of the week used to be packed into Saturday and Sunday and failed spike-guard (422).
    const saturday = addDays(thisMonday, 5)
    vi.setSystemTime(new Date(2026, 9, 24, 12))
    try {
      const u = await seedUser(ctx, { email: 'saturday@example.com' })
      const rows = []
      for (let w = 1; w <= 8; w += 1) {
        for (let dow = 0; dow < 6; dow += 1) {
          rows.push({
            userId: u.id,
            date: addDays(thisMonday, -7 * w + dow),
            type: 'run',
            durationSec: 2400,
            movingSec: 2400,
            distanceM: 6500,
            rpe: 3,
            source: 'manual',
          })
        }
      }
      await ctx.prisma.activity.createMany({ data: rows })
      const availability = JSON.stringify({ tue: { available: false, maxMin: null } })
      await ctx.prisma.athleteProfile.upsert({
        where: { userId: u.id },
        create: {
          userId: u.id,
          birthYear: 1985,
          hrMax: 188,
          hrMaxSource: 'measured',
          availability,
        },
        update: { birthYear: 1985, hrMax: 188, hrMaxSource: 'measured', availability },
      })
      const goal = await ctx.prisma.goal.create({
        data: {
          userId: u.id,
          name: 'Synthetic marathon',
          priority: 'A',
          targetDate: addDays(saturday, 140),
          distanceM: 42_195,
          goalType: 'finish',
        },
      })

      const res = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
      expect(res.status, JSON.stringify(res.body)).toBe(201)
      const plan = res.body as PlanWithSessions
      expect(plan.checklist.every((c) => c.ok)).toBe(true)
      expect(plan.sessions.filter((s) => s.flags.includes('override-required'))).toEqual([])
      // nothing in the current week is longer than 1.10x the 40-minute reference
      const rest = plan.sessions.filter((s) => s.weekStart === thisMonday && s.kind !== 'strength')
      expect(rest.every((s) => s.durationMin <= 44)).toBe(true)
    } finally {
      vi.setSystemTime(new Date(2026, 9, 21, 12))
    }
  })

  test('regenerating archives the old plan and keeps exactly one active plan', async () => {
    const u = await seedUser(ctx, { email: 'regen@example.com' })
    await seedHistory(u.id)
    const goal = await seedGoal(u.id)
    const first = await generated(u, goal.id)
    const second = await generated(u, goal.id)
    expect(second.id).not.toBe(first.id)
    const plans = await ctx.prisma.plan.findMany({ where: { userId: u.id } })
    expect(plans.filter((p) => p.status === 'active').map((p) => p.id)).toEqual([second.id])
  })

  test('the strength preference maps to an engine option and is stored with the plan', async () => {
    const u = await seedUser(ctx, { email: 'opts@example.com' })
    await seedHistory(u.id)
    const goal = await seedGoal(u.id)
    const res = await client(ctx, u)
      .post('/api/plan/generate')
      .send({ goalId: goal.id, options: { strengthSessions: 0, recoveryCycle: '2:1' } })
    expect(res.status).toBe(201)
    expect((res.body as PlanWithSessions).sessions.some((s) => s.kind === 'strength')).toBe(false)
    const row = await ctx.prisma.plan.findUniqueOrThrow({
      where: { id: (res.body as { id: string }).id },
    })
    expect(JSON.parse(row.options)).toEqual({ strengthSessions: 0, recoveryCycle: '2:1' })
  })

  test('generate errors', async () => {
    const u = await seedUser(ctx, { email: 'errors@example.com' })
    await seedHistory(u.id)
    const foreign = await seedGoal(user.id)
    const noDistance = await ctx.prisma.goal.create({
      data: { userId: u.id, name: 'No distance', priority: 'A', targetDate: addDays(today, 90) },
    })
    const past = await ctx.prisma.goal.create({
      data: {
        userId: u.id,
        name: 'Past',
        priority: 'A',
        targetDate: addDays(today, -3),
        distanceM: 10_000,
      },
    })
    const done = await ctx.prisma.goal.create({
      data: {
        userId: u.id,
        name: 'Done',
        priority: 'A',
        status: 'done',
        targetDate: addDays(today, 90),
        distanceM: 10_000,
      },
    })
    const far = await seedGoal(u.id, { weeks: 160 })
    const c = client(ctx, u)
    const cases: Array<[string, Record<string, unknown>, number]> = [
      ['unknown goal', { goalId: 'nope' }, 404],
      ['another user goal', { goalId: foreign.id }, 404],
      ['no distance', { goalId: noDistance.id }, 400],
      ['past race', { goalId: past.id }, 400],
      ['done goal', { goalId: done.id }, 400],
      ['too many weeks', { goalId: far.id }, 400],
      ['missing goalId', {}, 400],
      ['unknown option', { goalId: far.id, options: { surprise: 1 } }, 400],
    ]
    for (const [label, body, status] of cases) {
      const res = await c.post('/api/plan/generate').send(body)
      expect(res.status, label).toBe(status)
    }
    expect(await ctx.prisma.plan.count({ where: { userId: u.id } })).toBe(0)
  })

  test('a failed checklist blocks publishing with a 422 that lists the checklist', async () => {
    const u = await seedUser(ctx, { email: 'blocked@example.com' })
    await seedHistory(u.id)
    const goal = await seedGoal(u.id)
    force.failChecklist = true
    try {
      const res = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
      expect(res.status).toBe(422)
      const body = res.body as {
        error: { code: string; details: { checklist: Array<{ ok: boolean }> } }
      }
      expect(body.error.details.checklist.some((c) => !c.ok)).toBe(true)
      expect(await ctx.prisma.plan.count({ where: { userId: u.id } })).toBe(0)
    } finally {
      force.failChecklist = false
    }
  })
})

describe('version-1 plans keep working', () => {
  test('GET /api/plan returns a version-1 plan without sessions', async () => {
    const u = await seedUser(ctx, { email: 'v1@example.com' })
    const goal = await seedGoal(u.id)
    const plan = await ctx.prisma.plan.create({
      data: {
        userId: u.id,
        goalId: goal.id,
        name: 'Old plan',
        startDate: thisMonday,
        raceWeekStart: mondayOf(goal.targetDate),
        generatorVersion: 1,
        weeks: {
          create: [
            {
              weekStart: thisMonday,
              index: 0,
              phase: 'base1',
              baselineRunMin: 120,
              targetRunMin: 120,
              longRunMin: 50,
              runDays: 4,
              strengthSessions: 1,
            },
          ],
        },
      },
    })
    const res = await client(ctx, u).get('/api/plan')
    const body = res.body as PlanWithSessions
    expect(body).toMatchObject({
      id: plan.id,
      generatorVersion: 1,
      sessions: [],
      feasibility: null,
      warnings: [],
      checklist: [],
      zones: null,
    })
    expect(body.weeks).toHaveLength(1)
    expect((await client(ctx, u).post('/api/plan/replan').send({})).status).toBe(400)
  })
})

describe('re-plan', () => {
  test('re-plans from today, keeps the past and writes a revision', async () => {
    const u = await seedUser(ctx, { email: 'replan@example.com' })
    await seedHistory(u.id)
    const goal = await seedGoal(u.id)
    const plan = await generated(u, goal.id)
    const c = client(ctx, u)

    const res = await c.post('/api/plan/replan').send({})
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const revision = res.body as PlanRevision
    expect(revision).toMatchObject({ planId: plan.id, reason: 'owner' })
    expect(revision.summary.length).toBeGreaterThan(0)

    const after = (await c.get('/api/plan')).body as PlanWithSessions
    expect(after.id).toBe(plan.id)
    expect(after.sessions.map((s) => s.date + s.kind)).toEqual(
      plan.sessions.map((s) => s.date + s.kind),
    )
    expect(after.weeks).toHaveLength(plan.weeks.length)
    const revisions = (await c.get('/api/plan/revisions')).body as PlanRevision[]
    expect(revisions.map((r) => r.reason)).toEqual(['owner', 'generate'])
  })

  test('a finished session of the current week survives a re-plan', async () => {
    const u = await seedUser(ctx, { email: 'replan-kept@example.com' })
    await seedHistory(u.id)
    const goal = await seedGoal(u.id)
    const plan = await generated(u, goal.id)
    const todays = plan.sessions.find((s) => s.date >= today && s.weekStart === thisMonday)!
    expect(todays).toBeDefined()
    await ctx.prisma.planSession.update({
      where: { id: todays.id },
      data: { status: 'completed' },
    })
    expect((await client(ctx, u).post('/api/plan/replan').send({})).status).toBe(200)
    const row = await ctx.prisma.planSession.findUnique({ where: { id: todays.id } })
    expect(row?.status).toBe('completed')
  })

  test('owner edits of the next 14 days survive a re-plan', async () => {
    const u = await seedUser(ctx, { email: 'replan-edits@example.com' })
    await seedHistory(u.id)
    const goal = await seedGoal(u.id)
    const plan = await generated(u, goal.id)
    const c = client(ctx, u)
    const next = addDays(thisMonday, 7)
    const week = plan.sessions.filter((s) => s.weekStart === next)
    const easy = week.filter((s) => s.kind === 'easy')
    expect(easy.length).toBeGreaterThanOrEqual(2)
    const taken = new Set(week.map((s) => s.date))
    // a free day with no hard session next to it
    const free = [0, 1, 2, 3, 4, 5, 6]
      .map((i) => addDays(next, i))
      .find(
        (date) =>
          !taken.has(date) &&
          !week.some(
            (s) =>
              !['easy', 'recovery', 'strength'].includes(s.kind) &&
              Math.abs(Date.parse(s.date) - Date.parse(date)) === 86_400_000,
          ),
      )
    expect(free).toBeDefined()
    const moved = await c.put(`/api/plan/sessions/${easy[0]!.id}`).send({ date: free })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    expect((await c.put(`/api/plan/sessions/${easy[1]!.id}`).send({ skip: true })).status).toBe(200)

    expect((await c.post('/api/plan/replan').send({})).status).toBe(200)
    const after = (await c.get('/api/plan')).body as PlanWithSessions
    expect(after.sessions.find((s) => s.id === easy[0]!.id)).toMatchObject({
      date: free,
      status: 'moved',
    })
    expect(after.sessions.find((s) => s.id === easy[1]!.id)).toMatchObject({ status: 'skipped' })
    // nothing else is planned on their days, and the skipped run is not made up
    for (const date of [free!, easy[1]!.date]) {
      const runs = after.sessions.filter(
        (s) => s.date === date && !['strength', 'mobility', 'rest'].includes(s.kind),
      )
      expect(runs, date).toHaveLength(1)
    }
    const minutes = (sessions: PlanSession[]) =>
      sessions
        .filter(
          (s) =>
            s.weekStart === next &&
            s.status !== 'skipped' &&
            !['strength', 'mobility', 'rest', 'race'].includes(s.kind),
        )
        .reduce((n, s) => n + s.durationMin, 0)
    expect(minutes(after.sessions)).toBeLessThanOrEqual(
      minutes(plan.sessions) - easy[1]!.durationMin,
    )
  })

  test('without a plan there is nothing to re-plan', async () => {
    const u = await seedUser(ctx, { email: 'noplan@example.com' })
    expect((await client(ctx, u).post('/api/plan/replan').send({})).status).toBe(404)
  })
})

describe('owner edits of one session', () => {
  async function planFor(email: string): Promise<{ u: TestUser; plan: PlanWithSessions }> {
    const u = await seedUser(ctx, { email })
    await seedHistory(u.id)
    const goal = await seedGoal(u.id)
    return { u, plan: await generated(u, goal.id) }
  }

  test('skip, restore and the race day', async () => {
    const { u, plan } = await planFor('skip@example.com')
    const c = client(ctx, u)
    const easy = plan.sessions.find((s) => s.kind === 'easy' && s.date > today)!
    const skipped = await c.put(`/api/plan/sessions/${easy.id}`).send({ skip: true })
    expect(skipped.status).toBe(200)
    expect((skipped.body as PlanSession).status).toBe('skipped')
    expect((skipped.body as PlanSession).original).not.toBeNull()
    const restored = await c.put(`/api/plan/sessions/${easy.id}`).send({ skip: false })
    expect((restored.body as PlanSession).status).toBe('planned')
    const revisions = (await c.get('/api/plan/revisions')).body as PlanRevision[]
    expect(revisions.slice(0, 2).map((r) => r.summary)).toEqual([
      expect.stringMatching(/^Restored /),
      expect.stringMatching(/^Skipped /),
    ])

    const race = plan.sessions.find((s) => s.kind === 'race')!
    expect((await c.put(`/api/plan/sessions/${race.id}`).send({ skip: true })).status).toBe(409)
    expect(
      (await c.put(`/api/plan/sessions/${race.id}`).send({ date: addDays(race.date, -1) })).status,
    ).toBe(409)
  })

  test('a move to a closed or crowded day is refused with the reason', async () => {
    const { u, plan } = await planFor('move@example.com')
    const c = client(ctx, u)
    const future = plan.sessions.filter((s) => s.date > today && s.weekStart > thisMonday)
    const easy = future.find((s) => s.kind === 'easy')!
    const sameWeek = future.filter((s) => s.weekStart === easy.weekStart && s.id !== easy.id)

    // Another week.
    const away = await c.put(`/api/plan/sessions/${easy.id}`).send({ date: addDays(easy.date, 7) })
    expect(away.status).toBe(409)
    expect((away.body as { error: { message: string } }).error.message).toMatch(
      /within its own week/,
    )

    // A day that already has a run.
    const busy = sameWeek.find((s) => ['easy', 'long', 'recovery'].includes(s.kind))
    expect(busy).toBeDefined()
    if (busy) {
      const res = await c.put(`/api/plan/sessions/${easy.id}`).send({ date: busy.date })
      expect(res.status).toBe(409)
      expect((res.body as { error: { message: string } }).error.message).toMatch(
        /already has a run/,
      )
    }

    // A closed day.
    const closed = easy.date === easy.weekStart ? addDays(easy.weekStart, 1) : easy.weekStart
    const weekday = WEEKDAYS[(new Date(`${closed}T00:00:00Z`).getUTCDay() + 6) % 7]!
    const availability = JSON.stringify({ [weekday]: { available: false, maxMin: null } })
    await ctx.prisma.athleteProfile.upsert({
      where: { userId: u.id },
      create: { userId: u.id, availability },
      update: { availability },
    })
    const shut = await c.put(`/api/plan/sessions/${easy.id}`).send({ date: closed })
    expect(shut.status).toBe(409)
    expect((shut.body as { error: { message: string } }).error.message).toMatch(/not a day you run/)
  })

  test('a move to a free day inside the week is applied and recorded', async () => {
    const { u, plan } = await planFor('move-ok@example.com')
    const c = client(ctx, u)
    const easy = plan.sessions.find((s) => s.kind === 'easy' && s.weekStart > thisMonday)!
    const taken = new Set(
      plan.sessions.filter((s) => s.weekStart === easy.weekStart).map((s) => s.date),
    )
    let target: string | null = null
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(easy.weekStart, i)
      if (!taken.has(date) && Math.abs(Date.parse(date) - Date.parse(easy.date)) !== 86_400_000) {
        target = date
        break
      }
    }
    expect(target).not.toBeNull()
    const res = await c.put(`/api/plan/sessions/${easy.id}`).send({ date: target })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({ date: target, status: 'moved' })
    const revisions = (await c.get('/api/plan/revisions')).body as PlanRevision[]
    expect(revisions[0]?.reason).toBe('owner')
    expect(revisions[0]?.summary).toMatch(/Moved/)
  })

  test('a patch carries exactly one change and sessions of others are hidden', async () => {
    const { u, plan } = await planFor('patch@example.com')
    const other = await seedUser(ctx, { email: 'patch-other@example.com' })
    const easy = plan.sessions.find((s) => s.kind === 'easy')!
    const c = client(ctx, u)
    expect((await c.put(`/api/plan/sessions/${easy.id}`).send({})).status).toBe(400)
    expect(
      (await c.put(`/api/plan/sessions/${easy.id}`).send({ skip: true, date: today })).status,
    ).toBe(400)
    expect((await c.put(`/api/plan/sessions/${easy.id}`).send({ date: 'soon' })).status).toBe(400)
    expect(
      (await client(ctx, other).put(`/api/plan/sessions/${easy.id}`).send({ skip: true })).status,
    ).toBe(404)
    expect(
      (
        await client(ctx, other)
          .post(`/api/plan/sessions/${easy.id}/link`)
          .send({ activityId: null })
      ).status,
    ).toBe(404)
  })
})

describe('linking sessions to activities', () => {
  test('link, assess, relink conflicts and unlink', async () => {
    const u = await seedUser(ctx, { email: 'link@example.com' })
    await seedHistory(u.id)
    const goal = await seedGoal(u.id)
    const plan = await generated(u, goal.id)
    const c = client(ctx, u)
    const [a, b] = plan.sessions.filter((s) => s.kind === 'easy')
    const run = await ctx.prisma.activity.create({
      data: {
        userId: u.id,
        date: today,
        type: 'run',
        durationSec: a!.durationMin * 60,
        distanceM: 6000,
        rpe: 3,
        source: 'manual',
      },
    })
    const strength = await ctx.prisma.activity.create({
      data: { userId: u.id, date: today, type: 'strength', durationSec: 1800, source: 'manual' },
    })

    const linked = await c.post(`/api/plan/sessions/${a!.id}/link`).send({ activityId: run.id })
    expect(linked.status, JSON.stringify(linked.body)).toBe(200)
    const session = linked.body as PlanSession
    expect(session).toMatchObject({ activityId: run.id, linkSource: 'owner' })
    expect(session.execution).not.toBeNull()
    expect(['completed', 'partial']).toContain(session.status)

    // The activity fulfils one session at a time, and a strength activity fulfils no run.
    expect(
      (await c.post(`/api/plan/sessions/${b!.id}/link`).send({ activityId: run.id })).status,
    ).toBe(409)
    expect(
      (await c.post(`/api/plan/sessions/${b!.id}/link`).send({ activityId: strength.id })).status,
    ).toBe(409)
    expect(
      (await c.post(`/api/plan/sessions/${b!.id}/link`).send({ activityId: 'nope' })).status,
    ).toBe(404)

    const unlinked = await c.post(`/api/plan/sessions/${a!.id}/link`).send({ activityId: null })
    expect(unlinked.body).toMatchObject({
      activityId: null,
      linkSource: 'owner',
      execution: null,
      status: 'planned',
    })
  })
})

describe('check-ins', () => {
  test('save partially, read back, clear and validate', async () => {
    const u = await seedUser(ctx, { email: 'checkin@example.com' })
    const c = client(ctx, u)
    expect((await c.get(`/api/checkins/${today}`)).body).toBeNull()

    const saved = await c.put(`/api/checkins/${today}`).send({ fatigue: 4, soreness: 2 })
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ date: today, fatigue: 4, soreness: 2, illness: false })
    const more = await c
      .put(`/api/checkins/${today}`)
      .send({ painScore: 5, painArea: ' left shin ', painFocalBone: true })
    expect(more.body).toMatchObject({
      fatigue: 4,
      painScore: 5,
      painArea: 'left shin',
      painFocalBone: true,
    })
    expect(((await c.get(`/api/checkins/${today}`)).body as Checkin).fatigue).toBe(4)
    const cleared = await c.put(`/api/checkins/${today}`).send({ fatigue: null })
    expect((cleared.body as Checkin).fatigue).toBeNull()

    expect((await c.put(`/api/checkins/${today}`).send({ fatigue: 6 })).status).toBe(400)
    expect((await c.put(`/api/checkins/${today}`).send({ painScore: 11 })).status).toBe(400)
    expect((await c.put(`/api/checkins/${today}`).send({ surprise: 1 })).status).toBe(400)
    expect((await c.put('/api/checkins/not-a-date').send({ fatigue: 3 })).status).toBe(400)
    // The same day of a wellness row that a provider wrote keeps its source.
    expect(
      (await ctx.prisma.wellnessDay.findFirstOrThrow({ where: { userId: u.id } })).source,
    ).toBe('manual')
  })
})

describe('check-ins: bone tenderness', () => {
  test('stays reported on later days until an explicit false is saved', async () => {
    const u = await seedUser(ctx, { email: 'bone@example.com' })
    const c = client(ctx, u)
    const earlier = addDays(today, -3)
    await c.put(`/api/checkins/${earlier}`).send({ painScore: 2, painFocalBone: true })

    // A later check-in that does not mention the bone keeps the report.
    const carried = await c.put(`/api/checkins/${today}`).send({ fatigue: 3 })
    expect(carried.body).toMatchObject({ fatigue: 3, painFocalBone: true })

    // Only an explicit false clears it, and it then stays clear.
    const cleared = await c.put(`/api/checkins/${today}`).send({ painFocalBone: false })
    expect(cleared.body).toMatchObject({ painFocalBone: false })
    const tomorrow = addDays(today, 1)
    const next = await c.put(`/api/checkins/${tomorrow}`).send({ fatigue: 3 })
    expect(next.body).toMatchObject({ painFocalBone: false })
  })

  test('is not invented when no earlier check-in reported it', async () => {
    const u = await seedUser(ctx, { email: 'bone-none@example.com' })
    const c = client(ctx, u)
    await c.put(`/api/checkins/${addDays(today, -2)}`).send({ fatigue: 3 })
    const saved = await c.put(`/api/checkins/${today}`).send({ fatigue: 4 })
    expect(saved.body).toMatchObject({ painFocalBone: false })
  })
})

describe('screenings', () => {
  test('flags count the questions answered yes, newest first', async () => {
    const u = await seedUser(ctx, { email: 'screen@example.com' })
    const c = client(ctx, u)
    expect((await c.get('/api/screenings')).body).toEqual([])
    const first = await c.post('/api/screenings').send({
      date: addDays(today, -90),
      answers: { weightLoss: true, cycle: false, fatigue: true, note: 'x' },
    })
    expect(first.status).toBe(201)
    expect((first.body as Screening).flags).toBe(2)
    const second = await c.post('/api/screenings').send({ answers: { weightLoss: false } })
    expect(second.body).toMatchObject({ date: today, flags: 0, kind: 'reds' })
    const list = (await c.get('/api/screenings')).body as Screening[]
    expect(list.map((s) => s.flags)).toEqual([0, 2])
    expect((await c.post('/api/screenings').send({})).status).toBe(400)
    expect((await c.post('/api/screenings').send({ answers: { a: { b: 1 } } })).status).toBe(400)
  })

  test('two flags put a note on the Today view and hold the weekly decision', async () => {
    const u = await seedUser(ctx, { email: 'screen-today@example.com' })
    await client(ctx, u)
      .post('/api/screenings')
      .send({ answers: { a: true, b: true } })
    const view = (await client(ctx, u).get('/api/today')).body as TodayView
    expect(view.readiness.redFlags.map((f) => f.code)).toContain('reds-screen')
  })
})

describe('research parameters', () => {
  test('GET /api/research/params lists the registry with its version', async () => {
    const res = await client(ctx, user).get('/api/research/params')
    expect(res.status).toBe(200)
    const body = res.body as ResearchParams
    expect(body.version).toMatch(/^\d{4}-\d{2}-\d{2}/)
    expect(body.params.length).toBeGreaterThan(50)
    expect(body.params[0]).toHaveProperty('grade')
  })
})

describe('predictions', () => {
  test('need a goal of the caller', async () => {
    const u = await seedUser(ctx, { email: 'pred@example.com' })
    const foreign = await seedGoal(user.id)
    const c = client(ctx, u)
    expect((await c.get('/api/predictions')).status).toBe(400)
    expect((await c.get(`/api/predictions?goalId=${foreign.id}`)).status).toBe(404)
    const goal = await seedGoal(u.id)
    const empty = await c.get(`/api/predictions?goalId=${goal.id}`)
    expect(empty.status).toBe(200)
    expect((empty.body as PredictionView).log).toEqual([])
  })

  test('the race-day climate comes from the archive when the race has a location', async () => {
    const u = await seedUser(ctx, { email: 'climate@example.com' })
    await seedHistory(u.id)
    const goal = await seedGoal(u.id)
    await ctx.prisma.goal.update({
      where: { id: goal.id },
      data: { raceLat: 40.1, raceLng: -105.2, startTime: '07:00' },
    })
    const urls: string[] = []
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input)
      urls.push(url)
      const times = Array.from({ length: 72 }, (_, i) => {
        const day = 1 + Math.floor(i / 24)
        return `2025-06-0${day}T${String(i % 24).padStart(2, '0')}:00`
      })
      return Promise.resolve(
        Response.json({
          hourly: {
            time: times,
            temperature_2m: times.map(() => 40),
            relative_humidity_2m: times.map(() => 80),
            wind_speed_10m: times.map(() => 8),
            shortwave_radiation: times.map(() => 900),
          },
        }),
      )
    })
    const plan = await generated(u, goal.id)
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every((url) => url.startsWith('https://archive-api.open-meteo.com/'))).toBe(true)
    expect(urls[0]).toContain('latitude=40.1')
    // A hot archive makes the race-day WBGT exceed the range of the penalty model.
    expect(plan.warnings.map((w) => w.code)).toContain('heat-above-model-range')
  })

  test('a failed climate request does not fail the plan', async () => {
    const u = await seedUser(ctx, { email: 'climate-fail@example.com' })
    await seedHistory(u.id)
    const goal = await seedGoal(u.id)
    await ctx.prisma.goal.update({
      where: { id: goal.id },
      data: { raceLat: 41.1, raceLng: -104.2 },
    })
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('down', { status: 503 })))
    expect((await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })).status).toBe(
      201,
    )
    // The failure is not remembered: the next plan asks the archive again.
    let asked = 0
    vi.stubGlobal('fetch', () => {
      asked += 1
      return Promise.resolve(new Response('down', { status: 503 }))
    })
    await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
    expect(asked).toBeGreaterThan(0)
  })
})
