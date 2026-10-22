import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// A workout whose provider key ends in "-bad" fails to store, as a database error would.
vi.mock('../../server/services/activityStore.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/activityStore.ts')>()
  return {
    ...original,
    storeParsed: (...args: Parameters<typeof original.storeParsed>) => {
      if (args[2].providerKey.endsWith('-bad')) throw new Error('disk full')
      return original.storeParsed(...args)
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
  await ctx.prisma.importBatch.deleteMany()
  await ctx.prisma.integration.deleteMany()
})

function workout(id: string, hour: number) {
  return {
    id,
    name: 'Outdoor Run',
    start: `2026-03-04 0${String(hour)}:00:00 -0500`,
    end: `2026-03-04 0${String(hour)}:30:00 -0500`,
    distance: { qty: 5, units: 'km' },
  }
}

async function push(workouts: unknown[]) {
  const res = await client(ctx, user).post('/api/integrations/apple-health/push-token').send({})
  const token = (res.body as { token: string }).token
  return request(ctx.app)
    .post('/api/ingest/apple-health')
    .set('Authorization', `Bearer ${token}`)
    .send({ data: { metrics: [], workouts } })
}

describe('POST /api/ingest/apple-health failures', () => {
  test('reports the activities that failed and keeps the integration connected when others stored', async () => {
    const res = await push([workout('w-good', 6), workout('w-bad', 7)])
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ activities: 1, wellness: 0, ignored: {} })
    const failed = (res.body as { failed: Array<{ providerKey: string; reason: string }> }).failed
    expect(failed).toEqual([{ providerKey: 'apple:w-bad', reason: 'disk full' }])

    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row).toMatchObject({ status: 'connected', lastSyncStatus: 'ok', lastError: null })
  })

  test('marks the integration as errored when every pushed activity failed', async () => {
    const res = await push([workout('w-bad', 6)])
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ activities: 0 })
    expect((res.body as { failed: unknown[] }).failed).toHaveLength(1)

    const row = await ctx.prisma.integration.findFirstOrThrow()
    expect(row.status).toBe('error')
    expect(row.lastSyncStatus).toBe('error')
    expect(row.lastError).toMatch(/disk full/)

    // The next push that stores something puts the integration back to connected.
    const next = await push([workout('w-fine', 8)])
    expect(next.body).toMatchObject({ activities: 1, failed: [] })
    const after = await ctx.prisma.integration.findFirstOrThrow()
    expect(after).toMatchObject({ status: 'connected', lastSyncStatus: 'ok', lastError: null })
  })

  test('a push of workouts already stored is not a failure', async () => {
    await push([workout('w-same', 6)])
    const again = await push([workout('w-same', 6)])
    expect(again.body).toMatchObject({ failed: [] })
    expect((await ctx.prisma.integration.findFirstOrThrow()).status).toBe('connected')
  })
})
