import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runSurfaceJob } from '../../server/jobs/scheduler.ts'
import { trackRow } from '../../server/services/activityStore.ts'
import { downloadMapArea, removeMapArea } from '../../server/services/mapArea.ts'
import {
  SURFACE_BACKFILL_BATCH,
  backfillSurfaceBins,
} from '../../server/services/surfaceBackfill.ts'
import { SURFACE_VERSION } from '../../shared/domain/surface.ts'
import { TRACK_VERSION, buildTrack, type RoutePoint } from '../../shared/importers/files/track.ts'
import type { SurfaceBins } from '../../shared/types.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { line, overpassAnswer, threeWays } from '../fixtures/surface.ts'
import { OVERPASS_URL } from '../../server/services/mapArea.ts'
import {
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'surface-other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.mapWay.deleteMany()
  await ctx.prisma.mapArea.deleteMany()
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.syncRun.deleteMany({ where: { provider: 'surface' } })
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

const deps = () => ({ prisma: ctx.prisma, config: ctx.config })

/** A run with a stored track (as the import or the track job leaves it). */
async function addRun(
  userId: string,
  route: RoutePoint[] | null,
  date = '2026-10-05',
): Promise<string> {
  const activity = await ctx.prisma.activity.create({
    data: { userId, type: 'run', date, durationSec: 1800, distanceM: 1000, trackV: TRACK_VERSION },
  })
  const track = route ? buildTrack(route) : null
  if (track) {
    await ctx.prisma.activityTrack.create({ data: { activityId: activity.id, ...trackRow(track) } })
  }
  return activity.id
}

/** Downloads the three-way area for `userId` from a synthetic Overpass answer. */
async function download(userId: string): Promise<void> {
  ctx.fetch = fakeFetch({
    [`POST ${OVERPASS_URL}`]: () => new Response(JSON.stringify(overpassAnswer(threeWays()))),
  })
  await downloadMapArea(ctx, userId)
}

async function binsOf(id: string): Promise<SurfaceBins | null> {
  const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
  return row.surfaceBins === null ? null : (JSON.parse(row.surfaceBins) as SurfaceBins)
}

const trailRun = () => line([-500, 3], [500, 3])
const roadRun = () => line([-400, 198], [400, 198])

describe('backfillSurfaceBins', () => {
  test('does nothing without an area', async () => {
    const id = await addRun(user.id, trailRun())
    expect(await backfillSurfaceBins(deps(), user.id)).toEqual({
      filled: 0,
      unreadable: [],
      remaining: 0,
    })
    expect(await binsOf(id)).toBeNull()
  })

  test('shares each run between the classes, summing to the length of its track', async () => {
    const a = await addRun(user.id, trailRun())
    const b = await addRun(user.id, roadRun(), '2026-10-06')
    await download(user.id)
    expect(await backfillSurfaceBins(deps(), user.id)).toEqual({
      filled: 2,
      unreadable: [],
      remaining: 0,
    })
    expect(await binsOf(a)).toEqual({
      v: SURFACE_VERSION,
      trailM: 1000,
      pavedM: 0,
      roadM: 0,
      unknownM: 0,
    })
    expect(await binsOf(b)).toMatchObject({ trailM: 0, roadM: 800, unknownM: 0 })
    const track = await ctx.prisma.activityTrack.findUniqueOrThrow({ where: { activityId: b } })
    const dist = JSON.parse(track.distM) as number[]
    const bins = (await binsOf(b))!
    expect(bins.trailM + bins.pavedM + bins.roadM + bins.unknownM).toBe(
      Math.round(dist[dist.length - 1]! - dist[0]!),
    )
  })

  test('leaves a run with no track and a run outside the area null, and never selects them', async () => {
    const noTrack = await addRun(user.id, null)
    const far = await addRun(user.id, line([-500, 80_000], [500, 80_000]))
    const inside = await addRun(user.id, trailRun())
    // A second run at home keeps the median centre there; the far run is the odd one out.
    await addRun(user.id, roadRun(), '2026-10-06')
    await download(user.id)
    // The far run is outside the box; the area was drawn from all three tracks, so move it explicitly.
    const area = await ctx.prisma.mapArea.findUniqueOrThrow({ where: { userId: user.id } })
    expect(area.maxLat).toBeLessThan(
      (await ctx.prisma.activityTrack.findUniqueOrThrow({ where: { activityId: far } })).minLat,
    )
    const result = await backfillSurfaceBins(deps(), user.id)
    expect(result).toMatchObject({ filled: 2, remaining: 0 })
    expect(await binsOf(inside)).not.toBeNull()
    expect(await binsOf(noTrack)).toBeNull()
    expect(await binsOf(far)).toBeNull()
  })

  test('is idempotent: a second call selects nothing and rewrites nothing', async () => {
    const id = await addRun(user.id, trailRun())
    await download(user.id)
    await backfillSurfaceBins(deps(), user.id)
    const before = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
    const second = await backfillSurfaceBins(deps(), user.id)
    expect(second).toEqual({ filled: 0, unreadable: [], remaining: 0 })
    expect(await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })).toEqual(before)
  })

  test('holds updatedAt, so the pass does not make the explain cards stale', async () => {
    const id = await addRun(user.id, trailRun())
    const before = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
    await download(user.id)
    await backfillSurfaceBins(deps(), user.id)
    const after = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
    expect(after.surfaceBins).not.toBeNull()
    expect(after.updatedAt).toEqual(before.updatedAt)
  })

  test('works in batches of 20, newest first, and resumes where it stopped', async () => {
    expect(SURFACE_BACKFILL_BATCH).toBe(20)
    const ids: string[] = []
    for (let day = 1; day <= 25; day++) {
      ids.push(await addRun(user.id, trailRun(), `2026-09-${String(day).padStart(2, '0')}`))
    }
    await download(user.id)
    const first = await backfillSurfaceBins(deps(), user.id)
    expect(first).toMatchObject({ filled: 20, remaining: 5 })
    // The five oldest wait.
    for (const id of ids.slice(0, 5)) expect(await binsOf(id)).toBeNull()
    for (const id of ids.slice(5)) expect(await binsOf(id)).not.toBeNull()
    expect(await backfillSurfaceBins(deps(), user.id)).toMatchObject({ filled: 5, remaining: 0 })
  })

  test('a new download clears the shares and the job computes them again', async () => {
    const id = await addRun(user.id, trailRun())
    await download(user.id)
    await backfillSurfaceBins(deps(), user.id)
    expect((await binsOf(id))?.trailM).toBe(1000)

    // The same area downloaded again, now with the trail tagged as paved.
    ctx.fetch = fakeFetch({
      [`POST ${OVERPASS_URL}`]: () =>
        new Response(
          JSON.stringify(
            overpassAnswer([
              {
                id: 1,
                tags: { highway: 'path', surface: 'asphalt' },
                at: [
                  [-1000, 0],
                  [1000, 0],
                ],
              },
            ]),
          ),
        ),
    })
    await downloadMapArea(ctx, user.id)
    expect(await binsOf(id)).toBeNull()
    await backfillSurfaceBins(deps(), user.id)
    expect(await binsOf(id)).toMatchObject({ trailM: 0, pavedM: 1000 })
  })

  test('removing the area clears the shares and the job then leaves the runs alone', async () => {
    const id = await addRun(user.id, trailRun())
    await download(user.id)
    await backfillSurfaceBins(deps(), user.id)
    await removeMapArea(ctx.prisma, user.id)
    expect(await binsOf(id)).toBeNull()
    expect(await backfillSurfaceBins(deps(), user.id)).toMatchObject({ filled: 0, remaining: 0 })
    expect(await binsOf(id)).toBeNull()
  })

  test('a change of the matcher version computes every run again', async () => {
    const id = await addRun(user.id, trailRun())
    await download(user.id)
    await backfillSurfaceBins(deps(), user.id)
    await ctx.prisma.mapArea.update({ where: { userId: user.id }, data: { matchV: 0 } })
    await ctx.prisma.activity.update({
      where: { id },
      data: { surfaceBins: JSON.stringify({ v: 0, trailM: 5, pavedM: 0, roadM: 0, unknownM: 0 }) },
    })
    expect(await backfillSurfaceBins(deps(), user.id)).toMatchObject({ filled: 1 })
    expect(await binsOf(id)).toMatchObject({ v: SURFACE_VERSION, trailM: 1000 })
    expect(
      (await ctx.prisma.mapArea.findUniqueOrThrow({ where: { userId: user.id } })).matchV,
    ).toBe(SURFACE_VERSION)
  })

  test('a track that cannot be read gets zero shares, is reported once and is not met again', async () => {
    const bad = await addRun(user.id, trailRun())
    const good = await addRun(user.id, roadRun(), '2026-10-06')
    await ctx.prisma.activityTrack.update({ where: { activityId: bad }, data: { distM: '[' } })
    await download(user.id)
    const result = await backfillSurfaceBins(deps(), user.id)
    expect(result).toMatchObject({ filled: 2, unreadable: [bad], remaining: 0 })
    expect(await binsOf(bad)).toEqual({
      v: SURFACE_VERSION,
      trailM: 0,
      pavedM: 0,
      roadM: 0,
      unknownM: 0,
    })
    expect((await binsOf(good))?.roadM).toBe(800)
    expect(await backfillSurfaceBins(deps(), user.id)).toMatchObject({ filled: 0, unreadable: [] })
  })

  test('leaves a run that was edited during the pass for the next call', async () => {
    const id = await addRun(user.id, trailRun())
    await download(user.id)
    // The pass reads the row, then another write changes it: simulate by changing updatedAt after the
    // read through a wrapped client.
    const racing = {
      prisma: new Proxy(ctx.prisma, {
        get(target, key, receiver) {
          if (key === 'mapWay') {
            return {
              findMany: async (args: never) => {
                const rows = await target.mapWay.findMany(args)
                await target.activity.update({ where: { id }, data: { rpe: 5 } })
                return rows
              },
            }
          }
          return Reflect.get(target, key, receiver) as unknown
        },
      }),
    }
    expect(await backfillSurfaceBins(racing, user.id)).toMatchObject({ filled: 0, remaining: 1 })
    expect(await binsOf(id)).toBeNull()
    expect(await backfillSurfaceBins(deps(), user.id)).toMatchObject({ filled: 1 })
  })

  test('another runner’s runs are not touched by this runner’s area', async () => {
    const mine = await addRun(user.id, trailRun())
    const theirs = await addRun(other.id, trailRun())
    await download(user.id)
    await backfillSurfaceBins(deps(), user.id)
    await backfillSurfaceBins(deps(), other.id)
    expect(await binsOf(mine)).not.toBeNull()
    expect(await binsOf(theirs)).toBeNull()
  })
})

