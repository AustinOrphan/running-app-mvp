import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { distanceClassOf, generatePlan } from '../../shared/domain/plan.ts'
import type { PlanWeek, PlanWithSessions, PlanWithWeeks } from '../../shared/types.ts'
import { computeBaselineRunMin } from '../../server/services/baseline.ts'
import { HttpError } from '../../server/errors.ts'
import { generatePlanForGoal } from '../../server/services/plan.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'
import { makeActivityCore } from '../factories.ts'

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

const today = todayIso()
const thisMonday = mondayOf(today)

async function seedGoal(
  over: Partial<{
    userId: string
    name: string
    targetDate: string
    distanceM: number | null
    status: string
  }> = {},
) {
  return ctx.prisma.goal.create({
    data: {
      userId: over.userId ?? user.id,
      name: over.name ?? 'Test Marathon',
      priority: 'A',
      status: over.status ?? 'target',
      targetDate: over.targetDate ?? addDays(thisMonday, 7 * 20 + 6),
      distanceM: over.distanceM === undefined ? 42_195 : over.distanceM,
    },
  })
}

async function generate(body: Record<string, unknown>, who = user) {
  return client(ctx, who).post('/api/plan/generate').send(body)
}

/**
 * The version-1 generator, which POST /api/plan/generate no longer runs. Plans it made stay in
 * the database and keep working, so its behaviour stays covered through the service.
 */
async function generateV1(
  where: TestCtx,
  userId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  try {
    const plan = await generatePlanForGoal(
      { prisma: where.prisma, config: where.config },
      { userId, today, ...(body as { goalId: string }) },
    )
    return { status: 201, body: plan }
  } catch (error) {
    if (error instanceof HttpError) {
      return { status: error.status, body: { error: { code: error.code, message: error.message } } }
    }
    throw error
  }
}

describe('GET /api/plan', () => {
  test('GET /plan is null before any plan', async () => {
    const res = await client(ctx, user).get('/api/plan')
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })

  test('GET /plan serves the externalId of each session of a version-2 plan, to its owner only', async () => {
    const owner = await seedUser(ctx, { email: 'external-id-owner@example.com' })
    const goal = await seedGoal({ userId: owner.id, name: 'Identity 10K', distanceM: 10_000 })
    const plan = await ctx.prisma.plan.create({
      data: {
        userId: owner.id,
        goalId: goal.id,
        name: goal.name,
        startDate: thisMonday,
        raceWeekStart: mondayOf(goal.targetDate),
        generatorVersion: 2,
      },
    })
    const kinds = ['easy', 'long']
    for (const [i, kind] of kinds.entries()) {
      await ctx.prisma.planSession.create({
        data: {
          planId: plan.id,
          externalId: `00000000-0000-4000-8000-00000000000${i}`,
          weekStart: thisMonday,
          date: addDays(thisMonday, i + 1),
          order: 0,
          kind,
          title: kind,
          durationMin: 40,
          target: JSON.stringify({ zone: 'z1', rpe: [3, 4], hr: null, paceSecPerKm: null }),
          purpose: 'Synthetic.',
        },
      })
    }
    const served = (await client(ctx, owner).get('/api/plan')).body as PlanWithSessions
    expect(served.sessions.map((s) => s.externalId)).toEqual([
      '00000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000001',
    ])
    expect((await client(ctx, other).get('/api/plan')).body).toBeNull()
  })
})

