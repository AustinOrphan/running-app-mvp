import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  fastestEfforts,
  longestRuns,
  monthlyTotals,
  statsOf,
  yearlyTotals,
} from '../../shared/domain/stats.ts'
import type { StatsView } from '../../shared/types.ts'
import { createPrisma, initSqlite, type PrismaClient } from '../../server/db.ts'
import { loadActivityCores } from '../../server/serialize.ts'
import { cacheSizes } from '../../server/services/athleteState.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

let ctx: TestCtx
let user: TestUser
const extra: PrismaClient[] = []

beforeEach(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(extra.splice(0).map((prisma) => prisma.$disconnect()))
  await ctx.close()
})

interface Seed {
  date: string
  type?: string
  minutes?: number
  distanceM?: number | null
  duplicateStatus?: string
  userId?: string
}

async function seed(rows: Seed[]): Promise<void> {
  await ctx.prisma.activity.createMany({
    data: rows.map((row) => ({
      userId: row.userId ?? user.id,
      date: row.date,
      type: row.type ?? 'run',
      durationSec: (row.minutes ?? 30) * 60,
      distanceM: row.distanceM === undefined ? 5000 : row.distanceM,
      duplicateStatus: row.duplicateStatus ?? 'none',
    })),
  })
}

const HISTORY: Seed[] = [
  { date: '2025-11-02', minutes: 25, distanceM: 5000 },
  { date: '2026-01-10', minutes: 100, distanceM: 21_200 },
  { date: '2026-02-03', minutes: 23, distanceM: 5050 },
  { date: '2026-02-20', minutes: 7, distanceM: 1620 },
  { date: '2026-02-21', minutes: 150, distanceM: 30_000, duplicateStatus: 'possible' },
  { date: '2026-02-22', type: 'strength', minutes: 30, distanceM: null },
  { date: '2026-02-25', type: 'race', minutes: 41, distanceM: 10_000 },
]

async function getStats(as: TestUser | null = user, search = '') {
  return client(ctx, as ?? undefined).get(`/api/stats${search}`)
}

async function secondConnection(): Promise<PrismaClient> {
  const prisma = createPrisma(ctx.config.databaseUrl)
  await initSqlite(prisma)
  extra.push(prisma)
  return prisma
}

describe('GET /api/stats', () => {
  test('needs a session and takes no query', async () => {
    const anonymous = await getStats(null)
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toMatchObject({ error: { code: 'unauthorized' } })

    const unknown = await getStats(user, '?from=2026-01-01')
    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ error: { code: 'validation' } })
  })

  test('is empty for a runner with no activities', async () => {
    const res = await getStats()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ monthly: [], yearly: [], efforts: [], longest: [] })
  })

  test('equals the pure statistics over the same rows, flagged duplicates left out', async () => {
    await seed(HISTORY)
    const res = await getStats()
    expect(res.status).toBe(200)
    const view = res.body as StatsView

    // What the browser computed from the full list before the server took over.
    const rows = await loadActivityCores(ctx.prisma, user.id)
    expect(view).toEqual({
      monthly: monthlyTotals(rows),
      yearly: yearlyTotals(rows),
      efforts: fastestEfforts(rows),
      longest: longestRuns(rows),
    })
    expect(view).toEqual(JSON.parse(JSON.stringify(statsOf(rows))))

    // And the figures themselves.
    expect(view.monthly.map((m) => [m.month, m.runs, m.runMin])).toEqual([
      ['2025-11', 1, 25],
      ['2026-01', 1, 100],
      ['2026-02', 2, 30],
    ])
    expect(view.yearly.map((y) => [y.year, y.runs])).toEqual([
      ['2025', 1],
      ['2026', 3],
    ])
    expect(view.efforts.map((e) => e.label)).toEqual(['1 mi', '5K', '10K', 'Half'])
    expect(view.efforts.find((e) => e.label === '5K')).toMatchObject({ durationSec: 23 * 60 })
    expect(view.longest.map((r) => r.durationSec)).toEqual([6000, 1500, 1380, 420])
    expect(view.longest.every((r) => r.duplicateStatus === 'none' && r.type === 'run')).toBe(true)
  })

  test('is scoped to the signed-in runner', async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await seed([{ date: '2026-02-03' }, { date: '2026-02-04', userId: other.id, minutes: 90 }])

    const mine = (await getStats(user)).body as StatsView
    const theirs = (await getStats(other)).body as StatsView
    expect(mine.monthly).toMatchObject([{ month: '2026-02', runs: 1, runMin: 30 }])
    expect(theirs.monthly).toMatchObject([{ month: '2026-02', runs: 1, runMin: 90 }])
  })
})

