import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { buildPlan } from '../../shared/engine/index.ts'
import { PARAMS_VERSION } from '../../shared/engine/params/index.ts'
import type { PlanWithSessions, PredictionView, StateView } from '../../shared/types.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { createPrisma, initSqlite, type PrismaClient } from '../../server/db.ts'
import { athleteKey, cacheSizes, loadAthleteContext } from '../../server/services/athleteState.ts'
import { gatherEngineInput } from '../../server/services/engineInput.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// A Wednesday at noon. Only Date is faked; timers and promises keep working.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 21, 12))
const today = todayIso()
const thisMonday = mondayOf(today)

let ctx: TestCtx
let user: TestUser
const extra: PrismaClient[] = []

beforeEach(async () => {
  vi.setSystemTime(new Date(2026, 9, 21, 12))
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(extra.splice(0).map((prisma) => prisma.$disconnect()))
  await ctx.close()
})

/** Another connection to the same file, as a second process would have. */
async function secondConnection(): Promise<PrismaClient> {
  const prisma = createPrisma(ctx.config.databaseUrl)
  await initSqlite(prisma)
  extra.push(prisma)
  return prisma
}

/** Twelve completed weeks of four runs and a race a month ago, so the engine has a history. */
async function seedHistory(userId: string): Promise<void> {
  const week = [
    { dow: 1, min: 40, distanceM: 6400 },
    { dow: 3, min: 45, distanceM: 7200 },
    { dow: 5, min: 35, distanceM: 5600 },
    { dow: 6, min: 70, distanceM: 11_000 },
  ]
  const rows = []
  for (let w = 1; w <= 12; w += 1) {
    for (const run of week) {
      rows.push({
        userId,
        date: addDays(thisMonday, -7 * w + run.dow),
        type: 'run',
        durationSec: run.min * 60,
        movingSec: run.min * 60,
        distanceM: run.distanceM,
        rpe: 3,
        source: 'manual',
      })
    }
  }
  rows.push({
    userId,
    date: addDays(today, -30),
    type: 'race',
    durationSec: 3300,
    movingSec: 3300,
    distanceM: 10_000,
    rpe: 9,
    source: 'manual',
  })
  await ctx.prisma.activity.createMany({ data: rows })
}

async function seedGoal(userId: string, over: { name?: string; isActive?: boolean } = {}) {
  return ctx.prisma.goal.create({
    data: {
      userId,
      name: over.name ?? 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 14 + 5),
      distanceM: 21_097,
      goalType: 'finish',
      isActive: over.isActive ?? false,
    },
  })
}

async function getState(headers: Record<string, string> = {}, search = '') {
  const request = client(ctx, user).get(`/api/state${search}`)
  for (const [name, value] of Object.entries(headers)) request.set(name, value)
  return request
}

const ETAG_FORMAT = new RegExp(
  `^W/"[0-9a-f]{8}\\.\\d+\\.\\d+\\.\\d{4}-\\d{2}-\\d{2}\\.${PARAMS_VERSION.replace(/\./g, '\\.')}"$`,
)