describe('computeBaselineRunMin', () => {
  test('computeBaselineRunMin', async () => {
    const fresh = await createTestCtx()
    try {
      const u = await seedUser(fresh, { email: 'baseline@example.com' })
      const now = '2026-03-18' // Wednesday; the current week starts 2026-03-16
      expect(await computeBaselineRunMin(fresh.prisma, u.id, now)).toBeNull()

      const run = (date: string, min: number, duplicateStatus = 'none') =>
        fresh.prisma.activity.create({
          data: {
            userId: u.id,
            date,
            type: 'run',
            durationSec: min * 60,
            distanceM: 1000,
            source: 'manual',
            duplicateStatus,
          },
        })

      // The current partial week and a run 30 weeks back do not count.
      await run('2026-03-16', 600)
      await run('2025-08-20', 500)
      expect(await computeBaselineRunMin(fresh.prisma, u.id, now)).toBeNull()

      // Five completed weeks: only the latest four count.
      await run('2026-02-10', 60)
      await run('2026-02-17', 90)
      await run('2026-02-24', 120)
      await run('2026-03-03', 150)
      await run('2026-03-10', 180)
      await run('2026-03-11', 100, 'possible') // flagged duplicate, ignored
      expect(await computeBaselineRunMin(fresh.prisma, u.id, now)).toBe(135)

      // A strength session is not a run.
      await fresh.prisma.activity.create({
        data: {
          userId: u.id,
          date: '2026-03-04',
          type: 'strength',
          durationSec: 3000,
          source: 'manual',
        },
      })
      expect(await computeBaselineRunMin(fresh.prisma, u.id, now)).toBe(135)

      // Another user's runs never leak in.
      const v = await seedUser(fresh, { email: 'baseline-b@example.com' })
      expect(await computeBaselineRunMin(fresh.prisma, v.id, now)).toBeNull()
    } finally {
      await fresh.close()
    }
  })

  test('reads the six core columns over the 26 completed weeks, with no heart-rate histogram', async () => {
    const findMany = vi.fn((_args: unknown) =>
      Promise.resolve([
        makeActivityCore({ date: '2026-02-10', durationSec: 60 * 60 }),
        makeActivityCore({ date: '2026-02-17', durationSec: 90 * 60 }),
        makeActivityCore({ date: '2026-02-24', durationSec: 120 * 60 }),
        makeActivityCore({ date: '2026-03-03', durationSec: 150 * 60 }),
        makeActivityCore({ date: '2026-03-10', durationSec: 180 * 60 }),
      ]),
    )
    const prisma = { activity: { findMany } } as unknown as Parameters<
      typeof computeBaselineRunMin
    >[0]

    // Wednesday 2026-03-18: the last completed week is 2026-03-09..15, 26 weeks before the current
    // week's Monday (2026-03-16) is 2025-09-15.
    expect(await computeBaselineRunMin(prisma, 'u1', '2026-03-18')).toBe(135)

    expect(findMany).toHaveBeenCalledTimes(1)
    const args = findMany.mock.calls[0]![0] as {
      where: unknown
      select: Record<string, boolean>
    }
    expect(args.where).toEqual({ userId: 'u1', date: { gte: '2025-09-15', lte: '2026-03-15' } })
    expect(Object.keys(args.select).sort()).toEqual([
      'date',
      'distanceM',
      'duplicateStatus',
      'durationSec',
      'id',
      'type',
    ])
    expect(Object.values(args.select).every((v) => v === true)).toBe(true)
  })

  test('weeks with no run are skipped, not counted as zero; an odd count takes the middle', async () => {
    const fresh = await createTestCtx()
    try {
      const u = await seedUser(fresh)
      const now = '2026-03-18'
      for (const [date, min] of [
        ['2026-03-10', 100],
        ['2026-02-24', 40], // 2026-03-03 has no run
        ['2026-02-17', 70],
      ] as const) {
        await fresh.prisma.activity.create({
          data: {
            userId: u.id,
            date,
            type: 'run',
            durationSec: min * 60,
            distanceM: 1000,
            source: 'manual',
          },
        })
      }
      expect(await computeBaselineRunMin(fresh.prisma, u.id, now)).toBe(70)
    } finally {
      await fresh.close()
    }
  })
})

