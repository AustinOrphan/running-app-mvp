import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runTerrainJob } from '../../server/jobs/scheduler.ts'
import { storeParsed } from '../../server/services/activityStore.ts'
import { backfillTerrainBins } from '../../server/services/terrainBackfill.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
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

  test('does not overwrite bins an import wrote in the meantime', async () => {
    const run = await importOld(user.id, 1, 5)
    await ctx.prisma.activity.update({ where: { id: run.id }, data: { terrainBins: '{"v":9}' } })
    expect(await backfillTerrainBins(deps(), user.id)).toMatchObject({ filled: 0, remaining: 0 })
    expect(await binsOf(run.id)).toBe('{"v":9}')
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

describe('runTerrainJob', () => {
  const runs = (userId: string) =>
    ctx.prisma.syncRun.findMany({
      where: { userId, channel: 'job', provider: 'terrain' },
      orderBy: { startedAt: 'asc' },
    })

  test('records a terrain run with the runs filled, then nothing once there is nothing left', async () => {
    await importOld(user.id, 1, 5)
    await importOld(user.id, 2, 6)
    await runTerrainJob(deps())
    const [run, ...rest] = await runs(user.id)
    expect(rest).toEqual([])
    expect(run).toMatchObject({ status: 'ok', trigger: 'schedule', accepted: 2, failed: 0 })

    await runTerrainJob(deps())
    expect(await runs(user.id)).toHaveLength(1)
    // A user with nothing to fill gets one idle run the first time, so the log shows the job ran.
    expect(await runs(other.id)).toHaveLength(1)
  })

  test('a tick that meets an unreadable stream is a partial run', async () => {
    const run = await importOld(user.id, 1, 5)
    await ctx.prisma.activityStream.update({
      where: { activityId: run.id },
      data: { data: '[' },
    })
    await runTerrainJob(deps())
    const [recorded] = await runs(user.id)
    expect(recorded).toMatchObject({ status: 'partial', accepted: 1, failed: 1 })
  })
})
