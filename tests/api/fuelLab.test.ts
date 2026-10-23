// The fuel lab read side (phase 3a design 10.4 and 10.5, task E6-5): the lab view, the targets of
// the planned runs, the Today fields, the watch line, a confirmed duplicate's log and the
// gut-training option of a plan. The write side (products, settings, logs) is `fuel.test.ts`.
// Only Date is faked, at a Wednesday noon, so "today" and the forecast are fixed.
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, daysBetween, mondayOf, todayIso } from '../../shared/dates.ts'
import {
  eahText,
  fuelDisclaimer,
  gutConditionLock,
  gutTrainingText,
  rangeOrderMessage,
  rangeSpanMessage,
} from '../../shared/engine/fuelCopy.ts'
import { P } from '../../shared/engine/params/index.ts'
import { FUEL_HISTORY_SHOWN, FUEL_PROMPTS_MAX, FUEL_TARGETS_MAX_DAYS } from '../../shared/limits.ts'
import type {
  FuelLabView,
  FuelProduct,
  FuelSettings,
  PlanSessionStatus,
  FuelTargetView,
  PlanRevisionView,
  PlanWithSessions,
  TodayView,
  ValidationIssue,
} from '../../shared/types.ts'
import { markDuplicates } from '../../server/services/duplicates.ts'
import { buildDeliverables, type SendDeliverable } from '../../server/services/workouts.ts'
import { refreshWeatherCaches, settleWeatherCache } from '../../server/services/weatherCache.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { makeFuelPrompts, makeFuelSlot } from '../web/today-fixtures.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  noNetwork,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// A Wednesday at noon.
const NOON = new Date(2026, 9, 21, 12)
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(NOON)

const today = todayIso()
const tomorrow = addDays(today, 1)
const thisMonday = mondayOf(today)
const HOUR = 3600

let ctx: TestCtx
let users = 0

const deps = () => ({ prisma: ctx.prisma, config: ctx.config })

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(async () => {
  await settleWeatherCache()
  vi.setSystemTime(NOON)
  await ctx.prisma.forecastCache.deleteMany()
  await ctx.prisma.climateCache.deleteMany()
  expectNoRefusedFetches(ctx)
})

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/** A runner of their own, so no test reads another's logs or plan. */
async function newUser(): Promise<TestUser> {
  users += 1
  const user = await seedUser(ctx, { email: `lab${String(users)}@example.com` })
  await ctx.prisma.athleteProfile.create({
    data: { userId: user.id, hrMax: 190, hrRest: 50, timezone: 'UTC' },
  })
  return user
}

const GEL = {
  name: 'Synthetic gel',
  kind: 'gel',
  servingLabel: '1 gel',
  carbsG: 40,
  sodiumMg: 100,
  kcal: 160,
  multiCarb: true,
}

async function addProduct(
  user: TestUser,
  over: Record<string, unknown> = {},
): Promise<FuelProduct> {
  const res = await client(ctx, user)
    .post('/api/fuel/products')
    .send({ ...GEL, ...over })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body as FuelProduct
}

async function addRun(
  user: TestUser,
  date: string,
  over: {
    durationSec?: number
    tempC?: number
    humidityPct?: number
    duplicateStatus?: string
  } = {},
) {
  return ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date,
      type: 'run',
      durationSec: over.durationSec ?? 3 * HOUR,
      distanceM: 30_000,
      source: 'manual',
      tempC: over.tempC ?? null,
      humidityPct: over.humidityPct ?? null,
      ...(over.duplicateStatus ? { duplicateStatus: over.duplicateStatus } : {}),
    },
  })
}

/** Seven 40 g gels over three hours is 93 g/h, enough for any rung up to 100 g/h. */
async function logRun(
  user: TestUser,
  product: FuelProduct,
  activityId: string,
  over: Record<string, unknown> = {},
) {
  const res = await client(ctx, user)
    .put(`/api/fuel/logs/${activityId}`)
    .send({ items: [{ productId: product.id, servings: 7 }], gut: 0, ...over })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as { ladder: FuelLabView['ladder']; message: string | null }
}

