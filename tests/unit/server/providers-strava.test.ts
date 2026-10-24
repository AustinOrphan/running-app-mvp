import { describe, expect, it } from 'vitest'
import { HttpError } from '../../../server/errors.ts'
import {
  authorizeUrl,
  exchangeCode,
  refreshIfNeeded,
  stravaProvider,
  type StravaRef,
} from '../../../server/providers/strava.ts'
import { RateLimitPause, type ProviderCtx } from '../../../server/providers/types.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import { fakeFetch, type FakeRoute } from '../../fakeFetch.ts'

const NOW = new Date('2026-10-22T10:07:00Z')
const NOW_SEC = Math.floor(NOW.getTime() / 1000)
const API = 'https://www.strava.com/api/v3'
const TOKEN_URL = 'https://www.strava.com/oauth/token'

function ctxWith(
  routes: Record<string, FakeRoute>,
  secret: Record<string, unknown> = {},
): ProviderCtx & { saved: Record<string, unknown>[] } {
  const saved: Record<string, unknown>[] = []
  return {
    fetch: fakeFetch(routes),
    timezone: 'UTC',
    secret: {
      clientSecret: 'cs',
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: NOW_SEC + 3600,
      ...secret,
    },
    config: { clientId: '12345' },
    saveSecret: (next) => {
      saved.push(next)
      return Promise.resolve()
    },
    parseFile: () => [],
    sleep: () => Promise.resolve(),
    now: () => NOW,
    userId: 'user-1',
    saved,
  }
}

function summary(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1001,
    sport_type: 'Run',
    type: 'Run',
    start_date: '2026-10-20T06:00:00Z',
    start_date_local: '2026-10-20T08:00:00Z',
    utc_offset: 7200,
    distance: 8046.7,
    moving_time: 2400,
    elapsed_time: 2460,
    total_elevation_gain: 52.4,
    average_heartrate: 151.4,
    max_heartrate: 172,
    average_cadence: 84,
    average_watts: 210.6,
    device_name: 'Test Watch',
    start_latlng: [0.004, -0.006],
    trainer: false,
    ...over,
  }
}

const streams = (): Response =>
  Response.json({
    time: { data: [0, 5, 10] },
    distance: { data: [0, 15, 31] },
    heartrate: { data: [120, 130, 140] },
    altitude: { data: [10, 10.5, 11] },
    cadence: { data: [80, 82, 84] },
    watts: { data: [200, 210, 220] },
  })

const fullPage = (startDate: string): Record<string, unknown>[] =>
  Array.from({ length: 200 }, (_, i) => summary({ id: 5000 + i, start_date: startDate }))

async function collect(iter: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const item of iter) out.push(item)
  return out
}

describe('authorizeUrl', () => {
  it('builds the consent URL with scope and state', () => {
    const url = new URL(authorizeUrl({ clientId: '12345' }, 'https://run.example.com/cb', 'st.ate'))
    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '12345',
      redirect_uri: 'https://run.example.com/cb',
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'read,activity:read_all',
      state: 'st.ate',
    })
  })
})

describe('connect', () => {
  it('splits the form into config and secret, trimming the base URL', async () => {
    const ctx = ctxWith({}, {})
    const result = await stravaProvider.connect(
      { clientId: ' 12345 ', clientSecret: 'cs', publicBaseUrl: 'https://run.example.com/' },
      ctx,
    )
    expect(result).toEqual({
      config: { clientId: '12345', publicBaseUrl: 'https://run.example.com' },
      secret: { clientSecret: 'cs' },
    })
  })

  it('omits an empty base URL and rejects missing credentials', async () => {
    const ctx = ctxWith({})
    const ok = await stravaProvider.connect(
      { clientId: '1', clientSecret: 'cs', publicBaseUrl: '' },
      ctx,
    )
    expect(ok.config).toEqual({ clientId: '1' })
    await expect(stravaProvider.connect({ clientId: '' }, ctx)).rejects.toBeInstanceOf(HttpError)
    await expect(
      stravaProvider.connect({ clientId: '1', clientSecret: 'x', publicBaseUrl: 'nope' }, ctx),
    ).rejects.toBeInstanceOf(HttpError)
  })
})

