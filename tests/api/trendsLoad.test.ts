import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { TrendsLoadView } from '../../shared/domain/trendsLoad.ts'
import { P } from '../../shared/engine/params/index.ts'
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
  user = await seedUser(ctx, { units: 'km' })
})

afterEach(async () => {
  vi.restoreAllMocks()
  expectNoRefusedFetches(ctx)
  await ctx.close()
})

const TODAY = todayIso()
const getLoad = (as: TestUser | null = user, search = '') =>
  client(ctx, as ?? undefined).get(`/api/trends/load${search}`)

/** Zone limits for a measured maximum of 190 bpm, as `buildZones` rounds them. */
const LT1 = Math.round(190 * P.c2.lt1FractionOfHrMax.value)
const LT2 = Math.round(190 * P.c2.lt2FractionOfHrMax.value)

async function withZones(userId = user.id) {
  await ctx.prisma.athleteProfile.create({
    data: { userId, hrMax: 190, hrMaxSource: 'measured', hrRest: 50 },
  })
}

/** An hour-long run: a minute-wide histogram of 20 minutes below, 20 between and 20 above the limits. */
function run(userId: string, daysAgo: number, over: Record<string, unknown> = {}) {
  const sec = new Array<number>(121).fill(0)
  sec[LT1 - 20 - 100] = 1200
  sec[Math.round((LT1 + LT2) / 2) - 100] = 1200
  sec[LT2 + 10 - 100] = 1200
  return {
    userId,
    date: addDays(TODAY, -daysAgo),
    type: 'run',
    durationSec: 3600,
    distanceM: 10_000,
    elevationGainM: 150,
    hrHistogram: JSON.stringify({ start: 100, width: 1, sec }),
    hrQuality: JSON.stringify({
      v: 2,
      th: '',
      source: 'wrist',
      movingSec: 3600,
      cleanSec: 3600,
      lockSec: 0,
      spikeSec: 0,
      dropSec: 0,
      flatSec: 0,
      mismatchSec: 0,
      halves: null,
      gapDecouplingPct: null,
    }),
    ...over,
  }
}

describe('GET /api/trends/load', () => {
  test('needs a session and takes no query', async () => {
    const anonymous = await getLoad(null)
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toMatchObject({ error: { code: 'unauthorized' } })

    const unknown = await getLoad(user, '?weeks=8')
    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ error: { code: 'validation' } })
  })

  test('is empty for a runner with no runs and no zones', async () => {
    const res = await getLoad()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ asOf: TODAY, zones: null, runs: [] })
  })

  test('answers the gain and the seconds in each band, cut at the limits of the zone table', async () => {
    await withZones()
    await ctx.prisma.activity.createMany({
      data: [run(user.id, 3), run(user.id, 10, { elevationGainM: null })],
    })
    const view = (await getLoad()).body as TrendsLoadView
    expect(view.zones).toEqual({ lt1Hr: LT1, lt2Hr: LT2 })
    expect(view.runs).toEqual([
      {
        date: addDays(TODAY, -10),
        durationSec: 3600,
        elevationGainM: null,
        bandSec: [1200, 1200, 1200],
      },
      {
        date: addDays(TODAY, -3),
        durationSec: 3600,
        elevationGainM: 150,
        bandSec: [1200, 1200, 1200],
      },
    ])
  })

  test('gives no bands to a run with no histogram, a failed quality check or no summary', async () => {
    await withZones()
    const failing = JSON.stringify({
      ...JSON.parse(run(user.id, 1).hrQuality as string),
      cleanSec: 1200,
      lockSec: 2400,
    })
    await ctx.prisma.activity.createMany({
      data: [
        run(user.id, 2, { hrHistogram: null }),
        run(user.id, 4, { hrQuality: failing }),
        run(user.id, 6, { hrQuality: null }),
      ],
    })
    const view = (await getLoad()).body as TrendsLoadView
    expect(view.runs).toHaveLength(3)
    expect(view.runs.every((r) => r.bandSec === null)).toBe(true)
    expect(view.runs.every((r) => r.elevationGainM === 150)).toBe(true)
  })

  test('leaves every run without bands when no zones are set', async () => {
    await ctx.prisma.activity.create({ data: run(user.id, 3) })
    const view = (await getLoad()).body as TrendsLoadView
    expect(view.zones).toBeNull()
    expect(view.runs).toHaveLength(1)
    expect(view.runs[0]!.bandSec).toBeNull()
  })

  test('reads runs only, leaves flagged duplicates out, and stops 107 weeks back', async () => {
    const first = addDays(mondayOf(TODAY), -7 * 106)
    await ctx.prisma.activity.createMany({
      data: [
        run(user.id, 5, { type: 'race' }),
        run(user.id, 6, { duplicateStatus: 'confirmed' }),
        run(user.id, 7, { duplicateStatus: 'dismissed' }),
        { ...run(user.id, 0), date: first },
        { ...run(user.id, 0), date: addDays(first, -1) },
      ],
    })
    const view = (await getLoad()).body as TrendsLoadView
    expect(view.runs.map((r) => r.date)).toEqual([first, addDays(TODAY, -7)])
  })

  test('is scoped to the signed-in runner', async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await ctx.prisma.activity.create({ data: run(other.id, 10) })
    expect(((await getLoad(user)).body as TrendsLoadView).runs).toEqual([])
    expect(((await getLoad(other)).body as TrendsLoadView).runs).toHaveLength(1)
  })

  test('a cold request reads the runs once with a column list, a warm one reads none', async () => {
    await ctx.prisma.activity.create({ data: run(user.id, 10) })
    // Build the snapshot first so the spy sees only this route's own read.
    await client(ctx, user).get('/api/state').expect(200)
    const findMany = vi.spyOn(ctx.prisma.activity, 'findMany')
    const memos = cacheSizes(ctx.prisma).memos

    const first = await getLoad()
    expect(first.status).toBe(200)
    expect(findMany).toHaveBeenCalledTimes(1)
    const args = findMany.mock.calls[0]![0] as {
      select: Record<string, boolean>
      where: { userId: string; type: string }
    }
    expect(args.where).toMatchObject({ userId: user.id, type: 'run' })
    // The columns the panels read; no notes, no position, no stream.
    expect(Object.keys(args.select).sort()).toEqual(
      ['date', 'durationSec', 'elevationGainM', 'hrHistogram', 'hrQuality'].sort(),
    )
    expect(cacheSizes(ctx.prisma).memos).toBe(memos + 1)

    findMany.mockClear()
    const second = await getLoad()
    expect(second.body).toEqual(first.body)
    expect(findMany).not.toHaveBeenCalled()
  })

  test('an activity write recomputes the panels', async () => {
    const before = (await getLoad()).body as TrendsLoadView
    expect(before.runs).toEqual([])
    await client(ctx, user)
      .post('/api/activities')
      .send({ date: addDays(TODAY, -2), type: 'run', durationSec: 1800, distanceM: 5000 })
      .expect(201)
    const after = (await getLoad()).body as TrendsLoadView
    expect(after.runs).toHaveLength(1)
  })
})
