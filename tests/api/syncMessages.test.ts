import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { SYNC_TEMPLATES } from '../../shared/copy/sync.ts'
import type { JobsView, SyncRunView } from '../../shared/types.ts'
import { describeRun } from '../../web/components/syncText.ts'
import { runSyncJob } from '../../server/jobs/scheduler.ts'
import { garminProvider } from '../../server/providers/garmin.ts'
import type { RemoteActivityRef } from '../../server/providers/types.ts'
import { scanFolderIntegration } from '../../server/services/folder.ts'
import { sealSecret, syncProvider } from '../../server/services/sync.ts'
import { syncMessage, type SyncMessageId } from '../../server/services/syncLog.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { buildFit } from '../fixtures/fit/buildFit.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// Switches for the two failures a test cannot cause with real input: a database error while an
// activity is stored, and a parser that throws something that is not an Error.
const faults = vi.hoisted(() => ({ store: false, parserThrowsText: false }))

vi.mock('../../server/services/activityStore.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/activityStore.ts')>()
  return {
    ...original,
    storeParsed: (...args: Parameters<typeof original.storeParsed>) => {
      if (faults.store) throw new Error('disk full')
      return original.storeParsed(...args)
    },
  }
})

vi.mock('../../shared/importers/files/index.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/importers/files/index.ts')>()
  return {
    ...original,
    parseActivityFile: (...args: Parameters<typeof original.parseActivityFile>) => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- a parser that throws text
      if (faults.parserThrowsText) throw 'unreadable'
      return original.parseActivityFile(...args)
    },
  }
})

// Every sentence the app itself writes as the message of a run (the `sync.msg.*` templates) is
// stored by a real code path below, and the stored text and the history line it makes must pass
// the G5 lint. Text a provider or the system returned is outside the lint (spec 4.5), so these
// paths use reasons that are clean and the lint finds only what the app wrote.

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
  dir = mkdtempSync(join(tmpdir(), 'rl-msg-'))
  faults.store = false
  faults.parserThrowsText = false
  await ctx.prisma.syncRun.deleteMany()
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.importedFile.deleteMany()
  await ctx.prisma.importBatch.deleteMany()
  await ctx.prisma.integration.deleteMany()
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function deps() {
  return { prisma: ctx.prisma, config: ctx.config }
}

async function connect(provider: string, secret: object = {}, config: object = {}) {
  await ctx.prisma.integration.create({
    data: {
      userId: user.id,
      provider,
      status: 'connected',
      secret: sealSecret(secret, ctx.config.sessionSecret),
      config: JSON.stringify(config),
    },
  })
}

async function runsOf(provider: string): Promise<SyncRunView[]> {
  const res = await client(ctx, user).get(`/api/integrations/${provider}/runs`)
  expect(res.status).toBe(200)
  return res.body as SyncRunView[]
}

function fitBytes(offsetSec = 0): Uint8Array {
  const startUnix = Date.UTC(2026, 0, 5, 7, 0, 0) / 1000 + offsetSec
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

function put(name: string, bytes: Uint8Array): void {
  const path = join(dir, name)
  writeFileSync(path, bytes)
  const old = new Date(Date.now() - 60_000)
  utimesSync(path, old, old)
}

async function scanFails(): Promise<void> {
  await expect(scanFolderIntegration(deps(), user.id)).rejects.toThrow()
}

async function pushToken(): Promise<string> {
  const res = await client(ctx, user).post('/api/integrations/apple-health/push-token').send({})
  return (res.body as { token: string }).token
}

function push(token: string, body: object) {
  return request(ctx.app)
    .post('/api/ingest/apple-health')
    .set('Authorization', `Bearer ${token}`)
    .send(body)
}

/** A Garmin activity list that stops with `failure`. */
function failingList(failure: Error): AsyncIterable<RemoteActivityRef> {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(failure) }),
  }
}

interface Outcome {
  /** The text the path stored. */
  stored: string | null | undefined
  /** The sentence the template makes of the slots the path fills. */
  expected: string
  /** The run the history shows for it, when it shows one. */
  run?: SyncRunView | undefined
}

