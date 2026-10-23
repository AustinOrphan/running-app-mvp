import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { ExecutionAssessment } from '../../shared/engine/types.ts'
import type {
  ParsedActivity,
  PlanRevision,
  PlanWithSessions,
  TodayView,
  ZoneProposalView,
} from '../../shared/types.ts'
import {
  dueSlot,
  MATCHING_SLOT,
  REPLAN_SLOT,
  runMatchingJob,
  runReplanJob,
} from '../../server/jobs/scheduler.ts'
import { storeParsed } from '../../server/services/activityStore.ts'
import { runExecutionForActivity, runNightlyMatching } from '../../server/services/execution.ts'
import { refreshWeatherCaches } from '../../server/services/weatherCache.ts'
import { fakeFetch } from '../fakeFetch.ts'
import {
  blockNetwork,
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
} from './helpers.ts'

// The file parser's summary is a separate task; this stand-in keeps the store test independent.
vi.mock('../../shared/importers/files/summarize.ts', () => ({
  summarize: (parsed: ParsedActivity) => ({
    movingSec: parsed.elapsedSec,
    hrHistogram: null,
    decouplingPct: null,
    gapDistanceM: parsed.distanceM,
    stream: { t: [0], d: null, hr: null, alt: null, cad: null, pwr: null, sampleSec: 10 },
  }),
  localDateTime: (startUtc: string) => ({
    date: startUtc.slice(0, 10),
    startTime: startUtc.slice(11, 16),
  }),
}))

// A Wednesday. Only Date is faked; timers and promises keep working.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 21, 12))

const today = todayIso()
const thisMonday = mondayOf(today)

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.setSystemTime(new Date(2026, 9, 21, 12))
  await ctx.prisma.forecastCache.deleteMany()
  await ctx.prisma.climateCache.deleteMany()
  expectNoRefusedFetches(ctx)
})

const TARGET = JSON.stringify({
  zone: 'z1',
  rpe: [2, 3],
  hr: null,
  paceSecPerKm: null,
  heatNote: null,
})
const WORK = JSON.stringify([
  { kind: 'warmup', reps: 1, durationSec: 600, distanceM: null, zone: 'z1' },
  { kind: 'work', reps: 4, durationSec: 300, distanceM: null, zone: 'z3' },
  { kind: 'recover', reps: 4, durationSec: 120, distanceM: null, zone: 'z1' },
  { kind: 'cooldown', reps: 1, durationSec: 600, distanceM: null, zone: 'z1' },
])

/** A version-2 plan with hand-made sessions, so each test controls exactly what is planned. */
async function planWith(
  email: string,
  sessions: Array<{ date: string; kind: string; min: number; status?: string; structure?: string }>,
) {
  const u = await seedUser(ctx, { email })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 12 + 5),
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
      generatorVersion: 2,
      weeks: {
        create: [
          {
            weekStart: thisMonday,
            index: 0,
            phase: 'build',
            baselineRunMin: 200,
            targetRunMin: 200,
            longRunMin: 70,
            runDays: 4,
            strengthSessions: 0,
          },
        ],
      },
    },
  })
  const rows = []
  for (const [i, s] of sessions.entries()) {
    rows.push(
      await ctx.prisma.planSession.create({
        data: {
          planId: plan.id,
          externalId: randomUUID(),
          weekStart: mondayOf(s.date),
          date: s.date,
          order: i,
          kind: s.kind,
          title: `${s.kind} run`,
          durationMin: s.min,
          structure: s.structure ?? '[]',
          target: TARGET,
          purpose: 'Synthetic.',
          status: s.status ?? 'planned',
        },
      }),
    )
  }
  return { u, plan, goal, rows }
}

async function addRun(
  userId: string,
  date: string,
  over: Partial<{ durationSec: number; rpe: number; feel: number; type: string }> = {},
) {
  return ctx.prisma.activity.create({
    data: {
      userId,
      date,
      type: over.type ?? 'run',
      durationSec: over.durationSec ?? 3600,
      movingSec: over.durationSec ?? 3600,
      distanceM: 9000,
      rpe: over.rpe ?? 3,
      feel: over.feel,
      source: 'manual',
    },
  })
}

