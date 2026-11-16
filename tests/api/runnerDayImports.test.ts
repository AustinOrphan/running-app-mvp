// D10 step 5 (ADR 0022): imports date an offset-less time in the stored zone as stored, never in
// `runnerZone`, so the cutover moves no imported run. A runner with no zone chosen (the stored
// 'UTC') keeps UTC dating while their days follow the server's zone.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import type { ParsedActivity } from '../../shared/types.ts'
import { runnerDay } from '../../server/runnerDay.ts'
import {
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  storeParsedToday,
  type TestCtx,
} from './helpers.ts'

const SERVER_ZONE = 'Pacific/Kiritimati'
// 23:30 UTC on 2 March: still the 2nd in UTC, the 3rd at +14.
const NEAR_MIDNIGHT = '2026-03-02T23:30:00.000Z'
const upload = { source: 'upload', importBatchId: null, channel: 'upload' } as const

let ctx: TestCtx
let counter = 0

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  await ctx.close()
})

function parsed(providerKey: string): ParsedActivity {
  return {
    providerKey,
    startUtc: NEAR_MIDNIGHT,
    utcOffsetMin: null,
    type: 'run',
    subtype: 'road',
    elapsedSec: 1800,
    movingSec: null,
    distanceM: 5000,
    elevationGainM: null,
    elevationLossM: null,
    avgHr: 150,
    maxHr: 172,
    avgCadence: null,
    avgPowerW: null,
    deviceName: 'Test Watch',
    startLat: null,
    startLng: null,
    samples: {
      t: Array.from({ length: 30 }, (_, i) => i * 60),
      d: null,
      hr: Array.from({ length: 30 }, () => 150),
      alt: null,
      cad: null,
      pwr: null,
    },
    laps: [],
  }
}

async function runnerWith(timezone: string | null) {
  counter += 1
  const user = await seedUser(ctx, { email: `import${String(counter)}@example.com` })
  if (timezone !== null) {
    await ctx.prisma.athleteProfile.create({ data: { userId: user.id, timezone } })
  }
  return user
}

/** Runs `run` with the process zone set, so the server zone is `zone`. */
async function onServerIn<T>(zone: string, run: () => Promise<T>): Promise<T> {
  const original = process.env.TZ
  process.env.TZ = zone
  try {
    return await run()
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
}

describe('imports across the cutover', () => {
  test('a runner with the stored UTC keeps UTC dating while their day follows the server zone', async () => {
    const user = await runnerWith('UTC')
    await onServerIn(SERVER_ZONE, async () => {
      // The runner's day is the server's, +14, so it is already the 3rd.
      expect(runnerDay(new Date(NEAR_MIDNIGHT), 'UTC').today).toBe('2026-03-03')
      const first = await storeParsedToday(ctx, user.id, parsed('fit:utc-1'), upload)
      expect(first.outcome).toBe('imported')
      const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: first.activityId } })
      expect(row).toMatchObject({ date: '2026-03-02', startTime: '23:30' })

      // The same file again, as a re-pull or a re-import: the row keeps its date.
      const again = await storeParsedToday(ctx, user.id, parsed('fit:utc-1'), upload)
      expect(again).toEqual({ outcome: 'updated', activityId: first.activityId })
      const kept = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: first.activityId } })
      expect(kept).toMatchObject({ date: '2026-03-02', startTime: '23:30' })
    })
  })

  test('a runner with no profile row is dated in UTC too', async () => {
    const user = await runnerWith(null)
    await onServerIn(SERVER_ZONE, async () => {
      const { activityId } = await storeParsedToday(ctx, user.id, parsed('fit:none-1'), upload)
      const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })
      expect(row.date).toBe('2026-03-02')
    })
  })

  test('a runner with a chosen zone is dated in it as stored, whatever the server zone', async () => {
    const user = await runnerWith('Pacific/Pago_Pago')
    await onServerIn(SERVER_ZONE, async () => {
      const { activityId } = await storeParsedToday(ctx, user.id, parsed('fit:west-1'), upload)
      const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })
      // 23:30 UTC is 12:30 on the 2nd at -11.
      expect(row).toMatchObject({ date: '2026-03-02', startTime: '12:30' })
    })
  })
})
