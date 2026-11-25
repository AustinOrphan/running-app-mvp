// GET /api/plan-inputs (rule T2): the counts of the data the plan reads, derived on read.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import type { PlanInputsView } from '../../shared/domain/planInputs.ts'
import { P } from '../../shared/engine/params/index.ts'
import { climateKeyFor } from '../../server/services/weatherCache.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

let ctx: TestCtx
let users = 0

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  await ctx.close()
})

const today = todayIso()

function newUser(): Promise<TestUser> {
  users += 1
  return seedUser(ctx, { email: `inputs${String(users)}@example.com` })
}

async function viewOf(user: TestUser): Promise<PlanInputsView> {
  const res = await client(ctx, user).get('/api/plan-inputs')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as PlanInputsView
}

describe('GET /api/plan-inputs', () => {
  test('an anonymous request is a 401', async () => {
    expect((await client(ctx).get('/api/plan-inputs')).status).toBe(401)
  })

  test('an empty log has zero counts and no named source', async () => {
    const view = await viewOf(await newUser())
    expect(view.asOf).toBe(today)
    expect(view.hrv.kind).toBe('none')
    expect(view.runs.count).toBe(0)
    expect(view.sources.named).toEqual([])
    expect(view.zones).toHaveLength(6)
  })

  test('SDNN from Apple Health is counted and kept out of the baseline', async () => {
    const user = await newUser()
    for (let i = 1; i <= 12; i += 1) {
      await ctx.prisma.wellnessDay.create({
        data: { userId: user.id, date: addDays(today, -i), hrvSdnn: 48, source: 'apple-health' },
      })
    }
    const view = await viewOf(user)
    expect(view.hrv.kind).toBe('sdnn')
    expect(view.hrv.sdnnDays).toBe(12)
    expect(view.hrv.baselineReadings).toBe(0)
    expect(view.sources.named).toEqual([
      { key: 'apple-health', label: 'Apple Health', activities: 0, wellnessDays: 12 },
    ])
  })

  test('rMSSD fills the baseline; runs report their stream and sources', async () => {
    const user = await newUser()
    for (let i = 1; i <= 12; i += 1) {
      await ctx.prisma.wellnessDay.create({
        data: {
          userId: user.id,
          date: addDays(today, -i),
          hrvRmssd: 55,
          restingHr: 50,
          source: 'manual',
        },
      })
    }
    const withStream = await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        date: addDays(today, -2),
        type: 'run',
        durationSec: 1800,
        distanceM: 5000,
        source: 'intervals',
      },
    })
    await ctx.prisma.activity.create({
      data: { userId: user.id, date: addDays(today, -4), type: 'run', durationSec: 1800 },
    })
    await ctx.prisma.activityStream.create({
      data: { activityId: withStream.id, sampleSec: 10, data: '{}' },
    })
    const view = await viewOf(user)
    expect(view.hrv.kind).toBe('rmssd')
    expect(view.hrv.baselineReadings).toBe(P.j4.windowDays.value)
    expect(view.restingHr.baselineReadings).toBe(P.j4.windowDays.value)
    expect(view.runs.count).toBe(2)
    expect(view.runs.withStream).toBe(1)
    expect(view.sources.named).toEqual([
      { key: 'intervals', label: 'intervals.icu', activities: 1, wellnessDays: 0 },
    ])
    expect(view.sources.other).toEqual({ activities: 1, wellnessDays: 12 })
  })

  test('a measured maximum heart rate is the tier of its boundary', async () => {
    const user = await newUser()
    await ctx.prisma.athleteProfile.create({
      data: { userId: user.id, hrMax: 190, hrMaxSource: 'measured', birthYear: 1985 },
    })
    const view = await viewOf(user)
    expect(view.zones[0]!.boundary?.source).toBe('hrmax-observed')
  })

  describe('the places the race heat is read for (RH1)', () => {
    async function goalFor(
      user: TestUser,
      over: { distanceM?: number; daysAhead?: number; place?: boolean } = {},
    ) {
      const place = over.place ?? false
      return ctx.prisma.goal.create({
        data: {
          userId: user.id,
          name: 'Synthetic marathon',
          priority: 'A',
          isActive: true,
          targetDate: addDays(today, over.daysAhead ?? 60),
          distanceM: over.distanceM ?? 42_195,
          surface: 'road',
          goalType: 'finish',
          ...(place ? { raceLat: 40.01, raceLng: -105.27 } : {}),
        },
      })
    }

    afterEach(async () => {
      await ctx.prisma.climateCache.deleteMany()
      await ctx.prisma.climateFailure.deleteMany()
    })

    test('the tag follows a climate failure and its clearing, the data version alone', async () => {
      const user = await newUser()
      const goal = await goalFor(user, { place: true })
      const key = climateKeyFor(goal, { lat: null, lng: null, use: false })
      if (key === null) throw new Error('the goal has no place')
      const first = await client(ctx, user).get('/api/plan-inputs')
      const tag = first.headers['etag'] as string
      expect((first.body as PlanInputsView).raceHeat?.state).toBe('unread')

      await ctx.prisma.climateFailure.create({
        data: { ...key, failedAt: new Date(), lastError: 'Open-Meteo request failed: no answer.' },
      })
      const failed = await client(ctx, user).get('/api/plan-inputs').set('If-None-Match', tag)
      expect(failed.status).toBe(200)
      expect((failed.body as PlanInputsView).raceHeat?.state).toBe('failed')
      const failedTag = failed.headers['etag'] as string

      await ctx.prisma.climateFailure.deleteMany()
      const cleared = await client(ctx, user)
        .get('/api/plan-inputs')
        .set('If-None-Match', failedTag)
      expect(cleared.status).toBe(200)
      expect((cleared.body as PlanInputsView).raceHeat?.state).toBe('unread')
    })

    test('a goal with no place and no home place says so: no place set, nothing used', async () => {
      const user = await newUser()
      await goalFor(user)
      // the profile's weather switch is on by default, but there is no home place for it to use
      expect((await viewOf(user)).raceHeat).toEqual({
        using: null,
        racePlaceSet: false,
        homePlaceSet: false,
        homeWeatherOn: true,
        state: 'no-place',
        nausea: true,
      })
    })

    test('a 10 km has no fuel block, so the nausea plan is not among what is left out', async () => {
      const user = await newUser()
      await goalFor(user, { distanceM: 10_000 })
      expect((await viewOf(user)).raceHeat).toMatchObject({ state: 'no-place', nausea: false })
    })

    test('a read that failed, or a complete cell with no value, is failed and not unread', async () => {
      const user = await newUser()
      const goal = await goalFor(user, { place: true })
      const key = climateKeyFor(goal, { lat: null, lng: null, use: false })
      if (key === null) throw new Error('the goal has no place')
      await ctx.prisma.climateFailure.create({
        data: { ...key, failedAt: new Date(), lastError: 'Open-Meteo request failed: no answer.' },
      })
      expect((await viewOf(user)).raceHeat).toMatchObject({ using: 'race', state: 'failed' })
      await ctx.prisma.climateFailure.deleteMany()
      const row = await ctx.prisma.climateCache.create({
        data: { ...key, complete: true, wbgtC: null },
      })
      expect((await viewOf(user)).raceHeat).toMatchObject({ state: 'failed' })
      // a later success clears it
      await ctx.prisma.climateCache.update({
        where: { id: row.id },
        data: { wbgtC: 20, samples: 10, yearsRead: 3 },
      })
      expect((await viewOf(user)).raceHeat).toMatchObject({ state: 'known' })
    })

    test('a home place counts only with its weather switch on', async () => {
      const user = await newUser()
      await goalFor(user)
      await ctx.prisma.athleteProfile.create({
        data: { userId: user.id, homeLat: 40.1, homeLng: -105.2, useHomeWeather: false },
      })
      expect((await viewOf(user)).raceHeat).toMatchObject({
        using: null,
        homePlaceSet: true,
        homeWeatherOn: false,
        state: 'no-place',
      })
      await ctx.prisma.athleteProfile.update({
        where: { userId: user.id },
        data: { useHomeWeather: true },
      })
      expect((await viewOf(user)).raceHeat).toMatchObject({ using: 'home', state: 'unread' })
    })

    test('a race place not yet read is unread, and a cached climate makes it known', async () => {
      const user = await newUser()
      const goal = await goalFor(user, { place: true })
      expect((await viewOf(user)).raceHeat).toMatchObject({
        using: 'race',
        racePlaceSet: true,
        state: 'unread',
      })
      const key = climateKeyFor(goal, { lat: null, lng: null, use: false })
      if (key === null) throw new Error('the goal has no place')
      await ctx.prisma.climateCache.create({
        data: { ...key, wbgtC: 21.5, samples: 10, yearsRead: 3, complete: true },
      })
      expect((await viewOf(user)).raceHeat).toMatchObject({ using: 'race', state: 'known' })
    })

    test('no goal, a goal the race plan does not cover and a race in the past give no row', async () => {
      const none = await newUser()
      expect((await viewOf(none)).raceHeat).toBeNull()
      const short = await newUser()
      await goalFor(short, { distanceM: 5_000 })
      expect((await viewOf(short)).raceHeat).toBeNull()
      const past = await newUser()
      await goalFor(past, { daysAhead: -3 })
      expect((await viewOf(past)).raceHeat).toBeNull()
    })
  })

  test('your answers: check-ins, pain reports and run ratings are counted over the windows of J6 and J11', async () => {
    const user = await newUser()
    await ctx.prisma.athleteProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, birthYear: Number(today.slice(0, 4)) - 45 },
      update: { birthYear: Number(today.slice(0, 4)) - 45 },
    })
    for (let i = 1; i <= 8; i += 1) {
      await ctx.prisma.wellnessDay.create({
        data: {
          userId: user.id,
          date: addDays(today, -i),
          fatigue: 3,
          soreness: i === 8 ? null : 2,
          painScore: i <= 3 ? P.pain.repeatMinScore.value : null,
          painArea: i <= 3 ? 'left knee' : null,
          source: 'manual',
        },
      })
    }
    await ctx.prisma.activity.createMany({
      data: [
        { date: addDays(today, -1), rpe: 5, rpeSource: 'app', feel: 1, pain: 2 },
        { date: addDays(today, -2), rpe: 6, rpeSource: 'watch' },
        { date: addDays(today, -20), rpe: 4, rpeSource: 'app' },
      ].map((over) => ({ userId: user.id, type: 'run', durationSec: 1800, ...over })),
    })
    const view = await viewOf(user)
    const { j6, j11 } = view.ownAnswers!
    expect(j6).toMatchObject({
      applies: 'on',
      checkins: 8,
      items: { fatigue: 8, soreness: 7, mood: 0 },
      minCheckins: P.j6.medianMinCheckins.value,
      reading: 8 >= P.j6.medianMinCheckins.value,
      // The watch rating stays unread until it passes the spread check (rule B1).
      ratings: { inApp: 2, watch: 0, feel: 1, pain: 1 },
    })
    expect(j11).toMatchObject({
      windowDays: P.pain.repeatDays.value,
      painCheckins: 3,
      reports: 3,
      mostOfOneArea: 3,
      minReports: P.pain.repeatReports.value,
      reading: 3 >= P.pain.repeatReports.value,
      ratings: { inApp: 1, watch: 0, feel: 1, pain: 1 },
    })
  })

  test('your answers: a recent niggle window for the same area makes J11 quiet', async () => {
    const user = await newUser()
    for (let i = 0; i < 3; i += 1) {
      await ctx.prisma.wellnessDay.create({
        data: {
          userId: user.id,
          date: addDays(today, -i),
          painScore: P.pain.repeatMinScore.value,
          painArea: 'left knee',
          source: 'manual',
        },
      })
    }
    expect((await viewOf(user)).ownAnswers!.j11).toMatchObject({ reading: true, quiet: false })
    await ctx.prisma.disruption.create({
      data: {
        userId: user.id,
        reason: 'niggle',
        mode: 'limited',
        maxRunMin: 30,
        area: 'knee',
        startDate: addDays(today, -6),
        endDate: addDays(today, -2),
      },
    })
    expect((await viewOf(user)).ownAnswers!.j11).toMatchObject({
      reading: false,
      quiet: true,
      mostOfOneArea: 3,
      quietDays: P.pain.repeatQuietDays.value,
    })
  })

  test('your answers: an empty log reads nothing and a profile with no birth year says so', async () => {
    const { j6, j11 } = (await viewOf(await newUser())).ownAnswers!
    expect(j6).toMatchObject({ applies: 'no-birth-year', checkins: 0, reading: false })
    expect(j11).toMatchObject({ reports: 0, mostOfOneArea: 0, reading: false })
  })

  test('the tag follows the data version: the same tag is a 304, a write changes it', async () => {
    const user = await newUser()
    const first = await client(ctx, user).get('/api/plan-inputs')
    const tag = first.headers['etag'] as string
    expect(tag).toMatch(/^W\/"plan-inputs\./)
    const same = await client(ctx, user).get('/api/plan-inputs').set('If-None-Match', tag)
    expect(same.status).toBe(304)
    await ctx.prisma.wellnessDay.create({
      data: { userId: user.id, date: addDays(today, -1), restingHr: 50, source: 'manual' },
    })
    const again = await client(ctx, user).get('/api/plan-inputs').set('If-None-Match', tag)
    expect(again.status).toBe(200)
  })
})
