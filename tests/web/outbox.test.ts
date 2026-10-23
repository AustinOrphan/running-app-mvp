import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { UNAUTHORIZED_EVENT, keys } from '../../web/api/client.ts'
import {
  OUTBOX_MAX_AGE_MS,
  OUTBOX_ROUTES,
  createOutbox,
  defaultStore,
  getOutbox,
  memoryStore,
  resetOutboxForTests,
  sendEntry,
  useOutboxReplay,
  type Outbox,
  type OutboxEntry,
  type OutboxRoute,
  type OutboxStore,
  type SendResult,
} from '../../web/pwa/outbox.ts'
import { mockApi } from './helpers.tsx'

const DAY = '2026-03-18'
const URL = `/api/checkins/${DAY}`
const OTHER_URL = '/api/checkins/2026-03-17'
const FUEL_URL = '/api/fuel/logs/cm1abc2def'

interface Rig {
  outbox: Outbox
  store: OutboxStore
  send: ReturnType<typeof vi.fn<(entry: OutboxEntry) => Promise<SendResult>>>
  online: { value: boolean }
  clock: { now: number }
}

function rig(
  over: {
    store?: OutboxStore
    routes?: readonly OutboxRoute[]
    send?: (entry: OutboxEntry) => Promise<SendResult>
    sendTimeoutMs?: number
  } = {},
): Rig {
  const store = over.store ?? memoryStore()
  const send = vi.fn(over.send ?? (() => Promise.resolve<SendResult>({ kind: 'sent' })))
  const online = { value: true }
  const clock = { now: Date.UTC(2026, 2, 18, 12) }
  const outbox = createOutbox({
    store,
    routes: over.routes ?? OUTBOX_ROUTES,
    send,
    now: () => clock.now,
    isOnline: () => online.value,
    sendTimeoutMs: over.sendTimeoutMs,
  })
  return { outbox, store, send, online, clock }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the allowlist', () => {
  const route = (label: string) => OUTBOX_ROUTES.find((candidate) => candidate.label === label)

  test('holds the check-in of a day and the fuel log of a run, and nothing else', () => {
    expect(OUTBOX_ROUTES.map((entry) => entry.label)).toEqual(['check-in', 'fuel log'])
  })

  test('the check-in route matches one day and nothing near it', () => {
    expect(route('check-in')?.matches(URL)).toBe(true)
    for (const url of [
      '/api/activities',
      '/api/checkins',
      '/api/checkins/today',
      `${URL}?x=1`,
      `${URL}/`,
      `/api/plan/sessions/${DAY}`,
      `/api/checkins/${DAY}/extra`,
      FUEL_URL,
    ]) {
      expect(route('check-in')?.matches(url), url).toBe(false)
    }
  })

  test('the fuel log route matches the PUT of one run and not its siblings', () => {
    expect(route('fuel log')?.matches(FUEL_URL)).toBe(true)
    for (const url of [
      '/api/fuel/logs',
      '/api/fuel/logs/',
      `${FUEL_URL}/skip`,
      `${FUEL_URL}?x=1`,
      '/api/fuel',
      '/api/fuel/products/cm1abc',
      '/api/fuel/settings',
      URL,
    ]) {
      expect(route('fuel log')?.matches(url), url).toBe(false)
    }
  })

  test('a write to a URL outside it is refused before anything is stored', async () => {
    const { outbox, store, send } = rig()
    for (const url of ['/api/activities', `${FUEL_URL}/skip`]) {
      await expect(outbox.save(url, { durationSec: 60 })).rejects.toThrow(/allowlist/)
    }
    expect(await store.read()).toEqual([])
    expect(send).not.toHaveBeenCalled()
  })
})

