import { readFileSync } from 'node:fs'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ImportBatch } from '../../shared/types.ts'
import { markDuplicates } from '../../server/services/duplicates.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

vi.mock('../../server/services/duplicates.ts')

const FIXTURE = readFileSync(new URL('../fixtures/smashrun-sample.csv', import.meta.url), 'utf8')
const HEADER = FIXTURE.split('\n')[0] ?? ''

interface SmashrunRowSpec {
  id: string
  distance: string
  startDate: string
  utc?: string
  durationMs?: string
  deleted?: boolean
}

/** One Smashrun record in the real 26-column layout. */
function smashrunRow(spec: SmashrunRowSpec): string {
  const cells = new Array<string>(26).fill('')
  cells[0] = spec.id
  cells[1] = 'Synthetic'
  cells[2] = `synthetic-key-${spec.id}`
  cells[3] = spec.distance
  cells[4] = spec.durationMs ?? '1800000'
  cells[10] = spec.startDate
  cells[11] = spec.utc ?? ''
  cells[14] = spec.deleted ? 'true' : 'false'
  return cells.join(',')
}

const smashrunFile = (...rows: SmashrunRowSpec[]) =>
  [HEADER, ...rows.map(smashrunRow)].join('\n') + '\n'

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
  vi.mocked(markDuplicates).mockClear()
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importBatch.deleteMany()
  await ctx.prisma.user.update({ where: { id: user.id }, data: { units: 'mi' } })
})

type UploadBody = ImportBatch & { error: { code: string } }

async function upload(
  kind: 'smashrun' | 'csv',
  body: Record<string, unknown>,
  as: TestUser = user,
): Promise<{ status: number; body: UploadBody }> {
  const res = await client(ctx, as).post(`/api/imports/${kind}`).send(body)
  return { status: res.status, body: res.body as UploadBody }
}

