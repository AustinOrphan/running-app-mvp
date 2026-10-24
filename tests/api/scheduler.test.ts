import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import { FOLDER_SCAN_MINUTES } from '../../shared/limits.ts'
import type { PlanRevisionView, PlanWithSessions } from '../../shared/types.ts'
import {
  FOLDER_INTERVAL_MS,
  PUBLISH_INTERVAL_MS,
  PUBLISH_MORNING_SLOT,
  runPublishJob,
  runReplanJob,
  runWeatherJob,
  startScheduler,
} from '../../server/jobs/scheduler.ts'
import { settleBackground } from '../../server/services/sync.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'
import {
  connectIntervals,
  enablePublishing,
  fakeIntervals,
  place,
  seedRunner,
  type FakeIntervals,
} from './wristFixtures.ts'

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
    // the week's brief follows the re-plan and describes the revision it wrote, a quiet one too
    const briefKey = { userId_weekStart: { userId: u.id, weekStart: monday } }
    const quietBrief = await ctx.prisma.weeklyBrief.findUniqueOrThrow({ where: briefKey })
    expect(quietBrief).toMatchObject({ revisionId: quiet.id, provisional: false, planId: plan.id })
    expect(JSON.parse(quietBrief.facts)).toMatchObject({ weekStart: monday, replan: null })

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
    // the second update's brief takes the first one's place and counts the sessions it changed
    const changedBrief = await ctx.prisma.weeklyBrief.findUniqueOrThrow({ where: briefKey })
    expect(changedBrief.revisionId).toBe(listed[0]!.id)
    expect(
      (JSON.parse(changedBrief.facts) as { changes: { count: number } }).changes.count,
    ).toBeGreaterThan(0)
    expect(await ctx.prisma.weeklyBrief.count({ where: { userId: u.id } })).toBe(1)
  })

  test('honours a rest window created the evening before: the held days stay rest days', async () => {
    const u = await seedUser(ctx, { email: 'window-job@example.com' })
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
        targetDate: addDays(monday, 7 * 7 + 5),
        distanceM: 21_097,
        goalType: 'finish',
      },
    })
    const c = client(ctx, u)
    const generated = await c.post('/api/plan/generate').send({ goalId: goal.id })
    expect(generated.status, JSON.stringify(generated.body)).toBe(201)
    const plan = generated.body as PlanWithSessions
    // the week is run: the Monday update then has no layoff to account for
    await ctx.prisma.activity.createMany({
      data: [1, 3, 5].map((dow) => ({
        userId: u.id,
        date: addDays(monday, dow),
        type: 'run',
        durationSec: 2400,
        movingSec: 2400,
        distanceM: 6400,
        rpe: 3,
        source: 'manual',
      })),
    })

    // Sunday evening: ill on Monday and Tuesday of next week, reported through the route.
    const sunday = addDays(nextMonday, -1)
    vi.setSystemTime(new Date(`${sunday}T20:00:00`))
    const created = await c.post('/api/plan/disruptions').send({
      reason: 'illness-above-neck',
      mode: 'rest',
      startDate: nextMonday,
      endDate: addDays(nextMonday, 1),
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const held = [nextMonday, addDays(nextMonday, 1), addDays(nextMonday, 2)]
    const kindsOn = async () =>
      (await ctx.prisma.planSession.findMany({ where: { planId: plan.id, date: { in: held } } }))
        .map((s) => [s.date, s.kind])
        .sort()

    // Monday 03:00: the weekly job re-plans with the window in force and leaves the days alone.
    vi.setSystemTime(new Date(`${nextMonday}T03:00:00`))
    const deps = { prisma: ctx.prisma, config: ctx.config }
    await runReplanJob(deps, { now: new Date() })
    expect(await kindsOn()).toEqual(held.map((date) => [date, 'rest']))
    const weekly = await ctx.prisma.planRevision.findFirstOrThrow({
      where: { planId: plan.id, reason: { in: ['weekly', 'break'] } },
    })
    expect(weekly.auto).toBe(true)
    const run = await ctx.prisma.syncRun.findFirstOrThrow({
      where: { userId: u.id, provider: 'replan' },
      orderBy: { startedAt: 'desc' },
    })
    expect(run.status).toBe('ok')
    // and the window is still in force for the week it holds
    const windows = await ctx.prisma.disruption.findMany({ where: { userId: u.id } })
    expect(windows.map((w) => w.status)).toEqual(['active'])
    const week2 = await ctx.prisma.planWeek.findFirstOrThrow({
      where: { planId: plan.id, weekStart: nextMonday },
    })
    expect(JSON.parse(week2.flags)).toContain('disrupted')
  })
})

