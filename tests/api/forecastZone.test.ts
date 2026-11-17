import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { serverTimeZone } from '../../server/runnerDay.ts'
import { loadForecast } from '../../server/services/engineInput.ts'
import { forecastCellOf } from '../../server/services/weatherCache.ts'
import { createTestCtx, expectNoRefusedFetches, seedUser, type TestCtx } from './helpers.ts'

// D10 step 6 (ADR 0022): the forecast's wall clock is the zone the runner's days follow. The zone
// the resolver answers with is injected until step 5 makes it the stored one; `stored` records what
// the forecast handed it, so a test shows the profile value was read.
const injected = vi.hoisted(() => ({ zone: null as string | null, stored: [] as string[] }))
vi.mock('../../server/runnerDay.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/runnerDay.ts')>()
  return {
    ...actual,
    runnerZone: (stored: string | null | undefined) => {
      if (typeof stored === 'string') injected.stored.push(stored)
      return injected.zone ?? actual.runnerZone(stored)
    },
  }
})

const NOW = new Date(Date.UTC(2026, 2, 10, 11, 0))
const HOME = { homeLat: 51.5, homeLng: -0.1 }

let ctx: TestCtx
let userId: string

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  ctx = await createTestCtx()
  userId = (await seedUser(ctx)).id
  await ctx.prisma.forecastCache.create({
    data: {
      ...forecastCellOf(HOME.homeLat, HOME.homeLng),
      fetchedAt: NOW,
      hours: JSON.stringify([
        {
          time: '2026-03-10T12:00:00Z',
          tempC: 10,
          dewPointC: 5,
          humidityPct: 60,
          windKph: 8,
          shortwaveWm2: null,
        },
      ]),
    },
  })
})

afterEach(() => {
  injected.zone = null
  injected.stored.length = 0
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  vi.useRealTimers()
  await ctx.close()
})

async function firstHour(timezone: string): Promise<string | undefined> {
  const hours = await loadForecast(ctx.prisma, userId, { ...HOME, timezone })
  return hours?.[0]?.time
}

describe('loadForecast wall clock', () => {
  test('reads the zone the runner days follow, not the stored value', async () => {
    injected.zone = 'Pacific/Kiritimati'
    // 12:00 UTC is 02:00 on the 11th at +14.
    expect(await firstHour('Marker/Stored')).toBe('2026-03-11T02:00:00')
    expect(injected.stored).toContain('Marker/Stored')

    injected.zone = 'Pacific/Pago_Pago'
    // 12:00 UTC is 01:00 on the 10th at -11.
    expect(await firstHour('Marker/Stored')).toBe('2026-03-10T01:00:00')
  })

  test('a runner with no zone chosen gets the server zone, not UTC', async () => {
    const expected = await firstHour(serverTimeZone())
    expect(await firstHour('UTC')).toBe(expected)
  })
})