describe('POST /api/imports/smashrun', () => {
  test('imports the fixture: 201 batch with accepted 3, skippedDuplicate 0, skippedInvalid 0, rowCount 3, fileName kept', async () => {
    const res = await upload('smashrun', { fileName: 'sample.csv', text: FIXTURE })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      userId: user.id,
      source: 'smashrun',
      fileName: 'sample.csv',
      rowCount: 3,
      accepted: 3,
      skippedDuplicate: 0,
      skippedInvalid: 0,
      errors: [],
    })

    const rows = await ctx.prisma.activity.findMany({
      where: { userId: user.id },
      orderBy: { providerKey: 'asc' },
    })
    expect(rows.map((r) => r.providerKey)).toEqual([
      'smashrun:1001',
      'smashrun:1002',
      'smashrun:1003',
    ])
    expect(rows.every((r) => r.type === 'run' && r.source === 'smashrun')).toBe(true)
    expect(rows.every((r) => r.importBatchId === res.body.id)).toBe(true)
    expect(rows[0]).toMatchObject({
      date: '2026-03-02',
      startTime: '07:15',
      durationSec: 1800,
      distanceM: 4989,
      duplicateStatus: 'none',
    })
  })

  test('re-importing the same file changes nothing', async () => {
    await upload('smashrun', { fileName: 'sample.csv', text: FIXTURE })
    const again = await upload('smashrun', { fileName: 'sample.csv', text: FIXTURE })
    expect(again.status).toBe(201)
    expect(again.body).toMatchObject({ rowCount: 3, accepted: 0, skippedDuplicate: 3 })
    expect(again.body.errors).toHaveLength(3)
    for (const entry of again.body.errors) {
      expect(entry.line).toBeNull()
      expect(entry.reason).toMatch(/already imported/)
    }
    expect(await ctx.prisma.activity.count()).toBe(3)
  })

  test('invalid rows are reported and valid rows around them still import', async () => {
    const text = smashrunFile(
      { id: '2001', distance: '3', startDate: '26/03/02 7:15' },
      { id: '2002', distance: '0', startDate: '26/03/03 7:15' },
      { id: '2003', distance: '3', startDate: '26/03/04 7:15', deleted: true },
    )
    const res = await upload('smashrun', { fileName: 'bad.csv', text })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      rowCount: 3,
      accepted: 1,
      skippedDuplicate: 0,
      skippedInvalid: 2,
    })
    expect(res.body.errors.map((e) => e.line)).toEqual([3, 4])
    expect(res.body.errors[0]?.reason).toMatch(/distance/)
    expect(res.body.errors[1]?.reason).toMatch(/deleted/)
    const { accepted, skippedDuplicate, skippedInvalid, rowCount } = res.body
    expect(accepted + skippedDuplicate + skippedInvalid).toBe(rowCount)
    expect(await ctx.prisma.activity.count()).toBe(1)
  })

  test('a key repeated inside one file counts as a duplicate; the same key for another user does not', async () => {
    const text = smashrunFile(
      { id: '3001', distance: '3', startDate: '26/03/02 7:15' },
      { id: '3001', distance: '3', startDate: '26/03/02 7:15' },
    )
    const first = await upload('smashrun', { fileName: 'twice.csv', text })
    expect(first.body).toMatchObject({ rowCount: 2, accepted: 1, skippedDuplicate: 1 })
    expect(await ctx.prisma.activity.count()).toBe(1)

    const other = await seedUser(ctx, { email: 'other@example.com' })
    const second = await upload('smashrun', { fileName: 'twice.csv', text }, other)
    expect(second.body).toMatchObject({ accepted: 1, skippedDuplicate: 1 })
    expect(await ctx.prisma.activity.count({ where: { providerKey: 'smashrun:3001' } })).toBe(2)
  })

  test('distanceUnit is applied and defaults to the user units setting; a blank Start Date uses the server timezone', async () => {
    await ctx.prisma.user.update({ where: { id: user.id }, data: { units: 'km' } })
    const km = smashrunFile({ id: '4001', distance: '5', startDate: '26/03/02 7:15' })
    await upload('smashrun', { fileName: 'km.csv', text: km })
    const kmRow = await ctx.prisma.activity.findFirstOrThrow({
      where: { providerKey: 'smashrun:4001' },
    })
    expect(kmRow.distanceM).toBe(5000)

    const mi = smashrunFile({ id: '4002', distance: '5', startDate: '26/03/02 7:15' })
    await upload('smashrun', { fileName: 'mi.csv', text: mi, distanceUnit: 'mi' })
    const miRow = await ctx.prisma.activity.findFirstOrThrow({
      where: { providerKey: 'smashrun:4002' },
    })
    expect(miRow.distanceM).toBe(8047)

    const utc = smashrunFile({
      id: '4003',
      distance: '5',
      startDate: '',
      utc: '2026-03-03T02:30:00Z',
    })
    const res = await upload('smashrun', { fileName: 'utc.csv', text: utc })
    expect(res.body).toMatchObject({ accepted: 1, skippedInvalid: 0 })
    const local = new Date('2026-03-03T02:30:00Z')
    const pad = (n: number) => String(n).padStart(2, '0')
    const utcRow = await ctx.prisma.activity.findFirstOrThrow({
      where: { providerKey: 'smashrun:4003' },
    })
    expect(utcRow.date).toBe(
      `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
    )
    expect(utcRow.startTime).toBe(`${pad(local.getHours())}:${pad(local.getMinutes())}`)
  })

  test('Excel-style file: BOM, CRLF, quoted commas', async () => {
    const excel =
      '\uFEFF' +
      FIXTURE.replace('"Easy loop, flat"', '"Easy ""loop"", flat"').replace(/\n/g, '\r\n') +
      '\r\n\r\n'
    const res = await upload('smashrun', { fileName: 'excel.csv', text: excel })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ rowCount: 3, accepted: 3, skippedInvalid: 0 })
    const row = await ctx.prisma.activity.findFirstOrThrow({
      where: { providerKey: 'smashrun:1001' },
    })
    expect(row.notes).toBe('Easy "loop", flat')
    expect(row.distanceM).toBe(4989)
  })

  test('the file name is reduced to its basename and capped at 200 characters', async () => {
    const win = await upload('smashrun', { fileName: 'C:\\Users\\x\\runs.csv', text: FIXTURE })
    expect(win.body.fileName).toBe('runs.csv')
    const long = await upload('smashrun', { fileName: `${'a'.repeat(250)}.csv`, text: FIXTURE })
    expect(long.status).toBe(201)
    expect(long.body.fileName).toHaveLength(200)
  })
})

describe('POST /api/imports/csv', () => {
  const generic = [
    'date,type,minutes,miles,notes',
    '2026-03-02,run,45,5,Hill repeats',
    '2026-03-03,strength,30,,Core',
    '2026-03-04,,30,3,',
    '',
  ].join('\n')

  test('generic csv import: source csv, providerKey csv:<sha1>, re-import is idempotent, a strength row is reported not dropped', async () => {
    const res = await upload('csv', { fileName: 'log.csv', text: generic })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      source: 'csv',
      rowCount: 3,
      accepted: 2,
      skippedDuplicate: 0,
      skippedInvalid: 1,
    })
    expect(res.body.errors).toHaveLength(1)
    expect(res.body.errors[0]?.line).toBe(3)
    expect(res.body.errors[0]?.reason).toMatch(/strength/)

    const rows = await ctx.prisma.activity.findMany({ orderBy: { date: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.source === 'csv' && r.type === 'run')).toBe(true)
    expect(rows.every((r) => /^csv:[0-9a-f]{40}$/.test(r.providerKey ?? ''))).toBe(true)
    expect(rows[0]).toMatchObject({ date: '2026-03-02', durationSec: 2700, distanceM: 8047 })

    const again = await upload('csv', { fileName: 'log.csv', text: generic })
    expect(again.body).toMatchObject({ accepted: 0, skippedDuplicate: 2, skippedInvalid: 1 })
    expect(await ctx.prisma.activity.count()).toBe(2)
  })

  test('distanceUnit does not change generic csv, which is always miles', async () => {
    await upload('csv', { fileName: 'log.csv', text: generic, distanceUnit: 'km' })
    const row = await ctx.prisma.activity.findFirstOrThrow({ where: { date: '2026-03-02' } })
    expect(row.distanceM).toBe(8047)
  })
})

describe('markDuplicates hook', () => {
  test('markDuplicates is called once with the ids of the newly created rows, and not at all when nothing was accepted', async () => {
    const res = await upload('smashrun', { fileName: 'sample.csv', text: FIXTURE })
    const created = await ctx.prisma.activity.findMany({ where: { importBatchId: res.body.id } })
    expect(created).toHaveLength(3)
    expect(markDuplicates).toHaveBeenCalledTimes(1)
    const [, userId, ids] = vi.mocked(markDuplicates).mock.calls[0] ?? []
    expect(userId).toBe(user.id)
    expect([...(ids ?? [])].sort()).toEqual(created.map((r) => r.id).sort())

    vi.mocked(markDuplicates).mockClear()
    await upload('smashrun', { fileName: 'sample.csv', text: FIXTURE })
    expect(markDuplicates).not.toHaveBeenCalled()
  })
})

describe('bad uploads', () => {
  test('bad bodies are rejected with validation', async () => {
    const cases: Array<Record<string, unknown>> = [
      { fileName: 'a.csv' },
      { fileName: 'a.csv', text: '   \n\t ' },
      { text: FIXTURE },
      { fileName: '', text: FIXTURE },
      { fileName: 'a'.repeat(256), text: FIXTURE },
      { fileName: 'a.csv', text: FIXTURE, extra: true },
      { fileName: 'a.csv', text: FIXTURE, distanceUnit: 'furlong' },
    ]
    for (const body of cases) {
      for (const kind of ['smashrun', 'csv'] as const) {
        const res = await upload(kind, body)
        expect(res.status, JSON.stringify(body)).toBe(400)
        expect(res.body.error.code).toBe('validation')
      }
    }
    expect(await ctx.prisma.importBatch.count()).toBe(0)
  })

  test('a body over 10 MB is 413 validation; a 9 MB body is accepted', async () => {
    const big = await upload('csv', { fileName: 'big.csv', text: 'x'.repeat(10.5 * 1024 * 1024) })
    expect(big.status).toBe(413)
    expect(big.body.error.code).toBe('validation')

    const text = `date,type,minutes,miles,notes\n2026-03-02,run,45,5,${'n'.repeat(9 * 1024 * 1024)}\n`
    const ok = await upload('csv', { fileName: 'nine.csv', text })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ accepted: 1 })
  })

  test('more than 50 000 records is 400 and imports nothing', async () => {
    const lines = ['date,type,minutes,miles,notes']
    for (let i = 0; i < 50_001; i++) lines.push(`2026-03-02,run,${i + 1},5,`)
    const res = await upload('csv', { fileName: 'huge.csv', text: lines.join('\n') })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('validation')
    expect(await ctx.prisma.activity.count()).toBe(0)
    expect(await ctx.prisma.importBatch.count()).toBe(0)
  })

  test('unauthenticated is 401 and a missing Origin is 403', async () => {
    const anon = await client(ctx)
      .post('/api/imports/smashrun')
      .send({ fileName: 'a.csv', text: FIXTURE })
    expect(anon.status).toBe(401)
    const list = await client(ctx).get('/api/imports')
    expect(list.status).toBe(401)

    const noOrigin = await request(ctx.app)
      .post('/api/imports/smashrun')
      .set('Cookie', user.cookie)
      .send({ fileName: 'a.csv', text: FIXTURE })
    expect(noOrigin.status).toBe(403)
    expect(await ctx.prisma.activity.count()).toBe(0)
  })
})

describe('GET /api/imports', () => {
  test('lists only the caller batches, newest first', async () => {
    const other = await seedUser(ctx, { email: 'lister@example.com' })
    const base = {
      source: 'smashrun',
      rowCount: 0,
      accepted: 0,
      skippedDuplicate: 0,
      skippedInvalid: 0,
      errors: '[]',
    }
    await ctx.prisma.importBatch.create({
      data: {
        ...base,
        userId: user.id,
        fileName: 'old.csv',
        createdAt: new Date('2026-03-01T10:00:00Z'),
      },
    })
    await ctx.prisma.importBatch.create({
      data: {
        ...base,
        userId: user.id,
        fileName: 'new.csv',
        createdAt: new Date('2026-03-02T10:00:00Z'),
      },
    })
    await ctx.prisma.importBatch.create({
      data: { ...base, userId: other.id, fileName: 'theirs.csv' },
    })
    const res = await client(ctx, user).get('/api/imports')
    expect(res.status).toBe(200)
    expect((res.body as Array<{ fileName: string }>).map((b) => b.fileName)).toEqual([
      'new.csv',
      'old.csv',
    ])
    expect((res.body as ImportBatch[])[0]).toMatchObject({ errors: [], userId: user.id })
  })
})

describe('atomicity', () => {
  test('the whole batch is atomic: a database failure leaves no partial rows and no batch', async () => {
    // 501 rows span two insert chunks; the failure hits the last row, after the first chunk ran.
    const specs = Array.from({ length: 501 }, (_, i) => ({
      id: String(5000 + i),
      distance: '3',
      startDate: '26/03/02 7:15',
    }))
    await ctx.prisma.$executeRawUnsafe(
      `CREATE TRIGGER fail_activity_insert BEFORE INSERT ON "Activity" WHEN NEW."providerKey" = 'smashrun:5500' BEGIN SELECT RAISE(ABORT, 'forced failure'); END`,
    )
    try {
      const res = await upload('smashrun', { fileName: 'many.csv', text: smashrunFile(...specs) })
      expect(res.status).toBe(500)
      expect(res.body.error.code).toBe('internal')
    } finally {
      await ctx.prisma.$executeRawUnsafe('DROP TRIGGER fail_activity_insert')
    }
    expect(await ctx.prisma.activity.count()).toBe(0)
    expect(await ctx.prisma.importBatch.count()).toBe(0)
    expect(markDuplicates).not.toHaveBeenCalled()
  })
})