describe('saving', () => {
  test('stores the write, sends it at once and leaves nothing queued', async () => {
    const { outbox, store, send } = rig()
    const result = await outbox.save(URL, { fatigue: 4 })
    expect(result).toEqual({ status: 'sent' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toMatchObject({ url: URL, body: { fatigue: 4 } })
    expect(await store.read()).toEqual([])
    expect(outbox.getState().entries).toEqual([])
  })

  test('with no connection the write is kept and the answer is queued', async () => {
    const { outbox, store, send, online } = rig()
    online.value = false
    expect(await outbox.save(URL, { fatigue: 4 })).toEqual({ status: 'queued' })
    expect(send).not.toHaveBeenCalled()
    expect((await store.read()).map((entry) => entry.url)).toEqual([URL])
    expect(outbox.getState().entries).toHaveLength(1)
  })

  test('a connection that fails mid-request keeps the write too', async () => {
    const { outbox, store } = rig({ send: () => Promise.resolve({ kind: 'retry' }) })
    expect(await outbox.save(URL, { fatigue: 2 })).toEqual({ status: 'queued' })
    expect(await store.read()).toHaveLength(1)
  })

  test('a refusal comes back as the answer with the server words, and nothing is queued or noticed', async () => {
    const { outbox, store } = rig({
      send: () => Promise.resolve({ kind: 'refused', reason: 'Use a real date.' }),
    })
    expect(await outbox.save(URL, { fatigue: 4 })).toEqual({
      status: 'rejected',
      reason: 'Use a real date.',
    })
    expect(await store.read()).toEqual([])
    expect(outbox.getState().notices).toEqual([])
  })
})

describe('one entry per URL', () => {
  test('a check-in write is merged into the queued one and keeps its place', async () => {
    const { outbox, store, online } = rig()
    online.value = false
    await outbox.save(URL, { fatigue: 4 })
    await outbox.save(OTHER_URL, { fatigue: 1 })
    await outbox.save(URL, { soreness: 2, fatigue: 5 })
    const entries = outbox.getState().entries
    expect(entries.map((entry) => entry.url)).toEqual([URL, OTHER_URL])
    expect(entries[0]).toMatchObject({ body: { fatigue: 5, soreness: 2 }, version: 2, seq: 1 })
    expect(await store.read()).toHaveLength(2)
  })

  test('keeps the first queued time, and an absent key never overwrites', async () => {
    const { outbox, online, clock } = rig()
    online.value = false
    await outbox.save(URL, { fatigue: 4, mood: 3 })
    const first = clock.now
    clock.now += 60_000
    await outbox.save(URL, { mood: undefined, stress: null })
    expect(outbox.getState().entries[0]).toMatchObject({
      queuedAt: first,
      body: { fatigue: 4, mood: 3, stress: null },
    })
  })

  test('a route that replaces keeps only the newest body', async () => {
    const routes: OutboxRoute[] = [
      { label: 'log', matches: (url) => url === '/api/log', combine: 'replace', invalidates: [] },
    ]
    const { outbox, online } = rig({ routes })
    online.value = false
    await outbox.save('/api/log', { a: 1, b: 2 })
    await outbox.save('/api/log', { a: 3 })
    expect(outbox.getState().entries[0]?.body).toEqual({ a: 3 })
  })
})

describe('replay', () => {
  test('sends oldest first and removes each entry the server took', async () => {
    const { outbox, store, send, online } = rig()
    online.value = false
    await outbox.save(URL, { fatigue: 4 })
    await outbox.save(OTHER_URL, { fatigue: 2 })
    online.value = true
    await outbox.flush()
    expect(send.mock.calls.map(([entry]) => entry.url)).toEqual([URL, OTHER_URL])
    expect(await store.read()).toEqual([])
  })

  test('stops at the first entry that cannot be sent and keeps the rest in order', async () => {
    let calls = 0
    const { outbox, store, send, online } = rig({
      send: () => Promise.resolve<SendResult>(++calls === 1 ? { kind: 'retry' } : { kind: 'sent' }),
    })
    online.value = false
    await outbox.save(URL, { fatigue: 4 })
    await outbox.save(OTHER_URL, { fatigue: 2 })
    online.value = true
    await outbox.flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect((await store.read()).map((entry) => entry.url)).toEqual([URL, OTHER_URL])
    await outbox.flush()
    expect(send.mock.calls.map(([entry]) => entry.url)).toEqual([URL, URL, OTHER_URL])
    expect(await store.read()).toEqual([])
  })

  test('an entry the server refuses is dropped with one message and the queue goes on', async () => {
    const { outbox, store, send, online } = rig({
      send: (entry) =>
        Promise.resolve<SendResult>(
          entry.url === URL ? { kind: 'refused', reason: 'No.' } : { kind: 'sent' },
        ),
    })
    online.value = false
    await outbox.save(URL, { fatigue: 4 })
    await outbox.save(OTHER_URL, { fatigue: 2 })
    online.value = true
    await outbox.flush()
    expect(send).toHaveBeenCalledTimes(2)
    expect(await store.read()).toEqual([])
    const { notices } = outbox.getState()
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ url: URL })
    expect(notices[0]?.message).toBe(
      'A check-in saved on this phone was not accepted and was removed. Enter it again if it still applies.',
    )
    outbox.dismissNotice(notices[0]?.id ?? -1)
    expect(outbox.getState().notices).toEqual([])
  })

  test('a save that meets a 401 is told so, not that it was sent', async () => {
    const { outbox, store } = rig({ send: () => Promise.resolve({ kind: 'unauthorized' }) })
    expect(await outbox.save(URL, { fatigue: 4 })).toEqual({
      status: 'rejected',
      reason: 'You are signed out.',
    })
    expect(await store.read()).toEqual([])
  })

  test('a 401 empties the queue, notices included', async () => {
    const { outbox, store, online } = rig({ send: () => Promise.resolve({ kind: 'unauthorized' }) })
    online.value = false
    await outbox.save(URL, { fatigue: 4 })
    await outbox.save(OTHER_URL, { fatigue: 2 })
    online.value = true
    await outbox.flush()
    expect(await store.read()).toEqual([])
    expect(outbox.getState()).toEqual({ entries: [], notices: [] })
  })

  test('entries older than 7 days are dropped unsent, the 7th day itself is kept', async () => {
    const { outbox, store, send, online, clock } = rig()
    online.value = false
    await outbox.save(OTHER_URL, { fatigue: 1 })
    clock.now += 1000
    await outbox.save(URL, { fatigue: 4 })
    online.value = true
    // The older entry is exactly 7 days old at the cut-off, the newer one 1 s less.
    clock.now = Date.UTC(2026, 2, 18, 12) + OUTBOX_MAX_AGE_MS
    await outbox.flush()
    expect(send.mock.calls.map(([entry]) => entry.url)).toEqual([OTHER_URL, URL])
    expect(await store.read()).toEqual([])

    online.value = false
    await outbox.save(OTHER_URL, { fatigue: 1 })
    clock.now += OUTBOX_MAX_AGE_MS + 1
    online.value = true
    send.mockClear()
    await outbox.flush()
    expect(send).not.toHaveBeenCalled()
    expect(await store.read()).toEqual([])
  })

  test('a send that never answers counts as no connection, and does not hold the queue', async () => {
    let calls = 0
    const { outbox, store, send } = rig({
      sendTimeoutMs: 20,
      send: () =>
        ++calls === 1 ? new Promise<SendResult>(() => {}) : Promise.resolve({ kind: 'sent' }),
    })
    // The answer comes after the timeout, not after the request the browser may still be holding.
    expect(await outbox.save(URL, { fatigue: 4 })).toEqual({ status: 'queued' })
    expect(await store.read()).toHaveLength(1)
    await outbox.flush()
    expect(send).toHaveBeenCalledTimes(2)
    expect(await store.read()).toEqual([])
  })

  test('a send that throws counts as no connection', async () => {
    const { outbox, store } = rig({ send: () => Promise.reject(new Error('Boom.')) })
    expect(await outbox.save(URL, { fatigue: 4 })).toEqual({ status: 'queued' })
    expect(await store.read()).toHaveLength(1)
  })

  test('two triggers at once make one request', async () => {
    let release: (() => void) | undefined
    const { outbox, send, online } = rig({
      send: () =>
        new Promise<SendResult>((resolve) => {
          release = () => {
            resolve({ kind: 'sent' })
          }
        }),
    })
    online.value = false
    await outbox.save(URL, { fatigue: 4 })
    online.value = true
    const runs = [outbox.flush(), outbox.flush(), outbox.flush()]
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1)
    })
    release?.()
    await Promise.all(runs)
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('a write made while its entry is on the wire is not lost', async () => {
    const releases: Array<() => void> = []
    const { outbox, store, send } = rig({
      send: () =>
        new Promise<SendResult>((resolve) => {
          releases.push(() => {
            resolve({ kind: 'sent' })
          })
        }),
    })
    const first = outbox.save(URL, { fatigue: 4 })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1)
    })
    const second = outbox.save(URL, { soreness: 2 })
    await vi.waitFor(() => {
      expect(outbox.getState().entries[0]?.version).toBe(2)
    })
    releases[0]?.()
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2)
    })
    expect(send.mock.calls[1]?.[0].body).toEqual({ fatigue: 4, soreness: 2 })
    releases[1]?.()
    expect(await first).toEqual({ status: 'sent' })
    expect(await second).toEqual({ status: 'sent' })
    expect(await store.read()).toEqual([])
  })
})