describe('exchangeCode', () => {
  it('posts the code and returns the secret with tokens', async () => {
    let form: URLSearchParams | undefined
    const ctx = ctxWith(
      {
        [`POST ${TOKEN_URL}`]: async (req) => {
          form = new URLSearchParams(await req.text())
          return Response.json({
            access_token: 'at-new',
            refresh_token: 'rt-new',
            expires_at: NOW_SEC + 21600,
          })
        },
      },
      { accessToken: undefined, refreshToken: undefined, expiresAt: undefined },
    )
    const secret = await exchangeCode('code-1', 'https://run.example.com/cb', ctx)
    expect(Object.fromEntries(form ?? [])).toEqual({
      client_id: '12345',
      client_secret: 'cs',
      code: 'code-1',
      grant_type: 'authorization_code',
    })
    expect(secret).toMatchObject({
      clientSecret: 'cs',
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      expiresAt: NOW_SEC + 21600,
    })
  })

  it('turns a Strava rejection into a validation error', async () => {
    const ctx = ctxWith({
      [`POST ${TOKEN_URL}`]: () => Response.json({ message: 'Bad Request' }, { status: 400 }),
    })
    await expect(exchangeCode('bad', 'https://x.example.com/cb', ctx)).rejects.toBeInstanceOf(
      HttpError,
    )
  })
})

describe('refreshIfNeeded', () => {
  it('returns the current token when it is valid for more than 5 minutes', async () => {
    const ctx = ctxWith({})
    expect(await refreshIfNeeded(ctx)).toBe('at-1')
    expect(ctx.saved).toEqual([])
  })

  it('refreshes inside the 5 minute margin, saves the new pair and reuses it', async () => {
    let calls = 0
    let form: URLSearchParams | undefined
    const ctx = ctxWith(
      {
        [`POST ${TOKEN_URL}`]: async (req) => {
          calls += 1
          form = new URLSearchParams(await req.text())
          return Response.json({
            access_token: 'at-2',
            refresh_token: 'rt-2',
            expires_at: NOW_SEC + 21600,
          })
        },
      },
      { expiresAt: NOW_SEC + 299 },
    )
    expect(await refreshIfNeeded(ctx)).toBe('at-2')
    expect(Object.fromEntries(form ?? [])).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'rt-1',
      client_id: '12345',
      client_secret: 'cs',
    })
    expect(ctx.saved).toEqual([
      { clientSecret: 'cs', accessToken: 'at-2', refreshToken: 'rt-2', expiresAt: NOW_SEC + 21600 },
    ])
    expect(await refreshIfNeeded(ctx)).toBe('at-2')
    expect(calls).toBe(1)
  })

  it('reports a Strava outage during refresh without asking to reconnect', async () => {
    const ctx = ctxWith(
      { [`POST ${TOKEN_URL}`]: () => new Response('{}', { status: 503 }) },
      { expiresAt: NOW_SEC - 10 },
    )
    const error = await refreshIfNeeded(ctx).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Strava answered the token request with HTTP 503.')
    expect(lintText((error as Error).message)).toEqual([])
    expect((error as Error).message).not.toMatch(/reconnect/i)
    expect(ctx.saved).toEqual([])
  })

  it('asks to reconnect when there is no token or the refresh is rejected', async () => {
    const none = ctxWith({}, { accessToken: undefined, refreshToken: undefined })
    await expect(refreshIfNeeded(none)).rejects.toThrow(/reconnect/i)
    const rejected = ctxWith(
      { [`POST ${TOKEN_URL}`]: () => new Response('{}', { status: 400 }) },
      { expiresAt: NOW_SEC - 10 },
    )
    await expect(refreshIfNeeded(rejected)).rejects.toThrow(/reconnect/i)
  })
})

