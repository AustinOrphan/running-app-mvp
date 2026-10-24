import { zipSync, strToU8 } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../../../server/errors.ts'
import { garminProvider } from '../../../server/providers/garmin.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  RateLimitPause,
  WellnessTruncated,
  type ProviderCtx,
  type RemoteActivityRef,
} from '../../../server/providers/types.ts'
import type { ParsedActivity } from '../../../shared/types.ts'
import { fakeFetch, type FakeRoute } from '../../fakeFetch.ts'

const NOW = new Date('2026-10-22T12:00:00.000Z')
const SIGN_IN = 'https://sso.garmin.com/mobile/sso/en/sign-in'
const LOGIN = 'https://sso.garmin.com/mobile/api/login'
const MFA = 'https://sso.garmin.com/mobile/api/mfa/verifyCode'
const TOKEN = 'https://diauth.garmin.com/di-oauth2-service/oauth/token'
const API = 'https://connectapi.garmin.com'
const PASSWORD = 'hunter2-synthetic-password'

let userCounter = 0
function newUser(): string {
  userCounter += 1
  return `garmin-user-${userCounter}`
}

function parsed(overrides: Partial<ParsedActivity> = {}): ParsedActivity {
  return {
    providerKey: 'file:abc',
    startUtc: '2026-10-20T06:30:00.000Z',
    utcOffsetMin: 0,
    type: 'run',
    subtype: null,
    elapsedSec: 1800,
    movingSec: 1790,
    distanceM: 5000,
    elevationGainM: null,
    elevationLossM: null,
    avgHr: null,
    maxHr: null,
    avgCadence: null,
    avgPowerW: null,
    deviceName: null,
    startLat: null,
    startLng: null,
    samples: { t: [], d: null, hr: null, alt: null, cad: null, pwr: null },
    laps: [],
    ...overrides,
  }
}

interface Harness {
  ctx: ProviderCtx
  saved: Array<Record<string, unknown>>
  sleeps: number[]
  parseFile: ReturnType<typeof vi.fn<(name: string, bytes: Uint8Array) => ParsedActivity[]>>
}

function makeCtx(routes: Record<string, FakeRoute>, over: Partial<ProviderCtx> = {}): Harness {
  const saved: Array<Record<string, unknown>> = []
  const sleeps: number[] = []
  const parseFile = vi.fn<(name: string, bytes: Uint8Array) => ParsedActivity[]>(() => [parsed()])
  const ctx: ProviderCtx = {
    fetch: fakeFetch(routes),
    timezone: 'UTC',
    secret: {},
    config: {},
    saveSecret: (next) => {
      saved.push(next)
      return Promise.resolve()
    },
    parseFile,
    sleep: (ms) => {
      sleeps.push(ms)
      return Promise.resolve()
    },
    now: () => NOW,
    userId: newUser(),
    ...over,
  }
  return { ctx, saved, sleeps, parseFile }
}

function secretFor(tag: string, expiresInMs = 24 * 3600_000): Record<string, unknown> {
  return {
    accessToken: `access-${tag}`,
    refreshToken: `refresh-${tag}`,
    expiresAt: NOW.getTime() + expiresInMs,
    clientId: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
  }
}

const bearer = (req: Request): string => req.headers.get('authorization') ?? ''

function tokenResponse(tag: string): Response {
  return Response.json({
    access_token: `access-${tag}`,
    refresh_token: `refresh-${tag}`,
    expires_in: 86_400,
  })
}

function loginRoutes(loginBody: unknown): Record<string, FakeRoute> {
  return {
    [`GET ${SIGN_IN}`]: () =>
      new Response('<html></html>', { headers: [['set-cookie', 'GARMIN-SSO=abc; Path=/']] }),
    [`POST ${LOGIN}`]: () => Response.json(loginBody),
    [`POST ${TOKEN}`]: () => tokenResponse('fresh'),
  }
}

function zipWith(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
  return new Uint8Array(zipped)
}

