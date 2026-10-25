// The distance estimate in the plan payload (STATUS follow-up 17): `GET /api/plan` serves each
// session's estimate and each week's, worked out from the zones as they are now and never stored.
// Today and the brief have their own cases in `today-coach.test.ts` and `brief.test.ts`.
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { ZoneSet } from '../../shared/engine/types.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import { client, createTestCtx, expectNoRefusedFetches, seedUser, type TestCtx } from './helpers.ts'

// A Wednesday at noon. Only Date is faked; timers and promises keep working.
const NOON = new Date(2026, 9, 21, 12)
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(NOON)

const today = todayIso()
const thisMonday = mondayOf(today)
const nextMonday = addDays(thisMonday, 7)

let ctx: TestCtx
let nextUser = 1

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

const EASY_TARGET = JSON.stringify({
  zone: 'z1',
  rpe: [2, 3],
  hr: null,
  paceSecPerKm: null,
  heatNote: null,
})
// A stored work pace of 330 to 310 s/km: the session is run at 320.
const THRESHOLD_TARGET = JSON.stringify({
  zone: 'z2',
  rpe: [6, 7],
  hr: null,
  paceSecPerKm: [330, 310],
  heatNote: null,
})

interface Seed {
  date: string
  kind: string
  min: number
  status?: string
  distanceM?: number
}

/**
 * A runner with a version-2 plan of hand-made sessions. With `pace`, the profile holds a tested
 * threshold pace and a run three days ago stands in the history, so the zones carry pace.
 */
async function runner(sessions: Seed[], opts: { pace: boolean; generatorVersion?: number }) {
  const u = await seedUser(ctx, { email: `estimate-${String(nextUser++)}@example.com` })
  await ctx.prisma.athleteProfile.create({
    data: {
      userId: u.id,
      hrMax: 190,
      hrRest: 50,
      timezone: 'UTC',
      ...(opts.pace ? { thresholdPaceSecPerKm: 300 } : {}),
    },
  })
  if (opts.pace) {
    await ctx.prisma.activity.create({
      data: {
        userId: u.id,
        date: addDays(today, -3),
        type: 'run',
        durationSec: 40 * 60,
        distanceM: 7000,
        source: 'manual',
      },
    })
  }
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic race',
      priority: 'A',
      targetDate: addDays(today, 7 * 12 + 5),
      distanceM: 21_097,
    },
  })
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: u.id,
      goalId: goal.id,
      name: goal.name,
      startDate: thisMonday,
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: opts.generatorVersion ?? 2,
      weeks: {
        create: [thisMonday, nextMonday].map((weekStart, index) => ({
          weekStart,
          index,
          phase: 'build',
          baselineRunMin: 200,
          targetRunMin: 200,
          longRunMin: 70,
          runDays: 4,
          strengthSessions: 0,
        })),
      },
    },
  })
  for (const [i, s] of sessions.entries()) {
    await ctx.prisma.planSession.create({
      data: {
        planId: plan.id,
        externalId: randomUUID(),
        weekStart: mondayOf(s.date),
        date: s.date,
        order: i,
        kind: s.kind,
        title: `${s.kind} session`,
        durationMin: s.min,
        distanceM: s.distanceM ?? null,
        structure: '[]',
        target: s.kind === 'threshold' ? THRESHOLD_TARGET : EASY_TARGET,
        purpose: 'Synthetic.',
        status: s.status ?? 'planned',
      },
    })
  }
  return { u, plan }
}

async function planOf(u: { id: string; email: string }): Promise<PlanWithSessions> {
  const res = await client(ctx, u as Parameters<typeof client>[1]).get('/api/plan')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as PlanWithSessions
}

const middleOf = (range: readonly [number, number]) => (range[0] + range[1]) / 2
const metresAt = (minutes: number, secPerKm: number) =>
  Math.round(((minutes * 60) / secPerKm) * 1000)

