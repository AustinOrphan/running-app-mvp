// The Why drawer and the Plan page read one load position [rules g-8]. The drawer's g-8 facts are
// built from the input with the plan's own goal, as the Plan page's `load` is, and not from the
// neutral goal of a read about the athlete: a race logged on the goal date is the goal race, whose
// window is the plan's own, and not a past race that holds the setting at steady.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { renderFact } from '../../shared/copy/templates.ts'
import type { ExplainView, InputFact } from '../../shared/engine/types.ts'
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
const MARATHON_M = 42_195

/** A runner under 45 with a year of running and the summer block of appendix A, then sparse weeks. */
async function seedRunner(email: string): Promise<TestUser> {
  const user = await seedUser(ctx, { email })
  const year = Number(today.slice(0, 4))
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
  return user
}

/** A marathon logged as a race `daysAgo` days back. */
const logMarathon = (userId: string, date: string) =>
  ctx.prisma.activity.create({
    data: {
      userId,
      date,
      type: 'race',
      durationSec: 4 * 3600,
      movingSec: 4 * 3600,
      distanceM: MARATHON_M,
      rpe: 9,
      source: 'manual',
    },
  })

/** A plan at Standard for a marathon 20 weeks ahead. */
async function standardPlan(user: TestUser) {
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic marathon',
      priority: 'A',
      status: 'target',
      targetDate: addDays(thisMonday, 7 * 20 + 6),
      distanceM: MARATHON_M,
    },
  })
  const res = await client(ctx, user)
    .post('/api/plan/generate')
    .send({ goalId: goal.id, options: { loadAppetite: 'standard' } })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return goal
}

const planPage = async (user: TestUser) =>
  (await client(ctx, user).get('/api/plan').expect(200)).body as PlanWithSessions

/** The g-8 facts of the Why drawer: the rule asked for by name, as the drawer asks for a week's rules. */
async function drawerFacts(user: TestUser): Promise<InputFact[]> {
  const res = await client(ctx, user).get('/api/explain?subject=rules&rules=g-8')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  const view = res.body as ExplainView
  return view.groups.find((group) => group.rule === 'g-8')?.facts ?? []
}

const sentences = (facts: InputFact[]) => facts.map((fact) => renderFact(fact, 'km'))

describe('the Why drawer and the Plan page read one load position', () => {
  test('a race logged on the plan’s goal date holds nothing, in the drawer as on the page', async () => {
    const user = await seedRunner('drawer-goal-race@example.com')
    const goal = await standardPlan(user)
    // the goal race has been run: the goal date is now three days back, with the race logged on it
    const raceDate = addDays(today, -3)
    await ctx.prisma.goal.update({ where: { id: goal.id }, data: { targetDate: raceDate } })
    await logMarathon(user.id, raceDate)

    const page = await planPage(user)
    expect(page.load).toEqual({
      requested: 'standard',
      position: 'standard',
      held: null,
      ageCapped: false,
    })
    const facts = await drawerFacts(user)
    // the drawer states what the page states: Standard in effect, its zone, and no held reason
    expect(facts.map((fact) => fact.id)).not.toContain('g-8.held')
    expect(facts.map((fact) => fact.id)).toContain('g-8.zone')
    expect(sentences(facts)).toContain(
      'Load setting: Standard. It sets how fast the plan adds running time while rebuilding.',
    )
    expect(sentences(facts).join(' ')).not.toContain('The steady step applies')
  })

  test('a past race that is not the goal holds the setting at steady in both', async () => {
    const user = await seedRunner('drawer-past-race@example.com')
    await standardPlan(user)
    await logMarathon(user.id, addDays(today, -8))

    const page = await planPage(user)
    expect(page.load).toEqual({
      requested: 'standard',
      position: 'steady',
      held: 'post-race',
      ageCapped: false,
    })
    const facts = await drawerFacts(user)
    expect(facts.map((fact) => fact.id)).toContain('g-8.held')
    expect(facts.map((fact) => fact.id)).not.toContain('g-8.zone')
    expect(sentences(facts)).toContain(
      'The steady step applies for now: the plan is in the weeks after a race.',
    )
  })
})