/** One real code path for each sentence, so a new `sync.msg.*` template fails to compile without one. */
const scenarios: Record<SyncMessageId, () => Promise<Outcome>> = {
  'sync.msg.secret-changed': async () => {
    await connect('intervals', { apiKey: 'synthetic-api-key-0123456789' }, { athleteId: 'i1001' })
    const other = {
      prisma: ctx.prisma,
      config: { ...ctx.config, sessionSecret: 'a-different-session-secret-0123456789abc' },
    }
    await syncProvider(other, user.id, 'intervals', { fetch: fakeFetch({}) })
    const [run] = await runsOf('intervals')
    return { stored: run?.message, run, expected: syncMessage('sync.msg.secret-changed', {}) }
  },

  'sync.msg.sync-unfinished': async () => {
    await connect('garmin', {
      accessToken: 'synthetic-access-0123456',
      refreshToken: 'x'.repeat(12),
    })
    // A pull that fails with no words: the job still says that the sync did not finish.
    vi.spyOn(garminProvider, 'listActivities').mockImplementation(() => failingList(new Error('')))
    await runSyncJob(deps(), { fetch: fakeFetch({}) })
    const jobs = (await client(ctx, user).get('/api/jobs')).body as JobsView
    const run = jobs.jobs.find((job) => job.provider === 'sync')
    return { stored: run?.message, run, expected: syncMessage('sync.msg.sync-unfinished', {}) }
  },

  'sync.msg.push-unreadable': async () => {
    const res = await push(await pushToken(), { nope: true })
    expect(res.status).toBe(400)
    const [run] = await runsOf('apple-health')
    return { stored: run?.message, run, expected: syncMessage('sync.msg.push-unreadable', {}) }
  },

  'sync.msg.push-none-stored': async () => {
    faults.store = true
    const token = await pushToken()
    const workout = {
      id: 'w-1',
      name: 'Outdoor Run',
      start: '2026-03-04 07:00:00 -0500',
      end: '2026-03-04 07:30:00 -0500',
      distance: { qty: 5, units: 'km' },
    }
    await push(token, { data: { metrics: [], workouts: [workout] } }).expect(200)
    const [run] = await runsOf('apple-health')
    const expected = syncMessage('sync.msg.push-none-stored', { reason: 'disk full' })
    // The integration card shows the same words as the history.
    expect((await ctx.prisma.integration.findFirstOrThrow()).lastError).toBe(expected)
    return { stored: run?.message, run, expected }
  },

  'sync.msg.folder-none': async () => {
    await connect('folder', {}, {})
    await scanFails()
    const [run] = await runsOf('folder')
    return { stored: run?.message, run, expected: syncMessage('sync.msg.folder-none', {}) }
  },

  'sync.msg.folder-unreadable': async () => {
    const path = join(dir, 'missing')
    await connect('folder', {}, { path })
    await scanFails()
    const [run] = await runsOf('folder')
    return {
      stored: run?.message,
      run,
      expected: syncMessage('sync.msg.folder-unreadable', { path }),
    }
  },

  'sync.msg.files.one': async () => {
    faults.store = true
    await connect('folder', {}, { path: dir })
    put('a.fit', fitBytes(0))
    await scanFails()
    const [run] = await runsOf('folder')
    return {
      stored: run?.message,
      run,
      expected: syncMessage('sync.msg.files.one', { reason: 'a.fit: disk full' }),
    }
  },

  'sync.msg.files.many': async () => {
    faults.store = true
    await connect('folder', {}, { path: dir })
    put('a.fit', fitBytes(0))
    put('b.fit', fitBytes(3600))
    await scanFails()
    const [run] = await runsOf('folder')
    return {
      stored: run?.message,
      run,
      expected: syncMessage('sync.msg.files.many', {
        n: { kind: 'count', n: 2 },
        reason: 'a.fit: disk full',
      }),
    }
  },

  'sync.msg.file-unreadable': async () => {
    faults.parserThrowsText = true
    await connect('folder', {}, { path: dir })
    put('odd.fit', fitBytes(0))
    await scanFolderIntegration(deps(), user.id)
    const [run] = await runsOf('folder')
    return {
      stored: run?.failures[0]?.reason,
      run,
      expected: syncMessage('sync.msg.file-unreadable', {}),
    }
  },
}

describe('every sentence the app writes as the message of a run', () => {
  const ids = Object.keys(scenarios) as SyncMessageId[]

  test('the scenarios cover every sync.msg template', () => {
    const templates = Object.keys(SYNC_TEMPLATES).filter((id) => id.startsWith('sync.msg.'))
    expect([...ids].sort()).toEqual(templates.sort())
  })

  test.each(ids)('%s is stored from its template and passes the G5 lint', async (id) => {
    const { stored, expected, run } = await scenarios[id]()
    expect(stored).toBe(expected)
    assertCleanCopy(expected, id)
    expect(run).toBeDefined()
    // The history line the page shows holds the stored text, so it is linted as the page prints it.
    if (run) assertCleanCopy(describeRun(run), `${id} in the sync history`)
  })
})
