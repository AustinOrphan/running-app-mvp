import { copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync, zipSync } from 'fflate'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
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
  return { prisma: ctx.prisma, config: ctx.config }
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

describe('scanFolder', () => {
  test('imports a FIT file once and skips it on the next scan', async () => {
    put('morning.fit', fitBytes())
    expect(await scanFolder(deps(), user.id, dir)).toBe(1)

    const activity = await ctx.prisma.activity.findFirstOrThrow()
    expect(activity).toMatchObject({ source: 'file', type: 'run', date: '2026-01-05' })
    expect(await ctx.prisma.activityFile.count()).toBe(1)
    const seen = await ctx.prisma.importedFile.findFirstOrThrow()
    expect(seen).toMatchObject({ channel: 'folder', outcome: 'imported', fileName: 'morning.fit' })
    const batch = await ctx.prisma.importBatch.findFirstOrThrow()
    expect(batch).toMatchObject({ source: 'folder', accepted: 1, skippedInvalid: 0 })

    expect(await scanFolder(deps(), user.id, dir)).toBe(0)
    expect(await ctx.prisma.activity.count()).toBe(1)
    expect(await ctx.prisma.importBatch.count()).toBe(1)
  })

  test('skips a renamed or copied file with the same bytes', async () => {
    const original = put('a.fit', fitBytes())
    await scanFolder(deps(), user.id, dir)
    copyFileSync(original, join(dir, 'copy-of-a.fit'))
    utimesSync(
      join(dir, 'copy-of-a.fit'),
      new Date(Date.now() - 60_000),
      new Date(Date.now() - 60_000),
    )
    expect(await scanFolder(deps(), user.id, dir)).toBe(0)
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

    expect(await scanFolder(deps(), user.id, dir)).toBe(2)
    expect(await ctx.prisma.activity.count()).toBe(2)
    expect(await scanFolder(deps(), user.id, dir)).toBe(0)
  })

  test('remembers an unreadable file as invalid and reports it', async () => {
    put('broken.fit', new Uint8Array([1, 2, 3, 4]))
    expect(await scanFolder(deps(), user.id, dir)).toBe(0)

    const seen = await ctx.prisma.importedFile.findFirstOrThrow()
    expect(seen.outcome).toBe('invalid')
    const batch = await ctx.prisma.importBatch.findFirstOrThrow()
    expect(batch.skippedInvalid).toBe(1)
    expect(batch.errors).toContain('broken.fit')
    expect(await scanFolder(deps(), user.id, dir)).toBe(0)
    expect(await ctx.prisma.importBatch.count()).toBe(1)
  })

  test('leaves a file that is still being written for the next scan', async () => {
    writeFileSync(join(dir, 'fresh.fit'), fitBytes())
    expect(await scanFolder(deps(), user.id, dir)).toBe(0)
    expect(await ctx.prisma.importedFile.count()).toBe(0)
    expect(await scanFolder(deps(), user.id, dir, { settleMs: 0 })).toBe(1)
  })

  test('throws for a folder that is missing', async () => {
    await expect(scanFolder(deps(), user.id, join(dir, 'gone'))).rejects.toThrow(
      /not a readable directory/,
    )
  })
})

describe('folder integration', () => {
  async function connectFolder(path: string) {
    return ctx.prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'folder',
        status: 'connected',
        secret: sealSecret({}, ctx.config.sessionSecret),
        config: JSON.stringify({ path }),
      },
    })
  }

  test('records the outcome on the integration row', async () => {
    await connectFolder(dir)
    put('a.fit', fitBytes())
    expect(await scanFolderIntegration(deps(), user.id)).toBe(1)
    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row).toMatchObject({ status: 'connected', lastSyncStatus: 'ok', lastError: null })
    expect(row.lastSyncAt).not.toBeNull()
  })

  test('records a missing folder as an error and recovers when it returns', async () => {
    const missing = join(dir, 'later')
    await connectFolder(missing)
    await runFolderJob(deps())
    let row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row).toMatchObject({ status: 'error', lastSyncStatus: 'error' })
    expect(row.lastError).toContain('not a readable directory')

    mkdirSync(missing)
    await runFolderJob(deps())
    row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row).toMatchObject({ status: 'connected', lastSyncStatus: 'ok' })
  })

  test('POST /sync scans the folder in the background', async () => {
    const saved = await client(ctx, user).put('/api/integrations/folder').send({ path: dir })
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
        config: JSON.stringify({ path: dir }),
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
