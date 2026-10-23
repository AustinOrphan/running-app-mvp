// The page's side of the offline shell (phase 3a design 7.6, ADR 0012): the note above Today, the
// Settings row, the registration of the worker, the purge of the device's copy of the server's
// answers on sign-out, a 401 and sign-in, and the one reload after an update. The worker's own
// rules are in `tests/unit/shared/sw.test.ts`.
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useLogin, useLogout, useSetup } from '../../web/api/auth.ts'
import { useSaveCheckin } from '../../web/api/checkins.ts'
import { createQueryClient, keys, UNAUTHORIZED_EVENT } from '../../web/api/client.ts'
import { useSettings } from '../../web/api/settings.ts'
import { OfflineNote } from '../../web/components/today/OfflineNote.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { DONE_DRAFT_PREFIX } from '../../web/pwa/drafts.ts'
import {
  createOutbox,
  memoryStore,
  OUTBOX_ROUTES,
  purgeDeviceData,
  resetOutboxForTests,
  useOutboxReplay,
} from '../../web/pwa/outbox.ts'
import {
  API_CACHE_NAME,
  META_CACHE_NAME,
  purgeApiCache,
  registerServiceWorker,
  reloadOnPreloadError,
  resetOfflineStatusForTests,
} from '../../web/pwa/register.ts'
import { SettingsPage } from '../../web/pages/SettingsPage.tsx'
import { makeCoach, makeToday } from './today-fixtures.ts'
import { mockApi, renderWithProviders } from './helpers.tsx'
import { renderToday, startToday } from './today-render.tsx'

/** Thursday 2026-03-19 12:00 UTC; 07:00 in Chicago (CDT), 21:00 in Tokyo. */
const NOW = new Date('2026-03-19T12:00:00.000Z')

function goOffline(): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  window.localStorage.clear()
  window.sessionStorage.clear()
  resetOfflineStatusForTests()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

// ---- OfflineNote -----------------------------------------------------------------------------