const ref: RemoteActivityRef = { id: '1001', startUtc: '2026-10-20T06:30:00.000Z' }

/** The message of the error a call rejects with. */
async function collectMessage(call: () => Promise<unknown>): Promise<string> {
  const error = await call().catch((e: unknown) => e)
  if (!(error instanceof Error)) throw new Error('The call did not reject')
  return error.message
}
const loginInput = {
  mode: 'login',
  username: 'runner@example.com',
  password: PASSWORD,
  acknowledgeRisk: true,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('garmin connect: login', () => {
  it('stores tokens on a successful login and never keeps the password', async () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ]
    let loginReq: { cookie: string | null; body: Record<string, unknown> } | null = null
    const h = makeCtx({
      ...loginRoutes({}),
      [`POST ${LOGIN}`]: async (req) => {
        loginReq = {
          cookie: req.headers.get('cookie'),
          body: (await req.json()) as Record<string, unknown>,
        }
        return Response.json({ responseStatus: { type: 'SUCCESSFUL' }, serviceTicketId: 'ST-1' })
      },
      [`POST ${TOKEN}`]: async (req) => {
        const form = new URLSearchParams(await req.text())
        expect(form.get('service_ticket')).toBe('ST-1')
        expect(req.headers.get('authorization')).toMatch(/^Basic /)
        return tokenResponse('fresh')
      },
    })
    const result = await garminProvider.connect(loginInput, h.ctx)
    expect(loginReq).not.toBeNull()
    const seen = loginReq as unknown as { cookie: string; body: Record<string, unknown> }
    expect(seen.cookie).toContain('GARMIN-SSO=abc')
    expect(seen.body.password).toBe(PASSWORD)
    expect(result.secret).toMatchObject({
      accessToken: 'access-fresh',
      refreshToken: 'refresh-fresh',
      clientId: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
    })
    const everything = JSON.stringify([result, h.saved, spies.map((s) => s.mock.calls)])
    expect(everything).not.toContain(PASSWORD)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('tries the next client id when the token exchange rejects one', async () => {
    const tried: string[] = []
    const h = makeCtx({
      ...loginRoutes({ responseStatus: { type: 'SUCCESSFUL' }, serviceTicketId: 'ST-2' }),
      [`POST ${TOKEN}`]: async (req) => {
        const form = new URLSearchParams(await req.text())
        tried.push(form.get('client_id') ?? '')
        return tried.length === 1 ? new Response('no', { status: 401 }) : tokenResponse('second')
      },
    })
    const result = await garminProvider.connect(loginInput, h.ctx)
    expect(tried).toEqual([
      'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
      'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
    ])
    expect(result.secret).toMatchObject({
      clientId: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
      accessToken: 'access-second',
    })
  })

  it('walks the MFA path: login asks for a code, the mfa mode completes it', async () => {
    let mfaBody: Record<string, unknown> | null = null
    let mfaCookie: string | null = null
    const h = makeCtx({
      ...loginRoutes({
        responseStatus: { type: 'MFA_REQUIRED' },
        customerMfaInfo: { mfaLastMethodUsed: 'email' },
      }),
      [`POST ${MFA}`]: async (req) => {
        mfaBody = (await req.json()) as Record<string, unknown>
        mfaCookie = req.headers.get('cookie')
        return Response.json({ responseStatus: { type: 'SUCCESSFUL' }, serviceTicketId: 'ST-3' })
      },
    })
    const first = await garminProvider.connect(loginInput, h.ctx)
    expect(first.config).toMatchObject({ mfaRequired: true, method: 'email' })
    expect(first.secret).toEqual({})
    expect(JSON.stringify(first)).not.toContain(PASSWORD)

    const second = await garminProvider.connect(
      { mode: 'mfa', code: '123456', acknowledgeRisk: true },
      h.ctx,
    )
    expect(mfaBody).toMatchObject({ mfaMethod: 'email', mfaVerificationCode: '123456' })
    expect(mfaCookie).toContain('GARMIN-SSO=abc')
    expect(second.secret).toMatchObject({ accessToken: 'access-fresh' })
    expect(second.config).not.toHaveProperty('mfaRequired')

    await expect(
      garminProvider.connect({ mode: 'mfa', code: '123456', acknowledgeRisk: true }, h.ctx),
    ).rejects.toThrow(/sign in again/i)
  })

  it('rejects an MFA code when no sign-in is pending or the pending one expired', async () => {
    const lone = makeCtx({})
    await expect(
      garminProvider.connect({ mode: 'mfa', code: '123456', acknowledgeRisk: true }, lone.ctx),
    ).rejects.toBeInstanceOf(HttpError)

    let clock = NOW
    const h = makeCtx(loginRoutes({ responseStatus: { type: 'MFA_REQUIRED' } }), {
      now: () => clock,
    })
    await garminProvider.connect(loginInput, h.ctx)
    clock = new Date(NOW.getTime() + 11 * 60_000)
    await expect(
      garminProvider.connect({ mode: 'mfa', code: '123456', acknowledgeRisk: true }, h.ctx),
    ).rejects.toThrow(/sign in again/i)
  })

  it('turns invalid credentials into a validation error', async () => {
    const h = makeCtx(loginRoutes({ responseStatus: { type: 'INVALID_USERNAME_PASSWORD' } }))
    const error = await garminProvider.connect(loginInput, h.ctx).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).code).toBe('validation')
    expect((error as HttpError).message).toMatch(/username or password/i)
    expect((error as HttpError).message).not.toContain(PASSWORD)
  })

  it('points at the token import when the login is blocked with 403 or rate limited', async () => {
    for (const status of [403, 429]) {
      const h = makeCtx({
        ...loginRoutes({}),
        [`POST ${LOGIN}`]: () => new Response('blocked', { status }),
      })
      const error = await garminProvider.connect(loginInput, h.ctx).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).code).toBe('validation')
      expect((error as HttpError).message).toMatch(/token/i)
    }
  })

  it('treats a captcha challenge like a block', async () => {
    const h = makeCtx(loginRoutes({ responseStatus: { type: 'CAPTCHA_REQUIRED' } }))
    await expect(garminProvider.connect(loginInput, h.ctx)).rejects.toThrow(/token/i)
  })

  it('requires the risk acknowledgement in every mode', async () => {
    const h = makeCtx({})
    for (const input of [
      { mode: 'login', username: 'a@example.com', password: PASSWORD },
      { ...loginInput, acknowledgeRisk: false },
      { mode: 'mfa', code: '123456' },
      { mode: 'tokens', tokens: {} },
      { mode: 'nope', acknowledgeRisk: true },
    ]) {
      const error = await garminProvider.connect(input, h.ctx).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).code).toBe('validation')
    }
  })
})