describe('GET /api/plan: the distance estimate', () => {
  test('each session and each week carries the estimate worked out from the current zones', async () => {
    const { u } = await runner(
      [
        { date: addDays(thisMonday, 1), kind: 'easy', min: 40 },
        { date: addDays(thisMonday, 3), kind: 'threshold', min: 50 },
        { date: addDays(thisMonday, 4), kind: 'strength', min: 30 },
        { date: addDays(thisMonday, 5), kind: 'long', min: 90 },
        { date: addDays(nextMonday, 1), kind: 'easy', min: 45 },
      ],
      { pace: true },
    )
    const zones = (await client(ctx, u).get('/api/zones')).body as ZoneSet
    expect(zones.pace).not.toBeNull()
    const easy = middleOf(zones.pace!.z1)
    const plan = await planOf(u)

    expect(plan.sessions.map((s) => [s.kind, s.distanceEstimate])).toEqual([
      ['easy', { distanceM: metresAt(40, easy), basis: 'easy' }],
      ['threshold', { distanceM: metresAt(50, 320), basis: 'pace' }],
      ['strength', null],
      ['long', { distanceM: metresAt(90, easy), basis: 'easy' }],
      ['easy', { distanceM: metresAt(45, easy), basis: 'easy' }],
    ])
    // A week is the sum of its runs; a strength session adds nothing.
    expect(plan.weeks.map((w) => [w.weekStart, w.distanceEstimateM])).toEqual([
      [thisMonday, metresAt(40, easy) + metresAt(50, 320) + metresAt(90, easy)],
      [nextMonday, metresAt(45, easy)],
    ])
  })

  test('a skipped run is not part of the week, and a race leaves the week without a figure', async () => {
    const { u } = await runner(
      [
        { date: addDays(thisMonday, 1), kind: 'easy', min: 40 },
        { date: addDays(thisMonday, 2), kind: 'easy', min: 40, status: 'skipped' },
        { date: addDays(nextMonday, 1), kind: 'easy', min: 40 },
        { date: addDays(nextMonday, 5), kind: 'race', min: 120 },
      ],
      { pace: true },
    )
    const plan = await planOf(u)
    const zones = (await client(ctx, u).get('/api/zones')).body as ZoneSet
    expect(plan.weeks[0]!.distanceEstimateM).toBe(metresAt(40, middleOf(zones.pace!.z1)))
    expect(plan.sessions.find((s) => s.kind === 'race')!.distanceEstimate).toBeNull()
    expect(plan.weeks[1]!.distanceEstimateM).toBeNull()
  })

  test('a runner with no pace data has null everywhere, never a guess', async () => {
    const { u } = await runner(
      [
        { date: addDays(thisMonday, 1), kind: 'easy', min: 40 },
        { date: addDays(thisMonday, 5), kind: 'long', min: 90 },
      ],
      { pace: false },
    )
    const plan = await planOf(u)
    expect(plan.zones?.pace ?? null).toBeNull()
    expect(plan.sessions.map((s) => s.distanceEstimate)).toEqual([null, null])
    expect(plan.weeks.map((w) => w.distanceEstimateM)).toEqual([null, null])
  })

  test('a version-1 plan has no sessions and no estimate', async () => {
    const { u } = await runner([], { pace: true, generatorVersion: 1 })
    const plan = await planOf(u)
    expect(plan.sessions).toEqual([])
    expect(plan.weeks.map((w) => w.distanceEstimateM)).toEqual([null, null])
  })

  test('is read-only: it follows a change of zones, and the stored plan is not touched', async () => {
    const { u, plan: stored } = await runner(
      [{ date: addDays(thisMonday, 1), kind: 'easy', min: 60, distanceM: 9000 }],
      { pace: true },
    )
    const before = (await planOf(u)).sessions[0]!.distanceEstimate!.distanceM
    const rowsBefore = await ctx.prisma.planSession.findMany({ where: { planId: stored.id } })

    await ctx.prisma.athleteProfile.update({
      where: { userId: u.id },
      data: { thresholdPaceSecPerKm: 270 },
    })
    const after = (await planOf(u)).sessions[0]!.distanceEstimate!.distanceM
    expect(after).toBeGreaterThan(before)

    // Nothing was written: the rows, the engine's own distance and the revisions are as they were.
    const rowsAfter = await ctx.prisma.planSession.findMany({ where: { planId: stored.id } })
    expect(rowsAfter).toEqual(rowsBefore)
    expect(rowsAfter[0]!.distanceM).toBe(9000)
    expect(rowsAfter[0]).not.toHaveProperty('distanceEstimate')
    expect(await ctx.prisma.planRevision.count({ where: { planId: stored.id } })).toBe(0)
  })

  test('serves a runner only their own plan', async () => {
    const mine = await runner([{ date: addDays(thisMonday, 1), kind: 'easy', min: 40 }], {
      pace: true,
    })
    const other = await seedUser(ctx, { email: `estimate-${String(nextUser++)}@example.com` })
    expect((await client(ctx, other).get('/api/plan')).body).toBeNull()
    expect((await planOf(mine.u)).sessions).toHaveLength(1)
  })
})
