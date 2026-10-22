import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ApiErrorBody, PlanWeek, WeeklyReview } from '../../shared/types.ts'
import { toPlanWeek } from '../../server/serialize.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// Clock fixed on Wednesday 2026-03-18. W and W1 are finished weeks, W2 is the current week and
// W3 is upcoming.
const W = '2026-03-02'
const W1 = '2026-03-09'
const W2 = '2026-03-16'
const W3 = '2026-03-23'

let ctx: TestCtx
let user: TestUser

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0))
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  await seedPlan(user.id)
  for (const date of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']) {
    await seedRun(user.id, date)
  }
})

afterEach(async () => {
  vi.useRealTimers()
  await ctx.close()
})

async function seedPlan(userId: string): Promise<void> {
  const goal = await ctx.prisma.goal.create({
    data: {
      userId,
      name: 'Spring half',
      priority: 'A',
      targetDate: '2026-05-10',
      distanceM: 21097,
      isActive: true,
    },
  })
  const plan = await ctx.prisma.plan.create({
    data: {
      userId,
      goalId: goal.id,
      name: 'Plan',
      startDate: W,
      raceWeekStart: '2026-05-04',
      status: 'active',
      generatorVersion: 1,
    },
  })
  const weeks: Array<[string, number, number]> = [
    [W, 300, 300],
    [W1, 300, 400],
    [W2, 400, 400],
    [W3, 400, 400],
  ]
  for (const [index, [weekStart, targetRunMin, baselineRunMin]] of weeks.entries()) {
    await ctx.prisma.planWeek.create({
      data: {
        planId: plan.id,
        weekStart,
        index,
        phase: 'base2',
        baselineRunMin,
        targetRunMin,
        longRunMin: 90,
        runDays: 5,
        strengthSessions: 2,
      },
    })
  }
}

async function seedRun(userId: string, date: string, duplicateStatus = 'none'): Promise<void> {
  await ctx.prisma.activity.create({
    data: { userId, date, type: 'run', durationSec: 3600, distanceM: 9000, duplicateStatus },
  })
}

async function planWeek(weekStart: string): Promise<PlanWeek> {
  const row = await ctx.prisma.planWeek.findFirstOrThrow({ where: { weekStart } })
  return toPlanWeek(row)
}

interface Reply<T> {
  status: number
  body: T
}

async function put(
  weekStart: string,
  body: unknown,
  as: TestUser = user,
): Promise<Reply<WeeklyReview & ApiErrorBody>> {
  const res = await client(ctx, as)
    .put(`/api/reviews/${weekStart}`)
    .send(body as object)
  return { status: res.status, body: res.body as WeeklyReview & ApiErrorBody }
}

async function list(query: string, as: TestUser | null = user): Promise<Reply<WeeklyReview[]>> {
  const res = await client(ctx, as ?? undefined).get(`/api/reviews${query}`)
  return { status: res.status, body: res.body as WeeklyReview[] }
}

describe('GET /api/reviews', () => {
  test('list returns one row per week; unsaved weeks are synthetic with a computed suggestion', async () => {
    const res = await list(`?from=${W1}&to=${W3}`, user)
    expect(res.status).toBe(200)
    const rows = res.body
    expect(rows.map((r) => r.weekStart)).toEqual([W1, W2, W3])
    for (const row of rows) {
      expect(row.id).toBe('')
      expect(row.userId).toBe(user.id)
      expect(row.dataStatus).toBe('unconfirmed')
      expect(row.fatigue).toBeNull()
      expect(row.symptoms).toBeNull()
      expect(row.recoveryConstrained).toBe(false)
      expect(row.reviewedAt).toBeNull()
    }
    expect(rows.map((r) => r.suggestedAction)).toEqual(['await_data', 'in_progress', 'upcoming'])
    expect(rows[0]?.suggestedReason).toBeTruthy()
  })

  test('a stored row is returned with its saved fields', async () => {
    await put(W, { dataStatus: 'complete', fatigue: 4, symptoms: 'none', notes: 'Felt fine' })
    const res = await list(`?from=${W}&to=${W1}`, user)
    const rows = res.body
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      weekStart: W,
      dataStatus: 'complete',
      fatigue: 4,
      symptoms: 'none',
      notes: 'Felt fine',
      suggestedAction: 'progress',
    })
    expect(rows[0]?.id).not.toBe('')
    expect(rows[1]?.id).toBe('')
  })

  test('defaults to the twelve weeks ending this week', async () => {
    const res = await list('', user)
    const rows = res.body
    expect(rows).toHaveLength(12)
    expect(rows[0]?.weekStart).toBe('2025-12-29')
    expect(rows[11]?.weekStart).toBe(W2)
  })

  test('a week outside the plan has no suggestion', async () => {
    const res = await list('?from=2026-01-05&to=2026-01-05', user)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({
      suggestedAction: null,
      suggestedReason: null,
      suggestedNextMin: null,
    })
  })

  test('range validation', async () => {
    expect((await list(`?from=${W3}&to=${W}`)).status).toBe(400)
    expect((await list('?from=2020-01-06&to=2026-03-16')).status).toBe(400)
    expect((await list('?from=nope')).status).toBe(400)
    expect((await list('?from=2026-02-30')).status).toBe(400)
  })

  test('requires a session', async () => {
    expect((await list('', null)).status).toBe(401)
  })
})