describe('garmin connect: token import', () => {
  it('accepts the python-garminconnect shape and verifies it against the API', async () => {
    let seenAuth = ''
    const h = makeCtx({
      [`GET ${API}/userprofile-service/socialProfile`]: (req) => {
        seenAuth = bearer(req)
        return Response.json({ displayName: 'synthetic' })
      },
    })
    const result = await garminProvider.connect(
      {
        mode: 'tokens',
        acknowledgeRisk: true,
        tokens: JSON.stringify({
          access_token: 'pasted-access',
          refresh_token: 'pasted-refresh',
          expires_in: 3600,
          client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
        }),
      },
      h.ctx,
    )
    expect(seenAuth).toBe('Bearer pasted-access')
    expect(result.secret).toEqual({
      accessToken: 'pasted-access',
      refreshToken: 'pasted-refresh',
      expiresAt: NOW.getTime() + 3600_000,
      clientId: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
    })
  })

  it('accepts expires_at in seconds and a parsed object', async () => {
    const h = makeCtx({
      [`GET ${API}/userprofile-service/socialProfile`]: () => Response.json({}),
    })
    const expiresAtSec = Math.floor(NOW.getTime() / 1000) + 7200
    const result = await garminProvider.connect(
      {
        mode: 'tokens',
        acknowledgeRisk: true,
        tokens: { access_token: 'a', refresh_token: 'r', expires_at: expiresAtSec },
      },
      h.ctx,
    )
    expect(result.secret).toMatchObject({
      accessToken: 'a',
      expiresAt: expiresAtSec * 1000,
      clientId: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
    })
  })

  it('rejects malformed JSON and tokens Garmin does not accept', async () => {
    const h = makeCtx({
      [`GET ${API}/userprofile-service/socialProfile`]: () => new Response('no', { status: 401 }),
      [`POST ${TOKEN}`]: () => new Response('no', { status: 400 }),
    })
    await expect(
      garminProvider.connect({ mode: 'tokens', acknowledgeRisk: true, tokens: '{nope' }, h.ctx),
    ).rejects.toBeInstanceOf(HttpError)
    await expect(
      garminProvider.connect(
        {
          mode: 'tokens',
          acknowledgeRisk: true,
          tokens: { access_token: 'a', refresh_token: 'r', expires_in: 3600 },
        },
        h.ctx,
      ),
    ).rejects.toMatchObject({ code: 'validation' })
  })
})