describe('version-1 generator (generatePlanForGoal)', () => {
  test('generate: baseline from request wins, else from runs, else validation', async () => {
    const fresh = await createTestCtx()
    try {
      const u = await seedUser(fresh)
      const goal = await fresh.prisma.goal.create({
        data: {
          userId: u.id,
          name: 'Baseline source',
          priority: 'A',
          targetDate: addDays(thisMonday, 7 * 20 + 6),
          distanceM: 42_195,
        },
      })

      const none = await generateV1(fresh, u.id, { goalId: goal.id })
      expect(none.status).toBe(400)
      const body = none.body as { error: { code: string; message: string } }
      expect(body.error.code).toBe('validation')
      expect(body.error.message).toMatch(/baseline/i)

      // Four completed weeks of 120 minutes give a baseline of 120.
      for (let w = 1; w <= 4; w += 1) {
        await fresh.prisma.activity.create({
          data: {
            userId: u.id,
            date: addDays(thisMonday, -7 * w + 1),
            type: 'run',
            durationSec: 120 * 60,
            distanceM: 18_000,
            source: 'manual',
          },
        })
      }
      const baselinesFor = (baselineRunMin: number) =>
        generatePlan({
          startDate: thisMonday,
          raceDate: goal.targetDate,
          distanceClass: distanceClassOf(42_195),
          baselineRunMin,
          strengthPreference: 2,
        }).map((w) => w.baselineRunMin)
      const weekBaselines = (res: { body: unknown }) =>
        (res.body as PlanWithWeeks).weeks.map((w) => w.baselineRunMin)

      const fromRuns = await generateV1(fresh, u.id, { goalId: goal.id })
      expect(fromRuns.status).toBe(201)
      expect(weekBaselines(fromRuns)).toEqual(baselinesFor(120))

      const explicit = await generateV1(fresh, u.id, { goalId: goal.id, baselineRunMin: 200 })
      expect(explicit.status).toBe(201)
      expect(weekBaselines(explicit)).toEqual(baselinesFor(200))
    } finally {
      await fresh.close()
    }
  })

  test('generate persists weeks with targetRunMin = baselineRunMin and targetSource baseline', async () => {
    const targetDate = addDays(thisMonday, 7 * 20 + 6)
    const goal = await seedGoal({ name: 'Persisted Marathon', targetDate })
    const startDate = addDays(thisMonday, 2) // a Wednesday
    const res = await generateV1(ctx, user.id, { goalId: goal.id, baselineRunMin: 180, startDate })
    expect(res.status).toBe(201)
    const plan = res.body as PlanWithWeeks

    expect(plan).toMatchObject({
      userId: user.id,
      goalId: goal.id,
      name: 'Persisted Marathon',
      status: 'active',
      generatorVersion: 1,
      startDate: thisMonday,
      raceWeekStart: mondayOf(targetDate),
    })
    expect(plan.weeks.map((w) => w.index)).toEqual(plan.weeks.map((_, i) => i))
    expect(plan.weeks[0]?.weekStart).toBe(thisMonday)
    expect(plan.weeks.at(-1)?.weekStart).toBe(mondayOf(targetDate))
    expect(plan.weeks.at(-1)?.phase).toBe('race')
    for (const week of plan.weeks) {
      expect(week.targetRunMin).toBe(week.baselineRunMin)
      expect(week.targetSource).toBe('baseline')
      expect(week.overrideNote).toBeNull()
    }

    const expected = generatePlan({
      startDate: thisMonday,
      raceDate: targetDate,
      distanceClass: distanceClassOf(42_195),
      baselineRunMin: 180,
      strengthPreference: 2,
    })
    expect(
      plan.weeks.map((w) => ({
        weekStart: w.weekStart,
        index: w.index,
        phase: w.phase,
        focus: w.focus,
        baselineRunMin: w.baselineRunMin,
        longRunMin: w.longRunMin,
        day2Min: w.day2Min,
        runDays: w.runDays,
        strengthSessions: w.strengthSessions,
      })),
    ).toEqual(expected)

    const stored = await client(ctx, user).get('/api/plan')
    expect(stored.status).toBe(200)
    expect((stored.body as PlanWithWeeks).id).toBe(plan.id)
    expect((stored.body as PlanWithWeeks).weeks).toHaveLength(plan.weeks.length)

    const lean = await generateV1(ctx, user.id, {
      goalId: goal.id,
      baselineRunMin: 180,
      strengthPreference: 0,
    })
    expect((lean.body as PlanWithWeeks).weeks.every((w) => w.strengthSessions === 0)).toBe(true)
  })

  test('regenerating archives the old plan, keeps exactly one active plan and keeps reviews', async () => {
    const fresh = await createTestCtx()
    try {
      const u = await seedUser(fresh)
      const c = client(fresh, u)
      const goal = await fresh.prisma.goal.create({
        data: {
          userId: u.id,
          name: 'Regen',
          priority: 'A',
          targetDate: addDays(thisMonday, 7 * 12 + 5),
          distanceM: 21_097,
        },
      })
      await fresh.prisma.weeklyReview.create({
        data: { userId: u.id, weekStart: thisMonday, dataStatus: 'complete', fatigue: 4 },
      })

      const firstRes = await c
        .post('/api/plan/generate')
        .send({ goalId: goal.id, baselineRunMin: 150 })
      const first = firstRes.body as PlanWithWeeks
      const week = first.weeks[1] as PlanWeek
      const override = await c
        .put(`/api/plan/weeks/${week.weekStart}`)
        .send({ targetRunMin: week.baselineRunMin + 20, overrideNote: 'Visiting family' })
      expect(override.status).toBe(200)

      const secondRes = await c
        .post('/api/plan/generate')
        .send({ goalId: goal.id, baselineRunMin: 150 })
      expect(secondRes.status).toBe(201)
      const second = secondRes.body as PlanWithWeeks
      expect(second.id).not.toBe(first.id)

      const plans = await fresh.prisma.plan.findMany({ where: { userId: u.id } })
      expect(plans.filter((p) => p.status === 'active').map((p) => p.id)).toEqual([second.id])
      expect(plans.find((p) => p.id === first.id)?.status).toBe('archived')
      expect(await fresh.prisma.weeklyReview.count({ where: { userId: u.id } })).toBe(1)

      const current = (await c.get('/api/plan')).body as PlanWithWeeks
      expect(current.id).toBe(second.id)
      const again = current.weeks.find((w) => w.weekStart === week.weekStart)
      expect(again?.targetSource).toBe('baseline')
      expect(again?.overrideNote).toBeNull()
      expect(again?.targetRunMin).toBe(again?.baselineRunMin)
    } finally {
      await fresh.close()
    }
  })

  test('regenerating re-applies the target of a reviewed previous week and drops overrides', async () => {
    const fresh = await createTestCtx()
    try {
      const u = await seedUser(fresh)
      const goal = await fresh.prisma.goal.create({
        data: {
          userId: u.id,
          name: 'Review link',
          priority: 'A',
          targetDate: addDays(thisMonday, 7 * 12 + 5),
          distanceM: 21_097,
        },
      })
      await fresh.prisma.weeklyReview.create({
        data: {
          userId: u.id,
          weekStart: addDays(thisMonday, -7),
          dataStatus: 'complete',
          finalDecision: 'hold',
          finalNextMin: 150,
          reviewedAt: new Date(),
        },
      })
      // Not reviewed: finalNextMin alone does not count.
      await fresh.prisma.weeklyReview.create({
        data: {
          userId: u.id,
          weekStart: thisMonday,
          dataStatus: 'complete',
          finalNextMin: 90,
        },
      })

      const res = await generateV1(fresh, u.id, { goalId: goal.id, baselineRunMin: 160 })
      expect(res.status).toBe(201)
      const plan = res.body as PlanWithWeeks
      const current = plan.weeks.find((w) => w.weekStart === thisMonday) as PlanWeek
      expect(current.baselineRunMin).not.toBe(150)
      expect(current.targetRunMin).toBe(150)
      expect(current.targetSource).toBe('review')
      const next = plan.weeks.find((w) => w.weekStart === addDays(thisMonday, 7)) as PlanWeek
      expect(next.targetSource).toBe('baseline')
      expect(next.targetRunMin).toBe(next.baselineRunMin)
    } finally {
      await fresh.close()
    }
  })

  test('generating makes the plan goal the only active goal', async () => {
    const fresh = await createTestCtx()
    try {
      const u = await seedUser(fresh)
      const make = (name: string, isActive: boolean) =>
        fresh.prisma.goal.create({
          data: {
            userId: u.id,
            name,
            priority: 'A',
            isActive,
            targetDate: addDays(thisMonday, 7 * 12 + 5),
            distanceM: 21_097,
          },
        })
      const a = await make('Goal A', true)
      const b = await make('Goal B', false)
      const res = await client(fresh, u)
        .post('/api/plan/generate')
        .send({ goalId: b.id, baselineRunMin: 150 })
      expect(res.status).toBe(201)
      const goals = await fresh.prisma.goal.findMany({ where: { userId: u.id } })
      expect(goals.filter((g) => g.isActive).map((g) => g.id)).toEqual([b.id])
      expect(goals.find((g) => g.id === a.id)?.isActive).toBe(false)
    } finally {
      await fresh.close()
    }
  })

  test('generate errors', async () => {
    const goal = await seedGoal({ name: 'Errors ok' })
    const foreign = await seedGoal({ name: 'Foreign', userId: other.id })
    const noDistance = await seedGoal({ name: 'No distance', distanceM: null })
    const done = await seedGoal({ name: 'Done', status: 'done' })
    const dropped = await seedGoal({ name: 'Dropped', status: 'dropped' })
    const past = await seedGoal({ name: 'Past', targetDate: addDays(today, -3) })
    const far = await seedGoal({ name: 'Far', targetDate: addDays(thisMonday, 7 * 157) })

    const cases: Array<[string, Record<string, unknown>, number]> = [
      ['unknown goal', { goalId: 'nope', baselineRunMin: 120 }, 404],
      ['another user goal', { goalId: foreign.id, baselineRunMin: 120 }, 404],
      ['no distance', { goalId: noDistance.id, baselineRunMin: 120 }, 400],
      ['done goal', { goalId: done.id, baselineRunMin: 120 }, 400],
      ['dropped goal', { goalId: dropped.id, baselineRunMin: 120 }, 400],
      ['past race', { goalId: past.id, baselineRunMin: 120 }, 400],
      ['too many weeks', { goalId: far.id, baselineRunMin: 120 }, 400],
      ['baseline 0', { goalId: goal.id, baselineRunMin: 0 }, 400],
      ['baseline huge', { goalId: goal.id, baselineRunMin: 1_000_000 }, 400],
      ['baseline fraction', { goalId: goal.id, baselineRunMin: 100.5 }, 400],
      ['bad start date', { goalId: goal.id, baselineRunMin: 120, startDate: '2026-13-01' }, 400],
      ['bad strength', { goalId: goal.id, baselineRunMin: 120, strengthPreference: 3 }, 400],
      ['missing goalId', { baselineRunMin: 120 }, 400],
    ]
    for (const [label, body, status] of cases) {
      const res = await generate(body)
      expect(res.status, label).toBe(status)
    }
    expect(await ctx.prisma.plan.count({ where: { goalId: done.id } })).toBe(0)

    // The version-1 start date is checked by its own service; the route no longer passes it.
    const near = await seedGoal({ name: 'Near', targetDate: addDays(today, 10) })
    const late = await generateV1(ctx, user.id, {
      goalId: near.id,
      baselineRunMin: 120,
      startDate: addDays(thisMonday, 21),
    })
    expect(late.status).toBe(400)
  })

  test('race in the current week gives a one-week plan', async () => {
    const goal = await seedGoal({ name: 'This week', targetDate: today })
    const res = await generateV1(ctx, user.id, { goalId: goal.id, baselineRunMin: 120 })
    expect(res.status).toBe(201)
    const plan = res.body as PlanWithWeeks
    expect(plan.weeks).toHaveLength(1)
    expect(plan.weeks[0]).toMatchObject({ phase: 'race', weekStart: thisMonday, index: 0 })
    expect(plan.raceWeekStart).toBe(thisMonday)
  })

  test('a past startDate creates past weeks and leaves activities untouched', async () => {
    const fresh = await createTestCtx()
    try {
      const u = await seedUser(fresh)
      const goal = await fresh.prisma.goal.create({
        data: {
          userId: u.id,
          name: 'Late start',
          priority: 'A',
          targetDate: addDays(thisMonday, 7 * 10 + 6),
          distanceM: 10_000,
        },
      })
      const pastRun = await fresh.prisma.activity.create({
        data: {
          userId: u.id,
          date: addDays(thisMonday, -14),
          type: 'run',
          durationSec: 3600,
          distanceM: 9000,
          source: 'manual',
        },
      })
      const startDate = addDays(thisMonday, -21)
      const res = await generateV1(fresh, u.id, { goalId: goal.id, baselineRunMin: 100, startDate })
      expect(res.status).toBe(201)
      const plan = res.body as PlanWithWeeks
      expect(plan.weeks[0]?.weekStart).toBe(startDate)
      expect(plan.weeks.some((w) => w.weekStart < thisMonday)).toBe(true)
      const after = await fresh.prisma.activity.findMany({ where: { userId: u.id } })
      expect(after).toHaveLength(1)
      expect(after[0]).toEqual(pastRun)
    } finally {
      await fresh.close()
    }
  })
})

