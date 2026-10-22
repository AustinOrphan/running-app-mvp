import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Activity, ActivityDetail } from '../../shared/types.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.activity.deleteMany()
})

async function seedActivity(userId = user.id) {
  return ctx.prisma.activity.create({
    data: { userId, date: '2026-01-05', type: 'run', durationSec: 1800, source: 'file' },
  })
}

async function seedFile(
  activityId: string,
  format: 'fit' | 'gpx',
  fileName: string,
  bytes: Buffer,
) {
  await ctx.prisma.activityFile.create({
    data: {
      activityId,
      format,
      fileName,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      gz: new Uint8Array(gzipSync(bytes)),
    },
  })
}

function patch(id: string, body: object, as: TestUser = user) {
  return request(ctx.app)
    .patch(`/api/activities/${id}/feedback`)
    .set('Host', 'app.test')
    .set('Origin', 'http://app.test')
    .set('Cookie', as.cookie)
    .send(body)
}

describe('GET /api/activities/:id/detail', () => {
  test('returns the activity, the stream with sampleSec, laps and hasFile', async () => {
    const activity = await seedActivity()
    const stream = {
      t: [0, 10, 20],
      d: [0, 30, 60],
      hr: [120, null, 130],
      alt: null,
      cad: null,
      pwr: null,
    }
    const laps = [
      { startSec: 0, durationSec: 20, distanceM: 60, avgHr: 125, maxHr: 130, avgCadence: null },
    ]
    await ctx.prisma.activityStream.create({
      data: {
        activityId: activity.id,
        sampleSec: 10,
        data: JSON.stringify(stream),
        laps: JSON.stringify(laps),
      },
    })
    await seedFile(activity.id, 'gpx', 'a.gpx', Buffer.from('<gpx/>'))
    const res = await client(ctx, user).get(`/api/activities/${activity.id}/detail`)
    expect(res.status).toBe(200)
    const body = res.body as ActivityDetail
    expect(body.activity.id).toBe(activity.id)
    expect(body.stream).toEqual({ ...stream, sampleSec: 10 })
    expect(body.laps).toEqual(laps)
    expect(body.hasFile).toBe(true)
  })

  test('an activity with no stream, laps or file has nulls and hasFile false', async () => {
    const activity = await seedActivity()
    const res = await client(ctx, user).get(`/api/activities/${activity.id}/detail`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ stream: null, laps: null, hasFile: false })
  })

  test('another user or an unknown id is 404', async () => {
    const activity = await seedActivity()
    expect((await client(ctx, other).get(`/api/activities/${activity.id}/detail`)).status).toBe(404)
    expect((await client(ctx, user).get('/api/activities/nope/detail')).status).toBe(404)
  })
})

describe('GET /api/activities/:id/file', () => {
  test('streams the original bytes as an attachment', async () => {
    const activity = await seedActivity()
    const bytes = Buffer.from([0x0e, 0x10, 0x00, 0xff, 0x41])
    await seedFile(activity.id, 'fit', 'my "run".fit', bytes)
    const res = await client(ctx, user)
      .get(`/api/activities/${activity.id}/file`)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = []
        r.on('data', (chunk: Buffer) => chunks.push(chunk))
        r.on('end', () => done(null, Buffer.concat(chunks)))
      })
    expect(res.status).toBe(200)
    expect(Buffer.from(res.body as Buffer).equals(bytes)).toBe(true)
    const disposition = String(res.headers['content-disposition'])
    expect(disposition).toMatch(/^attachment; filename="[^"\\]*\.fit"/)
    expect(disposition).not.toContain('my "run"')
  })

  test('404 without a file and for another user', async () => {
    const activity = await seedActivity()
    expect((await client(ctx, user).get(`/api/activities/${activity.id}/file`)).status).toBe(404)
    await seedFile(activity.id, 'gpx', 'a.gpx', Buffer.from('<gpx/>'))
    expect((await client(ctx, other).get(`/api/activities/${activity.id}/file`)).status).toBe(404)
  })
})

describe('feel and pain', () => {
  const body = { date: '2026-01-05', type: 'run', durationSec: 1800, feel: -1, pain: 3 }

  test('POST stores them and PUT without them leaves them alone', async () => {
    const created = await client(ctx, user).post('/api/activities').send(body)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ feel: -1, pain: 3 })
    const id = (created.body as Activity).id
    const { feel: _feel, pain: _pain, ...withoutFeedback } = body
    const updated = await client(ctx, user).put(`/api/activities/${id}`).send(withoutFeedback)
    expect(updated.body).toMatchObject({ feel: -1, pain: 3 })
    const cleared = await client(ctx, user)
      .put(`/api/activities/${id}`)
      .send({ ...withoutFeedback, feel: null, pain: null })
    expect(cleared.body).toMatchObject({ feel: null, pain: null })
  })

  test('out-of-range values are rejected', async () => {
    for (const bad of [{ feel: 3 }, { feel: -3 }, { feel: 0.5 }, { pain: 11 }, { pain: -1 }]) {
      const res = await client(ctx, user)
        .post('/api/activities')
        .send({ ...body, ...bad })
      expect(res.status).toBe(400)
    }
  })
})

describe('PATCH /api/activities/:id/feedback', () => {
  test('updates only the fields sent and null clears one', async () => {
    const activity = await seedActivity()
    const first = await patch(activity.id, { rpe: 6, feel: 1, pain: 2 })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ id: activity.id, rpe: 6, feel: 1, pain: 2 })
    const second = await patch(activity.id, { pain: null })
    expect(second.body).toMatchObject({ rpe: 6, feel: 1, pain: null })
    const row = await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activity.id } })
    expect(row).toMatchObject({ rpe: 6, feel: 1, pain: null })
  })

  test('bounds, unknown fields and other users', async () => {
    const activity = await seedActivity()
    expect((await patch(activity.id, { rpe: 0 })).status).toBe(400)
    expect((await patch(activity.id, { rpe: 11 })).status).toBe(400)
    expect((await patch(activity.id, { feel: 2.5 })).status).toBe(400)
    expect((await patch(activity.id, { pain: 11 })).status).toBe(400)
    expect((await patch(activity.id, { notes: 'x' })).status).toBe(400)
    expect((await patch(activity.id, { rpe: 5 }, other)).status).toBe(404)
    expect((await patch('nope', { rpe: 5 })).status).toBe(404)
  })
})
