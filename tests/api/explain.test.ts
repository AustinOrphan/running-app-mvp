import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { lintText } from '../../shared/copy/lint.ts'
import { renderFact } from '../../shared/copy/templates.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { weeklyDecision } from '../../shared/engine/adapt.ts'
import { explainInputs } from '../../shared/engine/explainInputs.ts'
import { fitHrModel } from '../../shared/engine/execution.ts'
import { VOLUME_KINDS } from '../../shared/engine/limits.ts'
import { resolveTargets } from '../../shared/engine/targets.ts'
import type { ExplainView, InputFact, Quantity } from '../../shared/engine/types.ts'
import type { PlanWithSessions, PredictionView } from '../../shared/types.ts'
import { cacheSizes } from '../../server/services/athleteState.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// The heart-rate model, the weekly decision and the Explain builder are counted, not replaced: the
// real functions run.
vi.mock('../../shared/engine/explainInputs.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/engine/explainInputs.ts')>()
  return { ...actual, explainInputs: vi.fn(actual.explainInputs) }
})
vi.mock('../../shared/engine/execution.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/engine/execution.ts')>()
  return { ...actual, fitHrModel: vi.fn(actual.fitHrModel) }
})
vi.mock('../../shared/engine/adapt.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/engine/adapt.ts')>()
  return { ...actual, weeklyDecision: vi.fn(actual.weeklyDecision) }
})

// A Wednesday at noon. Only Date is faked; timers and promises keep working.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 21, 12))
const today = todayIso()
const thisMonday = mondayOf(today)

let ctx: TestCtx
let user: TestUser

beforeEach(async () => {
  vi.setSystemTime(new Date(2026, 9, 21, 12))
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterEach(async () => {
  await ctx.close()
})

/** Twelve completed weeks of four runs and a race a month ago, so the engine has a history. */
async function seedHistory(userId: string, longM = 11_000): Promise<void> {
  const week = [
    { dow: 1, min: 40, distanceM: 6400 },
    { dow: 3, min: 45, distanceM: 7200 },
    { dow: 5, min: 35, distanceM: 5600 },
    { dow: 6, min: 70, distanceM: longM },
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
  rows.push({
    userId,
    date: addDays(today, -30),
    type: 'race',
    durationSec: 3300,
    movingSec: 3300,
    distanceM: 10_000,
    rpe: 9,
    source: 'manual',
  })
  await ctx.prisma.activity.createMany({ data: rows })
}

async function seedGoal(userId: string) {
  return ctx.prisma.goal.create({
    data: {
      userId,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 14 + 5),
      distanceM: 21_097,
      goalType: 'finish',
      isActive: false,
    },
  })
}

async function generatePlan(forUser: TestUser, goalId: string): Promise<PlanWithSessions> {
  const res = await client(ctx, forUser).post('/api/plan/generate').send({ goalId })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  const stored = await client(ctx, forUser).get('/api/plan')
  expect(stored.status).toBe(200)
  return stored.body as PlanWithSessions
}

function explain(query: string, as: TestUser | null = user) {
  return client(ctx, as ?? undefined).get(`/api/explain?${query}`)
}

async function explained(query: string): Promise<ExplainView> {
  const res = await explain(query)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as ExplainView
}

const factsOf = (view: ExplainView, rule: string): InputFact[] =>
  view.groups.find((g) => g.rule === rule)?.facts ?? []

const slot = (fact: InputFact, name: string) => fact.slots[name] as Quantity

describe('GET /api/explain: the request', () => {
  test('needs a session, and checks it before it reads the query', async () => {
    const anonymous = await explain('subject=nonsense', null)
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toMatchObject({ error: { code: 'unauthorized' } })
  })

  test.each([
    ['no subject', ''],
    ['an unknown subject', 'subject=bogus'],
    ['a session without an id', 'subject=session'],
    ['a parameter that belongs to another subject', 'subject=session&id=x&weekStart=2026-10-19'],
    ['a parameter on a subject with none', 'subject=readiness&id=1'],
    ['a week that is not a date', 'subject=week&weekStart=soon'],
    ['an impossible date', 'subject=decision&weekStart=2026-02-31'],
    ['an unknown zone boundary', 'subject=zone&boundary=pace'],
    ['a prediction without a goal', 'subject=prediction'],
    ['rules without a list', 'subject=rules'],
    ['an empty list of rules', 'subject=rules&rules='],
    ['a rule id with other characters', 'subject=rules&rules=g-1,%3Bdrop'],
    [
      'too many rules',
      'subject=rules&rules=' + Array.from({ length: 13 }, (_, i) => `H${i + 1}`).join(','),
    ],
    ['a repeated rules parameter', 'subject=rules&rules=g-1&rules=g-2'],
  ])('answers 400 for %s', async (_name, query) => {
    const res = await explain(query)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'validation' } })
  })

  test('accepts twelve rules, and a date that is not a Monday snaps to its week', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `H${i + 1}`).join(',')
    const rules = await explained(`subject=rules&rules=${twelve}`)
    expect(rules.rules).toHaveLength(12)
    await seedHistory(user.id)
    const goal = await seedGoal(user.id)
    const plan = await generatePlan(user, goal.id)
    const midweek = addDays(plan.weeks[1]!.weekStart, 3)
    const view = await explained(`subject=week&weekStart=${midweek}`)
    expect(view.subject).toBe('week')
    expect(factsOf(view, 'g-2')[2]).toMatchObject({ template: 'explain.g2-plan-week' })
    expect(slot(factsOf(view, 'g-2')[2]!, 'week')).toMatchObject({ iso: plan.weeks[1]!.weekStart })
  })
})

