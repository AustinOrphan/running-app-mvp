import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { renderFact } from '../../shared/copy/templates.ts'
import type { ExplainView } from '../../shared/engine/types.ts'
import type {
  MethodChangeResult,
  PlanRevisionView,
  PlanWithSessions,
  UndoResult,
} from '../../shared/types.ts'
import { parsePlanOptions } from '../../server/serialize.ts'
import { replanActivePlan } from '../../server/services/replan.ts'
import { optionsRestored, readPayload } from '../../server/services/revisions.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'
import { runsOn, s3Runs, weeks, type Run } from '../unit/engine/history-fixtures.ts'

// The method preset on a plan (task M2, rules P1 to P4, methods proposal sections 4.3 and 4.5):
// POST /api/plan/generate takes `options.method`, an unknown id is a 400 with its path, the plan
// stores it in `Plan.options` and serves what applies (`PlanWithSessions.method`), and every
// re-plan of the plan carries it. The runner is the synthetic one of appendix A of the loading
// proposal, placed against this week's Monday, as in plan-load.test.ts.

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

const today = todayIso()
const thisMonday = mondayOf(today)
const year = Number(today.slice(0, 4))
const HALF_M = 21_097
const MARATHON_M = 42_195
const WEEKS_AHEAD = 20

async function seedGoal(userId: string, distanceM: number, name: string) {
  return ctx.prisma.goal.create({
    data: {
      userId,
      name,
      priority: 'A',
      status: 'target',
      targetDate: addDays(thisMonday, 7 * WEEKS_AHEAD + 6),
      distanceM,
    },
  })
}

/** A runner of 41 with a year of running and the block of appendix A (or the runs given). */
async function seedRunner(email: string, runs: Run[] = s3Runs()) {
  const user = await seedUser(ctx, { email })
  await client(ctx, user)
    .put('/api/profile')
    .send({ birthYear: year - 41, runningSinceYear: year - 1 })
    .expect(200)
  await ctx.prisma.activity.createMany({
    data: runsOn(thisMonday, runs).map((a) => ({
      userId: user.id,
      date: a.date,
      type: 'run',
      durationSec: a.durationSec,
      movingSec: a.movingSec,
      distanceM: a.distanceM,
      rpe: 3,
      source: 'manual',
    })),
  })
  return user
}

const generate = (user: TestUser, goalId: string, options?: Record<string, unknown>) =>
  client(ctx, user)
    .post('/api/plan/generate')
    .send({ goalId, ...(options === undefined ? {} : { options }) })
const readPlan = async (user: TestUser) =>
  (await client(ctx, user).get('/api/plan')).body as PlanWithSessions
const storedOptions = async (planId: string): Promise<unknown> =>
  JSON.parse(
    (await ctx.prisma.plan.findUniqueOrThrow({ where: { id: planId } })).options,
  ) as unknown
/** The weeks as a person reads them: Monday, running target, long run, run days. */
const weeksOf = (plan: PlanWithSessions) =>
  plan.weeks.map((w) => [w.weekStart, w.targetRunMin, w.longRunMin, w.runDays] as const)
const ahead = (plan: PlanWithSessions) => plan.weeks.filter((w) => w.weekStart >= thisMonday)

const DEFAULT = { requested: 'default', effective: 'default', reason: null }

