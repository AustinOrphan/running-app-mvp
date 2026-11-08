import { randomBytes } from 'node:crypto'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { todayIso } from '../../shared/dates.ts'
import {
  EXCLUDED_MODELS,
  exportTables,
  ORIGINAL_FILES_DIR,
} from '../../server/services/exportArchive.ts'
import { schemaModels } from '../schemaModels.ts'
import { verifyZip } from '../zipCrc.ts'
import { exportEntryCount } from '../../server/services/exportArchive.ts'
import { MAX_ZIP_ENTRIES } from '../../server/services/zipWriter.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'
import { GPX_BYTES, seedEverything } from './exportFixture.ts'

let ctx: TestCtx
let runner: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  runner = await seedUser(ctx, { email: 'runner@example.com' })
  other = await seedUser(ctx, { email: 'other@example.com' })
})
afterEach(() => {
  expectNoRefusedFetches(ctx)
})
afterAll(async () => {
  await ctx.close()
})

/** A one-time download token for this runner (step one of an export). */
async function mint(user: TestUser): Promise<string> {
  const res = await client(ctx, user).post('/api/export/token')
  expect(res.status).toBe(200)
  return (res.body as { token: string }).token
}

/** The archive as bytes; supertest does not buffer a zip on its own. A 429 at the token step is returned as is. */
async function download(
  user: TestUser,
  token?: string,
): Promise<{
  status: number
  headers: Record<string, string>
  body: Buffer
}> {
  if (token === undefined) {
    const minted = await client(ctx, user).post('/api/export/token')
    if (minted.status !== 200) {
      return { status: minted.status, headers: minted.headers, body: Buffer.alloc(0) }
    }
    token = (minted.body as { token: string }).token
  }
  const res = await client(ctx, user)
    .get(`/api/export?token=${encodeURIComponent(token)}`)
    .set('Accept-Encoding', 'gzip, br')
    .buffer(true)
    .parse((response, done) => {
      const parts: Buffer[] = []
      response.on('data', (chunk: Buffer) => parts.push(chunk))
      response.on('end', () => {
        done(null, Buffer.concat(parts))
      })
    })
  return {
    status: res.status,
    headers: res.headers,
    body: res.body as Buffer,
  }
}

function entriesOf(zip: Buffer): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(zip))
}

function text(entries: Record<string, Uint8Array>, name: string): string {
  const bytes = entries[name]
  if (!bytes) throw new Error(`${name} is not in the archive`)
  return Buffer.from(bytes).toString('utf8')
}