describe('garmin connect: refresh', () => {
  it('rotates and saves the new pair once for two concurrent calls that get a 401', async () => {
    const tag = 'concurrent'
    let refreshes = 0
    const routes: Record<string, FakeRoute> = {
      [`GET ${API}/download-service/files/activity/1001`]: (req) =>
        bearer(req) === 'Bearer access-rotated'
          ? new Response(zipWith({ '1001_ACTIVITY.fit': 'FITDATA' }))
          : new Response('expired', { status: 401 }),
      [`POST ${TOKEN}`]: async (req) => {
        refreshes += 1
        const form = new URLSearchParams(await req.text())
        expect(form.get('grant_type')).toBe('refresh_token')
        expect(form.get('refresh_token')).toBe(`refresh-${tag}`)
        await Promise.resolve()
        return tokenResponse('rotated')
      },
    }
    const userId = newUser()
    const a = makeCtx(routes, { userId, secret: secretFor(tag) })
    const b = makeCtx(routes, { userId, secret: secretFor(tag) })
    const [ra, rb] = await Promise.all([
      garminProvider.fetchActivity(ref, a.ctx),
      garminProvider.fetchActivity(ref, b.ctx),
    ])
    expect(ra?.parsed.providerKey).toBe('garmin:1001')
    expect(rb?.parsed.providerKey).toBe('garmin:1001')
    expect(refreshes).toBe(1)
    const saved = [...a.saved, ...b.saved]
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      accessToken: 'access-rotated',
      refreshToken: 'refresh-rotated',
    })
  })

  it('refreshes ahead of time when the access token is within 15 minutes of expiry', async () => {
    const seen: string[] = []
    const h = makeCtx(
      {
        [`POST ${TOKEN}`]: () => tokenResponse('early'),
        [`GET ${API}/download-service/files/activity/1001`]: (req) => {
          seen.push(bearer(req))
          return new Response(zipWith({ 'a.fit': 'x' }))
        },
      },
      { secret: secretFor('soon', 10 * 60_000) },
    )
    await garminProvider.fetchActivity(ref, h.ctx)
    expect(seen).toEqual(['Bearer access-early'])
    expect(h.saved).toHaveLength(1)
  })

  it('asks for a reconnect (401) when the refresh token is rejected', async () => {
    const h = makeCtx(
      {
        [`POST ${TOKEN}`]: () => new Response('invalid_grant', { status: 400 }),
        [`GET ${API}/download-service/files/activity/1001`]: () =>
          new Response('expired', { status: 401 }),
      },
      { secret: secretFor('dead') },
    )
    const error = await garminProvider.fetchActivity(ref, h.ctx).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).code).toBe('unauthorized')
    expect(h.saved).toHaveLength(0)
  })

  it('asks for a reconnect when the stored secret is empty', async () => {
    const h = makeCtx({})
    await expect(garminProvider.fetchActivity(ref, h.ctx)).rejects.toMatchObject({
      code: 'unauthorized',
    })
  })
})

