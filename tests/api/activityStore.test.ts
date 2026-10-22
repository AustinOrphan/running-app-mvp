import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { storeParsed, storeWellness } from '../../server/services/activityStore.ts'
import type { ParsedActivity } from '../../shared/types.ts'
import { createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// The real summarize and localDateTime belong to the file-parser task. This stand-in keeps the
// store tests independent of it: same shapes, simple arithmetic.
vi.mock('../../shared/importers/files/summarize.ts', () => ({
  summarize: (parsed: ParsedActivity) => ({
    movingSec: parsed.elapsedSec - 60,
    hrHistogram: parsed.samples.hr ? { start: 40, width: 1, sec: [1, 2, 3] } : null,
    decouplingPct: 1.5,
    gapDistanceM: parsed.distanceM === null ? null : parsed.distanceM + 40.4,
    stream: {
      t: parsed.samples.t.filter((_, i) => i % 10 === 0),
      d: null,
      hr: parsed.samples.hr ? parsed.samples.hr.filter((_, i) => i % 10 === 0) : null,
      alt: null,
      cad: null,
      pwr: null,
      sampleSec: 10,
    },
  }),
  localDateTime: (startUtc: string, utcOffsetMin: number | null, timezone: string) => {
    const instant = new Date(startUtc)
    if (utcOffsetMin !== null) {
      const iso = new Date(instant.getTime() + utcOffsetMin * 60_000).toISOString()
      return { date: iso.slice(0, 10), startTime: iso.slice(11, 16) }
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(instant)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      startTime: `${get('hour')}:${get('minute')}`,
    }
  },
}))

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
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importedFile.deleteMany()
  await ctx.prisma.wellnessDay.deleteMany()
  await ctx.prisma.athleteProfile.deleteMany()
})

function parsed(overrides: Partial<ParsedActivity> = {}): ParsedActivity {
  return {
    providerKey: 'fit:1234-5678',
    startUtc: '2026-03-02T07:30:00.000Z',
    utcOffsetMin: 60,
    type: 'run',
    subtype: 'road',
    elapsedSec: 1800,
    movingSec: null,
    distanceM: 5000.4,
    elevationGainM: 40,
    elevationLossM: 38,
    avgHr: 150,
    maxHr: 172,
    avgCadence: 168,
    avgPowerW: null,
    deviceName: 'Test Watch',
    startLat: 0.0123,
    startLng: 0.0456,
    samples: {
      t: Array.from({ length: 30 }, (_, i) => i * 60),
      d: null,
      hr: Array.from({ length: 30 }, () => 150),
      alt: null,
      cad: null,
      pwr: null,
    },
    laps: [
      {
        startSec: 0,
        durationSec: 1800,
        distanceM: 5000,
        avgHr: 150,
        maxHr: 172,
        avgCadence: 168,
      },
    ],
    ...overrides,
  }
}

const fileBytes = new TextEncoder().encode('<gpx>synthetic</gpx>')
const upload = { source: 'file', importBatchId: null, channel: 'upload' } as const