describe('PUT /api/reviews/:weekStart', () => {
  test('save computes and stores the suggestion', async () => {
    const res = await put(W, { dataStatus: 'complete', fatigue: 4, symptoms: 'none' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      weekStart: W,
      suggestedAction: 'progress',
      suggestedNextMin: 330,
      reviewedAt: null,
    })
    expect(res.body.suggestedReason).toBeTruthy()

    const reduce = await put(W, { fatigue: 8 })
    expect(reduce.body).toMatchObject({
      fatigue: 8,
      symptoms: 'none',
      dataStatus: 'complete',
      suggestedAction: 'reduce',
      suggestedNextMin: 210,
    })
  })

  test('a possible duplicate in the week gives review_duplicates', async () => {
    await seedRun(user.id, '2026-03-07', 'possible')
    const res = await put(W, { dataStatus: 'complete', fatigue: 4, symptoms: 'none' })
    expect(res.body.suggestedAction).toBe('review_duplicates')
    expect(res.body.suggestedNextMin).toBeNull()
  })

  test('undefined keeps a field and null clears it', async () => {
    await put(W, { dataStatus: 'complete', fatigue: 4, symptoms: 'mild', notes: 'a' })
    const kept = await put(W, { recoveryConstrained: true })
    expect(kept.body).toMatchObject({ fatigue: 4, symptoms: 'mild', notes: 'a' })
    const cleared = await put(W, { fatigue: null, notes: null })
    expect(cleared.body).toMatchObject({ fatigue: null, notes: null, symptoms: 'mild' })
  })

  test('a final decision on a finished complete week sets reviewedAt and writes next week target', async () => {
    await put(W, { dataStatus: 'complete', fatigue: 4, symptoms: 'none' })
    const res = await put(W, { finalDecision: 'progress', finalNextMin: 330 })
    expect(res.status).toBe(200)
    expect(res.body.reviewedAt).toEqual(expect.any(String))
    expect(res.body.finalDecision).toBe('progress')
    expect(await planWeek(W1)).toMatchObject({ targetRunMin: 330, targetSource: 'review' })

    // The reviewed week's own target is untouched.
    expect(await planWeek(W)).toMatchObject({ targetRunMin: 300, targetSource: 'baseline' })

    const firstReviewedAt = res.body.reviewedAt as string
    vi.setSystemTime(new Date(2026, 2, 19, 12, 0, 0))
    const again = await put(W, { finalNextMin: 320 })
    expect(again.body.reviewedAt).toBe(firstReviewedAt)
    expect(await planWeek(W1)).toMatchObject({ targetRunMin: 320, targetSource: 'review' })

    const missing = await put(W, { dataStatus: 'missing' })
    expect(missing.body.reviewedAt).toBeNull()
    expect(await planWeek(W1)).toMatchObject({ targetRunMin: 400, targetSource: 'baseline' })
  })

  test('clearing finalNextMin returns next week to baseline', async () => {
    await put(W, { dataStatus: 'complete', finalDecision: 'hold', finalNextMin: 300 })
    expect(await planWeek(W1)).toMatchObject({ targetRunMin: 300, targetSource: 'review' })
    const res = await put(W, { finalNextMin: null })
    expect(res.body.reviewedAt).toEqual(expect.any(String))
    expect(await planWeek(W1)).toMatchObject({ targetRunMin: 400, targetSource: 'baseline' })
  })

  test('next week is left untouched when it is an override', async () => {
    await ctx.prisma.planWeek.updateMany({
      where: { weekStart: W1 },
      data: { targetRunMin: 250, targetSource: 'override', overrideNote: 'Travel' },
    })
    await put(W, { dataStatus: 'complete', finalDecision: 'progress', finalNextMin: 330 })
    expect(await planWeek(W1)).toMatchObject({
      targetRunMin: 250,
      targetSource: 'override',
      overrideNote: 'Travel',
    })
    await put(W, { dataStatus: 'missing' })
    expect(await planWeek(W1)).toMatchObject({ targetRunMin: 250, targetSource: 'override' })
  })

  test('a final decision without finalNextMin sets reviewedAt and leaves next week alone', async () => {
    const res = await put(W, { dataStatus: 'complete', finalDecision: 'hold' })
    expect(res.body.reviewedAt).toEqual(expect.any(String))
    expect(await planWeek(W1)).toMatchObject({ targetRunMin: 300, targetSource: 'baseline' })
  })

  test('a final decision without complete data does not set reviewedAt', async () => {
    const res = await put(W, { finalDecision: 'hold', finalNextMin: 300 })
    expect(res.status).toBe(200)
    expect(res.body.reviewedAt).toBeNull()
    expect(await planWeek(W1)).toMatchObject({ targetRunMin: 300, targetSource: 'baseline' })
  })

  test('after reviewedAt the stored snapshot is returned even when data changes', async () => {
    await put(W, { dataStatus: 'complete', fatigue: 4, symptoms: 'none' })
    await put(W, { finalDecision: 'progress', finalNextMin: 330 })
    await ctx.prisma.activity.deleteMany({ where: { userId: user.id } })
    const res = await list(`?from=${W}&to=${W}`, user)
    expect(res.body[0]).toMatchObject({ suggestedAction: 'progress', suggestedNextMin: 330 })
  })

  test('an unreviewed week follows the data', async () => {
    await put(W, { dataStatus: 'complete', fatigue: 4, symptoms: 'none' })
    await ctx.prisma.activity.deleteMany({ where: { userId: user.id } })
    const res = await list(`?from=${W}&to=${W}`, user)
    expect(res.body[0]?.suggestedAction).toBe('repeat')
  })

  test('a week that is not finished rejects a final decision; data status and fatigue are accepted', async () => {
    const decision = await put(W2, { finalDecision: 'hold' })
    expect(decision.status).toBe(400)
    expect(decision.body.error.code).toBe('validation')
    expect((await put(W2, { finalNextMin: 300 })).status).toBe(400)
    expect((await put(W3, { finalDecision: 'hold' })).status).toBe(400)

    const ok = await put(W2, { dataStatus: 'complete', fatigue: 3 })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({
      dataStatus: 'complete',
      fatigue: 3,
      suggestedAction: 'in_progress',
    })
    expect(ok.body.reviewedAt).toBeNull()
  })

  test('a week outside the plan saves fine and has suggestedAction null', async () => {
    const res = await put('2026-01-05', { dataStatus: 'complete', fatigue: 2, symptoms: 'none' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      suggestedAction: null,
      suggestedReason: null,
      suggestedNextMin: null,
    })
    const decided = await put('2026-01-05', { finalDecision: 'hold', finalNextMin: 200 })
    expect(decided.status).toBe(200)
    expect(decided.body.reviewedAt).toEqual(expect.any(String))
  })

  test('a week with no following plan week has no suggested minutes', async () => {
    await ctx.prisma.planWeek.deleteMany({ where: { weekStart: { gte: W2 } } })
    const res = await put(W1, { dataStatus: 'complete', fatigue: 3, symptoms: 'none' })
    expect(res.body.suggestedNextMin).toBeNull()
    expect(res.body.suggestedAction).not.toBeNull()
  })

  test('validation', async () => {
    expect((await put('2026-03-03', { fatigue: 3 })).status).toBe(400)
    expect((await put('not-a-date', { fatigue: 3 })).status).toBe(400)
    expect((await put(W, { fatigue: 0 })).status).toBe(400)
    expect((await put(W, { fatigue: 11 })).status).toBe(400)
    expect((await put(W, { fatigue: 5.5 })).status).toBe(400)
    expect((await put(W, { symptoms: 'severe' })).status).toBe(400)
    expect((await put(W, { dataStatus: 'done' })).status).toBe(400)
    expect((await put(W, { finalNextMin: -1 })).status).toBe(400)
    expect((await put(W, { finalDecision: 'x'.repeat(41) })).status).toBe(400)
    expect((await put(W, { recoveryConstrained: null })).status).toBe(400)
    const unknown = await put(W, { fatigue: 3, suggestedAction: 'progress' })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error.code).toBe('validation')
    expect(await ctx.prisma.weeklyReview.count()).toBe(0)
  })

  test('requires a session', async () => {
    expect((await client(ctx).put(`/api/reviews/${W}`).send({ fatigue: 3 })).status).toBe(401)
  })

  test("another user's review is never read or written", async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await put(W, { dataStatus: 'complete', fatigue: 9, notes: 'mine' })

    const theirs = await put(W, { fatigue: 2 }, other)
    expect(theirs.body).toMatchObject({ userId: other.id, fatigue: 2, notes: null })
    expect(theirs.body.suggestedAction).toBeNull()

    const mine = await list(`?from=${W}&to=${W}`, user)
    expect(mine.body[0]).toMatchObject({ fatigue: 9, notes: 'mine' })
    const theirList = await list(`?from=${W}&to=${W}`, other)
    expect(theirList.body[0]).toMatchObject({ userId: other.id, fatigue: 2, notes: null })
    expect(await ctx.prisma.weeklyReview.count()).toBe(2)
  })
})
