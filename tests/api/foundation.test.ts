import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { PROVIDERS } from '../../server/providers/registry.ts'
import {
  defaultProfile,
  loadProfile,
  toActivity,
  toIntegrationStatus,
  toProfile,
  toWellnessDay,
} from '../../server/serialize.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

let ctx: TestCtx
let user: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterAll(async () => {
  await ctx.close()
})

describe('loadProfile', () => {
  test('returns the defaults when the user has no row', async () => {
    const profile = await loadProfile(ctx.prisma, user.id)
    expect(profile).toEqual(defaultProfile())
    expect(profile).toMatchObject({
      longRunDay: 'sat',
      strengthPreference: 2,
      timezone: 'UTC',
      useHomeWeather: true,
      terrain: { trail: false, hills: false, treadmill: false, track: false },
      injuries: [],
    })
    expect(Object.keys(profile.availability)).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ])
    expect(profile.availability.mon).toEqual({ available: true, maxMin: null })
  })

  test('reads a saved row, filling missing JSON keys from the defaults', async () => {
    await ctx.prisma.athleteProfile.create({
      data: {
        userId: user.id,
        birthYear: 1990,
        hrMax: 188,
        hrMaxSource: 'measured',
        availability: JSON.stringify({ tue: { available: false, maxMin: 30 } }),
        terrain: JSON.stringify({ trail: true }),
        injuries: JSON.stringify([
          { area: 'shin', side: 'left', year: 2024, month: 3, kind: 'bone-stress', notes: null },
        ]),
        longRunDay: 'sun',
        timezone: 'Pacific/Auckland',
      },
    })
    const profile = await loadProfile(ctx.prisma, user.id)
    expect(profile).toMatchObject({
      birthYear: 1990,
      hrMax: 188,
      hrMaxSource: 'measured',
      longRunDay: 'sun',
      timezone: 'Pacific/Auckland',
      terrain: { trail: true, hills: false },
    })
    expect(profile.availability.tue).toEqual({ available: false, maxMin: 30 })
    expect(profile.availability.wed).toEqual({ available: true, maxMin: null })
    expect(profile.injuries).toHaveLength(1)
    const row = await ctx.prisma.athleteProfile.findUniqueOrThrow({ where: { userId: user.id } })
    expect(toProfile(row)).toEqual(profile)
  })
})

describe('row serializers', () => {
  test('toActivity maps the new columns and parses the histogram', async () => {
    const row = await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        date: '2026-03-02',
        type: 'run',
        durationSec: 1800,
        source: 'file',
        providerKey: 'fit:1-2',
        startUtc: '2026-03-02T07:00:00Z',
        utcOffsetMin: 60,
        tempC: 12.5,
        hrHistogram: JSON.stringify({ start: 40, width: 1, sec: [0, 3] }),
        feel: -1,
        pain: 2,
      },
    })
    expect(toActivity(row)).toMatchObject({
      source: 'file',
      startUtc: '2026-03-02T07:00:00Z',
      utcOffsetMin: 60,
      tempC: 12.5,
      hrHistogram: { start: 40, width: 1, sec: [0, 3] },
      feel: -1,
      pain: 2,
      subtype: null,
      weatherSource: null,
    })
  })

  test('toWellnessDay maps a row and an ISO timestamp', async () => {
    const row = await ctx.prisma.wellnessDay.create({
      data: {
        userId: user.id,
        date: '2026-03-02',
        restingHr: 48,
        hrvSdnn: 61.5,
        source: 'apple-health',
      },
    })
    expect(toWellnessDay(row)).toMatchObject({
      date: '2026-03-02',
      restingHr: 48,
      hrvSdnn: 61.5,
      hrvRmssd: null,
      source: 'apple-health',
    })
    expect(toWellnessDay(row).updatedAt).toBe(row.updatedAt.toISOString())
  })

  test('toIntegrationStatus is disconnected without a row and never exposes the secret', async () => {
    const info = PROVIDERS.intervals!.info
    expect(toIntegrationStatus(null, info)).toEqual({
      provider: 'intervals',
      info,
      status: 'disconnected',
      config: {},
      pushEnabled: false,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
    })
    const row = await ctx.prisma.integration.create({
      data: {
        userId: user.id,
        provider: 'intervals',
        status: 'connected',
        secret: 'v1.secret.secret.secret',
        config: JSON.stringify({ athleteId: 'i1' }),
        ingestTokenHash: 'abc',
        lastSyncAt: new Date('2026-03-02T10:00:00Z'),
      },
    })
    const status = toIntegrationStatus(row, info)
    expect(status).toMatchObject({
      status: 'connected',
      config: { athleteId: 'i1' },
      pushEnabled: true,
      lastSyncAt: '2026-03-02T10:00:00.000Z',
    })
    expect(JSON.stringify(status)).not.toContain('secret')
  })
})

