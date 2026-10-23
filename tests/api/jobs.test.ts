import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf } from '../../shared/dates.ts'
import type { JobsView } from '../../shared/types.ts'
import {
  CATCHUP_INTERVAL_MS,
  REPLAN_SLOT,
  runMatchingJob,
  runReplanJob,
  runSyncJob,
  runWeatherJob,
  startScheduler,
  weekSlotStart,
} from '../../server/jobs/scheduler.ts'
import { runNightlyMatching } from '../../server/services/execution.ts'
import { replanActivePlan } from '../../server/services/planEngine.ts'
import { sealSecret } from '../../server/services/sync.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// The re-plan and the nightly matching are the engine's business and have their own tests; here
// they are spies that run the real code unless a test replaces them.
vi.mock('../../server/services/planEngine.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/planEngine.ts')>()
  return { ...original, replanActivePlan: vi.fn(original.replanActivePlan) }
})
vi.mock('../../server/services/execution.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/execution.ts')>()
  return { ...original, runNightlyMatching: vi.fn(original.runNightlyMatching) }
})

// A Wednesday at noon; Monday of that week is 19 October. Only Date is faked unless a test says so.
const WEDNESDAY = new Date(2026, 9, 21, 12)
const MONDAY = '2026-10-19'
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(WEDNESDAY)
  await ctx.prisma.user.deleteMany()
})

afterEach(() => {
  vi.mocked(replanActivePlan).mockReset()
  vi.mocked(runNightlyMatching).mockReset()
  vi.useRealTimers()
})

function deps() {
  return { prisma: ctx.prisma, config: ctx.config }
}

interface Fixture {
  user: TestUser
  planId: string
}

let counter = 0

/** A user with an active version-2 plan; `over` adjusts the plan or the goal's date. */
async function planFor(
  over: { generatorVersion?: number; status?: string; goalDate?: string } = {},
): Promise<Fixture> {
  counter += 1
  const user = await seedUser(ctx, { email: `runner${String(counter)}@example.com` })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: over.goalDate ?? addDays(MONDAY, 7 * 12 + 5),
      distanceM: 21_097,
    },
  })
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      name: goal.name,
      startDate: MONDAY,
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: over.generatorVersion ?? 2,
      status: over.status ?? 'active',
    },
  })
  return { user, planId: plan.id }
}

async function revise(planId: string, reason: string, createdAt: Date): Promise<void> {
  await ctx.prisma.planRevision.create({
    data: { planId, reason, summary: 'Synthetic.', createdAt },
  })
}

/** Stands in for the engine: writes the revision a real re-plan would. */
function replanWritesARevision(): void {
  vi.mocked(replanActivePlan).mockImplementation(async (d, args) => {
    const plan = await d.prisma.plan.findFirstOrThrow({
      where: { userId: args.userId, status: 'active' },
    })
    return (await d.prisma.planRevision.create({
      data: { planId: plan.id, reason: args.reason, summary: 'Synthetic.' },
    })) as never
  })
}

function replannedUsers(): string[] {
  return vi.mocked(replanActivePlan).mock.calls.map(([, args]) => args.userId)
}

async function jobRuns(userId: string, job?: string) {
  return ctx.prisma.syncRun.findMany({
    where: { userId, channel: 'job', ...(job ? { provider: job } : {}) },
    orderBy: { startedAt: 'asc' },
  })
}

describe('weekSlotStart', () => {
  test('is this week s Monday 03:00 once it has come, else null', () => {
    expect(weekSlotStart(at(19, 2, 59), REPLAN_SLOT)).toBeNull()
    expect(weekSlotStart(at(19, 3, 0), REPLAN_SLOT)).toEqual(at(19, 3, 0))
    expect(weekSlotStart(at(21, 12), REPLAN_SLOT)).toEqual(at(19, 3, 0))
    // Weeks start Monday (ADR 0003), so Sunday still belongs to the week that began on the 19th.
    expect(weekSlotStart(at(25, 23, 59), REPLAN_SLOT)).toEqual(at(19, 3, 0))
    expect(weekSlotStart(at(26, 2, 0), REPLAN_SLOT)).toBeNull()
    expect(weekSlotStart(at(26, 3, 0), REPLAN_SLOT)).toEqual(at(26, 3, 0))
  })

  test('the 03:00 Monday slot is unchanged', () => {
    expect(REPLAN_SLOT).toEqual({ weekday: 1, hour: 3, minute: 0 })
  })
})

