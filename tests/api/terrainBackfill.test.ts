import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { storeParsedToday as storeParsed } from './helpers.ts'
import { runStartPass } from '../../server/services/startPass.ts'
import {
  backfillTerrainBins,
  TERRAIN_BACKFILL_BATCH,
} from '../../server/services/terrainBackfill.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import { computeTerrainBins, terrainShapePrefix } from '../../shared/importers/files/terrainBins.ts'
import type { TerrainBins } from '../../shared/types.ts'
import { COURSE, courseFit } from '../fixtures/fit/terrainCourse.ts'
import { createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'terrain-other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importedFile.deleteMany()
  await ctx.prisma.syncRun.deleteMany({ where: { provider: 'terrain' } })
})

const deps = () => ({ prisma: ctx.prisma, config: ctx.config })

/** Imports a course run and blanks its bins, as a run imported before the column existed. */
async function importOld(userId: string, serial: number, day: number) {
  const name = `run-${serial}.fit`
  const bytes = courseFit(COURSE, { serial, startUnix: Date.UTC(2026, 0, day, 7) / 1000 })
  const [parsed] = parseActivityFile(name, bytes, { timezone: 'UTC' })
  const { activityId } = await storeParsed(deps(), userId, parsed!, {
    source: 'file',
    importBatchId: null,
    channel: 'upload',
    file: { name, format: 'fit', bytes },
  })
  const before = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })
  await ctx.prisma.activity.update({ where: { id: activityId }, data: { terrainBins: null } })
  return { id: activityId, importedBins: before.terrainBins! }
}

const binsOf = async (id: string) =>
  (await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })).terrainBins

describe('backfillTerrainBins', () => {
  test('fills the stored value the import would have written, from the stored stream', async () => {
    const a = await importOld(user.id, 1, 5)
    expect(await binsOf(a.id)).toBeNull()
    const result = await backfillTerrainBins(deps(), user.id)
    expect(result).toEqual({ filled: 1, unreadable: [], remaining: 0 })
    expect(await binsOf(a.id)).toBe(a.importedBins)
  })

  test('works in small batches, newest first, and resumes where it stopped', async () => {
    const runs = [
      await importOld(user.id, 1, 5),
      await importOld(user.id, 2, 6),
      await importOld(user.id, 3, 7),
    ]
    const first = await backfillTerrainBins(deps(), user.id, { limit: 2 })
    expect(first).toMatchObject({ filled: 2, remaining: 1 })
    expect(await binsOf(runs[2]!.id)).not.toBeNull()
    expect(await binsOf(runs[1]!.id)).not.toBeNull()
    expect(await binsOf(runs[0]!.id)).toBeNull()
    const second = await backfillTerrainBins(deps(), user.id, { limit: 2 })
    expect(second).toMatchObject({ filled: 1, remaining: 0 })
    expect(await backfillTerrainBins(deps(), user.id)).toEqual({
      filled: 0,
      unreadable: [],
      remaining: 0,
    })
  })

  test('leaves other users, non-runs and runs without a stream alone', async () => {
    const mine = await importOld(user.id, 1, 5)
    const theirs = await importOld(other.id, 2, 6)
    const noStream = await ctx.prisma.activity.create({
      data: { userId: user.id, type: 'run', date: '2026-01-08', durationSec: 1800, source: 'csv' },
    })
    const lift = await ctx.prisma.activity.create({
      data: { userId: user.id, type: 'strength', date: '2026-01-09', durationSec: 1800 },
    })
    await ctx.prisma.activityStream.create({
      data: { activityId: lift.id, sampleSec: 10, data: '{}' },
    })
    expect(await backfillTerrainBins(deps(), user.id)).toMatchObject({ filled: 1, remaining: 0 })
    expect(await binsOf(mine.id)).not.toBeNull()
    expect(await binsOf(theirs.id)).toBeNull()
    expect(await binsOf(noStream.id)).toBeNull()
    expect(await binsOf(lift.id)).toBeNull()
  })

  test('does not overwrite current-shape bins an import wrote in the meantime', async () => {
    const run = await importOld(user.id, 1, 5)
    const current = `${terrainShapePrefix()}"sec":[1],"m":[1],"walkSec":[1],"flatCv":null}`
    await ctx.prisma.activity.update({ where: { id: run.id }, data: { terrainBins: current } })
    expect(await backfillTerrainBins(deps(), user.id)).toMatchObject({ filled: 0, remaining: 0 })
    expect(await binsOf(run.id)).toBe(current)
  })

  test.each([
    ['version', (bins: TerrainBins) => ({ ...bins, v: bins.v + 1 })],
    ['walking floor', (bins: TerrainBins) => ({ ...bins, walkMps: bins.walkMps + 0.5 })],
    ['edges', (bins: TerrainBins) => ({ ...bins, edgesPct: bins.edgesPct.map((e) => e + 1) })],
    ['window', (bins: TerrainBins) => ({ ...bins, windowM: bins.windowM + 5 })],
  ])('computes bins of another %s again, to the import value', async (_name, change) => {
    const run = await importOld(user.id, 1, 5)
    const old = change(JSON.parse(run.importedBins) as TerrainBins)
    await ctx.prisma.activity.update({
      where: { id: run.id },
      data: { terrainBins: JSON.stringify(old) },
    })
    expect(await backfillTerrainBins(deps(), user.id)).toMatchObject({ filled: 1, remaining: 0 })
    expect(await binsOf(run.id)).toBe(run.importedBins)
  })

  test('the shape prefix starts what the writer stores, empty bins and real ones', async () => {
    const run = await importOld(user.id, 1, 5)
    expect(run.importedBins.startsWith(terrainShapePrefix())).toBe(true)
    const flat = computeTerrainBins(
      { t: [], d: null, hr: null, alt: null, cad: null, pwr: null },
      10,
    )
    expect(JSON.stringify(flat).startsWith(terrainShapePrefix())).toBe(true)
  })

  test('the ids option fills only the named rows', async () => {
    const a = await importOld(user.id, 1, 5)
    const b = await importOld(user.id, 2, 6)
    expect(await backfillTerrainBins(deps(), user.id, { ids: [a.id] })).toMatchObject({
      filled: 1,
      remaining: 0,
    })
    expect(await binsOf(a.id)).toBe(a.importedBins)
    expect(await binsOf(b.id)).toBeNull()
  })

  test('an unreadable stream gets all-zero bins, is reported and is not met again', async () => {
    const run = await importOld(user.id, 1, 5)
    await ctx.prisma.activityStream.update({
      where: { activityId: run.id },
      data: { data: 'not json' },
    })
    const result = await backfillTerrainBins(deps(), user.id)
    expect(result).toEqual({ filled: 1, unreadable: [run.id], remaining: 0 })
    expect((JSON.parse((await binsOf(run.id))!) as TerrainBins).sec.every((v) => v === 0)).toBe(
      true,
    )
  })

  test('reads the stored stream only: no network and no file read', async () => {
    const run = await importOld(user.id, 1, 5)
    await ctx.prisma.activityFile.delete({ where: { activityId: run.id } })
    await backfillTerrainBins(deps(), user.id)
    expect(await binsOf(run.id)).toBe(run.importedBins)
  })
})

