// API JSON is compressed for a client that accepts it, above a size threshold (`app.ts`, the
// `compression` package); small answers and clients that ask for no encoding get the plain body.
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
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

describe('API compression', () => {
  test('a large JSON answer is gzipped for a client that accepts gzip, and decodes to the same body', async () => {
    const plain = await client(ctx, user)
      .get('/api/research/params')
      .set('Accept-Encoding', 'identity')
    expect(plain.status).toBe(200)
    expect(plain.headers['content-encoding']).toBeUndefined()

    const gzipped = await client(ctx, user)
      .get('/api/research/params')
      .set('Accept-Encoding', 'gzip')
    expect(gzipped.status).toBe(200)
    expect(gzipped.headers['content-encoding']).toBe('gzip')
    expect(gzipped.headers['vary']).toMatch(/Accept-Encoding/i)
    expect(gzipped.body).toEqual(plain.body)
  })

  test('brotli is used when the client prefers it', async () => {
    const res = await client(ctx, user)
      .get('/api/research/params')
      .set('Accept-Encoding', 'br, gzip')
    expect(res.headers['content-encoding']).toBe('br')
  })

  test('a small answer is not compressed', async () => {
    const res = await client(ctx).get('/api/health').set('Accept-Encoding', 'gzip')
    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.body).toEqual({ status: 'ok' })
  })
})
