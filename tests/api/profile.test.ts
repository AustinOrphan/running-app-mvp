import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { AthleteProfile } from '../../shared/types.ts'
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

beforeEach(async () => {
  await ctx.prisma.athleteProfile.deleteMany()
})

const allDays = (available: boolean, maxMin: number | null) =>
  Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, { available, maxMin }]),
  )

async function issuePaths(body: object): Promise<string[]> {
  const res = await client(ctx, user).put('/api/profile').send(body).expect(400)
  const issues = (res.body as { error: { details: { issues: Array<{ path: string }> } } }).error
    .details.issues
  return issues.map((issue) => issue.path)
}

describe('GET /api/profile', () => {
  test('requires a session', async () => {
    await client(ctx).get('/api/profile').expect(401)
  })

  test('returns the defaults before anything is saved', async () => {
    const res = await client(ctx, user).get('/api/profile').expect(200)
    expect(res.body).toMatchObject({
      birthYear: null,
      hrMax: null,
      longRunDay: 'sat',
      strengthPreference: 2,
      timezone: 'UTC',
      useHomeWeather: true,
      injuries: [],
      terrain: { trail: false, hills: false, treadmill: false, track: false },
    })
    expect((res.body as AthleteProfile).availability.mon).toEqual({ available: true, maxMin: null })
  })
})