// ---------------------------------------------------------------------------------------------
// The publisher's jobs (design 6.8)
// ---------------------------------------------------------------------------------------------

describe('runPublishJob', () => {
  // A Wednesday at noon; only Date is faked, so the database and the promises keep working.
  const WEDNESDAY = new Date(2026, 9, 21, 12)
  const wednesday = todayIso(WEDNESDAY)
  const MINUTE = 60_000
  let fake: FakeIntervals

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(WEDNESDAY)
    fake = fakeIntervals()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await ctx.prisma.user.deleteMany({ where: { email: { startsWith: 'publish-job' } } })
  })

  const deps = () => ({ prisma: ctx.prisma, config: ctx.config })
  const job = (over: { now?: Date; force?: boolean } = {}) =>
    runPublishJob(deps(), { fetch: fake.fetch, ...over })
  const publishRuns = (userId: string) =>
    ctx.prisma.syncRun.findMany({ where: { userId, channel: 'publish' } })
  /** Calls that read the calendar: one per run, whatever the run did. */
  const reads = () => fake.made('GET', 'events').length

  async function runner(email: string, sessions = 1) {
    const seeded = await seedRunner(ctx, email, wednesday)
    await connectIntervals(ctx, seeded.u.id)
    await enablePublishing(ctx, seeded.u.id)
    const rows = await place(
      ctx,
      seeded.planId,
      Array.from({ length: sessions }, (_, i) => ({
        date: addDays(wednesday, i + 1),
        kind: 'easy' as const,
      })),
    )
    return { ...seeded, rows }
  }

  test('does nothing for a runner whose publishing is off, whose key is refused or who is paused', async () => {
    const off = await runner('publish-job-off@example.com')
    await ctx.prisma.deliveryChannel.updateMany({
      where: { userId: off.u.id },
      data: { enabled: false },
    })
    const stale = await runner('publish-job-stale@example.com')
    await ctx.prisma.integration.updateMany({
      where: { userId: stale.u.id },
      data: { status: 'needs_auth' },
    })
    const paused = await runner('publish-job-paused@example.com')
    await ctx.prisma.deliveryChannel.updateMany({
      where: { userId: paused.u.id },
      data: { pausedUntil: new Date(WEDNESDAY.getTime() + 10 * MINUTE) },
    })

    await job()
    await job({ force: true })

    expect(fake.calls).toEqual([])
    for (const { u } of [off, stale, paused]) expect(await publishRuns(u.id)).toEqual([])
  })

  test('runs when the key moved, a retry is due or 30 minutes passed, and a tick that finds nothing writes nothing', async () => {
    const { u } = await runner('publish-job-due@example.com', 2)

    // never run: due; the run is stored
    await job()
    expect(fake.events.size).toBe(2)
    expect(await publishRuns(u.id)).toMatchObject([
      { status: 'ok', accepted: 2, trigger: 'schedule' },
    ])

    // two minutes later nothing moved, nothing waits and 30 minutes have not passed
    fake.forget()
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 2 * MINUTE))
    await job()
    expect(fake.calls).toEqual([])
    expect(await publishRuns(u.id)).toHaveLength(1)

    // a state write moves the key: the next tick runs; it finds the same content, so it stores no row
    await ctx.prisma.planSession.updateMany({ data: { purpose: 'Edited.' } })
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 4 * MINUTE))
    await job()
    expect(reads()).toBe(1)
    expect(fake.calls.filter((call) => call.method !== 'GET')).toEqual([])
    expect(await publishRuns(u.id)).toHaveLength(1)

    // 30 minutes after the last run (at minute 4), with nothing changed, it runs again
    fake.forget()
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 33 * MINUTE))
    await job()
    expect(reads()).toBe(0)
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 34 * MINUTE))
    await job()
    expect(reads()).toBe(1)

    // midnight moves the key too
    fake.forget()
    vi.setSystemTime(new Date(2026, 9, 22, 0, 5))
    await job()
    expect(reads()).toBe(1)
  })

  test('a retry that is due runs, and one that is not due waits', async () => {
    const { u, rows } = await runner('publish-job-retry@example.com')
    fake.hooks.create = () => {
      throw new Error('socket closed')
    }
    await job()
    expect(
      await ctx.prisma.wristPublication.findFirstOrThrow({ where: { userId: u.id } }),
    ).toMatchObject({
      state: 'failed',
      failCode: 'network',
      externalId: rows[0]!.externalId,
    })
    delete fake.hooks.create

    // one minute on: the key and the clock say nothing, and the retry is two minutes out
    fake.forget()
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 1 * MINUTE))
    await job()
    expect(fake.calls).toEqual([])

    // two minutes on: the retry is due
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 2 * MINUTE))
    await job()
    expect(fake.made('POST', 'events/bulk')).toHaveLength(1)
    expect(
      await ctx.prisma.wristPublication.findFirstOrThrow({ where: { userId: u.id } }),
    ).toMatchObject({
      state: 'sent',
    })
  })

  test('a send that can no longer be made does not keep the tick running the publisher', async () => {
    const { u, planId } = await runner('publish-job-stale-row@example.com')
    await job()
    expect(fake.events.size).toBe(1)
    const stuck = (externalId: string, date: string) =>
      ctx.prisma.wristPublication.create({
        data: {
          userId: u.id,
          channel: 'intervals',
          externalId,
          date,
          kind: 'easy',
          title: 'Easy run',
          state: 'failed',
          desiredHash: 'old',
          failCode: 'auth',
          failMessage: 'intervals.icu did not accept the API key.',
          attempts: 1,
        },
      })

    // A 401 left the send of yesterday failed for a reconnect that came a day later. It waits for
    // nothing a run can do, so two minutes on the tick finds nothing due and reads nothing.
    await stuck('yesterday-session', addDays(wednesday, -1))
    fake.forget()
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 2 * MINUTE))
    await job()
    expect(fake.calls).toEqual([])

    // A session that was run while its send failed is due once: the run closes both rows.
    const [done] = await place(ctx, planId, [
      { date: wednesday, kind: 'easy', status: 'completed' },
    ])
    await stuck(done!.externalId, wednesday)
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 4 * MINUTE))
    await job()
    expect(reads()).toBe(1)
    expect(
      await ctx.prisma.wristPublication.findMany({
        where: { userId: u.id, externalId: { in: ['yesterday-session', done!.externalId] } },
        orderBy: { date: 'asc' },
      }),
    ).toMatchObject([
      { state: 'withdrawn', failCode: null, nextAttemptAt: null },
      { state: 'withdrawn', failCode: null, nextAttemptAt: null },
    ])
    expect(
      await ctx.prisma.wristPublication.count({ where: { userId: u.id, state: 'failed' } }),
    ).toBe(0)

    // and the next tick is quiet again
    fake.forget()
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 6 * MINUTE))
    await job()
    expect(fake.calls).toEqual([])
  })

  test('the forced run reads the calendar though nothing changed, and still respects a pause', async () => {
    const { u } = await runner('publish-job-force@example.com')
    await job()
    fake.forget()
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 5 * MINUTE))
    await job()
    expect(fake.calls).toEqual([])

    await job({ force: true })
    expect(reads()).toBe(1)

    fake.forget()
    await ctx.prisma.deliveryChannel.updateMany({
      where: { userId: u.id },
      data: { pausedUntil: new Date(WEDNESDAY.getTime() + 10 * MINUTE) },
    })
    await job({ force: true })
    expect(fake.calls).toEqual([])
  })

  test('one runner whose key cannot be read does not stop the next', async () => {
    const broken = await runner('publish-job-broken@example.com')
    await ctx.prisma.integration.updateMany({
      where: { userId: broken.u.id },
      data: { secret: 'v1.not.a.secret' },
    })
    const fine = await runner('publish-job-fine@example.com')

    await job()

    expect(
      (await ctx.prisma.integration.findFirstOrThrow({ where: { userId: broken.u.id } })).status,
    ).toBe('needs_auth')
    expect(await publishRuns(broken.u.id)).toMatchObject([{ status: 'error' }])
    expect(await publishRuns(fine.u.id)).toMatchObject([{ status: 'ok', accepted: 1 }])
  })
})