describe('GET /api/stats is memoised by data version', () => {
  test('a second request with no write reads no activity', async () => {
    await seed(HISTORY)
    const findMany = vi.spyOn(ctx.prisma.activity, 'findMany')
    expect(cacheSizes(ctx.prisma).memos).toBe(0)

    const first = await getStats()
    expect(first.status).toBe(200)
    expect(findMany).toHaveBeenCalledTimes(1)
    // Six columns of every activity, for the whole history.
    const args = findMany.mock.calls[0]![0]!
    expect(args.select).toEqual({
      id: true,
      date: true,
      type: true,
      durationSec: true,
      distanceM: true,
      duplicateStatus: true,
    })
    expect(args.where).toEqual({ userId: user.id })
    expect(cacheSizes(ctx.prisma).memos).toBe(1)

    const second = await getStats()
    const third = await getStats()
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(second.body).toEqual(first.body)
    expect(third.body).toEqual(first.body)
    expect(cacheSizes(ctx.prisma).memos).toBe(1)
  })

  test('a write through the API recomputes, and the new run is counted', async () => {
    await seed(HISTORY)
    const before = (await getStats()).body as StatsView
    const findMany = vi.spyOn(ctx.prisma.activity, 'findMany')

    const created = await client(ctx, user)
      .post('/api/activities')
      .send({ date: '2026-03-01', type: 'run', durationSec: 2400, distanceM: 10_000 })
    expect(created.status).toBe(201)
    findMany.mockClear()

    const after = (await getStats()).body as StatsView
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(after.monthly.at(-1)).toMatchObject({ month: '2026-03', runs: 1, runMin: 40 })
    expect(after.monthly).toHaveLength(before.monthly.length + 1)
    expect(after.efforts.find((e) => e.label === '10K')).toMatchObject({ durationSec: 2400 })

    await getStats()
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  test('a flagged duplicate that is restored joins the totals', async () => {
    await seed(HISTORY)
    const flagged = await ctx.prisma.activity.findFirstOrThrow({
      where: { userId: user.id, duplicateStatus: 'possible' },
    })
    const before = (await getStats()).body as StatsView
    expect(before.longest.map((r) => r.id)).not.toContain(flagged.id)
    // A flagged row needs an original to point at.
    const original = await ctx.prisma.activity.findFirstOrThrow({
      where: { userId: user.id, date: '2026-02-03' },
    })
    await ctx.prisma.activity.update({
      where: { id: flagged.id },
      data: { duplicateOfId: original.id },
    })

    const resolved = await client(ctx, user)
      .post(`/api/activities/${flagged.id}/duplicate`)
      .send({ status: 'dismissed' })
    expect(resolved.status).toBe(200)

    const after = (await getStats()).body as StatsView
    expect(after.longest[0]).toMatchObject({ id: flagged.id, durationSec: 9000 })
  })

  test('a write by another connection recomputes', async () => {
    await seed(HISTORY)
    const first = (await getStats()).body as StatsView
    const other = await secondConnection()

    await other.activity.create({
      data: {
        userId: user.id,
        date: '2026-03-05',
        type: 'run',
        durationSec: 1800,
        distanceM: 5000,
      },
    })

    const second = (await getStats()).body as StatsView
    expect(second.monthly).toHaveLength(first.monthly.length + 1)
    expect(second.yearly.find((y) => y.year === '2026')?.runs).toBe(
      (first.yearly.find((y) => y.year === '2026')?.runs ?? 0) + 1,
    )
  })

  test('each runner has a value of their own', async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await seed([{ date: '2026-02-03' }, { date: '2026-02-04', userId: other.id }])
    const findMany = vi.spyOn(ctx.prisma.activity, 'findMany')

    await getStats(user)
    await getStats(other)
    expect(findMany).toHaveBeenCalledTimes(2)
    await getStats(user)
    await getStats(other)
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(cacheSizes(ctx.prisma).memos).toBe(2)
  })
})
