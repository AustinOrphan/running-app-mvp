import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { trackRow } from '../../server/services/activityStore.ts'
import { downloadMapArea, OVERPASS_URL } from '../../server/services/mapArea.ts'
import { queueSurfaceFill, settleSurfaceFill } from '../../server/services/surfaceFill.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import { TRACK_VERSION, buildTrack, type RoutePoint } from '../../shared/importers/files/track.ts'
import type { SurfaceBins } from '../../shared/types.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { line, overpassAnswer, threeWays } from '../fixtures/surface.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  storeParsedToday as storeParsed,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// The trail and road shares follow their events (ADR 0026): nothing here calls a tick.

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
  await ctx.prisma.mapWay.deleteMany()
  await ctx.prisma.mapArea.deleteMany()
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importedFile.deleteMany()
  await ctx.prisma.syncRun.deleteMany({ where: { provider: 'surface' } })
})

afterEach(async () => {
  await settleSurfaceFill()
  expectNoRefusedFetches(ctx)
})

const trailRun = () => line([-500, 3], [500, 3])

async function addRun(route: RoutePoint[], date = '2026-10-05'): Promise<string> {
  const activity = await ctx.prisma.activity.create({
    data: {
      userId: user.id,
      type: 'run',
      date,
      durationSec: 1800,
      distanceM: 1000,
      trackV: TRACK_VERSION,
    },
  })
  await ctx.prisma.activityTrack.create({
    data: { activityId: activity.id, ...trackRow(buildTrack(route)!) },
  })
  return activity.id
}

async function download(): Promise<void> {
  ctx.fetch = fakeFetch({
    [`POST ${OVERPASS_URL}`]: () => new Response(JSON.stringify(overpassAnswer(threeWays()))),
  })
  await downloadMapArea(ctx, user.id)
}

async function binsOf(id: string): Promise<SurfaceBins | null> {
  const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
  return row.surfaceBins === null ? null : (JSON.parse(row.surfaceBins) as SurfaceBins)
}

const jobRuns = () =>
  ctx.prisma.syncRun.findMany({
    where: { userId: user.id, channel: 'job', provider: 'surface' },
    orderBy: { startedAt: 'asc' },
  })

/** A FIT file of a run along `route`, parsed. */
function fitRun(route: RoutePoint[], serial: number) {
  const bytes = buildFit({
    serial,
    sessions: [
      {
        sport: 1,
        startUnix: Date.UTC(2026, 0, 5, 7) / 1000,
        durationSec: 1000,
        records: route.map((p) => ({ t: p.t!, distanceM: p.d!, lat: p.lat, lng: p.lng })),
      },
    ],
  })
  const [parsed] = parseActivityFile(`run-${serial}.fit`, bytes, { timezone: 'UTC' })
  return { parsed: parsed!, file: { name: `run-${serial}.fit`, format: 'fit' as const, bytes } }
}

describe('queueSurfaceFill', () => {
  test('a map download fills the runs inside it without a tick, as one event run', async () => {
    const a = await addRun(trailRun())
    const b = await addRun(trailRun(), '2026-10-06')
    await download()
    await settleSurfaceFill()
    expect(await binsOf(a)).not.toBeNull()
    expect(await binsOf(b)).not.toBeNull()
    const [run, ...rest] = await jobRuns()
    expect(rest).toEqual([])
    expect(run).toMatchObject({ status: 'ok', trigger: 'event', accepted: 2, failed: 0 })
  })

  test('an import that writes a track queues the fill', async () => {
    await addRun(trailRun(), '2026-10-01')
    await download()
    await settleSurfaceFill()
    const { parsed, file } = fitRun(trailRun(), 1)
    const { activityId } = await storeParsed(ctx, user.id, parsed, {
      source: 'file',
      importBatchId: null,
      channel: 'upload',
      file,
    })
    await settleSurfaceFill()
    expect(await binsOf(activityId)).not.toBeNull()
  })

  test('a type edit fills the track from the stored original, then the shares', async () => {
    await addRun(trailRun(), '2026-10-01')
    await download()
    const { parsed, file } = fitRun(trailRun(), 2)
    const { activityId } = await storeParsed(
      ctx,
      user.id,
      { ...parsed, type: 'cross' },
      { source: 'file', importBatchId: null, channel: 'upload', file },
    )
    await settleSurfaceFill()
    const before = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })
    expect(before.trackV).toBeNull()
    expect(await binsOf(activityId)).toBeNull()

    const res = await client(ctx, user)
      .put(`/api/activities/${activityId}`)
      .send({ date: before.date, type: 'run', durationSec: before.durationSec })
    expect(res.status).toBe(200)
    // The track is local work inside the request.
    expect(await ctx.prisma.activityTrack.findUnique({ where: { activityId } })).not.toBeNull()
    await settleSurfaceFill()
    expect(await binsOf(activityId)).not.toBeNull()
  })

  test('a call during a drain joins it and sets one more pass, never a second drain', async () => {
    await addRun(trailRun())
    await download()
    const first = queueSurfaceFill(ctx, user.id)
    const second = queueSurfaceFill(ctx, user.id)
    const third = queueSurfaceFill(ctx, user.id)
    expect(second).toBe(first)
    expect(third).toBe(first)
    await first
    expect(await jobRuns()).toHaveLength(1)
  })

  test('without a map area there is no work and no log entry', async () => {
    await addRun(trailRun())
    await queueSurfaceFill(ctx, user.id)
    expect(await jobRuns()).toEqual([])
  })

  test('a drain that throws records an error run and never throws to the caller', async () => {
    await addRun(trailRun())
    await download()
    await settleSurfaceFill()
    await ctx.prisma.syncRun.deleteMany({ where: { provider: 'surface' } })
    const failing = {
      config: ctx.config,
      prisma: new Proxy(ctx.prisma, {
        get(target, key, receiver) {
          if (key === 'mapArea') {
            return { ...target.mapArea, findUnique: () => Promise.reject(new Error('boom')) }
          }
          return Reflect.get(target, key, receiver) as unknown
        },
      }),
    }
    await expect(queueSurfaceFill(failing, user.id)).resolves.toBeUndefined()
    expect((await jobRuns())[0]).toMatchObject({ status: 'error', trigger: 'event' })
  })
})