describe('GET /api/explain: whose records', () => {
  test('answers 404 for a session, a goal or a week the user does not have', async () => {
    await seedHistory(user.id)
    const goal = await seedGoal(user.id)
    const plan = await generatePlan(user, goal.id)
    const other = await seedUser(ctx, { email: 'other@example.com' })
    const sessionId = plan.sessions[0]!.id

    expect((await explain(`subject=session&id=${sessionId}`)).status).toBe(200)
    for (const query of [
      `subject=session&id=${sessionId}`,
      `subject=prediction&goalId=${goal.id}`,
      `subject=week&weekStart=${plan.weeks[0]!.weekStart}`,
      `subject=decision&weekStart=${plan.weeks[0]!.weekStart}`,
    ]) {
      const res = await explain(query, other)
      expect(res.status, query).toBe(404)
      expect(res.body, query).toMatchObject({ error: { code: 'not_found' } })
    }
  })

  test('answers 404 for an unknown session, an unknown goal and a week outside the plan', async () => {
    await seedHistory(user.id)
    const goal = await seedGoal(user.id)
    await generatePlan(user, goal.id)
    for (const query of [
      'subject=session&id=nope',
      'subject=prediction&goalId=nope',
      `subject=week&weekStart=${addDays(thisMonday, -70)}`,
      `subject=decision&weekStart=${addDays(thisMonday, 7 * 40)}`,
    ]) {
      expect((await explain(query)).status, query).toBe(404)
    }
  })

  test('answers 404 without a plan, for a session or a week', async () => {
    await seedHistory(user.id)
    expect((await explain('subject=session&id=x')).status).toBe(404)
    expect((await explain(`subject=week&weekStart=${thisMonday}`)).status).toBe(404)
  })

  test('answers 404 for a brief or a run until their stored figures exist', async () => {
    const run = await ctx.prisma.activity.create({
      data: { userId: user.id, date: addDays(today, -1), type: 'run', durationSec: 1800 },
    })
    const brief = await explain(`subject=brief&weekStart=${thisMonday}`)
    expect(brief.status).toBe(404)
    expect(brief.body).toMatchObject({ error: { code: 'not_found' } })
    expect((await explain(`subject=activity&id=${run.id}`)).status).toBe(404)
  })

  test('reads each user’s own numbers', async () => {
    await seedHistory(user.id, 11_000)
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await seedHistory(other.id, 15_000)
    const mine = await explained('subject=rules&rules=A3')
    const theirs = JSON.parse(
      JSON.stringify((await explain('subject=rules&rules=A3', other)).body),
    ) as ExplainView
    expect(slot(factsOf(mine, 'A3')[0]!, 'distance')).toEqual({ kind: 'distance', m: 11_000 })
    expect(slot(factsOf(theirs, 'A3')[0]!, 'distance')).toEqual({ kind: 'distance', m: 15_000 })
    for (const fact of factsOf(theirs, 'A3')) {
      const ids = fact.sources.map((s) => s.id)
      const owned = await ctx.prisma.activity.findMany({ where: { id: { in: ids } } })
      expect(owned.every((a) => a.userId === other.id)).toBe(true)
    }
  })
})