describe('matching and assessing a stored activity', () => {
  test('an activity fulfils the planned session of its day', async () => {
    const { u, rows } = await planWith('match@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const run = await addRun(u.id, today, { durationSec: 58 * 60 })
    await runExecutionForActivity(
      { prisma: ctx.prisma, config: ctx.config },
      { userId: u.id, activityId: run.id },
    )
    const row = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })
    expect(row).toMatchObject({ activityId: run.id, linkSource: 'auto', status: 'completed' })
    const execution = JSON.parse(row.execution!) as ExecutionAssessment
    expect(execution.completion).toBe('completed')
    expect(execution.lines.length).toBeGreaterThan(0)
  })

  test('a short run is a partial session', async () => {
    const { u, rows } = await planWith('partial@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const run = await addRun(u.id, today, { durationSec: 30 * 60 })
    await runExecutionForActivity(
      { prisma: ctx.prisma, config: ctx.config },
      { userId: u.id, activityId: run.id },
    )
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })).status,
    ).toBe('partial')
  })

  test('an owner link is never changed by matching', async () => {
    const { u, rows } = await planWith('owner-link@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const first = await addRun(u.id, addDays(today, -3))
    await ctx.prisma.planSession.update({
      where: { id: rows[0]!.id },
      data: { activityId: first.id, linkSource: 'owner' },
    })
    const second = await addRun(u.id, today)
    await runExecutionForActivity(
      { prisma: ctx.prisma, config: ctx.config },
      { userId: u.id, activityId: second.id },
    )
    const row = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })
    expect(row).toMatchObject({ activityId: first.id, linkSource: 'owner' })
  })

  test('old history, other kinds and users without a plan are left alone', async () => {
    const { u, rows } = await planWith('left-alone@example.com', [
      { date: addDays(today, -20), kind: 'easy', min: 60 },
      { date: today, kind: 'strength', min: 30 },
    ])
    const old = await addRun(u.id, addDays(today, -20))
    const run = await addRun(u.id, today)
    const deps = { prisma: ctx.prisma, config: ctx.config }
    await runExecutionForActivity(deps, { userId: u.id, activityId: old.id })
    await runExecutionForActivity(deps, { userId: u.id, activityId: run.id })
    const after = await ctx.prisma.planSession.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
    })
    expect(after.every((r) => r.activityId === null && r.status === 'planned')).toBe(true)

    const bare = await seedUser(ctx, { email: 'bare@example.com' })
    const loose = await addRun(bare.id, today)
    await expect(
      runExecutionForActivity(deps, { userId: bare.id, activityId: loose.id }),
    ).resolves.toBeUndefined()
    await expect(
      runExecutionForActivity(deps, { userId: bare.id, activityId: 'missing' }),
    ).resolves.toBeUndefined()
  })

  test('storing a parsed activity runs the hook, and a failing hook never fails the store', async () => {
    const { u, rows } = await planWith('store@example.com', [
      { date: today, kind: 'easy', min: 30 },
    ])
    const parsed: ParsedActivity = {
      providerKey: 'fit:hook-1',
      startUtc: `${today}T07:30:00.000Z`,
      utcOffsetMin: 0,
      type: 'run',
      subtype: 'road',
      elapsedSec: 1800,
      movingSec: null,
      distanceM: 5000,
      elevationGainM: null,
      elevationLossM: null,
      avgHr: null,
      maxHr: null,
      avgCadence: null,
      avgPowerW: null,
      deviceName: null,
      startLat: null,
      startLng: null,
      samples: { t: [0], d: null, hr: null, alt: null, cad: null, pwr: null },
      laps: [],
    }
    const deps = { prisma: ctx.prisma, config: ctx.config }
    const stored = await storeParsed(deps, u.id, parsed, {
      source: 'file',
      importBatchId: null,
      channel: 'upload',
    })
    expect(stored.outcome).toBe('imported')
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })).activityId,
    ).toBe(stored.activityId)

    // A database that rejects the hook's reads must not undo the import.
    const broken = {
      ...deps,
      prisma: new Proxy(ctx.prisma, {
        get(target, prop, receiver) {
          if (prop === 'plan') throw new Error('forced failure')
          return Reflect.get(target, prop, receiver) as unknown
        },
      }),
    }
    const second = await storeParsed(
      broken,
      u.id,
      { ...parsed, providerKey: 'fit:hook-2' },
      {
        source: 'file',
        importBatchId: null,
        channel: 'upload',
      },
    )
    expect(second.outcome).toBe('imported')
  })
})

