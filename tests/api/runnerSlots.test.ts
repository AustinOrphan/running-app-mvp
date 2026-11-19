import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { isoDateInZone } from '../../shared/dates.ts'
import {
  runMatchingJob,
  runPredictionJob,
  runPublishJob,
  runReplanJob,
  runWatchRatingPass,
  runWeatherJob,
} from '../../server/jobs/scheduler.ts'
import { usersDueForWeeklyUpdate } from '../../server/jobs/weeklyUpdate.ts'
import type { RunnerDay } from '../../server/runnerDay.ts'
import { generateBrief } from '../../server/services/brief.ts'
import { runNightlyMatching } from '../../server/services/execution.ts'
import { replanActivePlan } from '../../server/services/planEngine.ts'
import { ensureWeeklyPrediction } from '../../server/services/predictionLog.ts'
import { CHANNEL as PUBLISH_CHANNEL, publishForUser } from '../../server/services/publish.ts'
import { backfillWatchRatings } from '../../server/services/watchRatingBackfill.ts'
import { refreshWeatherCaches } from '../../server/services/weatherCache.ts'
import {
  createTestCtx,
  expectNoRefusedFetches,
  noNetwork,
  seedUser,
  type TestCtx,
} from './helpers.ts'

// D10 step 3 (ADR 0022): the jobs take each runner's day from a `days` map, which these tests fill
// with zones other than the process's. The engine, the brief and the other callees are spies; the
// guard on the week's update and the choice of runners are the real code.
vi.mock('../../server/services/planEngine.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/services/planEngine.ts')>()),
  replanActivePlan: vi.fn(),
}))
vi.mock('../../server/services/brief.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/services/brief.ts')>()),
  generateBrief: vi.fn(),
}))
vi.mock('../../server/services/execution.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/services/execution.ts')>()),
  runNightlyMatching: vi.fn(),
}))
vi.mock('../../server/services/predictionLog.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/services/predictionLog.ts')>()),
  ensureWeeklyPrediction: vi.fn(),
}))
vi.mock('../../server/services/publish.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/services/publish.ts')>()),
  publishForUser: vi.fn(),
}))
vi.mock('../../server/services/watchRatingBackfill.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/services/watchRatingBackfill.ts')>()),
  backfillWatchRatings: vi.fn(),
}))
vi.mock('../../server/services/weatherCache.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/services/weatherCache.ts')>()),
  refreshWeatherCaches: vi.fn(),
}))

const utc = (iso: string): Date => new Date(`${iso}Z`)

/** A runner's day at `now` in `tz`, as the job's `days` map holds it. */
function dayIn(tz: string, now: Date): RunnerDay {
  return { tz, today: isoDateInZone(now, tz), now }
}

let ctx: TestCtx
let counter = 0

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.user.deleteMany()
  vi.mocked(replanActivePlan).mockImplementation(async (d, args) => {
    const plan = await d.prisma.plan.findFirstOrThrow({
      where: { userId: args.userId, status: 'active' },
    })
    return (await d.prisma.planRevision.create({
      data: { planId: plan.id, reason: args.reason, summary: 'Synthetic.' },
    })) as never
  })
  vi.mocked(generateBrief).mockResolvedValue(undefined)
  vi.mocked(runNightlyMatching).mockResolvedValue(undefined)
  vi.mocked(ensureWeeklyPrediction).mockResolvedValue('kept')
  vi.mocked(publishForUser).mockResolvedValue({ ran: false } as never)
  vi.mocked(backfillWatchRatings).mockResolvedValue({
    filled: 0,
    unrated: 0,
    requests: 0,
    failures: [],
    pause: null,
    authRefused: false,
    remaining: 0,
  })
  vi.mocked(refreshWeatherCaches).mockResolvedValue({ refreshed: 0, failed: 0, error: null })
})

afterEach(() => {
  for (const spy of [
    replanActivePlan,
    generateBrief,
    runNightlyMatching,
    ensureWeeklyPrediction,
    publishForUser,
    backfillWatchRatings,
    refreshWeatherCaches,
  ]) {
    vi.mocked(spy).mockReset()
  }
  expectNoRefusedFetches(ctx)
})