describe('a fuel log', () => {
  const log = { items: [{ productId: 'p1', servings: 2 }], fluidMl: 500, gut: 1, notes: 'Cold.' }

  test('queued with no connection, it replays as a whole PUT and the server read is refreshed', async () => {
    const { outbox, store, send, online } = rig()
    online.value = false
    expect(await outbox.save(FUEL_URL, log)).toEqual({ status: 'queued' })
    expect(await store.read()).toHaveLength(1)
    expect(send).not.toHaveBeenCalled()

    online.value = true
    const heard: string[] = []
    outbox.onSent((entry) => {
      heard.push(entry.url)
    })
    await outbox.flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toMatchObject({ url: FUEL_URL, body: log })
    expect(heard).toEqual([FUEL_URL])
    expect(await store.read()).toEqual([])
  })

  test('a second write to the same run replaces the first instead of merging with it', async () => {
    const { outbox, online } = rig()
    online.value = false
    await outbox.save(FUEL_URL, log)
    await outbox.save(FUEL_URL, { items: [], fluidMl: null, gut: 3 })
    const entries = outbox.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]?.body).toEqual({ items: [], fluidMl: null, gut: 3 })
    expect(entries[0]?.version).toBe(2)
  })

  test('replays in order with a check-in queued before it, and a refusal drops only itself', async () => {
    const { outbox, store, send, online } = rig({
      send: (entry) =>
        Promise.resolve<SendResult>(
          entry.url === FUEL_URL ? { kind: 'refused', reason: 'No gut score.' } : { kind: 'sent' },
        ),
    })
    online.value = false
    await outbox.save(URL, { fatigue: 4 })
    await outbox.save(FUEL_URL, log)
    await outbox.save(OTHER_URL, { fatigue: 2 })
    online.value = true
    await outbox.flush()
    expect(send.mock.calls.map(([entry]) => entry.url)).toEqual([URL, FUEL_URL, OTHER_URL])
    expect(await store.read()).toEqual([])
    expect(outbox.getState().notices.map((notice) => notice.message)).toEqual([
      'A fuel log saved on this phone was not accepted and was removed. Enter it again if it still applies.',
    ])
  })

  test('the app-wide replay refreshes the fuel lab and Today once the server has it', async () => {
    const { outbox, online } = rig()
    online.value = false
    await outbox.save(FUEL_URL, log)
    online.value = true
    resetOutboxForTests(outbox)
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(
      () => {
        useOutboxReplay()
      },
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      },
    )
    await waitFor(() => {
      expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual(
        expect.arrayContaining([[keys.fuel], [keys.today]]),
      )
    })
  })

  test('a fuel log put through the real client reaches the server once, from the queue', async () => {
    const { calls } = mockApi({ [`PUT ${FUEL_URL}`]: () => ({}) })
    const online = { value: false }
    const outbox = createOutbox({
      store: memoryStore(),
      routes: OUTBOX_ROUTES,
      send: sendEntry,
      now: () => Date.UTC(2026, 2, 18, 12),
      isOnline: () => online.value,
    })
    await outbox.save(FUEL_URL, log)
    expect(calls).toEqual([])
    online.value = true
    await outbox.flush()
    await outbox.flush()
    expect(calls).toEqual([{ method: 'PUT', url: FUEL_URL, body: log }])
  })
})

