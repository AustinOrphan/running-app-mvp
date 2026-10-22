import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { ImportBatch, ParsedActivity } from '../../shared/types.ts'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

const START = Date.UTC(2026, 0, 5, 7, 0, 0) / 1000
const GPX = readFileSync(new URL('../fixtures/files/run-with-hr.gpx', import.meta.url))

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.importedFile.deleteMany()
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importBatch.deleteMany()
  await ctx.prisma.wellnessDay.deleteMany()
})

type Body = ImportBatch & { error: { code: string } }

function fitBytes(startUnix = START, serial = 42): Uint8Array {
  return buildFit({
    serial,
    timeCreatedUnix: startUnix,
    sessions: [
      {
        sport: 1,
        startUnix,
        durationSec: 300,
        distanceM: 900,
        records: Array.from({ length: 300 }, (_, t) => ({
          t,
          distanceM: 3 * t,
          speedMps: 3,
          hr: 140,
          altitudeM: 10,
        })),
      },
    ],
  })
}

const b64 = (bytes: Uint8Array | Buffer) => Buffer.from(bytes).toString('base64')

async function postFiles(
  files: Array<{ name: string; dataBase64: string }>,
  extra: Record<string, unknown> = {},
  as: TestUser = user,
) {
  const res = await client(ctx, as)
    .post('/api/imports/files')
    .send({ files, ...extra })
  return { status: res.status, body: res.body as Body }
}

describe('POST /api/imports/files', () => {
  test('imports a FIT and a GPX into one batch with source file', async () => {
    const { status, body } = await postFiles([
      { name: 'morning.fit', dataBase64: b64(fitBytes()) },
      { name: 'evening.gpx', dataBase64: b64(GPX) },
    ])
    expect(status).toBe(201)
    expect(body).toMatchObject({
      source: 'file',
      rowCount: 2,
      accepted: 2,
      skippedDuplicate: 0,
      skippedInvalid: 0,
      errors: [],
    })
    const rows = await ctx.prisma.activity.findMany({ where: { userId: user.id } })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.importBatchId === body.id && row.source === 'file')).toBe(true)
    expect(await ctx.prisma.activityFile.count()).toBe(2)
    expect(await ctx.prisma.importBatch.count()).toBe(1)
  })

  test('an unsupported or unreadable file is a per-file error that names the file', async () => {
    const { status, body } = await postFiles([
      { name: 'notes.txt', dataBase64: b64(Buffer.from('hello')) },
      { name: 'broken.fit', dataBase64: b64(fitBytes().slice(0, 40)) },
      { name: 'good.fit', dataBase64: b64(fitBytes()) },
    ])
    expect(status).toBe(201)
    expect(body.accepted).toBe(1)
    expect(body.skippedInvalid).toBe(2)
    expect(body.rowCount).toBe(3)
    expect(body.errors).toHaveLength(2)
    expect(body.errors[0]?.reason).toContain('notes.txt')
    expect(body.errors[1]?.reason).toContain('broken.fit')
    expect(await ctx.prisma.activity.count()).toBe(1)
  })

  test('the same bytes twice are a skipped duplicate', async () => {
    const file = { name: 'a.fit', dataBase64: b64(fitBytes()) }
    await postFiles([file])
    const { body } = await postFiles([file])
    expect(body).toMatchObject({ accepted: 0, skippedDuplicate: 1, rowCount: 1 })
    expect(body.errors[0]?.reason).toContain('a.fit')
    expect(await ctx.prisma.activity.count()).toBe(1)
  })

  test('a path in the file name is cut to its last segment', async () => {
    await postFiles([{ name: 'C:\\runs\\2026\\a.fit', dataBase64: b64(fitBytes()) }])
    const file = await ctx.prisma.activityFile.findFirstOrThrow()
    expect(file.fileName).toBe('a.fit')
  })

  test('batchId appends to a batch of the same user under an hour old', async () => {
    const first = await postFiles([{ name: 'a.fit', dataBase64: b64(fitBytes()) }])
    const second = await postFiles(
      [{ name: 'b.fit', dataBase64: b64(fitBytes(START + 86_400, 43)) }],
      { batchId: first.body.id },
    )
    expect(second.status).toBe(201)
    expect(second.body.id).toBe(first.body.id)
    expect(second.body).toMatchObject({ rowCount: 2, accepted: 2 })
    expect(await ctx.prisma.importBatch.count()).toBe(1)
  })

  test('batchId of another user, an old batch or a non-file batch is 404', async () => {
    const mine = await postFiles([{ name: 'a.fit', dataBase64: b64(fitBytes()) }])
    const file = [{ name: 'b.fit', dataBase64: b64(fitBytes(START + 86_400, 43)) }]
    expect((await postFiles(file, { batchId: mine.body.id }, other)).status).toBe(404)

    await ctx.prisma.importBatch.update({
      where: { id: mine.body.id },
      data: { createdAt: new Date(Date.now() - 2 * 3_600_000) },
    })
    expect((await postFiles(file, { batchId: mine.body.id })).status).toBe(404)

    const csv = await ctx.prisma.importBatch.create({
      data: {
        userId: user.id,
        source: 'csv',
        rowCount: 0,
        accepted: 0,
        skippedDuplicate: 0,
        skippedInvalid: 0,
        errors: '[]',
      },
    })
    expect((await postFiles(file, { batchId: csv.id })).status).toBe(404)
  })

  test('more than 20 files or none is a validation error', async () => {
    const file = { name: 'a.fit', dataBase64: b64(fitBytes()) }
    expect((await postFiles(Array.from({ length: 21 }, () => file))).status).toBe(400)
    expect((await postFiles([])).status).toBe(400)
  })

  test('requires a session', async () => {
    const res = await client(ctx).post('/api/imports/files').send({ files: [] })
    expect(res.status).toBe(401)
  })
})

