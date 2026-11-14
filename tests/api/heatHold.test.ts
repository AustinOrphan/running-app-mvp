// The first hot days hold a build week through the re-plan [rules J5, I8; task HH1]: the forecast comes
// from the cache the weather job fills, never from the request, and the held week keeps its long run.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import { HEAT_HOLD_FLAG } from '../../shared/engine/heat.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import { refreshWeatherCaches, settleWeatherCache } from '../../server/services/weatherCache.ts'
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
// re-planned in the week of 26 October, so the week reviewed is the recovery week and the week held
// is the loading week after it.
const GENERATED = new Date(2026, 9, 14, 12) // Wednesday 14 October 2026
const REPLANNED = new Date(2026, 9, 28, 12) // Wednesday 28 October 2026
const FIRST = '2026-10-12'
const COMING = '2026-10-26'

vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(GENERATED)

let ctx: TestCtx

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

/** The seven-day forecast of the weather job, hot (`hotC`) from 09:00 to 20:00 on each given day offset. */
async function fillForecast(userId: string, hotDays: number[], hotC: number): Promise<void> {
  ctx.fetch = fakeFetch({
    'GET https://api.open-meteo.com/v1/forecast': () => {
      const times = Array.from({ length: 7 * 24 }, (_, i) => {
        const date = addDays('2026-10-28', Math.floor(i / 24))
        return `${date}T${String(i % 24).padStart(2, '0')}:00`
      })
      const hot = (i: number) => hotDays.includes(Math.floor(i / 24)) && i % 24 >= 9 && i % 24 < 20
      return Response.json({
        hourly: {
          time: times,
          temperature_2m: times.map((_, i) => (hot(i) ? hotC : 14)),
          relative_humidity_2m: times.map(() => 50),
          dew_point_2m: times.map(() => 8),
          wind_speed_10m: times.map(() => 5),
          shortwave_radiation: times.map((_, i) => (i % 24 >= 8 && i % 24 < 18 ? 500 : 0)),
        },
      })
    },
  })
  await refreshWeatherCaches(ctx, userId)
  ctx.fetch = noNetwork(ctx.refusedFetches)
}

/** A mild archive for the race-day climate the plan reads from the home place, one answer for each year asked. */
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

/** A runner with a plan made a week ago for a half marathon 14 weeks out, last week run, and a home. */
async function seedPlan(email: string): Promise<{ u: TestUser; plan: PlanWithSessions }> {
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
  const coming = await weekRow((res.body as PlanWithSessions).id, COMING)
  // the loading week is run at 85% of what the plan had for the week after the recovery week, and the
  // recovery week at 70% of that, so the level to hold at is the loading week's, not the recovery week's
  const level = Math.round(coming.targetRunMin * 0.85)
  await seedWeek(u.id, FIRST, level)
  await seedWeek(u.id, addDays(FIRST, 7), Math.round(level * 0.7))
  vi.setSystemTime(REPLANNED)
  return { u, plan: res.body as PlanWithSessions }
}

async function minutesRunIn(userId: string, weekStart: string): Promise<number> {
  const rows = await ctx.prisma.activity.findMany({
    where: { userId, date: { gte: weekStart, lte: addDays(weekStart, 6) }, type: 'run' },
  })
  return Math.round(rows.reduce((n, r) => n + r.durationSec, 0) / 60)
}

const weekRow = async (planId: string, weekStart: string) =>
  ctx.prisma.planWeek.findUniqueOrThrow({ where: { planId_weekStart: { planId, weekStart } } })

describe('the first hot days through the weekly re-plan', () => {
  test('a hot forecast holds the coming build week at last week, long run in place', async () => {
    const { u, plan } = await seedPlan('hh1-hot@example.com')
    const before = await weekRow(plan.id, COMING)
    const ran = await minutesRunIn(u.id, FIRST)
    expect(before.targetRunMin).toBeGreaterThan(ran)
    await fillForecast(u.id, [0, 1, 2], 30)

    const res = await client(ctx, u).post('/api/plan/replan').send({})
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const after = await weekRow(plan.id, COMING)
    expect(JSON.parse(after.flags)).toContain(HEAT_HOLD_FLAG)
    expect(after.targetRunMin).toBeLessThanOrEqual(ran)
    expect(after.longRunMin).toBe(before.longRunMin)
    const sessions = await ctx.prisma.planSession.findMany({
      where: { planId: plan.id, weekStart: COMING },
    })
    expect(sessions.some((s) => s.status === 'downgraded')).toBe(false)
    const run = sessions
      .filter((s) => s.kind !== 'strength' && s.kind !== 'rest')
      .reduce((n, s) => n + s.durationMin, 0)
    expect(run).toBeLessThanOrEqual(ran)
  })

  test('a forecast that stays cool, or a cold cache, holds nothing', async () => {
    const cool = await seedPlan('hh1-cool@example.com')
    await fillForecast(cool.u.id, [], 30)
    expect((await client(ctx, cool.u).post('/api/plan/replan').send({})).status).toBe(200)
    const after = await weekRow(cool.plan.id, COMING)
    expect(JSON.parse(after.flags)).not.toContain(HEAT_HOLD_FLAG)

    // no filled cell and no hot run: no forecast, and the request waits for nothing
    await ctx.prisma.forecastCache.deleteMany()
    expect((await client(ctx, cool.u).post('/api/plan/replan').send({})).status).toBe(200)
    const cold = await weekRow(cool.plan.id, COMING)
    expect(JSON.parse(cold.flags)).not.toContain(HEAT_HOLD_FLAG)
    expect(cold.targetRunMin).toBe(after.targetRunMin)
  })
})
