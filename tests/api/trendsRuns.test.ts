import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import { HR_WINDOW_COUNT, type TrendsRunsView } from '../../shared/domain/trendsRuns.ts'
import { cacheSizes } from '../../server/services/athleteState.ts'
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
const getRuns = (as: TestUser | null = user, search = '') =>
  client(ctx, as ?? undefined).get(`/api/trends/runs${search}`)

/** One flat 40-minute run on the line HR = 90 + 20 x speed, with a one-bin heart-rate histogram. */
function steadyRun(userId: string, daysAgo: number, speedMps: number) {
  const durationSec = 2400
  const avgHr = Math.round(90 + 20 * speedMps)
  return {
    userId,
    date: addDays(TODAY, -daysAgo),
    type: 'run',
    durationSec,
    distanceM: speedMps * durationSec,
    gapDistanceM: speedMps * durationSec,
    elevationGainM: 20,
    avgHr,
    hrHistogram: JSON.stringify({
      start: 100,
      width: 5,
      sec: Array.from({ length: 20 }, (_, bin) =>
        bin === Math.floor((avgHr - 100) / 5) ? durationSec : 0,
      ),
    }),
  }
}

/** A two-hour run of 20 km with a stored drift reading. */
function longRun(userId: string, daysAgo: number, decouplingPct: number | null, gainM = 40) {
  return {
    userId,
    date: addDays(TODAY, -daysAgo),
    type: 'run',
    durationSec: 7200,
    distanceM: 20_000,
    elevationGainM: gainM,
    tempC: 14,
    decouplingPct,
  }
}

describe('GET /api/trends/runs', () => {
  test('needs a session and takes no query', async () => {
    const anonymous = await getRuns(null)
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toMatchObject({ error: { code: 'unauthorized' } })

    const unknown = await getRuns(user, '?weeks=8')
    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ error: { code: 'validation' } })
  })

  test('is empty for a runner with no runs: no long runs and 26 windows with no line', async () => {
    const res = await getRuns()
    expect(res.status).toBe(200)
    const view = res.body as TrendsRunsView
    expect(view.asOf).toBe(TODAY)
    expect(view.longRuns).toEqual([])
    expect(view.hrWindows).toHaveLength(HR_WINDOW_COUNT)
    expect(view.hrWindows.at(-1)!.end).toBe(TODAY)
    expect(view.hrWindows.every((w) => w.line === null && w.qualifying === 0)).toBe(true)
  })

  test('answers the flat long runs with a reading, and the heart-rate line of each window', async () => {
    await ctx.prisma.activity.createMany({
      data: [
        longRun(user.id, 30, 4.5),
        longRun(user.id, 60, 6.1),
        // No reading, a hilly run (20 km with 400 m of climb), a flagged duplicate: none is drawn.
        longRun(user.id, 70, null),
        longRun(user.id, 80, 9, 400),
        { ...longRun(user.id, 90, 7), duplicateStatus: 'confirmed' },
        ...Array.from({ length: 9 }, (_, i) => steadyRun(user.id, 3 + i * 6, 2.3 + i * 0.1)),
      ],
    })
    const view = (await getRuns()).body as TrendsRunsView
    expect(view.longRuns).toEqual([
      { date: addDays(TODAY, -60), durationSec: 7200, decouplingPct: 6.1, tempC: 14 },
      { date: addDays(TODAY, -30), durationSec: 7200, decouplingPct: 4.5, tempC: 14 },
    ])
    const last = view.hrWindows.at(-1)!
    expect(last.qualifying).toBe(9)
    expect(last.line).toMatchObject({ runs: 9 })
    expect(last.line!.slopeBpmPerMps).toBeCloseTo(20, 0)
  })

  test('reaches back past the 365 days of the snapshot, to the start of the oldest window', async () => {
    await ctx.prisma.activity.createMany({
      data: [longRun(user.id, 700, 3), longRun(user.id, 400, 5), longRun(user.id, 900, 8)],
    })
    const view = (await getRuns()).body as TrendsRunsView
    expect(view.longRuns.map((r) => r.decouplingPct)).toEqual([3, 5])
  })

  test('is scoped to the signed-in runner', async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await ctx.prisma.activity.create({ data: longRun(other.id, 10, 5) })
    expect(((await getRuns(user)).body as TrendsRunsView).longRuns).toEqual([])
    expect(((await getRuns(other)).body as TrendsRunsView).longRuns).toHaveLength(1)
  })

  test('a cold request reads the runs once with a column list, a warm one reads none', async () => {
    await ctx.prisma.activity.create({ data: longRun(user.id, 10, 5) })
    const findMany = vi.spyOn(ctx.prisma.activity, 'findMany')
    expect(cacheSizes(ctx.prisma).memos).toBe(0)

    const first = await getRuns()
    expect(first.status).toBe(200)
    expect(findMany).toHaveBeenCalledTimes(1)
    const args = findMany.mock.calls[0]![0] as {
      select: Record<string, boolean>
      where: { userId: string; type: string }
    }
    expect(args.where).toMatchObject({ userId: user.id, type: 'run' })
    // The columns the panels read; no notes, no position, no file.
    expect(Object.keys(args.select).sort()).toEqual(
      [
        'avgHr',
        'date',
        'decouplingPct',
        'distanceM',
        'duplicateStatus',
        'durationSec',
        'elevationGainM',
        'gapDistanceM',
        'hrHistogram',
        'humidityPct',
        'movingSec',
        'tempC',
        'type',
        'windKph',
      ].sort(),
    )
    expect(cacheSizes(ctx.prisma).memos).toBe(1)

    findMany.mockClear()
    const second = await getRuns()
    expect(second.body).toEqual(first.body)
    expect(findMany).not.toHaveBeenCalled()
  })

  test('an activity write recomputes the panels', async () => {
    const before = (await getRuns()).body as TrendsRunsView
    expect(before.longRuns).toEqual([])
    await ctx.prisma.activity.create({ data: longRun(user.id, 10, 5) })
    // A raw create does not move the data version; a write through the API does.
    await client(ctx, user)
      .post('/api/activities')
      .send({ date: addDays(TODAY, -2), type: 'run', durationSec: 1800, distanceM: 5000 })
      .expect(201)
    const after = (await getRuns()).body as TrendsRunsView
    expect(after.longRuns).toHaveLength(1)
  })
})
