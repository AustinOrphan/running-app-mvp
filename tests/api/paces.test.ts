// GET /api/paces (rule C9, ADR 0020): the easy pace, the events and the test, derived on read.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import {
  PACES_CUSTOM_GAIN_MAX_M,
  PACES_CUSTOM_MAX_M,
  PACES_CUSTOM_MIN_M,
} from '../../shared/limits.ts'
import type { MyPacesView } from '../../shared/types.ts'
import { cacheSizes } from '../../server/services/athleteState.ts'
import { athlete, scaledCurve, syntheticRuns } from '../unit/engine/gradeCurve-fixtures.ts'
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

/** A runner of their own, so that one test's rows never reach another's. */
function newUser(): Promise<TestUser> {
  users += 1
  return seedUser(ctx, { email: `pacer${String(users)}@example.com` })
}

/** A measured maximum heart rate of 190, so the top of Z1 is 148 bpm. */
async function withMeasuredMax(user: TestUser): Promise<void> {
  await ctx.prisma.athleteProfile.create({
    data: { userId: user.id, hrMax: 190, hrMaxSource: 'measured', birthYear: 1985 },
  })
}

/**
 * Nine steady flat runs inside the last eight weeks, on the line HR = 90 + 20 x speed, speeds 2.3
 * to 3.1 m/s: the line meets 148 bpm at 2.9 m/s, and its hot-day speed stays inside the fitted ones.
 */
async function withSteadyRuns(user: TestUser): Promise<void> {
  const durationSec = 40 * 60
  for (let i = 0; i < 9; i += 1) {
    const speed = 2.3 + i * 0.1
    const avgHr = Math.round(90 + 20 * speed)
    const metres = Math.round(speed * durationSec)
    await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        date: addDays(today, -(3 + i * 3)),
        type: 'run',
        durationSec,
        distanceM: metres,
        gapDistanceM: metres,
        elevationGainM: 20,
        avgHr,
        hrHistogram: JSON.stringify({
          start: 100,
          width: 5,
          sec: Array.from({ length: 20 }, (_, bin) =>
            bin === Math.floor((avgHr - 100) / 5) ? durationSec : 0,
          ),
        }),
      },
    })
  }
}

async function withTenK(user: TestUser): Promise<void> {
  await ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date: addDays(today, -40),
      type: 'race',
      durationSec: 3000,
      distanceM: 10_000,
    },
  })
}

async function pacesOf(user: TestUser, search = ''): Promise<MyPacesView> {
  const res = await client(ctx, user).get(`/api/paces${search}`)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as MyPacesView
}

describe('GET /api/paces: access and shape', () => {
  test('an anonymous request is a 401, with a query or without', async () => {
    expect((await client(ctx).get('/api/paces')).status).toBe(401)
    expect((await client(ctx).get('/api/paces?distanceM=9')).status).toBe(401)
  })

  test('an empty log has no pace and no time, and offers the test and the heart-rate runs', async () => {
    const view = await pacesOf(await newUser())
    expect(view.asOf).toBe(today)
    expect(view.easy.pace).toBeNull()
    expect(view.easy.hr).toMatchObject({ runs: 0, need: P.hrModel.minQualifyingRuns.value })
    expect(view.events.map((e) => e.key)).toEqual([
      'five-k',
      'ten-k',
      'half',
      'marathon',
      'fifty-k',
    ])
    expect(view.events.every((e) => e.time === null)).toBe(true)
    expect(view.test).toMatchObject({ efforts: 0, need: P.a6.csMinEfforts.value, done: false })
    expect(view.custom).toBeNull()
  })

  test('takes a distance and a climb, and nothing else', async () => {
    const user = await newUser()
    const bad = (search: string) => client(ctx, user).get(`/api/paces${search}`)
    expect((await bad('?x=1')).status).toBe(400)
    expect((await bad('?gainM=100')).status).toBe(400)
    expect((await bad(`?distanceM=${String(PACES_CUSTOM_MIN_M - 1)}`)).status).toBe(400)
    expect((await bad(`?distanceM=${String(PACES_CUSTOM_MAX_M + 1)}`)).status).toBe(400)
    expect((await bad('?distanceM=abc')).status).toBe(400)
    expect((await bad('?distanceM=5000.5')).status).toBe(400)
    expect((await bad(`?distanceM=5000&gainM=${String(PACES_CUSTOM_GAIN_MAX_M + 1)}`)).status).toBe(
      400,
    )
    expect((await bad('?distanceM=5000&gainM=-1')).status).toBe(400)
    expect((await bad(`?distanceM=${String(PACES_CUSTOM_MIN_M)}&gainM=0`)).status).toBe(200)
  })
})

