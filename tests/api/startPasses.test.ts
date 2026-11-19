import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { startScheduler } from '../../server/jobs/scheduler.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
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