describe('OfflineNote', () => {
  /** Today's payload for 2026-03-19 in Chicago, composed at 06:12 there. */
  const saved = (over: Parameters<typeof makeToday>[0] = {}) =>
    makeToday({
      date: '2026-03-19',
      tz: 'America/Chicago',
      coach: makeCoach({ generatedAt: '2026-03-19T11:12:00.000Z' }),
      ...over,
    })

  test("says nothing while the connection is there and the answer is the server's", () => {
    render(<OfflineNote view={saved()} units="mi" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test("with no connection it names the time the session was saved, in the server's zone", () => {
    goOffline()
    render(<OfflineNote view={saved()} units="mi" />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline. Showing the session saved at 06:12.',
    )
  })

  test("the zone is the server's, not the phone's", () => {
    goOffline()
    render(
      <OfflineNote
        view={saved({
          date: '2026-03-19',
          tz: 'Asia/Tokyo',
          coach: makeCoach({ generatedAt: '2026-03-18T21:30:00.000Z' }),
        })}
        units="mi"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline. Showing the session saved at 06:30.',
    )
  })

  test('a copy the worker served says the same with the browser still online', () => {
    render(<OfflineNote view={saved({ servedFromCache: true })} units="mi" />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline. Showing the session saved at 06:12.',
    )
  })

  test("a copy of an earlier day names that day and says today's is not loaded", () => {
    goOffline()
    render(
      <OfflineNote
        view={saved({
          date: '2026-03-16',
          coach: makeCoach({ generatedAt: '2026-03-16T11:12:00.000Z' }),
        })}
        units="mi"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      "Offline. This session was saved on Mon 16 Mar. Today's is not loaded yet.",
    )
  })

  test("the day is the server's: 05:00 UTC on the 20th is still the 19th in Chicago", () => {
    vi.setSystemTime(new Date('2026-03-20T04:30:00.000Z'))
    goOffline()
    render(<OfflineNote view={saved()} units="mi" />)
    expect(screen.getByRole('status')).toHaveTextContent('Showing the session saved at 06:12')
    vi.setSystemTime(new Date('2026-03-20T05:00:00.000Z'))
    render(<OfflineNote view={saved()} units="mi" />)
    expect(screen.getAllByRole('status')[1]).toHaveTextContent(
      "This session was saved on Thu 19 Mar. Today's is not loaded yet.",
    )
  })

  test("a zone the browser does not know still gives a time, in the phone's own", () => {
    goOffline()
    render(<OfflineNote view={saved({ tz: 'Not/AZone' })} units="mi" />)
    expect(screen.getByRole('status').textContent).toMatch(
      /^Offline\. Showing the session saved at \d{2}:\d{2}\.$/,
    )
  })

  test('on the Today page the note comes first, above the readiness read', async () => {
    startToday()
    vi.setSystemTime(NOW)
    goOffline()
    renderToday(saved())
    const note = await screen.findByText('Offline. Showing the session saved at 06:12.')
    const readiness = screen.getByRole('region', { name: 'Readiness' })
    expect(note.compareDocumentPosition(readiness) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('on the Today page a fresh answer carries no note', async () => {
    startToday()
    vi.setSystemTime(NOW)
    renderToday(saved())
    await screen.findByRole('region', { name: 'Readiness' })
    expect(screen.queryByText(/^Offline\./)).not.toBeInTheDocument()
  })
})

// ---- The Settings row ------------------------------------------------------------------------

describe('the Settings row', () => {
  const settingsRoutes = {
    'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'mi' }),
  }
  function renderSettings() {
    mockApi(settingsRoutes)
    return renderWithProviders(
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>,
    )
  }

  /** A browser with a service worker: `register` settles at once, `ready` when the test says. */
  function installContainer(register?: () => Promise<unknown>) {
    const posted: unknown[] = []
    const registration = {
      update: vi.fn(() => Promise.resolve()),
      active: { postMessage: (message: unknown) => posted.push(message) },
    }
    let becomeReady: () => void = () => {}
    const ready = new Promise<typeof registration>((resolve) => {
      becomeReady = () => {
        resolve(registration)
      }
    })
    const container = {
      register: vi.fn(register ?? (() => Promise.resolve(registration))),
      ready,
    }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
    return { container, registration, posted, becomeReady }
  }

  test('reads "not available (needs https)" in a build that does not register a worker', async () => {
    registerServiceWorker({ production: false })
    renderSettings()
    expect(await screen.findByText('Offline use: not available (needs https).')).toBeVisible()
  })

  test('registers nothing outside a production build, even in a browser that could', async () => {
    const { container } = installContainer()
    registerServiceWorker({ production: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.register).not.toHaveBeenCalled()
  })

  test('the test build is not a production build, so the default registers nothing either', async () => {
    const { container } = installContainer()
    registerServiceWorker()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(import.meta.env.PROD).toBe(false)
    expect(container.register).not.toHaveBeenCalled()
  })

  test('reads the same on a page the browser gives no worker (http on a network address)', async () => {
    registerServiceWorker({ production: true })
    renderSettings()
    expect(await screen.findByText('Offline use: not available (needs https).')).toBeVisible()
  })

  test('reads "installing" until the worker is active, then "ready", and warms the cache once', async () => {
    const { container, posted, becomeReady } = installContainer()
    registerServiceWorker({ production: true })
    renderSettings()
    expect(await screen.findByText('Offline use: installing.')).toBeVisible()
    await waitFor(() => {
      expect(container.register).toHaveBeenCalledWith('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
    })
    expect(posted).toEqual([])

    await act(async () => {
      becomeReady()
      await Promise.resolve()
    })
    expect(await screen.findByText('Offline use: ready.')).toBeVisible()
    expect(posted).toEqual([{ type: 'rl:warm' }])
  })

  test('reads "not available" when the browser refuses the worker', async () => {
    installContainer(() => Promise.reject(new Error('blocked')))
    registerServiceWorker({ production: true })
    renderSettings()
    expect(await screen.findByText('Offline use: not available (needs https).')).toBeVisible()
  })

  test('asks the browser to look for a new worker when the app comes back to the foreground', async () => {
    const { registration, becomeReady } = installContainer()
    registerServiceWorker({ production: true })
    await act(async () => {
      becomeReady()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(registration.update).not.toHaveBeenCalled()
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => {
      expect(registration.update).toHaveBeenCalledTimes(1)
    })
  })
})

// ---- The device's copy of the server's answers -----------------------------------------------

describe("emptying the copy of the server's answers", () => {
  const user = { id: 'u-b', email: 'b@example.com', displayName: null, units: 'km' }

  function stubCaches(remove: (name: string) => Promise<boolean> = () => Promise.resolve(true)) {
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      delete: (name: string) => {
        deleted.push(name)
        return remove(name)
      },
    })
    return deleted
  }
  const withClient =
    (queryClient: QueryClient) =>
    ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

  async function queuedOutbox() {
    const outbox = createOutbox({
      store: memoryStore(),
      routes: OUTBOX_ROUTES,
      send: () => Promise.resolve({ kind: 'retry' }),
      now: () => NOW.getTime(),
      isOnline: () => false,
    })
    await outbox.save('/api/checkins/2026-03-19', { fatigue: 4 })
    resetOutboxForTests(outbox)
    return outbox
  }

  test('the two caches are named as the worker names them', () => {
    expect(API_CACHE_NAME).toBe('rl-api-v1')
    expect(META_CACHE_NAME).toBe('rl-meta')
  })

  test("purgeApiCache deletes rl-api-v1 and the worker's stamp", async () => {
    const deleted = stubCaches()
    await purgeApiCache()
    expect(deleted).toEqual(['rl-api-v1', 'rl-meta'])
  })

  test('purgeApiCache does nothing where there is no Cache Storage, and survives one that fails', async () => {
    await expect(purgeApiCache()).resolves.toBeUndefined()
    stubCaches(() => Promise.reject(new Error('storage is blocked')))
    await expect(purgeApiCache()).resolves.toBeUndefined()
  })

  test('purgeDeviceData empties the cache with the drafts and the queue', async () => {
    const deleted = stubCaches()
    window.localStorage.setItem(`${DONE_DRAFT_PREFIX}2026-03-19`, '{"duration":"52"}')
    const outbox = await queuedOutbox()
    await purgeDeviceData()
    expect(deleted).toEqual(['rl-api-v1', 'rl-meta'])
    expect(outbox.getState().entries).toEqual([])
    expect(window.localStorage.getItem(`${DONE_DRAFT_PREFIX}2026-03-19`)).toBeNull()
  })

  test('signing out empties the cache and the queue', async () => {
    const deleted = stubCaches()
    const outbox = await queuedOutbox()
    mockApi({ 'POST /api/auth/logout': () => undefined })
    const queryClient = new QueryClient()
    queryClient.setQueryData([keys.me], { id: 'u-a' })
    const { result } = renderHook(() => useLogout(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await result.current.mutateAsync()
    })
    expect(deleted).toEqual(['rl-api-v1', 'rl-meta'])
    expect(outbox.getState().entries).toEqual([])
  })

  test('a 401 while the app is open empties the cache too', async () => {
    const deleted = stubCaches()
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
      expect(deleted).toEqual(['rl-api-v1', 'rl-meta'])
    })
    await waitFor(() => {
      expect(outbox.getState().entries).toEqual([])
    })
  })

  test('a new session starts with an empty copy: signing in and creating the first account', async () => {
    const deleted = stubCaches()
    mockApi({ 'POST /api/auth/login': () => user, 'POST /api/setup': () => user })
    const queryClient = new QueryClient()
    const login = renderHook(() => useLogin(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await login.result.current.mutateAsync({ email: user.email, password: 'a long password' })
    })
    expect(deleted).toEqual(['rl-api-v1', 'rl-meta'])
    const setup = renderHook(() => useSetup(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await setup.result.current.mutateAsync({ email: user.email, password: 'a long password' })
    })
    expect(deleted).toEqual(['rl-api-v1', 'rl-meta', 'rl-api-v1', 'rl-meta'])
  })
})

// ---- One reload after an update ---------------------------------------------------------------

describe('a file replaced by an update', () => {
  function preloadError(): Event {
    const event = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(event)
    return event
  }

  test('reloads the page once, and the error is handled', () => {
    const reload = vi.fn()
    const stop = reloadOnPreloadError(reload)
    try {
      expect(preloadError().defaultPrevented).toBe(true)
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  })

  test('does not reload again at once: the second error is left to show', () => {
    const reload = vi.fn()
    const stop = reloadOnPreloadError(reload)
    try {
      preloadError()
      vi.setSystemTime(new Date(NOW.getTime() + 59_000))
      expect(preloadError().defaultPrevented).toBe(false)
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  })

  test('reloads again for a later update in the same tab', () => {
    const reload = vi.fn()
    const stop = reloadOnPreloadError(reload)
    try {
      preloadError()
      vi.setSystemTime(new Date(NOW.getTime() + 61_000))
      expect(preloadError().defaultPrevented).toBe(true)
      expect(reload).toHaveBeenCalledTimes(2)
    } finally {
      stop()
    }
  })

  test('does not reload when the tab cannot keep the record (a loop would follow)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked.', 'SecurityError')
    })
    const reload = vi.fn()
    const stop = reloadOnPreloadError(reload)
    try {
      expect(preloadError().defaultPrevented).toBe(false)
      expect(reload).not.toHaveBeenCalled()
    } finally {
      stop()
    }
  })

  test('stops listening when told to', () => {
    const reload = vi.fn()
    reloadOnPreloadError(reload)()
    preloadError()
    expect(reload).not.toHaveBeenCalled()
  })
})

// ---- A browser that says it is offline --------------------------------------------------------

describe("the app's query client when the browser says it is offline", () => {
  const withClient =
    (queryClient: QueryClient) =>
    ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)

  afterEach(() => {
    onlineManager.setOnline(true)
  })

  test('a check-in tapped after the connection went reaches the outbox and is kept on the phone', async () => {
    onlineManager.setOnline(false)
    const outbox = createOutbox({
      store: memoryStore(),
      routes: OUTBOX_ROUTES,
      send: () => Promise.resolve({ kind: 'retry' }),
      now: () => NOW.getTime(),
      isOnline: () => false,
    })
    resetOutboxForTests(outbox)
    const { result } = renderHook(() => useSaveCheckin(), {
      wrapper: withClient(createQueryClient()),
    })
    let saved: unknown
    await act(async () => {
      saved = await result.current.mutateAsync({ date: '2026-03-19', input: { fatigue: 4 } })
    })
    expect(saved).toEqual({ status: 'queued' })
    expect(outbox.getState().entries.map((entry) => entry.url)).toEqual([
      '/api/checkins/2026-03-19',
    ])
  })

  test("a read is made anyway, so the service worker can answer it from the phone's copy", async () => {
    onlineManager.setOnline(false)
    const { calls } = mockApi({
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'mi' }),
    })
    const { result } = renderHook(() => useSettings(), { wrapper: withClient(createQueryClient()) })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(calls).toHaveLength(1)
  })
})

describe('the entry module', () => {
  // `main.tsx` mounts the app as it is imported, so it is read, not run: it must wire both.
  const main = readFileSync('web/main.tsx', 'utf8')

  test('listens for a replaced file before the app mounts, and registers the worker after', () => {
    expect(main).toContain(
      "import { registerServiceWorker, reloadOnPreloadError } from './pwa/register.ts'",
    )
    expect(main.indexOf('reloadOnPreloadError()')).toBeGreaterThan(-1)
    expect(main.indexOf('reloadOnPreloadError()')).toBeLessThan(main.indexOf('createRoot('))
    expect(main.indexOf('registerServiceWorker()')).toBeGreaterThan(main.indexOf('createRoot('))
  })
})