describe('the terrain start pass', () => {
  const runs = (userId: string) =>
    ctx.prisma.syncRun.findMany({
      where: { userId, channel: 'job', provider: 'terrain' },
      orderBy: { startedAt: 'asc' },
    })
  const pass = () =>
    runStartPass(deps(), 'terrain', (userId) => () => backfillTerrainBins(deps(), userId))

  test('fills runs past one batch in one pass and records one catchup run, then nothing', async () => {
    for (let i = 0; i < TERRAIN_BACKFILL_BATCH + 5; i++)
      await importOld(user.id, i + 1, 1 + (i % 28))
    await pass()
    const [run, ...rest] = await runs(user.id)
    expect(rest).toEqual([])
    expect(run).toMatchObject({
      status: 'ok',
      trigger: 'catchup',
      accepted: TERRAIN_BACKFILL_BATCH + 5,
      failed: 0,
    })
    expect(await backfillTerrainBins(deps(), user.id)).toMatchObject({ filled: 0, remaining: 0 })

    await pass()
    // The second pass finds nothing: it stores no new run for the user it filled.
    expect(await runs(user.id)).toHaveLength(1)
  })

  test('recomputes bins of another walking floor, once', async () => {
    const run = await importOld(user.id, 1, 5)
    const old = { ...(JSON.parse(run.importedBins) as TerrainBins), walkMps: 9 }
    await ctx.prisma.activity.update({
      where: { id: run.id },
      data: { terrainBins: JSON.stringify(old) },
    })
    await pass()
    expect(await binsOf(run.id)).toBe(run.importedBins)
    expect((await runs(user.id))[0]).toMatchObject({ trigger: 'catchup', accepted: 1 })
  })

  test('a pass that meets an unreadable stream is a partial run', async () => {
    const run = await importOld(user.id, 1, 5)
    await ctx.prisma.activityStream.update({
      where: { activityId: run.id },
      data: { data: '[' },
    })
    await pass()
    const [recorded] = await runs(user.id)
    expect(recorded).toMatchObject({ status: 'partial', accepted: 1, failed: 1 })
  })
})

describe('terrain bins follow the stored type', () => {
  /** A course run parsed from a FIT file, with the type the provider reports. */
  function parsedAs(type: 'run' | 'cross') {
    const bytes = courseFit(COURSE, { serial: 7, startUnix: Date.UTC(2026, 0, 12, 7) / 1000 })
    const [parsed] = parseActivityFile('run-7.fit', bytes, { timezone: 'UTC' })
    return { ...parsed!, type }
  }
  const store = (parsed: ReturnType<typeof parsedAs>) =>
    storeParsed(deps(), user.id, parsed, { source: 'file', importBatchId: null, channel: 'upload' })

  test('a run the runner re-typed from cross keeps its bins when the provider still says cross', async () => {
    const { activityId } = await store(parsedAs('cross'))
    expect(await binsOf(activityId)).toBeNull()
    await ctx.prisma.activity.update({ where: { id: activityId }, data: { type: 'run' } })
    await store(parsedAs('cross'))
    expect(await binsOf(activityId)).not.toBeNull()
  })

  test('a run the runner re-typed to cross gets no bins from a re-import that says run', async () => {
    const { activityId } = await store(parsedAs('run'))
    expect(await binsOf(activityId)).not.toBeNull()
    await ctx.prisma.activity.update({ where: { id: activityId }, data: { type: 'cross' } })
    await store(parsedAs('run'))
    expect(await binsOf(activityId)).toBeNull()
  })
})
