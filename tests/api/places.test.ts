import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { trackRow } from '../../server/services/activityStore.ts'
import { loadRunnerDay } from '../../server/runnerDay.ts'
import { addDays } from '../../shared/dates.ts'
import { TRACK_VERSION, buildTrack } from '../../shared/importers/files/track.ts'
import type { ApiErrorBody } from '../../shared/types.ts'
import { fakeFetch } from '../fakeFetch.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// Every log line of the app goes here, so a test can look for what must never be in one.
const logged = vi.hoisted(() => ({ lines: [] as string[] }))
vi.mock('../../server/logger.ts', async () => {
  const { Writable } = await import('node:stream')
  const { pino } = await import('pino')
  return {
    createLogger: () =>
      pino(
        { level: 'info' },
        new Writable({
          write(chunk: Buffer, _encoding, done) {
            logged.lines.push(chunk.toString())
            done()
          },
        }),
      ),
  }
})

const GEOCODER = 'https://geocoding-api.open-meteo.com/v1/search'

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'places-other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  logged.lines.length = 0
  await ctx.prisma.activity.deleteMany()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

/** A geocoder that answers `answer` and records the URLs it was called with. */
function geocoder(answer: () => Response | Promise<Response>) {
  const urls: string[] = []
  ctx.fetch = fakeFetch({
    [`GET ${GEOCODER}`]: async (req) => {
      urls.push(req.url)
      return answer()
    },
  })
  return urls
}

interface PlaceBody {
  name: string
  region: string | null
  country: string | null
  lat: number
  lng: number
}
const placesOf = (res: { body: unknown }): PlaceBody[] =>
  (res.body as { places: PlaceBody[] }).places
const startOf = (res: { body: unknown }) =>
  (res.body as { start: { lat: number; lng: number; runs: number; of: number } | null }).start

const search = (query: unknown, u: TestUser | null = user) =>
  client(ctx, u ?? undefined)
    .post('/api/places/search')
    .send({ query })

describe('POST /api/places/search', () => {
  test('maps the geocoder results and rounds the coordinates to 0.01 degrees', async () => {
    const urls = geocoder(() =>
      json({
        results: [
          {
            id: 1,
            name: 'Exampleton',
            admin1: 'Sample State',
            country: 'Testland',
            latitude: 45.0049,
            longitude: -93.0051,
            population: 1000,
          },
          { name: 'Postal Centre', latitude: -12.346, longitude: 0.001 },
        ],
      }),
    )
    const res = await search('Exampleton')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      places: [
        { name: 'Exampleton', region: 'Sample State', country: 'Testland', lat: 45, lng: -93.01 },
        { name: 'Postal Centre', region: null, country: null, lat: -12.35, lng: 0 },
      ],
    })
    expect(urls).toHaveLength(1)
    const url = new URL(urls[0]!)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: 'Exampleton',
      count: '10',
      language: 'en',
      format: 'json',
    })
  })

  test('trims the query and sends only that text', async () => {
    const urls = geocoder(() => json({}))
    expect((await search('  Exampleton  ')).status).toBe(200)
    expect(new URL(urls[0]!).searchParams.get('name')).toBe('Exampleton')
  })

  test('merges results that round to the same cell with the same name', async () => {
    geocoder(() =>
      json({
        results: [
          { name: 'Dupeville', admin1: 'A', latitude: 10.001, longitude: 20.002 },
          { name: 'Dupeville', admin1: 'B', latitude: 10.004, longitude: 19.996 },
          { name: 'Dupeville', latitude: 10.2, longitude: 20.2 },
          { name: 'Other', latitude: 10.001, longitude: 20.002 },
        ],
      }),
    )
    const res = await search('Dupeville')
    expect(placesOf(res)).toEqual([
      { name: 'Dupeville', region: 'A', country: null, lat: 10, lng: 20 },
      { name: 'Dupeville', region: null, country: null, lat: 10.2, lng: 20.2 },
      { name: 'Other', region: null, country: null, lat: 10, lng: 20 },
    ])
  })

  test('answers at most 8 places', async () => {
    geocoder(() =>
      json({
        results: Array.from({ length: 10 }, (_, i) => ({
          name: `Place ${String(i)}`,
          latitude: 10 + i,
          longitude: 20,
        })),
      }),
    )
    const res = await search('Place')
    expect(placesOf(res)).toHaveLength(8)
    expect(placesOf(res)[7]?.name).toBe('Place 7')
  })

  test('answers an empty list, not an error, when nothing matches', async () => {
    geocoder(() => json({ generationtime_ms: 0.4 }))
    const res = await search('Nowhere')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ places: [] })
  })

  test('answers 502 with the places.unavailable code when the geocoder fails', async () => {
    geocoder(() => new Response('boom', { status: 500 }))
    const res = await search('Exampleton')
    expect(res.status).toBe(502)
    const error = (res.body as ApiErrorBody).error
    expect(error.code).toBe('places.unavailable')
    expect(error.message).toMatch(/not available/)
    expect(error.message).not.toContain('Exampleton')
  })

  test('answers 502 on a body that is not JSON', async () => {
    geocoder(() => new Response('<html>', { status: 200 }))
    expect((await search('Exampleton')).status).toBe(502)
  })

  test('answers 502 when the geocoder times out, and sends a 5 s abort signal', async () => {
    const signals: Array<AbortSignal | undefined> = []
    ctx.fetch = (_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined)
      return Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))
    }
    const res = await search('Exampleton')
    expect(res.status).toBe(502)
    expect((res.body as ApiErrorBody).error.code).toBe('places.unavailable')
    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })

  test('refuses a query of 1 or 81 characters, and anything but a string', async () => {
    const calls = geocoder(() => json({}))
    for (const query of ['a', ' a ', 'x'.repeat(81), '', 5, undefined]) {
      const res = await search(query)
      expect(res.status).toBe(400)
      expect((res.body as ApiErrorBody).error.code).toBe('validation')
    }
    expect(calls).toHaveLength(0)
    expect((await search('ab')).status).toBe(200)
    expect((await search('x'.repeat(80))).status).toBe(200)
  })

  test('needs a session, before the body is read', async () => {
    const calls = geocoder(() => json({}))
    expect((await search('Exampleton', null)).status).toBe(401)
    const res = await client(ctx)
      .post('/api/places/search')
      .set('Content-Type', 'application/json')
      .send('{not json')
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  test('writes no log line that holds the typed text', async () => {
    const typed = 'zqxjkv-unusual-name'
    geocoder(() => json({ results: [{ name: typed, latitude: 1, longitude: 2 }] }))
    expect((await search(typed)).status).toBe(200)
    geocoder(() => new Response('boom', { status: 500 }))
    expect((await search(typed)).status).toBe(502)
    expect((await search(`${typed}`.repeat(10))).status).toBe(400)
    expect(logged.lines.length).toBeGreaterThan(0)
    expect(logged.lines.join('')).not.toContain(typed)
  })
})