describe('runSurfaceJob', () => {
  const runs = (userId: string) =>
    ctx.prisma.syncRun.findMany({
      where: { userId, channel: 'job', provider: 'surface' },
      orderBy: { startedAt: 'asc' },
    })

  test('records a surface run with the runs filled, then nothing once there is nothing left', async () => {
    await addRun(user.id, trailRun())
    await addRun(user.id, roadRun(), '2026-10-06')
    await download(user.id)
    await runSurfaceJob(deps())
    const [run, ...rest] = await runs(user.id)
    expect(rest).toEqual([])
    expect(run).toMatchObject({ status: 'ok', trigger: 'schedule', accepted: 2, failed: 0 })
    await runSurfaceJob(deps())
    expect(await runs(user.id)).toHaveLength(1)
  })

  test('a tick that meets an unreadable track is a partial run', async () => {
    const bad = await addRun(user.id, trailRun())
    await ctx.prisma.activityTrack.update({ where: { activityId: bad }, data: { distM: '[' } })
    await download(user.id)
    await runSurfaceJob(deps())
    const [recorded] = await runs(user.id)
    expect(recorded).toMatchObject({ status: 'partial', accepted: 1, failed: 1 })
  })

  test('a user without an area records no work', async () => {
    await addRun(other.id, trailRun())
    await runSurfaceJob(deps())
    for (const row of await runs(other.id)) expect(row.accepted).toBe(0)
  })
})