function parsed(overrides: Partial<ParsedActivity> = {}): ParsedActivity {
  return {
    providerKey: 'ah:one',
    startUtc: '2026-01-05T07:00:00Z',
    utcOffsetMin: 0,
    type: 'run',
    subtype: null,
    elapsedSec: 1800,
    movingSec: 1790,
    distanceM: 5000,
    elevationGainM: 20,
    elevationLossM: 18,
    avgHr: 140,
    maxHr: 170,
    avgCadence: 160,
    avgPowerW: null,
    deviceName: null,
    startLat: 0.001,
    startLng: 0.001,
    samples: {
      t: [0, 1, 2, 3],
      d: [0, 3, 6, 9],
      hr: [120, 130, 140, 150],
      alt: null,
      cad: null,
      pwr: null,
    },
    laps: [],
    ...overrides,
  }
}

const wellness = (date: string, restingHr: number | null) => ({
  date,
  restingHr,
  hrvRmssd: null,
  hrvSdnn: null,
  sleepSec: null,
  sleepScore: null,
  weightKg: null,
  vo2max: null,
})

async function postParsed(body: Record<string, unknown>, as: TestUser = user) {
  const res = await client(ctx, as).post('/api/imports/parsed').send(body)
  return { status: res.status, body: res.body as Body }
}

describe('POST /api/imports/parsed', () => {
  test('stores activities and wellness under the given registry source', async () => {
    const { status, body } = await postParsed({
      source: 'apple-health',
      activities: [parsed(), parsed({ providerKey: 'ah:two', startUtc: '2026-01-06T07:00:00Z' })],
      wellness: [wellness('2026-01-05', 52), wellness('2026-01-06', null)],
    })
    expect(status).toBe(201)
    expect(body).toMatchObject({ source: 'apple-health', rowCount: 4, accepted: 3 })
    expect(body.skippedDuplicate + body.skippedInvalid).toBe(1)
    const rows = await ctx.prisma.activity.findMany({ where: { userId: user.id } })
    expect(rows.map((row) => row.source)).toEqual(['apple-health', 'apple-health'])
    expect(rows[0]?.startLat).toBe(0)
    const day = await ctx.prisma.wellnessDay.findFirstOrThrow({ where: { userId: user.id } })
    expect(day).toMatchObject({ date: '2026-01-05', restingHr: 52, source: 'apple-health' })
  })

  test('sending the same activity again never makes a second row', async () => {
    const body = { source: 'apple-health', activities: [parsed()], wellness: [] }
    await postParsed(body)
    const again = await postParsed(body)
    expect(again.status).toBe(201)
    expect(await ctx.prisma.activity.count()).toBe(1)
  })

  test('an unknown source is a validation error', async () => {
    const { status } = await postParsed({ source: 'nope', activities: [parsed()], wellness: [] })
    expect(status).toBe(400)
  })

  test('misaligned sample arrays are rejected', async () => {
    const bad = parsed({
      samples: { t: [0, 1, 2], d: null, hr: [120, 130], alt: null, cad: null, pwr: null },
    })
    const { status, body } = await postParsed({
      source: 'apple-health',
      activities: [bad],
      wellness: [],
    })
    expect(status).toBe(400)
    expect(body.error.code).toBe('validation')
    expect(await ctx.prisma.activity.count()).toBe(0)
  })

  test('more than 100 000 samples is rejected', async () => {
    const t = Array.from({ length: 100_001 }, (_, i) => i)
    const bad = parsed({ samples: { t, d: null, hr: null, alt: null, cad: null, pwr: null } })
    const { status } = await postParsed({ source: 'apple-health', activities: [bad], wellness: [] })
    expect(status).toBe(400)
  })

  test('an invalid start instant or unknown field is rejected', async () => {
    const res1 = await postParsed({
      source: 'apple-health',
      activities: [parsed({ startUtc: 'yesterday' })],
      wellness: [],
    })
    expect(res1.status).toBe(400)
    const res2 = await postParsed({
      source: 'apple-health',
      activities: [{ ...parsed(), surprise: 1 }],
      wellness: [],
    })
    expect(res2.status).toBe(400)
  })

  test('batchId appends when the source matches', async () => {
    const first = await postParsed({ source: 'apple-health', activities: [parsed()], wellness: [] })
    const second = await postParsed({
      batchId: first.body.id,
      source: 'apple-health',
      activities: [parsed({ providerKey: 'ah:two', startUtc: '2026-01-07T07:00:00Z' })],
      wellness: [],
    })
    expect(second.body.id).toBe(first.body.id)
    expect(second.body.rowCount).toBe(2)
    const mismatch = await postParsed({
      batchId: first.body.id,
      source: 'intervals',
      activities: [],
      wellness: [],
    })
    expect(mismatch.status).toBe(404)
  })
})
