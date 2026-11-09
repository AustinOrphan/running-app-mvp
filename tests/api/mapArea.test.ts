import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { OVERPASS_URL, OVERPASS_USER_AGENT } from '../../server/services/mapArea.ts'
import { trackRow } from '../../server/services/activityStore.ts'
import { TRACK_VERSION, buildTrack, type RoutePoint } from '../../shared/importers/files/track.ts'
import type { ApiErrorBody, MapAreaView } from '../../shared/types.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { line, overpassAnswer, threeWays, type FakeWay } from '../fixtures/surface.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'map-area-other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.mapWay.deleteMany()
  await ctx.prisma.mapArea.deleteMany()
  await ctx.prisma.activity.deleteMany()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

async function addRun(userId: string, route: RoutePoint[], date = '2026-10-05'): Promise<string> {
  const track = buildTrack(route)!
  const activity = await ctx.prisma.activity.create({
    data: { userId, type: 'run', date, durationSec: 1800, distanceM: 1000, trackV: TRACK_VERSION },
  })
  await ctx.prisma.activityTrack.create({
    data: { activityId: activity.id, ...trackRow(track) },
  })
  return activity.id
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

/** A fetch that answers Overpass with `ways` and records each call. */
function overpass(ways: readonly FakeWay[] = threeWays(), opts: { remark?: string } = {}) {
  const calls: Array<{ url: string; headers: Headers; body: string }> = []
  ctx.fetch = fakeFetch({
    [`POST ${OVERPASS_URL}`]: async (req) => {
      calls.push({ url: req.url, headers: req.headers, body: await req.text() })
      return json(overpassAnswer(ways, opts))
    },
  })
  return calls
}

/** The message of an error answer. */
const errorOf = (res: { body: unknown }): string => (res.body as ApiErrorBody).error.message

const post = (u: TestUser | null = user) =>
  client(ctx, u ?? undefined)
    .post('/api/map-area')
    .send({})
const get = (u: TestUser | null = user) => client(ctx, u ?? undefined).get('/api/map-area')
const del = (u: TestUser | null = user) => client(ctx, u ?? undefined).delete('/api/map-area')

describe('map area routes', () => {
  test('need a session, before anything is read', async () => {
    expect((await get(null)).status).toBe(401)
    expect((await post(null)).status).toBe(401)
    expect((await del(null)).status).toBe(401)
    // A body that is not JSON is a 401, not a 400: authentication comes first.
    const res = await client(ctx)
      .post('/api/map-area')
      .set('Content-Type', 'application/json')
      .send('{not json')
    expect(res.status).toBe(401)
  })

  test('refuse a cross-site write before any request to OpenStreetMap', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    const calls = overpass()
    const res = await client(ctx, user)
      .post('/api/map-area')
      .set('Origin', 'http://evil.example')
      .send({})
    expect(res.status).toBe(403)
    const gone = await client(ctx, user)
      .delete('/api/map-area')
      .set('Origin', 'http://evil.example')
    expect(gone.status).toBe(403)
    expect(calls).toHaveLength(0)
    expect(await ctx.prisma.mapArea.count()).toBe(0)
  })

  test('start empty', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ area: null, busy: false })
  })

  test('the download needs a stored route', async () => {
    const calls = overpass()
    const res = await post()
    expect(res.status).toBe(400)
    expect(errorOf(res)).toMatch(/no route is stored/i)
    expect(calls).toHaveLength(0)
  })

  test('the download takes no body', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    const calls = overpass()
    const res = await client(ctx, user)
      .post('/api/map-area')
      .send({ runs: ['a'] })
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test('asks Overpass once with the box alone, and stores the ways by class', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    const calls = overpass([
      ...threeWays(),
      {
        id: 9,
        tags: { highway: 'motorway' },
        at: [
          [-900, 500],
          [900, 500],
        ],
      },
      {
        id: 10,
        tags: { building: 'yes' },
        at: [
          [-900, 600],
          [900, 600],
        ],
      },
      {
        id: 11,
        tags: { highway: 'footway' },
        at: [
          [-900, 700],
          [900, 700],
        ],
      },
    ])
    const res = await post()
    expect(res.status).toBe(200)

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.url).toBe(OVERPASS_URL)
    expect(call.headers.get('user-agent')).toBe(OVERPASS_USER_AGENT)
    expect(OVERPASS_USER_AGENT).not.toMatch(/@/)
    const sent = new URLSearchParams(call.body)
    expect([...sent.keys()]).toEqual(['data'])
    const query = sent.get('data')!
    expect(query).toContain('["highway"]')
    expect(query).toMatch(/\(\d+\.\d\d,-?\d+\.\d\d,\d+\.\d\d,-?\d+\.\d\d\);/)
    expect(query).toContain('out tags geom')
    // Nothing of the runner but the box: no activity id, no route, no coordinate with more than 2 decimals.
    const row = await ctx.prisma.mapArea.findUniqueOrThrow({ where: { userId: user.id } })
    expect(query).toContain(row.minLat.toFixed(2))
    expect(query).not.toMatch(/-?\d+\.\d{3,}/)
    expect(query).not.toContain(user.id)

    const view = res.body as MapAreaView
    expect(view.busy).toBe(false)
    expect(view.area).toMatchObject({
      wayCount: 4,
      dataTimestamp: '2026-11-08T09:00:00Z',
      outdated: false,
      runs: 1,
      done: 0,
    })
    const ways = await ctx.prisma.mapWay.findMany({
      where: { userId: user.id },
      orderBy: { seq: 'asc' },
    })
    expect(ways.map((w) => w.cls)).toEqual(['t', 'r', 'p', 'u'])
    expect(ways.every((w) => w.polyline.length > 0)).toBe(true)
    expect((await get()).body).toEqual(view)
  })

  test('downloading again replaces the ways and clears every run’s shares', async () => {
    const id = await addRun(user.id, line([-500, 0], [500, 0]))
    overpass()
    await post()
    await ctx.prisma.activity.update({
      where: { id },
      data: { surfaceBins: JSON.stringify({ v: 1, trailM: 1, pavedM: 0, roadM: 0, unknownM: 0 }) },
    })
    overpass(threeWays().slice(0, 2))
    const res = await post()
    expect((res.body as MapAreaView).area?.wayCount).toBe(2)
    expect(await ctx.prisma.mapWay.count({ where: { userId: user.id } })).toBe(2)
    expect((await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })).surfaceBins).toBeNull()
  })

  test.each([
    ['429', () => new Response('busy', { status: 429 }), 502, /status 429/],
    ['504', () => new Response('gateway', { status: 504 }), 502, /status 504/],
    ['an answer that is not JSON', () => new Response('<html>nope</html>'), 502, /could not read/],
    [
      'an answer that says the query stopped',
      () =>
        json(
          overpassAnswer(threeWays(), {
            remark: 'runtime error: Query timed out in "query" at line 3 after 121 seconds.',
          }),
        ),
      502,
      /stopped before it finished/,
    ],
    ['an answer with no ways', () => json(overpassAnswer([])), 502, /no roads or paths/],
  ])('%s is a plain error and changes nothing', async (_name, answer, status, message) => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    overpass()
    await post()
    const before = await ctx.prisma.mapArea.findUniqueOrThrow({ where: { userId: user.id } })
    ctx.fetch = fakeFetch({ [`POST ${OVERPASS_URL}`]: answer })
    const res = await post()
    expect(res.status).toBe(status)
    expect(errorOf(res)).toMatch(message)
    expect(errorOf(res)).toMatch(/nothing was changed/i)
    const after = await ctx.prisma.mapArea.findUniqueOrThrow({ where: { userId: user.id } })
    expect(after).toEqual(before)
    expect(await ctx.prisma.mapWay.count({ where: { userId: user.id } })).toBe(3)
  })

  test('an oversize answer with no Content-Length is cut off while streaming, and refused', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    let sent = 0
    let cancelled = false
    ctx.fetch = fakeFetch({
      [`POST ${OVERPASS_URL}`]: () => {
        const chunk = new Uint8Array(4 * 1024 * 1024).fill(32)
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            sent += 1
            controller.enqueue(chunk)
            if (sent > 200) controller.close()
          },
          cancel() {
            cancelled = true
          },
        })
        return new Response(body, { status: 200 })
      },
    })
    const res = await post()
    expect(res.status).toBe(502)
    expect(errorOf(res)).toMatch(/more map data than the app can take/)
    expect(cancelled).toBe(true)
    // Stopped soon after the cap (80 MB = 20 chunks), not at the end of the stream.
    expect(sent).toBeLessThan(40)
    expect(await ctx.prisma.mapArea.count()).toBe(0)
  })

  test('a declared oversize answer is refused without reading it', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    ctx.fetch = fakeFetch({
      [`POST ${OVERPASS_URL}`]: () =>
        new Response('{}', {
          status: 200,
          headers: { 'Content-Length': String(500 * 1024 * 1024) },
        }),
    })
    const res = await post()
    expect(res.status).toBe(502)
    expect(errorOf(res)).toMatch(/more map data than the app can take/)
  })

  test('a normal answer streamed in pieces with no Content-Length is stored', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    const bytes = new TextEncoder().encode(JSON.stringify(overpassAnswer(threeWays())))
    ctx.fetch = fakeFetch({
      [`POST ${OVERPASS_URL}`]: () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (let at = 0; at < bytes.length; at += 100) {
              controller.enqueue(bytes.slice(at, at + 100))
            }
            controller.close()
          },
        })
        return new Response(body, { status: 200 })
      },
    })
    const res = await post()
    expect(res.status).toBe(200)
    expect((res.body as MapAreaView).area?.wayCount).toBe(3)
  })

  test('a timeout is a 504 with a plain message', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    ctx.fetch = () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))
    const res = await post()
    expect(res.status).toBe(504)
    expect(errorOf(res)).toMatch(/did not answer in time/)
    expect(await ctx.prisma.mapArea.count()).toBe(0)
  })

  test('an unreachable server is a 502', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    ctx.fetch = () => Promise.reject(new TypeError('fetch failed'))
    const res = await post()
    expect(res.status).toBe(502)
    expect(errorOf(res)).toMatch(/could not be reached/)
  })

  test('runs one download at a time per runner', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    await addRun(other.id, line([-500, 0], [500, 0]))
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started = 0
    ctx.fetch = fakeFetch({
      [`POST ${OVERPASS_URL}`]: async () => {
        started += 1
        await gate
        return json(overpassAnswer(threeWays()))
      },
    })
    const first = post().then((r) => r)
    await expect.poll(() => started).toBe(1)

    const second = await post()
    expect(second.status).toBe(409)
    expect(errorOf(second)).toMatch(/already running/)
    expect((await get()).body).toMatchObject({ busy: true })
    // Another runner is not held up by this one's download.
    const third = post(other).then((r) => r)
    await expect.poll(() => started).toBe(2)

    release()
    expect((await first).status).toBe(200)
    expect((await third).status).toBe(200)
    expect(started).toBe(2)
    expect((await get()).body).toMatchObject({ busy: false })
    // And the lock is gone: a new download is accepted.
    release = () => undefined
    expect((await post()).status).toBe(200)
  })

  test('a failed download frees the lock', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    ctx.fetch = fakeFetch({ [`POST ${OVERPASS_URL}`]: () => new Response('x', { status: 500 }) })
    expect((await post()).status).toBe(502)
    overpass()
    expect((await post()).status).toBe(200)
  })

  test('one runner’s area is invisible and untouchable to another', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    overpass()
    await post()
    expect((await get(other)).body).toEqual({ area: null, busy: false })
    expect((await del(other)).status).toBe(200)
    expect(await ctx.prisma.mapWay.count({ where: { userId: user.id } })).toBe(3)
    expect(await ctx.prisma.mapArea.count({ where: { userId: user.id } })).toBe(1)
  })

  test('the area only counts the other runner’s runs for that runner', async () => {
    await addRun(user.id, line([-500, 0], [500, 0]))
    await addRun(other.id, line([-500, 0], [500, 0]))
    await addRun(other.id, line([-400, 0], [400, 0]), '2026-10-06')
    overpass()
    expect(((await post()).body as MapAreaView).area?.runs).toBe(1)
  })

  test('clearing the shares holds every run’s updatedAt', async () => {
    const id = await addRun(user.id, line([-500, 0], [500, 0]))
    overpass()
    await post()
    const bins = JSON.stringify({ v: 1, trailM: 1, pavedM: 0, roadM: 0, unknownM: 0 })
    await ctx.prisma.activity.update({ where: { id }, data: { surfaceBins: bins } })
    const before = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
    await post()
    expect((await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })).updatedAt).toEqual(
      before.updatedAt,
    )
    await ctx.prisma.activity.updateMany({
      where: { id },
      data: { surfaceBins: bins, updatedAt: before.updatedAt },
    })
    await del()
    const after = await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
    expect(after.surfaceBins).toBeNull()
    expect(after.updatedAt).toEqual(before.updatedAt)
  })

  test('removing deletes the ways and the area and clears the shares, and is idempotent', async () => {
    const id = await addRun(user.id, line([-500, 0], [500, 0]))
    overpass()
    await post()
    await ctx.prisma.activity.update({
      where: { id },
      data: { surfaceBins: JSON.stringify({ v: 1, trailM: 1, pavedM: 0, roadM: 0, unknownM: 0 }) },
    })
    const res = await del()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ area: null, busy: false })
    expect(await ctx.prisma.mapWay.count({ where: { userId: user.id } })).toBe(0)
    expect(await ctx.prisma.mapArea.count({ where: { userId: user.id } })).toBe(0)
    expect((await ctx.prisma.activity.findUniqueOrThrow({ where: { id } })).surfaceBins).toBeNull()
    expect((await del()).status).toBe(200)
  })
})
