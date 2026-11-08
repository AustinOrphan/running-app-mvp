import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { storeParsed } from '../../server/services/activityStore.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import { decodePolyline } from '../../shared/importers/files/track.ts'
import { haversineM } from '../../shared/importers/files/summarize.ts'
import type { ActivityTrackView } from '../../shared/types.ts'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { syntheticRun } from '../fixtures/syntheticRoute.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'track-route-other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importedFile.deleteMany()
  await ctx.prisma.user.updateMany({ data: { hideMapEnds: true } })
})

const fixes = syntheticRun(1800)

async function importRun(userId: string, seconds = 1800): Promise<string> {
  const part = fixes.slice(0, seconds)
  const bytes = buildFit({
    sessions: [
      {
        sport: 1,
        startUnix: Date.UTC(2026, 0, 5, 7) / 1000,
        durationSec: seconds,
        records: part.map((f) => ({ t: f.t, lat: f.lat, lng: f.lng, distanceM: f.distanceM })),
      },
    ],
  })
  const [parsed] = parseActivityFile('run.fit', bytes, { timezone: 'UTC' })
  const { activityId } = await storeParsed(ctx, userId, parsed!, {
    source: 'file',
    importBatchId: null,
    channel: 'upload',
  })
  return activityId
}

const get = (u: TestUser | undefined, id: string) =>
  client(ctx, u).get(`/api/activities/${id}/track`)

describe('GET /api/activities/:id/track', () => {
  test('needs a session', async () => {
    const id = await importRun(user.id)
    expect((await get(undefined, id)).status).toBe(401)
  })

  test('is the owner’s alone', async () => {
    const id = await importRun(user.id)
    expect((await get(other, id)).status).toBe(404)
  })

  test('404 for an unknown run and for a run with no track', async () => {
    expect((await get(user, 'nope')).status).toBe(404)
    const bare = await ctx.prisma.activity.create({
      data: { userId: user.id, type: 'run', date: '2026-01-05', durationSec: 600 },
    })
    expect((await get(user, bare.id)).status).toBe(404)
  })

  test('hides the first and last 200 m by default, cutting exactly there', async () => {
    const id = await importRun(user.id)
    const whole = await ctx.prisma.activityTrack.findUniqueOrThrow({ where: { activityId: id } })
    const wholeDist = JSON.parse(whole.distM) as number[]
    const total = wholeDist[wholeDist.length - 1]!

    const res = await get(user, id)
    expect(res.status).toBe(200)
    const view = res.body as ActivityTrackView
    expect(view.endsHiddenM).toBe(200)
    expect(view.distM[0]).toBe(200)
    expect(view.distM[view.distM.length - 1]).toBe(total - 200)
    expect(view.pointCount).toBe(view.distM.length)

    // The shown ends are the recorded fixes 200 m of path from each end (the loop crosses its own
    // start, so straight-line distance to the start proves nothing).
    const shown = decodePolyline(view.polyline)
    expect(shown).toHaveLength(view.pointCount)
    const nearest = (d: number) =>
      fixes.reduce((a, f) => (Math.abs(f.distanceM - d) < Math.abs(a.distanceM - d) ? f : a))
    const first = nearest(200)
    const end = nearest(total - 200)
    expect(haversineM(first.lat, first.lng, shown[0]![0], shown[0]![1])).toBeLessThan(8)
    const tail = shown[shown.length - 1]!
    expect(haversineM(end.lat, end.lng, tail[0], tail[1])).toBeLessThan(8)
    // Inside the bounding box.
    for (const [lat, lng] of shown) {
      expect(lat).toBeGreaterThanOrEqual(view.bbox.minLat - 1e-9)
      expect(lng).toBeLessThanOrEqual(view.bbox.maxLng + 1e-9)
    }
  })

  test('returns the whole track when the setting is off', async () => {
    const id = await importRun(user.id)
    await client(ctx, user).put('/api/settings').send({ hideMapEnds: false }).expect(200)
    const view = (await get(user, id)).body as ActivityTrackView
    expect(view.endsHiddenM).toBe(0)
    expect(view.distM[0]).toBe(0)
    const stored = await ctx.prisma.activityTrack.findUniqueOrThrow({ where: { activityId: id } })
    expect(view.polyline).toBe(stored.polyline)
  })

  test('404 when hiding the ends would leave nothing', async () => {
    const id = await importRun(user.id, 90) // about 300 m
    expect((await get(user, id)).status).toBe(404)
    await client(ctx, user).put('/api/settings').send({ hideMapEnds: false }).expect(200)
    expect((await get(user, id)).status).toBe(200)
  })

  test('the setting reads back and defaults on', async () => {
    const res = await client(ctx, user).get('/api/settings')
    expect((res.body as { hideMapEnds: boolean }).hideMapEnds).toBe(true)
    const put = await client(ctx, user).put('/api/settings').send({ hideMapEnds: false })
    expect((put.body as { hideMapEnds: boolean }).hideMapEnds).toBe(false)
    await client(ctx, user).put('/api/settings').send({ hideMapEnds: 'no' }).expect(400)
  })
})
