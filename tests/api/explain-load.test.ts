import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { renderFact } from '../../shared/copy/templates.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { VOLUME_KINDS } from '../../shared/engine/limits.ts'
import type { ExplainView } from '../../shared/engine/types.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import { runsOn, s3Runs } from '../unit/engine/history-fixtures.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// The load setting [rules g-8] through the real Explain path: a plan generated at a position, then
// the drawer's own request (`GET /api/explain`) for one of its run sessions and for its first
// week. The facts are read from the stored plan's options, so a plan at standard shows the group
// and a plan at steady shows nothing of it. The unit tests of `explainInputs` build the facts from
// an input; this is the one test that goes from the request to the sentence.

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

const today = todayIso()
const thisMonday = mondayOf(today)
const year = Number(today.slice(0, 4))

/**
 * A runner with one year of running and the history of appendix A of the load-progression
 * proposal (a summer block, then sparse weeks), placed against this week's Monday, with a goal
 * twenty weeks away. 41 years old this year, so the age rule of upper does not apply.
 */
async function seedRunner(email: string): Promise<{ user: TestUser; goalId: string }> {
  const user = await seedUser(ctx, { email })
  await client(ctx, user)
    .put('/api/profile')
    .send({ birthYear: year - 41, runningSinceYear: year - 1 })
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
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic marathon',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 20 + 6),
      distanceM: 42_195,
      goalType: 'finish',
    },
  })
  return { user, goalId: goal.id }
}

async function generatedAt(
  user: TestUser,
  goalId: string,
  loadAppetite: 'steady' | 'standard',
): Promise<PlanWithSessions> {
  const created = await client(ctx, user)
    .post('/api/plan/generate')
    .send({ goalId, options: { loadAppetite } })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  const stored = await client(ctx, user).get('/api/plan')
  expect(stored.status).toBe(200)
  return stored.body as PlanWithSessions
}

async function explained(user: TestUser, query: string): Promise<ExplainView> {
  const res = await client(ctx, user).get(`/api/explain?${query}`)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as ExplainView
}

const sentences = (view: ExplainView, rule: string) =>
  (view.groups.find((group) => group.rule === rule)?.facts ?? []).map((fact) => ({
    id: fact.id,
    text: renderFact(fact, 'km'),
  }))

describe('GET /api/explain for a plan with a load setting [rules g-8]', () => {
  test('a run session of a plan at standard has the g-8 group, with the setting and the block', async () => {
    const { user, goalId } = await seedRunner('explain-load-standard@example.com')
    const plan = await generatedAt(user, goalId, 'standard')
    expect(plan.load).toMatchObject({ requested: 'standard', position: 'standard', held: null })
    const run = plan.sessions.find((s) => VOLUME_KINDS.has(s.kind))!

    const view = await explained(user, `subject=session&id=${run.id}`)

    // the group is listed after the weekly ramp, where the setting explains what the ramp sets
    expect(view.rules.indexOf('g-8')).toBe(view.rules.indexOf('g-2') + 1)
    const g8 = sentences(view, 'g-8')
    expect(g8.map((fact) => fact.id)).toEqual(
      expect.arrayContaining(['g-8.block', 'g-8.zone', 'g-8.setting', 'g-8.limits']),
    )
    expect(g8.find((fact) => fact.id === 'g-8.setting')?.text).toMatch(/^Load setting: Standard\./)
    // every sentence of the group came from a template, with no slot left open
    for (const { text } of g8) expect(text).not.toMatch(/[{}]/)
  })

  test('the week of a plan at standard has the same group', async () => {
    const { user, goalId } = await seedRunner('explain-load-week@example.com')
    const plan = await generatedAt(user, goalId, 'standard')

    const view = await explained(user, `subject=week&weekStart=${plan.weeks[0]!.weekStart}`)

    expect(view.rules).toContain('g-8')
    expect(sentences(view, 'g-8').find((fact) => fact.id === 'g-8.setting')?.text).toMatch(
      /^Load setting: Standard\./,
    )
  })

  test('a plan at steady has no g-8 group in either', async () => {
    const { user, goalId } = await seedRunner('explain-load-steady@example.com')
    const plan = await generatedAt(user, goalId, 'steady')
    const run = plan.sessions.find((s) => VOLUME_KINDS.has(s.kind))!

    const session = await explained(user, `subject=session&id=${run.id}`)
    const week = await explained(user, `subject=week&weekStart=${plan.weeks[0]!.weekStart}`)

    for (const view of [session, week]) {
      expect(view.rules).not.toContain('g-8')
      expect(view.groups.map((group) => group.rule)).not.toContain('g-8')
    }
  })
})
