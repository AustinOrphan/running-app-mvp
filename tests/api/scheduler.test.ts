import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runWeatherJob } from '../../server/jobs/scheduler.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

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