describe('trimming the next quality session', () => {
  test('a much harder than expected quality session trims the next one, once a week', async () => {
    const { u, rows } = await planWith('trim@example.com', [
      { date: addDays(today, -1), kind: 'threshold', min: 50, structure: WORK },
      { date: addDays(today, 2), kind: 'threshold', min: 50, structure: WORK },
      { date: addDays(today, 3), kind: 'intervals', min: 50, structure: WORK },
    ])
    const run = await addRun(u.id, addDays(today, -1), { durationSec: 50 * 60, rpe: 10, feel: 2 })
    const deps = { prisma: ctx.prisma, config: ctx.config }
    await runExecutionForActivity(deps, { userId: u.id, activityId: run.id })

    const done = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })
    expect((JSON.parse(done.execution!) as ExecutionAssessment).effort.score).toBe(2)
    const next = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[1]!.id } })
    expect(next.status).toBe('downgraded')
    expect(next.durationMin).toBeLessThan(50)
    expect(next.original).not.toBeNull()
    const after = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[2]!.id } })
    expect(after.status).toBe('planned')

    // Assessing the same activity again changes nothing further.
    await runExecutionForActivity(deps, { userId: u.id, activityId: run.id })
    const again = await ctx.prisma.planSession.findMany({
      where: { id: { in: [rows[1]!.id, rows[2]!.id] } },
    })
    expect(again.map((r) => r.status).sort()).toEqual(['downgraded', 'planned'])
  })

  test('pain keeps the next session as planned', async () => {
    const { u, rows } = await planWith('trim-pain@example.com', [
      { date: addDays(today, -1), kind: 'threshold', min: 50, structure: WORK },
      { date: addDays(today, 2), kind: 'threshold', min: 50, structure: WORK },
    ])
    const run = await addRun(u.id, addDays(today, -1), { durationSec: 50 * 60, rpe: 10, feel: 2 })
    await ctx.prisma.activity.update({ where: { id: run.id }, data: { pain: 6 } })
    await runExecutionForActivity(
      { prisma: ctx.prisma, config: ctx.config },
      { userId: u.id, activityId: run.id },
    )
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[1]!.id } })).status,
    ).toBe('planned')
  })
})

describe('trims follow the evidence of the session just assessed', () => {
  const deps = () => ({ prisma: ctx.prisma, config: ctx.config })
  const statusOf = async (id: string) =>
    (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id } })).status

  test('a trimmed session that is then run does not reset the one-trim-a-week limit', async () => {
    const { u, rows } = await planWith('trim-limit@example.com', [
      { date: addDays(today, -2), kind: 'threshold', min: 50, structure: WORK },
      { date: addDays(today, -1), kind: 'intervals', min: 50, structure: WORK },
      { date: addDays(today, 1), kind: 'hills', min: 50, structure: WORK },
    ])
    const first = await addRun(u.id, addDays(today, -2), { durationSec: 50 * 60, rpe: 10, feel: 2 })
    await runExecutionForActivity(deps(), { userId: u.id, activityId: first.id })
    expect(await statusOf(rows[1]!.id)).toBe('downgraded')

    // The trimmed session is run and scores +2 as well; it becomes completed.
    const second = await addRun(u.id, addDays(today, -1), {
      durationSec: 45 * 60,
      rpe: 10,
      feel: 2,
    })
    await runExecutionForActivity(deps(), { userId: u.id, activityId: second.id })
    expect(await statusOf(rows[1]!.id)).toBe('completed')
    // Design 4.3: at most one trim in a week.
    expect(await statusOf(rows[2]!.id)).toBe('planned')
  })

  test('a rating entered after the first assessment still trims the next quality session', async () => {
    const { u, rows } = await planWith('trim-late@example.com', [
      { date: addDays(today, -2), kind: 'threshold', min: 50, structure: WORK },
      { date: addDays(today, 1), kind: 'threshold', min: 50, structure: WORK },
    ])
    const run = await addRun(u.id, addDays(today, -2), { durationSec: 50 * 60 })
    await ctx.prisma.activity.update({ where: { id: run.id }, data: { rpe: null } })
    await runExecutionForActivity(deps(), { userId: u.id, activityId: run.id })
    const assessed = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })
    expect((JSON.parse(assessed.execution!) as ExecutionAssessment).effort.score).toBeNull()
    expect(await statusOf(rows[1]!.id)).toBe('planned')

    await ctx.prisma.activity.update({ where: { id: run.id }, data: { rpe: 10, feel: 2 } })
    await runExecutionForActivity(deps(), { userId: u.id, activityId: run.id })
    expect(await statusOf(rows[1]!.id)).toBe('downgraded')
  })

  test('a session without any score never trims on an older +2', async () => {
    const { u, rows } = await planWith('trim-null@example.com', [
      { date: addDays(today, -6), kind: 'threshold', min: 50, structure: WORK },
      { date: addDays(today, -5), kind: 'intervals', min: 50, structure: WORK },
      { date: addDays(today, -1), kind: 'intervals', min: 50, structure: WORK },
      { date: addDays(today, 1), kind: 'hills', min: 50, structure: WORK },
    ])
    const hard = await addRun(u.id, addDays(today, -6), { durationSec: 50 * 60, rpe: 10, feel: 2 })
    await runExecutionForActivity(deps(), { userId: u.id, activityId: hard.id })
    expect(await statusOf(rows[1]!.id)).toBe('downgraded')

    const unrated = await addRun(u.id, addDays(today, -1), { durationSec: 50 * 60 })
    await ctx.prisma.activity.update({ where: { id: unrated.id }, data: { rpe: null } })
    await runExecutionForActivity(deps(), { userId: u.id, activityId: unrated.id })
    const assessed = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[2]!.id } })
    expect((JSON.parse(assessed.execution!) as ExecutionAssessment).effort.score).toBeNull()
    expect(await statusOf(rows[3]!.id)).toBe('planned')
  })
})

