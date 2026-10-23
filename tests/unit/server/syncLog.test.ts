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

  test('a secret that sits across the cut is gone before the cut', () => {
    const text = safeMessage(`${'x'.repeat(290)} ${ACCESS}`, [ACCESS])
    expectNoLeak(text)
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS)
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