function deps() {
  return { prisma: ctx.prisma, config: ctx.config }
}

/** A runner with an active version-2 plan, built before the week in question. */
async function runner(over: { goalDate?: string; planCreatedAt?: Date } = {}) {
  counter += 1
  const user = await seedUser(ctx, { email: `slot${String(counter)}@example.com` })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: over.goalDate ?? '2027-01-09',
      distanceM: 21_097,
    },
  })
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      name: goal.name,
      startDate: '2026-10-05',
      raceWeekStart: '2027-01-04',
      generatorVersion: 2,
      status: 'active',
      createdAt: over.planCreatedAt ?? utc('2026-10-10T12:00:00'),
    },
  })
  return { userId: user.id, planId: plan.id }
}

async function revise(planId: string, reason: string, createdAt: Date) {
  return ctx.prisma.planRevision.create({
    data: { planId, reason, summary: 'Synthetic.', createdAt },
  })
}

async function briefFor(userId: string, weekStart: string, revisionId: string | null) {
  await ctx.prisma.weeklyBrief.create({
    data: { userId, weekStart, revisionId, version: 1, facts: '{}', provisional: false },
  })
}

// Monday 2026-10-19 at 03:30 UTC is Monday 05:30 in Berlin (UTC+2) and Sunday 20:30 in Los Angeles.
const NOW = utc('2026-10-19T03:30:00')

describe('the Monday re-plan and its brief, per runner', () => {
  test('each runner is re-planned and briefed on their own day and zone', async () => {
    const berlin = await runner()
    const la = await runner()
    const days = new Map([
      [berlin.userId, dayIn('Europe/Berlin', NOW)],
      [la.userId, dayIn('America/Los_Angeles', NOW)],
    ])

    await runReplanJob(deps(), { now: NOW, days })

    const replans = new Map(
      vi.mocked(replanActivePlan).mock.calls.map(([, args]) => [args.userId, args.today]),
    )
    expect(replans).toEqual(
      new Map([
        [berlin.userId, '2026-10-19'],
        [la.userId, '2026-10-18'],
      ]),
    )
    const briefs = new Map(
      vi.mocked(generateBrief).mock.calls.map(([, args]) => [args.userId, [args.today, args.tz]]),
    )
    expect(briefs).toEqual(
      new Map([
        [berlin.userId, ['2026-10-19', 'Europe/Berlin']],
        [la.userId, ['2026-10-18', 'America/Los_Angeles']],
      ]),
    )
  })

  test('userIds limits the job to the runners whose slot is due', async () => {
    const berlin = await runner()
    await runner()
    const days = new Map([[berlin.userId, dayIn('Europe/Berlin', NOW)]])

    await runReplanJob(deps(), { now: NOW, days, userIds: [berlin.userId] })

    expect(vi.mocked(replanActivePlan).mock.calls.map(([, args]) => args.userId)).toEqual([
      berlin.userId,
    ])
  })

  test('the catch-up serves the runners due on their own clock, and the goal date on their own day', async () => {
    // The goal's date is 18 October: passed for Berlin (19 October), still ahead for Los Angeles.
    const berlin = await runner({ goalDate: '2026-10-18' })
    const la = await runner({ goalDate: '2026-10-18' })
    const days = new Map([
      [berlin.userId, dayIn('Europe/Berlin', NOW)],
      [la.userId, dayIn('America/Los_Angeles', NOW)],
    ])

    await runReplanJob(deps(), { now: NOW, days, catchUp: true })

    expect(vi.mocked(replanActivePlan).mock.calls.map(([, args]) => args.userId)).toEqual([
      la.userId,
    ])
  })
})