describe("trims need the runner's own rating", () => {
  const deps = () => ({ prisma: ctx.prisma, config: ctx.config })
  const statusOf = async (id: string) =>
    (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id } })).status
  const guess: ExecutionAssessment = {
    completion: 'completed',
    intensity: 'above',
    effort: {
      score: 1,
      confidence: 'low',
      parts: { rpeDelta: null, feel: null, hrResidualZ: 2, paceResidualPct: null },
    },
    conditions: { wbgtC: null, heatAdjusted: false, gradeAdjusted: false },
    flags: [],
    lines: [],
  }

  test('an earlier +1 from heart rate alone does not make a later rated +1 a repeat', async () => {
    const { u, rows } = await planWith('trim-guess@example.com', [
      { date: addDays(today, -3), kind: 'threshold', min: 50, structure: WORK },
      { date: addDays(today, -1), kind: 'intervals', min: 50, structure: WORK },
      { date: addDays(today, 1), kind: 'hills', min: 50, structure: WORK },
    ])
    await ctx.prisma.planSession.update({
      where: { id: rows[0]!.id },
      data: { status: 'completed', execution: JSON.stringify(guess) },
    })
    const run = await addRun(u.id, addDays(today, -1), { durationSec: 50 * 60, rpe: 9, feel: 0 })
    await runExecutionForActivity(deps(), { userId: u.id, activityId: run.id })
    const row = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[1]!.id } })
    const assessed = JSON.parse(row.execution!) as ExecutionAssessment
    expect(assessed.effort.score).toBe(1)
    expect(await statusOf(rows[2]!.id)).toBe('planned')

    // With a rated +1 before it, the same run is a repeat and trims.
    await ctx.prisma.planSession.update({
      where: { id: rows[0]!.id },
      data: {
        execution: JSON.stringify({
          ...guess,
          effort: { ...guess.effort, parts: { ...guess.effort.parts, feel: 1 } },
        }),
      },
    })
    await ctx.prisma.planSession.update({
      where: { id: rows[1]!.id },
      data: { execution: null, activityId: null, status: 'planned' },
    })
    await runExecutionForActivity(deps(), { userId: u.id, activityId: run.id })
    expect(await statusOf(rows[2]!.id)).toBe('downgraded')
  })
})

describe('assessing against what came before the run', () => {
  test('a run far longer than the longest run of the last 30 days is flagged as a spike', async () => {
    const { u, rows } = await planWith('spike@example.com', [
      { date: today, kind: 'long', min: 150 },
    ])
    await addRun(u.id, addDays(today, -10), { durationSec: 80 * 60 })
    const run = await addRun(u.id, today, { durationSec: 150 * 60 })
    await runExecutionForActivity(
      { prisma: ctx.prisma, config: ctx.config },
      { userId: u.id, activityId: run.id },
    )
    const row = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })
    expect(row.activityId).toBe(run.id)
    expect((JSON.parse(row.execution!) as ExecutionAssessment).flags).toContain('spike')
  })
})