describe('GET /api/state', () => {
  test('needs a session and takes no query', async () => {
    const anonymous = await client(ctx).get('/api/state')
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toMatchObject({ error: { code: 'unauthorized' } })

    const unknown = await getState({}, '?goalId=g1')
    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ error: { code: 'validation' } })
  })

  test('answers with the snapshot of the server day', async () => {
    await seedHistory(user.id)
    const res = await getState()
    expect(res.status).toBe(200)
    const view = res.body as StateView

    expect(view.asOf).toBe('2026-10-21')
    expect(view.paramsVersion).toBe(PARAMS_VERSION)
    expect(view.version).toMatch(/^[0-9a-f]{8}\.\d+\.\d+$/)
    expect(Number.isNaN(Date.parse(view.builtAt))).toBe(false)
    expect(view.state.asOf).toBe(today)
    expect(view.state.lastRunDate).not.toBeNull()
    expect(view.zones.pace).toBeDefined()
    expect(view.readiness.date).toBe(today)
    expect(view.goal).toBeNull()
    expect(view.plan).toBeNull()
    expect(view.prediction).toBeNull()
    expect(view.inputs).toEqual({
      activities: {
        windowDays: 365,
        count: 49,
        latest: addDays(thisMonday, -1),
        flaggedDuplicates: 0,
      },
      wellness: { windowDays: 60, count: 0, latest: null },
      reviews: { windowWeeks: 16, count: 0 },
    })
  })

  test('sets a weak tag from the data version, the day and the parameter version', async () => {
    const res = await getState()
    expect(res.headers['etag']).toMatch(ETAG_FORMAT)
    const version = await dataVersionKey(ctx.prisma)
    expect(res.headers['etag']).toBe(`W/"${athleteKey(version, '2026-10-21')}"`)
    expect(res.headers['cache-control']).toBe('private, no-cache')
    expect(res.headers['vary']).toMatch(/Cookie/i)
  })

  test('answers 304 to the current tag before building or serialising anything', async () => {
    const version = await dataVersionKey(ctx.prisma)
    const tag = `W/"${athleteKey(version, '2026-10-21')}"`
    expect(cacheSizes(ctx.prisma).snapshots).toBe(0)

    const res = await getState({ 'If-None-Match': tag })

    expect(res.status).toBe(304)
    expect(res.text).toBe('')
    expect(res.headers['etag']).toBe(tag)
    // Nothing was built: the answer came from the tag alone.
    expect(cacheSizes(ctx.prisma).snapshots).toBe(0)

    // The same request after the picture exists is a 304 too, and builds nothing more.
    expect((await getState()).status).toBe(200)
    expect(cacheSizes(ctx.prisma).snapshots).toBe(1)
    expect((await getState({ 'If-None-Match': tag })).status).toBe(304)
    expect(cacheSizes(ctx.prisma).snapshots).toBe(1)
  })

  test('a tag that is not current gets the full answer', async () => {
    const res = await getState({ 'If-None-Match': 'W/"0.0.0.2000-01-01.old"' })
    expect(res.status).toBe(200)
    expect((res.body as StateView).asOf).toBe('2026-10-21')
  })

  test('the tag changes after a write through the API, and the body follows', async () => {
    const first = await getState()
    const tag = first.headers['etag'] as string
    expect((first.body as StateView).inputs.activities.count).toBe(0)

    const created = await client(ctx, user)
      .post('/api/activities')
      .send({ date: addDays(today, -1), type: 'run', durationSec: 1800, distanceM: 5000 })
    expect(created.status).toBe(201)

    const second = await getState({ 'If-None-Match': tag })
    expect(second.status).toBe(200)
    expect(second.headers['etag']).not.toBe(tag)
    expect((second.body as StateView).inputs.activities.count).toBe(1)
    expect((second.body as StateView).state.lastRunDate).toBe(addDays(today, -1))
    expect((await getState({ 'If-None-Match': second.headers['etag'] as string })).status).toBe(304)
  })

  test('sees a write made by a second connection', async () => {
    const first = await getState()
    const tag = first.headers['etag'] as string
    const other = await secondConnection()

    await other.activity.create({
      data: { userId: user.id, date: addDays(today, -2), type: 'run', durationSec: 1800 },
    })

    const second = await getState({ 'If-None-Match': tag })
    expect(second.status).toBe(200)
    expect(second.headers['etag']).not.toBe(tag)
    expect((second.body as StateView).inputs.activities.count).toBe(1)
  })

  test('the tag and the picture follow the server day', async () => {
    const first = await getState()
    const tag = first.headers['etag'] as string

    vi.setSystemTime(new Date(2026, 9, 22, 0, 5))
    const next = await getState({ 'If-None-Match': tag })

    expect(next.status).toBe(200)
    expect((next.body as StateView).asOf).toBe('2026-10-22')
    expect(next.headers['etag']).not.toBe(tag)
  })

  test("does not offer one user's tag to another", async () => {
    const res = await getState()
    expect(String(res.headers['vary'])).toMatch(/Cookie/i)
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await ctx.prisma.activity.create({
      data: { userId: other.id, date: addDays(today, -1), type: 'run', durationSec: 1800 },
    })
    const theirs = await client(ctx, other).get('/api/state')
    expect(theirs.status).toBe(200)
    expect((theirs.body as StateView).inputs.activities.count).toBe(1)
    expect((res.body as StateView).inputs.activities.count).toBe(0)
  })

  test('names the goal the plan follows, the plan and the prediction the predictions route gives', async () => {
    ctx.fetch = () => Promise.reject(new Error('no network in the state view'))
    await seedHistory(user.id)
    const followed = await seedGoal(user.id, { name: 'Followed' })
    const marked = await seedGoal(user.id, { name: 'Marked' })

    const generate = await client(ctx, user)
      .post('/api/plan/generate')
      .send({ goalId: followed.id })
    expect(generate.status, JSON.stringify(generate.body)).toBe(201)
    const plan = generate.body as PlanWithSessions
    // Mark the other goal active: the plan still decides which goal the runner follows.
    await ctx.prisma.goal.updateMany({ where: { userId: user.id }, data: { isActive: false } })
    await ctx.prisma.goal.update({ where: { id: marked.id }, data: { isActive: true } })

    const view = (await getState()).body as StateView
    expect(view.goal?.id).toBe(followed.id)
    expect(view.plan?.id).toBe(plan.id)
    expect(view.plan?.generatorVersion).toBe(2)
    expect(view.prediction?.predictedSec).toBeGreaterThan(0)

    // The same numbers the other routes give.
    const predictions = (await client(ctx, user).get(`/api/predictions?goalId=${followed.id}`))
      .body as PredictionView
    expect(view.prediction).toEqual(predictions.prediction)
    const stored = (await client(ctx, user).get('/api/plan')).body as PlanWithSessions
    expect(view.zones).toEqual(stored.zones)

    const picture = await loadAthleteContext(ctx, { userId: user.id, today })
    const existing = picture.existing()
    expect(existing?.sessions.map((s) => s.id)).toEqual(plan.sessions.map((s) => s.id))
    expect(existing?.weeks.map((w) => w.weekStart)).toEqual(plan.weeks.map((w) => w.weekStart))
  })
})

