import express from 'express'
import { pino } from 'pino'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  CLIENT_ERROR_BODY_LIMIT,
  CLIENT_ERROR_LOG_MESSAGE,
  clientErrorsRouter,
} from '../../server/routes/clientErrors.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

const report = {
  message: 'Cannot read properties of undefined',
  stack: 'TypeError: Cannot read properties of undefined\n    at Page (page.js:1:1)',
  componentStack: '\n    at Page\n    at PageBoundary',
  path: '/',
  buildId: 'abc123def456',
  userAgent: 'Mozilla/5.0 (iPhone) Safari',
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

describe('POST /api/client-errors', () => {
  test('an anonymous report is 401', async () => {
    const res = await client(ctx).post('/api/client-errors').send(report)
    expect(res.status).toBe(401)
  })

  test('a signed-in report is 204 with no body', async () => {
    const res = await client(ctx, user).post('/api/client-errors').send(report)
    expect(res.status).toBe(204)
    expect(res.text).toBe('')
  })

  test.each([
    ['a missing field', { ...report, message: undefined }],
    ['an unknown field', { ...report, extra: 'x' }],
    ['a field over its length', { ...report, message: 'x'.repeat(2001) }],
  ])('%s is 400', async (_name, body) => {
    const res = await client(ctx, user).post('/api/client-errors').send(body)
    expect(res.status).toBe(400)
    expect((res.body as { error: { code: string } }).error.code).toBe('validation')
  })

  test('a body over 16 KB is 413', async () => {
    const res = await client(ctx, user)
      .post('/api/client-errors')
      .send({ ...report, stack: 'x'.repeat(20 * 1024) })
    expect(res.status).toBe(413)
  })

  test('the sixth report in a minute is 429', async () => {
    const limited = await createTestCtx()
    const runner = await seedUser(limited)
    for (let i = 0; i < 5; i++) {
      const ok = await client(limited, runner).post('/api/client-errors').send(report)
      expect(ok.status).toBe(204)
    }
    const res = await client(limited, runner).post('/api/client-errors').send(report)
    expect(res.status).toBe(429)
    await limited.close()
  })
})

describe('the log line of a client error', () => {
  test('is one warn with the fixed message and the fields, and no cookie or token', async () => {
    const lines: Array<Record<string, unknown>> = []
    const logger = pino(
      { level: 'info' },
      {
        write: (line: string) => {
          lines.push(JSON.parse(line) as Record<string, unknown>)
        },
      },
    )
    const app = express()
    app.use(express.json({ limit: CLIENT_ERROR_BODY_LIMIT }))
    app.use('/api/client-errors', clientErrorsRouter(logger))

    const res = await request(app)
      .post('/api/client-errors')
      .set('Cookie', 'rl_session=secret-session-value')
      .set('Authorization', 'Bearer secret-token')
      .send(report)
    expect(res.status).toBe(204)

    expect(lines).toHaveLength(1)
    const line = lines[0] ?? {}
    expect(line['level']).toBe(40)
    expect(line['msg']).toBe(CLIENT_ERROR_LOG_MESSAGE)
    expect(line['msg']).toBe('client error')
    for (const [key, value] of Object.entries(report)) expect(line[key]).toBe(value)
    const text = JSON.stringify(line)
    expect(text).not.toContain('secret-session-value')
    expect(text).not.toContain('secret-token')
  })
})