describe('an owner unlink', () => {
  test('is remembered: the sweep and a new rating do not link the same run again', async () => {
    const { u, rows } = await planWith('unlink-kept@example.com', [
      { date: today, kind: 'easy', min: 60 },
    ])
    const deps = { prisma: ctx.prisma, config: ctx.config }
    const run = await addRun(u.id, today, { durationSec: 58 * 60 })
    await runExecutionForActivity(deps, { userId: u.id, activityId: run.id })
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })).activityId,
    ).toBe(run.id)

    const res = await client(ctx, u)
      .post(`/api/plan/sessions/${rows[0]!.id}/link`)
      .send({ activityId: null })
    expect(res.status).toBe(200)

    await runNightlyMatching(deps, { today })
    await runExecutionForActivity(deps, { userId: u.id, activityId: run.id })
    const row = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })
    expect(row.activityId).toBeNull()
    expect(row.execution).toBeNull()
  })
})

describe('activities already linked elsewhere', () => {
  test('the nightly sweep leaves an activity linked in an archived plan alone and does not throw', async () => {
    const { u, goal, plan, rows } = await planWith('archived-link@example.com', [
      { date: addDays(today, -2), kind: 'easy', min: 45 },
    ])
    const run = await addRun(u.id, addDays(today, -2), { durationSec: 45 * 60 })
    await ctx.prisma.planSession.update({
      where: { id: rows[0]!.id },
      data: { activityId: run.id, linkSource: 'auto', status: 'completed' },
    })
    await ctx.prisma.plan.update({ where: { id: plan.id }, data: { status: 'archived' } })
    const fresh = await ctx.prisma.plan.create({
      data: {
        userId: u.id,
        goalId: goal.id,
        name: goal.name,
        startDate: thisMonday,
        raceWeekStart: mondayOf(goal.targetDate),
        generatorVersion: 2,
        status: 'active',
      },
    })
    const sibling = await ctx.prisma.planSession.create({
      data: {
        planId: fresh.id,
        externalId: randomUUID(),
        weekStart: thisMonday,
        date: addDays(today, -2),
        order: 0,
        kind: 'easy',
        title: 'easy run',
        durationMin: 45,
        structure: '[]',
        target: TARGET,
        purpose: 'Synthetic.',
        status: 'planned',
      },
    })
    const errors: unknown[] = []
    await runNightlyMatching(
      { prisma: ctx.prisma, config: ctx.config },
      { today, onError: (error) => errors.push(error) },
    )
    expect(errors).toEqual([])
    const kept = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })
    expect(kept.activityId).toBe(run.id)
    const other = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: sibling.id } })
    expect(other.activityId).toBeNull()
  })
})

describe('scheduled jobs', () => {
  test('the nightly job links activities of the last week', async () => {
    const { u, rows } = await planWith('nightly@example.com', [
      { date: addDays(today, -4), kind: 'easy', min: 45 },
    ])
    const run = await addRun(u.id, addDays(today, -4), { durationSec: 45 * 60 })
    await runMatchingJob({ prisma: ctx.prisma, config: ctx.config }, { now: new Date() })
    const row = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })
    expect(row).toMatchObject({ activityId: run.id, linkSource: 'auto', status: 'completed' })
  })

  test('the weekly job re-plans every version-2 plan and records the last decision', async () => {
    const u = await seedUser(ctx, { email: 'weekly@example.com' })
    for (let w = 1; w <= 12; w += 1) {
      for (const dow of [1, 3, 5, 6]) {
        await addRun(u.id, addDays(thisMonday, -7 * w + dow), { durationSec: 45 * 60 })
      }
    }
    const goal = await ctx.prisma.goal.create({
      data: {
        userId: u.id,
        name: 'Synthetic half',
        priority: 'A',
        targetDate: addDays(thisMonday, 7 * 14 + 5),
        distanceM: 21_097,
        goalType: 'finish',
      },
    })
    // Generated a week earlier, so the plan holds a finished week to decide on.
    vi.setSystemTime(new Date(2026, 9, 14, 12))
    const generated = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
    expect(generated.status, JSON.stringify(generated.body)).toBe(201)
    vi.setSystemTime(new Date(2026, 9, 21, 12))

    await runReplanJob({ prisma: ctx.prisma, config: ctx.config }, { now: new Date() })
    const revisions = (await client(ctx, u).get('/api/plan/revisions')).body as PlanRevision[]
    expect(revisions.map((r) => r.reason)).toEqual(['weekly', 'generate'])
    expect(revisions[0]!.summary).toMatch(/Last week's decision: (progress|hold|reduce)/)
    const plan = (await client(ctx, u).get('/api/plan')).body as PlanWithSessions
    expect(plan.weeks.map((w) => w.weekStart)).toContain(addDays(thisMonday, -7))
  })

  test('slots fire once per day, on their weekday, and not before their time', () => {
    const monday = (h: number, m: number) => new Date(2026, 9, 19, h, m)
    expect(dueSlot(monday(2, 59), null, REPLAN_SLOT)).toBeNull()
    expect(dueSlot(monday(3, 0), null, REPLAN_SLOT)).toBe('2026-10-19')
    expect(dueSlot(monday(9, 0), '2026-10-19', REPLAN_SLOT)).toBeNull()
    expect(dueSlot(new Date(2026, 9, 20, 4, 0), null, REPLAN_SLOT)).toBeNull()
    expect(dueSlot(new Date(2026, 9, 20, 2, 30), null, MATCHING_SLOT)).toBe('2026-10-20')
    expect(dueSlot(new Date(2026, 9, 20, 2, 29), null, MATCHING_SLOT)).toBeNull()
    expect(dueSlot(new Date(2026, 9, 21, 2, 30), '2026-10-20', MATCHING_SLOT)).toBe('2026-10-21')
  })
})

