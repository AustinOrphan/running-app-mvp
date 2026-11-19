import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { startScheduler } from '../../server/jobs/scheduler.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import { sealSecret } from '../../server/services/sync.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { COURSE, courseFit } from '../fixtures/fit/terrainCourse.ts'
import {
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  storeParsedToday as storeParsed,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

const MINUTE = 60_000

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
})

afterEach(() => {
  vi.useRealTimers()
  expectNoRefusedFetches(ctx)
})

const deps = () => ({ prisma: ctx.prisma, config: ctx.config })
const never = (() => Promise.reject(new Error('no network in tests'))) as typeof fetch

/** A stored run whose bins and quality summary are blank, as one imported before the columns. */
async function blankRun(): Promise<string> {
  const bytes = courseFit(COURSE, { serial: 5, startUnix: Date.UTC(2026, 0, 12, 7) / 1000 })
  const [parsed] = parseActivityFile('run-5.fit', bytes, { timezone: 'UTC' })
  const { activityId } = await storeParsed(deps(), user.id, parsed!, {
    source: 'file',
    importBatchId: null,
    channel: 'upload',
  })
  await ctx.prisma.activity.update({
    where: { id: activityId },
    data: { terrainBins: null, hrQuality: null },
  })
  return activityId
}

const columns = async (id: string) => {
  const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
  return { terrainBins: row.terrainBins, hrQuality: row.hrQuality }
}

function fakeTimers(): void {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
  })
  vi.setSystemTime(new Date('2026-01-14T12:00:00Z'))
}

describe('startScheduler start passes', () => {
  test('fill terrain bins and quality 30 s after start, once, and not again on a later tick', async () => {
    const id = await blankRun()
    fakeTimers()
    const stop = startScheduler(deps(), { fetch: never })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await columns(id)).toEqual({ terrainBins: null, hrQuality: null })

    await vi.advanceTimersByTimeAsync(11_000)
    await vi.waitFor(async () => {
      const filled = await columns(id)
      expect(filled.terrainBins).not.toBeNull()
      expect(filled.hrQuality).not.toBeNull()
    })

    // The five-minute polls are gone: a column blanked later stays blank through ten minutes.
    await ctx.prisma.activity.update({
      where: { id },
      data: { terrainBins: null, hrQuality: null },
    })
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(await columns(id)).toEqual({ terrainBins: null, hrQuality: null })
    stop()
  })

  test('the track streams and watch ratings ride the hourly sync: no five-minute jobs', async () => {
    await ctx.prisma.integration.deleteMany()
    await ctx.prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'intervals',
        status: 'connected',
        secret: sealSecret({ apiKey: 'key-123' }, ctx.config.sessionSecret),
        config: JSON.stringify({ athleteId: 'i1001' }),
      },
    })
    await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        type: 'run',
        date: '2026-01-10',
        durationSec: 900,
        source: 'intervals',
        providerKey: 'intervals:w1',
        startUtc: '2026-01-10T07:00:00Z',
      },
    })
    const base = 'https://intervals.icu/api/v1'
    const asked: string[] = []
    const fetchFn = fakeFetch({
      [`GET ${base}/athlete/i1001/activities`]: () => new Response('[]', { status: 200 }),
      [`GET ${base}/athlete/i1001/wellness.json`]: () => new Response('[]', { status: 200 }),
      [`GET ${base}/activity/`]: (req) => {
        asked.push(new URL(req.url).pathname)
        return new Response('{}', { status: 404 })
      },
    })
    fakeTimers()
    const stop = startScheduler({ ...deps(), fetch: fetchFn }, { fetch: fetchFn })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(asked).toEqual([])
    await vi.advanceTimersByTimeAsync(11_000)
    await vi.waitFor(() => {
      // One stream request and one record request, from the sync tails after the first sync tick.
      expect(asked.sort()).toEqual(['/api/v1/activity/w1', '/api/v1/activity/w1/streams.json'])
    })
    // Nothing is owed any more, and no timer asks again for a new run before the next sync.
    // A run owed again is not asked before the next hourly sync.
    await ctx.prisma.activity.updateMany({
      data: { trackV: null, watchRpeV: null, rpe: null },
    })
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(asked).toHaveLength(2)
    stop()
    await ctx.prisma.integration.deleteMany()
  })

  test('stop() before 30 s runs nothing', async () => {
    const id = await blankRun()
    fakeTimers()
    const stop = startScheduler(deps(), { fetch: never })
    await vi.advanceTimersByTimeAsync(20_000)
    stop()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(await columns(id)).toEqual({ terrainBins: null, hrQuality: null })
  })
})