async function putSettings(user: TestUser, over: Partial<FuelSettings> = {}) {
  const body: FuelSettings = {
    optIn90: false,
    optInAdvanced: false,
    giDisease: false,
    gutBlock: true,
    ...over,
  }
  const res = await client(ctx, user).put('/api/fuel/settings').send(body)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

async function lab(user: TestUser): Promise<FuelLabView> {
  const res = await client(ctx, user).get('/api/fuel')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as FuelLabView
}

async function targets(user: TestUser, from: string, to: string): Promise<FuelTargetView[]> {
  const res = await client(ctx, user).get(`/api/fuel/targets?from=${from}&to=${to}`)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as FuelTargetView[]
}

async function todayOf(user: TestUser, query = ''): Promise<TodayView> {
  const res = await client(ctx, user).get(`/api/today${query}`)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as TodayView
}

interface SessionSeed {
  date: string
  kind?: string
  min?: number
  status?: PlanSessionStatus
  flags?: string[]
}

interface PlanSeed {
  sessions?: SessionSeed[]
  /** Mondays whose plan week carries the `gut-training` flag. */
  gutWeeks?: string[]
  distanceM?: number
  targetTimeSec?: number
}

/** A version-2 plan with hand-made sessions, so each test controls exactly what is planned. */
async function seedPlan(user: TestUser, seed: PlanSeed = {}) {
  const sessions = seed.sessions ?? []
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic race',
      priority: 'A',
      targetDate: addDays(today, 7 * 12 + 5),
      distanceM: seed.distanceM ?? 160_934,
      targetTimeSec: seed.targetTimeSec ?? null,
    },
  })
  const mondays = [
    ...new Set([thisMonday, ...(seed.gutWeeks ?? []), ...sessions.map((s) => mondayOf(s.date))]),
  ].sort()
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      name: goal.name,
      startDate: thisMonday,
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: 2,
      weeks: {
        create: mondays.map((weekStart, index) => ({
          weekStart,
          index,
          phase: 'build',
          baselineRunMin: 200,
          targetRunMin: 200,
          longRunMin: 150,
          runDays: 4,
          strengthSessions: 0,
          flags: JSON.stringify(seed.gutWeeks?.includes(weekStart) ? ['gut-training'] : []),
        })),
      },
    },
  })
  const rows = []
  for (const [order, s] of sessions.entries()) {
    rows.push(
      await ctx.prisma.planSession.create({
        data: {
          planId: plan.id,
          externalId: randomUUID(),
          weekStart: mondayOf(s.date),
          date: s.date,
          order,
          kind: s.kind ?? 'long',
          title: `${s.kind ?? 'long'} session`,
          durationMin: s.min ?? 150,
          structure: '[]',
          target: JSON.stringify({ zone: 'z1', rpe: [3, 4], hr: null, paceSecPerKm: null }),
          purpose: 'Synthetic.',
          flags: JSON.stringify(s.flags ?? []),
          status: s.status ?? 'planned',
        },
      }),
    )
  }
  return { goal, plan, rows }
}

async function setHome(userId: string): Promise<void> {
  await ctx.prisma.athleteProfile.update({
    where: { userId },
    data: { homeLat: 40.1, homeLng: -105.2 },
  })
}

/** A forecast for today: 20 C until 09:00, then 33 C with no radiation, so the air temperature leads. */
async function fillForecast(userId: string): Promise<void> {
  ctx.fetch = fakeFetch({
    'GET https://api.open-meteo.com/v1/forecast': () => {
      const times = Array.from(
        { length: 24 },
        (_, h) => `${today}T${String(h).padStart(2, '0')}:00`,
      )
      return Response.json({
        hourly: {
          time: times,
          temperature_2m: times.map((_, h) => (h < 9 ? 20 : 33)),
          relative_humidity_2m: times.map(() => 60),
          dew_point_2m: times.map(() => 16),
          wind_speed_10m: times.map(() => 5),
        },
      })
    },
  })
  await refreshWeatherCaches(ctx, userId)
  ctx.fetch = noNetwork(ctx.refusedFetches)
}

const issuesOf = (res: { body: unknown }): ValidationIssue[] =>
  ((res.body as { error: { details?: { issues?: ValidationIssue[] } } }).error.details?.issues ??
    []) satisfies ValidationIssue[]

// ---------------------------------------------------------------------------------------------
// GET /api/fuel
// ---------------------------------------------------------------------------------------------

