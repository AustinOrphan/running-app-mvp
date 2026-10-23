import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { useLogin, useLogout, useSetup } from '../../web/api/auth.ts'
import { UNAUTHORIZED_EVENT, keys } from '../../web/api/client.ts'
import { DONE_DRAFT_PREFIX, FUEL_DRAFT_PREFIX, purgeDrafts } from '../../web/pwa/drafts.ts'
import {
  OUTBOX_ROUTES,
  createOutbox,
  getOutbox,
  memoryStore,
  purgeDeviceData,
  resetOutboxForTests,
  useOutboxReplay,
} from '../../web/pwa/outbox.ts'
import { mockApi } from './helpers.tsx'

const URL = '/api/checkins/2026-03-18'

/** An outbox holding one check-in that cannot be sent (no connection), installed as the page's. */
async function queuedOutbox() {
  const outbox = createOutbox({
    store: memoryStore(),
    routes: OUTBOX_ROUTES,
    send: () => Promise.resolve({ kind: 'retry' }),
    now: () => Date.UTC(2026, 2, 18, 12),
    isOnline: () => false,
  })
  await outbox.save(URL, { fatigue: 4, painArea: 'knee' })
  resetOutboxForTests(outbox)
  return outbox
}

/** What a day of use leaves in local storage: both drafts, and two keys that are not data. */
function seedDevice(): void {
  window.localStorage.clear()
  window.localStorage.setItem(`${DONE_DRAFT_PREFIX}2026-03-18`, '{"duration":"52"}')
  window.localStorage.setItem(`${DONE_DRAFT_PREFIX}u-a_2026-03-19`, '{"duration":"40"}')
  window.localStorage.setItem(`${FUEL_DRAFT_PREFIX}run9`, '{"items":[],"fluid":"600"}')
  window.localStorage.setItem('rl_today_more', 'open')
  window.localStorage.setItem('theme', 'dark')
}

function draftKeys(): string[] {
  return Object.keys(window.localStorage)
    .filter((key) => key.startsWith(DONE_DRAFT_PREFIX) || key.startsWith(FUEL_DRAFT_PREFIX))
    .sort()
}

function withClient(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('purging the drafts', () => {
  test('removes the Done and fuel drafts and nothing else', () => {
    seedDevice()
    purgeDrafts()
    expect(draftKeys()).toEqual([])
    expect(window.localStorage.getItem('rl_today_more')).toBe('open')
    expect(window.localStorage.getItem('theme')).toBe('dark')
  })

  test('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new DOMException('Blocked.', 'SecurityError')
    })
    expect(() => {
      purgeDrafts()
    }).not.toThrow()
    vi.restoreAllMocks()
  })

  test('purgeDeviceData empties the outbox too', async () => {
    seedDevice()
    const outbox = await queuedOutbox()
    expect(outbox.getState().entries).toHaveLength(1)
    await purgeDeviceData()
    expect(draftKeys()).toEqual([])
    expect(outbox.getState().entries).toEqual([])
  })
})

describe('signing out', () => {
  test('removes the drafts along with the cache and the queue', async () => {
    seedDevice()
    const outbox = await queuedOutbox()
    mockApi({ 'POST /api/auth/logout': () => undefined })
    const queryClient = new QueryClient()
    queryClient.setQueryData([keys.me], { id: 'u-a' })
    const { result } = renderHook(() => useLogout(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await result.current.mutateAsync()
    })
    expect(draftKeys()).toEqual([])
    expect(outbox.getState().entries).toEqual([])
    expect(queryClient.getQueryData([keys.me])).toBeNull()
  })
})

describe('a 401 while the app is open', () => {
  test('removes the drafts and empties the queue', async () => {
    seedDevice()
    const outbox = await queuedOutbox()
    renderHook(
      () => {
        useOutboxReplay('u-a')
      },
      { wrapper: withClient(new QueryClient()) },
    )
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    })
    await waitFor(() => {
      expect(outbox.getState().entries).toEqual([])
    })
    expect(draftKeys()).toEqual([])
    expect(window.localStorage.getItem('theme')).toBe('dark')
  })
})

describe('signing in', () => {
  const user = { id: 'u-b', email: 'b@example.com', displayName: null, units: 'km' }

  test('starts a new session with an empty queue', async () => {
    const outbox = await queuedOutbox()
    mockApi({ 'POST /api/auth/login': () => user })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useLogin(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await result.current.mutateAsync({ email: user.email, password: 'a long password' })
    })
    expect(outbox.getState().entries).toEqual([])
    expect(queryClient.getQueryData([keys.me])).toEqual(user)
  })

  test('creating the first account does the same', async () => {
    const outbox = await queuedOutbox()
    mockApi({ 'POST /api/setup': () => user })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useSetup(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await result.current.mutateAsync({ email: user.email, password: 'a long password' })
    })
    expect(outbox.getState().entries).toEqual([])
    expect(queryClient.getQueryData([keys.me])).toEqual(user)
    expect(getOutbox()).toBe(outbox)
  })
})
