// GET /api/today as one coach payload (phase 3a design 7.4 and 7.8, task E2-4).
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { renderFact } from '../../shared/copy/templates.ts'
import { addDays, daysBetween, mondayOf, todayIso } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import { climbNote, resolveTargets } from '../../shared/engine/targets.ts'
import type { ZoneSet } from '../../shared/engine/types.ts'
import type {
  ActivityListPage,
  PlanWithSessions,
  ReviewView,
  TodayView,
  WeekRow,
} from '../../shared/types.ts'
import { dataVersionKey, NON_STATE_MODELS, STATE_MODELS } from '../../server/dataVersion.ts'
import type { PrismaClient } from '../../server/db.ts'
import { slotProviders } from '../../server/services/todaySlots.ts'
import { registerHealthNoteProducer } from '../../server/services/todayHealth.ts'
import { registerTodayStamp } from '../../server/services/today.ts'
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

// A Wednesday at noon. Only Date is faked; timers and promises keep working.
const NOON = new Date(2026, 9, 21, 12)
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(NOON)

const today = todayIso()
const tomorrow = addDays(today, 1)
const thisMonday = mondayOf(today)

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(async () => {
  await settleWeatherCache()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.setSystemTime(NOON)
  await ctx.prisma.forecastCache.deleteMany()
  await ctx.prisma.climateCache.deleteMany()
  // Each test seeds its own runner.
  await ctx.prisma.user.deleteMany()
  expectNoRefusedFetches(ctx)
})

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const TARGET = JSON.stringify({
  zone: 'z1',
  rpe: [2, 3],
  hr: null,
  paceSecPerKm: null,
  heatNote: null,
})
const THRESHOLD_TARGET = JSON.stringify({
  zone: 'z2',
  rpe: [6, 7],
  hr: null,
  paceSecPerKm: [330, 310],
  heatNote: null,
})

interface SessionSeed {
  date: string
  kind: string
  min: number
  status?: string
  gainM?: number
  flags?: string[]
  activityId?: string
  target?: string
}

interface PlanSeed {
  /** Plan weeks to create, besides the current one. */
  weeks?: string[]
  /** The race, by days from today; the default is a half marathon about three months out. */
  raceInDays?: number
  distanceM?: number
}

/** A version-2 plan with hand-made sessions, so each test controls exactly what is planned. */
async function planWith(email: string, sessions: SessionSeed[], seed: PlanSeed = {}) {
  const u = await seedUser(ctx, { email })
  await ctx.prisma.athleteProfile.create({
    data: { userId: u.id, hrMax: 190, hrRest: 50, timezone: 'UTC' },
  })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic race',
      priority: 'A',
      targetDate: addDays(today, seed.raceInDays ?? 7 * 12 + 5),
      distanceM: seed.distanceM ?? 21_097,
    },
  })
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: u.id,
      goalId: goal.id,
      name: goal.name,
      startDate: addDays(thisMonday, -7 * 12),
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: 2,
      weeks: {
        create: [thisMonday, ...(seed.weeks ?? [])].map((weekStart, index) => ({
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
          title: s.kind === 'easy' ? 'Easy run' : `${s.kind} session`,
          durationMin: s.min,
          gainM: s.gainM ?? null,
          structure: '[]',
          target: s.target ?? (s.kind === 'threshold' ? THRESHOLD_TARGET : TARGET),
          purpose: 'Synthetic.',
          flags: JSON.stringify(s.flags ?? []),
          status: s.status ?? 'planned',
          activityId: s.activityId ?? null,
        },
      }),
    )
  }
  return { u, plan, goal, rows }
}

function getToday(u: TestUser, query = '') {
  return client(ctx, u).get(`/api/today${query}`)
}

async function view(u: TestUser, query = ''): Promise<TodayView> {
  const res = await getToday(u, query)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as TodayView
}

async function checkin(u: TestUser, date: string, body: Record<string, unknown>) {
  const res = await client(ctx, u).put(`/api/checkins/${date}`).send(body)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

async function setHome(userId: string): Promise<void> {
  await ctx.prisma.athleteProfile.update({
    where: { userId },
    data: { homeLat: 40.1, homeLng: -105.2 },
  })
}

/**
 * A forecast for today, written to the cache by the weather job: 20 C until 09:00, then 33 C, with
 * the sun rising at 06:00 to 800 W/m2 at noon and setting at 18:00 (Open-Meteo always sends
 * `shortwave_radiation`, so the day has a WBGT). `sun: false` leaves the radiation out, the case of
 * a forecast whose index falls back to the air temperature.
 */
async function fillForecast(userId: string, options: { sun?: boolean } = {}): Promise<void> {
  const sun = options.sun ?? true
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
          ...(sun
            ? {
                shortwave_radiation: times.map((_, h) =>
                  h >= 6 && h <= 18 ? Math.round(800 * Math.sin((Math.PI * (h - 6)) / 12)) : 0,
                ),
              }
            : {}),
        },
      })
    },
  })
  await refreshWeatherCaches(ctx, userId)
  ctx.fetch = noNetwork(ctx.refusedFetches)
}

async function zonesOf(u: TestUser): Promise<ZoneSet> {
  return (await client(ctx, u).get('/api/zones')).body as ZoneSet
}

// ---------------------------------------------------------------------------------------------
// Query counting
// ---------------------------------------------------------------------------------------------

const READS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
] as const
/** The raw read entry points: the tagged template and the string form the data version uses. */
const RAW_READS = ['$queryRaw', '$queryRawUnsafe'] as const
type Delegate = Record<string, (...args: unknown[]) => unknown>

interface QueryLog {
  /** `model.method` of every read, in call order. */
  models: string[]
  /** Raw queries (`$queryRaw`, `$queryRawUnsafe`): today only the data-version read. */
  raw: number
  count(name: string): number
}

