// A loading week run far under its target counts as the cycle's recovery week through the weekly
// re-plan [rules E3, G-6, J7; owner decision 2026-11-15]: one revision, with the sentence of the
// repeat, and the week after it drawn as the loading week.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { addDays } from '../../shared/dates.ts'
import { BREAK_REPEAT_FLAG } from '../../shared/engine/breakWeek.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import type { Deps } from '../../server/app.ts'
import { replanActivePlan } from '../../server/services/planEngine.ts'
import { settleWeatherCache } from '../../server/services/weatherCache.ts'
import { fakeFetch } from '../fakeFetch.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  noNetwork,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// Generated in the week of 12 October (a loading week; the plan puts a recovery week after it) and
// re-planned on the Monday of that recovery week, 19 October.
const GENERATED = new Date(2026, 9, 14, 12) // Wednesday 14 October 2026
const MONDAY_NOON = new Date(2026, 9, 19, 12)
const FIRST = '2026-10-12'
const MONDAY = '2026-10-19'

vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(GENERATED)

let ctx: TestCtx
const deps = (): Deps => ({ prisma: ctx.prisma, config: ctx.config, fetch: ctx.fetch })

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(async () => {
  await settleWeatherCache()
  vi.setSystemTime(GENERATED)
  await ctx.prisma.forecastCache.deleteMany()
  await ctx.prisma.climateCache.deleteMany()
  await ctx.prisma.climateFailure.deleteMany()
  expectNoRefusedFetches(ctx)
})

/** Twelve completed weeks of four runs, 190 minutes a week, before the Monday of `FIRST`. */
async function seedHistory(userId: string): Promise<void> {
  const week = [
    { dow: 1, min: 40 },
    { dow: 3, min: 45 },
    { dow: 5, min: 35 },
    { dow: 6, min: 70 },
  ]
  const rows = []
  for (let w = 1; w <= 12; w += 1) {
    for (const run of week) {
      rows.push({
        userId,
        date: addDays(FIRST, -7 * w + run.dow),
        type: 'run',
        durationSec: run.min * 60,
        movingSec: run.min * 60,
        distanceM: run.min * 160,
        rpe: 3,
        source: 'manual',
      })
    }
  }
  await ctx.prisma.activity.createMany({ data: rows })
}

/** The week of `weekStart` run at `totalMin` minutes in four runs. */
async function seedWeek(userId: string, weekStart: string, totalMin: number): Promise<void> {
  const runs = [0.2, 0.25, 0.2, 0.35].map((share, i) => ({
    dow: [0, 2, 4, 6][i]!,
    min: Math.round(totalMin * share),
  }))
  await ctx.prisma.activity.createMany({
    data: runs.map((run) => ({
      userId,
      date: addDays(weekStart, run.dow),
      type: 'run',
      durationSec: run.min * 60,
      movingSec: run.min * 60,
      distanceM: run.min * 160,
      rpe: 3,
      source: 'manual',
      tempC: 12,
    })),
  })
}