describe('GET /api/fuel', () => {
  test('needs a session', async () => {
    expect((await client(ctx).get('/api/fuel')).status).toBe(401)
    expect((await client(ctx).get(`/api/fuel/targets?from=${today}&to=${today}`)).status).toBe(401)
  })

  test('answers a runner with no logs: the floor, the defaults and the safety words', async () => {
    const user = await newUser()
    const view = await lab(user)
    expect(view.settings).toEqual({
      optIn90: false,
      optInAdvanced: false,
      giDisease: false,
      gutBlock: true,
    })
    expect(view.ladder).toMatchObject({
      currentIndex: 0,
      toleratedIndex: -1,
      held: false,
      locked: false,
      basis: 'start',
      steps: [],
    })
    expect(view.ladder.rungs[0]).toMatchObject({ gPerH: 30, state: 'next-up' })
    expect(view.next).toBeNull()
    expect(view.block).toMatchObject({ state: 'none', weeks: [], from: null, to: null })
    expect(view.block.lines).toEqual(gutTrainingText())
    expect(view.products).toEqual([])
    expect(view.history).toEqual([])
    expect(view.prompts).toEqual([])
    expect(view.eah).toMatchObject({ stronger: false, ...eahText(false) })
    expect(view.disclaimers).toEqual({ general: fuelDisclaimer(), gutCondition: null })
  })

  test('replays the logs: hot by the weather the run has, a short run in a gut-training week counts', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    // The block week holds a run the plan never linked: it counts from the shorter length.
    await seedPlan(user, { gutWeeks: [thisMonday] })

    const first = await addRun(user, addDays(thisMonday, -14))
    const hot = await addRun(user, addDays(thisMonday, -7), { tempC: 31, humidityPct: 50 })
    const short = await addRun(user, addDays(thisMonday, 1), { durationSec: 70 * 60 })
    await logRun(user, gel, first.id)
    await logRun(user, gel, hot.id, { items: [{ productId: gel.id, servings: 5 }] })
    await logRun(user, gel, short.id, { items: [{ productId: gel.id, servings: 2 }] })

    const view = await lab(user)
    expect(view.history.map((row) => row.log.activityId)).toEqual([short.id, hot.id, first.id])
    const [shortRow, hotRow, firstRow] = view.history
    expect(firstRow!.log.step).toMatchObject({ hot: false, outcome: 'step-up', reason: 'counted' })
    // The warm run is judged by its own weather and changes nothing.
    expect(hotRow!.log.step).toMatchObject({ hot: true, outcome: 'warm-tolerated' })
    expect(hotRow!.note).toBe('Warm day: tolerated at 60 g/h. The target stays at 60 g/h.')
    // 70 minutes is short of the logging length and counts only because the week is a block week.
    expect(shortRow!.log.step).toMatchObject({
      reason: 'counted',
      requiredMin: P.h7.gutTrainingSessionMinMin.value,
      outcome: 'tolerated-top',
    })
    expect(shortRow!.note).toBe(
      'Tolerated at 60 g/h. That is the highest rate open on your ladder for now.',
    )
    expect(view.ladder).toMatchObject({ currentIndex: 1, toleratedIndex: 1, countedRuns: 3 })
    expect(view.block).toMatchObject({
      state: 'planned',
      weeks: [thisMonday],
      from: thisMonday,
      to: addDays(thisMonday, 6),
      removalPending: false,
    })
    expect(view.products.map((p) => p.name)).toEqual(['Synthetic gel'])
  })

  test('lists the latest logs of the history, newest first, and lists no archived product', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const old = await addProduct(user, { name: 'Old gel' })
    await client(ctx, user).delete(`/api/fuel/products/${old.id}`)
    const runs = []
    for (let i = 0; i < FUEL_HISTORY_SHOWN + 2; i += 1) {
      runs.push(await addRun(user, addDays(today, -60 + i)))
    }
    for (const run of runs) await logRun(user, gel, run.id, { gut: 1 })

    const view = await lab(user)
    expect(view.history).toHaveLength(FUEL_HISTORY_SHOWN)
    expect(view.history[0]!.log.activityId).toBe(runs.at(-1)!.id)
    expect(view.history.at(-1)!.log.activityId).toBe(runs[2]!.id)
    expect(view.ladder.steps).toHaveLength(FUEL_HISTORY_SHOWN + 2)
    expect(view.products.map((p) => p.name)).toEqual(['Synthetic gel'])
  })

  test('a gut condition locks the ladder, shows the clinician line and plans no block', async () => {
    const user = await newUser()
    await seedPlan(user, { gutWeeks: [thisMonday] })
    await putSettings(user, { giDisease: true })
    const view = await lab(user)
    expect(view.ladder.locked).toBe(true)
    expect(view.ladder.basis).toBe('locked')
    expect(view.ladder.rungs.slice(1).every((rung) => rung.state === 'gut-condition')).toBe(true)
    expect(view.disclaimers.gutCondition).toBe(gutConditionLock())
    // The plan still holds the block until the next re-plan removes it.
    expect(view.block).toMatchObject({ state: 'locked', removalPending: true, lines: [] })
    expect(view.settings).toMatchObject({ giDisease: true, gutBlock: false, optIn90: false })
  })

  test('switching the block off leaves it in the plan until the next re-plan', async () => {
    const user = await newUser()
    await seedPlan(user, { gutWeeks: [thisMonday] })
    await putSettings(user, { gutBlock: false })
    expect(await lab(user)).toMatchObject({
      block: { state: 'off', removalPending: true, lines: gutTrainingText() },
    })
  })

  test('names the next planned run that can carry a target, and skips the ones that cannot', async () => {
    const user = await newUser()
    await seedPlan(user, {
      sessions: [
        { date: today, kind: 'easy', min: 40 },
        { date: tomorrow, kind: 'strength', min: 45 },
        { date: addDays(today, 3), kind: 'long', min: 150 },
        { date: addDays(today, 5), kind: 'long', min: 180 },
      ],
    })
    const view = await lab(user)
    expect(view.next).toMatchObject({
      session: { date: addDays(today, 3), kind: 'long', durationMin: 150 },
      target: { gPerH: 30, range: [30, 50], basis: 'start', hot: false, locked: false },
      text: {
        heading: 'Fuel target: 30 to 50 g/h of carbohydrate',
        watch: 'Fuel 30 to 50 g/h carbs. Drink to thirst.',
        lock: null,
      },
    })
  })

  test('a standard card for a short goal, a stronger one for a long goal and in heat', async () => {
    const quick = await newUser()
    await seedPlan(quick, { distanceM: 10_000, targetTimeSec: 40 * 60 })
    expect((await lab(quick)).eah.stronger).toBe(false)

    const ultra = await newUser()
    await seedPlan(ultra, { targetTimeSec: 30 * HOUR })
    const view = await lab(ultra)
    expect(view.eah).toEqual({
      stronger: true,
      heading: eahText(true).heading,
      lines: eahText(true).lines,
    })
    expect(view.eah.lines).toContain(
      `On events over ${String(P.n7.eahStrongerAlertHours.value)} hours, or in heat, take extra care: drink only when thirsty, and get help early if symptoms start.`,
    )

    const warm = await newUser()
    await seedPlan(warm, {
      distanceM: 10_000,
      targetTimeSec: 40 * 60,
      sessions: [{ date: today, kind: 'long', min: 150 }],
    })
    await setHome(warm.id)
    await fillForecast(warm.id)
    const hotView = await lab(warm)
    expect(hotView.next?.target.hot).toBe(true)
    expect(hotView.eah.stronger).toBe(true)
  })

  test('runs the replay once per data version, the one a save answers with included', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    await logRun(user, gel, (await addRun(user, addDays(today, -3))).id)
    const second = await addRun(user, addDays(today, -2))
    const replays = vi.spyOn(ctx.prisma.fuelLog, 'findMany')
    // The save replays once for its answer, and every read after it shares that replay.
    await logRun(user, gel, second.id)
    await lab(user)
    await lab(user)
    await client(ctx, user).get(`/api/fuel/targets?from=${today}&to=${tomorrow}`)
    await todayOf(user)
    expect(replays).toHaveBeenCalledTimes(1)
    // A write takes the shared replay with it.
    await logRun(user, gel, second.id, { gut: 2 })
    await lab(user)
    expect(replays).toHaveBeenCalledTimes(2)
    replays.mockRestore()
  })
})

