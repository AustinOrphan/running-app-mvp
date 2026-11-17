// The race-week lines of the race plan read the stored plan's sessions (rule K6, owner decision
// 2026-11-17), so Race plan and Plan cannot say two things about the day before the race. The
// runner is the adjust fixture's: a half marathon 14 weeks out, and the plan the engine builds.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { PlanWithSessions, RacePlanView } from '../../shared/types.ts'
import { planFixture, rowsOf, type Fixture } from './adjustFixture.ts'
import { client, createTestCtx, expectNoRefusedFetches, type TestCtx } from './helpers.ts'

let ctx: TestCtx
let f: Fixture

beforeAll(async () => {
  ctx = await createTestCtx()
  f = await planFixture(ctx, 'rpc-race-week@example.com')
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  await ctx.close()
})

async function roadWeek() {
  const res = await client(ctx, f.u).get('/api/race/plan')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  const week = (res.body as RacePlanView).road?.raceWeek
  expect(week).toBeTruthy()
  return week!
}

async function planned() {
  const res = await client(ctx, f.u).get('/api/plan')
  return (res.body as PlanWithSessions).sessions
}

describe('Race plan and Plan agree on race week', () => {
  test('an unedited plan keeps the rule wording and the day before is within the rule', async () => {
    const week = await roadWeek()
    expect(week.shakeOut.held).toBeUndefined()
    expect(week.shakeOut.maxMin).toBe(P.k6.dayBeforeMaxMin.value)
    const sessions = await planned()
    const race = sessions.find((s) => s.kind === 'race')!
    const dayBefore = addDays(race.date, -1)
    expect(week.shakeOut.dayBefore).toBe(dayBefore)
    const minutes = sessions
      .filter((s) => s.date === dayBefore)
      .reduce((sum, s) => sum + s.durationMin, 0)
    expect(minutes).toBeLessThanOrEqual(week.shakeOut.maxMin)
  })

  test('after an edit of the day before, Race plan states the minutes Plan holds', async () => {
    const before = await roadWeek()
    const sessions = await planned()
    const race = sessions.find((s) => s.kind === 'race')!
    const dayBefore = addDays(race.date, -1)
    const easy = sessions
      .filter((s) => s.date < dayBefore && (s.kind === 'easy' || s.kind === 'recovery'))
      .at(-1)!
    // the week edit: an easy run of the race week lands on the day before and is lengthened
    await ctx.prisma.planSession.update({
      where: { id: easy.id },
      data: { date: dayBefore, durationMin: 60 },
    })

    const week = await roadWeek()
    expect(week).not.toEqual(before)
    const held = (await rowsOf(ctx, f.plan.id))
      .filter((r) => r.date === dayBefore)
      .reduce((sum, r) => sum + r.durationMin, 0)
    expect(week.shakeOut.held?.min).toBe(held)
    expect(held).toBeGreaterThan(P.k6.dayBeforeMaxMin.value)
    const planMin = (await planned())
      .filter((s) => s.date === dayBefore)
      .reduce((sum, s) => sum + s.durationMin, 0)
    expect(week.shakeOut.held?.min).toBe(planMin)
  })
})
