import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type {
  LoadSettingResult,
  PlanRevisionView,
  PlanWithSessions,
  UndoResult,
} from '../../shared/types.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'
import { optionsWithSetting, readPayload } from '../../server/services/revisions.ts'
import { runsOn, s3Runs } from '../unit/engine/history-fixtures.ts'

// The load setting as a plan action (task L4b, proposal 4.3 and 4.6, ADR 0007): PUT /api/plan/load
// stores the position through the re-plan path, as one revision with the diff of the weeks it moved
// and an undo that puts the old position back with the old weeks. The runner is the synthetic one
// of appendix A of the proposal (a summer block, then sparse weeks), placed against this week's
// Monday, as in the Generate form's cases in plan.test.ts.

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

async function seedGoal(userId: string) {
  return ctx.prisma.goal.create({
    data: {
      userId,
      name: 'Test Marathon',
      priority: 'A',
      status: 'target',
      targetDate: addDays(thisMonday, 7 * 20 + 6),
      distanceM: 42_195,
    },
  })
}

/** A runner of 41 with a year of running and the block of appendix A, and an active plan at `options`. */
async function seedPlan(email: string, options?: Record<string, unknown>, birthYear = year - 41) {
  const user = await seedUser(ctx, { email })
  await client(ctx, user)
    .put('/api/profile')
    .send({ birthYear, runningSinceYear: year - 1 })
    .expect(200)
  await ctx.prisma.activity.createMany({
    data: runsOn(thisMonday, s3Runs()).map((a) => ({
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
  const goal = await seedGoal(user.id)
  const created = await client(ctx, user)
    .post('/api/plan/generate')
    .send({ goalId: goal.id, ...(options === undefined ? {} : { options }) })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  return { user, planId: (created.body as { id: string }).id }
}

const putLoad = (user: TestUser, body: unknown) =>
  client(ctx, user)
    .put('/api/plan/load')
    .send(body as object)
const readPlan = async (user: TestUser) =>
  (await client(ctx, user).get('/api/plan')).body as PlanWithSessions
const storedOptions = async (planId: string): Promise<unknown> =>
  JSON.parse(
    (await ctx.prisma.plan.findUniqueOrThrow({ where: { id: planId } })).options,
  ) as unknown
const revisionCount = (planId: string) => ctx.prisma.planRevision.count({ where: { planId } })
/** The weeks as a person reads them: Monday, running target, long run, run days. */
const weeksOf = (plan: PlanWithSessions) =>
  plan.weeks.map((w) => [w.weekStart, w.targetRunMin, w.longRunMin, w.runDays] as const)
const listed = async (user: TestUser, query = '') =>
  (await client(ctx, user).get(`/api/plan/revisions${query}`)).body as PlanRevisionView[]

describe('PUT /api/plan/load', () => {
  test('stores the position, draws the weeks ahead again and records one revision with the summary', async () => {
    const { user, planId } = await seedPlan('load-change@example.com')
    const before = await readPlan(user)
    expect(before.load).toMatchObject({ requested: 'steady', position: 'steady', held: null })
    const revisionsBefore = await revisionCount(planId)

    const res = await putLoad(user, { loadAppetite: 'standard' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { loadAppetite, revision } = res.body as LoadSettingResult
    expect(loadAppetite).toBe('standard')
    expect(revision).not.toBeNull()
    expect(revision!.reason).toBe('owner')
    expect(revision!.auto).toBe(false)
    expect(revision!.summary).toMatch(
      /^Load setting changed to Standard: weeks ahead add up to 12% while rebuilding\./,
    )
    assertCleanCopy(revision!.summary)

    // the option is stored with the plan, the same plan is kept, and the payload names the position
    expect(await storedOptions(planId)).toEqual({ loadAppetite: 'standard' })
    const after = await readPlan(user)
    expect(after.id).toBe(planId)
    expect(after.load).toEqual({
      requested: 'standard',
      position: 'standard',
      held: null,
      ageCapped: false,
    })

    // a week ahead moved where the position moves it, and the diff names the same weeks
    expect(weeksOf(after)).not.toEqual(weeksOf(before))
    expect(revision!.diff).not.toBeNull()
    expect(revision!.diff!.empty).toBe(false)
    const moved = after.weeks.filter(
      (week, index) => week.targetRunMin !== before.weeks[index]!.targetRunMin,
    )
    expect(moved.length).toBeGreaterThan(0)
    expect(moved.every((week) => week.weekStart >= thisMonday)).toBe(true)
    expect(new Set(revision!.diff!.weeks.map((line) => line.weekStart))).toEqual(
      new Set(
        after.weeks
          .filter((week, index) => weeksOf(after)[index]!.join() !== weeksOf(before)[index]!.join())
          .map((week) => week.weekStart),
      ),
    )

    // one revision, and the list shows it with its summary and an undo
    expect(await revisionCount(planId)).toBe(revisionsBefore + 1)
    const row = (await listed(user)).find((entry) => entry.id === revision!.id)
    expect(row).toMatchObject({ summary: revision!.summary, reason: 'owner' })
    expect(row!.undo.available).toBe(true)
  })

  test('keeps the other options of the plan, and Steady leaves out "while rebuilding"', async () => {
    const { user, planId } = await seedPlan('load-others@example.com', {
      recoveryCycle: '2:1',
      loadAppetite: 'upper',
    })
    const res = await putLoad(user, { loadAppetite: 'steady' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect((res.body as LoadSettingResult).revision!.summary).toMatch(
      /^Load setting changed to Steady: weeks ahead add up to 10% a week\./,
    )
    expect(await storedOptions(planId)).toEqual({ recoveryCycle: '2:1', loadAppetite: 'steady' })
    const upper = await putLoad(user, { loadAppetite: 'upper' })
    expect((upper.body as LoadSettingResult).revision!.summary).toMatch(
      /^Load setting changed to Upper band: weeks ahead add up to 14% while rebuilding\./,
    )
    expect(await storedOptions(planId)).toEqual({ recoveryCycle: '2:1', loadAppetite: 'upper' })
  })

  test('undo restores the previous option and the previous weeks', async () => {
    const { user, planId } = await seedPlan('load-undo@example.com')
    const before = await readPlan(user)
    const changed = (await putLoad(user, { loadAppetite: 'standard' })).body as LoadSettingResult
    const revisionId = changed.revision!.id
    expect(weeksOf(await readPlan(user))).not.toEqual(weeksOf(before))

    const undone = await client(ctx, user).post(`/api/plan/revisions/${revisionId}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    const { revision, target } = undone.body as UndoResult
    expect(revision.reason).toBe('undo')
    expect(revision.summary).toBe(`Undid: ${changed.revision!.summary}`)
    expect(target.undo.undoneAt).not.toBeNull()

    // the plan generated with no option stored none, and reads as Steady again, with its weeks
    expect(await storedOptions(planId)).toEqual({})
    const after = await readPlan(user)
    expect(weeksOf(after)).toEqual(weeksOf(before))
    expect(after.load).toEqual(before.load)
    expect(after.checklist.filter((item) => !item.ok)).toEqual([])
  })

  test('undo puts back a position the plan stored, other options untouched', async () => {
    const { user, planId } = await seedPlan('load-undo-stored@example.com', {
      recoveryCycle: '2:1',
      loadAppetite: 'standard',
    })
    const before = await readPlan(user)
    const changed = (await putLoad(user, { loadAppetite: 'upper' })).body as LoadSettingResult
    expect(await storedOptions(planId)).toEqual({ recoveryCycle: '2:1', loadAppetite: 'upper' })
    const undone = await client(ctx, user)
      .post(`/api/plan/revisions/${changed.revision!.id}/undo`)
      .send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(await storedOptions(planId)).toEqual({ recoveryCycle: '2:1', loadAppetite: 'standard' })
    expect(weeksOf(await readPlan(user))).toEqual(weeksOf(before))
  })

  test('the same position writes nothing, whether the plan stored it or reads it as the default', async () => {
    const { user, planId } = await seedPlan('load-same@example.com')
    const revisions = await revisionCount(planId)
    const weeks = weeksOf(await readPlan(user))

    // no stored option reads as Steady
    const steady = await putLoad(user, { loadAppetite: 'steady' })
    expect(steady.status, JSON.stringify(steady.body)).toBe(200)
    expect(steady.body).toEqual({ loadAppetite: 'steady', revision: null })
    expect(await storedOptions(planId)).toEqual({})

    // a stored position
    expect((await putLoad(user, { loadAppetite: 'standard' })).status).toBe(200)
    const after = await revisionCount(planId)
    expect(after).toBe(revisions + 1)
    const again = await putLoad(user, { loadAppetite: 'standard' })
    expect(again.status).toBe(200)
    expect(again.body).toEqual({ loadAppetite: 'standard', revision: null })
    expect(await revisionCount(planId)).toBe(after)
    expect(weeksOf(await readPlan(user))).not.toEqual(weeks)
  })

  test('refuses a value that is not a position, and writes nothing', async () => {
    const { user, planId } = await seedPlan('load-invalid@example.com')
    const revisions = await revisionCount(planId)
    const bodies: unknown[] = [
      { loadAppetite: 'extreme' },
      { loadAppetite: 'Standard' },
      { loadAppetite: '' },
      { loadAppetite: 1 },
      { loadAppetite: null },
      { loadAppetite: ['upper'] },
      {},
      { loadAppetite: 'upper', recoveryCycle: '2:1' },
    ]
    for (const body of bodies) {
      const res = await putLoad(user, body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(await storedOptions(planId)).toEqual({})
    expect(await revisionCount(planId)).toBe(revisions)
  })

  test('an anonymous request is a 401, and so is one with a body that would be refused', async () => {
    expect(
      (await client(ctx).put('/api/plan/load').send({ loadAppetite: 'standard' })).status,
    ).toBe(401)
    expect((await client(ctx).put('/api/plan/load').send({ loadAppetite: 'extreme' })).status).toBe(
      401,
    )
  })

  test('answers 404 for a runner with no active plan', async () => {
    const user = await seedUser(ctx, { email: 'load-noplan@example.com' })
    const res = await putLoad(user, { loadAppetite: 'standard' })
    expect(res.status).toBe(404)
  })

  test("never touches another runner's plan", async () => {
    const mine = await seedPlan('load-mine@example.com')
    const theirs = await seedPlan('load-theirs@example.com')
    expect((await putLoad(mine.user, { loadAppetite: 'standard' })).status).toBe(200)
    expect(await storedOptions(theirs.planId)).toEqual({})
    expect(await revisionCount(theirs.planId)).toBe(1)
  })

  test('stores a held position as requested, shows it held, and says so in the summary', async () => {
    const { user, planId } = await seedPlan('load-held@example.com')
    // a recent injury on file holds the plan at steady
    await client(ctx, user)
      .put('/api/profile')
      .send({
        injuries: [{ area: 'knee', side: null, year, month: 1, kind: 'joint', notes: null }],
      })
      .expect(200)
    // the plan is drawn again with the injury, so that the weeks below differ by the setting alone
    expect((await client(ctx, user).post('/api/plan/replan').send({})).status).toBe(200)
    const before = weeksOf(await readPlan(user))

    const res = await putLoad(user, { loadAppetite: 'standard' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { revision } = res.body as LoadSettingResult
    expect(revision!.summary).toMatch(
      /^Load setting changed to Standard\. The steady step applies for now: a recent injury is on file\./,
    )
    assertCleanCopy(revision!.summary)
    expect(await storedOptions(planId)).toEqual({ loadAppetite: 'standard' })
    const after = await readPlan(user)
    expect(after.load).toEqual({
      requested: 'standard',
      position: 'steady',
      held: 'recent-injury',
      ageCapped: false,
    })
    // held at steady, the weeks are the steady ones: nothing moved, so the revision has an empty
    // diff, which the list leaves out unless asked for, and the position still undoes
    expect(weeksOf(after)).toEqual(before)
    expect(revision!.diff!.empty).toBe(true)
    expect((await listed(user)).some((entry) => entry.id === revision!.id)).toBe(false)
    expect((await listed(user, '?include=empty')).some((entry) => entry.id === revision!.id)).toBe(
      true,
    )
    const undone = await client(ctx, user).post(`/api/plan/revisions/${revision!.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(await storedOptions(planId)).toEqual({})
  })

  test('reads Upper band as Standard from age 45, stores Upper band, and says why', async () => {
    const { user, planId } = await seedPlan('load-aged@example.com', undefined, year - 50)
    const res = await putLoad(user, { loadAppetite: 'upper' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { revision } = res.body as LoadSettingResult
    expect(revision!.summary).toBe(
      'Load setting changed to Upper band: weeks ahead add up to 12% while rebuilding. The setting is held at Standard: age 45 or over.',
    )
    assertCleanCopy(revision!.summary)
    expect(await storedOptions(planId)).toEqual({ loadAppetite: 'upper' })
    expect((await readPlan(user)).load).toEqual({
      requested: 'upper',
      position: 'standard',
      held: null,
      ageCapped: true,
    })
  })

  test('refuses an undo after the setting changed again, with the plan as it was left', async () => {
    const { user, planId } = await seedPlan('load-edited@example.com')
    const first = (await putLoad(user, { loadAppetite: 'standard' })).body as LoadSettingResult
    // another route changed the position since, as a regenerate that kept the plan's rows would
    await ctx.prisma.plan.update({
      where: { id: planId },
      data: { options: JSON.stringify({ loadAppetite: 'upper' }) },
    })
    const row = (await listed(user)).find((entry) => entry.id === first.revision!.id)
    expect(row!.undo.available).toBe(false)
    expect(row!.undo.reasons.map((reason) => reason.code)).toEqual(['edited-since'])
    const refused = await client(ctx, user)
      .post(`/api/plan/revisions/${first.revision!.id}/undo`)
      .send({})
    expect(refused.status).toBe(409)
    expect(await storedOptions(planId)).toEqual({ loadAppetite: 'upper' })
  })

  test('a second change gets its own revision, and undoing the newer one restores the older position', async () => {
    const { user, planId } = await seedPlan('load-twice@example.com')
    const a = (await putLoad(user, { loadAppetite: 'standard' })).body as LoadSettingResult
    const afterA = weeksOf(await readPlan(user))
    const b = (await putLoad(user, { loadAppetite: 'upper' })).body as LoadSettingResult
    expect(b.revision!.id).not.toBe(a.revision!.id)
    expect(await storedOptions(planId)).toEqual({ loadAppetite: 'upper' })
    const undone = await client(ctx, user)
      .post(`/api/plan/revisions/${b.revision!.id}/undo`)
      .send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(await storedOptions(planId)).toEqual({ loadAppetite: 'standard' })
    expect(weeksOf(await readPlan(user))).toEqual(afterA)
  })
})

describe('the load setting in a stored undo payload', () => {
  const none = { created: [], deleted: [], updated: [] }
  const stored = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      v: 1,
      sessions: none,
      weeks: none,
      disruptions: { created: [], updated: [] },
      ...extra,
    })

  test('is read when it names positions, with none before', () => {
    expect(
      readPayload(stored({ setting: { loadAppetite: { before: 'steady', after: 'upper' } } }))
        ?.setting,
    ).toEqual({ loadAppetite: { before: 'steady', after: 'upper' } })
    expect(
      readPayload(stored({ setting: { loadAppetite: { before: null, after: 'standard' } } }))
        ?.setting,
    ).toEqual({ loadAppetite: { before: null, after: 'standard' } })
  })

  test('is absent from a payload stored before the action, which still restores its rows', () => {
    const payload = readPayload(stored())
    expect(payload).not.toBeNull()
    expect(payload).not.toHaveProperty('setting')
  })

  test('is dropped when it is not readable, and the rows are kept', () => {
    for (const setting of [
      null,
      'standard',
      {},
      { loadAppetite: null },
      { loadAppetite: { after: 'standard' } },
      { loadAppetite: { before: 'extreme', after: 'standard' } },
      { loadAppetite: { before: 'steady', after: 'extreme' } },
    ]) {
      const payload = readPayload(stored({ setting }))
      expect(payload, JSON.stringify(setting)).not.toBeNull()
      expect(payload, JSON.stringify(setting)).not.toHaveProperty('setting')
    }
  })

  test('puts the position back, or takes it away, and leaves the other options as they are', () => {
    const text = JSON.stringify({ recoveryCycle: '2:1', loadAppetite: 'upper', gutTraining: false })
    expect(JSON.parse(optionsWithSetting(text, { before: 'standard', after: 'upper' }))).toEqual({
      recoveryCycle: '2:1',
      loadAppetite: 'standard',
      gutTraining: false,
    })
    expect(JSON.parse(optionsWithSetting(text, { before: null, after: 'upper' }))).toEqual({
      recoveryCycle: '2:1',
      gutTraining: false,
    })
    expect(JSON.parse(optionsWithSetting(null, { before: null, after: 'upper' }))).toEqual({})
  })
})