describe('garmin connect: activities', () => {
  const item = (id: number, startTimeGMT: string) => ({
    activityId: id,
    startTimeGMT,
    activityType: { typeKey: 'running' },
  })
  const listUrl = `GET ${API}/activitylist-service/activities/search/activities`

  it('lists activities oldest first across pages', async () => {
    const urls: string[] = []
    const page1 = Array.from({ length: 100 }, (_, i) =>
      item(
        2000 + i,
        `2026-10-${String(20 - Math.floor(i / 10)).padStart(2, '0')} 0${i % 10}:00:00`,
      ),
    )
    const page2 = [item(1, '2026-09-01 06:00:00'), item(2, '2026-09-02 06:00:00')]
    const h = makeCtx(
      {
        [listUrl]: (req) => {
          urls.push(req.url)
          const start = new URL(req.url).searchParams.get('start')
          return Response.json(start === '0' ? page1 : page2)
        },
      },
      { secret: secretFor('list') },
    )
    const refs: RemoteActivityRef[] = []
    for await (const r of garminProvider.listActivities('2026-08-01', h.ctx)) refs.push(r)
    expect(refs).toHaveLength(102)
    expect(refs[0]).toEqual({ id: '1', startUtc: '2026-09-01T06:00:00.000Z' })
    const times = refs.map((r) => r.startUtc)
    expect(times).toEqual([...times].sort())
    expect(urls).toHaveLength(2)
    const first = new URL(urls[0] ?? '').searchParams
    expect(first.get('startDate')).toBe('2026-07-31')
    expect(first.get('endDate')).toBe('2026-10-23')
  })

  it('skips activities at or before a timestamp cursor', async () => {
    const h = makeCtx(
      {
        [listUrl]: (req) =>
          Response.json(
            new URL(req.url).searchParams.get('start') === '0'
              ? [
                  item(7, '2026-10-19 06:00:00'),
                  item(8, '2026-10-20 06:30:00'),
                  item(9, '2026-10-21 06:00:00'),
                ]
              : [],
          ),
      },
      { secret: secretFor('cursor') },
    )
    const ids: string[] = []
    for await (const r of garminProvider.listActivities('2026-10-20T06:30:00.000Z', h.ctx)) {
      ids.push(r.id)
    }
    expect(ids).toEqual(['9'])
  })

  it('downloads the ZIP, parses the first FIT and keeps the original', async () => {
    const h = makeCtx(
      {
        [`GET ${API}/download-service/files/activity/1001`]: () =>
          new Response(zipWith({ 'readme.txt': 'hi', '1001_ACTIVITY.fit': 'FITDATA' })),
      },
      { secret: secretFor('dl') },
    )
    const result = await garminProvider.fetchActivity(ref, h.ctx)
    expect(h.parseFile).toHaveBeenCalledTimes(1)
    const [name, bytes] = h.parseFile.mock.calls[0] ?? []
    expect(name).toBe('1001_ACTIVITY.fit')
    expect(new TextDecoder().decode(bytes)).toBe('FITDATA')
    expect(result?.parsed.providerKey).toBe('garmin:1001')
    expect(result?.file).toMatchObject({ name: '1001_ACTIVITY.fit', format: 'fit' })
    expect(new TextDecoder().decode(result?.file?.bytes)).toBe('FITDATA')
  })

  it('returns null when there is no FIT, no file or the parser finds nothing', async () => {
    const noFit = makeCtx(
      {
        [`GET ${API}/download-service/files/activity/1001`]: () =>
          new Response(zipWith({ 'notes.txt': 'x' })),
      },
      { secret: secretFor('nofit') },
    )
    expect(await garminProvider.fetchActivity(ref, noFit.ctx)).toBeNull()

    const gone = makeCtx(
      {
        [`GET ${API}/download-service/files/activity/1001`]: () =>
          new Response('missing', { status: 404 }),
      },
      { secret: secretFor('gone') },
    )
    expect(await garminProvider.fetchActivity(ref, gone.ctx)).toBeNull()

    const empty = makeCtx(
      {
        [`GET ${API}/download-service/files/activity/1001`]: () =>
          new Response(zipWith({ 'a.fit': 'x' })),
      },
      { secret: secretFor('empty') },
    )
    empty.parseFile.mockReturnValue([])
    expect(await garminProvider.fetchActivity(ref, empty.ctx)).toBeNull()
  })

  it('throws RangeError for a download that is neither a readable ZIP nor a FIT', async () => {
    const truncated = zipWith({ 'a.fit': 'FITDATA' }).subarray(0, 20)
    for (const body of [new Uint8Array(truncated), new TextEncoder().encode('<html>oops</html>')]) {
      const h = makeCtx(
        {
          [`GET ${API}/download-service/files/activity/1001`]: () => new Response(body),
        },
        { secret: secretFor('bad') },
      )
      await expect(garminProvider.fetchActivity(ref, h.ctx)).rejects.toBeInstanceOf(RangeError)
      expect(h.parseFile).not.toHaveBeenCalled()
    }
  })

  it('pauses for six hours on 429 or 403 with a cursor that re-includes the activity', async () => {
    for (const status of [429, 403]) {
      const h = makeCtx(
        {
          [`GET ${API}/download-service/files/activity/1001`]: () =>
            new Response('slow down', { status }),
        },
        { secret: secretFor(`limit${status}`) },
      )
      const error = await garminProvider.fetchActivity(ref, h.ctx).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RateLimitPause)
      expect((error as RateLimitPause).retryAfterSec).toBe(21_600)
      expect((error as RateLimitPause).cursor).toBe('2026-10-20T06:29:59.999Z')
    }
  })

  it('pauses for six hours when the activity list is rate limited', async () => {
    let calls = 0
    const h = makeCtx(
      {
        [listUrl]: () => {
          calls += 1
          if (calls === 2) return new Response('slow down', { status: 429 })
          return Response.json(
            Array.from({ length: 100 }, (_, i) => item(i + 1, '2026-10-01 06:00:00')),
          )
        },
      },
      { secret: secretFor('listpause') },
    )
    let caught: unknown = null
    try {
      for await (const r of garminProvider.listActivities('2026-09-01', h.ctx)) void r
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(RateLimitPause)
    expect((caught as RateLimitPause).retryAfterSec).toBe(21_600)
  })

  it('spaces requests one second apart and stops a run at 200 requests', async () => {
    const h = makeCtx(
      {
        [`GET ${API}/download-service/files/activity/`]: () =>
          new Response('missing', { status: 404 }),
      },
      { secret: secretFor('budget') },
    )
    for (let i = 0; i < 200; i += 1) await garminProvider.fetchActivity(ref, h.ctx)
    expect(h.sleeps).toHaveLength(199)
    expect(new Set(h.sleeps)).toEqual(new Set([1000]))
    const error = await garminProvider.fetchActivity(ref, h.ctx).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RateLimitPause)
  })
})