describe('GET /api/paces: what the runner sees', () => {
  test('the easy pace comes from the heart-rate line, with its runs and the top of Z1', async () => {
    const user = await newUser()
    await withMeasuredMax(user)
    await withSteadyRuns(user)
    const { easy } = await pacesOf(user)
    expect(easy.pace).toMatchObject({
      basis: 'hr-model',
      ceilingBpm: 148,
      confidence: 'moderate',
      grade: 'D',
    })
    expect(easy.pace?.sample?.runs).toBe(9)
    // the line meets 148 bpm at (148 - 90) / 20 = 2.9 m/s
    expect(easy.pace?.range[1]).toBe(Math.round(1000 / 2.9))
    expect(easy.pace?.hot).not.toBeNull()
    expect(easy.hr.runs).toBe(9)
  })

  test('the grade curve reads the stored terrain bins and shows the default with none (I13)', async () => {
    const user = await newUser()
    const empty = await pacesOf(user)
    expect(empty.terrain.eligibleRuns).toBe(0)
    expect(empty.terrain.bands).toHaveLength(9)
    expect(empty.terrain.bands.every((band) => band.source === 'default')).toBe(true)

    const runs = syntheticRuns(athlete(scaledCurve(0.5), 0.03), 40, today, 21, 2)
    for (const run of runs) {
      await ctx.prisma.activity.create({
        data: {
          userId: user.id,
          date: run.date,
          type: 'run',
          durationSec: 3600,
          distanceM: 9000,
          terrainBins: JSON.stringify(run.bins),
        },
      })
    }
    const { terrain, events } = await pacesOf(user)
    expect(terrain.eligibleRuns).toBe(40)
    expect(terrain.bands.some((band) => band.source === 'personal')).toBe(true)
    expect(terrain.bands[0]).toMatchObject({ source: 'default', reason: 'steep-end' })
    // display only: the events are what they are without the bins
    expect(events).toEqual(empty.events)
  })

  test('the events stand on the race and say so; a custom course follows the query', async () => {
    const user = await newUser()
    await withTenK(user)
    const view = await pacesOf(user, '?distanceM=15000&gainM=300')
    const ten = view.events.find((e) => e.key === 'ten-k')
    expect(ten?.basis.race).toMatchObject({ distanceM: 10_000, timeSec: 3000 })
    expect(ten?.time?.lowSec).toBeLessThan(3000 + 1)
    expect(view.custom).toMatchObject({
      key: 'custom',
      distanceM: 15_000,
      gainM: 300,
      climbs: true,
    })
    expect(view.custom?.rules).toContain('L5')
    expect(view.custom?.time).not.toBeNull()
  })

  test('is one user at a time', async () => {
    const racer = await newUser()
    const other = await newUser()
    await withTenK(racer)
    // one 10 km race supports every distance up to the marathon, and no ultra (L1, L2, L4)
    const racerEvents = (await pacesOf(racer)).events
    expect(racerEvents.filter((e) => e.time !== null).map((e) => e.key)).toEqual([
      'five-k',
      'ten-k',
      'half',
      'marathon',
    ])
    expect((await pacesOf(other)).events.every((e) => e.time === null)).toBe(true)
  })

  test('reads again after a write, and stays warm without one', async () => {
    const user = await newUser()
    expect((await pacesOf(user)).events[1]?.time).toBeNull()
    await withTenK(user)
    expect((await pacesOf(user)).events[1]?.time).not.toBeNull()
    const warm = cacheSizes(ctx.prisma).memos
    await pacesOf(user)
    expect(cacheSizes(ctx.prisma).memos).toBe(warm)
  })
})

describe('GET /api/paces: validators', () => {
  test('the tag follows the data version, the day and the course, and a current tag is a 304', async () => {
    const user = await newUser()
    const first = await client(ctx, user).get('/api/paces')
    const tag = first.headers['etag'] as string
    expect(tag).toMatch(/^W\/"paces\./)
    expect(first.headers['cache-control']).toBe('private, no-cache')
    const again = await client(ctx, user).get('/api/paces').set('If-None-Match', tag)
    expect(again.status).toBe(304)
    const other = await client(ctx, user).get('/api/paces?distanceM=8000')
    expect(other.headers['etag']).not.toBe(tag)
    await withTenK(user)
    const written = await client(ctx, user).get('/api/paces').set('If-None-Match', tag)
    expect(written.status).toBe(200)
  })
})
