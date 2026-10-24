import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, test, vi } from 'vitest'
import { useLogin, useLogout, useSetup } from '../../web/api/auth.ts'
import { UNAUTHORIZED_EVENT, keys } from '../../web/api/client.ts'
import { App } from '../../web/App.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
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
import { activityPage, mockApi } from './helpers.tsx'
import { makeCoach, makeHero, makeSession, makeToday } from './today-fixtures.ts'

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

  test('starts a new session with an empty queue and no drafts', async () => {
    seedDevice()
    const outbox = await queuedOutbox()
    mockApi({ 'POST /api/auth/login': () => user })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useLogin(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await result.current.mutateAsync({ email: user.email, password: 'a long password' })
    })
    expect(outbox.getState().entries).toEqual([])
    expect(draftKeys()).toEqual([])
    expect(window.localStorage.getItem('theme')).toBe('dark')
    expect(queryClient.getQueryData([keys.me])).toEqual(user)
  })

  test('creating the first account does the same', async () => {
    seedDevice()
    const outbox = await queuedOutbox()
    mockApi({ 'POST /api/setup': () => user })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useSetup(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await result.current.mutateAsync({ email: user.email, password: 'a long password' })
    })
    expect(outbox.getState().entries).toEqual([])
    expect(draftKeys()).toEqual([])
    expect(queryClient.getQueryData([keys.me])).toEqual(user)
    expect(getOutbox()).toBe(outbox)
  })
})

describe('the one purge', () => {
  // `purgeApiCache` is the cache part of `purgeDeviceData`. A page that empties the device by
  // calling it directly would leave the drafts and the queue, and a second purge to extend.
  test('only the purge in outbox.ts uses the cache purge', () => {
    const importers: string[] = []
    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) visit(path)
        else if (
          /\.tsx?$/.test(entry.name) &&
          readFileSync(path, 'utf8').includes('purgeApiCache')
        ) {
          importers.push(path)
        }
      }
    }
    visit('web')
    expect(importers.sort()).toEqual(['web/pwa/outbox.ts', 'web/pwa/register.ts'])
  })
})

describe('a second account in the same tab', () => {
  const userA = { id: 'u-a', email: 'a@example.com', displayName: null, units: 'mi' as const }
  const userB = { id: 'u-b', email: 'b@example.com', displayName: null, units: 'mi' as const }
  const todayOf = (name: string) =>
    makeToday({
      sessions: [{ session: makeSession({ title: name }), advice: 'as-planned', reasons: [] }],
      coach: makeCoach({ hero: makeHero({ session: makeSession({ title: name }) }) }),
    })

  /** The page's data as one account leaves it in the query cache. */
  function seedCache(queryClient: QueryClient): void {
    queryClient.setQueryData([keys.me], userA)
    queryClient.setQueryData([keys.setup], { needsSetup: false })
    queryClient.setQueryData([keys.today], todayOf('Run of A'))
    queryClient.setQueryData([keys.settings], { ...userA, units: 'mi' })
    queryClient.setQueryData([keys.plan], { id: 'plan-of-a' })
  }

  test('signing in drops what the previous account left in the cache, keeping the setup state', async () => {
    const queryClient = new QueryClient()
    seedCache(queryClient)
    mockApi({ 'POST /api/auth/login': () => userB })
    const { result } = renderHook(() => useLogin(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await result.current.mutateAsync({ email: userB.email, password: 'a long password' })
    })
    expect(queryClient.getQueryData([keys.me])).toEqual(userB)
    expect(queryClient.getQueryData([keys.today])).toBeUndefined()
    expect(queryClient.getQueryData([keys.settings])).toBeUndefined()
    expect(queryClient.getQueryData([keys.plan])).toBeUndefined()
    expect(queryClient.getQueryData([keys.setup])).toEqual({ needsSetup: false })
  })

  test('creating an account drops it too', async () => {
    const queryClient = new QueryClient()
    seedCache(queryClient)
    mockApi({ 'POST /api/setup': () => userB })
    const { result } = renderHook(() => useSetup(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await result.current.mutateAsync({ email: userB.email, password: 'a long password' })
    })
    expect(queryClient.getQueryData([keys.today])).toBeUndefined()
    expect(queryClient.getQueryData([keys.me])).toEqual(userB)
  })

  test("a 401 on one account's Today, then another account's sign-in, never shows the first Today", async () => {
    // The server answers for whoever the session belongs to, and with a 401 for nobody.
    let current: typeof userA | null = userA
    const signedOut = {
      status: 401,
      body: { error: { code: 'unauthorized', message: 'Sign in.' } },
    }
    mockApi({
      'GET /api/setup': () => ({ needsSetup: false }),
      'GET /api/auth/me': () => (current === null ? signedOut : current),
      'GET /api/today': () =>
        current === null ? signedOut : todayOf(current === userA ? 'Run of A' : 'Run of B'),
      'GET /api/settings': () => ({ email: 'x@example.com', displayName: null, units: 'mi' }),
      'GET /api/goals': () => [],
      'GET /api/plan': () => null,
      'GET /api/weeks': () => [],
      'GET /api/reviews': () => [],
      'GET /api/activities': () => activityPage([]),
      'POST /api/auth/login': () => {
        current = userB
        return userB
      },
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('article', { name: 'Run of A' })).toBeVisible()

    // The session ends while the tab is open.
    current = null
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    })
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible()
    expect(queryClient.getQueryData([keys.today])).toBeUndefined()

    // Another account signs in. The page must not draw the first one's session, not even for the
    // moment before its own Today arrives.
    let leaked = false
    const watcher = new MutationObserver(() => {
      if (document.body.textContent.includes('Run of A')) leaked = true
    })
    watcher.observe(document.body, { subtree: true, childList: true, characterData: true })
    const typist = userEvent.setup()
    await typist.type(screen.getByLabelText('Email'), userB.email)
    await typist.type(screen.getByLabelText('Password'), 'a long password')
    await typist.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('article', { name: 'Run of B' })).toBeVisible()
    watcher.disconnect()
    expect(leaked).toBe(false)
  })
})
