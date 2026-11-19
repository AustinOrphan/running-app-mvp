import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import { COURSE, courseFit } from '../fixtures/fit/terrainCourse.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  storeParsedToday as storeParsed,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// Passthrough wrappers that record the order of the two calls the edit route makes.
const callOrder: string[] = []
vi.mock('../../server/services/derivedColumns.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../server/services/derivedColumns.ts')>()
  return {
    ...real,
    refreshDerivedAfterEdit: (...args: Parameters<typeof real.refreshDerivedAfterEdit>) => {
      callOrder.push('derived')
      return real.refreshDerivedAfterEdit(...args)
    },
  }
})
vi.mock('../../server/services/execution.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../server/services/execution.ts')>()
  return {
    ...real,
    runExecutionQuietly: (...args: Parameters<typeof real.runExecutionQuietly>) => {
      callOrder.push('execution')
      return real.runExecutionQuietly(...args)
    },
  }
})

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
  expectNoRefusedFetches(ctx)
})

const deps = () => ({ prisma: ctx.prisma, config: ctx.config })

/** Stores a course run that the provider reported as a cross-training session: no bins, no summary. */
async function storeAsCross(): Promise<string> {
  const bytes = courseFit(COURSE, { serial: 3, startUnix: Date.UTC(2026, 0, 12, 7) / 1000 })
  const [parsed] = parseActivityFile('run-3.fit', bytes, { timezone: 'UTC' })
  const { activityId } = await storeParsed(
    deps(),
    user.id,
    { ...parsed!, type: 'cross' },
    { source: 'file', importBatchId: null, channel: 'upload' },
  )
  return activityId
}

async function edit(id: string, type: 'run' | 'race' | 'cross') {
  const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
  return client(ctx, user)
    .put(`/api/activities/${id}`)
    .send({ date: row.date, type, durationSec: row.durationSec, distanceM: row.distanceM })
}

const columns = async (id: string) => {
  const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
  return { terrainBins: row.terrainBins, hrQuality: row.hrQuality }
}

describe('PUT /api/activities/:id fills the columns derived from the stream', () => {
  test('a cross activity edited to run has its bins and quality summary at once', async () => {
    const id = await storeAsCross()
    expect(await columns(id)).toEqual({ terrainBins: null, hrQuality: null })
    const res = await edit(id, 'run')
    expect(res.status).toBe(200)
    const after = await columns(id)
    expect(after.terrainBins).not.toBeNull()
    expect(after.hrQuality).not.toBeNull()
  })

  test('the columns are filled before the execution pass, which reads the quality summary', async () => {
    const id = await storeAsCross()
    callOrder.length = 0
    expect((await edit(id, 'run')).status).toBe(200)
    expect(callOrder).toEqual(['derived', 'execution'])
  })

  test('an edit that keeps the type writes nothing new', async () => {
    const id = await storeAsCross()
    expect((await edit(id, 'cross')).status).toBe(200)
    expect(await columns(id)).toEqual({ terrainBins: null, hrQuality: null })
  })

  test('a run edited to race leaves the stored values byte-identical', async () => {
    const id = await storeAsCross()
    await edit(id, 'run')
    const before = await columns(id)
    expect((await edit(id, 'race')).status).toBe(200)
    expect(await columns(id)).toEqual(before)
  })
})
