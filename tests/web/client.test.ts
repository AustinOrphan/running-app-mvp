import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, ApiError, fieldErrors, qs, UNAUTHORIZED_EVENT } from '../../web/api/client.ts'
import { mockApi } from './helpers.tsx'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('api client', () => {
  test('a validation error body becomes an ApiError and feeds fieldErrors', async () => {
    mockApi({
      'POST /api/setup': () => ({
        status: 400,
        body: {
          error: {
            code: 'validation',
            message: 'Some fields need attention.',
            details: { issues: [{ path: 'password', message: 'Use at least 12 characters.' }] },
          },
        },
      }),
    })
    const error = await api('POST', '/setup', { password: 'short' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('validation')
    expect((error as ApiError).status).toBe(400)
    expect(fieldErrors(error)).toEqual({ password: 'Use at least 12 characters.' })
  })

  test('fieldErrors is empty for other errors', () => {
    expect(fieldErrors(new Error('x'))).toEqual({})
    expect(fieldErrors(new ApiError(404, 'not_found', 'Not found.'))).toEqual({})
  })

  test('a 401 outside the auth flow dispatches rl:unauthorized; inside it does not', async () => {
    const unauthorized = {
      status: 401,
      body: { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
    }
    mockApi({
      'GET /api/settings': () => unauthorized,
      'POST /api/auth/login': () => unauthorized,
    })
    const listener = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, listener)
    try {
      await api('GET', '/settings').catch(() => undefined)
      expect(listener).toHaveBeenCalledTimes(1)
      await api('POST', '/auth/login', {}).catch(() => undefined)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(UNAUTHORIZED_EVENT, listener)
    }
  })

  test('sends JSON under /api and resolves undefined for an empty response', async () => {
    const { calls } = mockApi({
      'DELETE /api/activities/a1': () => ({ status: 204, body: undefined }),
    })
    await expect(api('DELETE', '/activities/a1')).resolves.toBeUndefined()
    expect(calls).toEqual([{ method: 'DELETE', url: '/api/activities/a1', body: undefined }])
  })

  test('an unreachable server throws a plain ApiError', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    const error = await api('GET', '/plan').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(0)
  })

  test('qs drops undefined values', () => {
    expect(qs({ a: 1, b: undefined })).toBe('?a=1')
    expect(qs({ b: undefined })).toBe('')
  })
})