describe('PUT /api/plan/weeks/:weekStart', () => {
  test('PUT week: override rules', async () => {
    const fresh = await createTestCtx()
    try {
      const u = await seedUser(fresh)
      const c = client(fresh, u)
      const goal = await fresh.prisma.goal.create({
        data: {
          userId: u.id,
          name: 'Override',
          priority: 'A',
          targetDate: addDays(thisMonday, 7 * 14 + 6),
          distanceM: 21_097,
        },
      })
      const generated = await c
        .post('/api/plan/generate')
        .send({ goalId: goal.id, baselineRunMin: 150 })
      const plan = generated.body as PlanWithWeeks
      const week = plan.weeks[2] as PlanWeek
      const url = `/api/plan/weeks/${week.weekStart}`
      const raised = week.baselineRunMin + 30

      // A target different from the baseline needs a note.
      expect((await c.put(url).send({ targetRunMin: raised })).status).toBe(400)
      expect((await c.put(url).send({ targetRunMin: raised, overrideNote: '   ' })).status).toBe(
        400,
      )
      const unchanged = (await c.get('/api/plan')).body as PlanWithWeeks
      expect(unchanged.weeks[2]?.targetRunMin).toBe(week.baselineRunMin)

      const ok = await c.put(url).send({ targetRunMin: raised, overrideNote: ' Holiday week ' })
      expect(ok.status).toBe(200)
      expect(ok.body).toMatchObject({
        targetRunMin: raised,
        targetSource: 'override',
        overrideNote: 'Holiday week',
        baselineRunMin: week.baselineRunMin,
      })

      // Editing other fields alone leaves the target and its source unchanged.
      const edited = await c.put(url).send({
        longRunMin: 55,
        day2Min: 20,
        runDays: 4,
        strengthSessions: 1,
        focus: 'Hills',
      })
      expect(edited.status).toBe(200)
      expect(edited.body).toMatchObject({
        targetRunMin: raised,
        targetSource: 'override',
        overrideNote: 'Holiday week',
        longRunMin: 55,
        day2Min: 20,
        runDays: 4,
        strengthSessions: 1,
        focus: 'Hills',
      })
      const cleared = await c.put(url).send({ day2Min: null })
      expect((cleared.body as PlanWeek).day2Min).toBeNull()

      // A note alone is accepted while the source is override, but not blank.
      const reworded = await c.put(url).send({ overrideNote: 'Race trip' })
      expect(reworded.status).toBe(200)
      expect((reworded.body as PlanWeek).overrideNote).toBe('Race trip')
      expect((await c.put(url).send({ overrideNote: ' ' })).status).toBe(400)

      // Back to the baseline value clears the note.
      const reset = await c
        .put(url)
        .send({ targetRunMin: week.baselineRunMin, overrideNote: 'ignored' })
      expect(reset.status).toBe(200)
      expect(reset.body).toMatchObject({
        targetRunMin: week.baselineRunMin,
        targetSource: 'baseline',
        overrideNote: null,
      })

      // A note without a target change is refused unless the source is override.
      expect((await c.put(url).send({ overrideNote: 'stray' })).status).toBe(400)

      // A week whose source is 'review' also resets when the target returns to the baseline.
      await fresh.prisma.planWeek.update({
        where: { id: week.id },
        data: { targetRunMin: week.baselineRunMin - 10, targetSource: 'review' },
      })
      const fromReview = await c.put(url).send({ targetRunMin: week.baselineRunMin })
      expect(fromReview.body).toMatchObject({ targetSource: 'baseline', overrideNote: null })

      // Malformed, non-Monday and out-of-plan weeks.
      expect((await c.put('/api/plan/weeks/not-a-date').send({ focus: 'x' })).status).toBe(400)
      const notMonday = await c
        .put(`/api/plan/weeks/${addDays(week.weekStart, 1)}`)
        .send({ focus: 'x' })
      expect(notMonday.status).toBe(400)
      const outside = await c
        .put(`/api/plan/weeks/${addDays(thisMonday, -70)}`)
        .send({ focus: 'x' })
      expect(outside.status).toBe(404)

      // Ranges and unknown keys.
      expect((await c.put(url).send({ runDays: 8 })).status).toBe(400)
      expect((await c.put(url).send({ runDays: -1 })).status).toBe(400)
      expect((await c.put(url).send({ strengthSessions: 8 })).status).toBe(400)
      expect((await c.put(url).send({ targetRunMin: -5, overrideNote: 'x' })).status).toBe(400)
      expect((await c.put(url).send({ longRunMin: 1.5 })).status).toBe(400)
      expect((await c.put(url).send({ surprise: true })).status).toBe(400)
      expect((await c.put(url).send({ runDays: 0 })).status).toBe(200)

      // Archived plans are not editable.
      await fresh.prisma.plan.updateMany({ where: { userId: u.id }, data: { status: 'archived' } })
      expect((await c.put(url).send({ focus: 'late' })).status).toBe(404)
    } finally {
      await fresh.close()
    }
  })

  test('another user cannot edit a week', async () => {
    const goal = await seedGoal({ name: 'Mine', userId: user.id })
    const generated = await generate({ goalId: goal.id, baselineRunMin: 150 })
    const plan = generated.body as PlanWithWeeks
    const res = await client(ctx, other)
      .put(`/api/plan/weeks/${plan.weeks[0]?.weekStart}`)
      .send({ focus: 'steal' })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/plan/revisions', () => {
  /** Hand-made revisions of a version-2 plan, a minute apart, oldest first. */
  async function planWithRevisions(
    email: string,
    kinds: Array<'old' | 'empty' | 'change'>,
  ): Promise<{ u: TestUser; ids: string[] }> {
    const u = await seedUser(ctx, { email })
    const goal = await seedGoal({ userId: u.id })
    const plan = await ctx.prisma.plan.create({
      data: {
        userId: u.id,
        goalId: goal.id,
        name: goal.name,
        startDate: thisMonday,
        raceWeekStart: mondayOf(goal.targetDate),
        generatorVersion: 2,
      },
    })
    const empty = JSON.stringify({ v: 1, sessions: [], weeks: [], holds: [], empty: true })
    const change = JSON.stringify({ v: 1, sessions: [], weeks: [], holds: [], empty: false })
    const ids: string[] = []
    for (const [i, kind] of kinds.entries()) {
      const row = await ctx.prisma.planRevision.create({
        data: {
          planId: plan.id,
          reason: 'weekly',
          summary: `Synthetic ${String(i)}.`,
          createdAt: new Date(Date.UTC(2026, 9, 1, 3, i)),
          diff: kind === 'old' ? null : kind === 'empty' ? empty : change,
        },
      })
      ids.push(row.id)
    }
    return { u, ids }
  }

  const idsOf = (body: unknown) => (body as Array<{ id: string }>).map((r) => r.id)

  test('is empty without a plan', async () => {
    const u = await seedUser(ctx, { email: 'revisions-none@example.com' })
    const res = await client(ctx, u).get('/api/plan/revisions')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  test('lists newest first, hides empty diffs, keeps revisions without a diff', async () => {
    const { u, ids } = await planWithRevisions('revisions-hide@example.com', [
      'old',
      'change',
      'empty',
      'change',
      'empty',
    ])
    const c = client(ctx, u)
    expect(idsOf((await c.get('/api/plan/revisions')).body)).toEqual([ids[3], ids[1], ids[0]])
    expect(idsOf((await c.get('/api/plan/revisions?include=empty')).body)).toEqual(
      [...ids].reverse(),
    )
  })

  test('pages with limit and before, and a page of the filtered list is full', async () => {
    const kinds = Array.from({ length: 9 }, (_, i): 'empty' | 'change' =>
      i % 3 === 0 ? 'change' : 'empty',
    )
    const { u, ids } = await planWithRevisions('revisions-page@example.com', kinds)
    const c = client(ctx, u)
    const changes = ids.filter((_, i) => kinds[i] === 'change').reverse()

    const first = idsOf((await c.get('/api/plan/revisions?limit=2')).body)
    expect(first).toEqual(changes.slice(0, 2))
    const second = idsOf((await c.get(`/api/plan/revisions?limit=2&before=${first[1]!}`)).body)
    expect(second).toEqual(changes.slice(2))

    const newest = [...ids].reverse()
    const everything = idsOf((await c.get('/api/plan/revisions?limit=4&include=empty')).body)
    expect(everything).toEqual(newest.slice(0, 4))
    const rest = idsOf(
      (await c.get(`/api/plan/revisions?limit=200&include=empty&before=${everything[3]!}`)).body,
    )
    expect(rest).toEqual(newest.slice(4))
  })

  test('serves 50 by default and at most 200', async () => {
    const { u } = await planWithRevisions(
      'revisions-limit@example.com',
      Array.from({ length: 205 }, () => 'change' as const),
    )
    const c = client(ctx, u)
    expect(idsOf((await c.get('/api/plan/revisions')).body)).toHaveLength(50)
    expect(idsOf((await c.get('/api/plan/revisions?limit=200')).body)).toHaveLength(200)
  })

  test('refuses what it cannot read, and does not take another user’s revision as a cursor', async () => {
    const { u } = await planWithRevisions('revisions-bad@example.com', ['change'])
    const stranger = await planWithRevisions('revisions-stranger@example.com', ['change'])
    const c = client(ctx, u)
    for (const query of [
      'limit=0',
      'limit=201',
      'limit=1.5',
      'limit=many',
      'include=all',
      'include=',
      'before=',
      'surprise=1',
    ]) {
      expect((await c.get(`/api/plan/revisions?${query}`)).status, query).toBe(400)
    }
    expect((await c.get('/api/plan/revisions?before=no-such-revision')).status).toBe(404)
    expect((await c.get(`/api/plan/revisions?before=${stranger.ids[0]!}`)).status).toBe(404)
  })

  test('serves the revision model fields and never the undo payload', async () => {
    const { u } = await planWithRevisions('revisions-fields@example.com', ['change'])
    const [row] = (await client(ctx, u).get('/api/plan/revisions')).body as Array<
      Record<string, unknown>
    >
    expect(Object.keys(row!).sort()).toEqual(
      [
        'auto',
        'causes',
        'changes',
        'createdAt',
        'decision',
        'diff',
        'disruptionId',
        'id',
        'planId',
        'reason',
        'seenAt',
        'summary',
        'undo',
        'undoOf',
      ].sort(),
    )
  })
})