describe('a plan from a warm snapshot', () => {
  test('equals the plan from a cold gather', async () => {
    ctx.fetch = () => Promise.reject(new Error('no network'))
    await seedHistory(user.id)
    await ctx.prisma.screening.create({
      data: { userId: user.id, date: addDays(today, -10), kind: 'reds', answers: '{}', flags: 1 },
    })
    await ctx.prisma.wellnessDay.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        userId: user.id,
        date: addDays(today, -i - 1),
        source: 'manual',
        restingHr: 50 + (i % 3),
        hrvRmssd: 55 + (i % 5),
        sleepSec: 7 * 3600,
        fatigue: 3,
      })),
    })
    const goal = await seedGoal(user.id)
    const args = { userId: user.id, goalId: goal.id, today }

    // Warm: the first gather builds the snapshot, the second one reads it.
    await gatherEngineInput(ctx, args)
    const warmInput = await gatherEngineInput(ctx, args)
    expect(cacheSizes(ctx.prisma).snapshots).toBe(1)

    // Cold: a client with no cache, as a restarted server would be.
    const cold = await secondConnection()
    const coldInput = await gatherEngineInput(
      { prisma: cold, config: ctx.config, fetch: ctx.fetch },
      args,
    )

    expect(warmInput).toEqual(coldInput)
    const warmPlan = buildPlan(warmInput)
    const coldPlan = buildPlan(coldInput)
    expect(warmPlan.checklist.every((item) => item.ok)).toBe(true)
    expect(JSON.stringify(warmPlan)).toBe(JSON.stringify(coldPlan))
  })

  test('generates the same plan whether or not the state was read first', async () => {
    ctx.fetch = () => Promise.reject(new Error('no network'))
    await seedHistory(user.id)
    const goal = await seedGoal(user.id)

    // Read the state view first, so generation starts from a warm snapshot.
    expect((await getState()).status).toBe(200)
    const warm = await client(ctx, user).post('/api/plan/generate').send({ goalId: goal.id })
    expect(warm.status, JSON.stringify(warm.body)).toBe(201)

    // The generation itself wrote, so the next read is cold for the new data version.
    const again = await client(ctx, user).post('/api/plan/generate').send({ goalId: goal.id })
    expect(again.status).toBe(201)
    const strip = (plan: PlanWithSessions) =>
      plan.sessions.map(({ date, kind, title, durationMin, distanceM, rules }) => ({
        date,
        kind,
        title,
        durationMin,
        distanceM,
        rules,
      }))
    expect(strip(again.body as PlanWithSessions)).toEqual(strip(warm.body as PlanWithSessions))
  })
})