// ---------------------------------------------------------------------------------------------
// GET /api/fuel/targets
// ---------------------------------------------------------------------------------------------

describe('GET /api/fuel/targets', () => {
  test('validates the range with a path per field', async () => {
    const user = await newUser()
    const api = client(ctx, user)

    const missing = await api.get('/api/fuel/targets')
    expect(missing.status).toBe(400)
    expect(
      issuesOf(missing)
        .map((issue) => issue.path)
        .sort(),
    ).toEqual(['from', 'to'])

    const bad = await api.get('/api/fuel/targets?from=2026-02-30&to=soon')
    expect(bad.status).toBe(400)
    expect(issuesOf(bad)).toEqual(
      expect.arrayContaining([
        { path: 'from', message: 'Use a real calendar date.' },
        { path: 'to', message: 'Use a date as YYYY-MM-DD.' },
      ]),
    )

    const backwards = await api.get(`/api/fuel/targets?from=${tomorrow}&to=${today}`)
    expect(backwards.status).toBe(400)
    expect(issuesOf(backwards)).toEqual([{ path: 'from', message: rangeOrderMessage() }])

    const far = addDays(today, FUEL_TARGETS_MAX_DAYS + 1)
    const wide = await api.get(`/api/fuel/targets?from=${today}&to=${far}`)
    expect(wide.status).toBe(400)
    expect(issuesOf(wide)).toEqual([
      { path: 'to', message: rangeSpanMessage(FUEL_TARGETS_MAX_DAYS) },
    ])
    expect(rangeSpanMessage(FUEL_TARGETS_MAX_DAYS)).toBe('Ask for no more than 62 days at a time.')

    // The span itself is allowed, and so is a single day.
    expect(daysBetween(today, addDays(today, FUEL_TARGETS_MAX_DAYS))).toBe(FUEL_TARGETS_MAX_DAYS)
    expect(await targets(user, today, addDays(today, FUEL_TARGETS_MAX_DAYS))).toEqual([])
    expect(await targets(user, today, today)).toEqual([])
  })

  test('serves a target for each run still to be run and none for the others', async () => {
    const user = await newUser()
    const min = P.h7.logMinDurationMin.value
    const seeds: Array<SessionSeed & { expected: boolean }> = [
      { date: addDays(today, 0), status: 'planned', expected: true },
      { date: addDays(today, 1), status: 'moved', expected: true },
      { date: addDays(today, 2), status: 'downgraded', expected: true },
      { date: addDays(today, 3), status: 'adjusted', expected: true },
      { date: addDays(today, 4), status: 'completed', expected: false },
      { date: addDays(today, 5), status: 'partial', expected: false },
      { date: addDays(today, 6), status: 'skipped', expected: false },
      { date: addDays(today, 7), kind: 'race', min: 600, expected: false },
      { date: addDays(today, 8), kind: 'strength', expected: false },
      { date: addDays(today, 9), kind: 'easy', min: 60, expected: false },
      // The gut-training flag lowers the length to the block's.
      { date: addDays(today, 10), kind: 'easy', min: 70, flags: ['fuel-practice'], expected: true },
      { date: addDays(today, 11), kind: 'long', min: min - 1, expected: false },
      { date: addDays(today, 12), kind: 'long', min, expected: true },
    ]
    await seedPlan(user, { sessions: seeds })
    const served = await targets(user, today, addDays(today, 14))
    expect(served.map((view) => view.session.date)).toEqual(
      seeds.filter((s) => s.expected).map((s) => s.date),
    )
    // In date order, each with its words and the plan's own title.
    expect(served[0]).toMatchObject({
      session: { kind: 'long', title: 'long session', durationMin: 150 },
      target: { gPerH: 30, rungIndex: 0 },
      text: { heading: 'Fuel target: 30 to 50 g/h of carbohydrate' },
    })
    // A narrower range returns its slice.
    expect(
      (await targets(user, addDays(today, 1), addDays(today, 2))).map((v) => v.session.date),
    ).toEqual([addDays(today, 1), addDays(today, 2)])
  })

  test('a moved long run keeps the target of the ladder on its new day', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    await logRun(user, gel, (await addRun(user, addDays(today, -7))).id)
    const moved = addDays(today, 4)
    await seedPlan(user, {
      sessions: [{ date: moved, kind: 'long', min: 150, status: 'moved' }],
    })
    const [view] = await targets(user, today, addDays(today, 7))
    expect(view).toMatchObject({
      session: { date: moved },
      target: { gPerH: 60, range: null, rungIndex: 1, basis: 'next-up' },
      text: {
        heading: 'Fuel target: 60 g/h of carbohydrate',
        basis: 'The last run that counted went well at 30 to 50 g/h, so this run tries 60 g/h.',
        watch: 'Fuel 60 g/h carbs. Drink to thirst.',
      },
    })
    expect(view!.text.certainty).toMatch(/^Low certainty/)
  })

  test('holds a hot day at the last tolerated rung and brings the nausea plan forward', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    await logRun(user, gel, (await addRun(user, addDays(today, -7))).id)
    await seedPlan(user, {
      sessions: [
        { date: today, kind: 'long', min: 150 },
        { date: tomorrow, kind: 'long', min: 150 },
      ],
    })
    await setHome(user.id)
    await fillForecast(user.id)
    const [warm, mild] = await targets(user, today, tomorrow)
    expect(warm).toMatchObject({
      target: {
        gPerH: 30,
        basis: 'warm-held',
        hot: true,
        nauseaPlanForward: true,
        heldBack: { gPerH: 60 },
      },
      text: {
        basis:
          'Warm day: the target stays at 30 to 50 g/h, the last rate you tolerated, instead of stepping up to 60 g/h.',
        nausea: { open: true },
      },
    })
    // The forecast holds no hours for tomorrow, so there is nothing to hold back.
    expect(mild).toMatchObject({ target: { gPerH: 60, hot: false, basis: 'next-up' } })
  })

  test("serves only the runner's own plan", async () => {
    const mine = await newUser()
    const theirs = await newUser()
    await seedPlan(mine, { sessions: [{ date: today }] })
    await seedPlan(theirs, { sessions: [{ date: tomorrow }] })
    expect((await targets(mine, today, addDays(today, 3))).map((v) => v.session.date)).toEqual([
      today,
    ])
    expect((await targets(theirs, today, addDays(today, 3))).map((v) => v.session.date)).toEqual([
      tomorrow,
    ])
  })
})