describe('GET /api/explain: the answer', () => {
  test('a session gives the longest run, the week and the zones, with linked sources', async () => {
    await seedHistory(user.id)
    const goal = await seedGoal(user.id)
    const plan = await generatePlan(user, goal.id)
    const session = plan.sessions.find((s) => s.kind === 'long')!
    const view = await explained(`subject=session&id=${session.id}`)

    expect(view).toMatchObject({ subject: 'session', asOf: today, frozen: false })
    expect(view.rules.slice(0, 4)).toEqual(['g-1', 'g-2', 'C1', 'C2'])
    expect(view.groups.map((g) => g.rule)).toEqual(['g-1', 'g-2', 'C1', 'C2'])
    expect(view.rest).toEqual(expect.arrayContaining(['F-lib']))

    const [distance] = factsOf(view, 'g-1')
    expect(distance!.template).toBe('explain.longest-distance')
    expect(slot(distance!, 'distance')).toEqual({ kind: 'distance', m: 11_000 })
    const source = distance!.sources[0]!
    const row = await ctx.prisma.activity.findUnique({ where: { id: source.id } })
    expect(row).toMatchObject({ userId: user.id, distanceM: 11_000 })
    expect(source).toMatchObject({ kind: 'activity', date: row!.date, distanceM: 11_000 })
    expect(factsOf(view, 'g-1').map((f) => f.id)).toEqual(
      expect.arrayContaining(['g-1.warn', 'g-1.override', 'g-1.session']),
    )
  })

  test('is data: metric quantities and template ids, and every fact reads in both units', async () => {
    await seedHistory(user.id)
    const goal = await seedGoal(user.id)
    const plan = await generatePlan(user, goal.id)
    const view = await explained(`subject=session&id=${plan.sessions[0]!.id}`)
    const facts = view.groups.flatMap((g) => g.facts)
    expect(facts.length).toBeGreaterThan(5)
    for (const fact of facts) {
      for (const units of ['km', 'mi'] as const) {
        const sentence = renderFact(fact, units)
        expect(lintText(sentence), sentence).toEqual([])
        expect(sentence).not.toMatch(/\d{4}-\d{2}-\d{2}|NaN|undefined/)
      }
    }
    // the body carries no sentence: values are numbers, ISO dates and short words
    const body = JSON.stringify(view)
    expect(body).not.toMatch(/\d(\.\d+)? ?(km|mi|bpm|min|ft)\b/)
  })

  test('the targets are the ones the plan page and the watch read', async () => {
    await seedHistory(user.id)
    const goal = await seedGoal(user.id)
    const plan = await generatePlan(user, goal.id)
    const first = plan.sessions.filter((s) => s.date >= plan.weeks[1]!.weekStart).slice(0, 14)
    expect(first.some((s) => VOLUME_KINDS.has(s.kind))).toBe(true)
    for (const session of first.filter((s) => VOLUME_KINDS.has(s.kind))) {
      const view = await explained(`subject=session&id=${session.id}`)
      const target = factsOf(view, 'C1').find((f) => f.id === 'c1.target')!
      const t = resolveTargets(session, plan.zones, { hot: false })
      if (t.mode === 'hr-ceiling')
        expect(slot(target, 'bpm')).toEqual({ kind: 'bpm', bpm: t.hrCeiling })
      else if (t.mode === 'hr-band') {
        expect(slot(target, 'low')).toEqual({ kind: 'bpm', bpm: t.hrRange![0] })
        expect(slot(target, 'high')).toEqual({ kind: 'bpm', bpm: t.hrRange![1] })
      } else if (t.mode === 'pace') {
        expect(slot(target, 'slow')).toEqual({ kind: 'pace', secPerKm: t.paceSecPerKm![0] })
      } else expect(slot(target, 'low')).toEqual({ kind: 'count', n: t.rpe[0] })
    }
  })

  test('week, readiness, zone and rules subjects answer with the rules they name', async () => {
    await seedHistory(user.id)
    const goal = await seedGoal(user.id)
    const plan = await generatePlan(user, goal.id)
    const week = await explained(`subject=week&weekStart=${plan.weeks[1]!.weekStart}`)
    expect(week.rules).toEqual(['g-2', 'g-6', 'J5'])
    expect(factsOf(week, 'g-2').map((f) => f.template)).toEqual([
      'explain.g2-last-week',
      'explain.g2-ramp',
      'explain.g2-plan-week',
    ])
    const readiness = await explained('subject=readiness')
    expect(readiness.rules).toEqual(['J2', 'J3', 'J4'])
    expect(factsOf(readiness, 'J2')[0]!.state).toBe('insufficient')
    const zones = await explained('subject=zone&boundary=hrMax')
    expect(zones.rules).toEqual(['C2', 'C3'])
    expect(factsOf(zones, 'C3')[0]!.template).toMatch(/^explain\.c3-/)
    const some = await explained('subject=rules&rules=zz-9,H4,G-6,g-6')
    expect(some.rules).toEqual(['zz-9', 'H4', 'G-6'])
    expect(some.rest).toEqual(['zz-9', 'H4'])
    expect(some.groups.map((g) => g.rule)).toEqual(['G-6'])
  })

  test('a check-in and an HRV series show up as dated sources', async () => {
    await seedHistory(user.id)
    await ctx.prisma.wellnessDay.createMany({
      data: Array.from({ length: 14 }, (_, i) => ({
        userId: user.id,
        date: addDays(today, -i),
        source: 'manual',
        hrvRmssd: 55 + (i % 5),
        ...(i < 4 ? { fatigue: 3, soreness: 3, mood: 3, stress: 3, sleepQuality: 3 } : {}),
      })),
    })
    const view = await explained('subject=readiness')
    const [count] = factsOf(view, 'J2')
    expect(slot(count!, 'n')).toEqual({ kind: 'count', n: 4 })
    expect(count!.sources.map((s) => s.date)).toEqual([0, 1, 2, 3].map((i) => addDays(today, -i)))
    expect(factsOf(view, 'J4')[0]!.template).toBe('today.signal.hrv')
    expect(factsOf(view, 'J4')[0]!.sources[0]).toMatchObject({ kind: 'wellness', date: today })
  })

  test('the prediction subject gives the numbers the predictions route gives', async () => {
    await seedHistory(user.id)
    const goal = await seedGoal(user.id)
    await generatePlan(user, goal.id)
    const view = await explained(`subject=prediction&goalId=${goal.id}`)
    const prediction = (
      (await client(ctx, user).get(`/api/predictions?goalId=${goal.id}`)).body as PredictionView
    ).prediction!
    const [range] = factsOf(view, 'L6')
    expect(slot(range!, 'predicted')).toEqual({ kind: 'duration', sec: prediction.predictedSec })
    expect(slot(range!, 'low')).toEqual({ kind: 'duration', sec: prediction.lowSec })
    expect(slot(range!, 'high')).toEqual({ kind: 'duration', sec: prediction.highSec })
    expect(factsOf(view, 'L1').map((f) => f.template)).toEqual([
      'explain.l1-basis',
      'explain.l1-anchor',
    ])
  })
})

