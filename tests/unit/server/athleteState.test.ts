import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, inject, test, vi } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { P, PARAMS_VERSION } from '../../../shared/engine/params/index.ts'
import type { Deps } from '../../../server/app.ts'
import type { Config } from '../../../server/config.ts'
import { dataVersionKey } from '../../../server/dataVersion.ts'
import { createPrisma, initSqlite, type PrismaClient } from '../../../server/db.ts'
import {
  athleteKey,
  cacheSizes,
  loadAthleteContext,
  memoByVersion,
  MEMO_LRU_SIZE,
  SNAPSHOT_LRU_SIZE,
  SNAPSHOT_TTL_MS,
} from '../../../server/services/athleteState.ts'
import { currentGoalFor } from '../../../server/services/currentGoal.ts'
import { gatherContextInput, gatherEngineInput } from '../../../server/services/engineInput.ts'

// A Wednesday at noon; only Date is faked so the queries and the promises keep working.
const NOW = new Date(2026, 9, 21, 12)
const TODAY = '2026-10-21'

let dir: string
let dbUrl: string
let prisma: PrismaClient
let deps: Deps
const opened: PrismaClient[] = []

/** A client on the test file; a second call opens a second connection to the same file. */
async function open(): Promise<PrismaClient> {
  const client = createPrisma(dbUrl)
  await initSqlite(client)
  opened.push(client)
  return client
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  dir = mkdtempSync(join(tmpdir(), 'rl-athlete-state-'))
  const file = join(dir, 'test.db')
  copyFileSync(inject('templateDbPath'), file)
  dbUrl = `file:${file}`
  prisma = await open()
  const config: Config = {
    databaseUrl: dbUrl,
    sessionSecret: 'test-only-session-secret-0123456789abcdef',
    port: 0,
    nodeEnv: 'test',
    allowRegistration: false,
    logLevel: 'silent',
  }
  deps = { prisma, config }
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Promise.all(opened.splice(0).map((client) => client.$disconnect()))
  rmSync(dir, { recursive: true, force: true })
})

async function seedUser(email = 'runner@example.com') {
  return prisma.user.create({ data: { email, passwordHash: 'x' } })
}

function run(userId: string, date: string, over: Record<string, unknown> = {}) {
  return {
    userId,
    date,
    type: 'run',
    durationSec: 2700,
    distanceM: 8000,
    source: 'manual',
    ...over,
  }
}

function goalRow(
  userId: string,
  over: { name?: string; isActive?: boolean; distanceM?: number | null } = {},
) {
  return {
    userId,
    name: over.name ?? 'Synthetic half',
    priority: 'A',
    targetDate: '2027-03-14',
    distanceM: over.distanceM === undefined ? 21_097 : over.distanceM,
    isActive: over.isActive ?? false,
    goalType: 'finish',
  }
}

function planRow(userId: string, goalId: string, over: { status?: string } = {}) {
  return {
    userId,
    goalId,
    name: 'Synthetic plan',
    startDate: '2026-10-19',
    raceWeekStart: '2027-03-08',
    status: over.status ?? 'active',
    generatorVersion: 2,
  }
}

const load = (userId: string, today = TODAY) => loadAthleteContext(deps, { userId, today })

type Delegate = Record<string, (...args: unknown[]) => PromiseLike<unknown>>

/** Wraps one query method of the client; `around` gets the real query and its arguments. */
function wrapQuery(
  model: string,
  method: string,
  around: (proceed: () => PromiseLike<unknown>, args: unknown[]) => PromiseLike<unknown>,
): void {
  const delegate = (prisma as unknown as Record<string, Delegate>)[model]!
  const original = delegate[method]!.bind(delegate)
  vi.spyOn(delegate, method).mockImplementation((...args: unknown[]) =>
    around(() => original(...args), args),
  )
}