describe('a reload', () => {
  test('a new outbox over the same store finds the queue and sends it', async () => {
    const store = memoryStore()
    const before = rig({ store })
    before.online.value = false
    await before.outbox.save(URL, { fatigue: 4 })

    const after = rig({ store })
    await vi.waitFor(() => {
      expect(after.outbox.getState().entries).toHaveLength(1)
    })
    await after.outbox.flush()
    expect(after.send).toHaveBeenCalledTimes(1)
    expect(await store.read()).toEqual([])
  })
})

describe('clear', () => {
  test('forgets the queue and the notices', async () => {
    const { outbox, store, online } = rig()
    online.value = false
    await outbox.save(URL, { fatigue: 4 })
    await outbox.clear()
    expect(await store.read()).toEqual([])
    expect(outbox.getState().entries).toEqual([])
  })
})

describe('the store of the page', () => {
  test('is memory where IndexedDB does not exist', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const store = defaultStore()
    const outbox = createOutbox({
      store,
      routes: OUTBOX_ROUTES,
      send: () => Promise.resolve({ kind: 'sent' }),
      now: () => 1,
      isOnline: () => false,
    })
    await outbox.save(URL, { fatigue: 3 })
    expect(await store.read()).toHaveLength(1)
    vi.unstubAllGlobals()
  })

  test('falls back to memory when IndexedDB will not open', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('The database is blocked.')
      },
    })
    const store = defaultStore()
    await store.transact(() => [{ url: URL, body: {}, queuedAt: 1, seq: 1, version: 1 }])
    expect(await store.read()).toHaveLength(1)
    vi.unstubAllGlobals()
  })
})