describe('storeParsed', () => {
  test('creates the activity, stream, laps and summary fields', async () => {
    const result = await storeParsed(ctx, user.id, parsed(), upload)
    expect(result.outcome).toBe('imported')

    const row = await ctx.prisma.activity.findUniqueOrThrow({
      where: { id: result.activityId },
      include: { stream: true },
    })
    expect(row).toMatchObject({
      userId: user.id,
      source: 'file',
      providerKey: 'fit:1234-5678',
      type: 'run',
      subtype: 'road',
      date: '2026-03-02',
      startTime: '08:30',
      startUtc: '2026-03-02T07:30:00.000Z',
      utcOffsetMin: 60,
      durationSec: 1800,
      movingSec: 1740,
      distanceM: 5000,
      gapDistanceM: 5041,
      decouplingPct: 1.5,
      avgHr: 150,
      maxHr: 172,
      deviceName: 'Test Watch',
      startLat: 0.01,
      startLng: 0.05,
    })
    expect(JSON.parse(row.hrHistogram ?? 'null')).toEqual({ start: 40, width: 1, sec: [1, 2, 3] })
    expect(row.stream?.sampleSec).toBe(10)
    const data = JSON.parse(row.stream?.data ?? 'null') as { t: number[]; hr: number[] }
    expect(data.t).toHaveLength(3)
    expect(data).not.toHaveProperty('sampleSec')
    expect(JSON.parse(row.stream?.laps ?? 'null')).toHaveLength(1)
  })

  test('prefers the movingSec the parser reports', async () => {
    const { activityId } = await storeParsed(ctx, user.id, parsed({ movingSec: 1700 }), upload)
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })
    expect(row.movingSec).toBe(1700)
  })

  test('takes the local date from the profile timezone when the file has no offset', async () => {
    await ctx.prisma.athleteProfile.create({
      data: { userId: user.id, timezone: 'Pacific/Auckland' },
    })
    const { activityId } = await storeParsed(
      ctx,
      user.id,
      parsed({ utcOffsetMin: null, startUtc: '2026-03-02T20:30:00.000Z' }),
      upload,
    )
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })
    expect(row).toMatchObject({ date: '2026-03-03', startTime: '09:30' })
  })

  test('stores the file gzipped with its hash and an ImportedFile row', async () => {
    const file = { name: 'morning.gpx', format: 'gpx', bytes: fileBytes } as const
    const { activityId } = await storeParsed(ctx, user.id, parsed(), { ...upload, file })
    const sha256 = createHash('sha256').update(fileBytes).digest('hex')

    const stored = await ctx.prisma.activityFile.findUniqueOrThrow({ where: { activityId } })
    expect(stored).toMatchObject({
      format: 'gpx',
      fileName: 'morning.gpx',
      sizeBytes: fileBytes.length,
      sha256,
    })
    expect(new Uint8Array(gunzipSync(stored.gz))).toEqual(fileBytes)

    const seen = await ctx.prisma.importedFile.findMany({ where: { userId: user.id } })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      sha256,
      fileName: 'morning.gpx',
      channel: 'upload',
      outcome: 'imported',
      activityId,
    })
  })

  test('writes no file rows without a file', async () => {
    const { activityId } = await storeParsed(ctx, user.id, parsed(), upload)
    expect(await ctx.prisma.activityFile.findUnique({ where: { activityId } })).toBeNull()
    expect(await ctx.prisma.importedFile.count()).toBe(0)
  })

  test('re-storing a providerKey updates provider fields but keeps the owner fields', async () => {
    const first = await storeParsed(ctx, user.id, parsed(), upload)
    await ctx.prisma.activity.update({
      where: { id: first.activityId },
      data: { rpe: 6, feel: 1, pain: 2, notes: 'felt heavy', type: 'race' },
    })

    const second = await storeParsed(
      ctx,
      user.id,
      parsed({ elapsedSec: 1900, distanceM: 5200, avgHr: 152, type: 'run' }),
      { ...upload, source: 'strava', channel: 'provider' },
    )
    expect(second).toEqual({ outcome: 'updated', activityId: first.activityId })

    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: first.activityId } })
    expect(row).toMatchObject({
      durationSec: 1900,
      distanceM: 5200,
      avgHr: 152,
      rpe: 6,
      feel: 1,
      pain: 2,
      notes: 'felt heavy',
      type: 'race',
    })
    expect(await ctx.prisma.activity.count()).toBe(1)
    expect(await ctx.prisma.activityStream.count()).toBe(1)
  })

  test('an update replaces the stream and keeps a file the update does not carry', async () => {
    const file = { name: 'a.gpx', format: 'gpx', bytes: fileBytes } as const
    const first = await storeParsed(ctx, user.id, parsed(), { ...upload, file })
    await storeParsed(
      ctx,
      user.id,
      parsed({
        samples: { ...parsed().samples, t: Array.from({ length: 25 }, (_, i) => i), hr: null },
      }),
      { ...upload, source: 'strava', channel: 'provider' },
    )
    const stream = await ctx.prisma.activityStream.findUniqueOrThrow({
      where: { activityId: first.activityId },
    })
    expect((JSON.parse(stream.data) as { t: number[] }).t).toEqual([0, 10, 20])
    expect(await ctx.prisma.activityFile.count({ where: { activityId: first.activityId } })).toBe(1)
  })

  test('a file stored twice by bytes is a duplicate through ImportedFile', async () => {
    const file = { name: 'a.gpx', format: 'gpx', bytes: fileBytes } as const
    const first = await storeParsed(ctx, user.id, parsed(), { ...upload, file })
    const again = await storeParsed(ctx, user.id, parsed(), { ...upload, file })
    expect(again).toEqual({ outcome: 'duplicate', activityId: first.activityId })
    expect(await ctx.prisma.activity.count()).toBe(1)
    expect(await ctx.prisma.importedFile.count()).toBe(1)
  })

  test('a duplicate file does not touch the stored activity', async () => {
    const file = { name: 'a.gpx', format: 'gpx', bytes: fileBytes } as const
    const first = await storeParsed(ctx, user.id, parsed(), { ...upload, file })
    await ctx.prisma.activity.update({ where: { id: first.activityId }, data: { durationSec: 5 } })
    await storeParsed(ctx, user.id, parsed(), { ...upload, file })
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: first.activityId } })
    expect(row.durationSec).toBe(5)
  })

  test('two activities from one file both store', async () => {
    const file = { name: 'multi.fit', format: 'fit', bytes: fileBytes } as const
    const a = await storeParsed(ctx, user.id, parsed({ providerKey: 'fit:9-1#0' }), {
      ...upload,
      file,
    })
    const b = await storeParsed(
      ctx,
      user.id,
      parsed({ providerKey: 'fit:9-1#1', startUtc: '2026-03-02T09:00:00.000Z' }),
      { ...upload, file },
    )
    expect(a.outcome).toBe('imported')
    expect(b.outcome).toBe('imported')
    expect(b.activityId).not.toBe(a.activityId)
    expect(await ctx.prisma.importedFile.count()).toBe(1)
    expect(await ctx.prisma.activityFile.count()).toBe(2)
  })

  test('the same bytes import again after the activity was deleted', async () => {
    const file = { name: 'a.gpx', format: 'gpx', bytes: fileBytes } as const
    const first = await storeParsed(ctx, user.id, parsed(), { ...upload, file })
    await ctx.prisma.activity.delete({ where: { id: first.activityId } })
    const again = await storeParsed(ctx, user.id, parsed(), { ...upload, file })
    expect(again.outcome).toBe('imported')
    const seen = await ctx.prisma.importedFile.findMany()
    expect(seen).toHaveLength(1)
    expect(seen[0]?.activityId).toBe(again.activityId)
  })

  test('files with equal bytes are kept apart per user', async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    const file = { name: 'a.gpx', format: 'gpx', bytes: fileBytes } as const
    await storeParsed(ctx, user.id, parsed(), { ...upload, file })
    const theirs = await storeParsed(ctx, other.id, parsed(), { ...upload, file })
    expect(theirs.outcome).toBe('imported')
  })

  test('links the import batch and runs the duplicate pass', async () => {
    const batch = await ctx.prisma.importBatch.create({
      data: {
        userId: user.id,
        source: 'file',
        rowCount: 1,
        accepted: 1,
        skippedDuplicate: 0,
        skippedInvalid: 0,
        errors: '[]',
      },
    })
    const first = await storeParsed(ctx, user.id, parsed(), { ...upload, importBatchId: batch.id })
    const second = await storeParsed(
      ctx,
      user.id,
      parsed({ providerKey: 'strava:77', startUtc: '2026-03-02T07:30:30.000Z' }),
      { source: 'strava', importBatchId: null, channel: 'provider' },
    )
    const a = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: first.activityId } })
    const b = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: second.activityId } })
    expect(a.importBatchId).toBe(batch.id)
    expect(b.importBatchId).toBeNull()
    const flagged = [a, b].filter((row) => row.duplicateOfId !== null)
    expect(flagged).toHaveLength(1)
    expect(flagged[0]?.duplicateStatus).not.toBe('none')
  })
})