describe('schema', () => {
  test('deleting a user cascades to every user-owned data-foundation row', async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    const activity = await ctx.prisma.activity.create({
      data: { userId: other.id, date: '2026-03-02', type: 'run', durationSec: 60 },
    })
    await ctx.prisma.activityStream.create({
      data: { activityId: activity.id, sampleSec: 10, data: '{}' },
    })
    await ctx.prisma.activityFile.create({
      data: {
        activityId: activity.id,
        format: 'fit',
        sizeBytes: 3,
        sha256: 'x',
        gz: Buffer.from([1, 2, 3]),
      },
    })
    await ctx.prisma.athleteProfile.create({ data: { userId: other.id } })
    await ctx.prisma.wellnessDay.create({
      data: { userId: other.id, date: '2026-03-02', source: 'manual' },
    })
    await ctx.prisma.integration.create({
      data: {
        userId: other.id,
        provider: 'strava',
        status: 'connected',
        secret: 's',
        config: '{}',
      },
    })
    await ctx.prisma.importedFile.create({
      data: { userId: other.id, sha256: 'x', channel: 'upload', outcome: 'imported' },
    })

    await ctx.prisma.user.delete({ where: { id: other.id } })

    expect(await ctx.prisma.activityStream.count({ where: { activityId: activity.id } })).toBe(0)
    expect(await ctx.prisma.activityFile.count({ where: { activityId: activity.id } })).toBe(0)
    expect(await ctx.prisma.athleteProfile.count({ where: { userId: other.id } })).toBe(0)
    expect(await ctx.prisma.wellnessDay.count({ where: { userId: other.id } })).toBe(0)
    expect(await ctx.prisma.integration.count({ where: { userId: other.id } })).toBe(0)
    expect(await ctx.prisma.importedFile.count({ where: { userId: other.id } })).toBe(0)
  })

  test('wellness days and integrations are unique per user and date or provider', async () => {
    await expect(
      ctx.prisma.wellnessDay.create({
        data: { userId: user.id, date: '2026-03-02', source: 'manual' },
      }),
    ).rejects.toThrow()
    await expect(
      ctx.prisma.integration.create({
        data: {
          userId: user.id,
          provider: 'intervals',
          status: 'error',
          secret: 's',
          config: '{}',
        },
      }),
    ).rejects.toThrow()
  })
})

describe('body limits', () => {
  const big = { padding: 'x'.repeat(2 * 1024 * 1024) }

  test('a 2 MB body is rejected on ordinary routes', async () => {
    const res = await client(ctx, user).post('/api/activities').send(big)
    expect(res.status).toBe(413)
  })

  test.each(['/api/imports/files', '/api/imports/parsed', '/api/ingest/apple-health'])(
    'a 2 MB body is not rejected as too large on %s',
    async (path) => {
      const res = await client(ctx, user).post(path).send(big)
      expect(res.status).not.toBe(413)
    },
  )

  test('a 17 MB body is rejected on /api/imports/files', async () => {
    const res = await client(ctx, user)
      .post('/api/imports/files')
      .send({ padding: 'x'.repeat(17 * 1024 * 1024) })
    expect(res.status).toBe(413)
  })
})