describe('sending an entry', () => {
  const entry: OutboxEntry = { url: URL, body: { fatigue: 4 }, queuedAt: 1, seq: 1, version: 1 }

  test('puts the body to the URL as JSON and reports a 200 as sent', async () => {
    const { calls } = mockApi({ [`PUT ${URL}`]: () => ({}) })
    expect(await sendEntry(entry)).toEqual({ kind: 'sent' })
    expect(calls).toEqual([{ method: 'PUT', url: URL, body: { fatigue: 4 } }])
  })

  test.each([500, 502, 503, 408, 429])('a %i is kept for later', async (status) => {
    mockApi({
      [`PUT ${URL}`]: () => ({ status, body: { error: { code: 'internal', message: 'Later.' } } }),
    })
    expect(await sendEntry(entry)).toEqual({ kind: 'retry' })
  })

  test('a request that never got an answer is kept for later', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    expect(await sendEntry(entry)).toEqual({ kind: 'retry' })
  })

  test.each([400, 403, 404, 422])('a %i is refused with the server words', async (status) => {
    mockApi({
      [`PUT ${URL}`]: () => ({
        status,
        body: { error: { code: 'validation', message: 'Use a real date.' } },
      }),
    })
    expect(await sendEntry(entry)).toEqual({ kind: 'refused', reason: 'Use a real date.' })
  })

  test('a 401 is reported, and the app hears of it', async () => {
    mockApi({
      [`PUT ${URL}`]: () => ({
        status: 401,
        body: { error: { code: 'unauthorized', message: 'Sign in.' } },
      }),
    })
    const heard = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, heard)
    expect(await sendEntry(entry)).toEqual({ kind: 'unauthorized' })
    window.removeEventListener(UNAUTHORIZED_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('useOutboxReplay', () => {
  function mount(outbox: Outbox) {
    resetOutboxForTests(outbox)
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const view = renderHook(
      () => {
        useOutboxReplay()
      },
      { wrapper },
    )
    return { ...view, invalidate }
  }

  test('sends the queue when the app opens, on online and on a return to the foreground', async () => {
    const { outbox, send, online } = rig()
    online.value = false
    await outbox.save(URL, { fatigue: 4 })
    await outbox.save(OTHER_URL, { fatigue: 2 })
    online.value = true
    mount(outbox)
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2)
    })

    online.value = false
    await outbox.save(URL, { fatigue: 5 })
    online.value = true
    send.mockClear()
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1)
    })

    online.value = false
    await outbox.save(URL, { fatigue: 1 })
    online.value = true
    send.mockClear()
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1)
    })
  })

  test('refreshes what a sent check-in changed', async () => {
    const { outbox } = rig()
    const { invalidate } = mount(outbox)
    await outbox.save(URL, { fatigue: 4 })
    await waitFor(() => {
      expect(invalidate.mock.calls.map(([filter]) => filter?.queryKey)).toEqual(
        expect.arrayContaining([[keys.today], [keys.checkins], [keys.wellness]]),
      )
    })
  })

  test('clears the queue on a 401 and stops listening when it unmounts', async () => {
    const { outbox, store, online, send } = rig()
    online.value = false
    await outbox.save(URL, { fatigue: 4 })
    const { unmount } = mount(outbox)
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    })
    await waitFor(async () => {
      expect(await store.read()).toEqual([])
    })
    unmount()
    online.value = true
    send.mockClear()
    await outbox.save(URL, { fatigue: 2 })
    send.mockClear()
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('the outbox of the page', () => {
  test('is one per page until it is reset', () => {
    resetOutboxForTests()
    const first = getOutbox()
    expect(getOutbox()).toBe(first)
    resetOutboxForTests()
    expect(getOutbox()).not.toBe(first)
  })
})