describe('POST /api/plan/generate with a method preset', () => {
  test('refuses an unknown method with a 400 that names the field', async () => {
    const user = await seedRunner('method-unknown@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    for (const method of ['shorter-long-run', 'Default', 'three_run_days', '', 3, null]) {
      const res = await generate(user, goal.id, { method })
      expect(res.status, JSON.stringify(method)).toBe(400)
      const { error } = res.body as {
        error: { code: string; details: { issues: Array<{ path: string }> } }
      }
      expect(error.code).toBe('validation')
      expect(error.details.issues.map((issue) => issue.path)).toEqual(['options.method'])
    }
    // nothing was written
    expect(await ctx.prisma.plan.count({ where: { userId: user.id } })).toBe(0)
  })

  test('reads an absent method and `default` as the same plan, both served as the default', async () => {
    const user = await seedRunner('method-default@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    const none = await generate(user, goal.id)
    expect(none.status, JSON.stringify(none.body)).toBe(201)
    const noneBody = none.body as PlanWithSessions
    expect(noneBody.method).toEqual(DEFAULT)
    expect(await storedOptions(noneBody.id)).toEqual({})

    const chosen = await generate(user, goal.id, { method: 'default' })
    expect(chosen.status, JSON.stringify(chosen.body)).toBe(201)
    const chosenBody = chosen.body as PlanWithSessions
    expect(chosenBody.method).toEqual(DEFAULT)
    expect(await storedOptions(chosenBody.id)).toEqual({ method: 'default' })
    expect(weeksOf(chosenBody)).toEqual(weeksOf(noneBody))
    expect(chosenBody.sessions.map((s) => [s.date, s.kind, s.durationMin])).toEqual(
      noneBody.sessions.map((s) => [s.date, s.kind, s.durationMin]),
    )
    expect((await readPlan(user)).method).toEqual(DEFAULT)
  })

  test('stores a preset with the plan, serves it, and plans it: three run days for a half marathon', async () => {
    const user = await seedRunner('method-p2@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    const before = await generate(user, goal.id)
    const base = before.body as PlanWithSessions
    expect(Math.max(...ahead(base).map((w) => w.runDays))).toBeGreaterThan(3)

    const res = await generate(user, goal.id, { method: 'three-run-days' })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const plan = res.body as PlanWithSessions
    expect(await storedOptions(plan.id)).toEqual({ method: 'three-run-days' })
    const method = { requested: 'three-run-days', effective: 'three-run-days', reason: null }
    expect(plan.method).toEqual(method)
    expect((await readPlan(user)).method).toEqual(method)
    expect(Math.max(...ahead(plan).map((w) => w.runDays))).toBeLessThanOrEqual(3)
    expect(plan.checklist.every((item) => item.ok)).toBe(true)
  })

  test('stores an inapplicable preset as chosen and serves it as the default, with the reason', async () => {
    const user = await seedRunner('method-marathon@example.com')
    const goal = await seedGoal(user.id, MARATHON_M, 'Test Marathon')
    const none = (await generate(user, goal.id)).body as PlanWithSessions

    const res = await generate(user, goal.id, { method: 'three-run-days' })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const plan = res.body as PlanWithSessions
    expect(await storedOptions(plan.id)).toEqual({ method: 'three-run-days' })
    const method = { requested: 'three-run-days', effective: 'default', reason: 'not-applicable' }
    expect(plan.method).toEqual(method)
    expect((await readPlan(user)).method).toEqual(method)
    // read as the default, the plan is the default's
    expect(weeksOf(plan)).toEqual(weeksOf(none))
    expect(plan.sessions.map((s) => [s.date, s.kind, s.durationMin])).toEqual(
      none.sessions.map((s) => [s.date, s.kind, s.durationMin]),
    )
  })

  test('applies longer-base to a marathon and serves it as chosen', async () => {
    const user = await seedRunner('method-p4@example.com')
    const goal = await seedGoal(user.id, MARATHON_M, 'Test Marathon')
    const none = (await generate(user, goal.id)).body as PlanWithSessions

    const res = await generate(user, goal.id, { method: 'longer-base' })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const plan = res.body as PlanWithSessions
    expect(plan.method).toEqual({
      requested: 'longer-base',
      effective: 'longer-base',
      reason: null,
    })
    const phases = (p: PlanWithSessions, phase: string) =>
      p.weeks.filter((w) => w.phase === phase).length
    expect(phases(plan, 'base')).toBeGreaterThan(phases(none, 'base'))
    expect(phases(plan, 'build')).toBeLessThan(phases(none, 'build'))
    expect(plan.checklist.every((item) => item.ok)).toBe(true)
    // no week asks for more than the default's
    plan.weeks.forEach((week, i) => {
      expect(week.targetRunMin).toBeLessThanOrEqual(none.weeks[i]!.targetRunMin)
    })
  })

  test('reads the preset as the default while a recent injury is on file, and applies it again after', async () => {
    const user = await seedRunner('method-held@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    const created = await generate(user, goal.id, { method: 'three-run-days' })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect((created.body as PlanWithSessions).method?.reason).toBeNull()

    await client(ctx, user)
      .put('/api/profile')
      .send({
        injuries: [{ area: 'knee', side: null, year, month: 1, kind: 'joint', notes: null }],
      })
      .expect(200)
    // the read follows the profile at once; the choice stays stored
    const held = await readPlan(user)
    expect(held.method).toEqual({
      requested: 'three-run-days',
      effective: 'default',
      reason: 'held:recent-injury',
    })
    expect(await storedOptions(held.id)).toEqual({ method: 'three-run-days' })

    await client(ctx, user).put('/api/profile').send({ injuries: [] }).expect(200)
    expect((await readPlan(user)).method).toEqual({
      requested: 'three-run-days',
      effective: 'three-run-days',
      reason: null,
    })
  })
})

describe('a goal switch', () => {
  const activate = (user: TestUser, goalId: string) =>
    client(ctx, user).post(`/api/goals/${goalId}/activate`).send({ replacePlan: true })

  test('carries the stored preset to the plan for the other goal, which reads it as the default for a marathon', async () => {
    const user = await seedRunner('method-switch@example.com')
    const half = await seedGoal(user.id, HALF_M, 'Test Half')
    const marathon = await seedGoal(user.id, MARATHON_M, 'Test Marathon')
    const created = await generate(user, half.id, { method: 'three-run-days' })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const halfPlan = created.body as PlanWithSessions
    expect(halfPlan.method?.effective).toBe('three-run-days')

    // the switch builds the plan for the marathon from the stored options
    const switched = await activate(user, marathon.id)
    expect(switched.status, JSON.stringify(switched.body)).toBe(200)
    const plan = await readPlan(user)
    expect(plan.id).not.toBe(halfPlan.id)
    expect(plan.goalId).toBe(marathon.id)
    expect(await storedOptions(plan.id)).toEqual({ method: 'three-run-days' })
    expect(plan.method).toEqual({
      requested: 'three-run-days',
      effective: 'default',
      reason: 'not-applicable',
    })
    const revisions = await ctx.prisma.planRevision.findMany({ where: { planId: plan.id } })
    expect(revisions.map((r) => r.reason)).toEqual(['goal-switch'])

    // and back to the half marathon: the choice is still there, and applies again
    const back = await activate(user, half.id)
    expect(back.status, JSON.stringify(back.body)).toBe(200)
    const again = await readPlan(user)
    expect(again.goalId).toBe(half.id)
    expect(await storedOptions(again.id)).toEqual({ method: 'three-run-days' })
    expect(again.method).toEqual({
      requested: 'three-run-days',
      effective: 'three-run-days',
      reason: null,
    })
    expect(Math.max(...ahead(again).map((w) => w.runDays))).toBeLessThanOrEqual(3)
  })
})

describe('the default method and no method, through the load setting and a re-plan', () => {
  /** Generate, set the load to Standard and re-plan: what the plan holds at the end. */
  async function lifecycle(email: string, options?: Record<string, unknown>) {
    const user = await seedRunner(email)
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    expect((await generate(user, goal.id, options)).status).toBe(201)
    const standard = await client(ctx, user)
      .put('/api/plan/load')
      .send({ loadAppetite: 'standard' })
    expect(standard.status, JSON.stringify(standard.body)).toBe(200)
    const replanned = await client(ctx, user).post('/api/plan/replan').send({})
    expect(replanned.status, JSON.stringify(replanned.body)).toBe(200)
    const plan = await readPlan(user)
    return {
      plan,
      weeks: weeksOf(plan),
      sessions: plan.sessions.map((s) => [s.date, s.kind, s.durationMin, s.title]),
    }
  }

  test('give the same weeks and sessions', async () => {
    const none = await lifecycle('method-life-none@example.com')
    const chosen = await lifecycle('method-life-default@example.com', { method: 'default' })
    expect(chosen.weeks).toEqual(none.weeks)
    expect(chosen.sessions).toEqual(none.sessions)
    expect(chosen.plan.method).toEqual(DEFAULT)
    expect(none.plan.method).toEqual(DEFAULT)
    expect(chosen.plan.load).toEqual(none.plan.load)
    expect(chosen.plan.checklist).toEqual(none.plan.checklist)
    expect(chosen.plan.feasibility).toEqual(none.plan.feasibility)
  })
})

describe('the Why drawer on a plan with a preset', () => {
  const runDayFacts = async (user: TestUser): Promise<string[]> => {
    const res = await client(ctx, user).get('/api/explain?subject=rules&rules=F5')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const view = res.body as ExplainView
    const facts = view.groups.find((group) => group.rule === 'F5')?.facts ?? []
    return facts.map((fact) => renderFact(fact, 'km'))
  }

  const PRESET_CAP = 'Your plan shape, Three run days a week, caps run days at 3 a week.'
  const AGE_CAP = 'From age 41 the plan keeps run days to 6 a week or fewer.'

  test('names the plan shape that sets the cap of three run days, and states the age rule at six', async () => {
    const preset = await seedRunner('method-explain-p2@example.com')
    const presetGoal = await seedGoal(preset.id, HALF_M, 'Test Half')
    expect((await generate(preset, presetGoal.id, { method: 'three-run-days' })).status).toBe(201)
    const facts = await runDayFacts(preset)
    expect(facts).toContain(PRESET_CAP)
    // the age rule keeps the plan's own cap: three is the shape's, not the runner's age
    expect(facts).toContain(AGE_CAP)

    const plain = await seedRunner('method-explain-default@example.com')
    const plainGoal = await seedGoal(plain.id, HALF_M, 'Test Half')
    expect((await generate(plain, plainGoal.id)).status).toBe(201)
    const plainFacts = await runDayFacts(plain)
    expect(plainFacts).toContain(AGE_CAP)
    expect(plainFacts).not.toContain(PRESET_CAP)

    // a preset that does not apply to the goal leaves the default's cap in the drawer, as in the plan
    const marathon = await seedRunner('method-explain-marathon@example.com')
    const marathonGoal = await seedGoal(marathon.id, MARATHON_M, 'Test Marathon')
    expect((await generate(marathon, marathonGoal.id, { method: 'three-run-days' })).status).toBe(
      201,
    )
    const marathonFacts = await runDayFacts(marathon)
    expect(marathonFacts).toContain(AGE_CAP)
    expect(marathonFacts).not.toContain(PRESET_CAP)
  })

  /** The facts of each rule of a `rules` request, worded. */
  const shapeFacts = async (user: TestUser, rules: string[]) => {
    const res = await client(ctx, user).get(`/api/explain?subject=rules&rules=${rules.join(',')}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const view = res.body as ExplainView
    return Object.fromEntries(
      rules.map((rule) => [
        rule,
        (view.groups.find((group) => group.rule === rule)?.facts ?? []).map((fact) =>
          renderFact(fact, 'km'),
        ),
      ]),
    )
  }

  test("P2 states the run days against the plan's own, from the plan the server holds", async () => {
    const user = await seedRunner('method-explain-shape-p2@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    expect((await generate(user, goal.id, { method: 'three-run-days' })).status).toBe(201)
    const facts = await shapeFacts(user, ['P1', 'P2', 'P4'])
    expect(facts['P2']).toEqual([
      'Plan shape chosen: Three run days a week.',
      "Run days: at most 3 a week (grade D), against 6 in the plan's own shape (grade D).",
      'A choice, not a better plan (grade D): no study compares these plans.',
    ])
    // the rule about the other shape says it was not chosen and states none of its figures
    expect(facts['P4']).toEqual([
      'Plan shape chosen: Three run days a week. This rule is about another shape.',
      'A choice, not a better plan (grade D): no study compares these plans.',
    ])
    expect(facts['P1']?.[0]).toBe('Plan shape chosen: Three run days a week.')
    expect(facts['P1']).toContain("The plan's own shape caps run days at 6 (grade D).")
  })

  test('P4 states the build, the base and the quality kinds', async () => {
    const user = await seedRunner('method-explain-shape-p4@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    expect((await generate(user, goal.id, { method: 'longer-base' })).status).toBe(201)
    expect((await shapeFacts(user, ['P4']))['P4']).toEqual([
      'Plan shape chosen: A longer base.',
      "Build phase: at most 4 weeks (grade D), against 6 in the plan's own shape (grade D).",
      'The base takes the difference: up to 2 more weeks before the build.',
      'Quality runs: strides only in the base, then threshold and hill runs in the build (grade D).',
      'A choice, not a better plan (grade D): no study compares these plans.',
    ])
  })

  test("says why a shape reads as the plan's own, on P1 and on its own rule", async () => {
    const user = await seedRunner('method-explain-shape-held@example.com')
    const goal = await seedGoal(user.id, MARATHON_M, 'Test Marathon')
    expect((await generate(user, goal.id, { method: 'three-run-days' })).status).toBe(201)
    const facts = await shapeFacts(user, ['P1', 'P2'])
    const READ =
      "Plan shape chosen: Three run days a week, read as the plan's own shape: not for this goal."
    expect(facts['P1']?.[0]).toBe(READ)
    // no override is stated for a shape that does not apply
    expect(facts['P2']).toEqual([
      READ,
      'A choice, not a better plan (grade D): no study compares these plans.',
    ])
  })

  test("a plan with no choice has the plan's own shape, and no plan has a gap sentence", async () => {
    const user = await seedRunner('method-explain-shape-own@example.com')
    expect((await shapeFacts(user, ['P1', 'P2']))['P1']?.[0]).toMatch(/^No plan is active/)
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    expect((await generate(user, goal.id)).status).toBe(201)
    expect((await shapeFacts(user, ['P1']))['P1']?.[0]).toBe(
      "This plan has the plan's own shape; no other shape was chosen.",
    )
  })
})

describe('the stored preset', () => {
  test('survives a re-plan and a change of the load setting, and the weeks keep its shape', async () => {
    const user = await seedRunner('method-replan@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    const created = await generate(user, goal.id, { method: 'three-run-days' })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const planId = (created.body as PlanWithSessions).id
    const method = { requested: 'three-run-days', effective: 'three-run-days', reason: null }

    const replanned = await client(ctx, user).post('/api/plan/replan').send({})
    expect(replanned.status, JSON.stringify(replanned.body)).toBe(200)
    expect(await storedOptions(planId)).toEqual({ method: 'three-run-days' })
    const afterReplan = await readPlan(user)
    expect(afterReplan.id).toBe(planId)
    expect(afterReplan.method).toEqual(method)
    expect(Math.max(...ahead(afterReplan).map((w) => w.runDays))).toBeLessThanOrEqual(3)

    // the load setting is a re-plan of the same plan: the preset rides along in the options
    const standard = await client(ctx, user)
      .put('/api/plan/load')
      .send({ loadAppetite: 'standard' })
    expect(standard.status, JSON.stringify(standard.body)).toBe(200)
    expect(await storedOptions(planId)).toEqual({
      method: 'three-run-days',
      loadAppetite: 'standard',
    })
    const afterLoad = await readPlan(user)
    expect(afterLoad.method).toEqual(method)
    expect(Math.max(...ahead(afterLoad).map((w) => w.runDays))).toBeLessThanOrEqual(3)
  })

  test('is read from the options of a stored plan, and dropped when it is not a preset', () => {
    expect(parsePlanOptions('{"method":"longer-base","recoveryCycle":"2:1"}')).toEqual({
      method: 'longer-base',
      recoveryCycle: '2:1',
    })
    expect(parsePlanOptions('{"method":"default","loadAppetite":"upper"}')).toEqual({
      method: 'default',
      loadAppetite: 'upper',
    })
    // a value that is not a preset reads as no choice, which is the default
    expect(parsePlanOptions('{"method":"shorter-long-run","recoveryCycle":"2:1"}')).toEqual({
      recoveryCycle: '2:1',
    })
    expect(parsePlanOptions('{"method":3}')).toEqual({})
    expect(parsePlanOptions('{"method":null,"loadAppetite":"extreme"}')).toEqual({})
  })
})

// The change of the preset in place (task M6, decision 8 of the methods proposal): PUT
// /api/plan/method stores the preset through the re-plan path as one revision with the diff of the
// weeks it moved and an undo that puts the old preset back with the old rows. The week the change is
// made in keeps the shape it was drawn under, so its sessions stay and the weeks after it carry the
// shape.

const putMethod = (user: TestUser, body: unknown) =>
  client(ctx, user)
    .put('/api/plan/method')
    .send(body as object)
const revisionCount = (planId: string) => ctx.prisma.planRevision.count({ where: { planId } })
const listed = async (user: TestUser, query = '') =>
  (await client(ctx, user).get(`/api/plan/revisions${query}`)).body as PlanRevisionView[]
/** The sessions of the week of `monday` as the plan holds them: what a held week keeps. */
const weekSessions = (plan: PlanWithSessions, monday: string) =>
  plan.sessions
    .filter((s) => s.weekStart === monday)
    .map((s) => [s.id, s.externalId, s.date, s.kind, s.durationMin, s.title, s.status, s.rules])
const shapeFlags = (plan: PlanWithSessions, monday: string): string[] =>
  plan.weeks.find((w) => w.weekStart === monday)!.flags.filter((f) => f.startsWith('shape-'))
/**
 * A plan of a runner who has run four times a week for twelve weeks, so that the plan opens on its
 * own weeks and not on a start programme's, drawn once more so that what a test reads is a plan a
 * re-plan leaves as it is.
 */
async function seedPlan(email: string, distanceM = HALF_M, options?: Record<string, unknown>) {
  const user = await seedRunner(email, weeks(12, 1, [50, 50, 50, 70]))
  const goal = await seedGoal(user.id, distanceM, 'Test Race')
  const created = await generate(user, goal.id, options)
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  expect((await client(ctx, user).post('/api/plan/replan').send({})).status).toBe(200)
  return { user, goal, planId: (created.body as PlanWithSessions).id }
}

describe('PUT /api/plan/method', () => {
  test('stores the preset, draws the weeks after the current one again and records one revision with the summary', async () => {
    const { user, planId } = await seedPlan('method-put@example.com')
    const before = await readPlan(user)
    expect(Math.max(...ahead(before).map((w) => w.runDays))).toBeGreaterThan(3)
    const revisionsBefore = await revisionCount(planId)

    const res = await putMethod(user, { method: 'three-run-days' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { method, revision } = res.body as MethodChangeResult
    expect(method).toBe('three-run-days')
    expect(revision).not.toBeNull()
    expect(revision!.reason).toBe('method-change')
    expect(revision!.auto).toBe(false)
    const after = await readPlan(user)
    const weeksAfter = after.weeks.filter((w) => w.weekStart > thisMonday)
    expect(revision!.summary).toBe(
      `Plan shape changed to three run days a week. ${String(weeksAfter.length)} weeks redrawn from ${
        /redrawn from (.+?)\. This week/.exec(revision!.summary)![1]!
      }. This week stays as it was drawn.`,
    )
    assertCleanCopy(revision!.summary)

    // stored as asked, served as in effect, the same plan kept
    expect(await storedOptions(planId)).toEqual({ method: 'three-run-days' })
    expect(after.id).toBe(planId)
    expect(after.method).toEqual({
      requested: 'three-run-days',
      effective: 'three-run-days',
      reason: null,
    })
    expect(after.checklist.filter((item) => !item.ok)).toEqual([])
    for (const week of weeksAfter) {
      expect(week.runDays, week.weekStart).toBeLessThanOrEqual(3)
      expect(shapeFlags(after, week.weekStart)).toEqual(['shape-three-run-days'])
      // no week plans more minutes than the plan's own
      const own = before.weeks.find((w) => w.weekStart === week.weekStart)!
      expect(week.targetRunMin, week.weekStart).toBeLessThanOrEqual(own.targetRunMin)
    }

    // the diff names the weeks after the current one and no day of the current week
    expect(revision!.diff!.empty).toBe(false)
    expect(revision!.diff!.weeks.length).toBeGreaterThan(0)
    expect(revision!.diff!.weeks.every((line) => line.weekStart > thisMonday)).toBe(true)
    expect(revision!.diff!.sessions.every((line) => line.weekStart > thisMonday)).toBe(true)
    expect(revision!.causes?.weeks[revision!.diff!.weeks[0]!.weekStart]).toEqual(['owner-edit'])

    // one revision, and the list shows it with its summary and an undo
    expect(await revisionCount(planId)).toBe(revisionsBefore + 1)
    const row = (await listed(user)).find((entry) => entry.id === revision!.id)
    expect(row).toMatchObject({ summary: revision!.summary, reason: 'method-change' })
    expect(row!.undo.available).toBe(true)
  })

  test('holds the current week: its sessions and its row stay as they were drawn', async () => {
    const { user } = await seedPlan('method-held-week@example.com')
    const before = await readPlan(user)
    const week = (plan: PlanWithSessions) => plan.weeks.find((w) => w.weekStart === thisMonday)!

    expect((await putMethod(user, { method: 'three-run-days' })).status).toBe(200)
    const after = await readPlan(user)
    expect(weekSessions(after, thisMonday)).toEqual(weekSessions(before, thisMonday))
    expect(week(after)).toEqual(week(before))
    expect(shapeFlags(after, thisMonday)).toEqual([])
    // the weeks after it are not the plan's own
    expect(weekSessions(after, addDays(thisMonday, 35))).not.toEqual(
      weekSessions(before, addDays(thisMonday, 35)),
    )
  })

  test('leaves the weeks of a start programme as they are, and starts the redrawn weeks after them', async () => {
    // the runner of appendix A opens on a start programme: its weeks are the programme's whatever the
    // shape, so none is held and the summary counts from the first week the shape reaches
    const user = await seedRunner('method-programme@example.com')
    const goal = await seedGoal(user.id, HALF_M, 'Test Half')
    expect((await generate(user, goal.id)).status).toBe(201)
    expect((await client(ctx, user).post('/api/plan/replan').send({})).status).toBe(200)
    const before = await readPlan(user)
    const programme = before.weeks.filter((w) =>
      w.flags.some((f) => /^ladder-|^restart-floor$/.test(f)),
    )
    expect(programme.length).toBeGreaterThan(0)

    const res = await putMethod(user, { method: 'three-run-days' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { revision } = res.body as MethodChangeResult
    expect(revision!.summary).toMatch(
      /^Plan shape changed to three run days a week\. \d+ weeks redrawn from .+\.$/,
    )
    const after = await readPlan(user)
    for (const week of programme) {
      expect(weekSessions(after, week.weekStart), week.weekStart).toEqual(
        weekSessions(before, week.weekStart),
      )
      expect(shapeFlags(after, week.weekStart)).toEqual([])
    }
    const first = after.weeks.find((w) => w.flags.includes('shape-three-run-days'))!
    expect(revision!.summary).toContain(
      `${String(after.weeks.filter((w) => w.weekStart >= first.weekStart).length)} weeks`,
    )
  })

  test('undo puts the previous preset, the previous weeks and the previous sessions back', async () => {
    const { user, planId } = await seedPlan('method-undo@example.com')
    const before = await readPlan(user)
    const changed = (await putMethod(user, { method: 'three-run-days' })).body as MethodChangeResult
    const revisionId = changed.revision!.id
    expect(weeksOf(await readPlan(user))).not.toEqual(weeksOf(before))

    const undone = await client(ctx, user).post(`/api/plan/revisions/${revisionId}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    const { revision, target } = undone.body as UndoResult
    expect(revision.reason).toBe('undo')
    expect(revision.summary).toBe(`Undid: ${changed.revision!.summary}`)
    expect(target.undo.undoneAt).not.toBeNull()

    // the plan generated with no preset stored none, and reads as the plan's own shape again
    expect(await storedOptions(planId)).toEqual({})
    const after = await readPlan(user)
    expect(weeksOf(after)).toEqual(weeksOf(before))
    expect(after.method).toEqual(DEFAULT)
    for (const week of after.weeks) expect(shapeFlags(after, week.weekStart)).toEqual([])
    expect(after.sessions.map((s) => [s.date, s.kind, s.durationMin, s.title])).toEqual(
      before.sessions.map((s) => [s.date, s.kind, s.durationMin, s.title]),
    )
    expect(after.checklist.filter((item) => !item.ok)).toEqual([])
  })

  test('undo puts back a preset the plan stored, other options untouched', async () => {
    const { user, planId } = await seedPlan('method-undo-stored@example.com', HALF_M, {
      method: 'longer-base',
      recoveryCycle: '2:1',
    })
    const before = await readPlan(user)
    const changed = (await putMethod(user, { method: 'three-run-days' })).body as MethodChangeResult
    expect(await storedOptions(planId)).toEqual({ method: 'three-run-days', recoveryCycle: '2:1' })
    const undone = await client(ctx, user)
      .post(`/api/plan/revisions/${changed.revision!.id}/undo`)
      .send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(await storedOptions(planId)).toEqual({ method: 'longer-base', recoveryCycle: '2:1' })
    expect(weeksOf(await readPlan(user))).toEqual(weeksOf(before))
  })

  test('the plan’s own shape is a change like another, stored as asked', async () => {
    const { user, planId } = await seedPlan('method-back@example.com', HALF_M, {
      method: 'three-run-days',
    })
    const before = await readPlan(user)
    const res = await putMethod(user, { method: 'default' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { revision } = res.body as MethodChangeResult
    expect(revision!.summary).toMatch(
      /^Plan shape changed to the plan's own shape\. \d+ weeks redrawn from .+\. This week stays as it was drawn\.$/,
    )
    expect(await storedOptions(planId)).toEqual({ method: 'default' })
    const after = await readPlan(user)
    expect(after.method).toEqual(DEFAULT)
    expect(weekSessions(after, thisMonday)).toEqual(weekSessions(before, thisMonday))
    expect(shapeFlags(after, thisMonday)).toEqual(['shape-three-run-days'])
    expect(shapeFlags(after, addDays(thisMonday, 35))).toEqual([])
    expect(Math.max(...ahead(after).map((w) => w.runDays))).toBeGreaterThan(3)
  })

  test('stores a preset the goal does not take as asked, serves it as the plan’s own shape with the reason, and says so', async () => {
    const { user, planId } = await seedPlan('method-marathon-put@example.com', MARATHON_M)
    const before = await readPlan(user)
    const res = await putMethod(user, { method: 'three-run-days' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { revision } = res.body as MethodChangeResult
    expect(revision!.summary).toBe(
      "Plan shape changed to three run days a week. The plan's own shape applies for now: not for this goal.",
    )
    assertCleanCopy(revision!.summary)
    expect(await storedOptions(planId)).toEqual({ method: 'three-run-days' })
    const after = await readPlan(user)
    expect(after.method).toEqual({
      requested: 'three-run-days',
      effective: 'default',
      reason: 'not-applicable',
    })
    // read as the plan's own shape, no week moved: the revision has an empty diff, which the list
    // leaves out unless asked for, and the preset still undoes
    expect(weeksOf(after)).toEqual(weeksOf(before))
    expect(revision!.diff!.empty).toBe(true)
    expect((await listed(user)).some((entry) => entry.id === revision!.id)).toBe(false)
    expect((await listed(user, '?include=empty')).some((entry) => entry.id === revision!.id)).toBe(
      true,
    )
    const undone = await client(ctx, user).post(`/api/plan/revisions/${revision!.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(await storedOptions(planId)).toEqual({})
  })

  test('stores a preset held by a recent injury as asked, and says so in the summary', async () => {
    const { user, planId } = await seedPlan('method-injured-put@example.com')
    await client(ctx, user)
      .put('/api/profile')
      .send({
        injuries: [{ area: 'knee', side: null, year, month: 1, kind: 'joint', notes: null }],
      })
      .expect(200)
    expect((await client(ctx, user).post('/api/plan/replan').send({})).status).toBe(200)
    const before = weeksOf(await readPlan(user))

    const res = await putMethod(user, { method: 'longer-base' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { revision } = res.body as MethodChangeResult
    expect(revision!.summary).toBe(
      "Plan shape changed to a longer base. The plan's own shape applies for now: held while a recent injury is on file.",
    )
    assertCleanCopy(revision!.summary)
    expect(await storedOptions(planId)).toEqual({ method: 'longer-base' })
    const after = await readPlan(user)
    expect(after.method).toEqual({
      requested: 'longer-base',
      effective: 'default',
      reason: 'held:recent-injury',
    })
    expect(weeksOf(after)).toEqual(before)
    expect(revision!.diff!.empty).toBe(true)
  })

  test('the same preset writes nothing, whether the plan stored it or reads it as the plan’s own shape', async () => {
    const { user, planId } = await seedPlan('method-same@example.com')
    const revisions = await revisionCount(planId)
    const weeks = weeksOf(await readPlan(user))

    // no stored preset reads as the plan's own shape
    const own = await putMethod(user, { method: 'default' })
    expect(own.status, JSON.stringify(own.body)).toBe(200)
    expect(own.body).toEqual({ method: 'default', revision: null })
    expect(await storedOptions(planId)).toEqual({})

    // a stored preset
    expect((await putMethod(user, { method: 'three-run-days' })).status).toBe(200)
    const after = await revisionCount(planId)
    expect(after).toBe(revisions + 1)
    const again = await putMethod(user, { method: 'three-run-days' })
    expect(again.status).toBe(200)
    expect(again.body).toEqual({ method: 'three-run-days', revision: null })
    expect(await revisionCount(planId)).toBe(after)
    expect(weeksOf(await readPlan(user))).not.toEqual(weeks)
  })

  test('refuses a value that is not a preset, and writes nothing', async () => {
    const { user, planId } = await seedPlan('method-invalid@example.com')
    const revisions = await revisionCount(planId)
    const bodies: unknown[] = [
      { method: 'shorter-long-run' },
      { method: 'Three-Run-Days' },
      { method: 'three_run_days' },
      { method: '' },
      { method: 3 },
      { method: null },
      { method: ['longer-base'] },
      {},
      { method: 'longer-base', loadAppetite: 'standard' },
    ]
    for (const body of bodies) {
      const res = await putMethod(user, body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((res.body as { error: { code: string } }).error.code).toBe('validation')
    }
    expect(await storedOptions(planId)).toEqual({})
    expect(await revisionCount(planId)).toBe(revisions)
  })

  test('an anonymous request is a 401, and so is one with a body that would be refused', async () => {
    expect((await client(ctx).put('/api/plan/method').send({ method: 'longer-base' })).status).toBe(
      401,
    )
    expect((await client(ctx).put('/api/plan/method').send({ method: 'nonsense' })).status).toBe(
      401,
    )
  })

  test('answers 404 for a runner with no active plan', async () => {
    const user = await seedUser(ctx, { email: 'method-noplan@example.com' })
    expect((await putMethod(user, { method: 'longer-base' })).status).toBe(404)
  })

  test("never touches another runner's plan", async () => {
    const mine = await seedPlan('method-mine@example.com')
    const theirs = await seedPlan('method-theirs@example.com')
    expect((await putMethod(mine.user, { method: 'three-run-days' })).status).toBe(200)
    expect(await storedOptions(theirs.planId)).toEqual({})
    // the plan's own two: generated, and drawn once more
    expect(await revisionCount(theirs.planId)).toBe(2)
  })

  test('refuses an undo after the preset changed again, with the plan as it was left', async () => {
    const { user, planId } = await seedPlan('method-edited@example.com')
    const first = (await putMethod(user, { method: 'three-run-days' })).body as MethodChangeResult
    // another route changed the preset since, as a regenerate that kept the plan's rows would
    await ctx.prisma.plan.update({
      where: { id: planId },
      data: { options: JSON.stringify({ method: 'longer-base' }) },
    })
    const row = (await listed(user)).find((entry) => entry.id === first.revision!.id)
    expect(row!.undo.available).toBe(false)
    expect(row!.undo.reasons.map((reason) => reason.code)).toEqual(['edited-since'])
    const refused = await client(ctx, user)
      .post(`/api/plan/revisions/${first.revision!.id}/undo`)
      .send({})
    expect(refused.status).toBe(409)
    expect(await storedOptions(planId)).toEqual({ method: 'longer-base' })
  })

  test('a second change gets its own revision, and undoing the newer one restores the older preset', async () => {
    const { user, planId } = await seedPlan('method-twice@example.com')
    const a = (await putMethod(user, { method: 'three-run-days' })).body as MethodChangeResult
    const afterA = weeksOf(await readPlan(user))
    const b = (await putMethod(user, { method: 'longer-base' })).body as MethodChangeResult
    expect(b.revision!.id).not.toBe(a.revision!.id)
    expect(await storedOptions(planId)).toEqual({ method: 'longer-base' })
    const undone = await client(ctx, user)
      .post(`/api/plan/revisions/${b.revision!.id}/undo`)
      .send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(await storedOptions(planId)).toEqual({ method: 'three-run-days' })
    expect(weeksOf(await readPlan(user))).toEqual(afterA)
  })

  test('keeps the load setting of the plan, and a change of the load setting keeps the preset', async () => {
    const { user, planId } = await seedPlan('method-load@example.com', HALF_M, {
      loadAppetite: 'standard',
    })
    expect((await putMethod(user, { method: 'three-run-days' })).status).toBe(200)
    expect(await storedOptions(planId)).toEqual({
      method: 'three-run-days',
      loadAppetite: 'standard',
    })
    const load = await client(ctx, user).put('/api/plan/load').send({ loadAppetite: 'upper' })
    expect(load.status, JSON.stringify(load.body)).toBe(200)
    expect(await storedOptions(planId)).toEqual({ method: 'three-run-days', loadAppetite: 'upper' })
    expect((await readPlan(user)).method?.effective).toBe('three-run-days')
  })
})

describe('the preset in a stored undo payload', () => {
  const none = { created: [], deleted: [], updated: [] }
  const stored = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      v: 1,
      sessions: none,
      weeks: none,
      disruptions: { created: [], updated: [] },
      ...extra,
    })

  test('is read when it names presets, with none before', () => {
    expect(
      readPayload(stored({ setting: { method: { before: 'longer-base', after: 'default' } } }))
        ?.setting,
    ).toEqual({ method: { before: 'longer-base', after: 'default' } })
    expect(
      readPayload(stored({ setting: { method: { before: null, after: 'three-run-days' } } }))
        ?.setting,
    ).toEqual({ method: { before: null, after: 'three-run-days' } })
  })

  test('is read beside the load setting, and each is dropped on its own when unreadable', () => {
    expect(
      readPayload(
        stored({
          setting: {
            loadAppetite: { before: null, after: 'standard' },
            method: { before: null, after: 'longer-base' },
          },
        }),
      )?.setting,
    ).toEqual({
      loadAppetite: { before: null, after: 'standard' },
      method: { before: null, after: 'longer-base' },
    })
    expect(
      readPayload(
        stored({
          setting: {
            loadAppetite: { before: null, after: 'standard' },
            method: { before: 'shorter-long-run', after: 'longer-base' },
          },
        }),
      )?.setting,
    ).toEqual({ loadAppetite: { before: null, after: 'standard' } })
    expect(
      readPayload(stored({ setting: { method: { before: null, after: 'shorter-long-run' } } }))
        ?.setting,
    ).toBeUndefined()
  })

  test('puts the preset back or takes it away, and leaves the other options as they are', () => {
    const text = JSON.stringify({
      recoveryCycle: '2:1',
      method: 'longer-base',
      loadAppetite: 'standard',
    })
    const back = { method: { before: 'three-run-days', after: 'longer-base' } } as const
    expect(JSON.parse(optionsRestored(text, back)) as unknown).toEqual({
      recoveryCycle: '2:1',
      method: 'three-run-days',
      loadAppetite: 'standard',
    })
    const away = { method: { before: null, after: 'longer-base' } } as const
    expect(JSON.parse(optionsRestored(text, away)) as unknown).toEqual({
      recoveryCycle: '2:1',
      loadAppetite: 'standard',
    })
    // both at once, as one revision that changed both would record them
    const both = {
      loadAppetite: { before: null, after: 'standard' },
      method: { before: null, after: 'longer-base' },
    } as const
    expect(JSON.parse(optionsRestored(text, both)) as unknown).toEqual({ recoveryCycle: '2:1' })
    expect(JSON.parse(optionsRestored(null, back)) as unknown).toEqual({ method: 'three-run-days' })
  })
})

describe('a hold that starts and ends between two weekly re-plans [follow-up 27]', () => {
  // The weekly re-plan reads the shape that applies: a persistent hold (a recent injury) returns the
  // plan to its own shape at once, and when the hold ends the current week keeps the shape it was
  // drawn under and the shape comes back with the week after it. Each says so in the summary of the
  // re-plan that reads it. The runs of each week are on file as the plan had them.
  const RUN_KINDS = ['easy', 'long', 'threshold', 'intervals', 'race-pace', 'recovery', 'hills']

  /** The runs of the sessions the plan holds before `monday`, as the runner logged them. */
  async function logRuns(userId: string, planId: string, monday: string) {
    const sessions = await ctx.prisma.planSession.findMany({
      where: { planId, date: { lt: monday }, kind: { in: RUN_KINDS } },
    })
    const have = new Set(
      (await ctx.prisma.activity.findMany({ where: { userId }, select: { date: true } })).map(
        (a) => a.date,
      ),
    )
    await ctx.prisma.activity.createMany({
      data: sessions
        .filter((s) => !have.has(s.date))
        .map((s) => ({
          userId,
          date: s.date,
          type: 'run',
          durationSec: s.durationMin * 60,
          movingSec: s.durationMin * 60,
          distanceM: s.durationMin * 170,
          rpe: 3,
          source: 'manual',
        })),
    })
  }

  test('says so on the re-plan that reads the hold, and again on the one that reads its end', async () => {
    const { user, planId } = await seedPlan('method-guard@example.com', HALF_M, {
      method: 'three-run-days',
    })
    const next = addDays(thisMonday, 7)
    const after = addDays(thisMonday, 14)

    // an injury arrives in the middle of the week; the weekly re-plan on Monday reads it
    await client(ctx, user)
      .put('/api/profile')
      .send({
        injuries: [{ area: 'knee', side: null, year, month: 1, kind: 'joint', notes: null }],
      })
      .expect(200)
    await logRuns(user.id, planId, next)
    const started = await replanActivePlan(ctx, { userId: user.id, reason: 'weekly', today: next })
    expect(started.auto).toBe(true)
    expect(started.summary).toContain(
      "The plan's shape returned to its own: held while a recent injury is on file.",
    )
    assertCleanCopy(started.summary)
    const held = await readPlan(user)
    expect(held.method).toMatchObject({ effective: 'default', reason: 'held:recent-injury' })
    for (const week of held.weeks.filter((w) => w.weekStart >= next)) {
      expect(shapeFlags(held, week.weekStart), week.weekStart).toEqual([])
    }

    // the hold lasts: the next weekly re-plan has nothing to say about the shape
    await logRuns(user.id, planId, after)
    const lasting = await replanActivePlan(ctx, { userId: user.id, reason: 'weekly', today: after })
    expect(lasting.summary).not.toContain('plan shape')
    expect(lasting.summary).not.toContain("plan's shape")

    // the injury is cleared; the weekly re-plan after it holds the current week and brings the
    // shape back with the week after it
    await client(ctx, user).put('/api/profile').send({ injuries: [] }).expect(200)
    const third = addDays(thisMonday, 21)
    await logRuns(user.id, planId, third)
    const ended = await replanActivePlan(ctx, { userId: user.id, reason: 'weekly', today: third })
    expect(ended.summary).toMatch(
      /The plan shape is three run days a week again from .+\. This week stays as it was drawn\./,
    )
    assertCleanCopy(ended.summary)
    const back = await readPlan(user)
    expect(back.method).toEqual({
      requested: 'three-run-days',
      effective: 'three-run-days',
      reason: null,
    })
    expect(shapeFlags(back, third)).toEqual([])
    for (const week of back.weeks.filter((w) => w.weekStart > third)) {
      expect(shapeFlags(back, week.weekStart), week.weekStart).toEqual(['shape-three-run-days'])
      expect(week.runDays, week.weekStart).toBeLessThanOrEqual(3)
    }

    // and the weekly re-plan after that one finds the shape unchanged
    await logRuns(user.id, planId, addDays(thisMonday, 28))
    const settled = await replanActivePlan(ctx, {
      userId: user.id,
      reason: 'weekly',
      today: addDays(thisMonday, 28),
    })
    expect(settled.summary).not.toContain('plan shape')
    expect(settled.summary).not.toContain("plan's shape")
  })
})