describe('the weekly catch-up', () => {
  test('re-plans a plan with no weekly revision since this week s slot, with trigger catchup', async () => {
    const { user } = await planFor()
    replanWritesARevision()

    await runReplanJob(deps(), { now: new Date(), catchUp: true })

    expect(replannedUsers()).toEqual([user.id])
    expect(vi.mocked(replanActivePlan).mock.calls[0]?.[1]).toMatchObject({
      reason: 'weekly',
      today: '2026-10-21',
    })
    const [run, ...rest] = await jobRuns(user.id)
    expect(rest).toEqual([])
    expect(run).toMatchObject({
      provider: 'replan',
      channel: 'job',
      trigger: 'catchup',
      status: 'ok',
    })
  })

  test('does nothing for a plan that already had its weekly or break revision this week', async () => {
    const weekly = await planFor()
    const layoff = await planFor()
    await revise(weekly.planId, 'weekly', at(19, 3, 0))
    await revise(layoff.planId, 'break', at(20, 3, 1))
    replanWritesARevision()

    await runReplanJob(deps(), { now: new Date(), catchUp: true })

    expect(replannedUsers()).toEqual([])
    expect(await ctx.prisma.syncRun.count()).toBe(0)
  })

  test('counts only a weekly or break revision made since the slot', async () => {
    const lastWeek = await planFor()
    const otherReasons = await planFor()
    // Last Monday's update, and edits and a review after this Monday's slot: none is this week's update.
    await revise(lastWeek.planId, 'weekly', at(12, 3, 0))
    await revise(otherReasons.planId, 'generate', at(19, 9))
    await revise(otherReasons.planId, 'owner', at(20, 9))
    await revise(otherReasons.planId, 'review', at(20, 10))
    replanWritesARevision()

    await runReplanJob(deps(), { now: new Date(), catchUp: true })

    expect(new Set(replannedUsers())).toEqual(new Set([lastWeek.user.id, otherReasons.user.id]))
  })

  test('waits for the slot: nothing is due before Monday 03:00', async () => {
    await planFor()
    replanWritesARevision()
    vi.setSystemTime(at(19, 2, 59))
    await runReplanJob(deps(), { now: new Date(), catchUp: true })
    expect(replannedUsers()).toEqual([])

    vi.setSystemTime(at(19, 3, 0))
    await runReplanJob(deps(), { now: new Date(), catchUp: true })
    expect(replannedUsers()).toHaveLength(1)
  })

  test('skips archived plans, version-1 plans and goals whose date has passed', async () => {
    await planFor({ status: 'archived' })
    await planFor({ generatorVersion: 1 })
    await planFor({ goalDate: '2026-10-20' })
    const due = await planFor({ goalDate: '2026-10-21' })
    replanWritesARevision()

    await runReplanJob(deps(), { now: new Date(), catchUp: true })

    expect(replannedUsers()).toEqual([due.user.id])
  })

  test('a failed catch-up records an error, leaves the plan due and waits for the next tick', async () => {
    const { user } = await planFor()
    vi.mocked(replanActivePlan).mockRejectedValueOnce(
      new Error('The plan failed its checklist (Authorization: Bearer abcdef0123456789).'),
    )

    await runReplanJob(deps(), { now: new Date(), catchUp: true })
    expect(vi.mocked(replanActivePlan)).toHaveBeenCalledTimes(1)
    const [failed] = await jobRuns(user.id)
    expect(failed).toMatchObject({ trigger: 'catchup', status: 'error' })
    expect(failed?.message).toContain('checklist')
    expect(failed?.message).not.toContain('abcdef0123456789')
    expect(
      (
        await client(ctx, user)
          .get('/api/jobs')
          .then((res) => res.body as JobsView)
      ).weeklyUpdate.due,
    ).toBe(true)

    // The next tick tries again and succeeds.
    replanWritesARevision()
    await runReplanJob(deps(), { now: new Date(), catchUp: true })
    expect(vi.mocked(replanActivePlan)).toHaveBeenCalledTimes(2)
    expect((await jobRuns(user.id)).map((run) => run.status)).toEqual(['error', 'ok'])
    const view = (await client(ctx, user).get('/api/jobs')).body as JobsView
    expect(view.weeklyUpdate.due).toBe(false)
  })

  test('the 03:00 job still re-plans every version-2 plan, whatever revisions exist', async () => {
    const done = await planFor()
    const fresh = await planFor()
    await revise(done.planId, 'weekly', at(19, 3, 0))
    replanWritesARevision()

    await runReplanJob(deps(), { now: new Date() })

    expect(new Set(replannedUsers())).toEqual(new Set([done.user.id, fresh.user.id]))
    const [run] = await jobRuns(done.user.id)
    expect(run).toMatchObject({ provider: 'replan', trigger: 'schedule', status: 'ok' })
  })

  test('a user whose re-plan is already running is skipped and records nothing', async () => {
    const { user } = await planFor()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(replanActivePlan).mockImplementation(async () => {
      await gate
      return {} as never
    })

    const slot = runReplanJob(deps(), { now: new Date() })
    await vi.waitFor(() => {
      expect(vi.mocked(replanActivePlan)).toHaveBeenCalledTimes(1)
    })
    await runReplanJob(deps(), { now: new Date(), catchUp: true })
    expect(vi.mocked(replanActivePlan)).toHaveBeenCalledTimes(1)
    release()
    await slot
    expect((await jobRuns(user.id)).map((run) => run.trigger)).toEqual(['schedule'])
  })

  test('a real re-plan after a missed Monday writes the weekly revision and clears the due flag', async () => {
    counter += 1
    const user = await seedUser(ctx, { email: `real${String(counter)}@example.com` })
    for (let w = 1; w <= 12; w += 1) {
      for (const dow of [1, 3, 5, 6]) {
        const date = addDays(MONDAY, -7 * w + dow)
        await ctx.prisma.activity.create({
          data: {
            userId: user.id,
            type: 'run',
            date,
            durationSec: 45 * 60,
            distanceM: 8000,
            source: 'manual',
            startUtc: `${date}T07:00:00Z`,
          },
        })
      }
    }
    const goal = await ctx.prisma.goal.create({
      data: {
        userId: user.id,
        name: 'Synthetic half',
        priority: 'A',
        targetDate: addDays(MONDAY, 7 * 14 + 5),
        distanceM: 21_097,
        goalType: 'finish',
      },
    })
    // Generated a week earlier; the server was then down for the Monday slot.
    vi.setSystemTime(new Date(2026, 9, 14, 12))
    const generated = await client(ctx, user).post('/api/plan/generate').send({ goalId: goal.id })
    expect(generated.status, JSON.stringify(generated.body)).toBe(201)
    vi.setSystemTime(at(19, 9))

    expect(((await client(ctx, user).get('/api/jobs')).body as JobsView).weeklyUpdate).toEqual({
      due: true,
      lastRevisionAt: null,
    })
    await runReplanJob(deps(), { now: new Date(), catchUp: true })

    const reasons = (await ctx.prisma.planRevision.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (revision) => revision.reason,
    )
    expect(reasons).toEqual(['generate', 'weekly'])
    const view = (await client(ctx, user).get('/api/jobs')).body as JobsView
    expect(view.weeklyUpdate.due).toBe(false)
    expect(view.weeklyUpdate.lastRevisionAt).toBe(at(19, 9).toISOString())
    expect(view.jobs).toMatchObject([{ provider: 'replan', trigger: 'catchup', status: 'ok' }])
  })
})