describe('owner edits against links and spacing', () => {
  const nextMonday = addDays(thisMonday, 7)

  test('a swap of kinds exchanges the two prescriptions inside the week', async () => {
    const { u, rows } = await planWith('swap@example.com', [
      { date: addDays(nextMonday, 1), kind: 'easy', min: 40 },
      { date: addDays(nextMonday, 3), kind: 'threshold', min: 55, structure: WORK },
      { date: addDays(nextMonday, 5), kind: 'long', min: 90 },
    ])
    const res = await client(ctx, u)
      .put(`/api/plan/sessions/${rows[0]!.id}`)
      .send({ kind: 'threshold' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({
      date: addDays(nextMonday, 1),
      kind: 'threshold',
      durationMin: 55,
      status: 'moved',
    })
    const partner = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[1]!.id } })
    expect(partner).toMatchObject({ kind: 'easy', durationMin: 40, status: 'moved' })

    const none = await client(ctx, u)
      .put(`/api/plan/sessions/${rows[2]!.id}`)
      .send({ kind: 'intervals' })
    expect(none.status).toBe(409)
  })

  test('a hard session never moves next to another hard one', async () => {
    const { u, rows } = await planWith('spacing@example.com', [
      { date: addDays(nextMonday, 1), kind: 'threshold', min: 50, structure: WORK },
      { date: addDays(nextMonday, 4), kind: 'intervals', min: 50, structure: WORK },
    ])
    const res = await client(ctx, u)
      .put(`/api/plan/sessions/${rows[1]!.id}`)
      .send({ date: addDays(nextMonday, 2) })
    expect(res.status).toBe(409)
    expect((res.body as { error: { message: string } }).error.message).toMatch(/rule F1/)
    const row = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[1]!.id } })
    expect(row).toMatchObject({ date: addDays(nextMonday, 4), status: 'planned' })
  })

  test('a linked or skipped session is neither moved nor swapped', async () => {
    const { u, rows } = await planWith('linked-move@example.com', [
      { date: today, kind: 'easy', min: 60 },
      { date: addDays(today, 2), kind: 'threshold', min: 50, structure: WORK },
      { date: addDays(today, 4), kind: 'easy', min: 40, status: 'skipped' },
    ])
    const run = await addRun(u.id, today, { durationSec: 60 * 60 })
    await runExecutionForActivity(
      { prisma: ctx.prisma, config: ctx.config },
      { userId: u.id, activityId: run.id },
    )
    const c = client(ctx, u)
    const move = await c.put(`/api/plan/sessions/${rows[0]!.id}`).send({ date: addDays(today, 3) })
    expect(move.status).toBe(409)
    const swap = await c.put(`/api/plan/sessions/${rows[1]!.id}`).send({ kind: 'easy' })
    expect(swap.status).toBe(409)
    const skipped = await c
      .put(`/api/plan/sessions/${rows[2]!.id}`)
      .send({ date: addDays(today, 3) })
    expect(skipped.status).toBe(409)
    const linked = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })
    expect(linked).toMatchObject({ date: today, status: 'completed', activityId: run.id })
  })
})