describe('garmin connect: wellness', () => {
  const sleepUrl = `GET ${API}/sleep-service/sleep/dailySleepData`

  it('maps sleep, resting heart rate and HRV, with the HRV endpoint as a fallback', async () => {
    const h = makeCtx(
      {
        [`${sleepUrl}?date=2026-10-20`]: () =>
          Response.json({
            dailySleepDTO: { sleepTimeSeconds: 27_000, sleepScores: { overall: { value: 82 } } },
            restingHeartRate: 48,
            avgOvernightHrv: 61.4,
          }),
        [`${sleepUrl}?date=2026-10-21`]: () =>
          Response.json({
            dailySleepDTO: { sleepTimeSeconds: 25_200, sleepScores: null },
            restingHeartRate: 49,
          }),
        [`GET ${API}/hrv-service/hrv/2026-10-21`]: () =>
          Response.json({ hrvSummary: { lastNightAvg: 55 } }),
        [`${sleepUrl}?date=2026-10-22`]: () => Response.json({ dailySleepDTO: {} }),
        [`GET ${API}/hrv-service/hrv/2026-10-22`]: () => new Response('none', { status: 404 }),
      },
      { secret: secretFor('well') },
    )
    const days = await garminProvider.listWellness?.('2026-10-20', '2026-10-22', h.ctx)
    expect(days).toEqual([
      {
        date: '2026-10-20',
        restingHr: 48,
        hrvRmssd: 61.4,
        hrvSdnn: null,
        sleepSec: 27_000,
        sleepScore: 82,
        weightKg: null,
        vo2max: null,
      },
      {
        date: '2026-10-21',
        restingHr: 49,
        hrvRmssd: 55,
        hrvSdnn: null,
        sleepSec: 25_200,
        sleepScore: null,
        weightKg: null,
        vo2max: null,
      },
    ])
  })

  it('looks back at most 30 days, newest first, and returns them oldest first', async () => {
    const dates: string[] = []
    const h = makeCtx(
      {
        [sleepUrl]: (req) => {
          dates.push(new URL(req.url).searchParams.get('date') ?? '')
          return Response.json({ dailySleepDTO: { sleepTimeSeconds: 100 }, avgOvernightHrv: 50 })
        },
      },
      { secret: secretFor('thirty') },
    )
    const days = await garminProvider.listWellness?.('2026-01-01', '2026-10-22', h.ctx)
    expect(days).toHaveLength(30)
    // Readiness needs the latest days, so they are asked for first.
    expect(dates[0]).toBe('2026-10-22')
    expect(dates.at(-1)).toBe('2026-09-23')
    expect(days?.[0]?.date).toBe('2026-09-23')
    expect(days?.at(-1)?.date).toBe('2026-10-22')
  })

  it("words a service error in the app's own sentences, which pass the G5 lint", async () => {
    const messages: string[] = []
    const listing = makeCtx(
      {
        [`GET ${API}/activitylist-service/activities/search/activities`]: () =>
          new Response('boom', { status: 503 }),
      },
      { secret: secretFor('msg-list') },
    )
    messages.push(
      await collectMessage(async () => {
        for await (const r of garminProvider.listActivities('2026-08-01', listing.ctx)) void r
      }),
    )
    const download = makeCtx(
      {
        [`GET ${API}/download-service/files/activity/1001`]: () =>
          new Response('boom', { status: 502 }),
      },
      { secret: secretFor('msg-dl') },
    )
    messages.push(await collectMessage(() => garminProvider.fetchActivity(ref, download.ctx)))
    const wellness = makeCtx(
      { [`${sleepUrl}?date=2026-10-21`]: () => new Response('boom', { status: 500 }) },
      { secret: secretFor('msg-well') },
    )
    messages.push(
      await collectMessage(() =>
        garminProvider.listWellness!('2026-10-21', '2026-10-21', wellness.ctx),
      ),
    )
    expect(messages).toEqual([
      'Garmin answered the activity list request with HTTP 503.',
      'Garmin answered the download of activity 1001 with HTTP 502.',
      'Garmin answered the sleep request with HTTP 500.',
    ])
    for (const message of messages) expect(lintText(message), message).toEqual([])
  })

  it('skips days without data but fails on a server error', async () => {
    const h = makeCtx(
      {
        [`${sleepUrl}?date=2026-10-20`]: () => new Response(null, { status: 204 }),
        [`${sleepUrl}?date=2026-10-21`]: () => new Response('boom', { status: 500 }),
      },
      { secret: secretFor('wellfail') },
    )
    await expect(garminProvider.listWellness?.('2026-10-20', '2026-10-21', h.ctx)).rejects.toThrow(
      /HTTP 500/,
    )
  })

  it('pauses on 429 while reading wellness', async () => {
    const h = makeCtx(
      { [sleepUrl]: () => new Response('slow down', { status: 429 }) },
      { secret: secretFor('wellpause') },
    )
    const error = await garminProvider
      .listWellness?.('2026-10-20', '2026-10-22', h.ctx)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RateLimitPause)
    // Only a spent request budget truncates; a refusal by Garmin is a plain pause.
    expect(error).not.toBeInstanceOf(WellnessTruncated)
  })

  describe('when the request budget runs out', () => {
    const downloadUrl = `GET ${API}/download-service/files/activity/`
    const routes = (perDay: 'one' | 'two'): Record<string, FakeRoute> => ({
      [downloadUrl]: () => new Response('missing', { status: 404 }),
      [sleepUrl]: (req) => {
        const date = new URL(req.url).searchParams.get('date') ?? ''
        return Response.json({
          dailySleepDTO: { sleepTimeSeconds: 27_000 },
          ...(perDay === 'one' ? { avgOvernightHrv: 50 } : {}),
          restingHeartRate: 48,
          note: date,
        })
      },
      [`GET ${API}/hrv-service/hrv/`]: () => Response.json({ hrvSummary: { lastNightAvg: 55 } }),
    })

    /** Uses `n` of the run's 200 requests on activity downloads, as a long backfill would. */
    async function spend(h: Harness, n: number): Promise<void> {
      for (let i = 0; i < n; i += 1) await garminProvider.fetchActivity(ref, h.ctx)
    }

    it('throws WellnessTruncated with the days read, oldest first, and the days asked for', async () => {
      const h = makeCtx(routes('one'), { secret: secretFor('trunc') })
      await spend(h, 190)
      const error = await garminProvider
        .listWellness?.('2026-01-01', '2026-10-22', h.ctx)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(WellnessTruncated)
      expect(error).toBeInstanceOf(RateLimitPause)
      const truncated = error as WellnessTruncated
      expect(truncated.daysRead).toBe(10)
      expect(truncated.daysTotal).toBe(30)
      expect(truncated.retryAfterSec).toBe(3600)
      // The ten newest days, ascending: 13 to 22 October.
      expect(truncated.rows.map((r) => r.date)).toEqual(
        Array.from({ length: 10 }, (_, i) => `2026-10-${String(13 + i)}`),
      )
    })

    it('reads zero days when activities used the whole budget', async () => {
      const h = makeCtx(routes('one'), { secret: secretFor('truncnone') })
      await spend(h, 200)
      const error = (await garminProvider
        .listWellness?.('2026-10-01', '2026-10-22', h.ctx)
        .catch((e: unknown) => e)) as WellnessTruncated
      expect(error).toBeInstanceOf(WellnessTruncated)
      expect(error.rows).toEqual([])
      expect(error.daysRead).toBe(0)
      expect(error.daysTotal).toBe(22)
    })

    it('does not count a day that was cut off between its two requests', async () => {
      const h = makeCtx(routes('two'), { secret: secretFor('trunchalf') })
      await spend(h, 199)
      const error = (await garminProvider
        .listWellness?.('2026-10-20', '2026-10-22', h.ctx)
        .catch((e: unknown) => e)) as WellnessTruncated
      expect(error).toBeInstanceOf(WellnessTruncated)
      expect(error.daysRead).toBe(0)
      expect(error.daysTotal).toBe(3)
      expect(error.rows).toEqual([])
    })

    it('returns the whole window when the budget lasts', async () => {
      const h = makeCtx(routes('one'), { secret: secretFor('truncfull') })
      await spend(h, 100)
      const days = await garminProvider.listWellness?.('2026-10-01', '2026-10-22', h.ctx)
      expect(days).toHaveLength(22)
    })
  })
})