describe('PUT /api/profile', () => {
  test('saves every field and reads it back', async () => {
    const body = {
      birthYear: 1985,
      sex: 'female',
      heightCm: 168.5,
      weightKg: 61.2,
      hrMax: 188,
      hrMaxSource: 'measured',
      hrRest: 52,
      lthr: 168,
      thresholdPaceSecPerKm: 285,
      runningSinceYear: 2015,
      injuries: [
        { area: 'shin', side: 'left', year: 2022, month: 4, kind: 'bone-stress', notes: 'rested' },
      ],
      availability: { ...allDays(true, 90), wed: { available: false, maxMin: null } },
      longRunDay: 'sun',
      terrain: { trail: true, hills: true, treadmill: false, track: false },
      strengthPreference: 3,
      timezone: 'Pacific/Auckland',
      homeLat: 10.12,
      homeLng: -20.34,
      useHomeWeather: false,
    }
    const put = await client(ctx, user).put('/api/profile').send(body).expect(200)
    expect(put.body).toEqual(body)
    const get = await client(ctx, user).get('/api/profile').expect(200)
    expect(get.body).toEqual(body)
  })

  test('merges a partial body into the saved profile', async () => {
    await client(ctx, user)
      .put('/api/profile')
      .send({ hrMax: 190, hrMaxSource: 'estimated', longRunDay: 'sun' })
      .expect(200)
    const res = await client(ctx, user).put('/api/profile').send({ hrRest: 50 }).expect(200)
    expect(res.body).toMatchObject({
      hrMax: 190,
      hrMaxSource: 'estimated',
      hrRest: 50,
      longRunDay: 'sun',
    })
  })

  test('rounds the home location to 0.01 degrees on write', async () => {
    const res = await client(ctx, user)
      .put('/api/profile')
      .send({ homeLat: 10.12678, homeLng: -20.3449 })
      .expect(200)
    expect(res.body).toMatchObject({ homeLat: 10.13, homeLng: -20.34 })
    const row = await ctx.prisma.athleteProfile.findUniqueOrThrow({ where: { userId: user.id } })
    expect(row.homeLat).toBe(10.13)
    expect(row.homeLng).toBe(-20.34)
  })

  test('clears the HR max source when HR max is cleared', async () => {
    await client(ctx, user)
      .put('/api/profile')
      .send({ hrMax: 185, hrMaxSource: 'measured' })
      .expect(200)
    const res = await client(ctx, user).put('/api/profile').send({ hrMax: null }).expect(200)
    expect(res.body).toMatchObject({ hrMax: null, hrMaxSource: null })
  })

  test('clears the home location with nulls', async () => {
    await client(ctx, user).put('/api/profile').send({ homeLat: 1, homeLng: 2 }).expect(200)
    const res = await client(ctx, user)
      .put('/api/profile')
      .send({ homeLat: null, homeLng: null })
      .expect(200)
    expect(res.body).toMatchObject({ homeLat: null, homeLng: null })
  })

  test('keeps profiles apart per user', async () => {
    const other = await seedUser(ctx, { email: 'other@example.com' })
    await client(ctx, user).put('/api/profile').send({ hrMax: 190 }).expect(200)
    const res = await client(ctx, other).get('/api/profile').expect(200)
    expect((res.body as AthleteProfile).hrMax).toBeNull()
  })

  test('requires a session', async () => {
    await client(ctx).put('/api/profile').send({ hrMax: 190 }).expect(401)
  })

  test('rejects values outside the bounds', async () => {
    const year = new Date().getFullYear()
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ birthYear: 1919 }, 'birthYear'],
      [{ birthYear: year - 9 }, 'birthYear'],
      [{ heightCm: 99 }, 'heightCm'],
      [{ heightCm: 231 }, 'heightCm'],
      [{ weightKg: 29 }, 'weightKg'],
      [{ weightKg: 251 }, 'weightKg'],
      [{ hrMax: 119 }, 'hrMax'],
      [{ hrMax: 231 }, 'hrMax'],
      [{ hrRest: 24 }, 'hrRest'],
      [{ hrRest: 111 }, 'hrRest'],
      [{ lthr: 99 }, 'lthr'],
      [{ lthr: 221 }, 'lthr'],
      [{ thresholdPaceSecPerKm: 149 }, 'thresholdPaceSecPerKm'],
      [{ thresholdPaceSecPerKm: 901 }, 'thresholdPaceSecPerKm'],
      [{ strengthPreference: 4 }, 'strengthPreference'],
      [{ homeLat: 91, homeLng: 0 }, 'homeLat'],
      [{ homeLat: 0, homeLng: 181 }, 'homeLng'],
      [{ longRunDay: 'someday' }, 'longRunDay'],
      [{ sex: 'other' }, 'sex'],
      [{ timezone: 'Mars/Olympus' }, 'timezone'],
      [{ availability: allDays(true, 601) }, 'availability.mon.maxMin'],
    ]
    for (const [body, path] of cases) {
      expect(await issuePaths(body), JSON.stringify(body)).toContain(path)
    }
  })

  test('rejects unknown keys, a partial availability and a malformed injury', async () => {
    expect(await issuePaths({ shoeSize: 42 })).toContain('')
    expect(await issuePaths({ availability: { mon: { available: true, maxMin: 30 } } })).toContain(
      'availability.tue',
    )
    expect(
      await issuePaths({
        injuries: [{ area: 'knee', side: 'up', year: 2020, month: 13, kind: 'other', notes: null }],
      }),
    ).toEqual(expect.arrayContaining(['injuries.0.side', 'injuries.0.month']))
  })

  test('requires the threshold HR to sit below HR max, counting the saved profile', async () => {
    expect(await issuePaths({ hrMax: 170, lthr: 170 })).toContain('lthr')
    await client(ctx, user).put('/api/profile').send({ hrMax: 180, lthr: 165 }).expect(200)
    expect(await issuePaths({ lthr: 185 })).toContain('lthr')
    expect(await issuePaths({ hrMax: 160 })).toContain('lthr')
  })

  test('requires both home coordinates or neither', async () => {
    expect(await issuePaths({ homeLat: 10 })).toContain('homeLng')
    await client(ctx, user).put('/api/profile').send({ homeLat: 10, homeLng: 10 }).expect(200)
    expect(await issuePaths({ homeLng: null })).toContain('homeLng')
  })

  test('saves nothing when validation fails', async () => {
    await client(ctx, user).put('/api/profile').send({ hrMax: 190, birthYear: 1800 }).expect(400)
    expect(await ctx.prisma.athleteProfile.count()).toBe(0)
  })
})