/** Spies on every read of every model and on the raw queries, from now until the mocks restore. */
function trackQueries(prisma: PrismaClient): QueryLog {
  const log: QueryLog = {
    models: [],
    raw: 0,
    count: (name) => log.models.filter((entry) => entry === name).length,
  }
  for (const model of [...STATE_MODELS, ...NON_STATE_MODELS]) {
    const key = model.charAt(0).toLowerCase() + model.slice(1)
    const delegate = (prisma as unknown as Record<string, Delegate>)[key]
    if (delegate === undefined) continue
    for (const method of READS) {
      const original = delegate[method]
      if (typeof original !== 'function') continue
      vi.spyOn(delegate, method).mockImplementation((...args: unknown[]) => {
        log.models.push(`${key}.${method}`)
        return original.apply(delegate, args)
      })
    }
  }
  const rawClient = prisma as unknown as Record<string, (...args: unknown[]) => unknown>
  for (const method of RAW_READS) {
    const original = rawClient[method]
    if (typeof original !== 'function') continue
    vi.spyOn(rawClient, method).mockImplementation((...args: unknown[]) => {
      log.raw += 1
      return original.apply(prisma, args)
    })
  }
  return log
}

// ---------------------------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------------------------

describe('GET /api/today: the coach payload', () => {
  test('is one payload: the legacy fields, the zone, the hero, the week, the race and empty slots', async () => {
    const { u, rows, goal } = await planWith('shape@example.com', [
      { date: today, kind: 'easy', min: 45 },
      { date: tomorrow, kind: 'long', min: 90 },
    ])
    const body = await view(u)

    expect(body.date).toBe(today)
    expect(body.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(() => new Intl.DateTimeFormat('en', { timeZone: body.tz })).not.toThrow()
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0]).toMatchObject({ advice: 'as-planned', reasons: [] })

    const { coach } = body
    expect(coach.preview).toBe(false)
    expect(Number.isNaN(Date.parse(coach.generatedAt))).toBe(false)
    expect(coach.hero?.session.id).toBe(rows[0]!.id)
    expect(coach.hero).toMatchObject({
      advice: 'as-planned',
      eased: null,
      linkedRun: null,
      others: [],
    })
    expect(coach.next?.id).toBe(rows[1]!.id)
    expect(coach.weekStrip?.weekStart).toBe(thisMonday)
    expect(coach.weekStrip?.days).toHaveLength(7)
    expect(coach.weekStrip?.targetRunMin).toBe(200)
    expect(coach.race).toMatchObject({
      goalId: goal.id,
      daysToRace: daysBetween(today, goal.targetDate),
      range: { wide: false },
    })
    expect(coach.change).toBeNull()
    expect(coach.health).toEqual({
      possibleDuplicates: 0,
      pastUnconfirmedWeeks: 0,
      lastWeekReady: false,
      notes: [],
    })
    expect(coach.slots).toEqual({
      disruption: null,
      fuel: null,
      watch: null,
      brief: null,
      fuelPrompt: null,
    })
  })

  test('the hero targets are resolveTargets of the current zones, and the climb note follows the gain', async () => {
    const { u, rows } = await planWith('targets@example.com', [
      { date: today, kind: 'easy', min: 60, gainM: 600 },
    ])
    const { coach } = await view(u)
    const zones = await zonesOf(u)
    const session = coach.hero!.session
    expect(session.id).toBe(rows[0]!.id)
    expect(coach.hero!.target).toEqual({
      ...resolveTargets(session, zones, { hot: false }),
      climbNote: climbNote(session),
    })
    expect(coach.hero!.target!.climbNote).not.toBeNull()
    expect(coach.hero!.target!.mode).toBe('hr-ceiling')

    const flat = await planWith('flat@example.com', [
      { date: today, kind: 'easy', min: 60, gainM: 20 },
    ])
    expect((await view(flat.u)).coach.hero!.target!.climbNote).toBeNull()
  })

  test('the hero is the main session, with strength and mobility beside it', async () => {
    const { u, rows } = await planWith('main@example.com', [
      { date: today, kind: 'strength', min: 30 },
      { date: today, kind: 'easy', min: 40 },
      { date: today, kind: 'mobility', min: 10 },
    ])
    const { coach, sessions } = await view(u)
    expect(coach.hero!.session.id).toBe(rows[1]!.id)
    expect(coach.hero!.others.map((s) => s.id)).toEqual([rows[0]!.id, rows[2]!.id])
    expect(sessions.map((entry) => entry.session.id)).toEqual(rows.map((r) => r.id))

    const only = await planWith('strength-only@example.com', [
      { date: today, kind: 'strength', min: 30 },
    ])
    expect((await view(only.u)).coach.hero!.session.kind).toBe('strength')
  })

  test('a day with nothing planned has no hero, and the next session skips rest and settled days', async () => {
    const { u, rows } = await planWith('empty-day@example.com', [
      { date: tomorrow, kind: 'rest', min: 0 },
      { date: addDays(today, 2), kind: 'easy', min: 40, status: 'skipped' },
      { date: addDays(today, 3), kind: 'strength', min: 30 },
      { date: addDays(today, 3), kind: 'long', min: 100 },
    ])
    const { coach, sessions } = await view(u)
    expect(sessions).toEqual([])
    expect(coach.hero).toBeNull()
    expect(coach.next?.id).toBe(rows[3]!.id)
  })

  test('a linked run comes from the snapshot, and the week strip counts the run time logged', async () => {
    const { u, rows } = await planWith('linked@example.com', [])
    const run = await ctx.prisma.activity.create({
      data: {
        userId: u.id,
        date: today,
        type: 'run',
        durationSec: 45 * 60,
        distanceM: 8000,
        source: 'manual',
      },
    })
    await ctx.prisma.planSession.create({
      data: {
        planId: (await ctx.prisma.plan.findFirstOrThrow({ where: { userId: u.id } })).id,
        externalId: randomUUID(),
        weekStart: thisMonday,
        date: today,
        order: 0,
        kind: 'easy',
        title: 'Easy run',
        durationMin: 45,
        structure: '[]',
        target: TARGET,
        purpose: 'Synthetic.',
        status: 'completed',
        activityId: run.id,
        linkSource: 'auto',
      },
    })
    expect(rows).toHaveLength(0)
    const { coach } = await view(u)
    expect(coach.hero!.session.status).toBe('completed')
    expect(coach.hero!.linkedRun?.id).toBe(run.id)
    const todayCell = coach.weekStrip!.days.find((d) => d.isToday)!
    expect(todayCell).toMatchObject({ date: today, mark: 'done', runMin: 45 })
    expect(coach.weekStrip!.runMin).toBe(45)
  })

  test('a cached forecast with sun gives a WBGT peak: the heat block is hot for steering and the hero leads with effort', async () => {
    const { u } = await planWith('heat@example.com', [{ date: today, kind: 'long', min: 90 }])
    await setHome(u.id)
    await fillForecast(u.id)
    const { heat, coach } = await view(u)
    expect(heat.note).toMatch(/Warm day/)
    expect(heat.index).toBe('wbgt')
    expect(heat.wbgtC).toBeGreaterThanOrEqual(P.i9.warnWbgtC.value)
    // The sun peaks at noon, and the temperature is flat from 09:00, so the WBGT peaks with the sun.
    expect(heat.peakHour).toBe(12)
    expect(heat.coolerHour).not.toBeNull()
    expect(heat.coolerValue).not.toBeNull()
    expect(heat.coolerValue!).toBeLessThan(heat.wbgtC!)
    expect(heat.hotForSteering).toBe(true)
    expect(coach.hero!.target).toMatchObject({ hot: true, mode: 'effort' })
  })

  test('an easy run with no heat flag is steered by effort on a hot forecast', async () => {
    const { u } = await planWith('heat-easy@example.com', [{ date: today, kind: 'easy', min: 45 }])
    await setHome(u.id)
    await fillForecast(u.id)
    const { heat, coach } = await view(u)
    expect(coach.hero!.session.flags).not.toContain('heat')
    expect(heat.hotForSteering).toBe(true)
    expect(coach.hero!.target).toMatchObject({ hot: true, mode: 'effort' })
    expect(coach.hero!.target!.hotNote).not.toBeNull()
  })

  test('a cached forecast with no radiation falls back to the air temperature, which never steers', async () => {
    const { u } = await planWith('heat-air@example.com', [{ date: today, kind: 'long', min: 90 }])
    await setHome(u.id)
    await fillForecast(u.id, { sun: false })
    const { heat, coach } = await view(u)
    expect(heat.note).toMatch(/Warm day/)
    expect(heat.peakHour).toBe(9)
    expect(heat.coolerHour).not.toBeNull()
    expect(heat.coolerValue).not.toBeNull()
    expect(heat.coolerValue!).toBeLessThan(33)
    expect(heat.index).toBe('air-temperature')
    expect(heat.wbgtC).toBeNull()
    expect(heat.hotForSteering).toBe(false)
    expect(coach.hero!.target!.hot).toBe(false)
    expect(coach.hero!.target!.mode).not.toBe('effort')
  })

  test('a heat-flagged session is hot for steering: effort leads on the hero and the heat block agrees', async () => {
    const { u } = await planWith('hot@example.com', [
      { date: today, kind: 'easy', min: 45, flags: ['heat'] },
    ])
    const { heat, coach } = await view(u)
    expect(heat.hotForSteering).toBe(true)
    expect(coach.hero!.target).toMatchObject({ hot: true, mode: 'effort' })
    expect(coach.hero!.target!.hotNote).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Readiness: verdict, signals, eased and rest cases
// ---------------------------------------------------------------------------------------------

describe('GET /api/today: readiness', () => {
  test('a hard session with pain is eased: the planned session stays, the eased run carries the targets', async () => {
    const { u, rows } = await planWith('eased@example.com', [
      { date: today, kind: 'threshold', min: 50 },
    ])
    await checkin(u, today, { painScore: P.pain.flagScore.value + 1 })
    const { coach, sessions } = await view(u)
    const hero = coach.hero!

    expect(hero.advice).toBe('downgrade-easy')
    expect(hero.reasons.length).toBeGreaterThan(0)
    expect(hero.session).toMatchObject({ id: rows[0]!.id, kind: 'threshold', durationMin: 50 })
    expect(hero.eased).toMatchObject({
      id: rows[0]!.id,
      status: 'planned',
      kind: 'easy',
      title: 'Easy run',
      durationMin: 50,
    })
    // Readiness never adds load.
    expect(hero.eased!.durationMin).toBeLessThanOrEqual(hero.session.durationMin)
    expect(hero.target).toEqual({
      ...resolveTargets(hero.eased!, await zonesOf(u), { hot: false }),
      climbNote: climbNote(hero.eased!),
    })
    expect(hero.target!.zone).toBe('z1')
    expect(sessions[0]).toMatchObject({ advice: 'downgrade-easy' })

    expect(coach.verdict).toMatchObject({ code: 'easy', template: 'today.verdict.easy' })
    expect(renderFact(coach.verdict!, 'mi')).toBe('An easy run is the better choice today.')
    expect(coach.signals[0]).toMatchObject({
      code: 'pain',
      noted: true,
      template: 'today.signal.pain',
    })
  })

  test('focal bone pain turns the run into a rest day: no eased run and no targets', async () => {
    const { u, rows } = await planWith('rest@example.com', [
      { date: today, kind: 'threshold', min: 50 },
    ])
    await checkin(u, today, { painScore: 6, painFocalBone: true })
    const { coach } = await view(u)
    expect(coach.hero).toMatchObject({ advice: 'rest', eased: null, target: null })
    expect(coach.hero!.session.id).toBe(rows[0]!.id)
    expect(coach.hero!.reasons.length).toBeGreaterThan(0)
    expect(coach.verdict?.code).toBe('rest')
    expect(renderFact(coach.verdict!, 'mi')).toBe('A rest day is the better choice today.')
    expect(coach.signals.map((s) => s.code)).toContain('pain')
  })

  test('a rest-kind session has no targets either', async () => {
    const { u } = await planWith('rest-kind@example.com', [{ date: today, kind: 'rest', min: 0 }])
    const { coach } = await view(u)
    expect(coach.hero).toMatchObject({ advice: 'as-planned', eased: null, target: null })
  })

  test('reported illness reads as rest for any run and says so in the signals', async () => {
    const { u } = await planWith('ill@example.com', [{ date: today, kind: 'easy', min: 40 }])
    await checkin(u, today, { illness: true })
    const { coach } = await view(u)
    expect(coach.hero?.advice).toBe('rest')
    expect(coach.verdict?.code).toBe('rest')
    expect(coach.signals[0]).toMatchObject({
      code: 'illness',
      template: 'today.signal.illness-rest',
    })
  })

  test('the verdict names the day: low signals on an easy day, on a long run and on a day with nothing planned', async () => {
    async function lowSignals(email: string, sessions: SessionSeed[]) {
      const { u } = await planWith(email, sessions)
      // A poor check-in on every day the flag must persist.
      for (let k = 0; k < P.j3.persistenceDays.value; k += 1) {
        await checkin(u, addDays(today, -k), { fatigue: 5 })
      }
      return (await view(u)).coach
    }

    const easy = await lowSignals('low-easy@example.com', [{ date: today, kind: 'easy', min: 40 }])
    expect(easy.verdict?.code).toBe('low-stays')
    expect(renderFact(easy.verdict!, 'mi')).toBe(
      "Signals are a little low. Today's session is already easy, so it stays.",
    )

    const long = await lowSignals('low-long@example.com', [{ date: today, kind: 'long', min: 100 }])
    expect(long.verdict?.code).toBe('low-plan-stays')
    expect(long.hero?.advice).toBe('as-planned')

    const none = await lowSignals('low-none@example.com', [])
    expect(none.verdict?.code).toBe('low-plan-stays')
    expect(renderFact(none.verdict!, 'mi')).toBe(
      'Signals are a little low. The plan stays as it is.',
    )
  })

  test('with no readings there is a prompt, with a normal check-in the plan is ready, and every sentence is clean', async () => {
    const { u } = await planWith('ready@example.com', [{ date: today, kind: 'easy', min: 40 }])
    const empty = (await view(u)).coach
    expect(empty.verdict?.code).toBe('no-signals')
    expect(empty.signals).toEqual([])

    await checkin(u, today, { fatigue: 3, sleepQuality: 3 })
    const ready = (await view(u)).coach
    expect(ready.verdict?.code).toBe('ready')
    expect(ready.signals.length).toBeGreaterThan(0)
    expect(ready.signals.length).toBeLessThanOrEqual(3)

    for (const fact of [empty.verdict!, ready.verdict!, ...ready.signals]) {
      assertCleanCopy(renderFact(fact, 'mi'), fact.template)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// Preview and bounds
// ---------------------------------------------------------------------------------------------

describe('GET /api/today?date=', () => {
  test('a day ahead is a read-only preview: no verdict, no signals, no easing, nothing written', async () => {
    const { u, rows } = await planWith('preview@example.com', [
      { date: today, kind: 'easy', min: 40 },
      { date: tomorrow, kind: 'threshold', min: 50 },
    ])
    // Today's readiness is poor, so a hard session today would be eased.
    await checkin(u, today, { painScore: P.pain.flagScore.value + 1 })
    const before = {
      version: (await dataVersionKey(ctx.prisma)).key,
      wellness: await ctx.prisma.wellnessDay.count(),
      revisions: await ctx.prisma.planRevision.count(),
      sessions: await ctx.prisma.planSession.count(),
    }

    const res = await getToday(u, `?date=${tomorrow}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const body = res.body as TodayView
    expect(body.date).toBe(tomorrow)
    expect(body.coach.preview).toBe(true)
    expect(body.coach.verdict).toBeNull()
    expect(body.coach.signals).toEqual([])
    expect(body.checkin).toBeNull()
    expect(body.coach.hero).toMatchObject({ advice: 'as-planned', reasons: [], eased: null })
    expect(body.coach.hero!.session.id).toBe(rows[1]!.id)
    expect(body.coach.hero!.target!.zone).toBe('z2')
    expect(body.coach.weekStrip!.days.find((d) => d.isToday)?.date).toBe(tomorrow)
    expect(body.coach.race!.daysToRace).toBe(
      daysBetween(
        tomorrow,
        (await ctx.prisma.goal.findFirstOrThrow({ where: { userId: u.id } })).targetDate,
      ),
    )

    expect({
      version: (await dataVersionKey(ctx.prisma)).key,
      wellness: await ctx.prisma.wellnessDay.count(),
      revisions: await ctx.prisma.planRevision.count(),
      sessions: await ctx.prisma.planSession.count(),
    }).toEqual(before)
  })

  test('today, tomorrow and the day after are accepted; anything else is a 400 with one message', async () => {
    const { u } = await planWith('bounds@example.com', [])
    for (const date of [today, tomorrow, addDays(today, 2)]) {
      expect((await getToday(u, `?date=${date}`)).status, date).toBe(200)
    }
    for (const date of [addDays(today, -1), addDays(today, 3), '2026-13-40', 'tomorrow', '']) {
      const res = await getToday(u, `?date=${date}`)
      expect(res.status, date).toBe(400)
      expect(res.body).toEqual({
        error: { code: 'validation', message: 'Use today or one of the next two days.' },
      })
    }
    const unknown = await getToday(u, '?day=1')
    expect(unknown.status).toBe(400)
  })

  test('a session needs a cookie before the query is looked at', async () => {
    const res = await client(ctx).get('/api/today?date=1999-01-01')
    expect(res.status).toBe(401)
    expect((await client(ctx).get('/api/today')).status).toBe(401)
  })
})

// ---------------------------------------------------------------------------------------------
// The race block
// ---------------------------------------------------------------------------------------------

describe('GET /api/today: the race', () => {
  test('follows the plan goal, not the active goal, and the range is wide for 100 miles', async () => {
    const { u, plan } = await planWith('race-plan@example.com', [], {
      raceInDays: 200,
      distanceM: 160_934,
    })
    const other = await ctx.prisma.goal.create({
      data: {
        userId: u.id,
        name: 'Another race',
        priority: 'B',
        targetDate: addDays(today, 30),
        distanceM: 10_000,
        isActive: true,
      },
    })
    const { race } = (await view(u)).coach
    expect(race?.goalId).toBe(plan.goalId)
    expect(race?.goalId).not.toBe(other.id)
    expect(race?.name).toBe('Synthetic race')
    expect(race?.daysToRace).toBe(200)
    expect(race?.range).toMatchObject({
      wide: true,
      minHalfWidthPct: P.l4.ultraMinHalfWidthPct.value,
      grade: P.l4.ultraMinHalfWidthPct.grade,
    })
    expect(race?.range?.rules).toContain('L4')
  })

  test('without a plan it follows the active goal; a passed race or no goal gives none', async () => {
    const u = await seedUser(ctx, { email: 'race-goal@example.com' })
    expect((await view(u)).coach.race).toBeNull()

    const goal = await ctx.prisma.goal.create({
      data: {
        userId: u.id,
        name: 'Active goal',
        priority: 'A',
        targetDate: addDays(today, 40),
        distanceM: 42_195,
        isActive: true,
      },
    })
    expect((await view(u)).coach.race).toMatchObject({
      goalId: goal.id,
      daysToRace: 40,
      range: { wide: false, minHalfWidthPct: P.l2.marathonMinHalfWidthPct.value },
    })

    await ctx.prisma.goal.update({
      where: { id: goal.id },
      data: { targetDate: addDays(today, -1) },
    })
    expect((await view(u)).coach.race).toBeNull()
  })

  test('a goal without a distance has a countdown and no range', async () => {
    const u = await seedUser(ctx, { email: 'race-nodistance@example.com' })
    await ctx.prisma.goal.create({
      data: {
        userId: u.id,
        name: 'Open goal',
        priority: 'A',
        targetDate: addDays(today, 20),
        isActive: true,
      },
    })
    expect((await view(u)).coach.race).toMatchObject({
      daysToRace: 20,
      prediction: null,
      range: null,
    })
  })

  test('a runner with a race-effort history gets a prediction range inside the label', async () => {
    const { u } = await planWith('race-predict@example.com', [], { raceInDays: 90 })
    const rows = []
    for (let w = 1; w <= 12; w += 1) {
      for (const dow of [1, 3, 5, 6]) {
        rows.push({
          userId: u.id,
          date: addDays(thisMonday, -7 * w + dow),
          type: 'run',
          durationSec: 45 * 60,
          movingSec: 45 * 60,
          distanceM: 7200,
          rpe: 3,
          source: 'manual',
        })
      }
    }
    rows.push({
      userId: u.id,
      date: addDays(today, -30),
      type: 'race',
      durationSec: 3300,
      movingSec: 3300,
      distanceM: 10_000,
      rpe: 9,
      source: 'manual',
    })
    await ctx.prisma.activity.createMany({ data: rows })
    const { race } = (await view(u)).coach
    expect(race?.prediction).not.toBeNull()
    expect(race!.prediction!.lowSec).toBeLessThan(race!.prediction!.predictedSec)
    expect(race!.prediction!.highSec).toBeGreaterThan(race!.prediction!.predictedSec)
  })
})

// ---------------------------------------------------------------------------------------------
// The change line
// ---------------------------------------------------------------------------------------------

describe('GET /api/today: the change line', () => {
  async function revision(
    planId: string,
    over: {
      reason: string
      summary: string
      daysAgo: number
      diff?: string | null
      undone?: boolean
    },
  ) {
    return ctx.prisma.planRevision.create({
      data: {
        planId,
        reason: over.reason,
        summary: over.summary,
        createdAt: new Date(2026, 9, 21 - over.daysAgo, 3),
        diff: over.diff ?? null,
        undoneAt: over.undone ? new Date() : null,
      },
    })
  }

  test('is the newest weekly, break or review update of the last 7 days, with its stored summary', async () => {
    const { u, plan } = await planWith('change@example.com', [])
    expect((await view(u)).coach.change).toBeNull()

    await revision(plan.id, { reason: 'weekly', summary: 'Too old.', daysAgo: 7 })
    await revision(plan.id, { reason: 'owner', summary: 'An owner edit.', daysAgo: 0 })
    await revision(plan.id, { reason: 'undo', summary: 'An undo.', daysAgo: 0 })
    await revision(plan.id, {
      reason: 'weekly',
      summary: 'Changed nothing.',
      daysAgo: 0,
      diff: '{"empty":true}',
    })
    await revision(plan.id, { reason: 'weekly', summary: 'Undone.', daysAgo: 0, undone: true })
    expect((await view(u)).coach.change).toBeNull()

    await revision(plan.id, { reason: 'review', summary: 'Older update.', daysAgo: 3 })
    const newest = await revision(plan.id, {
      reason: 'break',
      summary: 'Newest update.',
      daysAgo: 1,
      diff: '{"empty":false}',
    })
    const { change } = (await view(u)).coach
    expect(change).toEqual({
      id: newest.id,
      createdAt: newest.createdAt.toISOString(),
      reason: 'break',
      summary: 'Newest update.',
    })

    // The sixth day back is still inside the window.
    const edge = await planWith('change-edge@example.com', [])
    await revision(edge.plan.id, { reason: 'weekly', summary: 'Six days ago.', daysAgo: 6 })
    expect((await view(edge.u)).coach.change?.summary).toBe('Six days ago.')
  })

  test('a plan of another runner never shows', async () => {
    const mine = await planWith('change-mine@example.com', [])
    const theirs = await planWith('change-theirs@example.com', [])
    await revision(theirs.plan.id, { reason: 'weekly', summary: 'Theirs.', daysAgo: 0 })
    expect((await view(mine.u)).coach.change).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------------------------

/**
 * What the Today page worked out in the browser before the payload carried it: four reads (the
 * activity list of the last 90 days, twelve weeks of week rows, twelve weeks of reviews and the
 * plan) and the arithmetic of the old DataHealth component. Kept here as the reference the server
 * counts are compared with.
 */
async function oldClientHealth(u: TestUser) {
  const c = client(ctx, u)
  const thisWeek = mondayOf(todayIso())
  const range = `from=${addDays(thisWeek, -7 * 11)}&to=${thisWeek}`
  const activities = (
    (await c.get(`/api/activities?from=${addDays(todayIso(), 1 - 90)}&limit=500`))
      .body as ActivityListPage
  ).items
  const weeks = (await c.get(`/api/weeks?${range}`)).body as WeekRow[]
  const reviews = (await c.get(`/api/reviews?${range}`)).body as ReviewView[]
  const plan = (await c.get('/api/plan')).body as PlanWithSessions | null

  const planWeekStarts = new Set((plan?.weeks ?? []).map((w) => w.weekStart))
  const possibleDuplicates = activities.filter((a) => a.duplicateStatus === 'possible').length
  const reviewByWeek = new Map(reviews.map((r) => [r.weekStart, r]))
  const pastUnconfirmedWeeks = weeks.filter(
    (w) =>
      w.weekStart < thisWeek &&
      planWeekStarts.has(w.weekStart) &&
      reviewByWeek.get(w.weekStart)?.dataStatus !== 'complete',
  ).length
  const lastWeek = addDays(thisWeek, -7)
  const lastWeekHasData =
    planWeekStarts.has(lastWeek) ||
    (weeks.find((w) => w.weekStart === lastWeek)?.runSessions ?? 0) > 0
  const lastWeekReady = lastWeekHasData && (reviewByWeek.get(lastWeek)?.reviewedAt ?? null) === null
  return { possibleDuplicates, pastUnconfirmedWeeks, lastWeekReady }
}

describe('GET /api/today: health', () => {
  async function run(userId: string, date: string, over: Record<string, unknown> = {}) {
    return ctx.prisma.activity.create({
      data: {
        userId,
        date,
        type: 'run',
        durationSec: 40 * 60,
        distanceM: 6000,
        source: 'manual',
        ...over,
      },
    })
  }

  async function expectParity(u: TestUser) {
    const { health } = (await view(u)).coach
    const { notes, ...counts } = health
    expect(notes).toEqual([])
    expect(counts).toEqual(await oldClientHealth(u))
    return counts
  }

  test('counts match the old client computation: a plan with reviewed and unreviewed past weeks', async () => {
    const past = [1, 2, 3, 5, 11, 12].map((back) => addDays(thisMonday, -7 * back))
    const { u } = await planWith('health-plan@example.com', [], { weeks: past })
    // Week 1 back: reviewed and complete. Week 2 back: a saved review that is not complete.
    await ctx.prisma.weeklyReview.createMany({
      data: [
        {
          userId: u.id,
          weekStart: past[0]!,
          dataStatus: 'complete',
          reviewedAt: new Date(2026, 9, 13),
        },
        { userId: u.id, weekStart: past[1]!, dataStatus: 'unconfirmed' },
        { userId: u.id, weekStart: past[3]!, dataStatus: 'missing' },
      ],
    })
    expect(await expectParity(u)).toEqual({
      possibleDuplicates: 0,
      // Weeks 2, 3 and 5 back; week 12 back is out of the 12-week window.
      pastUnconfirmedWeeks: 4,
      lastWeekReady: false,
    })
  })

  test('last week is ready when it has a plan week or a run and no review date', async () => {
    const lastWeek = addDays(thisMonday, -7)
    const planned = await planWith('health-last-plan@example.com', [], { weeks: [lastWeek] })
    expect((await expectParity(planned.u)).lastWeekReady).toBe(true)

    const logged = await seedUser(ctx, { email: 'health-last-run@example.com' })
    await run(logged.id, addDays(lastWeek, 2))
    expect((await expectParity(logged)).lastWeekReady).toBe(true)

    // A possible duplicate is not a run of the week, as in the week rows.
    const duplicate = await seedUser(ctx, { email: 'health-last-dup@example.com' })
    await run(duplicate.id, addDays(lastWeek, 2), { duplicateStatus: 'possible' })
    expect((await expectParity(duplicate)).lastWeekReady).toBe(false)

    const reviewed = await planWith('health-last-reviewed@example.com', [], { weeks: [lastWeek] })
    await ctx.prisma.weeklyReview.create({
      data: { userId: reviewed.u.id, weekStart: lastWeek, reviewedAt: new Date(2026, 9, 14) },
    })
    expect((await expectParity(reviewed.u)).lastWeekReady).toBe(false)

    const nothing = await seedUser(ctx, { email: 'health-last-none@example.com' })
    expect((await expectParity(nothing)).lastWeekReady).toBe(false)
  })

  test('possible duplicates are counted over the last 90 days only', async () => {
    const u = await seedUser(ctx, { email: 'health-dup@example.com' })
    await run(u.id, addDays(today, -1), { duplicateStatus: 'possible' })
    await run(u.id, addDays(today, -40), { duplicateStatus: 'possible' })
    await run(u.id, addDays(today, -89), { duplicateStatus: 'possible' })
    await run(u.id, addDays(today, -90), { duplicateStatus: 'possible' })
    await run(u.id, addDays(today, -200), { duplicateStatus: 'possible' })
    await run(u.id, addDays(today, -2), { duplicateStatus: 'confirmed' })
    await run(u.id, addDays(today, -3), { duplicateStatus: 'dismissed' })
    await run(u.id, addDays(today, -4))
    expect((await expectParity(u)).possibleDuplicates).toBe(3)
  })

  test('a runner with no data has no health items', async () => {
    const u = await seedUser(ctx, { email: 'health-none@example.com' })
    expect(await expectParity(u)).toEqual({
      possibleDuplicates: 0,
      pastUnconfirmedWeeks: 0,
      lastWeekReady: false,
    })
  })

  test('notes come from registered producers in order; a failing producer is skipped', async () => {
    const { u } = await planWith('health-notes@example.com', [])
    const note = (code: string) => ({
      code,
      template: 'today.verdict.ready' as const,
      slots: {},
      href: null,
    })
    const producer = vi.fn(() => [note('first')])
    const removers = [
      registerHealthNoteProducer(producer),
      registerHealthNoteProducer(() => {
        throw new Error('a producer broke')
      }),
      registerHealthNoteProducer(() => Promise.reject(new Error('and another'))),
      registerHealthNoteProducer(() => Promise.resolve([note('second'), note('third')])),
    ]
    try {
      const { coach } = await view(u)
      expect(coach.health.notes.map((n) => n.code)).toEqual(['first', 'second', 'third'])
      expect(producer).toHaveBeenCalledWith(expect.objectContaining({ userId: u.id, date: today }))
    } finally {
      for (const remove of removers) remove()
    }
    expect((await view(u)).coach.health.notes).toEqual([])
  })

  test('says when sync is paused, and the tag moves when the latest sync run changes', async () => {
    const { u } = await planWith('health-sync@example.com', [])
    const syncRun = (status: string, minutesAgo: number) =>
      ctx.prisma.syncRun.create({
        data: {
          userId: u.id,
          provider: 'sync',
          channel: 'job',
          trigger: 'schedule',
          startedAt: new Date(NOON.getTime() - minutesAgo * 60_000),
          finishedAt: NOON,
          status,
        },
      })
    const tagOf = (res: { headers: Record<string, unknown> }) => String(res.headers.etag)
    const notesOf = (res: { body: unknown }) => (res.body as TodayView).coach.health.notes

    await syncRun('ok', 120)
    const quiet = await getToday(u)
    expect(notesOf(quiet)).toEqual([])

    // SyncRun is outside the data version: only the stamp lets the new run through the tag.
    await syncRun('paused', 60)
    const paused = await getToday(u).set('If-None-Match', tagOf(quiet))
    expect(paused.status).toBe(200)
    expect(notesOf(paused)).toEqual([
      {
        code: 'sync-paused',
        template: 'today.health.sync-paused',
        slots: {},
        href: '/integrations',
      },
    ])
    assertCleanCopy(renderFact(notesOf(paused)[0]!, 'mi'), 'sync-paused')
    expect(renderFact(notesOf(paused)[0]!, 'mi')).toBe(
      "Sync is paused to stay within the service's limits, and picks up again on its own.",
    )
    expect((await getToday(u).set('If-None-Match', tagOf(paused))).status).toBe(304)

    // A later run that ended ok takes the note away.
    await syncRun('ok', 5)
    const resumed = await getToday(u).set('If-None-Match', tagOf(paused))
    expect(resumed.status).toBe(200)
    expect(notesOf(resumed)).toEqual([])
    expect(tagOf(resumed)).not.toBe(tagOf(paused))
  })

  test('says when the weekly update has not run, and the tag moves when the slot comes', async () => {
    // Monday, a minute before the 03:00 slot of the weekly update.
    vi.setSystemTime(new Date(2026, 9, 19, 2, 59))
    const { u, plan } = await planWith('health-weekly@example.com', [])
    await ctx.prisma.plan.update({
      where: { id: plan.id },
      data: { createdAt: new Date(2026, 9, 12, 12) },
    })
    const tagOf = (res: { headers: Record<string, unknown> }) => String(res.headers.etag)
    const notesOf = (res: { body: unknown }) => (res.body as TodayView).coach.health.notes

    const early = await getToday(u)
    expect(notesOf(early)).toEqual([])

    // The slot has come and nothing was written: the tag moves by itself.
    vi.setSystemTime(new Date(2026, 9, 19, 3, 1))
    const due = await getToday(u).set('If-None-Match', tagOf(early))
    expect(due.status).toBe(200)
    expect(notesOf(due)).toEqual([
      {
        code: 'weekly-update-not-run',
        template: 'today.health.update-not-run',
        slots: {},
        href: '/plan',
      },
    ])
    expect(renderFact(notesOf(due)[0]!, 'mi')).toBe("This week's plan update has not run yet.")
    assertCleanCopy(renderFact(notesOf(due)[0]!, 'mi'), 'weekly-update-not-run')
    expect((await getToday(u).set('If-None-Match', tagOf(due))).status).toBe(304)

    // The update runs: its revision is a state write, and the note goes.
    await ctx.prisma.planRevision.create({
      data: { planId: plan.id, reason: 'weekly', summary: 'Synthetic.' },
    })
    const done = await getToday(u).set('If-None-Match', tagOf(due))
    expect(done.status).toBe(200)
    expect(notesOf(done)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------------------------

describe('GET /api/today: slots', () => {
  test('a throwing or rejecting provider leaves its slot null and the route succeeds', async () => {
    const { u } = await planWith('slots@example.com', [{ date: today, kind: 'easy', min: 40 }])
    const brief = { sentinel: 'brief' } as never
    vi.spyOn(slotProviders, 'fuel').mockImplementation(() => {
      throw new Error('fuel broke')
    })
    vi.spyOn(slotProviders, 'watch').mockImplementation(async () => Promise.reject(new Error('no')))
    vi.spyOn(slotProviders, 'brief').mockImplementation(() => brief)
    const { coach } = await view(u)
    expect(coach.slots).toEqual({
      disruption: null,
      fuel: null,
      watch: null,
      brief,
      fuelPrompt: null,
    })
    expect(coach.hero).not.toBeNull()
  })

  test('providers receive the requested date', async () => {
    const { u } = await planWith('slots-date@example.com', [])
    const watch = vi.spyOn(slotProviders, 'watch')
    await view(u)
    await view(u, `?date=${addDays(today, 2)}`)
    expect(watch.mock.calls.map(([args]) => [args.date, args.preview])).toEqual([
      [today, false],
      [addDays(today, 2), true],
    ])
    expect(watch.mock.calls[0]![0].userId).toBe(u.id)
  })
})

// ---------------------------------------------------------------------------------------------
// ETag
// ---------------------------------------------------------------------------------------------

describe('GET /api/today: the validator', () => {
  const tagOf = (res: { headers: Record<string, unknown> }) => String(res.headers.etag)

  test('answers 304 to the current tag and a new body after a write, a date or a forecast change', async () => {
    const { u } = await planWith('etag@example.com', [{ date: today, kind: 'easy', min: 40 }])
    const first = await getToday(u)
    expect(first.status).toBe(200)
    const tag = tagOf(first)
    expect(tag).toMatch(/^W\/"/)
    expect(first.headers['cache-control']).toBe('private, no-cache')
    expect(String(first.headers.vary)).toContain('Cookie')

    const same = await getToday(u).set('If-None-Match', tag)
    expect(same.status).toBe(304)
    expect(same.text).toBe('')

    // Another viewed date is another body.
    const preview = await getToday(u, `?date=${tomorrow}`).set('If-None-Match', tag)
    expect(preview.status).toBe(200)
    expect(tagOf(preview)).not.toBe(tag)

    // A state write moves the tag.
    await checkin(u, today, { fatigue: 4 })
    const written = await getToday(u).set('If-None-Match', tag)
    expect(written.status).toBe(200)
    expect(tagOf(written)).not.toBe(tag)
    expect((await getToday(u).set('If-None-Match', tagOf(written))).status).toBe(304)

    // A forecast refresh writes no state, and still moves the tag.
    await setHome(u.id)
    const homed = tagOf(await getToday(u))
    await fillForecast(u.id)
    const forecast = await getToday(u).set('If-None-Match', homed)
    expect(forecast.status).toBe(200)
    expect(tagOf(forecast)).not.toBe(homed)
    expect((await getToday(u).set('If-None-Match', tagOf(forecast))).status).toBe(304)

    // The next day is another body even with no write.
    vi.setSystemTime(new Date(2026, 9, 22, 6))
    const nextDay = await getToday(u).set('If-None-Match', tagOf(forecast))
    expect(nextDay.status).toBe(200)
    expect((nextDay.body as TodayView).date).toBe(addDays(today, 1))
  })

  test('a registered stamp is part of the tag', async () => {
    const { u } = await planWith('etag-stamp@example.com', [])
    let stamp = 'a'
    const remove = registerTodayStamp(() => stamp)
    try {
      const tag = tagOf(await getToday(u))
      expect((await getToday(u).set('If-None-Match', tag)).status).toBe(304)
      stamp = 'b'
      expect((await getToday(u).set('If-None-Match', tag)).status).toBe(200)
    } finally {
      remove()
    }
  })

  test('a request holding the current tag is answered without reading the snapshot', async () => {
    const { u } = await planWith('etag-cheap@example.com', [{ date: today, kind: 'easy', min: 40 }])
    await setHome(u.id)
    const tag = tagOf(await getToday(u))
    // The snapshot expires after five minutes, and the tag does not depend on its age.
    vi.setSystemTime(new Date(NOON.getTime() + 10 * 60_000))
    const log = trackQueries(ctx.prisma)
    const res = await getToday(u).set('If-None-Match', tag)
    expect(res.status).toBe(304)
    expect(log.models.sort()).toEqual(
      [
        'athleteProfile.findUnique',
        'forecastCache.findUnique',
        'syncRun.findFirst',
        'user.findUnique',
      ].sort(),
    )
    expect(log.count('activity.findMany')).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Cost and the network
// ---------------------------------------------------------------------------------------------

describe('GET /api/today: cost', () => {
  test('a warm request reads no history and builds no snapshot; a cold one builds it once', async () => {
    const { u } = await planWith('cost@example.com', [
      { date: today, kind: 'easy', min: 40 },
      { date: tomorrow, kind: 'long', min: 90 },
    ])
    await setHome(u.id)
    await fillForecast(u.id)
    await checkin(u, today, { fatigue: 3 })

    // Cold: the write above dropped the snapshot and the memos.
    const cold = trackQueries(ctx.prisma)
    expect((await getToday(u)).status).toBe(200)
    expect(cold.count('activity.findMany')).toBe(1)
    expect(cold.count('plan.findFirst')).toBe(2)
    expect(cold.count('planSession.findMany')).toBe(0)
    // The change line, and the weekly-update note.
    expect(cold.count('planRevision.findFirst')).toBe(2)
    expect(cold.count('forecastCache.findUnique')).toBe(2)
    const coldTotal = cold.models.length
    vi.restoreAllMocks()

    // Warm: the same request with no write in between.
    const warm = trackQueries(ctx.prisma)
    expect((await getToday(u)).status).toBe(200)
    // The session lookup of the auth middleware, the forecast stamp (home, then the cache row), the
    // cached forecast hours, the stamp of the job notes and the three reads of the job notes
    // themselves (the latest runs, the last weekly revision, the plans due): nothing else.
    expect(warm.models.sort()).toEqual(
      [
        'athleteProfile.findUnique',
        'forecastCache.findUnique',
        'forecastCache.findUnique',
        'plan.findMany',
        'planRevision.findFirst',
        'syncRun.findFirst',
        'syncRun.groupBy',
        'user.findUnique',
      ].sort(),
    )
    expect(warm.count('activity.findMany')).toBe(0)
    expect(warm.count('plan.findFirst')).toBe(0)
    // Pinned so that a query added to the request path is a decision, not an accident: cold is
    // 21 reads (the session lookup, the forecast stamp, the job-notes stamp, the snapshot's eleven,
    // the cached forecast, the race climate, the change line and the three of the job notes), warm
    // is 8, and the data version is read three times (the tag, the snapshot, the change-line memo).
    // The eleventh read of the snapshot is the runner's active rest windows (E5-5).
    expect(coldTotal).toBe(21)
    expect(warm.models).toHaveLength(8)
    expect(warm.raw).toBe(3)
  })

  test('no request path calls the network, empty or stale caches included', async () => {
    const { u } = await planWith('network@example.com', [{ date: today, kind: 'long', min: 90 }])
    await setHome(u.id)
    const calls: string[] = []
    const silent: typeof fetch = (input) => {
      calls.push(input instanceof Request ? input.url : String(input))
      return Promise.reject(new Error('no network'))
    }
    ctx.fetch = silent
    vi.stubGlobal('fetch', silent)

    // Empty caches.
    expect((await getToday(u)).status).toBe(200)
    expect((await getToday(u, `?date=${tomorrow}`)).status).toBe(200)

    // A forecast older than the refresh interval is read as it is and not refreshed.
    ctx.fetch = noNetwork(ctx.refusedFetches)
    await fillForecast(u.id)
    ctx.fetch = silent
    vi.setSystemTime(new Date(NOON.getTime() + 3 * 60 * 60_000))
    const res = await getToday(u)
    expect(res.status).toBe(200)
    await settleWeatherCache()
    expect(calls).toEqual([])
  })
})
