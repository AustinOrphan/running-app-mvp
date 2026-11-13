import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ChunkLoadError } from '../../web/components/ChunkBoundary.tsx'
import { resetClientErrorReportsForTests } from '../../web/pwa/clientErrors.ts'
import { installWindowErrorReporting } from '../../web/pwa/windowErrors.ts'

// FB1: an error outside rendering reaches the server through the same report as the boundary's.

let remove: () => void
let fetchMock: ReturnType<typeof vi.fn>
let now = 1_000_000

function reports(): Array<Record<string, string>> {
  return fetchMock.mock.calls
    .filter(([url]) => url === '/api/client-errors')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, string>)
}

/** An `error` event as the browser raises it, with a listener-visible `error` object or none. */
function raise(init: ErrorEventInit) {
  window.dispatchEvent(new ErrorEvent('error', init))
}

/** jsdom has no PromiseRejectionEvent: the listener reads only `reason`. */
function reject(reason: unknown) {
  const event = new Event('unhandledrejection') as Event & { reason: unknown }
  event.reason = reason
  window.dispatchEvent(event)
}

beforeEach(() => {
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  vi.stubGlobal('fetch', fetchMock)
  resetClientErrorReportsForTests()
  window.history.replaceState(null, '', '/log?x=1')
  remove = installWindowErrorReporting()
})

afterEach(() => {
  remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('window error reporting', () => {
  test('a thrown error in an event handler sends one report with the six fields', () => {
    const error = new Error('Handler exploded')
    raise({ error, message: error.message, filename: 'http://localhost/assets/index-abc.js' })
    expect(reports()).toHaveLength(1)
    const report = reports()[0]
    expect(report).toMatchObject({
      message: 'Handler exploded',
      path: '/log',
      buildId: 'dev',
      componentStack: '',
    })
    expect(report?.['stack']).toContain('Handler exploded')
    expect(report?.['userAgent']).toBeTruthy()
  })

  test('an unhandled rejection sends one report', () => {
    reject(new Error('Promise exploded'))
    expect(reports()).toHaveLength(1)
    expect(reports()[0]).toMatchObject({ message: 'Promise exploded', path: '/log' })
  })

  test('a rejection with a string reason and an event with no error object are coerced', () => {
    reject('plain reason')
    raise({ message: 'Uncaught TypeError: x is not a function' })
    expect(reports().map((report) => report['message'])).toEqual([
      'plain reason',
      'Uncaught TypeError: x is not a function',
    ])
  })

  test('the cap of five and the five-second dedupe are the boundary reports', () => {
    for (let i = 0; i < 3; i++) reject(new Error('same'))
    expect(reports()).toHaveLength(1)
    now += 6000
    reject(new Error('same'))
    expect(reports()).toHaveLength(2)
    for (let i = 0; i < 10; i++) reject(new Error(`other ${i}`))
    expect(reports()).toHaveLength(5)
  })

  test('"Script error." with no stack sends nothing', () => {
    raise({ message: 'Script error.', filename: '' })
    raise({ message: 'Script error', error: null })
    expect(reports()).toHaveLength(0)
  })

  test('errors from a browser extension send nothing', () => {
    raise({
      error: new Error('extension'),
      message: 'extension',
      filename: 'chrome-extension://abc/content.js',
    })
    const withStack = new Error('from a stack')
    withStack.stack = 'Error: x\n    at f (moz-extension://abc/inject.js:1:1)'
    reject(withStack)
    expect(reports()).toHaveLength(0)
  })

  test('a ChunkLoadError is not reported twice', () => {
    const chunk = new ChunkLoadError(new Error('stand-in'))
    raise({ error: chunk, message: chunk.message })
    reject(chunk)
    reject(new TypeError('Failed to fetch dynamically imported module: /assets/Plan-1.js'))
    expect(reports()).toHaveLength(0)
  })

  test('installing twice adds one listener, and removing stops the reports', () => {
    expect(installWindowErrorReporting()).toBe(remove)
    reject(new Error('once'))
    expect(reports()).toHaveLength(1)
    remove()
    reject(new Error('after removal'))
    expect(reports()).toHaveLength(1)
    remove = installWindowErrorReporting()
  })
})