describe('the scheduler runs the catch-up', () => {
  test('30 s after start and every 6 hours, until stopped', async () => {
    const { user } = await planFor()
    vi.useRealTimers()
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    })
    vi.setSystemTime(WEDNESDAY)
    // A re-plan that always fails stays due, so every tick tries it.
    vi.mocked(replanActivePlan).mockRejectedValue(new Error('blocked'))
    const never = (() => Promise.reject(new Error('no network in tests'))) as typeof fetch
    const stop = startScheduler(deps(), { fetch: never })

    const catchups = () =>
      ctx.prisma.syncRun.count({
        where: { userId: user.id, provider: 'replan', trigger: 'catchup' },
      })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await catchups()).toBe(0)
    await vi.advanceTimersByTimeAsync(11_000)
    await vi.waitFor(async () => {
      expect(await catchups()).toBe(1)
    })
    await vi.advanceTimersByTimeAsync(CATCHUP_INTERVAL_MS)
    await vi.waitFor(async () => {
      expect(await catchups()).toBe(2)
    })
    expect(CATCHUP_INTERVAL_MS).toBe(6 * 60 * 60_000)

    stop()
    await vi.advanceTimersByTimeAsync(2 * CATCHUP_INTERVAL_MS)
    expect(await catchups()).toBe(2)
  })
})