describe('zone proposals', () => {
  async function withThresholdFeedback(email: string, score: number) {
    const made = await planWith(email, [])
    await ctx.prisma.athleteProfile.create({
      data: { userId: made.u.id, thresholdPaceSecPerKm: 300 },
    })
    const assessment: ExecutionAssessment = {
      completion: 'completed',
      intensity: 'on',
      effort: {
        score: score as -2 | -1 | 0 | 1 | 2,
        confidence: 'moderate',
        parts: { rpeDelta: null, feel: score, hrResidualZ: null, paceResidualPct: null },
      },
      conditions: { wbgtC: null, heatAdjusted: false, gradeAdjusted: false },
      flags: [],
      lines: [],
    }
    for (const back of [2, 4, 6]) {
      await ctx.prisma.planSession.create({
        data: {
          planId: made.plan.id,
          externalId: randomUUID(),
          weekStart: mondayOf(addDays(today, -back)),
          date: addDays(today, -back),
          order: 0,
          kind: 'threshold',
          title: 'threshold run',
          durationMin: 45,
          target: TARGET,
          purpose: 'Synthetic.',
          status: 'completed',
          execution: JSON.stringify(assessment),
        },
      })
    }
    return made
  }

  test('three easier-than-expected sessions propose a faster threshold; accepting applies it', async () => {
    const { u } = await withThresholdFeedback('zones-accept@example.com', -1)
    const c = client(ctx, u)
    const proposals = (await c.get('/api/zones/proposals')).body as ZoneProposalView[]
    expect(proposals).toHaveLength(1)
    const proposal = proposals[0]!
    expect(proposal).toMatchObject({ boundary: 'thresholdPace', from: 300, observations: 3 })
    expect(proposal.to).toBeLessThan(300)

    const accepted = await c.post(`/api/zones/proposals/${proposal.id}/accept`).send({})
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    expect(
      (accepted.body as { thresholdPaceSecPerKm: { value: number } }).thresholdPaceSecPerKm,
    ).toBeDefined()
    const profile = await ctx.prisma.athleteProfile.findUniqueOrThrow({ where: { userId: u.id } })
    expect(profile.thresholdPaceSecPerKm).toBe(proposal.to)
    const revisions = (await c.get('/api/plan/revisions')).body as PlanRevision[]
    expect(revisions[0]).toMatchObject({ reason: 'owner' })
    // The summary is a template with a plain label and a date; the paces are in the change.
    expect(revisions[0]!.summary).toMatch(
      /^Accepted the proposed threshold pace on [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}\.$/,
    )
    expect(revisions[0]!.changes).toEqual([
      expect.objectContaining({ field: 'zones.thresholdPace', from: 300, to: proposal.to }),
    ])
    expect((await c.post(`/api/zones/proposals/${proposal.id}/accept`).send({})).status).toBe(404)

    // The same observations never move the boundary a second time. The acceptance is found by its
    // stored change, whatever its summary says.
    await ctx.prisma.planRevision.updateMany({
      where: { reason: 'owner', plan: { userId: u.id } },
      data: { summary: 'Reworded.' },
    })
    expect((await c.get('/api/zones/proposals')).body).toEqual([])
    // Dating the acceptance before all three of them is what brings the proposal back.
    await ctx.prisma.planRevision.updateMany({
      where: { reason: 'owner', plan: { userId: u.id } },
      data: { createdAt: new Date(Date.now() - 10 * 86_400_000) },
    })
    expect(((await c.get('/api/zones/proposals')).body as ZoneProposalView[]).length).toBe(1)
  })

  test('declining hides the proposal and changes nothing else', async () => {
    const { u } = await withThresholdFeedback('zones-decline@example.com', -1)
    const c = client(ctx, u)
    const [proposal] = (await c.get('/api/zones/proposals')).body as ZoneProposalView[]
    const res = await c.post(`/api/zones/proposals/${proposal!.id}/decline`).send({})
    expect(res.status).toBe(204)
    expect((await c.get('/api/zones/proposals')).body).toEqual([])
    const profile = await ctx.prisma.athleteProfile.findUniqueOrThrow({ where: { userId: u.id } })
    expect(profile.thresholdPaceSecPerKm).toBe(300)
    expect((await c.post('/api/zones/proposals/unknown/decline').send({})).status).toBe(404)

    // The decline is a revision with a template summary and the declined proposal as its change.
    const [revision] = (await c.get('/api/plan/revisions')).body as PlanRevision[]
    expect(revision).toMatchObject({ reason: 'owner' })
    expect(revision!.summary).toMatch(
      /^Declined the proposed threshold pace on [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}\.$/,
    )
    expect(revision!.changes).toEqual([
      expect.objectContaining({
        field: 'zones.thresholdPace.declined',
        from: 300,
        to: proposal!.to,
      }),
    ])
    // It is found by that change, whatever its summary says, and a decline does not read as an
    // accepted change of the boundary.
    await ctx.prisma.planRevision.updateMany({
      where: { reason: 'owner', plan: { userId: u.id } },
      data: { summary: 'Reworded.' },
    })
    expect((await c.get('/api/zones/proposals')).body).toEqual([])
    await ctx.prisma.planRevision.updateMany({
      where: { reason: 'owner', plan: { userId: u.id } },
      data: {
        createdAt: new Date(Date.now() - (P.zoneProposal.windowDays.value + 1) * 86_400_000),
      },
    })
    expect(((await c.get('/api/zones/proposals')).body as ZoneProposalView[]).length).toBe(1)
  })

  test('mixed feedback makes no proposal, and the zone set is readable', async () => {
    const { u } = await withThresholdFeedback('zones-none@example.com', 0)
    const c = client(ctx, u)
    expect((await c.get('/api/zones/proposals')).body).toEqual([])
    const zones = await c.get('/api/zones')
    expect(zones.status).toBe(200)
    expect(zones.body).toHaveProperty('rpe')
  })
})

