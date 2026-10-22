import { gzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { fakeFetch, type FakeRoute } from '../../fakeFetch.ts'
import { HttpError } from '../../../server/errors.ts'
import { intervalsProvider } from '../../../server/providers/intervals.ts'
import { RateLimitPause, type ProviderCtx } from '../../../server/providers/types.ts'
import type { ParsedActivity } from '../../../shared/types.ts'

const BASE = 'https://intervals.icu/api/v1'
const AUTH = `Basic ${Buffer.from('API_KEY:key-123').toString('base64')}`

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function parsed(over: Partial<ParsedActivity> = {}): ParsedActivity {
  return {
    providerKey: 'fit:1-2',
    startUtc: '2026-03-02T07:00:00Z',
    utcOffsetMin: 60,
    type: 'run',
    subtype: null,
    elapsedSec: 1800,
    movingSec: 1790,
    distanceM: 5000,
    elevationGainM: 20,
    elevationLossM: 20,
    avgHr: 140,
    maxHr: 160,
    avgCadence: 170,
    avgPowerW: null,
    deviceName: 'Test Watch',
    startLat: null,
    startLng: null,
    samples: { t: [0, 1], d: [0, 3], hr: [100, 110], alt: null, cad: null, pwr: null },
    laps: [],
    ...over,
  }
}

function makeCtx(routes: Record<string, FakeRoute>, over: Partial<ProviderCtx> = {}): ProviderCtx {
  return {
    fetch: fakeFetch(routes),
    timezone: 'UTC',
    secret: { apiKey: 'key-123' },
    config: { athleteId: 'i1001' },
    saveSecret: async () => {},
    parseFile: () => {
      throw new Error('parseFile not expected')
    },
    sleep: async () => {},
    now: () => new Date('2026-03-10T12:00:00Z'),
    userId: 'u1',
    ...over,
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}

describe('intervals.icu connect', () => {
  it('verifies the athlete and returns config and secret', async () => {
    const seen: string[] = []
    const ctx = makeCtx({
      [`GET ${BASE}/athlete/i1001`]: (req) => {
        seen.push(req.headers.get('authorization') ?? '')
        return json({ id: 'i1001', name: 'Synthetic Athlete' })
      },
    })
    const result = await intervalsProvider.connect({ athleteId: ' i1001 ', apiKey: 'key-123' }, ctx)
    expect(result).toEqual({ config: { athleteId: 'i1001' }, secret: { apiKey: 'key-123' } })
    expect(seen).toEqual([AUTH])
  })

  it('turns a 401 into a validation error about the key', async () => {
    const ctx = makeCtx({ [`GET ${BASE}/athlete/`]: () => json({}, 401) })
    const error = await intervalsProvider
      .connect({ athleteId: 'i1001', apiKey: 'bad' }, ctx)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(400)
    expect((error as HttpError).code).toBe('validation')
    expect((error as HttpError).message).toBe('intervals.icu rejected the API key')
  })

  it('rejects a body without an athlete id or key', async () => {
    const ctx = makeCtx({})
    await expect(intervalsProvider.connect({ athleteId: '' }, ctx)).rejects.toBeInstanceOf(
      HttpError,
    )
  })

  it('reports an unknown athlete id as a validation error', async () => {
    const ctx = makeCtx({ [`GET ${BASE}/athlete/`]: () => json({}, 404) })
    await expect(
      intervalsProvider.connect({ athleteId: 'i9', apiKey: 'k' }, ctx),
    ).rejects.toMatchObject({ code: 'validation' })
  })
})

describe('intervals.icu listActivities', () => {
  it('yields refs in start order and skips Strava-sourced stubs', async () => {
    const urls: string[] = []
    const ctx = makeCtx({
      [`GET ${BASE}/athlete/i1001/activities`]: (req) => {
        urls.push(req.url)
        return json([
          { id: 'i2', start_date: '2026-03-05T07:00:00Z', source: 'GARMIN_CONNECT' },
          { id: 'i1', start_date: '2026-03-02T07:00:00Z' },
          { id: 's9', start_date: '2026-03-03T07:00:00Z', source: 'STRAVA' },
        ])
      },
    })
    const refs = await collect(intervalsProvider.listActivities('2026-03-01', ctx))
    expect(refs).toEqual([
      { id: 'i1', startUtc: '2026-03-02T07:00:00Z' },
      { id: 'i2', startUtc: '2026-03-05T07:00:00Z' },
    ])
    expect(urls).toHaveLength(1)
    const url = new URL(urls[0] ?? '')
    expect(url.searchParams.get('oldest')).toBe('2026-02-28')
    expect(url.searchParams.get('newest')).toBe('2026-03-11')
  })

  it('splits a long range into consecutive windows and accepts an ISO cursor', async () => {
    const ranges: Array<[string, string]> = []
    const ctx = makeCtx({
      [`GET ${BASE}/athlete/i1001/activities`]: (req) => {
        const url = new URL(req.url)
        ranges.push([url.searchParams.get('oldest') ?? '', url.searchParams.get('newest') ?? ''])
        return json([])
      },
    })
    await collect(intervalsProvider.listActivities('2025-01-01T00:00:00Z', ctx))
    expect(ranges.length).toBeGreaterThan(1)
    expect(ranges[0]?.[0]).toBe('2024-12-31')
    expect(ranges[ranges.length - 1]?.[1]).toBe('2026-03-11')
    for (let i = 1; i < ranges.length; i++) {
      const prevEnd = new Date(`${ranges[i - 1]?.[1]}T00:00:00Z`).getTime()
      const start = new Date(`${ranges[i]?.[0]}T00:00:00Z`).getTime()
      expect(start - prevEnd).toBeLessThanOrEqual(24 * 3600 * 1000)
      expect(start).toBeGreaterThanOrEqual(prevEnd)
    }
  })

  it('pauses on a 429 with the Retry-After value', async () => {
    const ctx = makeCtx({
      [`GET ${BASE}/athlete/i1001/activities`]: () =>
        new Response('', { status: 429, headers: { 'retry-after': '120' } }),
    })
    const error = await collect(intervalsProvider.listActivities('2026-03-01', ctx)).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(RateLimitPause)
    expect((error as RateLimitPause).retryAfterSec).toBe(120)
  })

  it('throws a readable error on a 401', async () => {
    const ctx = makeCtx({ [`GET ${BASE}/athlete/`]: () => json({}, 401) })
    await expect(collect(intervalsProvider.listActivities('2026-03-01', ctx))).rejects.toThrow(
      /rejected the API key/,
    )
  })
})

describe('intervals.icu fetchActivity', () => {
  const ref = { id: 'i7', startUtc: '2026-03-02T07:00:00Z' }

  it('prefers the original file, keeps it, and sets the provider key', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const calls: Array<{ name: string; size: number }> = []
    const ctx = makeCtx(
      {
        [`GET ${BASE}/activity/i7/file`]: () =>
          new Response(bytes, {
            status: 200,
            headers: { 'content-disposition': 'attachment; filename="morning.fit"' },
          }),
      },
      {
        parseFile: (name, data) => {
          calls.push({ name, size: data.length })
          return [parsed()]
        },
      },
    )
    const result = await intervalsProvider.fetchActivity(ref, ctx)
    expect(calls).toEqual([{ name: 'morning.fit', size: 3 }])
    expect(result?.parsed.providerKey).toBe('intervals:i7')
    expect(result?.parsed.distanceM).toBe(5000)
    expect(result?.file).toEqual({ name: 'morning.fit', format: 'fit', bytes })
  })

  it('gunzips a .gz original before parsing', async () => {
    const raw = new TextEncoder().encode('<gpx></gpx>')
    const seen: string[] = []
    const ctx = makeCtx(
      {
        [`GET ${BASE}/activity/i7/file`]: () =>
          new Response(gzipSync(raw), {
            status: 200,
            headers: { 'content-disposition': 'attachment; filename="run.gpx.gz"' },
          }),
      },
      {
        parseFile: (name, data) => {
          seen.push(`${name}:${data.length}`)
          return [parsed()]
        },
      },
    )
    const result = await intervalsProvider.fetchActivity(ref, ctx)
    expect(seen).toEqual([`run.gpx:${raw.length}`])
    expect(result?.file?.format).toBe('gpx')
    expect(result?.file?.name).toBe('run.gpx')
  })

  it('falls back to the streams when the file is missing', async () => {
    const ctx = makeCtx({
      [`GET ${BASE}/activity/i7/file`]: () => json({}, 404),
      [`GET ${BASE}/activity/i7/streams.json`]: () =>
        json([
          { type: 'time', data: [0, 1, 2, 3] },
          { type: 'distance', data: [0, 3, 6, 9] },
          { type: 'heartrate', data: [120, 130, 140, 150] },
          { type: 'altitude', data: [10, 10, 11, 12] },
        ]),
      [`GET ${BASE}/activity/i7`]: () =>
        json({
          id: 'i7',
          type: 'TrailRun',
          start_date: '2026-03-02T07:00:00Z',
          start_date_local: '2026-03-02T08:00:00',
          distance: 9,
          moving_time: 3,
          elapsed_time: 4,
          total_elevation_gain: 2,
          average_heartrate: 135,
          max_heartrate: 150,
          average_cadence: 84,
          device_name: 'Test Watch',
          start_lat: 0.004,
          start_lng: -0.006,
        }),
    })
    const result = await intervalsProvider.fetchActivity(ref, ctx)
    expect(result?.file).toBeUndefined()
    expect(result?.parsed).toEqual({
      providerKey: 'intervals:i7',
      startUtc: '2026-03-02T07:00:00Z',
      utcOffsetMin: 60,
      type: 'run',
      subtype: 'trail',
      elapsedSec: 4,
      movingSec: 3,
      distanceM: 9,
      elevationGainM: 2,
      elevationLossM: null,
      avgHr: 135,
      maxHr: 150,
      avgCadence: 168,
      avgPowerW: null,
      deviceName: 'Test Watch',
      startLat: 0,
      startLng: -0.01,
      samples: {
        t: [0, 1, 2, 3],
        d: [0, 3, 6, 9],
        hr: [120, 130, 140, 150],
        alt: [10, 10, 11, 12],
        cad: null,
        pwr: null,
      },
      laps: [],
    })
  })

  it('falls back to the streams when the file does not parse', async () => {
    const ctx = makeCtx(
      {
        [`GET ${BASE}/activity/i7/file`]: () => new Response(new Uint8Array([9]), { status: 200 }),
        [`GET ${BASE}/activity/i7/streams.json`]: () => json([{ type: 'time', data: [0, 1] }]),
        [`GET ${BASE}/activity/i7`]: () =>
          json({ id: 'i7', type: 'Ride', start_date: '2026-03-02T07:00:00Z', elapsed_time: 2 }),
      },
      {
        parseFile: () => {
          throw new RangeError('truncated')
        },
      },
    )
    const result = await intervalsProvider.fetchActivity(ref, ctx)
    expect(result?.parsed.type).toBe('cross')
    expect(result?.parsed.subtype).toBe('bike')
    expect(result?.parsed.samples.t).toEqual([0, 1])
    expect(result?.parsed.samples.hr).toBeNull()
  })

  it('maps weight training to strength and virtual runs to treadmill', async () => {
    const make = (type: string) =>
      makeCtx({
        [`GET ${BASE}/activity/i7/file`]: () => json({}, 404),
        [`GET ${BASE}/activity/i7/streams.json`]: () => json([]),
        [`GET ${BASE}/activity/i7`]: () =>
          json({ id: 'i7', type, start_date: '2026-03-02T07:00:00Z', elapsed_time: 600 }),
      })
    const lift = await intervalsProvider.fetchActivity(ref, make('WeightTraining'))
    expect([lift?.parsed.type, lift?.parsed.subtype]).toEqual(['strength', null])
    const virtual = await intervalsProvider.fetchActivity(ref, make('VirtualRun'))
    expect([virtual?.parsed.type, virtual?.parsed.subtype]).toEqual(['run', 'treadmill'])
  })

  it('returns null for a Strava-sourced stub', async () => {
    const ctx = makeCtx({
      [`GET ${BASE}/activity/i7/file`]: () => json({}, 404),
      [`GET ${BASE}/activity/i7/streams.json`]: () => json({}, 404),
      [`GET ${BASE}/activity/i7`]: () =>
        json({ id: 'i7', source: 'STRAVA', start_date: '2026-03-02T07:00:00Z' }),
    })
    expect(await intervalsProvider.fetchActivity(ref, ctx)).toBeNull()
  })
})

describe('intervals.icu listWellness', () => {
  it('maps the five fields and drops empty days', async () => {
    const urls: string[] = []
    const ctx = makeCtx({
      [`GET ${BASE}/athlete/i1001/wellness.json`]: (req) => {
        urls.push(req.url)
        return json([
          {
            id: '2026-03-01',
            restingHR: 48,
            hrv: 82.5,
            sleepSecs: 27000,
            sleepScore: 81,
            weight: 70.2,
            atl: 40,
          },
          { id: '2026-03-02', restingHR: null, hrv: null },
          { id: '2026-03-03', restingHR: 50 },
        ])
      },
    })
    const rows = await intervalsProvider.listWellness?.('2026-03-01', '2026-03-03', ctx)
    expect(rows).toEqual([
      {
        date: '2026-03-01',
        restingHr: 48,
        hrvRmssd: 82.5,
        hrvSdnn: null,
        sleepSec: 27000,
        sleepScore: 81,
        weightKg: 70.2,
        vo2max: null,
      },
      {
        date: '2026-03-03',
        restingHr: 50,
        hrvRmssd: null,
        hrvSdnn: null,
        sleepSec: null,
        sleepScore: null,
        weightKg: null,
        vo2max: null,
      },
    ])
    const url = new URL(urls[0] ?? '')
    expect(url.searchParams.get('oldest')).toBe('2026-03-01')
    expect(url.searchParams.get('newest')).toBe('2026-03-03')
  })
})