describe('GET /api/explain: one fit per data version', () => {
  test('the heart-rate model is fitted once for any number of requests on one version', async () => {
    await seedHistory(user.id)
    vi.mocked(fitHrModel).mockClear()
    const first = await explained('subject=rules&rules=A8')
    await explained('subject=rules&rules=A8')
    await explained('subject=rules&rules=A8,C1')
    expect(factsOf(first, 'A8').length).toBeGreaterThan(0)
    expect(fitHrModel).toHaveBeenCalledTimes(1)
    // requests that do not read the model never fit it
    await explained('subject=rules&rules=g-1')
    expect(fitHrModel).toHaveBeenCalledTimes(1)

    // a write is a new version: the next request fits again, once
    await ctx.prisma.activity.create({
      data: { userId: user.id, date: addDays(today, -1), type: 'run', durationSec: 1800 },
    })
    await explained('subject=rules&rules=A8')
    await explained('subject=rules&rules=A8,C1')
    expect(fitHrModel).toHaveBeenCalledTimes(2)
  })

  test('the weekly decision is computed once per week and version', async () => {
    await seedHistory(user.id)
    const goal = await seedGoal(user.id)
    const plan = await generatePlan(user, goal.id)
    const [first, second] = plan.weeks
    vi.mocked(weeklyDecision).mockClear()

    const a = await explained(`subject=decision&weekStart=${first!.weekStart}`)
    await explained(`subject=week&weekStart=${second!.weekStart}`)
    await explained(`subject=decision&weekStart=${first!.weekStart}`)
    expect(weeklyDecision).toHaveBeenCalledTimes(1)
    const [decision] = factsOf(a, 'J5')
    expect(decision!.template).toMatch(/^explain\.j5-(progress|hold|reduce)$/)
    expect(slot(decision!, 'week')).toMatchObject({ iso: first!.weekStart })

    await explained(`subject=decision&weekStart=${second!.weekStart}`)
    expect(weeklyDecision).toHaveBeenCalledTimes(2)
  })

  test('a repeated request is served from the memo, and a write or a new day rebuilds it', async () => {
    await seedHistory(user.id, 11_000)
    const query = 'subject=rules&rules=A3,g-1'
    vi.mocked(explainInputs).mockClear()
    const first = await explained(query)
    // the first request builds the view and stores it; the repeat builds nothing
    expect(explainInputs).toHaveBeenCalledTimes(1)
    expect(cacheSizes(ctx.prisma).memos).toBeGreaterThan(0)
    const again = await explained(query)
    expect(again).toEqual(first)
    expect(explainInputs).toHaveBeenCalledTimes(1)

    await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        date: addDays(today, -1),
        type: 'run',
        durationSec: 7200,
        distanceM: 20_000,
      },
    })
    const longer = await explained(query)
    expect(slot(factsOf(longer, 'A3')[0]!, 'distance')).toEqual({ kind: 'distance', m: 20_000 })
    expect(explainInputs).toHaveBeenCalledTimes(2)
    await explained(query)
    expect(explainInputs).toHaveBeenCalledTimes(2)

    vi.setSystemTime(new Date(2026, 9, 22, 9))
    const nextDay = await explained(query)
    expect(nextDay.asOf).toBe('2026-10-22')
    expect(explainInputs).toHaveBeenCalledTimes(3)
  })
})