describe('the week guard', () => {
  const due = async (userId: string, now: Date, tz: string) =>
    usersDueForWeeklyUpdate(ctx.prisma, now, userId, new Map([[userId, dayIn(tz, now)]]))

  test('a week with no update is due once the slot has come on the runner is clock', async () => {
    const { userId } = await runner()
    // 03:30 UTC Monday is Sunday evening in Los Angeles, whose week began on the 12th: still owed.
    expect(await due(userId, NOW, 'Europe/Berlin')).toEqual([userId])
    // One minute before Monday 03:00 in Berlin (01:00 UTC): not yet.
    expect(await due(userId, utc('2026-10-19T00:59:00'), 'Europe/Berlin')).toEqual([])
  })

  test('(i) a weekly revision and its brief hold when the runner moves 8 hours west across the slot', async () => {
    const { userId, planId } = await runner()
    // Written at Monday 03:00 in Berlin (01:00 UTC), described by the brief of the week of the 19th.
    const written = await revise(planId, 'weekly', utc('2026-10-19T01:00:00'))
    await briefFor(userId, '2026-10-19', written.id)
    // Los Angeles is UTC-7 in October: Monday 03:00 there is 10:00 UTC, after the revision.
    expect(await due(userId, utc('2026-10-19T11:00:00'), 'America/Los_Angeles')).toEqual([])
  })

  test('(ii) a weekly revision with no brief holds when the runner moves 2 hours west', async () => {
    const { userId, planId } = await runner()
    await revise(planId, 'weekly', utc('2026-10-19T01:00:00'))
    // UTC: Monday 03:00 is 03:00 UTC, after the revision, but Monday 00:00 is not.
    expect(await due(userId, utc('2026-10-19T05:00:00'), 'UTC')).toEqual([])
  })

  test('(iii) the cutover: a revision and brief written at the server slot hold for a runner 6 hours west', async () => {
    const { userId, planId } = await runner()
    const written = await revise(planId, 'weekly', utc('2026-10-19T01:00:00'))
    await briefFor(userId, '2026-10-19', written.id)
    // Chicago is UTC-5 in October: Monday 03:00 there is 08:00 UTC.
    expect(await due(userId, utc('2026-10-19T09:00:00'), 'America/Chicago')).toEqual([])
  })

  test('(iv) last week is late catch-up, with last week is brief, does not count after a move east', async () => {
    const { userId, planId } = await runner()
    // Written Sunday 23:30 in Chicago (04:30 UTC on the 19th), the last hour of the week of the 12th.
    const late = await revise(planId, 'weekly', utc('2026-10-19T04:30:00'))
    await briefFor(userId, '2026-10-12', late.id)
    // In Berlin that instant is Monday 06:30, after Monday 03:00 and 00:00; the brief is another week is.
    expect(await due(userId, utc('2026-10-19T05:00:00'), 'Europe/Berlin')).toEqual([userId])
  })

  test('(v) one zone, Monday 01:00: not updated and not due', async () => {
    const { userId } = await runner()
    expect(await due(userId, utc('2026-10-19T01:00:00'), 'UTC')).toEqual([])
  })

  test('a break revision counts as the update, and so does one that only another reason follows', async () => {
    const layoff = await runner()
    const edited = await runner()
    await revise(layoff.planId, 'break', utc('2026-10-19T04:00:00'))
    await revise(edited.planId, 'owner', utc('2026-10-19T04:00:00'))
    const days = new Map([
      [layoff.userId, dayIn('UTC', NOW)],
      [edited.userId, dayIn('UTC', NOW)],
    ])
    expect(await usersDueForWeeklyUpdate(ctx.prisma, NOW, undefined, days)).toEqual([edited.userId])
  })

  test('the 03:00 job skips a runner whose week the brief already holds', async () => {
    const { userId, planId } = await runner()
    const written = await revise(planId, 'weekly', utc('2026-10-19T01:00:00'))
    await briefFor(userId, '2026-10-19', written.id)
    const now = utc('2026-10-19T11:00:00')

    await runReplanJob(deps(), {
      now,
      days: new Map([[userId, dayIn('America/Los_Angeles', now)]]),
    })

    expect(replanActivePlan).not.toHaveBeenCalled()
  })
})