// ---------------------------------------------------------------------------------------------
// GET /api/today
// ---------------------------------------------------------------------------------------------

describe('GET /api/today: the fuel slots', () => {
  test('carries the targets of the viewed day and the day after, with the safety card', async () => {
    const user = await newUser()
    await seedPlan(user, {
      targetTimeSec: 30 * HOUR,
      sessions: [
        { date: today, kind: 'long', min: 150 },
        { date: tomorrow, kind: 'long', min: 180 },
        { date: addDays(today, 2), kind: 'long', min: 200 },
      ],
    })
    const body = await todayOf(user)
    const slot = body.coach.slots.fuel
    expect(slot?.targets.map((view) => view.session.date)).toEqual([today, tomorrow])
    expect(slot?.targets[0]).toMatchObject({
      target: { gPerH: 30, basis: 'start' },
      text: { watch: 'Fuel 30 to 50 g/h carbs. Drink to thirst.' },
    })
    expect(slot?.eah.stronger).toBe(true)
    // The page tests' fixture has the shape of the real slot, so it cannot drift from it.
    const fixture = makeFuelSlot()
    const keys = (value: object) => Object.keys(value).sort()
    expect(keys(slot!)).toEqual(keys(fixture))
    expect(keys(slot!.targets[0]!)).toEqual(keys(fixture.targets[0]!))
    expect(keys(slot!.targets[0]!.session)).toEqual(keys(fixture.targets[0]!.session))
    expect(keys(slot!.targets[0]!.target)).toEqual(keys(fixture.targets[0]!.target))
    expect(keys(slot!.targets[0]!.text)).toEqual(keys(fixture.targets[0]!.text))

    // A day ahead is a read-only preview: its own day and the one after.
    const preview = await todayOf(user, `?date=${tomorrow}`)
    expect(preview.coach.slots.fuel?.targets.map((view) => view.session.date)).toEqual([
      tomorrow,
      addDays(today, 2),
    ])
  })

  test('is empty when no run of the two days can carry a target', async () => {
    const user = await newUser()
    await seedPlan(user, {
      sessions: [
        { date: today, kind: 'easy', min: 40 },
        { date: tomorrow, kind: 'long', min: 150, status: 'completed' },
      ],
    })
    const body = await todayOf(user)
    expect(body.coach.slots.fuel).toBeNull()
    expect(body.coach.slots.fuelPrompt).toBeNull()
  })

  test('prompts for the unlogged runs of the last seven days, newest first, three at most', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const make = (daysAgo: number, over: Parameters<typeof addRun>[2] = {}) =>
      addRun(user, addDays(today, -daysAgo), over)
    const newest = await make(0)
    const second = await make(1)
    const third = await make(6)
    const fourth = await make(7) // eligible too: the list stops at three
    await make(8) // too old
    await make(2, { durationSec: 60 * 60 }) // too short to count
    await make(3, { duplicateStatus: 'possible' }) // waits for the duplicate to be settled
    const logged = await make(4)
    const skipped = await make(5)
    await logRun(user, gel, logged.id)
    expect((await client(ctx, user).post(`/api/fuel/logs/${skipped.id}/skip`)).status).toBe(200)

    const prompts = (await todayOf(user)).coach.slots.fuelPrompt?.prompts
    expect(prompts).toHaveLength(FUEL_PROMPTS_MAX)
    expect(prompts?.map((p) => p.activityId)).toEqual([newest.id, second.id, third.id])
    expect(prompts?.[0]).toEqual({
      activityId: newest.id,
      date: today,
      startTime: null,
      durationSec: 3 * HOUR,
      distanceM: 30_000,
      block: false,
    })
    expect(Object.keys(prompts![0]!).sort()).toEqual(
      Object.keys(makeFuelPrompts().prompts[0]!).sort(),
    )

    // A save takes the prompt off the very next read, with no wait for a snapshot to expire.
    await logRun(user, gel, newest.id)
    expect((await todayOf(user)).coach.slots.fuelPrompt?.prompts.map((p) => p.activityId)).toEqual([
      second.id,
      third.id,
      fourth.id,
    ])
  })

  test('counts a 70-minute run of a gut-training week, linked or not, and not a week earlier', async () => {
    const user = await newUser()
    await seedPlan(user, { gutWeeks: [thisMonday] })
    const inBlock = await addRun(user, addDays(thisMonday, 1), { durationSec: 70 * 60 })
    await addRun(user, addDays(thisMonday, -3), { durationSec: 70 * 60 })
    const prompts = (await todayOf(user)).coach.slots.fuelPrompt?.prompts
    expect(prompts).toEqual([
      expect.objectContaining({ activityId: inBlock.id, block: true, durationSec: 70 * 60 }),
    ])
  })

  test('has no prompt on a preview, which is read-only', async () => {
    const user = await newUser()
    await seedPlan(user, { sessions: [{ date: tomorrow }] })
    await addRun(user, addDays(today, -1))
    expect((await todayOf(user)).coach.slots.fuelPrompt?.prompts).toHaveLength(1)
    expect((await todayOf(user, `?date=${tomorrow}`)).coach.slots.fuelPrompt).toBeNull()
  })

  test('moves the page tag when a log is saved', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const run = await addRun(user, addDays(today, -1))
    const before = await client(ctx, user).get('/api/today')
    await logRun(user, gel, run.id)
    const after = await client(ctx, user).get('/api/today')
    expect(after.headers.etag).toBeDefined()
    expect(after.headers.etag).not.toBe(before.headers.etag)
  })
})