/** A run whose recorded route starts at `lat`, `lng` and goes about 300 m north. */
async function addRun(
  userId: string,
  start: { lat: number; lng: number },
  date: string,
  type = 'run',
): Promise<void> {
  const route = Array.from({ length: 31 }, (_, i) => ({
    lat: start.lat + (i * 10) / 111_320,
    lng: start.lng,
    d: i * 10,
    t: i * 10,
  }))
  const track = buildTrack(route)!
  const activity = await ctx.prisma.activity.create({
    data: { userId, type, date, durationSec: 1800, distanceM: 300, trackV: TRACK_VERSION },
  })
  await ctx.prisma.activityTrack.create({ data: { activityId: activity.id, ...trackRow(track) } })
}

const usual = (u: TestUser | null = user) =>
  client(ctx, u ?? undefined).get('/api/places/usual-start')

describe('GET /api/places/usual-start', () => {
  let today: string
  beforeEach(async () => {
    today = (await loadRunnerDay(ctx.prisma, user.id)).today
  })
  const ago = (days: number) => addDays(today, -days)

  test('needs a session', async () => {
    expect((await usual(null)).status).toBe(401)
  })

  test('is null when no run has a track', async () => {
    await ctx.prisma.activity.create({
      data: { userId: user.id, type: 'run', date: ago(1), durationSec: 1800, distanceM: 5000 },
    })
    const res = await usual()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ start: null })
  })

  test('is the dominant cell with its counts, rounded to 0.01 degrees', async () => {
    await addRun(user.id, { lat: 45.0012, lng: -93.0013 }, ago(5))
    await addRun(user.id, { lat: 45.0031, lng: -92.9972 }, ago(4))
    await addRun(user.id, { lat: 45.0004, lng: -93.0041 }, ago(3))
    await addRun(user.id, { lat: 46.5, lng: -92.0 }, ago(2))
    const res = await usual()
    expect(res.body).toEqual({ start: { lat: 45, lng: -93, runs: 3, of: 4 } })
  })

  test('uses the first position, not the middle or the end, and counts a race', async () => {
    await addRun(user.id, { lat: 45.0, lng: -93.0 }, ago(5), 'race')
    const res = await usual()
    expect(startOf(res)).toEqual({ lat: 45, lng: -93, runs: 1, of: 1 })
  })

  test('breaks a tie by the cell with the most recent run', async () => {
    await addRun(user.id, { lat: 45.0, lng: -93.0 }, ago(10))
    await addRun(user.id, { lat: 45.0, lng: -93.0 }, ago(9))
    await addRun(user.id, { lat: 47.0, lng: -91.0 }, ago(20))
    await addRun(user.id, { lat: 47.0, lng: -91.0 }, ago(1))
    const res = await usual()
    expect(res.body).toEqual({ start: { lat: 47, lng: -91, runs: 2, of: 4 } })
  })

  test("ignores another runner's runs", async () => {
    await addRun(other.id, { lat: 45.0, lng: -93.0 }, ago(2))
    await addRun(other.id, { lat: 45.0, lng: -93.0 }, ago(3))
    expect((await usual()).body).toEqual({ start: null })
    await addRun(user.id, { lat: 47.0, lng: -91.0 }, ago(2))
    expect((await usual()).body).toEqual({ start: { lat: 47, lng: -91, runs: 1, of: 1 } })
    expect((await usual(other)).body).toEqual({ start: { lat: 45, lng: -93, runs: 2, of: 2 } })
  })

  test('ignores runs older than 365 days, and counts the 365th', async () => {
    await addRun(user.id, { lat: 45.0, lng: -93.0 }, ago(366))
    await addRun(user.id, { lat: 45.0, lng: -93.0 }, ago(400))
    expect((await usual()).body).toEqual({ start: null })
    await addRun(user.id, { lat: 47.0, lng: -91.0 }, ago(365))
    expect((await usual()).body).toEqual({ start: { lat: 47, lng: -91, runs: 1, of: 1 } })
  })

  test('never serves the stored polyline, and sends nothing out', async () => {
    await addRun(user.id, { lat: 45.0, lng: -93.0 }, ago(2))
    const res = await usual()
    expect(Object.keys(res.body as object)).toEqual(['start'])
    expect(Object.keys(startOf(res) ?? {}).sort()).toEqual(['lat', 'lng', 'of', 'runs'])
    expect(ctx.refusedFetches).toEqual([])
  })
})