describe('the scheduler runs the publisher', () => {
  const WEDNESDAY_EARLY = new Date(2026, 9, 21, 4, 40)
  const wednesday = todayIso(WEDNESDAY_EARLY)
  const MINUTE = 60_000
  let fake: FakeIntervals

  beforeEach(() => {
    fake = fakeIntervals()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await settleBackground()
    await ctx.prisma.user.deleteMany({ where: { email: { startsWith: 'publish-sched' } } })
  })

  async function start(email: string) {
    const seeded = await seedRunner(ctx, email, wednesday)
    await connectIntervals(ctx, seeded.u.id)
    await enablePublishing(ctx, seeded.u.id)
    await place(ctx, seeded.planId, [{ date: addDays(wednesday, 1), kind: 'easy' }])
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    })
    vi.setSystemTime(WEDNESDAY_EARLY)
    const stop = startScheduler({ prisma: ctx.prisma, config: ctx.config }, { fetch: fake.fetch })
    return { ...seeded, stop }
  }
  const reads = () => fake.made('GET', 'events').length

  test('checks 30 s after start and every 2 minutes, never overlaps itself, and stops', async () => {
    expect(PUBLISH_INTERVAL_MS).toBe(2 * MINUTE)
    const { u, stop } = await start('publish-sched-tick@example.com')
    // hold the first run open on the calendar read
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    fake.hooks.list = async () => {
      await held
      return undefined
    }

    await vi.advanceTimersByTimeAsync(20_000)
    expect(reads()).toBe(0)
    await vi.advanceTimersByTimeAsync(11_000)
    await vi.waitFor(() => {
      expect(reads()).toBe(1)
    })
    // two more ticks come while the run is still open: they do nothing
    await vi.advanceTimersByTimeAsync(2 * PUBLISH_INTERVAL_MS)
    expect(reads()).toBe(1)

    release()
    delete fake.hooks.list
    await vi.waitFor(async () => {
      expect(await ctx.prisma.syncRun.count({ where: { userId: u.id, channel: 'publish' } })).toBe(
        1,
      )
    })
    expect(fake.events.size).toBe(1)

    // quiet while nothing moves; a write makes the next tick run
    await vi.advanceTimersByTimeAsync(PUBLISH_INTERVAL_MS)
    expect(reads()).toBe(1)
    await ctx.prisma.planSession.updateMany({ data: { purpose: 'Edited.' } })
    await vi.advanceTimersByTimeAsync(PUBLISH_INTERVAL_MS)
    await vi.waitFor(() => {
      expect(reads()).toBe(2)
    })

    stop()
    await vi.advanceTimersByTimeAsync(10 * PUBLISH_INTERVAL_MS)
    expect(reads()).toBe(2)
  })

  test('forces a run at 04:45 after matching and the Monday re-plan', async () => {
    expect(PUBLISH_MORNING_SLOT).toEqual({ hour: 4, minute: 45 })
    const { stop } = await start('publish-sched-morning@example.com')

    // the first tick sends the session; nothing changes after it
    await vi.advanceTimersByTimeAsync(31_000)
    await vi.waitFor(() => {
      expect(fake.events.size).toBe(1)
    })
    expect(reads()).toBe(1)
    await vi.advanceTimersByTimeAsync(8 * MINUTE)
    // 04:48:30: two-minute ticks found nothing due
    expect(reads()).toBe(1)

    // the daily check at 04:50 finds the 04:45 slot passed and forces a run, 10 minutes after the last
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    await vi.waitFor(() => {
      expect(reads()).toBe(2)
    })
    expect(fake.calls.filter((call) => call.method !== 'GET')).toHaveLength(1)

    // once per day
    await vi.advanceTimersByTimeAsync(20 * MINUTE)
    expect(reads()).toBe(2)
    stop()
  })
})

describe('the folder scan interval', () => {
  test('is the number of minutes the Integrations page names in its sentence', () => {
    expect(FOLDER_INTERVAL_MS).toBe(FOLDER_SCAN_MINUTES * 60_000)
  })
})