describe('the explain service', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

  test('reads the snapshot and its memos, with no second gather and no history query', () => {
    const service = read('server/services/explain.ts')
    const route = read('server/routes/explain.ts')
    for (const source of [service, route]) {
      expect(source).not.toMatch(/gatherEngineInput|gatherContextInput|currentGoalFor/)
      expect(source).not.toMatch(/loadActivities|loadActivityCores|loadProfile/)
      expect(source).not.toMatch(/prisma\.(activity|wellnessDay|weeklyReview|screening|goal)\b/)
      expect(source).not.toMatch(/\$queryRaw|\$executeRaw/)
    }
    expect(service).toMatch(/loadAthleteContext/)
    expect(service).toMatch(/memoByVersion/)
  })

  test('builds one snapshot for requests on every subject', async () => {
    await seedHistory(user.id)
    const goal = await seedGoal(user.id)
    const plan = await generatePlan(user, goal.id)
    const sessionId = plan.sessions[0]!.id
    // A write makes a new data version, so the first request below builds the snapshot. It reads
    // the history once; a rebuild by any later request would query it again.
    await ctx.prisma.activity.create({
      data: { userId: user.id, date: addDays(today, -1), type: 'run', durationSec: 1800 },
    })
    const findMany = vi.spyOn(ctx.prisma.activity, 'findMany')
    for (const query of [
      `subject=session&id=${sessionId}`,
      `subject=week&weekStart=${plan.weeks[1]!.weekStart}`,
      `subject=decision&weekStart=${plan.weeks[0]!.weekStart}`,
      'subject=readiness',
      'subject=zone',
      `subject=prediction&goalId=${goal.id}`,
      'subject=rules&rules=A8,J5,L1',
    ]) {
      expect((await explain(query)).status, query).toBe(200)
    }
    expect(cacheSizes(ctx.prisma).snapshots).toBe(1)
    expect(findMany).toHaveBeenCalledTimes(1)
  })
})