describe('listActivities', () => {
  it('pages with after and per_page, sends the bearer token and yields refs', async () => {
    const urls: string[] = []
    const auth: (string | null)[] = []
    const page1 = Array.from({ length: 200 }, (_, i) =>
      summary({ id: 2000 + i, start_date: '2026-10-20T06:00:00Z' }),
    )
    const ctx = ctxWith({
      [`GET ${API}/athlete/activities`]: (req) => {
        urls.push(req.url)
        auth.push(req.headers.get('authorization'))
        const page = new URL(req.url).searchParams.get('page')
        return Response.json(page === '1' ? page1 : [summary({ id: 3000 })])
      },
    })
    const refs = (await collect(
      stravaProvider.listActivities('2026-10-01T00:00:00Z', ctx),
    )) as StravaRef[]
    expect(refs).toHaveLength(201)
    expect(refs[0]).toMatchObject({ id: '2000', startUtc: '2026-10-20T06:00:00Z' })
    expect(refs[200]?.id).toBe('3000')
    const first = new URL(urls[0] ?? '')
    expect(first.searchParams.get('after')).toBe(String(Date.parse('2026-10-01T00:00:00Z') / 1000))
    expect(first.searchParams.get('per_page')).toBe('200')
    expect(first.searchParams.get('page')).toBe('1')
    expect(urls).toHaveLength(2)
    expect(auth).toEqual(['Bearer at-1', 'Bearer at-1'])
  })

  it('stops after a short page without asking for another', async () => {
    let calls = 0
    const ctx = ctxWith({
      [`GET ${API}/athlete/activities`]: () => {
        calls += 1
        return Response.json([summary()])
      },
    })
    await collect(stravaProvider.listActivities('2026-10-01T00:00:00Z', ctx))
    expect(calls).toBe(1)
  })

  it('yields the page, then pauses with the last start as cursor at 80% usage', async () => {
    const ctx = ctxWith({
      [`GET ${API}/athlete/activities`]: () =>
        Response.json(fullPage('2026-10-19T06:00:00Z'), {
          headers: { 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '80,300' },
        }),
    })
    const seen: string[] = []
    let error: unknown
    try {
      for await (const ref of stravaProvider.listActivities('2026-10-01T00:00:00Z', ctx)) {
        seen.push(ref.id)
      }
    } catch (e) {
      error = e
    }
    expect(seen).toHaveLength(200)
    expect(error).toBeInstanceOf(RateLimitPause)
    const pause = error as RateLimitPause
    expect(pause.cursor).toBe('2026-10-19T06:00:00Z')
    // 10:07:00 UTC: the 15 minute window resets at 10:15.
    expect(pause.retryAfterSec).toBe(8 * 60)
  })

  it('waits for the next UTC midnight when the daily window is the one at 80%', async () => {
    const ctx = ctxWith({
      [`GET ${API}/athlete/activities`]: () =>
        Response.json(fullPage('2026-10-19T06:00:00Z'), {
          headers: { 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '10,800' },
        }),
    })
    const error = await collect(stravaProvider.listActivities('2026-10-01T00:00:00Z', ctx)).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(RateLimitPause)
    expect((error as RateLimitPause).retryAfterSec).toBe(13 * 3600 + 53 * 60)
  })

  it('pauses at 80% of the read-only limit even when the overall limit has room', async () => {
    const ctx = ctxWith({
      [`GET ${API}/athlete/activities`]: () =>
        Response.json(fullPage('2026-10-19T06:00:00Z'), {
          headers: {
            'X-RateLimit-Limit': '200,2000',
            'X-RateLimit-Usage': '80,300',
            'X-ReadRateLimit-Limit': '100,1000',
            'X-ReadRateLimit-Usage': '80,300',
          },
        }),
    })
    const error = await collect(stravaProvider.listActivities('2026-10-01T00:00:00Z', ctx)).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(RateLimitPause)
    expect((error as RateLimitPause).cursor).toBe('2026-10-19T06:00:00Z')
    expect((error as RateLimitPause).retryAfterSec).toBe(8 * 60)
  })

  it('keeps the cursor reached on earlier pages when a later page gets HTTP 429', async () => {
    const ctx = ctxWith({
      [`GET ${API}/athlete/activities`]: (req) =>
        new URL(req.url).searchParams.get('page') === '1'
          ? Response.json(fullPage('2026-10-19T06:00:00Z'))
          : new Response('{}', { status: 429 }),
    })
    const error = await collect(stravaProvider.listActivities('2026-10-01T00:00:00Z', ctx)).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(RateLimitPause)
    expect((error as RateLimitPause).cursor).toBe('2026-10-19T06:00:00Z')
    expect((error as RateLimitPause).retryAfterSec).toBe(15 * 60)
  })

  it('pauses on HTTP 429 and fails on other errors', async () => {
    const limited = ctxWith({
      [`GET ${API}/athlete/activities`]: () => new Response('{}', { status: 429 }),
    })
    await expect(
      collect(stravaProvider.listActivities('2026-10-01T00:00:00Z', limited)),
    ).rejects.toBeInstanceOf(RateLimitPause)
    const broken = ctxWith({
      [`GET ${API}/athlete/activities`]: () => new Response('{}', { status: 500 }),
    })
    const error = await collect(
      stravaProvider.listActivities('2026-10-01T00:00:00Z', broken),
    ).catch((e: unknown) => e)
    expect((error as Error).message).toBe('Strava answered the request with HTTP 500.')
    expect(lintText((error as Error).message)).toEqual([])
  })
})