describe('the night slot, per runner', () => {
  test('matching sweeps each runner on their own day', async () => {
    const berlin = await runner()
    const la = await runner()
    const days = new Map([
      [berlin.userId, dayIn('Europe/Berlin', NOW)],
      [la.userId, dayIn('America/Los_Angeles', NOW)],
    ])

    await runMatchingJob(deps(), { now: NOW, days })

    const [, args] = vi.mocked(runNightlyMatching).mock.calls[0] ?? []
    expect(args?.todays).toEqual(
      new Map([
        [berlin.userId, '2026-10-19'],
        [la.userId, '2026-10-18'],
      ]),
    )
    const runs = await ctx.prisma.syncRun.findMany({ where: { provider: 'matching' } })
    expect(runs.map((run) => run.userId).sort()).toEqual([berlin.userId, la.userId].sort())
  })

  test('userIds limits matching to the runners whose slot is due, with one run each', async () => {
    const berlin = await runner()
    const la = await runner()
    const days = new Map([
      [berlin.userId, dayIn('Europe/Berlin', NOW)],
      [la.userId, dayIn('America/Los_Angeles', NOW)],
    ])

    await runMatchingJob(deps(), { now: NOW, days, userIds: [berlin.userId] })

    const [, args] = vi.mocked(runNightlyMatching).mock.calls[0] ?? []
    expect([...(args?.todays.keys() ?? [])]).toEqual([berlin.userId])
    const runs = await ctx.prisma.syncRun.findMany({ where: { provider: 'matching' } })
    expect(runs.map((run) => run.userId)).toEqual([berlin.userId])
  })
})

describe('the other jobs read each runner is own day', () => {
  test('predictions', async () => {
    const berlin = await runner()
    const la = await runner()
    const days = new Map([
      [berlin.userId, dayIn('Europe/Berlin', NOW)],
      [la.userId, dayIn('America/Los_Angeles', NOW)],
    ])

    await runPredictionJob(deps(), { now: NOW, days })

    expect(
      new Map(vi.mocked(ensureWeeklyPrediction).mock.calls.map(([, id, today]) => [id, today])),
    ).toEqual(
      new Map([
        [berlin.userId, '2026-10-19'],
        [la.userId, '2026-10-18'],
      ]),
    )
  })

  test('watch ratings', async () => {
    const berlin = await runner()
    const la = await runner()
    const days = new Map([
      [berlin.userId, dayIn('Europe/Berlin', NOW)],
      [la.userId, dayIn('America/Los_Angeles', NOW)],
    ])

    for (const [userId, day] of days) {
      await runWatchRatingPass(deps(), userId, { today: day.today, now: NOW })
    }

    expect(
      new Map(vi.mocked(backfillWatchRatings).mock.calls.map(([, id, opts]) => [id, opts?.today])),
    ).toEqual(
      new Map([
        [berlin.userId, '2026-10-19'],
        [la.userId, '2026-10-18'],
      ]),
    )
  })

  test('the weather sweep', async () => {
    const berlin = await runner()
    const la = await runner()
    const days = new Map([
      [berlin.userId, dayIn('Europe/Berlin', NOW)],
      [la.userId, dayIn('America/Los_Angeles', NOW)],
    ])

    await runWeatherJob(deps(), { fetch: noNetwork(), now: NOW, days })

    expect(
      new Map(vi.mocked(refreshWeatherCaches).mock.calls.map(([, id, opts]) => [id, opts?.today])),
    ).toEqual(
      new Map([
        [berlin.userId, '2026-10-19'],
        [la.userId, '2026-10-18'],
      ]),
    )
  })

  test('the publisher, forced and by the tick', async () => {
    const berlin = await runner()
    const la = await runner()
    for (const { userId } of [berlin, la]) {
      await ctx.prisma.deliveryChannel.create({
        data: { userId, channel: PUBLISH_CHANNEL, enabled: true },
      })
    }
    const days = new Map([
      [berlin.userId, dayIn('Europe/Berlin', NOW)],
      [la.userId, dayIn('America/Los_Angeles', NOW)],
    ])

    await runPublishJob(deps(), { fetch: noNetwork(), now: NOW, days, force: true })

    expect(
      new Map(vi.mocked(publishForUser).mock.calls.map(([, id, opts]) => [id, opts?.today])),
    ).toEqual(
      new Map([
        [berlin.userId, '2026-10-19'],
        [la.userId, '2026-10-18'],
      ]),
    )

    vi.mocked(publishForUser).mockClear()
    await runPublishJob(deps(), {
      fetch: noNetwork(),
      now: NOW,
      days,
      force: true,
      userIds: [la.userId],
    })
    expect(vi.mocked(publishForUser).mock.calls.map(([, id]) => id)).toEqual([la.userId])
  })
})