describe('storeWellness', () => {
  const empty = {
    restingHr: null,
    hrvRmssd: null,
    hrvSdnn: null,
    sleepSec: null,
    sleepScore: null,
    weightKg: null,
    vo2max: null,
  }

  test('creates rows by date and counts them', async () => {
    const n = await storeWellness(
      ctx,
      user.id,
      [
        { ...empty, date: '2026-03-01', restingHr: 48, hrvRmssd: 61.5 },
        { ...empty, date: '2026-03-02', sleepSec: 27000 },
      ],
      'intervals',
    )
    expect(n).toBe(2)
    const rows = await ctx.prisma.wellnessDay.findMany({ orderBy: { date: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ restingHr: 48, hrvRmssd: 61.5, source: 'intervals' })
    expect(rows[1]).toMatchObject({ sleepSec: 27000, restingHr: null })
  })

  test('a later sync merges fields and nulls never erase stored values', async () => {
    await storeWellness(
      ctx,
      user.id,
      [{ ...empty, date: '2026-03-01', restingHr: 48, sleepSec: 27000 }],
      'intervals',
    )
    await storeWellness(
      ctx,
      user.id,
      [{ ...empty, date: '2026-03-01', restingHr: 47, hrvRmssd: 55, sleepSec: null }],
      'apple-health',
    )
    const row = await ctx.prisma.wellnessDay.findFirstOrThrow()
    expect(row).toMatchObject({
      restingHr: 47,
      hrvRmssd: 55,
      sleepSec: 27000,
      source: 'apple-health',
    })
    expect(await ctx.prisma.wellnessDay.count()).toBe(1)
  })

  test('a manual row keeps its values and only gains the fields it lacks', async () => {
    await ctx.prisma.wellnessDay.create({
      data: {
        userId: user.id,
        date: '2026-03-01',
        restingHr: 50,
        notes: 'tired',
        source: 'manual',
      },
    })
    await storeWellness(
      ctx,
      user.id,
      [{ ...empty, date: '2026-03-01', restingHr: 44, sleepSec: 25000 }],
      'intervals',
    )
    const row = await ctx.prisma.wellnessDay.findFirstOrThrow()
    expect(row).toMatchObject({
      restingHr: 50,
      sleepSec: 25000,
      notes: 'tired',
      source: 'manual',
    })
  })

  test('rounds fractional values for the integer columns', async () => {
    await storeWellness(
      ctx,
      user.id,
      [{ ...empty, date: '2026-03-01', restingHr: 47.6, sleepSec: 27000.4, weightKg: 70.25 }],
      'apple-health',
    )
    const row = await ctx.prisma.wellnessDay.findFirstOrThrow()
    expect(row).toMatchObject({ restingHr: 48, sleepSec: 27000, weightKg: 70.25 })
  })

  test('rows with no values are not stored', async () => {
    const n = await storeWellness(ctx, user.id, [{ ...empty, date: '2026-03-01' }], 'intervals')
    expect(n).toBe(0)
    expect(await ctx.prisma.wellnessDay.count()).toBe(0)
  })
})