/** A mild archive for the race-day climate the plan reads from the home place. */
function mildArchive(): void {
  ctx.fetch = fakeFetch({
    'GET https://archive-api.open-meteo.com/v1/archive': (request) => {
      const day = new URL(request.url).searchParams.get('start_date')!
      const times = Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`)
      return Response.json({
        hourly: {
          time: times,
          temperature_2m: times.map(() => 10),
          relative_humidity_2m: times.map(() => 50),
          wind_speed_10m: times.map(() => 5),
          shortwave_radiation: times.map(() => 200),
        },
      })
    },
  })
}

const weekRow = async (planId: string, weekStart: string) =>
  ctx.prisma.planWeek.findUniqueOrThrow({ where: { planId_weekStart: { planId, weekStart } } })

/** A runner with a plan made on 14 October for a half marathon 14 weeks out, and the week of `FIRST` run at `share`. */
async function seedPlan(
  email: string,
  share: number,
): Promise<{ u: TestUser; plan: PlanWithSessions; plannedMin: number }> {
  const u = await seedUser(ctx, { email })
  await seedHistory(u.id)
  await ctx.prisma.athleteProfile.upsert({
    where: { userId: u.id },
    create: { userId: u.id, homeLat: 40.1, homeLng: -105.2 },
    update: { homeLat: 40.1, homeLng: -105.2 },
  })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(FIRST, 7 * 14 + 5),
      distanceM: 21_097,
      goalType: 'finish',
    },
  })
  mildArchive()
  const res = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  ctx.fetch = noNetwork(ctx.refusedFetches)
  const plan = res.body as PlanWithSessions
  const plannedMin = (await weekRow(plan.id, FIRST)).targetRunMin
  await seedWeek(u.id, FIRST, Math.round(plannedMin * share))
  vi.setSystemTime(MONDAY_NOON)
  return { u, plan, plannedMin }
}

describe('the weekly re-plan after a loading week run far under its target', () => {
  test('writes one revision that repeats the loading week and shifts the cycle', async () => {
    const { u, plan, plannedMin } = await seedPlan('br1-short@example.com', 0.28)
    const recoveryBefore = await weekRow(plan.id, MONDAY)
    expect(recoveryBefore.isRecovery).toBe(true)
    const revisionsBefore = await ctx.prisma.planRevision.count({ where: { planId: plan.id } })

    const made = await replanActivePlan(deps(), { userId: u.id, reason: 'weekly', today: MONDAY })
    expect(made).not.toBeNull()

    const revisions = await ctx.prisma.planRevision.findMany({ where: { planId: plan.id } })
    expect(revisions.length).toBe(revisionsBefore + 1)
    expect(made.summary).toContain(
      'Last week counts as the recovery week; this week repeats the loading week, up to',
    )
    assertCleanCopy(made.summary, 'revision summary')
    expect(made.decision).toMatchObject({ decision: 'progress', nextWeekTargetMin: plannedMin })

    const review = await client(ctx, u).get(`/api/reviews?from=${FIRST}&to=${FIRST}`)
    const [first] = review.body as Array<{ reason?: string; suggestedAction?: string }>
    expect(JSON.stringify(review.body)).toContain('counts as the recovery week')
    expect(JSON.stringify(review.body)).not.toContain('support a small increase')
    expect(first).toBeDefined()

    const repeat = await weekRow(plan.id, MONDAY)
    expect(repeat.isRecovery).toBe(false)
    expect(JSON.parse(repeat.flags)).toContain(BREAK_REPEAT_FLAG)
    expect(JSON.parse(repeat.flags)).not.toContain('recovery')
    expect(repeat.targetRunMin).toBeGreaterThan(recoveryBefore.targetRunMin)
    expect(repeat.targetRunMin).toBeLessThanOrEqual(plannedMin)

    // the loading weeks count from the repeat: the next recovery week is three loading weeks later
    const rows = await ctx.prisma.planWeek.findMany({
      where: {
        planId: plan.id,
        weekStart: { gte: MONDAY },
        isRecovery: true,
        phase: { notIn: ['taper', 'race'] },
      },
      orderBy: { weekStart: 'asc' },
    })
    expect(rows[0]!.weekStart).toBe(addDays(MONDAY, 21))
  })

  test('leaves a week run at 85% of its target to the plan as it stood', async () => {
    const { u, plan } = await seedPlan('br1-most@example.com', 0.85)
    const made = await replanActivePlan(deps(), { userId: u.id, reason: 'weekly', today: MONDAY })
    expect(made?.summary ?? '').not.toContain('counts as the recovery week')
    const week = await weekRow(plan.id, MONDAY)
    expect(week.isRecovery).toBe(true)
    expect(JSON.parse(week.flags)).not.toContain(BREAK_REPEAT_FLAG)
  })
})