/** A write lands in the middle of the build, from this client or another connection. */
function writeDuringBuild(writer: PrismaClient, userId: string): void {
  wrapQuery('weeklyReview', 'findMany', async (proceed) => {
    await writer.activity.create({ data: run(userId, '2026-10-19') })
    return proceed()
  })
}

describe('the snapshot', () => {
  test('holds the history window, the wellness window and the latest screening', async () => {
    const user = await seedUser()
    await prisma.activity.createMany({
      data: [
        run(user.id, addDays(TODAY, -P.a5.historyWindowDays.value - 1)),
        run(user.id, addDays(TODAY, -P.a5.historyWindowDays.value)),
        run(user.id, '2026-10-18', { duplicateStatus: 'possible' }),
        run(user.id, '2026-10-19', { startTime: '18:00' }),
        run(user.id, '2026-10-19', { startTime: '07:00' }),
        run(user.id, '2026-10-22'),
      ],
    })
    await prisma.wellnessDay.createMany({
      data: ['2026-08-21', '2026-08-22', '2026-10-21', '2026-10-22'].map((date) => ({
        userId: user.id,
        date,
        source: 'manual',
        restingHr: 50,
      })),
    })
    await prisma.screening.createMany({
      data: [
        { userId: user.id, date: '2026-09-01', kind: 'reds', answers: '{}', flags: 1 },
        { userId: user.id, date: '2026-10-01', kind: 'reds', answers: '{}', flags: 3 },
      ],
    })
    await prisma.weeklyReview.create({ data: { userId: user.id, weekStart: '2026-10-12' } })

    const ctx = await load(user.id)

    // Oldest first, the order the engine reads; the 365th day back is in, the 366th is out.
    expect(ctx.activities.map((a) => [a.date, a.startTime])).toEqual([
      [addDays(TODAY, -365), null],
      ['2026-10-18', null],
      ['2026-10-19', '07:00'],
      ['2026-10-19', '18:00'],
    ])
    expect(ctx.wellness.map((w) => w.date)).toEqual(['2026-08-22', '2026-10-21'])
    expect(ctx.screeningFlags).toBe(3)
    expect(ctx.reviews.map((r) => r.weekStart)).toEqual(['2026-10-12'])
    expect(ctx.asOf).toBe(TODAY)
    expect(ctx.userId).toBe(user.id)
    expect(ctx.inputs).toEqual({
      activities: { windowDays: 365, count: 3, latest: '2026-10-19', flaggedDuplicates: 1 },
      wellness: { windowDays: 60, count: 2, latest: '2026-10-21' },
      reviews: { windowWeeks: 16, count: 1 },
    })
  })

  test('carries the state, zones and readiness the engine estimates from that data', async () => {
    const user = await seedUser()
    await prisma.activity.createMany({
      data: [run(user.id, '2026-10-17'), run(user.id, '2026-10-19', { durationSec: 3600 })],
    })
    const ctx = await load(user.id)
    expect(ctx.state.asOf).toBe(TODAY)
    expect(ctx.state.lastRunDate).toBe('2026-10-19')
    expect(ctx.state.weeks.length).toBeGreaterThan(0)
    expect(ctx.zones.pace).toBeDefined()
    expect(ctx.readiness.date).toBe(TODAY)
    expect(ctx.existing()).toBeNull()
    expect(ctx.plan).toBeNull()
    expect(ctx.goal).toBeNull()
  })

  test('is built in one round of queries that reads one column of the screening', async () => {
    const user = await seedUser()
    const traced = [
      ['athleteProfile', 'findUnique'],
      ['activity', 'findMany'],
      ['wellnessDay', 'findMany'],
      ['weeklyReview', 'findMany'],
      ['screening', 'findFirst'],
      ['planRevision', 'findMany'],
      ['plan', 'findFirst'],
      ['goal', 'findMany'],
      ['goal', 'findFirst'],
    ] as const
    const log: string[] = []
    const calls = new Map<string, unknown[][]>()
    for (const [model, method] of traced) {
      wrapQuery(model, method, (proceed, args) => {
        const name = `${model}.${method}`
        log.push(`start ${name}`)
        calls.set(name, [...(calls.get(name) ?? []), args])
        const result = proceed()
        void Promise.resolve(result).then(() => log.push(`end ${name}`))
        return result
      })
    }

    await load(user.id)

    // Every query is started before the first one finishes: no sequential awaits. The plan is read
    // twice, once for the stored plan and once inside `currentGoalFor`.
    const firstEnd = log.findIndex((entry) => entry.startsWith('end'))
    const started = log.slice(0, firstEnd).sort()
    expect(started).toEqual(
      [
        'start activity.findMany',
        'start athleteProfile.findUnique',
        'start goal.findFirst',
        'start goal.findMany',
        'start plan.findFirst',
        'start plan.findFirst',
        'start planRevision.findMany',
        'start screening.findFirst',
        'start wellnessDay.findMany',
        'start weeklyReview.findMany',
      ].sort(),
    )

    const screening = calls.get('screening.findFirst')?.[0]?.[0] as { select?: unknown }
    expect(screening.select).toEqual({ flags: true })
    const activities = calls.get('activity.findMany')?.[0]?.[0] as {
      where: { date: { gte: string; lte: string } }
    }
    expect(activities.where.date).toEqual({
      gte: addDays(TODAY, -P.a5.historyWindowDays.value),
      lte: TODAY,
    })
  })

  test('is deep-frozen, so an in-place change throws', async () => {
    const user = await seedUser()
    await prisma.activity.createMany({
      data: [run(user.id, '2026-10-17'), run(user.id, '2026-10-19')],
    })
    await prisma.wellnessDay.create({
      data: { userId: user.id, date: '2026-10-20', source: 'manual', restingHr: 50 },
    })
    const ctx = await load(user.id)

    expect(Object.isFrozen(ctx)).toBe(true)
    expect(Object.isFrozen(ctx.activities)).toBe(true)
    expect(Object.isFrozen(ctx.activities[0])).toBe(true)
    expect(Object.isFrozen(ctx.profile.availability.mon)).toBe(true)
    expect(Object.isFrozen(ctx.wellness[0])).toBe(true)
    expect(Object.isFrozen(ctx.state.weeks)).toBe(true)
    expect(Object.isFrozen(ctx.zones)).toBe(true)
    expect(Object.isFrozen(ctx.readiness.redFlags)).toBe(true)
    expect(() => ctx.activities.sort((a, b) => b.date.localeCompare(a.date))).toThrow(TypeError)
    expect(() => ctx.activities.push(ctx.activities[0]!)).toThrow(TypeError)
    expect(() => {
      ctx.activities[0]!.durationSec = 1
    }).toThrow(TypeError)
    expect(() => {
      ctx.readiness.redFlags.push({ code: 'x', message: 'x', rules: [] })
    }).toThrow(TypeError)
  })

  test('hands the engine the same frozen arrays through the input adapters', async () => {
    const user = await seedUser()
    await prisma.activity.create({ data: run(user.id, '2026-10-19') })
    const goal = await prisma.goal.create({ data: goalRow(user.id, { isActive: true }) })
    const ctx = await load(user.id)

    const neutral = await gatherContextInput(deps, { userId: user.id, today: TODAY, goalId: null })
    expect(neutral.activities).toBe(ctx.activities)
    expect(neutral.profile).toBe(ctx.profile)
    expect(neutral.wellness).toBe(ctx.wellness)
    expect(neutral.reviews).toBe(ctx.reviews)
    expect(neutral.goal.goalId).toBe('')
    expect(neutral.existing).toBeNull()
    expect(neutral.forecast).toBeNull()
    expect(neutral.options).toEqual({})

    const race = await gatherEngineInput(deps, { userId: user.id, today: TODAY, goalId: goal.id })
    expect(race.activities).toBe(ctx.activities)
    expect(race.goal.goalId).toBe(goal.id)
    expect(race.goal.distanceM).toBe(21_097)
    // The adapters never wrote anything, so the snapshot is still the one stored.
    expect(await load(user.id)).toBe(ctx)
  })

  test("answers a goal without a distance, or another user's goal, with the neutral goal", async () => {
    const user = await seedUser()
    const other = await seedUser('other@example.com')
    const open = await prisma.goal.create({ data: goalRow(user.id, { distanceM: null }) })
    const foreign = await prisma.goal.create({ data: goalRow(other.id) })

    for (const goalId of [open.id, foreign.id, 'no-such-goal']) {
      const input = await gatherEngineInput(deps, { userId: user.id, today: TODAY, goalId })
      expect(input.goal.goalId).toBe('')
    }
    const ctx = await load(user.id)
    expect(await ctx.prediction(open.id)).toBeNull()
    expect(await ctx.prediction(foreign.id)).toBeNull()
    expect(await ctx.prediction('no-such-goal')).toBeNull()
  })

  test('keys a picture by the data version, the day and the parameter version', async () => {
    const user = await seedUser()
    const ctx = await load(user.id)
    const version = await dataVersionKey(prisma)
    expect(ctx.version).toBe(version.key)
    expect(ctx.key).toBe(`${version.key}.${TODAY}.${PARAMS_VERSION}`)
    expect(ctx.key).toBe(athleteKey(version, TODAY))
  })
})

