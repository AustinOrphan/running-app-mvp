import { describe, expect, test } from 'vitest'
import { MAX_MESSAGE_CHARS, safeMessage, secretValues } from '../../../server/services/syncLog.ts'

// Synthetic values, long enough to look like credentials.
const ACCESS = 'at-7f3a9c1e5b2d4a60'
const REFRESH = 'rt-0b8d6e2f4c1a9375'
const CLIENT_SECRET = 'cs-5d1e8a3b7c9f2406'
const API_KEY = 'ak-9e4b2d6f1a8c3075'

const LEAKS = [ACCESS, REFRESH, CLIENT_SECRET, API_KEY]

function expectNoLeak(text: string): void {
  for (const leak of LEAKS) expect(text, `leaked ${leak}`).not.toContain(leak)
}

describe('safeMessage', () => {
  test('removes a bearer token', () => {
    const alone = safeMessage(`Request rejected with Bearer ${ACCESS} in the header`)
    expectNoLeak(alone)
    expect(alone).toBe('Request rejected with Bearer [removed] in the header')
    const header = safeMessage(`Request rejected: Authorization: Bearer ${ACCESS} was refused`)
    expectNoLeak(header)
    expect(header).toBe('Request rejected: Authorization: [removed] was refused')
  })

  test.each([
    [
      'a query string',
      `GET https://api.example.com/v1/athlete?access_token=${ACCESS}&page=2 gave 401`,
    ],
    ['a JSON body', `Body: {"access_token":"${ACCESS}","refresh_token":"${REFRESH}"}`],
    ['a form body', `client_id=42&client_secret=${CLIENT_SECRET}&grant_type=refresh_token`],
    ['a header echo', `api_key: ${API_KEY} is not valid`],
    ['an equals sign and quotes', `refresh_token = '${REFRESH}'`],
  ])('removes the values in %s', (_label, input) => {
    expectNoLeak(safeMessage(input))
  })

  // The credential goes, the key stays, so the message still says what was refused.
  test.each([
    ['Basic', 'Authorization: Basic QVBJX0tFWTpzeW50aGV0aWM=', 'Authorization: [removed]'],
    [
      'Basic in lower case',
      'authorization: basic dXNlcjpwYXNzd29yZA==',
      'authorization: [removed]',
    ],
    ['a proxy header', 'Proxy-Authorization: Basic abc123def456', 'Proxy-Authorization: [removed]'],
    ['Token', 'Authorization: token ghp_abcdefghijklmnop', 'Authorization: [removed]'],
    ['Digest', 'Authorization: Digest 5f7a9c3e1b2d4068', 'Authorization: [removed]'],
    [
      'OAuth with parameters',
      'Authorization: OAuth oauth_consumer_key="ck-1234", oauth_token="ot-5678", oauth_signature="sig%2Fabc"',
      'Authorization: [removed]',
    ],
    [
      'a scheme the list does not know',
      'Authorization: Vendor-Auth 9f8e7d6c5b4a',
      'Authorization: [removed]',
    ],
    ['no scheme', 'Authorization: 9f8e7d6c5b4a3210', 'Authorization: [removed]'],
    [
      'a JSON header',
      '{"Authorization":"Basic QVBJX0tFWTpzeW50aGV0aWM=","Accept":"*/*"}',
      '{"Authorization":[removed],"Accept":"*/*"}',
    ],
  ])('removes the credential after Authorization: %s', (_label, input, expected) => {
    expect(safeMessage(input)).toBe(expected)
  })

  test('keeps the words around an Authorization credential', () => {
    expect(
      safeMessage('intervals.icu answered 400 for Authorization: Basic QVBJX0tFWTpz was refused'),
    ).toBe('intervals.icu answered 400 for Authorization: [removed] was refused')
  })

  test.each([
    ['a Cookie header', 'Cookie: sid=abc123; theme=dark', 'Cookie: [removed]'],
    [
      'a Set-Cookie header',
      'Set-Cookie: JSESSIONID=abcdef1234; Path=/; HttpOnly',
      'Set-Cookie: [removed]',
    ],
    [
      'a header on its own line',
      'Refused\nSet-Cookie: sid=abc123\nRetry-After: 30',
      'Refused Set-Cookie: [removed] Retry-After: 30',
    ],
    [
      'a JSON cookie',
      '{"cookie":"sid=abc123; theme=dark","status":401}',
      '{"cookie":[removed],"status":401}',
    ],
  ])('removes the value of %s', (_label, input, expected) => {
    expect(safeMessage(input)).toBe(expected)
  })

  test.each([
    [
      'token in a form body',
      'client_id=42&token=abcdef1234567890&page=2',
      'client_id=42&token=[removed]&page=2',
    ],
    [
      'ticket in a form body',
      'service=x&ticket=ST-12345-abcdef-cas&page=2',
      'service=x&ticket=[removed]&page=2',
    ],
    [
      'access_token in a form body',
      'grant=refresh&access_token=abcdef1234567890',
      'grant=refresh&access_token=[removed]',
    ],
    ['token in JSON', '{"token":"abcdef1234567890","ok":false}', '{"token":[removed],"ok":false}'],
    ['ticket in JSON', '{"ticket":"ST-12345-abcdef-cas"}', '{"ticket":[removed]}'],
    [
      'camelCase tokens',
      'refreshToken: abc123def456 accessToken=zzz999yyy888',
      'refreshToken: [removed] accessToken=[removed]',
    ],
    [
      'OAuth 1 tokens',
      'oauth_token=abc123&oauth_token_secret=def456',
      'oauth_token=[removed]&oauth_token_secret=[removed]',
    ],
    ['a query string', 'GET /sso?ticket=ST-12345-abcdef-cas gave 401', 'GET /sso gave 401'],
  ])('removes %s', (_label, input, expected) => {
    expect(safeMessage(input)).toBe(expected)
  })

  test('keeps ordinary words that only mention a token, a ticket or a cookie', () => {
    const text = 'The token expired, the ticket was refused and the cookie jar is empty (HTTP 401).'
    expect(safeMessage(text)).toBe(text)
  })

  test('cuts a text that holds several credential forms at 300 characters', () => {
    const text = safeMessage(
      `Authorization: Basic ${'QVBJX0tFWTpz'.repeat(30)} token=${'a'.repeat(300)} ${'word '.repeat(100)}`,
    )
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS)
    expect(text.endsWith('…')).toBe(true)
    expect(text).not.toContain('QVBJX0tFWTpz')
    expect(text).not.toContain('aaaaaaa')
  })

  test('removes every query string and keeps the address', () => {
    const text = safeMessage(
      'Failed https://connectapi.garmin.com/sleep-service/sleep/dailySleepData?date=2026-10-20&x=1 (HTTP 500).',
    )
    expect(text).toBe(
      'Failed https://connectapi.garmin.com/sleep-service/sleep/dailySleepData (HTTP 500).',
    )
  })

  test('removes the secret values it is given, also url-encoded, and keeps ordinary words', () => {
    const secret = {
      accessToken: 'tok en/with+chars==',
      refreshToken: REFRESH,
      nested: { k: API_KEY },
    }
    const values = secretValues(secret)
    expect(values).toEqual(expect.arrayContaining([secret.accessToken, REFRESH, API_KEY]))
    const text = safeMessage(
      `Refused ${secret.accessToken} / ${encodeURIComponent(secret.accessToken)} / ${REFRESH} / ${API_KEY} for the athlete`,
      values,
    )
    expectNoLeak(text)
    expect(text).not.toContain('tok en')
    expect(text).not.toContain(encodeURIComponent(secret.accessToken))
    expect(text).toContain('for the athlete')
  })

  test('ignores secret values too short to search for', () => {
    expect(secretValues({ a: 'abc', n: 42, b: ['12345', 'long enough value'] })).toEqual([
      'long enough value',
    ])
    expect(safeMessage('The abc of it', ['abc'])).toBe('The abc of it')
  })

  test('removes a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJlLXNpZw'
    expect(safeMessage(`Bad token ${jwt} in the answer`)).not.toContain(jwt)
  })

  test('cuts at 300 characters and leaves a shorter text alone', () => {
    const exact = 'a'.repeat(MAX_MESSAGE_CHARS)
    expect(safeMessage(exact)).toBe(exact)
    const cut = safeMessage('word '.repeat(200))
    expect(cut.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS)
    expect(cut.endsWith('…')).toBe(true)
  })

  describe('scrubs before it cuts', () => {
    // Longer than the cut's margin: a cut that came first would leave a long prefix of it behind.
    const SECRET = 'sk-live-4f9d2a7c1e8b5036d9a2c7e1f4b8035a'

    function expectNoPrefix(text: string): void {
      expect(SECRET).toHaveLength(40)
      expect(text).not.toContain(SECRET.slice(0, 6))
    }

    test('a secret across the cut, in a text that fits once it is replaced', () => {
      const raw = `${'x'.repeat(270)} ${SECRET} done`
      // The raw text is over the cut and the scrubbed text is not: no cut, no ellipsis.
      expect(raw.length).toBeGreaterThan(MAX_MESSAGE_CHARS)
      const text = safeMessage(raw, [SECRET])
      expectNoPrefix(text)
      expect(text).toBe(`${'x'.repeat(270)} [removed] done`)
    })

    test('a secret across the cut, in a text that is still over the cut once it is replaced', () => {
      const raw = `${'x'.repeat(280)} ${SECRET} ${'y'.repeat(50)}`
      const text = safeMessage(raw, [SECRET])
      expectNoPrefix(text)
      expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS)
      expect(text.endsWith('…')).toBe(true)
      expect(text.startsWith('x'.repeat(280))).toBe(true)
    })
  })

  test('takes an Error, a string or nothing, and collapses whitespace', () => {
    expect(safeMessage(new Error('boom\n  twice'))).toBe('boom twice')
    expect(safeMessage('plain')).toBe('plain')
    expect(safeMessage(undefined)).toBe('')
    expect(safeMessage(null)).toBe('')
    expect(safeMessage(42)).toBe('42')
  })

  test('is idempotent', () => {
    const once = safeMessage(`Bearer ${ACCESS} and ?access_token=${ACCESS}`)
    expect(safeMessage(once)).toBe(once)
  })
})
