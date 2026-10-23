import http, { type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// The request pipeline (phase 3a design 4.8): no JSON body is parsed before the caller is known.
// Sign-in and setup read at most 16 KB, the ingest route checks its push token before its 16 MB
// parser, and every other parser sits behind the session check. So an anonymous request is refused
// with 401 whatever its body, and 413 is only ever the answer to a caller who is allowed in.

const MB = 1024 * 1024

let ctx: TestCtx
let user: TestUser
let server: Server

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  server = ctx.app.listen(0)
})

afterAll(async () => {
  server.close()
  await ctx.close()
})

interface Answer {
  status: number
  body: { error?: { code?: string; message?: string } }
}

/**
 * One POST over a plain socket. Superagent asks for `Connection: close`, and a server that answers
 * before it has read a large body then closes the socket under the writer (`EPIPE`); an ordinary
 * client keeps the connection alive and receives the answer. These tests need the answer.
 */
function post(
  path: string,
  text: string,
  headers: Record<string, string> = {},
  sameOrigin = true,
): Promise<Answer> {
  const body = Buffer.from(text)
  return new Promise((resolve, reject) => {
    let status: number | null = null
    const request = http.request(
      {
        port: (server.address() as AddressInfo).port,
        method: 'POST',
        path,
        headers: {
          'content-type': 'application/json',
          'content-length': body.length,
          ...(sameOrigin ? { host: 'app.test', origin: 'http://app.test' } : {}),
          ...headers,
        },
      },
      (response) => {
        status = response.statusCode ?? 0
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString()
          resolve({
            status: status ?? 0,
            body: raw === '' ? {} : (JSON.parse(raw) as Answer['body']),
          })
        })
      },
    )
    request.on('error', (error) => {
      if (status === null) reject(error)
    })
    request.end(body)
  })
}

const json = (bytes: number) => JSON.stringify({ padding: 'x'.repeat(bytes) })

describe('request pipeline: parsers run after authentication', () => {
  test.each([
    ['/api/activities', 2 * MB],
    ['/api/goals', 2 * MB],
    ['/api/imports/csv', 11 * MB],
    ['/api/imports/files', 17 * MB],
    ['/api/imports/parsed', 17 * MB],
  ])('an anonymous %s with a body of %d bytes is 401, not 413', async (path, bytes) => {
    const res = await post(path, json(bytes))
    expect(res.status).toBe(401)
    expect(res.body.error?.code).toBe('unauthorized')
  })

  test('an anonymous body that is not JSON is 401, and a signed-in one is 400', async () => {
    const anonymous = await post('/api/activities', '{"date":')
    expect(anonymous.status).toBe(401)
    const signedIn = await post('/api/activities', '{"date":', { cookie: user.cookie })
    expect(signedIn.status).toBe(400)
    expect(signedIn.body.error?.message).toBe('The request body is not valid JSON.')
  })

  test('ingest: a wrong or missing push token is 401 for a 5 MB body that is not even JSON', async () => {
    const notJson = `{"data":${'x'.repeat(5 * MB)}`
    const wrong = await post('/api/ingest/apple-health', notJson, {
      authorization: 'Bearer not-a-real-token',
    })
    expect(wrong.status).toBe(401)
    const missing = await post('/api/ingest/apple-health', notJson)
    expect(missing.status).toBe(401)
  })

  test('ingest: a valid token reaches the 16 MB parser, and only then can a body be too large', async () => {
    const issued = await client(ctx, user)
      .post('/api/integrations/apple-health/push-token')
      .send({})
    const token = (issued.body as { token: string }).token
    const headers = { authorization: `Bearer ${token}` }

    const big = await post('/api/ingest/apple-health', json(17 * MB), headers, false)
    expect(big.status).toBe(413)
    expect(big.body.error?.code).toBe('validation')

    // 5 MB is over the 1 MB limit of ordinary routes and under this route's 16 MB: the provider
    // reads it, whatever it then makes of the content.
    const medium = await post('/api/ingest/apple-health', json(5 * MB), headers, false)
    expect(medium.status).not.toBe(413)
    expect(medium.status).not.toBe(401)

    // The same body without the token never reaches a parser.
    const anonymous = await post('/api/ingest/apple-health', json(17 * MB), {}, false)
    expect(anonymous.status).toBe(401)
  })

  test('ingest: a provider that takes no push is 404 before any body is read', async () => {
    const res = await post('/api/ingest/strava', json(17 * MB), {}, false)
    expect(res.status).toBe(404)
  })

  test('sign-in and setup read at most 16 KB, signed in or not', async () => {
    for (const path of ['/api/auth/login', '/api/setup']) {
      const over = await post(path, json(20 * 1024))
      expect(over.status, path).toBe(413)
      const under = await post(
        path,
        JSON.stringify({ email: 'a@example.com', password: 'p'.repeat(15 * 1024) }),
      )
      expect([400, 401, 409], path).toContain(under.status)
    }
  })
})
