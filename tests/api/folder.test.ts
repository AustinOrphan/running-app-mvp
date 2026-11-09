import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync, zipSync } from 'fflate'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { installOwnerId, isInstallOwner } from '../../server/installOwner.ts'
import { runFolderJob, startScheduler } from '../../server/jobs/scheduler.ts'
import { scanFolder, scanFolderIntegration } from '../../server/services/folder.ts'
import { sealSecret, settleBackground } from '../../server/services/sync.ts'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

const START = Date.UTC(2026, 0, 5, 7, 0, 0) / 1000

let ctx: TestCtx
let user: TestUser
let dir: string

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rl-scan-'))
  // The temporary directory is made real first: the root must not reach a symbolic link.
  dir = realpathSync(dir)
  ctx.folderRoot = dir
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importedFile.deleteMany()
  await ctx.prisma.importBatch.deleteMany()
  await ctx.prisma.integration.deleteMany()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

function deps() {
  return { prisma: ctx.prisma, config: ctx.config, folderRoot: ctx.folderRoot }
}

/** A synthetic one-session run; `offsetSec` makes each file a different activity. */
function fitBytes(offsetSec = 0): Uint8Array {
  const startUnix = START + offsetSec
  return buildFit({
    serial: 7,
    timeCreatedUnix: startUnix,
    sessions: [
      {
        sport: 1,
        startUnix,
        durationSec: 600,
        distanceM: 1800,
        records: Array.from({ length: 11 }, (_, i) => ({
          t: i * 60,
          distanceM: i * 180,
          speedMps: 3,
          hr: 140 + i,
        })),
      },
    ],
  })
}

/** Writes a file and ages it past the settle window. */
function put(name: string, bytes: Uint8Array | string): string {
  const path = join(dir, name)
  writeFileSync(path, bytes)
  const old = new Date(Date.now() - 60_000)
  utimesSync(path, old, old)
  return path
}

const GENERIC = 'The import folder is not available.'

describe('scanFolder', () => {
  test('imports a FIT file once and skips it on the next scan', async () => {
    put('morning.fit', fitBytes())
    expect(await scanFolder(deps(), user.id)).toBe(1)

    const activity = await ctx.prisma.activity.findFirstOrThrow()
    expect(activity).toMatchObject({ source: 'file', type: 'run', date: '2026-01-05' })
    expect(await ctx.prisma.activityFile.count()).toBe(1)
    const seen = await ctx.prisma.importedFile.findFirstOrThrow()
    expect(seen).toMatchObject({ channel: 'folder', outcome: 'imported', fileName: 'morning.fit' })
    const batch = await ctx.prisma.importBatch.findFirstOrThrow()
    expect(batch).toMatchObject({ source: 'folder', accepted: 1, skippedInvalid: 0 })

    expect(await scanFolder(deps(), user.id)).toBe(0)
    expect(await ctx.prisma.activity.count()).toBe(1)
    expect(await ctx.prisma.importBatch.count()).toBe(1)
  })

  test('skips a renamed or copied file with the same bytes', async () => {
    const original = put('a.fit', fitBytes())
    await scanFolder(deps(), user.id)
    copyFileSync(original, join(dir, 'copy-of-a.fit'))
    utimesSync(
      join(dir, 'copy-of-a.fit'),
      new Date(Date.now() - 60_000),
      new Date(Date.now() - 60_000),
    )
    expect(await scanFolder(deps(), user.id)).toBe(0)
    expect(await ctx.prisma.activity.count()).toBe(1)
  })

  test('opens gzip and zip files, nested folders included, and ignores other files', async () => {
    put('one.fit.gz', gzipSync(fitBytes(0)))
    mkdirSync(join(dir, 'sub'))
    put(
      'sub/two.zip',
      zipSync({ 'inner/three.fit': fitBytes(3600), 'readme.txt': new Uint8Array([1]) }),
    )
    put('notes.txt', 'not an activity')
    put('.hidden.fit', fitBytes(7200))

    expect(await scanFolder(deps(), user.id)).toBe(2)
    expect(await ctx.prisma.activity.count()).toBe(2)
    expect(await scanFolder(deps(), user.id)).toBe(0)
  })

  test('remembers an unreadable file as invalid and reports it', async () => {
    put('broken.fit', new Uint8Array([1, 2, 3, 4]))
    expect(await scanFolder(deps(), user.id)).toBe(0)

    const seen = await ctx.prisma.importedFile.findFirstOrThrow()
    expect(seen.outcome).toBe('invalid')
    const batch = await ctx.prisma.importBatch.findFirstOrThrow()
    expect(batch.skippedInvalid).toBe(1)
    expect(batch.errors).toContain('broken.fit')
    expect(await scanFolder(deps(), user.id)).toBe(0)
    expect(await ctx.prisma.importBatch.count()).toBe(1)
  })

  test('leaves a file that is still being written for the next scan', async () => {
    writeFileSync(join(dir, 'fresh.fit'), fitBytes())
    expect(await scanFolder(deps(), user.id)).toBe(0)
    expect(await ctx.prisma.importedFile.count()).toBe(0)
    expect(await scanFolder(deps(), user.id, { settleMs: 0 })).toBe(1)
  })

  test('throws for a root that is missing', async () => {
    ctx.folderRoot = join(dir, 'gone')
    await expect(scanFolder(deps(), user.id)).rejects.toThrow(GENERIC)
  })
})

