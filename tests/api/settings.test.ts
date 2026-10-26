import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

interface Json {
  id: string
  email: string
  displayName: string | null
  duplicateStatus: string
  duplicateOfId: string | null
  distanceM: number | null
  error: { code: string; details: { issues: Array<{ path: string }> } }
}

/** The response body, typed for the fields these tests read. */
function json(res: { body: unknown }): Json {
  return res.body as Json
}

let ctx: TestCtx
let user: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterAll(async () => {
  await ctx.close()
})

describe('settings', () => {
  test('requires a session', async () => {
    const res = await client(ctx).get('/api/settings')
    expect(res.status).toBe(401)
  })

  test('GET returns email, displayName, units and weightUnit; PUT updates units and displayName', async () => {
    const before = await client(ctx, user).get('/api/settings')
    expect(before.status).toBe(200)
    expect(before.body).toEqual({
      email: 'runner@example.com',
      displayName: null,
      units: 'mi',
      weightUnit: 'lb',
    })

    const put = await client(ctx, user)
      .put('/api/settings')
      .send({ units: 'km', displayName: '  Sam  ' })
    expect(put.status).toBe(200)
    expect(put.body).toEqual({
      email: 'runner@example.com',
      displayName: 'Sam',
      units: 'km',
      weightUnit: 'lb',
    })

    const after = await client(ctx, user).get('/api/settings')
    expect(after.body).toEqual(put.body)

    const partial = await client(ctx, user).put('/api/settings').send({ units: 'mi' })
    expect(partial.body).toEqual({
      email: 'runner@example.com',
      displayName: 'Sam',
      units: 'mi',
      weightUnit: 'lb',
    })
  })

  test('PUT saves the weight unit apart from the distance unit, and rejects any other value', async () => {
    const kg = await client(ctx, user).put('/api/settings').send({ weightUnit: 'kg' })
    expect(kg.status).toBe(200)
    expect(kg.body).toMatchObject({ units: 'mi', weightUnit: 'kg' })
    expect((await client(ctx, user).get('/api/settings')).body).toMatchObject({
      units: 'mi',
      weightUnit: 'kg',
    })
    // Changing the distance unit leaves the weight unit alone, and the other way round.
    const km = await client(ctx, user).put('/api/settings').send({ units: 'km' })
    expect(km.body).toMatchObject({ units: 'km', weightUnit: 'kg' })
    const lb = await client(ctx, user).put('/api/settings').send({ weightUnit: 'lb' })
    expect(lb.body).toMatchObject({ units: 'km', weightUnit: 'lb' })

    const bad = await client(ctx, user).put('/api/settings').send({ weightUnit: 'stone' })
    expect(bad.status).toBe(400)
    expect(json(bad).error.code).toBe('validation')
    expect(json(bad).error.details.issues[0]?.path).toBe('weightUnit')
    expect((await client(ctx, user).get('/api/settings')).body).toMatchObject({ weightUnit: 'lb' })

    // The session user the web app reads at start-up carries it too.
    const me = await client(ctx, user).get('/api/auth/me')
    expect(me.body).toMatchObject({ weightUnit: 'lb' })
  })

  test('PUT validates: units must be mi or km, displayName at most 80 characters (empty string becomes null), unknown keys such as email are rejected', async () => {
    const badUnits = await client(ctx, user).put('/api/settings').send({ units: 'furlong' })
    expect(badUnits.status).toBe(400)
    expect(json(badUnits).error.code).toBe('validation')
    expect(json(badUnits).error.details.issues[0]?.path).toBe('units')

    const tooLong = await client(ctx, user)
      .put('/api/settings')
      .send({ displayName: 'x'.repeat(81) })
    expect(tooLong.status).toBe(400)
    expect(json(tooLong).error.details.issues[0]?.path).toBe('displayName')

    const maxLen = await client(ctx, user)
      .put('/api/settings')
      .send({ displayName: 'x'.repeat(80) })
    expect(maxLen.status).toBe(200)

    const empty = await client(ctx, user).put('/api/settings').send({ displayName: '   ' })
    expect(empty.status).toBe(200)
    expect(json(empty).displayName).toBeNull()

    const nulled = await client(ctx, user).put('/api/settings').send({ displayName: null })
    expect(json(nulled).displayName).toBeNull()

    const email = await client(ctx, user).put('/api/settings').send({ email: 'other@example.com' })
    expect(email.status).toBe(400)
    expect(json(email).error.code).toBe('validation')
    const unchanged = await client(ctx, user).get('/api/settings')
    expect(json(unchanged).email).toBe('runner@example.com')
  })
})
