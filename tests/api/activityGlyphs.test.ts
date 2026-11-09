import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { storeParsed } from '../../server/services/activityStore.ts'
import { ACTIVITY_GLYPH_IDS_MAX } from '../../shared/limits.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import type { ActivityGlyphs } from '../../shared/types.ts'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { syntheticRun } from '../fixtures/syntheticRoute.ts'
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
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'glyph-other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importedFile.deleteMany()
  await ctx.prisma.user.updateMany({ data: { hideMapEnds: true } })
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

const fixes = syntheticRun(1800)

async function importRun(userId: string, seconds = 1800, day = 5): Promise<string> {
  const part = fixes.slice(0, seconds)
  const bytes = buildFit({
    sessions: [
      {
        sport: 1,
        startUnix: Date.UTC(2026, 0, day, 7) / 1000,
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

const get = (u: TestUser | undefined, ids: string) =>
  client(ctx, u).get(`/api/activities/glyphs?ids=${ids}`)

describe('GET /api/activities/glyphs', () => {
  test('needs a session', async () => {
    const id = await importRun(user.id)
    expect((await get(undefined, id)).status).toBe(401)
  })

  test('answers a glyph for each run with a track, in one read, and none for the rest', async () => {
    const a = await importRun(user.id)
    const b = await importRun(user.id, 1500, 6)
    const bare = await ctx.prisma.activity.create({
      data: { userId: user.id, type: 'run', date: '2026-01-05', durationSec: 600 },
    })
    const res = await get(user, [a, b, bare.id, 'nope'].join(','))
    expect(res.status).toBe(200)
    const body = res.body as ActivityGlyphs
    expect(Object.keys(body.glyphs).sort()).toEqual([a, b].sort())
    expect(body.glyphs[a]!.d).toMatch(/^M[-\d. ]+(L[-\d. ]+)+$/)
  })

  test('only the runner’s own rows: another runner’s id is absent', async () => {
    const mine = await importRun(user.id)
    const theirs = await importRun(other.id)
    const res = await get(user, `${mine},${theirs}`)
    expect(Object.keys((res.body as ActivityGlyphs).glyphs)).toEqual([mine])
  })

  test('builds from the trimmed track: hiding the ends changes the drawing', async () => {
    const id = await importRun(user.id)
    const hidden = ((await get(user, id)).body as ActivityGlyphs).glyphs[id]!.d
    await ctx.prisma.user.update({ where: { id: user.id }, data: { hideMapEnds: false } })
    const shown = ((await get(user, id)).body as ActivityGlyphs).glyphs[id]!.d
    expect(shown).not.toBe(hidden)
  })

  test('a run too short once the ends are hidden has no glyph; with the ends shown it has', async () => {
    const id = await importRun(user.id, 60)
    expect(((await get(user, id)).body as ActivityGlyphs).glyphs[id]).toBeUndefined()
    await ctx.prisma.user.update({ where: { id: user.id }, data: { hideMapEnds: false } })
    expect(((await get(user, id)).body as ActivityGlyphs).glyphs[id]).toBeDefined()
  })

  test('validates the ids: required, capped, and a repeated id counts once', async () => {
    expect((await client(ctx, user).get('/api/activities/glyphs')).status).toBe(400)
    expect((await get(user, '')).status).toBe(400)
    const many = Array.from({ length: ACTIVITY_GLYPH_IDS_MAX + 1 }, (_, i) => `id-${String(i)}`)
    expect((await get(user, many.join(','))).status).toBe(400)
    expect((await get(user, many.slice(0, ACTIVITY_GLYPH_IDS_MAX).join(','))).status).toBe(200)
    const id = await importRun(user.id)
    const repeated = Array.from({ length: ACTIVITY_GLYPH_IDS_MAX + 5 }, () => id).join(',')
    expect((await get(user, repeated)).status).toBe(200)
    expect((await get(user, 'x'.repeat(65))).status).toBe(400)
  })
})