describe('folder integration', () => {
  async function connectFolder(path?: string) {
    return ctx.prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'folder',
        status: 'connected',
        secret: sealSecret({}, ctx.config.sessionSecret),
        config: JSON.stringify(path === undefined ? {} : { path }),
      },
    })
  }

  test('records the outcome on the integration row', async () => {
    await connectFolder()
    put('a.fit', fitBytes())
    expect(await scanFolderIntegration(deps(), user.id)).toBe(1)
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row).toMatchObject({ status: 'connected', lastSyncStatus: 'ok', lastError: null })
    expect(row.lastSyncAt).not.toBeNull()
  })

  test('records a missing folder as an error and recovers when it returns', async () => {
    const missing = join(dir, 'later')
    ctx.folderRoot = missing
    await connectFolder()
    await runFolderJob(deps())
    let row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row).toMatchObject({ status: 'error', lastSyncStatus: 'error' })
    expect(row.lastError).toBe(GENERIC)

    mkdirSync(missing)
    await runFolderJob(deps())
    row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row).toMatchObject({ status: 'connected', lastSyncStatus: 'ok' })
  })

  test('POST /sync scans the folder in the background', async () => {
    const saved = await client(ctx, user).put('/api/integrations/folder').send({})
    expect(saved.status).toBe(200)
    put('a.fit', fitBytes())
    const res = await client(ctx, user).post('/api/integrations/folder/sync').send({})
    expect(res.status).toBe(202)
    await settleBackground()
    expect(await ctx.prisma.activity.count()).toBe(1)
  })
})

describe('startScheduler', () => {
  test('runs the folder job after its first delay and stops cleanly', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    await ctx.prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'folder',
        status: 'connected',
        secret: sealSecret({}, ctx.config.sessionSecret),
        config: '{}',
      },
    })
    put('a.fit', fitBytes())
    const never = (() => Promise.reject(new Error('no network in tests'))) as typeof fetch
    const stop = startScheduler(deps(), { fetch: never })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(await ctx.prisma.activity.count()).toBe(0)
    await vi.advanceTimersByTimeAsync(25_000)
    await vi.waitFor(async () => expect(await ctx.prisma.activity.count()).toBe(1), {
      interval: 20,
      timeout: 2_000,
    })

    stop()
    put('b.fit', fitBytes(3600))
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    expect(await ctx.prisma.activity.count()).toBe(1)
  })
})