describe('GET /api/today', () => {
  test('lists today sessions with advice, the heat note and unrated runs', async () => {
    const { u } = await planWith('today@example.com', [{ date: today, kind: 'long', min: 90 }])
    await ctx.prisma.athleteProfile.create({
      data: { userId: u.id, homeLat: 40.1, homeLng: -105.2, timezone: 'UTC' },
    })
    const unrated = await addRun(u.id, addDays(today, -1))
    await ctx.prisma.activity.update({ where: { id: unrated.id }, data: { rpe: null } })
    const rated = await addRun(u.id, addDays(today, -2), { feel: 0 })
    // The weather job fills the forecast cache; the request below only reads it.
    ctx.fetch = fakeFetch({
      'GET https://api.open-meteo.com/v1/forecast': () => {
        const times = Array.from(
          { length: 24 },
          (_, h) => `${today}T${String(h).padStart(2, '0')}:00`,
        )
        return Response.json({
          hourly: {
            time: times,
            temperature_2m: times.map(() => 33),
            relative_humidity_2m: times.map(() => 60),
            dew_point_2m: times.map(() => 22),
            wind_speed_10m: times.map(() => 5),
          },
        })
      },
    })
    await refreshWeatherCaches(ctx, u.id)
    blockNetwork(ctx)
    const res = await client(ctx, u).get('/api/today')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const view = res.body as TodayView
    expect(view.date).toBe(today)
    expect(view.sessions).toHaveLength(1)
    expect(view.sessions[0]).toMatchObject({ advice: 'as-planned', reasons: [] })
    expect(view.sessions[0]!.session.kind).toBe('long')
    expect(view.heat.note).toMatch(/Warm day/)
    expect(view.checkin).toBeNull()
    expect(view.readiness.date).toBe(today)
    expect(view.unrated.map((a) => a.id)).toEqual([unrated.id])
    expect(view.unrated.map((a) => a.id)).not.toContain(rated.id)
  })

  test('a reported focal bone pain turns the run into rest advice', async () => {
    const { u } = await planWith('today-pain@example.com', [{ date: today, kind: 'easy', min: 40 }])
    await client(ctx, u).put(`/api/checkins/${today}`).send({ painScore: 6, painFocalBone: true })
    const view = (await client(ctx, u).get('/api/today')).body as TodayView
    expect(view.sessions[0]!.advice).toBe('rest')
    expect(view.sessions[0]!.reasons.length).toBeGreaterThan(0)
    expect(view.checkin?.painFocalBone).toBe(true)
  })

  test('works without a plan or a forecast', async () => {
    const u = await seedUser(ctx, { email: 'today-empty@example.com' })
    const res = await client(ctx, u).get('/api/today')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      sessions: [],
      heat: { wbgtC: null, note: null, coolerHour: null },
    })
  })
})