describe('fetchActivity', () => {
  const ref = (over: Record<string, unknown> = {}): StravaRef => ({
    id: '1001',
    startUtc: '2026-10-20T06:00:00Z',
    summary: summary(over) as StravaRef['summary'],
  })

  it('builds a ParsedActivity from the summary and the streams', async () => {
    let query: URLSearchParams | undefined
    const ctx = ctxWith({
      [`GET ${API}/activities/1001/streams`]: (req) => {
        query = new URL(req.url).searchParams
        return streams()
      },
    })
    const result = await stravaProvider.fetchActivity(ref(), ctx)
    expect(Object.fromEntries(query ?? [])).toEqual({
      keys: 'time,distance,heartrate,altitude,cadence,watts',
      key_by_type: 'true',
    })
    expect(result?.file).toBeUndefined()
    expect(result?.parsed).toEqual({
      providerKey: 'strava:1001',
      startUtc: '2026-10-20T06:00:00Z',
      utcOffsetMin: 120,
      type: 'run',
      subtype: 'road',
      elapsedSec: 2460,
      movingSec: 2400,
      distanceM: 8047,
      elevationGainM: 52,
      elevationLossM: null,
      avgHr: 151,
      maxHr: 172,
      avgCadence: 168,
      avgPowerW: 211,
      deviceName: 'Test Watch',
      startLat: 0,
      startLng: -0.01,
      samples: {
        t: [0, 5, 10],
        d: [0, 15, 31],
        hr: [120, 130, 140],
        alt: [10, 10.5, 11],
        cad: [160, 164, 168],
        pwr: [200, 210, 220],
      },
      laps: [],
    })
  })

  it('looks the summary up when the ref carries none', async () => {
    const ctx = ctxWith({
      [`GET ${API}/activities/1001?`]: () => Response.json(summary()),
      [`GET ${API}/activities/1001/streams`]: streams,
    })
    const result = await stravaProvider.fetchActivity(
      { id: '1001', startUtc: '2026-10-20T06:00:00Z' },
      ctx,
    )
    expect(result?.parsed.providerKey).toBe('strava:1001')
    expect(result?.parsed.distanceM).toBe(8047)
  })

  it('keeps an activity without streams (manual entry) with empty samples', async () => {
    const ctx = ctxWith({
      [`GET ${API}/activities/1001/streams`]: () =>
        Response.json({ message: 'Resource Not Found' }, { status: 404 }),
    })
    const result = await stravaProvider.fetchActivity(
      ref({ average_heartrate: undefined, average_cadence: undefined, start_latlng: [] }),
      ctx,
    )
    expect(result?.parsed.samples).toEqual({
      t: [],
      d: null,
      hr: null,
      alt: null,
      cad: null,
      pwr: null,
    })
    expect(result?.parsed.avgHr).toBeNull()
    expect(result?.parsed.avgCadence).toBeNull()
    expect(result?.parsed.startLat).toBeNull()
    expect(result?.parsed.startLng).toBeNull()
  })

  it('returns null when the activity is gone', async () => {
    const ctx = ctxWith({
      [`GET ${API}/activities/1001?`]: () => new Response('{}', { status: 404 }),
    })
    expect(
      await stravaProvider.fetchActivity({ id: '1001', startUtc: '2026-10-20T06:00:00Z' }, ctx),
    ).toBeNull()
  })

  it.each([
    ['Run', false, 'run', 'road'],
    ['TrailRun', false, 'run', 'trail'],
    ['VirtualRun', false, 'run', 'treadmill'],
    ['Run', true, 'run', 'treadmill'],
    ['Walk', false, 'cross', 'walk'],
    ['Hike', false, 'cross', 'hike'],
    ['Ride', false, 'cross', 'bike'],
    ['MountainBikeRide', false, 'cross', 'bike'],
    ['Swim', false, 'cross', 'swim'],
    ['WeightTraining', false, 'strength', null],
    ['Yoga', false, 'cross', 'other'],
  ])('maps %s (trainer %s) to %s/%s', async (sport, trainer, type, subtype) => {
    const ctx = ctxWith({
      [`GET ${API}/activities/1001/streams`]: () => new Response('{}', { status: 404 }),
    })
    const result = await stravaProvider.fetchActivity(
      ref({ sport_type: sport, type: sport, trainer }),
      ctx,
    )
    expect(result?.parsed.type).toBe(type)
    expect(result?.parsed.subtype).toBe(subtype)
  })

  it('does not double cadence outside running', async () => {
    const ctx = ctxWith({ [`GET ${API}/activities/1001/streams`]: streams })
    const result = await stravaProvider.fetchActivity(ref({ sport_type: 'Ride' }), ctx)
    expect(result?.parsed.avgCadence).toBe(84)
    expect(result?.parsed.samples.cad).toEqual([80, 82, 84])
  })

  it('pauses before the activity so the next run lists it again', async () => {
    const ctx = ctxWith({
      [`GET ${API}/activities/1001/streams`]: () =>
        Response.json(
          {},
          { headers: { 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '5,900' } },
        ),
    })
    const error = await stravaProvider.fetchActivity(ref(), ctx).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RateLimitPause)
    expect((error as RateLimitPause).cursor).toBe('2026-10-20T05:59:59Z')
  })
})
