import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runHrQualityJob } from '../../server/jobs/scheduler.ts'
import { storeParsed } from '../../server/services/activityStore.ts'
import { backfillHrQuality } from '../../server/services/hrQualityBackfill.ts'
import { hrQualityPasses } from '../../shared/engine/hrQuality.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import type { HrQuality } from '../../shared/types.ts'
import { buildFit, type FitRecordInput } from '../fixtures/fit/buildFit.ts'
import { createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'hrq-other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importedFile.deleteMany()
  await ctx.prisma.syncRun.deleteMany({ where: { provider: 'hr-quality' } })
})

const deps = () => ({ prisma: ctx.prisma, config: ctx.config })

/** A 40-minute run, a record every 10 s over gentle rolling ground, with a steady heart rate. */
function runFit(serial: number, day: number, strap: boolean): Uint8Array {
  const records: FitRecordInput[] = []
  for (let i = 0; i <= 240; i++) {
    records.push({
      t: i * 10,
      distanceM: i * 30,
      speedMps: 3,
      hr: 150 + ((i * 7) % 5),
      cadence: 86,
      altitudeM: 100 + 6 * Math.sin((i * 30 * 2 * Math.PI) / 300),
    })
  }
  return buildFit({
    serial,
    productName: 'Example Watch 100',
    deviceInfos: strap ? [{ deviceIndex: 1, deviceType: 120, sourceType: 1 }] : [],
    sessions: [
      {
        sport: 1,
        startUnix: Date.UTC(2026, 0, day, 7) / 1000,
        durationSec: 2400,
        distanceM: 7200,
        records,
      },
    ],
  })
}

/** Imports a run and blanks its summary, as a run imported before the column existed. */
async function importOld(userId: string, serial: number, day: number, strap = false) {
  const name = `run-${serial}.fit`
  const bytes = runFit(serial, day, strap)
  const [parsed] = parseActivityFile(name, bytes, { timezone: 'UTC' })
  const { activityId } = await storeParsed(deps(), userId, parsed!, {
    source: 'file',
    importBatchId: null,
    channel: 'upload',
    file: { name, format: 'fit', bytes },
  })
  const before = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })
  await ctx.prisma.activity.update({ where: { id: activityId }, data: { hrQuality: null } })
  return { id: activityId, imported: before.hrQuality! }
}

const qualityOf = async (id: string) =>
  (await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })).hrQuality

describe('the import', () => {
  test('stores the quality with the source the file lists', async () => {
    const wrist = await importOld(user.id, 1, 5)
    const strap = await importOld(user.id, 2, 6, true)
    const w = JSON.parse(wrist.imported) as HrQuality
    const s = JSON.parse(strap.imported) as HrQuality
    expect(w.source).toBe('wrist')
    expect(s.source).toBe('strap')
    expect(w.movingSec).toBeGreaterThan(2300)
    expect(w.cleanSec).toBe(w.movingSec)
    expect(w.halves).not.toBeNull()
    expect(w.gapDecouplingPct).not.toBeNull()
    expect(hrQualityPasses(w)).toBe(true)
  })
})

describe('backfillHrQuality', () => {
  test('fills the stored value the import would have written, source included, from the stream and the original file', async () => {
    const a = await importOld(user.id, 1, 5, true)
    expect(await qualityOf(a.id)).toBeNull()
    const result = await backfillHrQuality(deps(), user.id)
    expect(result).toEqual({ filled: 1, unreadable: [], remaining: 0 })
    expect(await qualityOf(a.id)).toBe(a.imported)
    expect((JSON.parse(a.imported) as HrQuality).source).toBe('strap')
  })

  test('without the original file the source is unknown', async () => {
    const run = await importOld(user.id, 1, 5, true)
    await ctx.prisma.activityFile.delete({ where: { activityId: run.id } })
    await backfillHrQuality(deps(), user.id)
    expect((JSON.parse((await qualityOf(run.id))!) as HrQuality).source).toBe('unknown')
  })

  test('works in small batches, newest first, and resumes where it stopped', async () => {
    const runs = [
      await importOld(user.id, 1, 5),
      await importOld(user.id, 2, 6),
      await importOld(user.id, 3, 7),
    ]
    const first = await backfillHrQuality(deps(), user.id, { limit: 2 })
    expect(first).toMatchObject({ filled: 2, remaining: 1 })
    expect(await qualityOf(runs[2]!.id)).not.toBeNull()
    expect(await qualityOf(runs[1]!.id)).not.toBeNull()
    expect(await qualityOf(runs[0]!.id)).toBeNull()
    expect(await backfillHrQuality(deps(), user.id, { limit: 2 })).toMatchObject({
      filled: 1,
      remaining: 0,
    })
    expect(await backfillHrQuality(deps(), user.id)).toEqual({
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
    expect(await backfillHrQuality(deps(), user.id)).toMatchObject({ filled: 1, remaining: 0 })
    expect(await qualityOf(mine.id)).not.toBeNull()
    expect(await qualityOf(theirs.id)).toBeNull()
    expect(await qualityOf(noStream.id)).toBeNull()
  })

  test('does not overwrite a summary an import wrote in the meantime', async () => {
    const run = await importOld(user.id, 1, 5)
    await ctx.prisma.activity.update({ where: { id: run.id }, data: { hrQuality: '{"v":9}' } })
    expect(await backfillHrQuality(deps(), user.id)).toMatchObject({ filled: 0, remaining: 0 })
    expect(await qualityOf(run.id)).toBe('{"v":9}')
  })

  test('an unreadable stream gets an all-zero summary, is reported and is not met again', async () => {
    const run = await importOld(user.id, 1, 5)
    await ctx.prisma.activityStream.update({
      where: { activityId: run.id },
      data: { data: 'not json' },
    })
    const result = await backfillHrQuality(deps(), user.id)
    expect(result).toEqual({ filled: 1, unreadable: [run.id], remaining: 0 })
    const stored = JSON.parse((await qualityOf(run.id))!) as HrQuality
    expect(stored).toMatchObject({ movingSec: 0, cleanSec: 0 })
    expect(hrQualityPasses(stored)).toBe(false)
  })
})

describe('runHrQualityJob', () => {
  const runs = (userId: string) =>
    ctx.prisma.syncRun.findMany({
      where: { userId, channel: 'job', provider: 'hr-quality' },
      orderBy: { startedAt: 'asc' },
    })

  test('records an hr-quality run with the runs filled, then nothing once there is nothing left', async () => {
    await importOld(user.id, 1, 5)
    await importOld(user.id, 2, 6)
    await runHrQualityJob(deps())
    const [run, ...rest] = await runs(user.id)
    expect(rest).toEqual([])
    expect(run).toMatchObject({ status: 'ok', trigger: 'schedule', accepted: 2, failed: 0 })
    await runHrQualityJob(deps())
    expect(await runs(user.id)).toHaveLength(1)
  })

  test('a tick that meets an unreadable stream is a partial run', async () => {
    const run = await importOld(user.id, 1, 5)
    await ctx.prisma.activityStream.update({ where: { activityId: run.id }, data: { data: '[' } })
    await runHrQualityJob(deps())
    const [recorded] = await runs(user.id)
    expect(recorded).toMatchObject({ status: 'partial', accepted: 1, failed: 1 })
  })
})