describe('GET /api/export', () => {
  test('an anonymous request is a 401 and reads nothing', async () => {
    const res = await client(ctx).get('/api/export')
    expect(res.status).toBe(401)
    expect(res.headers['content-type']).toMatch(/json/)
    expect((await client(ctx).post('/api/export/token')).status).toBe(401)
  })

  test('a query is parsed: an unknown parameter is a 400', async () => {
    const token = await mint(runner)
    const res = await client(ctx, runner).get(`/api/export?token=${token}&format=tar`)
    expect(res.status).toBe(400)
  })

  describe('the one-time download token', () => {
    test('a GET without a token is a 403 and starts no export', async () => {
      const res = await client(ctx, runner).get('/api/export')
      expect(res.status).toBe(403)
      expect(res.headers['content-type']).toMatch(/json/)
      // No lock was taken: a token still works afterwards.
      expect((await download(runner)).status).toBe(200)
    })

    test('a made-up token is a 403', async () => {
      expect((await client(ctx, runner).get('/api/export?token=nope')).status).toBe(403)
    })

    test('a token works once', async () => {
      const token = await mint(runner)
      expect((await download(runner, token)).status).toBe(200)
      expect((await download(runner, token)).status).toBe(403)
    })

    test('a token belongs to the runner who asked for it', async () => {
      const token = await mint(runner)
      expect((await download(other, token)).status).toBe(403)
      // The refused use also spent it.
      expect((await download(runner, token)).status).toBe(403)
    })

    test('a token is good for about a minute', async () => {
      const token = await mint(runner)
      const now = Date.now()
      const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
      try {
        expect((await client(ctx, runner).get(`/api/export?token=${token}`)).status).toBe(403)
      } finally {
        spy.mockRestore()
      }
    })

    test('the token step is a POST behind the same-origin guard', async () => {
      const res = await client(ctx, runner)
        .post('/api/export/token')
        .set('Origin', 'http://evil.example')
        .set('Host', 'app.test')
      expect(res.status).toBe(403)
    })

    test('HEAD does no work and takes no token', async () => {
      const token = await mint(runner)
      const head = await client(ctx, runner).head(`/api/export?token=${token}`)
      expect(head.status).toBe(405)
      // The token was not spent.
      expect((await download(runner, token)).status).toBe(200)
    })
  })

  test('every model of the schema is in a file of the archive or named as left out', () => {
    const covered = new Set(exportTables(ctx.prisma, 'x').flatMap((table) => table.models))
    const excluded = new Set(Object.keys(EXCLUDED_MODELS))
    for (const model of schemaModels()) {
      const inOne = covered.has(model.name) !== excluded.has(model.name)
      expect(inOne, `${model.name} must be exported or excluded, not both and not neither`).toBe(
        true,
      )
    }
    for (const name of [...covered, ...excluded]) {
      expect(
        schemaModels().some((model) => model.name === name),
        `${name} is not a model`,
      ).toBe(true)
    }
  })

  describe('with a full account and another runner beside it', () => {
    let secrets: string[]
    let ownMarker: string
    let othersSecrets: string[]
    let zip: Buffer
    let entries: Record<string, Uint8Array>
    let headers: Record<string, string>

    beforeAll(async () => {
      const mine = await seedEverything(ctx.prisma, runner.id, 'alpha', ctx.config.sessionSecret)
      const theirs = await seedEverything(ctx.prisma, other.id, 'bravo', ctx.config.sessionSecret)
      secrets = mine.secrets
      ownMarker = mine.ownMarker
      othersSecrets = theirs.secrets
      const res = await download(runner)
      expect(res.status).toBe(200)
      zip = res.body
      headers = res.headers
      entries = entriesOf(zip)
    })

    test('the pre-flight count equals the number of files in the archive', async () => {
      expect(await exportEntryCount(ctx.prisma, runner.id)).toBe(Object.keys(entries).length)
    })

    test('every entry checks out end to end: sizes, descriptors and CRC-32', () => {
      const verified = verifyZip(zip)
      expect(verified.map((e) => e.name).sort()).toEqual(Object.keys(entries).sort())
    })

    test('is a zip with the right name, uncompressed by the transport and never cached', () => {
      expect(headers['content-type']).toMatch(/^application\/zip/)
      expect(headers['content-disposition']).toBe(
        `attachment; filename="running-log-export-${todayIso()}.zip"`,
      )
      expect(headers['content-encoding']).toBeUndefined()
      expect(headers['cache-control']).toBe('no-store')
      expect(zip.subarray(0, 4).toString('hex')).toBe('504b0304')
    })

    test('holds the file of every table, the CSV, the README and the info', () => {
      const names = Object.keys(entries)
      for (const table of exportTables(ctx.prisma, runner.id)) expect(names).toContain(table.file)
      expect(names).toContain('README.txt')
      expect(names).toContain('activities.csv')
      expect(names).toContain('export-info.json')
      expect(names.some((name) => name.startsWith(`${ORIGINAL_FILES_DIR}/`))).toBe(true)
    })

    test('the README names every file of the archive', () => {
      const readme = text(entries, 'README.txt')
      for (const name of Object.keys(entries)) {
        if (name.startsWith('original-files/')) continue
        expect(readme, `${name} is not in the README`).toContain(`\n${name}\n`)
      }
      expect(readme).toContain('original-files/')
      expect(readme).toMatch(/metres/)
      expect(readme).toMatch(/grams/)
      expect(readme).toMatch(/YYYY-MM-DD/)
    })

    test('every table file is valid JSON with the seeded rows', () => {
      const info = JSON.parse(text(entries, 'export-info.json')) as {
        rows: Record<string, number>
        originalFiles: number
      }
      const tables = exportTables(ctx.prisma, runner.id)
      for (const table of tables) {
        const parsed = JSON.parse(text(entries, table.file)) as unknown
        if (table.shape === 'object') {
          expect(parsed, table.file).not.toBeNull()
          expect(info.rows[table.file], table.file).toBe(1)
        } else {
          expect(Array.isArray(parsed), table.file).toBe(true)
          expect((parsed as unknown[]).length, `${table.file} has a row`).toBeGreaterThan(0)
          expect(info.rows[table.file], table.file).toBe((parsed as unknown[]).length)
        }
      }
      expect(info.originalFiles).toBe(1)
    })

    test('activities carry feedback, terrain bins and the stream and laps', () => {
      const activities = JSON.parse(text(entries, 'activities.json')) as Record<string, unknown>[]
      expect(activities).toHaveLength(2)
      const run = activities[0]!
      expect(run).toMatchObject({ rpe: 5, feel: 1, pain: 2, notes: ownMarker })
      expect(run['terrainBins']).toEqual({ flat: 1 })
      const streams = JSON.parse(text(entries, 'activity-streams.json')) as Record<
        string,
        unknown
      >[]
      expect(streams[0]).toMatchObject({
        activityId: run['id'],
        data: { hr: [120, 121] },
        laps: [{ lap: 1 }],
      })
    })

    test('the whole stored track is there, untrimmed, and the settings say whether the map trims', () => {
      const [track] = JSON.parse(text(entries, 'activity-tracks.json')) as Record<string, unknown>[]
      expect(track).toMatchObject({
        v: 1,
        polyline: '_p~iF~ps|U_ulLnnqC',
        distM: [0, 1000],
        pointCount: 2,
        minLat: 38.5,
        maxLng: -120.2,
      })
      expect(JSON.parse(text(entries, 'settings.json'))).toMatchObject({ hideMapEnds: true })
      expect(text(entries, 'README.txt')).toMatch(/Google encoded polyline, precision 5/)
      expect(text(entries, 'README.txt')).toMatch(/does not\.?/)
    })

    test('the CSV is the activity CSV, oldest first', () => {
      const lines = text(entries, 'activities.csv').trim().split('\r\n')
      expect(lines[0]).toBe(
        'date,start_time,type,minutes,miles,avg_hr,max_hr,elevation_gain_m,rpe,notes,source,duplicate_status',
      )
      expect(lines).toHaveLength(3)
      expect(lines[1]).toContain(
        '2026-03-02,07:05,run,30.08,3.1069,,,,5,own-note-alpha,manual,none',
      )
    })

    test('the original file comes back byte for byte, named by its index', () => {
      const files = JSON.parse(text(entries, 'activity-files.json')) as {
        archivePath: string
        sha256: string
      }[]
      expect(files).toHaveLength(1)
      expect(files[0]).not.toHaveProperty('gz')
      const bytes = entries[files[0]!.archivePath]
      expect(bytes).toBeDefined()
      expect(Buffer.from(bytes!).equals(GPX_BYTES)).toBe(true)
    })

    test('integrations hold provider, status and dates only', () => {
      const [integration] = JSON.parse(text(entries, 'integrations.json')) as Record<
        string,
        unknown
      >[]
      expect(Object.keys(integration!).sort()).toEqual([
        'createdAt',
        'id',
        'lastSyncAt',
        'lastSyncStatus',
        'pausedUntil',
        'provider',
        'status',
        'updatedAt',
      ])
      const [channel] = JSON.parse(text(entries, 'delivery-channels.json')) as Record<
        string,
        unknown
      >[]
      expect(channel).not.toHaveProperty('tokenHash')
      expect(JSON.parse(text(entries, 'settings.json'))).not.toHaveProperty('passwordHash')
    })

    test('no secret appears anywhere in the archive, packed or unpacked', () => {
      expect(secrets.length).toBeGreaterThan(8)
      const unpacked = Buffer.concat(Object.values(entries).map((bytes) => Buffer.from(bytes)))
      for (const secret of secrets) {
        expect(zip.includes(secret), `packed: ${secret.slice(0, 12)}`).toBe(false)
        expect(unpacked.includes(secret), `unpacked: ${secret.slice(0, 12)}`).toBe(false)
        expect(zip.includes(Buffer.from(secret).toString('base64')), 'base64').toBe(false)
      }
    })

    test('nothing of the other runner is in it', () => {
      const unpacked = Buffer.concat(Object.values(entries).map((bytes) => Buffer.from(bytes)))
      expect(unpacked.includes('bravo')).toBe(false)
      expect(unpacked.includes('other@example.com')).toBe(false)
      expect(unpacked.includes(other.id)).toBe(false)
      for (const secret of othersSecrets) expect(unpacked.includes(secret)).toBe(false)
      expect(unpacked.includes('alpha')).toBe(true)
      expect(text(entries, 'settings.json')).toContain('runner@example.com')
    })
  })

  test('a runner with no data gets a valid archive', async () => {
    const empty = await seedUser(ctx, { email: 'empty@example.com' })
    const res = await download(empty)
    expect(res.status).toBe(200)
    const entries = entriesOf(res.body)
    for (const table of exportTables(ctx.prisma, empty.id)) {
      const parsed = JSON.parse(text(entries, table.file)) as unknown
      expect(parsed, table.file).toEqual(
        table.models[0] === 'User' ? expect.any(Object) : table.shape === 'object' ? null : [],
      )
    }
    expect(text(entries, 'activities.csv').trim().split('\r\n')).toHaveLength(1)
    expect(Object.keys(entries).some((name) => name.startsWith('original-files/'))).toBe(false)
    expect(text(entries, 'README.txt')).toContain('FILES')
  })

  test('an account with more files than a ZIP holds is refused before any byte is sent', async () => {
    const huge = await seedUser(ctx, { email: 'huge@example.com' })
    const gz = gzipSync(Buffer.from('x'))
    const count = MAX_ZIP_ENTRIES // plus the fixed files and tables, so over the limit
    const activities = Array.from({ length: count }, (_, i) => ({
      id: `huge-${String(i)}`,
      userId: huge.id,
      date: '2026-01-01',
      type: 'run',
      durationSec: 60,
    }))
    await ctx.prisma.activity.createMany({ data: activities })
    await ctx.prisma.activityFile.createMany({
      data: activities.map((a, i) => ({
        activityId: a.id,
        format: 'fit',
        sizeBytes: 1,
        sha256: String(i),
        gz,
      })),
    })
    const res = await client(ctx, huge).post('/api/export/token')
    expect(res.status).toBe(413)
    expect((res.body as { error: { details: { code: string } } }).error.details.code).toBe(
      'export-too-many-files',
    )
  }, 60_000)

  describe('one export at a time', () => {
    test('a second request gets 429 while the first is running, and works once it has ended', async () => {
      const busy = await seedUser(ctx, { email: 'busy@example.com' })
      const activity = await ctx.prisma.activity.create({
        data: { userId: busy.id, date: '2026-03-02', type: 'run', durationSec: 60 },
      })
      // Random bytes do not compress, so the archive outgrows the socket buffers and the first
      // request stays open while its client reads nothing.
      for (let i = 0; i < 3; i++) {
        const a =
          i === 0
            ? activity
            : await ctx.prisma.activity.create({
                data: { userId: busy.id, date: `2026-03-0${3 + i}`, type: 'run', durationSec: 60 },
              })
        await ctx.prisma.activityFile.create({
          data: {
            activityId: a.id,
            format: 'fit',
            sizeBytes: 1,
            sha256: String(i).repeat(64),
            gz: gzipSync(randomBytes(6_000_000)),
          },
        })
      }
      const server = ctx.app.listen(0)
      try {
        const { port } = server.address() as AddressInfo
        const firstToken = await mint(busy)
        const secondToken = await mint(busy)
        const first = await new Promise<IncomingMessage>((resolve, reject) => {
          const req = httpRequest(
            {
              port,
              path: `/api/export?token=${firstToken}`,
              headers: { Cookie: busy.cookie, Host: 'app.test', Origin: 'http://app.test' },
            },
            (response) => {
              response.pause()
              resolve(response)
            },
          )
          req.on('error', reject)
          req.end()
        })
        expect(first.statusCode).toBe(200)
        const second = await client(ctx, busy).get(`/api/export?token=${secondToken}`)
        expect(second.status).toBe(429)
        type Refusal = { error: { details: { code: string } } }
        expect((second.body as Refusal).error.details.code).toBe('export-running')
        // And no token is given out while one runs.
        const third = await client(ctx, busy).post('/api/export/token')
        expect(third.status).toBe(429)
        expect((third.body as Refusal).error.details.code).toBe('export-running')
        // Another runner is not held up.
        expect((await download(runner)).status).toBe(200)
        first.destroy()
        // The lock is released when the connection ends.
        let status = 429
        for (let i = 0; i < 100 && status === 429; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          status = (await download(busy)).status
        }
        expect(status).toBe(200)
      } finally {
        server.close()
      }
    }, 60_000)
  })
})
