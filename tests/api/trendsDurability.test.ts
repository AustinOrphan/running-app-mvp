import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import type { TrendsDurabilityView } from '../../shared/domain/durabilityByHour.ts'
import { computeHrQuality } from '../../shared/importers/files/hrQuality.ts'
import type { ActivityStreamData } from '../../shared/types.ts'
import { SAMPLE_SEC, stream } from '../fixtures/durabilityStream.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

let ctx: TestCtx
let user: TestUser

beforeEach(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterEach(async () => {
  vi.restoreAllMocks()
  expectNoRefusedFetches(ctx)
  await ctx.close()
})

const TODAY = todayIso()
const getView = (as: TestUser | null = user, search = '') =>
  client(ctx, as ?? undefined).get(`/api/trends/durability${search}`)

/** Four hours at 3 m/s on a steady 1% climb at 140 bpm. */
const fourHours = () => stream([{ minutes: 240, speed: 3, grade: 0.01, hr: 140 }])

interface SeedOptions {
  daysAgo: number
  durationSec?: number
  type?: 'run' | 'race'
  stream?: ActivityStreamData | null
  source?: 'strap' | 'wrist'
  duplicateStatus?: string
  userId?: string
}

/** One long activity with its stream and the heart-rate summary the import would store. */
async function seed(options: SeedOptions): Promise<string> {
  const data = options.stream === undefined ? fourHours() : options.stream
  const row = await ctx.prisma.activity.create({
    data: {
      userId: options.userId ?? user.id,
      date: addDays(TODAY, -options.daysAgo),
      type: options.type ?? 'run',
      durationSec: options.durationSec ?? 14_400,
      distanceM: 43_200,
      duplicateStatus: options.duplicateStatus ?? 'none',
      hrQuality:
        data === null
          ? null
          : JSON.stringify(computeHrQuality(data, SAMPLE_SEC, options.source ?? 'strap')),
    },
  })
  if (data !== null) {
    await ctx.prisma.activityStream.create({
      data: { activityId: row.id, sampleSec: SAMPLE_SEC, data: JSON.stringify(data) },
    })
  }
  return row.id
}

describe('GET /api/trends/durability', () => {
  test('needs a session and takes no query', async () => {
    const anonymous = await getView(null)
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toMatchObject({ error: { code: 'unauthorized' } })

    const unknown = await getView(user, '?weeks=8')
    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ error: { code: 'validation' } })
  })

  test('is empty for a runner with no long runs', async () => {
    const res = await getView()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      asOf: TODAY,
      runs: [],
      leftOut: [],
    })
  })

  test('answers each run or race of 180 minutes or more with its hours, oldest first', async () => {
    const newer = await seed({ daysAgo: 10 })
    const older = await seed({ daysAgo: 40, type: 'race' })
    // Under 180 minutes, a flagged duplicate and another runner's run are not listed.
    await seed({ daysAgo: 20, durationSec: 179 * 60 })
    await seed({ daysAgo: 25, duplicateStatus: 'confirmed' })
    const other = await ctx.prisma.user.create({
      data: { email: 'other@example.com', passwordHash: 'x' },
    })
    await seed({ daysAgo: 12, userId: other.id })

    const view = (await getView()).body as TrendsDurabilityView
    expect(view.runs.map((run) => run.activityId)).toEqual([older, newer])
    const run = view.runs[1]!
    expect(run).toMatchObject({
      date: addDays(TODAY, -10),
      type: 'run',
      durationSec: 14_400,
      fuel: 'none',
      hrGap: null,
    })
    expect(run.hours.map((h) => h.hour)).toEqual([1, 2, 3, 4])
    expect(run.hours[0]).toMatchObject({ hrBpm: 140, partial: false })
    expect(run.hours[0]!.paceSecPerKm).toBeCloseTo(1000 / 3, -1)
    expect(view.runs[0]!.type).toBe('race')
  })

  test('groups by the fuel log: a log that was not skipped is logged, anything else is none', async () => {
    const logged = await seed({ daysAgo: 10 })
    const skipped = await seed({ daysAgo: 20 })
    const none = await seed({ daysAgo: 30 })
    await ctx.prisma.fuelLog.create({
      data: { userId: user.id, activityId: logged, skipped: false, gut: 1, nausea: 0 },
    })
    await ctx.prisma.fuelLog.create({
      data: { userId: user.id, activityId: skipped, skipped: true },
    })
    const view = (await getView()).body as TrendsDurabilityView
    const fuelOf = (id: string) => view.runs.find((run) => run.activityId === id)!.fuel
    expect(fuelOf(logged)).toBe('logged')
    expect(fuelOf(skipped)).toBe('none')
    expect(fuelOf(none)).toBe('none')
  })

  test('keeps the pace and leaves the heart rate out of a run that fails the checks', async () => {
    const bare: ActivityStreamData = { ...fourHours(), hr: null }
    const id = await seed({ daysAgo: 10, stream: bare, source: 'wrist' })
    const view = (await getView()).body as TrendsDurabilityView
    const run = view.runs.find((r) => r.activityId === id)!
    expect(run.hrGap).toBe('dropouts')
    expect(run.hours.every((h) => h.hrBpm === null && h.paceSecPerKm !== null)).toBe(true)
  })

  test('counts the runs it cannot draw by reason', async () => {
    await seed({ daysAgo: 10, stream: null })
    await seed({ daysAgo: 20, stream: { ...fourHours(), alt: null } })
    const view = (await getView()).body as TrendsDurabilityView
    expect(view.runs).toEqual([])
    expect(view.leftOut).toEqual([
      { date: addDays(TODAY, -20), reason: 'no-grade' },
      { date: addDays(TODAY, -10), reason: 'no-stream' },
    ])
  })

  test('reads again after a fuel log is written', async () => {
    const id = await seed({ daysAgo: 10 })
    expect(((await getView()).body as TrendsDurabilityView).runs[0]!.fuel).toBe('none')
    await ctx.prisma.fuelLog.create({
      data: { userId: user.id, activityId: id, skipped: false, gut: 1, nausea: 0 },
    })
    expect(((await getView()).body as TrendsDurabilityView).runs[0]!.fuel).toBe('logged')
  })
})