describe('job runs', () => {
  test('the weather job records one run per user, with the count it filled', async () => {
    const { user } = await planFor()
    await ctx.prisma.activity.create({
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
    const times = Array.from(
      { length: 24 },
      (_, h) => `2026-03-02T${String(h).padStart(2, '0')}:00`,
    )
    const archive = 'https://archive-api.open-meteo.com/v1/archive'
    const fetchFn = fakeFetch({
      [`GET ${archive}`]: () =>
        Response.json({
          hourly: {
            time: times,
            temperature_2m: times.map((_, h) => h),
            relative_humidity_2m: times.map(() => 60),
            dew_point_2m: times.map(() => 4),
            wind_speed_10m: times.map(() => 10),
          },
        }),
    })
    await runWeatherJob(deps(), { fetch: fetchFn, now: new Date(2026, 2, 20, 12) })
    // The next runs have nothing left to fill. The job wakes every 10 minutes, so an idle run
    // would push the runs with something to say out of the 200 kept: it is not stored.
    await runWeatherJob(deps(), { fetch: fetchFn, now: new Date(2026, 2, 20, 12) })
    await runWeatherJob(deps(), { fetch: fetchFn, now: new Date(2026, 2, 20, 12) })

    const runs = await jobRuns(user.id, 'weather')
    expect(runs.map((run) => [run.status, run.accepted, run.trigger])).toEqual([
      ['ok', 1, 'schedule'],
    ])
  })

  test('an idle weather run is stored once after a failed one, and not again', async () => {
    const { user } = await planFor()
    const down = fakeFetch({
      'GET https://archive-api.open-meteo.com/v1/archive': () =>
        new Response('{}', { status: 503 }),
    })
    const activity = await ctx.prisma.activity.create({
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
    const now = new Date(2026, 2, 20, 12)
    await runWeatherJob(deps(), { fetch: down, now })
    await runWeatherJob(deps(), { fetch: down, now })
    // A failure is always stored; the latest weather run is an error until a run says otherwise.
    expect((await jobRuns(user.id, 'weather')).map((run) => run.status)).toEqual(['error', 'error'])

    // The lookup has nothing left to do (the activity is gone): the recovery is stored once.
    await ctx.prisma.activity.delete({ where: { id: activity.id } })
    await runWeatherJob(deps(), { fetch: down, now })
    await runWeatherJob(deps(), { fetch: down, now })
    await runWeatherJob(deps(), { fetch: down, now })
    expect((await jobRuns(user.id, 'weather')).map((run) => run.status)).toEqual([
      'error',
      'error',
      'ok',
    ])
    const jobs = (await client(ctx, user).get('/api/jobs')).body as JobsView
    expect(jobs.jobs.map((job) => [job.provider, job.status])).toContainEqual(['weather', 'ok'])
  })

  test('a failing weather lookup records an error run and the job goes on', async () => {
    const { user } = await planFor()
    await ctx.prisma.activity.create({
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
    const down = fakeFetch({
      'GET https://archive-api.open-meteo.com/v1/archive': () =>
        new Response('{}', { status: 503 }),
    })
    await runWeatherJob(deps(), { fetch: down, now: new Date(2026, 2, 20, 12) })
    const [run] = await jobRuns(user.id, 'weather')
    expect(run).toMatchObject({ status: 'error', accepted: 0 })
    expect(run?.message).toBeTruthy()
  })

  test('the matching job records a run for each user with a plan, an error for one that failed', async () => {
    const good = await planFor()
    const bad = await planFor()
    vi.mocked(runNightlyMatching).mockImplementation((_deps, args) => {
      args.onError?.(new Error('could not match'), bad.user.id)
      return Promise.resolve()
    })
    await runMatchingJob(deps(), { now: new Date() })
    expect(await jobRuns(good.user.id, 'matching')).toMatchObject([{ status: 'ok' }])
    expect(await jobRuns(bad.user.id, 'matching')).toMatchObject([
      { status: 'error', message: 'could not match' },
    ])
  })

  test('the sync job sums up the pulls it caused: the worst status and the counts', async () => {
    const { user } = await planFor()
    await ctx.prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'intervals',
        status: 'connected',
        secret: sealSecret({ apiKey: 'synthetic-key-0123456789' }, ctx.config.sessionSecret),
        config: JSON.stringify({ athleteId: 'i1001' }),
      },
    })
    const base = 'https://intervals.icu/api/v1'
    const limited = fakeFetch({
      [`GET ${base}/athlete/i1001/activities`]: () =>
        new Response('{}', { status: 429, headers: { 'retry-after': '120' } }),
    })
    await runSyncJob(deps(), { fetch: limited })

    const [pull] = await ctx.prisma.syncRun.findMany({ where: { channel: 'pull' } })
    expect(pull).toMatchObject({ status: 'paused', trigger: 'schedule' })
    expect(await jobRuns(user.id, 'sync')).toMatchObject([
      { status: 'paused', trigger: 'schedule', accepted: 0 },
    ])
  })
})

describe('GET /api/jobs', () => {
  test('answers the latest run of each job and the weekly update', async () => {
    const { user } = await planFor()
    replanWritesARevision()
    await runReplanJob(deps(), { now: new Date() })
    vi.setSystemTime(at(22, 9))
    await runReplanJob(deps(), { now: new Date(), catchUp: true })
    // The newest catch-up found the update done and ran nothing, so the latest run is the first.
    await ctx.prisma.syncRun.create({
      data: {
        userId: user.id,
        provider: 'weather',
        channel: 'job',
        trigger: 'schedule',
        status: 'error',
        message: 'down',
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    })

    const res = await client(ctx, user).get('/api/jobs')
    expect(res.status).toBe(200)
    const view = res.body as JobsView
    expect(view.jobs.map((job) => [job.provider, job.channel, job.status, job.trigger])).toEqual([
      ['weather', 'job', 'error', 'schedule'],
      ['replan', 'job', 'ok', 'schedule'],
    ])
    expect(view.weeklyUpdate).toEqual({
      due: false,
      lastRevisionAt: WEDNESDAY.toISOString(),
    })
  })

  test('says the update is due when this week has none, and not due before the slot', async () => {
    const { user } = await planFor()
    expect(((await client(ctx, user).get('/api/jobs')).body as JobsView).weeklyUpdate).toEqual({
      due: true,
      lastRevisionAt: null,
    })
    vi.setSystemTime(at(19, 2, 0))
    expect(((await client(ctx, user).get('/api/jobs')).body as JobsView).weeklyUpdate.due).toBe(
      false,
    )
  })

  test('is not due for a user without a plan, and lists no jobs', async () => {
    counter += 1
    const user = await seedUser(ctx, { email: `bare${String(counter)}@example.com` })
    const res = await client(ctx, user).get('/api/jobs')
    expect(res.body).toEqual({ jobs: [], weeklyUpdate: { due: false, lastRevisionAt: null } })
  })

  test('is scoped to the signed-in user and needs a session', async () => {
    const mine = await planFor()
    const theirs = await planFor()
    replanWritesARevision()
    await runReplanJob(deps(), { now: new Date() })
    await ctx.prisma.syncRun.deleteMany({ where: { userId: theirs.user.id } })
    expect(((await client(ctx, mine.user).get('/api/jobs')).body as JobsView).jobs).toHaveLength(1)
    expect(((await client(ctx, theirs.user).get('/api/jobs')).body as JobsView).jobs).toHaveLength(
      0,
    )
    expect((await client(ctx).get('/api/jobs')).status).toBe(401)
  })

  test('has no secrets or tokens in a stored job error', async () => {
    const { user } = await planFor()
    vi.mocked(replanActivePlan).mockRejectedValue(
      new Error('boom https://example.com/x?access_token=abcdef0123456789 Bearer fedcba9876543210'),
    )
    await runReplanJob(deps(), { now: new Date() })
    const text = JSON.stringify((await client(ctx, user).get('/api/jobs')).body)
    expect(text).not.toContain('abcdef0123456789')
    expect(text).not.toContain('fedcba9876543210')
    expect(text).toContain('boom')
  })
})