// ---------------------------------------------------------------------------------------------
// The watch line
// ---------------------------------------------------------------------------------------------

describe('the fuel line of the deliverables', () => {
  const sends = async (user: TestUser, from: string, to: string): Promise<SendDeliverable[]> =>
    (await buildDeliverables(deps(), user.id, { from, to, today })).filter(
      (d): d is SendDeliverable => d.action === 'send',
    )

  test('reaches the workout of a planned and of a moved long run, and of nothing shorter', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    await logRun(user, gel, (await addRun(user, addDays(today, -7))).id)
    const planned = addDays(today, 1)
    const moved = addDays(today, 3)
    const short = addDays(today, 2)
    await seedPlan(user, {
      sessions: [
        { date: planned, kind: 'long', min: 150 },
        { date: short, kind: 'easy', min: 45 },
        { date: moved, kind: 'long', min: 150, status: 'moved' },
      ],
    })
    const [first, second, third] = await sends(user, planned, moved)
    expect(first!.plan.fuelLine).toBe('Fuel 60 g/h carbs. Drink to thirst.')
    expect(first!.plan.description).toContain('Fuel 60 g/h carbs. Drink to thirst.')
    expect(second!.plan.fuelLine).toBeNull()
    expect(third!.plan.fuelLine).toBe('Fuel 60 g/h carbs. Drink to thirst.')
  })

  test('survives an easing: the long run with a fast finish is an easy run and the target stays', async () => {
    const user = await newUser()
    await seedPlan(user, { sessions: [{ date: today, kind: 'long-fast-finish', min: 150 }] })
    expect(
      (await client(ctx, user).put(`/api/checkins/${today}`).send({ painScore: 6 })).status,
    ).toBe(200)
    const [eased] = await sends(user, today, today)
    expect(eased!.plan).toMatchObject({ eased: true, kind: 'easy' })
    expect(eased!.plan.fuelLine).toBe('Fuel 30 to 50 g/h carbs. Drink to thirst.')
  })

  test('keeps the gut-training flag of an eased 70-minute run', async () => {
    const user = await newUser()
    await seedPlan(user, {
      sessions: [{ date: today, kind: 'threshold', min: 70, flags: ['fuel-practice'] }],
    })
    await client(ctx, user).put(`/api/checkins/${today}`).send({ painScore: 6 })
    const [eased] = await sends(user, today, today)
    expect(eased!.plan.eased).toBe(true)
    expect(eased!.plan.fuelLine).toBe('Fuel 30 to 50 g/h carbs. Drink to thirst.')
  })

  test('holds a hot day at the tolerated rung, as Today does', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    await logRun(user, gel, (await addRun(user, addDays(today, -7))).id)
    await seedPlan(user, { sessions: [{ date: today, kind: 'long', min: 150 }] })
    await setHome(user.id)
    await fillForecast(user.id)
    const [hot] = await sends(user, today, today)
    expect(hot!.plan.fuelLine).toBe('Fuel 30 to 50 g/h carbs. Drink to thirst.')
    const slot = (await todayOf(user)).coach.slots.fuel
    expect(slot?.targets[0]?.text.watch).toBe(hot!.plan.fuelLine)
  })
})

