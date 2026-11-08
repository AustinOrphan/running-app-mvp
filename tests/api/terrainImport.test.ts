import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import { storeParsed } from '../../server/services/activityStore.ts'
import { toActivity } from '../../server/serialize.ts'
import { COURSE, courseFit } from '../fixtures/fit/terrainCourse.ts'
import { createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

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

async function importFit(bytes: Uint8Array, name: string) {
  const [parsed] = parseActivityFile(name, bytes, { timezone: 'UTC' })
  if (!parsed) throw new Error('expected one activity')
  return storeParsed({ prisma: ctx.prisma, config: ctx.config }, user.id, parsed, {
    source: 'file',
    importBatchId: null,
    channel: 'upload',
    file: { name, format: 'fit', bytes },
  })
}

describe('terrain bins at import', () => {
  test('a run with a stream stores its bins, a small JSON text', async () => {
    const { activityId } = await importFit(courseFit(COURSE), 'hills.fit')
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })
    expect(row.terrainBins).not.toBeNull()
    const bins = toActivity(row).terrainBins!
    expect(bins.v).toBe(1)
    expect(bins.sec).toHaveLength(bins.edgesPct.length + 1)
    expect(bins.sec[4]!).toBeGreaterThan(1000)
    expect(bins.walkSec[8]!).toBeGreaterThan(100)
    expect(row.terrainBins!.length).toBeLessThan(400)
  })

  test('a run without altitude stores all-zero bins, not null', async () => {
    const bytes = courseFit(COURSE, { withAltitude: false, serial: 8 })
    const { activityId } = await importFit(bytes, 'flat.fit')
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })
    const bins = toActivity(row).terrainBins!
    expect(bins.sec.every((v) => v === 0)).toBe(true)
  })

  test('a strength session stores none', async () => {
    const bytes = courseFit(COURSE, { sport: 10, serial: 9 })
    const { activityId } = await importFit(bytes, 'lift.fit')
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })
    expect(row.type).toBe('strength')
    expect(row.terrainBins).toBeNull()
  })
})