describe('owner only (F1)', () => {
  let tester: TestUser
  const LATER = () => new Date(Date.now() + 86_400_000)

  beforeAll(async () => {
    tester = await seedUser(ctx, { email: 'tester@example.com' })
    // Later than the owner whatever the clock resolution.
    await ctx.prisma.user.update({ where: { id: tester.id }, data: { createdAt: LATER() } })
  })

  afterAll(async () => {
    await ctx.prisma.user.delete({ where: { id: tester.id } })
  })

  test('the oldest account is the owner; the id breaks a tie', async () => {
    expect(await isInstallOwner(ctx.prisma, user.id)).toBe(true)
    expect(await isInstallOwner(ctx.prisma, tester.id)).toBe(false)
    expect(await installOwnerId(ctx.prisma)).toBe(user.id)

    const stamp = new Date(Date.UTC(2020, 0, 1))
    await ctx.prisma.user.updateMany({
      where: { id: { in: [user.id, tester.id] } },
      data: { createdAt: stamp },
    })
    try {
      expect(await installOwnerId(ctx.prisma)).toBe([user.id, tester.id].sort()[0])
    } finally {
      await ctx.prisma.user.update({ where: { id: user.id }, data: { createdAt: new Date(0) } })
      await ctx.prisma.user.update({ where: { id: tester.id }, data: { createdAt: LATER() } })
    }
  })

  test("another account's PUT is a 404 and the list omits the folder", async () => {
    const put = await client(ctx, tester).put('/api/integrations/folder').send({})
    const unknown = await client(ctx, tester).put('/api/integrations/nope').send({})
    expect(put.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect((put.body as { error: { code: string } }).error.code).toBe('not_found')
    expect(await ctx.prisma.integration.count({ where: { userId: tester.id } })).toBe(0)

    for (const [method, url] of [
      ['get', '/api/integrations/folder/runs'],
      ['post', '/api/integrations/folder/sync'],
      ['delete', '/api/integrations/folder'],
    ] as const) {
      expect((await client(ctx, tester)[method](url)).status, url).toBe(404)
    }
  })

  test('an encoded spelling of the provider is refused the same way', async () => {
    for (const spelling of ['fol%64er', '%66older', '%66%6f%6c%64%65%72']) {
      const base = `/api/integrations/${spelling}`
      for (const [method, url] of [
        ['put', base],
        ['post', `${base}/sync`],
        ['get', `${base}/runs`],
        ['delete', base],
      ] as const) {
        const res = await client(ctx, tester)[method](url).send({})
        expect(res.status, `${method} ${url}`).toBe(404)
        expect((res.body as { error: { message: string } }).error.message).toBe(
          'Unknown provider: folder',
        )
      }
    }
    expect(await ctx.prisma.integration.count({ where: { userId: tester.id } })).toBe(0)
    // The owner reaches the routes by either spelling.
    const owner = await client(ctx, user).get('/api/integrations/fol%64er/runs')
    expect(owner.status).toBe(200)
  })

  test('the list omits the folder for another account', async () => {
    const list = (await client(ctx, tester).get('/api/integrations')).body as Array<{
      provider: string
    }>
    expect(list.map((item) => item.provider)).not.toContain('folder')
    const owned = (await client(ctx, user).get('/api/integrations')).body as Array<{
      provider: string
    }>
    expect(owned.map((item) => item.provider)).toContain('folder')
  })

  test("the scan skips another account's row and records nothing", async () => {
    await ctx.prisma.integration.create({
      data: {
        userId: tester.id,
        provider: 'folder',
        status: 'connected',
        secret: sealSecret({}, ctx.config.sessionSecret),
        config: '{}',
      },
    })
    put('a.fit', fitBytes())
    await runFolderJob(deps())
    expect(await scanFolderIntegration(deps(), tester.id)).toBe(0)
    expect(await ctx.prisma.activity.count()).toBe(0)
    expect(await ctx.prisma.syncRun.count({ where: { userId: tester.id } })).toBe(0)
    expect(await ctx.prisma.integration.findFirstOrThrow()).toMatchObject({
      lastSyncAt: null,
      lastSyncStatus: null,
    })
  })
})

describe('the fixed root (F1)', () => {
  const MESSAGE = 'The import folder is not available.'

  /** The message the route gives and the one the scan stores on the row, for the current root. */
  async function messages(): Promise<{ route: string; stored: string | null }> {
    const res = await client(ctx, user).put('/api/integrations/folder').send({})
    expect(res.status).toBe(400)
    await ctx.prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'folder',
        status: 'connected',
        secret: sealSecret({}, ctx.config.sessionSecret),
        config: JSON.stringify({ path: '/etc' }),
      },
    })
    await runFolderJob(deps())
    const row = await ctx.prisma.integration.findFirstOrThrow()
    return {
      route: (res.body as { error: { message: string } }).error.message,
      stored: row.lastError,
    }
  }

  test('a missing root, a file and a symbolic link all give the one message', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'rl-outside-')))
    try {
      writeFileSync(join(outside, 'secret.fit'), fitBytes())
      writeFileSync(join(dir, 'plain-file'), 'x')
      symlinkSync(outside, join(dir, 'link'))
      for (const root of [join(dir, 'missing'), join(dir, 'plain-file'), join(dir, 'link')]) {
        ctx.folderRoot = root
        await ctx.prisma.integration.deleteMany()
        expect(await messages()).toEqual({ route: MESSAGE, stored: MESSAGE })
      }
      expect(await ctx.prisma.activity.count()).toBe(0)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('a stored path is ignored: the scan reads the root', async () => {
    const other = mkdtempSync(join(tmpdir(), 'rl-other-'))
    try {
      writeFileSync(join(other, 'elsewhere.fit'), fitBytes(0))
      utimesSync(join(other, 'elsewhere.fit'), new Date(0), new Date(0))
      await ctx.prisma.integration.create({
        data: {
          userId: user.id,
          provider: 'folder',
          status: 'connected',
          secret: sealSecret({}, ctx.config.sessionSecret),
          config: JSON.stringify({ path: other }),
        },
      })
      put('here.fit', fitBytes(3600))
      expect(await scanFolderIntegration(deps(), user.id)).toBe(1)
      const names = (await ctx.prisma.importedFile.findMany()).map((file) => file.fileName)
      expect(names).toEqual(['here.fit'])
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  test('symbolic links inside the root are not followed', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'rl-outside-')))
    try {
      writeFileSync(join(outside, 'secret.fit'), fitBytes())
      utimesSync(join(outside, 'secret.fit'), new Date(0), new Date(0))
      symlinkSync(outside, join(dir, 'linked-dir'))
      symlinkSync(join(outside, 'secret.fit'), join(dir, 'linked.fit'))
      expect(await scanFolder(deps(), user.id)).toBe(0)
      expect(await ctx.prisma.importedFile.count()).toBe(0)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('bounds on unpacking and on a scan (F1)', () => {
  const ONE_MB = { maxUnpackedBytes: 1024 * 1024 }

  test('a gzip that unpacks past the cap is invalid and stores nothing', async () => {
    // 3 MB of zeros gzips to a few KB; the cap is set under that.
    put('bomb.fit.gz', gzipSync(new Uint8Array(3 * 1024 * 1024)))
    expect(await scanFolder(deps(), user.id, { limits: ONE_MB })).toBe(0)
    const seen = await ctx.prisma.importedFile.findFirstOrThrow()
    expect(seen.outcome).toBe('invalid')
    const batch = await ctx.prisma.importBatch.findFirstOrThrow()
    expect(batch).toMatchObject({ skippedInvalid: 1, accepted: 0 })
    expect(batch.errors).toContain('unpacks to more than 1 MB')
    expect(await ctx.prisma.activity.count()).toBe(0)
  })

  test('a ZIP member that unpacks past the cap invalidates the archive', async () => {
    put('bomb.zip', zipSync({ 'big.fit': new Uint8Array(3 * 1024 * 1024), 'ok.fit': fitBytes(0) }))
    expect(await scanFolder(deps(), user.id, { limits: ONE_MB })).toBe(0)
    expect((await ctx.prisma.importedFile.findFirstOrThrow()).outcome).toBe('invalid')
    expect(await ctx.prisma.activity.count()).toBe(0)
  })

  test('the bound covers nested archives together', async () => {
    // Different payloads, so that the members do not dedupe by hash: each inner file unpacks to
    // 600 KB, under the cap alone, and the two together pass it.
    const inner = (byte: number) => gzipSync(new Uint8Array(600 * 1024).fill(byte))
    put('nest.zip', zipSync({ 'a.fit.gz': inner(1), 'b.fit.gz': inner(2) }))
    expect(await scanFolder(deps(), user.id, { limits: ONE_MB })).toBe(0)
    const outer = await ctx.prisma.importedFile.findFirstOrThrow({
      where: { fileName: 'nest.zip' },
    })
    expect(outer.outcome).toBe('invalid')
    const batch = await ctx.prisma.importBatch.findFirstOrThrow()
    expect(batch.errors).toContain('nest.zip: unpacks to more than 1 MB')
    expect(await ctx.prisma.activity.count()).toBe(0)
    // The same archive passes under a cap that holds both (the test proves the cap is what stops it).
    await ctx.prisma.importedFile.deleteMany()
    expect(
      await scanFolder(deps(), user.id, { limits: { maxUnpackedBytes: 4 * 1024 * 1024 } }),
    ).toBe(0)
    expect(
      (await ctx.prisma.importedFile.findFirstOrThrow({ where: { fileName: 'nest.zip' } })).outcome,
    ).not.toBe('invalid')
  })

  test('a forged size in the ZIP headers does not lift the cap', async () => {
    const bytes = zipSync({ 'big.fit': new Uint8Array(3 * 1024 * 1024) })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    // Local header: uncompressed size at offset 22. Central directory entry: at offset 24.
    expect(view.getUint32(22, true)).toBe(3 * 1024 * 1024)
    view.setUint32(22, 100, true)
    let central = -1
    for (let at = 0; at + 4 <= bytes.length; at += 1) {
      if (view.getUint32(at, true) === 0x02014b50) central = at
    }
    expect(central).toBeGreaterThan(0)
    view.setUint32(central + 24, 100, true)
    put('forged.zip', bytes)
    expect(await scanFolder(deps(), user.id, { limits: ONE_MB })).toBe(0)
    expect((await ctx.prisma.importedFile.findFirstOrThrow()).outcome).toBe('invalid')
    const batch = await ctx.prisma.importBatch.findFirstOrThrow()
    expect(batch.errors).toContain('unpacks to more than 1 MB')
  })

  describe('an archive that is not a whole one is invalid and reported', () => {
    const zipped = () => zipSync({ 'a.fit': fitBytes(0), 'b.fit': fitBytes(3600) })
    const gzipped = () => gzipSync(fitBytes(0))
    const cases: Array<[string, string, () => Uint8Array]> = [
      ['junk.zip', 'an HTML page', () => new TextEncoder().encode('<html>Not found</html>')],
      ['empty.zip', 'zero bytes', () => new Uint8Array(0)],
      ['no-entries.zip', 'a ZIP with no entries', () => zipSync({})],
      [
        'cut.zip',
        'a ZIP cut before its central directory',
        () => zipped().subarray(0, zipped().length - 60),
      ],
      ['empty.fit.gz', 'zero bytes', () => new Uint8Array(0)],
      ['junk.fit.gz', 'an HTML page', () => new TextEncoder().encode('<html>Not found</html>')],
      ['cut.fit.gz', 'a gzip cut in its data', () => gzipped().subarray(0, gzipped().length - 20)],
      [
        'cut-trailer.fit.gz',
        'a gzip cut in its trailer',
        () => gzipped().subarray(0, gzipped().length - 4),
      ],
    ]
    test.each(cases)('%s (%s)', async (name, _what, make) => {
      put(name, make())
      expect(await scanFolder(deps(), user.id)).toBe(0)
      expect((await ctx.prisma.importedFile.findFirstOrThrow()).outcome).toBe('invalid')
      expect(await ctx.prisma.activity.count()).toBe(0)
      const batch = await ctx.prisma.importBatch.findFirstOrThrow()
      expect(batch.skippedInvalid).toBe(1)
      expect(batch.errors).toContain(name)
    })

    test('a scan that meets one records a partial run with the failure', async () => {
      await ctx.prisma.integration.create({
        data: {
          userId: user.id,
          provider: 'folder',
          status: 'connected',
          secret: sealSecret({}, ctx.config.sessionSecret),
          config: '{}',
        },
      })
      put('junk.zip', new TextEncoder().encode('<html>Not found</html>'))
      await scanFolderIntegration(deps(), user.id, { trigger: 'manual' })
      expect(
        await ctx.prisma.syncRun.findFirstOrThrow({
          where: { channel: 'folder' },
          orderBy: { startedAt: 'desc' },
        }),
      ).toMatchObject({ status: 'partial', failed: 1 })
    })
  })

  test('a ZIP with too many members is invalid', async () => {
    const members: Record<string, Uint8Array> = {}
    for (let i = 0; i < 6; i += 1) members[`m${String(i)}.fit`] = fitBytes(i * 3600)
    put('many.zip', zipSync(members))
    expect(await scanFolder(deps(), user.id, { limits: { maxArchiveMembers: 5 } })).toBe(0)
    expect((await ctx.prisma.importedFile.findFirstOrThrow()).outcome).toBe('invalid')
    expect(await ctx.prisma.activity.count()).toBe(0)
  })

  test('a scan takes a bounded number of new files and the rest wait for the next', async () => {
    for (let i = 0; i < 5; i += 1) put(`f${String(i)}.fit`, fitBytes(i * 3600))
    const limits = { maxScanFiles: 2 }
    expect(await scanFolder(deps(), user.id, { limits })).toBe(2)
    expect(await scanFolder(deps(), user.id, { limits })).toBe(2)
    expect(await scanFolder(deps(), user.id, { limits })).toBe(1)
    expect(await scanFolder(deps(), user.id, { limits })).toBe(0)
    expect(await ctx.prisma.activity.count()).toBe(5)
  })

  test('a scan takes a bounded number of bytes and the rest wait for the next', async () => {
    for (let i = 0; i < 3; i += 1) put(`f${String(i)}.fit`, fitBytes(i * 3600))
    const limits = { maxScanBytes: 1 }
    expect(await scanFolder(deps(), user.id, { limits })).toBe(1)
    expect(await scanFolder(deps(), user.id, { limits })).toBe(1)
    expect(await scanFolder(deps(), user.id, { limits })).toBe(1)
    expect(await scanFolder(deps(), user.id, { limits })).toBe(0)
  })

  test('files already imported do not use up the bound', async () => {
    for (let i = 0; i < 3; i += 1) put(`f${String(i)}.fit`, fitBytes(i * 3600))
    expect(await scanFolder(deps(), user.id, { limits: { maxScanFiles: 3 } })).toBe(3)
    put('g.fit', fitBytes(4 * 3600))
    expect(await scanFolder(deps(), user.id, { limits: { maxScanFiles: 1 } })).toBe(1)
  })

  test('the owner still imports FIT, GPX, TCX, gzip and ZIP', async () => {
    const points = [0, 1, 2, 3].map(
      (i) =>
        `<trkpt lat="${String(40 + i * 0.001)}" lon="-105"><ele>1600</ele><time>2026-01-06T07:0${String(i)}:00Z</time></trkpt>`,
    )
    const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`
    const trackpoints = [0, 1, 2].map(
      (i) =>
        `<Trackpoint><Time>2026-01-07T07:0${String(i * 5)}:00Z</Time><DistanceMeters>${String(i * 900)}</DistanceMeters></Trackpoint>`,
    )
    const tcx = `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenter/v2"><Activities><Activity Sport="Running"><Id>2026-01-07T07:00:00Z</Id><Lap StartTime="2026-01-07T07:00:00Z"><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>1800</DistanceMeters><Track>${trackpoints.join('')}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`
    const encoder = new TextEncoder()
    put('a.fit', fitBytes(0))
    put('b.gpx', encoder.encode(gpx))
    put('c.tcx', encoder.encode(tcx))
    put('d.fit.gz', gzipSync(fitBytes(7200)))
    put('e.zip', zipSync({ 'inner.fit': fitBytes(10800) }))
    await scanFolder(deps(), user.id)
    const files = await ctx.prisma.importedFile.findMany({ orderBy: { fileName: 'asc' } })
    // An archive's members are remembered beside it.
    expect(files.map((file) => [file.fileName, file.outcome])).toEqual([
      ['a.fit', 'imported'],
      ['b.gpx', 'imported'],
      ['c.tcx', 'imported'],
      ['d.fit', 'imported'],
      ['d.fit.gz', 'imported'],
      ['e.zip', 'imported'],
      ['inner.fit', 'imported'],
    ])
  })
})
