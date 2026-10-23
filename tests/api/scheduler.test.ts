import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import type { PlanRevisionView, PlanWithSessions } from '../../shared/types.ts'
import { runReplanJob, runWeatherJob } from '../../server/jobs/scheduler.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const NOW = new Date('2026-03-20T12:00:00Z')

let ctx: TestCtx
let user: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.activity.deleteMany()
})

function archiveBody() {
  const times = Array.from({ length: 24 }, (_, h) => `2026-03-02T${String(h).padStart(2, '0')}:00`)
  return {
    hourly: {
      time: times,
      temperature_2m: times.map((_, h) => h),
      relative_humidity_2m: times.map(() => 60),
      dew_point_2m: times.map(() => 4),
      wind_speed_10m: times.map(() => 10),
    },
  }
}

describe('runWeatherJob', () => {
  test('fills weather on activities that have a start location, for every user', async () => {
    const run = await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        type: 'run',
        date: '2026-03-02',
        durationSec: 1800,
        source: 'file',
        startUtc: '2026-03-02T07:40:00Z',
        startLat: 10.12,
        startLng: -20.34,
      },
    })
    let calls = 0
    const fetchFn = fakeFetch({
      [`GET ${ARCHIVE}`]: () => {
        calls += 1
        return Response.json(archiveBody())
      },
    })

    await runWeatherJob({ prisma: ctx.prisma, config: ctx.config }, { fetch: fetchFn, now: NOW })
    const filled = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })
    expect(filled).toMatchObject({ tempC: 8, humidityPct: 60, weatherSource: 'open-meteo' })
    expect(calls).toBe(1)

    await runWeatherJob({ prisma: ctx.prisma, config: ctx.config }, { fetch: fetchFn, now: NOW })
    expect(calls).toBe(1)
  })

  test('survives a failing lookup and leaves the activity for the next run', async () => {
    const run = await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        type: 'run',
        date: '2026-03-02',
        durationSec: 1800,
        source: 'file',
        startUtc: '2026-03-02T07:40:00Z',
        startLat: 10.12,
        startLng: -20.34,
      },
    })
    const down = fakeFetch({ [`GET ${ARCHIVE}`]: () => new Response('{}', { status: 503 }) })
    await runWeatherJob({ prisma: ctx.prisma, config: ctx.config }, { fetch: down, now: NOW })
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })
    expect(row.tempC).toBeNull()
  })
})

describe('runReplanJob', () => {
  // A Monday, as the job's slot is. Only Date is faked; promises and timers keep working.
  const MONDAY = new Date(2026, 9, 19, 12)
  const monday = todayIso(MONDAY)
  const nextMonday = addDays(monday, 7)

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(MONDAY)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('writes an automatic weekly revision: hidden when nothing changed, shown with its diff when it did', async () => {
    const u = await seedUser(ctx, { email: 'weekly-job@example.com' })
    const week = [
      { dow: 1, min: 40, distanceM: 6400 },
      { dow: 3, min: 45, distanceM: 7200 },
      { dow: 5, min: 35, distanceM: 5600 },
      { dow: 6, min: 70, distanceM: 11_000 },
    ]
    await ctx.prisma.activity.createMany({
      data: Array.from({ length: 12 }, (_, w) =>
        week.map((run) => ({
          userId: u.id,
          date: addDays(monday, -7 * (w + 1) + run.dow),
          type: 'run',
          durationSec: run.min * 60,
          movingSec: run.min * 60,
          distanceM: run.distanceM,
          rpe: 3,
          source: 'manual',
        })),
      ).flat(),
    })
    const goal = await ctx.prisma.goal.create({
      data: {
        userId: u.id,
        name: 'Synthetic half',
        priority: 'A',
        targetDate: addDays(monday, 7 * 3 + 5),
        distanceM: 21_097,
        goalType: 'finish',
      },
    })
    const c = client(ctx, u)
    const generated = await c.post('/api/plan/generate').send({ goalId: goal.id })
    expect(generated.status, JSON.stringify(generated.body)).toBe(201)
    const plan = generated.body as PlanWithSessions
    const deps = { prisma: ctx.prisma, config: ctx.config }

    // A quiet week: the update ran, wrote a revision, and the list does not show it.
    await runReplanJob(deps, { now: MONDAY })
    const quiet = await ctx.prisma.planRevision.findFirstOrThrow({
      where: { planId: plan.id, reason: 'weekly' },
    })
    expect(quiet).toMatchObject({ auto: true, undo: null })
    expect(quiet.diff).toContain('"empty":true')
    expect(
      ((await c.get('/api/plan/revisions')).body as PlanRevisionView[]).map((r) => r.reason),
    ).toEqual(['generate'])

    // A closed day moves next week's runs: the next update has a diff, a payload and shows up.
    const easy = plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
    const weekday = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][
      (new Date(`${easy.date}T00:00:00Z`).getUTCDay() + 6) % 7
    ]!
    const availability = JSON.stringify({ [weekday]: { available: false, maxMin: null } })
    await ctx.prisma.athleteProfile.upsert({
      where: { userId: u.id },
      create: { userId: u.id, availability },
      update: { availability },
    })
    vi.setSystemTime(new Date(MONDAY.getTime() + 60_000))
    await runReplanJob(deps, { now: new Date() })
    const listed = (await c.get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(listed.map((r) => r.reason)).toEqual(['weekly', 'generate'])
    expect(listed[0]).toMatchObject({ auto: true, diff: { empty: false }, seenAt: null })
    expect(listed[0]!.diff!.totals.added + listed[0]!.diff!.totals.removed).toBeGreaterThan(0)
    expect(
      (await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: listed[0]!.id } })).undo,
    ).not.toBeNull()
  })
})