describe('the cache', () => {
  test('concurrent requests share one build', async () => {
    const user = await seedUser()
    const findMany = vi.spyOn(prisma.wellnessDay, 'findMany')

    const [a, b, c] = await Promise.all([load(user.id), load(user.id), load(user.id)])

    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  test('a second request with no write is a hit', async () => {
    const user = await seedUser()
    const findMany = vi.spyOn(prisma.wellnessDay, 'findMany')
    const first = await load(user.id)
    expect(await load(user.id)).toBe(first)
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  test('a write to something the snapshot does not read, or only logs, is a hit', async () => {
    const user = await seedUser()
    const goal = await prisma.goal.create({ data: goalRow(user.id) })
    const first = await load(user.id)
    await prisma.predictionLog.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        method: 'test',
        predictedSec: 1,
        lowSec: 1,
        highSec: 1,
        weekStart: '2026-10-19',
        loggedOn: '2026-10-21',
      },
    })
    expect(await load(user.id)).toBe(first)
  })

  test('a state write causes exactly one rebuild', async () => {
    const user = await seedUser()
    const first = await load(user.id)
    expect(first.activities).toHaveLength(0)

    await prisma.activity.create({ data: run(user.id, '2026-10-19') })
    const second = await load(user.id)
    expect(second).not.toBe(first)
    expect(second.activities).toHaveLength(1)
    expect(await load(user.id)).toBe(second)
  })

  test('a write through a second connection causes exactly one rebuild', async () => {
    const user = await seedUser()
    const first = await load(user.id)
    const other = await open()

    await other.activity.create({ data: run(user.id, '2026-10-19') })

    const second = await load(user.id)
    expect(second).not.toBe(first)
    expect(second.activities).toHaveLength(1)
    expect(second.version).not.toBe(first.version)
    expect(await load(user.id)).toBe(second)
  })

  test('the end of a transaction causes exactly one rebuild', async () => {
    const user = await seedUser()
    const first = await load(user.id)
    await prisma.$transaction(async (tx) => {
      await tx.activity.create({ data: run(user.id, '2026-10-19') })
    })
    const second = await load(user.id)
    expect(second).not.toBe(first)
    expect(second.activities).toHaveLength(1)
    expect(await load(user.id)).toBe(second)
  })

  test('a new day causes exactly one rebuild, and the old day is still there', async () => {
    const user = await seedUser()
    const monday = await load(user.id)
    const tuesday = await load(user.id, '2026-10-22')
    expect(tuesday).not.toBe(monday)
    expect(tuesday.asOf).toBe('2026-10-22')
    expect(await load(user.id, '2026-10-22')).toBe(tuesday)
    // Nothing was written, so going back to the first day finds its picture.
    expect(await load(user.id)).toBe(monday)
  })

  test('the time to live causes exactly one rebuild', async () => {
    const user = await seedUser()
    const first = await load(user.id)

    vi.setSystemTime(NOW.getTime() + SNAPSHOT_TTL_MS - 1)
    expect(await load(user.id)).toBe(first)

    vi.setSystemTime(NOW.getTime() + SNAPSHOT_TTL_MS)
    const second = await load(user.id)
    expect(second).not.toBe(first)
    expect(await load(user.id)).toBe(second)
  })

  test('keeps the pictures of two users apart', async () => {
    const mine = await seedUser()
    const theirs = await seedUser('other@example.com')
    await prisma.activity.create({ data: run(theirs.id, '2026-10-19') })
    expect((await load(mine.id)).activities).toHaveLength(0)
    expect((await load(theirs.id)).activities).toHaveLength(1)
  })

  test('keeps at most eight pictures and lets the oldest go', async () => {
    const user = await seedUser()
    const days = Array.from({ length: SNAPSHOT_LRU_SIZE }, (_, i) => `2026-10-0${i + 1}`)
    const built = []
    for (const day of days) built.push(await load(user.id, day))
    expect(cacheSizes(prisma).snapshots).toBe(SNAPSHOT_LRU_SIZE)

    // Reading the first day makes the second the least recently used; a ninth day pushes it out.
    expect(await load(user.id, days[0])).toBe(built[0])
    await load(user.id, '2026-10-09')
    expect(cacheSizes(prisma).snapshots).toBe(SNAPSHOT_LRU_SIZE)
    expect(await load(user.id, days[0])).toBe(built[0])
    expect(await load(user.id, days[1])).not.toBe(built[1])
  })

  test('a build that overlapped a write is returned but not stored', async () => {
    const user = await seedUser()
    writeDuringBuild(prisma, user.id)

    const overlapped = await load(user.id)
    expect(overlapped.activities.length).toBeLessThanOrEqual(1)
    expect(cacheSizes(prisma).snapshots).toBe(0)

    vi.restoreAllMocks()
    const settled = await load(user.id)
    expect(settled).not.toBe(overlapped)
    expect(settled.activities).toHaveLength(1)
    expect(cacheSizes(prisma).snapshots).toBe(1)
  })

  test("a build by another connection's write in flight is returned but not stored", async () => {
    const user = await seedUser()
    writeDuringBuild(await open(), user.id)

    await load(user.id)
    expect(cacheSizes(prisma).snapshots).toBe(0)

    vi.restoreAllMocks()
    const settled = await load(user.id)
    expect(settled.activities).toHaveLength(1)
    expect(cacheSizes(prisma).snapshots).toBe(1)
  })

  test('a rolled-back transaction leaves no stale snapshot', async () => {
    const user = await seedUser()
    const before = await load(user.id)
    let inside: Awaited<ReturnType<typeof load>> | undefined
    let insideAgain: Awaited<ReturnType<typeof load>> | undefined

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.activity.create({ data: run(user.id, '2026-10-19') })
        // The root client reads the transaction's uncommitted row (the E3-1 spike), so this
        // picture contains a run that is about to be rolled back.
        inside = await load(user.id)
        insideAgain = await load(user.id)
        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')

    expect(inside?.activities).toHaveLength(1)
    // It was returned, not stored: asking again inside the transaction built another one.
    expect(insideAgain).not.toBe(inside)
    expect(cacheSizes(prisma).snapshots).toBe(0)

    const after = await load(user.id)
    expect(after.activities).toHaveLength(0)
    expect(after).not.toBe(before)
    expect(after).not.toBe(inside)
  })

  test('a failed build is not remembered', async () => {
    const user = await seedUser()
    const failing = vi.spyOn(prisma.goal, 'findMany').mockRejectedValueOnce(new Error('disk full'))
    await expect(load(user.id)).rejects.toThrow('disk full')
    expect(failing).toHaveBeenCalledTimes(1)
    const recovered = await load(user.id)
    expect(recovered.goals).toEqual([])
    expect(await load(user.id)).toBe(recovered)
  })
})

describe('prediction and the stored plan', () => {
  test('a prediction is built once per picture and is null without enough data', async () => {
    const user = await seedUser()
    const goal = await prisma.goal.create({ data: goalRow(user.id, { isActive: true }) })
    const ctx = await load(user.id)
    const first = ctx.prediction(goal.id)
    expect(ctx.prediction(goal.id)).toBe(first)
    // No runs: the state supports no source.
    expect(await first).toBeNull()
  })

  test("existing() is the stored version-2 plan in the engine's shapes", async () => {
    const user = await seedUser()
    const goal = await prisma.goal.create({ data: goalRow(user.id) })
    const plan = await prisma.plan.create({ data: planRow(user.id, goal.id) })
    await prisma.planWeek.create({
      data: {
        planId: plan.id,
        weekStart: '2026-10-19',
        index: 0,
        phase: 'base',
        baselineRunMin: 120,
        targetRunMin: 120,
        targetSource: 'baseline',
        longRunMin: 50,
        runDays: 3,
        strengthSessions: 0,
        tid: '{"z1":80,"z2":5,"z3":15}',
        flags: '[]',
      },
    })
    const ctx = await load(user.id)
    const existing = ctx.existing()
    expect(existing?.weeks.map((w) => w.weekStart)).toEqual(['2026-10-19'])
    expect(existing?.sessions).toEqual([])
    expect(ctx.plan?.id).toBe(plan.id)
    expect(Object.isFrozen(existing)).toBe(true)
    expect(ctx.existing()).toBe(existing)
  })

  test('planSessions are the stored sessions as the API serves them, by date then order, frozen', async () => {
    const user = await seedUser()
    const goal = await prisma.goal.create({ data: goalRow(user.id) })
    const plan = await prisma.plan.create({ data: planRow(user.id, goal.id) })
    const session = (date: string, order: number, kind: string) => ({
      planId: plan.id,
      externalId: `ext-${date}-${String(order)}`,
      weekStart: '2026-10-19',
      date,
      order,
      kind,
      title: kind,
      durationMin: 40,
      structure: '[]',
      target: '{"zone":"z1","rpe":[2,3],"hr":null,"paceSecPerKm":null,"heatNote":null}',
      purpose: 'Synthetic.',
    })
    await prisma.planSession.createMany({
      data: [
        session('2026-10-22', 0, 'long'),
        session('2026-10-21', 1, 'strength'),
        session('2026-10-21', 0, 'easy'),
      ],
    })
    const ctx = await load(user.id)
    expect(ctx.planSessions.map((s) => [s.date, s.order, s.externalId])).toEqual([
      ['2026-10-21', 0, 'ext-2026-10-21-0'],
      ['2026-10-21', 1, 'ext-2026-10-21-1'],
      ['2026-10-22', 0, 'ext-2026-10-22-0'],
    ])
    expect(Object.isFrozen(ctx.planSessions)).toBe(true)
    expect(Object.isFrozen(ctx.planSessions[0])).toBe(true)

    const bare = await seedUser('bare@example.com')
    expect((await load(bare.id)).planSessions).toEqual([])
  })

  test('planOptions are the stored plan options, and none when the text is not an object', async () => {
    const user = await seedUser()
    expect((await load(user.id)).planOptions).toEqual({})
    const goal = await prisma.goal.create({ data: goalRow(user.id) })
    const plan = await prisma.plan.create({
      data: { ...planRow(user.id, goal.id), options: '{"recoveryCycle":"2:1"}' },
    })
    expect((await load(user.id)).planOptions).toEqual({ recoveryCycle: '2:1' })
    for (const text of ['not json', '["2:1"]', 'null', '7']) {
      await prisma.plan.update({ where: { id: plan.id }, data: { options: text } })
      expect((await load(user.id)).planOptions, text).toEqual({})
    }
  })

  test('a version-1 plan is not the stored plan the engine keeps', async () => {
    const user = await seedUser()
    const goal = await prisma.goal.create({ data: goalRow(user.id) })
    await prisma.plan.create({ data: { ...planRow(user.id, goal.id), generatorVersion: 1 } })
    const ctx = await load(user.id)
    expect(ctx.plan).toBeNull()
    expect(ctx.existing()).toBeNull()
    // The plan still names the goal the runner follows.
    expect(ctx.goal?.id).toBe(goal.id)
  })
})

describe('currentGoalFor', () => {
  test("is null without a goal, and ignores another user's", async () => {
    const user = await seedUser()
    const other = await seedUser('other@example.com')
    expect(await currentGoalFor(prisma, user.id)).toBeNull()
    await prisma.goal.create({ data: goalRow(other.id, { isActive: true }) })
    expect(await currentGoalFor(prisma, user.id)).toBeNull()
  })

  test('is the goal marked active when there is no plan', async () => {
    const user = await seedUser()
    await prisma.goal.create({ data: goalRow(user.id, { name: 'Not this one' }) })
    const active = await prisma.goal.create({
      data: goalRow(user.id, { name: 'This one', isActive: true }),
    })
    const goal = await currentGoalFor(prisma, user.id)
    expect(goal?.id).toBe(active.id)
    expect(goal?.name).toBe('This one')
  })

  test("is the active plan's goal even when another goal is marked active", async () => {
    const user = await seedUser()
    const followed = await prisma.goal.create({ data: goalRow(user.id, { name: 'Followed' }) })
    await prisma.goal.create({ data: goalRow(user.id, { name: 'Marked', isActive: true }) })
    await prisma.plan.create({ data: planRow(user.id, followed.id) })
    expect((await currentGoalFor(prisma, user.id))?.id).toBe(followed.id)
  })

  test('ignores an archived plan', async () => {
    const user = await seedUser()
    const old = await prisma.goal.create({ data: goalRow(user.id, { name: 'Old' }) })
    const marked = await prisma.goal.create({
      data: goalRow(user.id, { name: 'Marked', isActive: true }),
    })
    await prisma.plan.create({ data: planRow(user.id, old.id, { status: 'archived' }) })
    expect((await currentGoalFor(prisma, user.id))?.id).toBe(marked.id)
  })

  test('the snapshot carries the same answer', async () => {
    const user = await seedUser()
    const marked = await prisma.goal.create({ data: goalRow(user.id, { isActive: true }) })
    expect((await load(user.id)).goal?.id).toBe(marked.id)
  })
})

describe('memoByVersion', () => {
  const args = (userId: string, over: { name?: string; today?: string } = {}) => ({
    userId,
    name: over.name ?? 'stats',
    ...(over.today === undefined ? {} : { today: over.today }),
  })

  test('computes once per data version and once for concurrent callers', async () => {
    const user = await seedUser()
    const compute = vi.fn(() => Promise.resolve({ runs: 3 }))

    const [a, b] = await Promise.all([
      memoByVersion(deps, args(user.id), compute),
      memoByVersion(deps, args(user.id), compute),
    ])
    expect(b).toBe(a)
    expect(await memoByVersion(deps, args(user.id), compute)).toBe(a)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  test("computes again after a state write, a second connection's write and a transaction", async () => {
    const user = await seedUser()
    let calls = 0
    const compute = () => ++calls
    expect(await memoByVersion(deps, args(user.id), compute)).toBe(1)

    await prisma.activity.create({ data: run(user.id, '2026-10-19') })
    expect(await memoByVersion(deps, args(user.id), compute)).toBe(2)
    expect(await memoByVersion(deps, args(user.id), compute)).toBe(2)

    const other = await open()
    await other.activity.create({ data: run(user.id, '2026-10-18') })
    expect(await memoByVersion(deps, args(user.id), compute)).toBe(3)

    await prisma.$transaction(async (tx) => {
      await tx.activity.create({ data: run(user.id, '2026-10-17') })
    })
    expect(await memoByVersion(deps, args(user.id), compute)).toBe(4)
    expect(await memoByVersion(deps, args(user.id), compute)).toBe(4)
  })

  test('keeps names and users apart, and the day only when the caller gives one', async () => {
    const user = await seedUser()
    const other = await seedUser('other@example.com')
    let calls = 0
    const compute = () => ++calls

    expect(await memoByVersion(deps, args(user.id, { name: 'a' }), compute)).toBe(1)
    expect(await memoByVersion(deps, args(user.id, { name: 'b' }), compute)).toBe(2)
    expect(await memoByVersion(deps, args(other.id, { name: 'a' }), compute)).toBe(3)
    expect(await memoByVersion(deps, args(user.id, { name: 'a' }), compute)).toBe(1)

    // Without a day the value ignores midnight; with one, a new day computes again.
    expect(await memoByVersion(deps, args(user.id, { name: 'd', today: TODAY }), compute)).toBe(4)
    expect(await memoByVersion(deps, args(user.id, { name: 'd', today: TODAY }), compute)).toBe(4)
    expect(
      await memoByVersion(deps, args(user.id, { name: 'd', today: '2026-10-22' }), compute),
    ).toBe(5)
  })

  test('freezes what it returns and remembers an undefined result', async () => {
    const user = await seedUser()
    const value = await memoByVersion(deps, args(user.id), () => ({
      list: [1, 2],
      nested: { a: 1 },
    }))
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.list)).toBe(true)
    expect(() => value.list.push(3)).toThrow(TypeError)

    const compute = vi.fn(() => undefined)
    await memoByVersion(deps, args(user.id, { name: 'none' }), compute)
    await memoByVersion(deps, args(user.id, { name: 'none' }), compute)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  test('does not keep a value computed during a transaction or while a write landed', async () => {
    const user = await seedUser()
    let calls = 0
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.activity.create({ data: run(user.id, '2026-10-19') })
        await memoByVersion(deps, args(user.id), () => ++calls)
        expect(cacheSizes(prisma).memos).toBe(0)
        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')

    const overlapped = await memoByVersion(deps, args(user.id), async () => {
      await prisma.activity.create({ data: run(user.id, '2026-10-18') })
      return ++calls
    })
    expect(overlapped).toBe(2)
    expect(cacheSizes(prisma).memos).toBe(0)

    expect(await memoByVersion(deps, args(user.id), () => ++calls)).toBe(3)
    expect(cacheSizes(prisma).memos).toBe(1)
  })

  test('does not remember a failure, and keeps at most 64 values', async () => {
    const user = await seedUser()
    await expect(
      memoByVersion(deps, args(user.id), () => Promise.reject(new Error('no model'))),
    ).rejects.toThrow('no model')
    expect(await memoByVersion(deps, args(user.id), () => 'ok')).toBe('ok')

    for (let i = 0; i < MEMO_LRU_SIZE + 5; i++) {
      await memoByVersion(deps, args(user.id, { name: `n${i}` }), () => i)
    }
    expect(cacheSizes(prisma).memos).toBe(MEMO_LRU_SIZE)
  })

  test('is dropped by the same writes as the snapshot', async () => {
    const user = await seedUser()
    await memoByVersion(deps, args(user.id), () => 1)
    await load(user.id)
    expect(cacheSizes(prisma)).toEqual({ snapshots: 1, memos: 1 })
    await prisma.activity.create({ data: run(user.id, '2026-10-19') })
    expect(cacheSizes(prisma)).toEqual({ snapshots: 0, memos: 0 })
  })
})