// ---------------------------------------------------------------------------------------------
// A confirmed duplicate's log
// ---------------------------------------------------------------------------------------------

describe('a confirmed duplicate', () => {
  const T0 = '2026-09-02T07:00:00Z'

  async function pair(user: TestUser) {
    const file = await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        date: '2026-09-02',
        type: 'run',
        durationSec: 3 * HOUR,
        distanceM: 30_000,
        source: 'file',
        providerKey: `file:${randomUUID()}`,
        startUtc: T0,
      },
    })
    const strava = await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        date: '2026-09-02',
        type: 'run',
        durationSec: 3 * HOUR,
        distanceM: 30_040,
        source: 'strava',
        providerKey: `strava:${randomUUID()}`,
        startUtc: new Date(Date.parse(T0) + 30_000).toISOString(),
      },
    })
    return { file, strava }
  }

  test("moves the copy's log to the original, once, and the ladder counts the run once", async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const { file, strava } = await pair(user)
    // The runner logged the copy that Strava will turn out to repeat.
    await logRun(user, gel, strava.id)
    expect((await lab(user)).ladder.steps.map((s) => s.activityId)).toEqual([strava.id])

    expect(await markDuplicates(ctx.prisma, user.id, [strava.id])).toBe(1)
    expect(await ctx.prisma.activity.findUniqueOrThrow({ where: { id: strava.id } })).toMatchObject(
      { duplicateStatus: 'confirmed', duplicateOfId: file.id },
    )

    expect(await ctx.prisma.fuelLog.findUnique({ where: { activityId: strava.id } })).toBeNull()
    const moved = await ctx.prisma.fuelLog.findUniqueOrThrow({ where: { activityId: file.id } })
    expect(moved.userId).toBe(user.id)
    const view = await lab(user)
    expect(view.ladder.steps.map((s) => s.activityId)).toEqual([file.id])
    expect(view.ladder.countedRuns).toBe(1)
  })

  test('moves the log when the runner confirms a possible duplicate by hand', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const { file, strava } = await pair(user)
    await ctx.prisma.activity.update({
      where: { id: strava.id },
      data: { duplicateStatus: 'possible', duplicateOfId: file.id },
    })
    await logRun(user, gel, strava.id)
    const dismissed = await client(ctx, user)
      .post(`/api/activities/${strava.id}/duplicate`)
      .send({ status: 'dismissed' })
    expect(dismissed.status).toBe(200)
    expect(await ctx.prisma.fuelLog.count({ where: { activityId: strava.id } })).toBe(1)

    const confirmed = await client(ctx, user)
      .post(`/api/activities/${strava.id}/duplicate`)
      .send({ status: 'confirmed' })
    expect(confirmed.status).toBe(200)
    expect(await ctx.prisma.fuelLog.count({ where: { activityId: strava.id } })).toBe(0)
    expect(await ctx.prisma.fuelLog.count({ where: { activityId: file.id } })).toBe(1)
  })

  test('leaves the copy out of the ladder when the original already has a log', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const { file, strava } = await pair(user)
    await logRun(user, gel, file.id, { gut: 1 })
    await logRun(user, gel, strava.id, { gut: 3 })
    expect((await lab(user)).ladder.steps).toHaveLength(2)

    await markDuplicates(ctx.prisma, user.id, [strava.id])
    // Neither log is lost, and the run counts once, with the original's answer.
    expect(await ctx.prisma.fuelLog.count({ where: { userId: user.id } })).toBe(2)
    const view = await lab(user)
    expect(view.ladder.steps.map((s) => s.activityId)).toEqual([file.id])
    expect(view.history.map((row) => row.log.activityId)).toEqual([file.id])
    expect(view.ladder.steps[0]).toMatchObject({ score: 1, outcome: 'step-up' })
  })

  test('moves nothing for another runner’s activity', async () => {
    const user = await newUser()
    const other = await newUser()
    const gel = await addProduct(other)
    const { strava } = await pair(other)
    await logRun(other, gel, strava.id)
    expect(await markDuplicates(ctx.prisma, user.id, [strava.id])).toBe(0)
    expect(await ctx.prisma.fuelLog.count({ where: { activityId: strava.id } })).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------
// The gut-training option of a plan
// ---------------------------------------------------------------------------------------------

describe('options.gutTraining', () => {
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
    await ctx.prisma.activity.createMany({ data: rows })
  }

  /** A runner with a history and a 100-mile goal far enough out to hold a gut-training block. */
  async function ultraRunner() {
    const user = await newUser()
    await seedHistory(user.id)
    const goal = await ctx.prisma.goal.create({
      data: {
        userId: user.id,
        name: 'Synthetic 100 miler',
        priority: 'A',
        targetDate: addDays(thisMonday, 7 * 40 + 5),
        distanceM: 160_934,
        goalType: 'finish',
      },
    })
    return { user, goal }
  }

  const generate = async (user: TestUser, goalId: string, body: Record<string, unknown> = {}) =>
    client(ctx, user)
      .post('/api/plan/generate')
      .send({ goalId, ...body })

  const planOf = async (user: TestUser) =>
    (await client(ctx, user).get('/api/plan')).body as PlanWithSessions

  const gutWeeks = (plan: PlanWithSessions) =>
    plan.weeks.filter((week) => week.flags.includes('gut-training'))

  const storedOptions = async (planId: string) =>
    JSON.parse(
      (await ctx.prisma.plan.findUniqueOrThrow({ where: { id: planId } })).options,
    ) as Record<string, unknown>

  test('a plan has the block by default, and the request cannot switch it', async () => {
    const { user, goal } = await ultraRunner()
    const forbidden = await generate(user, goal.id, { options: { gutTraining: false } })
    expect(forbidden.status).toBe(400)
    expect(await ctx.prisma.plan.count({ where: { userId: user.id } })).toBe(0)

    const created = await generate(user, goal.id)
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const plan = created.body as PlanWithSessions
    expect(gutWeeks(plan)).toHaveLength(P.h7.gutTrainingWeeks.value)
    expect(plan.sessions.some((s) => s.flags.includes('fuel-practice'))).toBe(true)
    expect(await storedOptions(plan.id)).not.toHaveProperty('gutTraining')
  })

  test('a regenerated plan for a gut condition has no gut-training flag', async () => {
    const { user, goal } = await ultraRunner()
    await generate(user, goal.id)
    await putSettings(user, { giDisease: true })
    const created = await generate(user, goal.id, { options: { recoveryCycle: '3:1' } })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const plan = created.body as PlanWithSessions
    expect(gutWeeks(plan)).toEqual([])
    expect(plan.sessions.some((s) => s.flags.includes('fuel-practice'))).toBe(false)
    // The option sits in the plan's own options, beside what the runner chose.
    expect(await storedOptions(plan.id)).toEqual({ recoveryCycle: '3:1', gutTraining: false })
  })

  test('a regenerated plan for an opt-out has none, and switching it on brings it back', async () => {
    const { user, goal } = await ultraRunner()
    await putSettings(user, { gutBlock: false })
    expect(gutWeeks((await generate(user, goal.id)).body as PlanWithSessions)).toEqual([])
    await putSettings(user, { gutBlock: true })
    const back = (await generate(user, goal.id)).body as PlanWithSessions
    expect(gutWeeks(back)).toHaveLength(P.h7.gutTrainingWeeks.value)
    expect(await storedOptions(back.id)).not.toHaveProperty('gutTraining')
  })

  test('the next re-plan removes the block, shows it in the diff and stores the option', async () => {
    const { user, goal } = await ultraRunner()
    const plan = (await generate(user, goal.id)).body as PlanWithSessions
    const flagged = gutWeeks(plan).map((week) => week.weekStart)
    expect(flagged).toHaveLength(P.h7.gutTrainingWeeks.value)

    await putSettings(user, { gutBlock: false })
    // The preview and the commit agree, and nothing is written before the commit.
    const preview = await client(ctx, user).post('/api/plan/preview').send({ type: 'replan' })
    expect(preview.status, JSON.stringify(preview.body)).toBe(200)
    expect(gutWeeks(await planOf(user)).map((w) => w.weekStart)).toEqual(flagged)
    expect(await storedOptions(plan.id)).not.toHaveProperty('gutTraining')

    const committed = await client(ctx, user).post('/api/plan/replan').send({})
    expect(committed.status, JSON.stringify(committed.body)).toBe(200)
    const revision = committed.body as PlanRevisionView
    const removed = revision.diff!.weeks.filter((w) => w.flagsRemoved.includes('gut-training'))
    expect(removed.map((w) => w.weekStart).sort()).toEqual(flagged)
    expect(
      (preview.body as { diff: PlanRevisionView['diff'] })
        .diff!.weeks.filter((w) => w.flagsRemoved.includes('gut-training'))
        .map((w) => w.weekStart)
        .sort(),
    ).toEqual(flagged)

    const after = await planOf(user)
    expect(gutWeeks(after)).toEqual([])
    expect(after.sessions.some((s) => s.flags.includes('fuel-practice'))).toBe(false)
    expect(await storedOptions(plan.id)).toEqual({ gutTraining: false })

    // Switching it on again restores the block at the next re-plan.
    await putSettings(user, { gutBlock: true })
    const restored = await client(ctx, user).post('/api/plan/replan').send({})
    expect(restored.status, JSON.stringify(restored.body)).toBe(200)
    expect(gutWeeks(await planOf(user)).map((w) => w.weekStart)).toEqual(flagged)
    expect(await storedOptions(plan.id)).toEqual({})
  })

  test('a gut condition drops the block at the next re-plan as well', async () => {
    const { user, goal } = await ultraRunner()
    const plan = (await generate(user, goal.id)).body as PlanWithSessions
    await putSettings(user, { giDisease: true })
    expect((await client(ctx, user).post('/api/plan/replan').send({})).status).toBe(200)
    expect(gutWeeks(await planOf(user))).toEqual([])
    expect(await storedOptions(plan.id)).toEqual({ gutTraining: false })
  })
})
