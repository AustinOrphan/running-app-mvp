// The page's side of the offline shell (phase 3a design 7.6, ADR 0012): the note above Today, the
// Settings row, the registration of the worker, the purge of the device's copy of the server's
// answers on sign-out, a 401 and sign-in, and the one reload after an update. The worker's own
// rules are in `tests/unit/shared/sw.test.ts`.
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useLogin, useLogout, useSetup } from '../../web/api/auth.ts'
import { useSaveCheckin } from '../../web/api/checkins.ts'
import { createQueryClient, keys, UNAUTHORIZED_EVENT } from '../../web/api/client.ts'
import { useSettings } from '../../web/api/settings.ts'
import { OfflineNote } from '../../web/components/today/OfflineNote.tsx'
import { dayState, isPhoneCopy } from '../../web/components/today/phoneCopy.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import {
  DONE_DRAFT_PREFIX,
  FUEL_DRAFT_PREFIX,
  STRENGTH_DRAFT_PREFIX,
} from '../../web/pwa/drafts.ts'
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
import { makeCoach, makeHero, makeSession, makeToday } from './today-fixtures.ts'
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

  /** The note's text, which sits in the page's live region. */
  const note = () => screen.getByText(/^Offline\./)

  test("says nothing while the connection is there and the answer is the server's", () => {
    render(<OfflineNote view={saved()} units="mi" />)
    expect(screen.queryByText(/^Offline\./)).not.toBeInTheDocument()
  })

  test('its live region is on the page before the note, and the note is added to it', () => {
    const { container } = render(<OfflineNote view={saved()} units="mi" />)
    const region = container.querySelector('[aria-live="polite"]')
    expect(region).not.toBeNull()
    expect(region).toBeEmptyDOMElement()

    goOffline()
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    // The same element now holds the text, so a screen reader that knows the region announces it.
    expect(container.querySelector('[aria-live="polite"]')).toBe(region)
    expect(region).toHaveTextContent('Offline. Showing the session saved at 06:12.')
  })

  test('the region is empty again when a fresh answer replaces the copy', () => {
    const { container, rerender } = render(
      <OfflineNote view={saved({ servedFromCache: true })} units="mi" />,
    )
    const region = container.querySelector('[aria-live="polite"]')
    expect(region).toHaveTextContent('Offline. Showing the session saved at 06:12.')
    rerender(<OfflineNote view={saved()} units="mi" />)
    expect(container.querySelector('[aria-live="polite"]')).toBe(region)
    expect(region).toBeEmptyDOMElement()
  })

  test("with no connection it names the time the session was saved, in the server's zone", () => {
    goOffline()
    render(<OfflineNote view={saved()} units="mi" />)
    expect(note()).toHaveTextContent('Offline. Showing the session saved at 06:12.')
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
    expect(note()).toHaveTextContent('Offline. Showing the session saved at 06:30.')
  })

  test('a copy the worker served says the same with the browser still online', () => {
    render(<OfflineNote view={saved({ servedFromCache: true })} units="mi" />)
    expect(note()).toHaveTextContent('Offline. Showing the session saved at 06:12.')
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
    expect(note()).toHaveTextContent(
      "Offline. This session was saved on Mon 16 Mar. Today's is not loaded yet.",
    )
  })

  test("the day is the server's: 05:00 UTC on the 20th is still the 19th in Chicago", () => {
    vi.setSystemTime(new Date('2026-03-20T04:30:00.000Z'))
    goOffline()
    const { unmount } = render(<OfflineNote view={saved()} units="mi" />)
    expect(note()).toHaveTextContent('Showing the session saved at 06:12')
    unmount()
    vi.setSystemTime(new Date('2026-03-20T05:00:00.000Z'))
    render(<OfflineNote view={saved()} units="mi" />)
    expect(note()).toHaveTextContent(
      "This session was saved on Thu 19 Mar. Today's is not loaded yet.",
    )
  })

  test("a zone the browser does not know still gives a time, in the phone's own", () => {
    goOffline()
    render(<OfflineNote view={saved({ tz: 'Not/AZone' })} units="mi" />)
    expect(note().textContent).toMatch(/^Offline\. Showing the session saved at \d{2}:\d{2}\.$/)
  })

  test("a preview of today made the evening before names that evening's day, not a bare time", () => {
    // Composed Wednesday 21:50 in Chicago (02:50 UTC on the 19th) for Thursday; read on Thursday.
    goOffline()
    render(
      <OfflineNote
        view={saved({
          coach: makeCoach({ preview: true, generatedAt: '2026-03-19T02:50:00.000Z' }),
        })}
        units="mi"
      />,
    )
    expect(note()).toHaveTextContent('Offline. Showing the session saved on Wed 18 Mar at 21:50.')
  })

  test('a copy of an earlier day names the day it was saved, which a preview made a day before is not', () => {
    // Wednesday's preview was composed on Tuesday at 15:00 in Chicago, and Thursday is now.
    goOffline()
    render(
      <OfflineNote
        view={saved({
          date: '2026-03-18',
          coach: makeCoach({ preview: true, generatedAt: '2026-03-17T20:00:00.000Z' }),
        })}
        units="mi"
      />,
    )
    expect(note()).toHaveTextContent(
      "Offline. This session was saved on Tue 17 Mar. Today's is not loaded yet.",
    )
  })

  test('a zone the browser does not know cannot tell the days apart, and gives the time alone', () => {
    goOffline()
    render(
      <OfflineNote
        view={saved({
          tz: 'Not/AZone',
          coach: makeCoach({ preview: true, generatedAt: '2026-03-19T02:50:00.000Z' }),
        })}
        units="mi"
      />,
    )
    expect(note().textContent).toMatch(/^Offline\. Showing the session saved at \d{2}:\d{2}\.$/)
  })

  test('on the Today page the note sits under the session, so it cannot move Done', async () => {
    startToday()
    vi.setSystemTime(NOW)
    goOffline()
    const hero = makeHero({ session: makeSession({ date: '2026-03-19' }) })
    renderToday(
      saved({
        sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
        coach: makeCoach({ hero, generatedAt: '2026-03-19T11:12:00.000Z' }),
      }),
    )
    const note = await screen.findByText('Offline. Showing the session saved at 06:12.')
    const card = screen.getByRole('article', { name: 'Easy run' })
    const readiness = screen.getByRole('region', { name: 'Readiness' })
    const follows = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows(readiness, card)).toBe(true)
    expect(follows(card, note)).toBe(true)
  })

  test('on the Today page a fresh answer carries no note', async () => {
    startToday()
    vi.setSystemTime(NOW)
    renderToday(saved())
    await screen.findByRole('region', { name: 'Readiness' })
    expect(screen.queryByText(/^Offline\./)).not.toBeInTheDocument()
  })
})

// ---- Which day the phone's copy is for -------------------------------------------------------

describe('which day a payload is for', () => {
  /** Thursday 2026-03-19 in Chicago at NOW. */
  const view = (date: string, over: Parameters<typeof makeToday>[0] = {}, preview = false) =>
    makeToday({ date, tz: 'America/Chicago', coach: makeCoach({ preview }), ...over })

  test('the phone shows its own copy when the browser has no connection or the worker answered', () => {
    expect(isPhoneCopy(true, view('2026-03-19'))).toBe(false)
    expect(isPhoneCopy(false, view('2026-03-19'))).toBe(true)
    expect(isPhoneCopy(true, view('2026-03-19', { servedFromCache: true }))).toBe(true)
    expect(isPhoneCopy(false, undefined)).toBe(true)
    expect(isPhoneCopy(true, undefined)).toBe(false)
  })

  test('a live answer takes the server at its word, whatever the phone clock says', () => {
    expect(dayState(view('2026-03-10'), false, NOW)).toBe('today')
    expect(dayState(view('2026-03-19', {}, true), false, NOW)).toBe('ahead')
  })

  test("a copy is read against the server's today by the phone's clock", () => {
    expect(dayState(view('2026-03-18'), true, NOW)).toBe('past')
    expect(dayState(view('2026-03-19'), true, NOW)).toBe('today')
    expect(dayState(view('2026-03-20', {}, true), true, NOW)).toBe('ahead')
  })

  test('a preview of the day that has arrived is that day, and one of a day gone is over', () => {
    expect(dayState(view('2026-03-19', {}, true), true, NOW)).toBe('today')
    expect(dayState(view('2026-03-18', {}, true), true, NOW)).toBe('past')
  })

  test("a plain copy dated after the phone's day (a clock running behind) is still its day", () => {
    expect(dayState(view('2026-03-20'), true, NOW)).toBe('today')
  })

  test("the server's day turns at the server's midnight: 05:00 UTC is midnight in Chicago", () => {
    const before = new Date('2026-03-20T04:59:00.000Z')
    const after = new Date('2026-03-20T05:00:00.000Z')
    expect(dayState(view('2026-03-19'), true, before)).toBe('today')
    expect(dayState(view('2026-03-19'), true, after)).toBe('past')
  })

  test("a zone the browser does not know cannot place the day, so the server's flag stands", () => {
    expect(dayState(view('2026-03-10', { tz: 'Not/AZone' }), true, NOW)).toBe('today')
    expect(dayState(view('2026-03-10', { tz: 'Not/AZone' }, true), true, NOW)).toBe('ahead')
  })
})

describe("Today on the phone's copy", () => {
  /** The session of the viewed day, as the hero. */
  function dayOf(date: string, over: Parameters<typeof makeToday>[0] = {}) {
    const hero = makeHero({ session: makeSession({ date }) })
    return makeToday({
      date,
      tz: 'America/Chicago',
      sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
      coach: makeCoach({ hero, generatedAt: `${date}T11:12:00.000Z` }),
      ...over,
    })
  }
  /** A preview as the server composes one: no verdict, no signals. */
  const preview = (date: string, generatedAt: string, fromPhone = true) =>
    dayOf(date, {
      ...(fromPhone ? { servedFromCache: true as const } : {}),
      coach: makeCoach({
        hero: makeHero({ session: makeSession({ date }) }),
        preview: true,
        verdict: null,
        signals: [],
        generatedAt,
      }),
    })

  const checkinQuestion = () => screen.queryByRole('radiogroup', { name: 'How do you feel today?' })

  beforeEach(() => {
    startToday()
    vi.setSystemTime(NOW)
  })

  test("yesterday evening's preview, opened on the day it is for, offers the check-in", async () => {
    renderToday(preview('2026-03-19', '2026-03-19T02:50:00.000Z'))
    expect(await screen.findByRole('radiogroup', { name: 'How do you feel today?' })).toBeVisible()
    expect(
      screen.getByText('Offline. Showing the session saved on Wed 18 Mar at 21:50.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Done' })).toBeVisible()
  })

  test('a preview of a day that has not come yet has no check-in, from the phone as from the server', async () => {
    renderToday(preview('2026-03-20', '2026-03-19T02:50:00.000Z'))
    await screen.findByRole('article', { name: 'Easy run' })
    expect(checkinQuestion()).not.toBeInTheDocument()
  })

  test("a live preview is the server's word: no check-in, whatever the phone's clock says", async () => {
    // A phone whose clock runs a day ahead of the server's still gets no check-in for tomorrow.
    renderToday(preview('2026-03-19', '2026-03-19T02:50:00.000Z', false))
    await screen.findByRole('article', { name: 'Easy run' })
    expect(checkinQuestion()).not.toBeInTheDocument()
  })

  test('a copy of a day that is over is read-only: no check-in, no Done, no Not today', async () => {
    goOffline()
    renderToday(dayOf('2026-03-16'))
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(
      screen.getByText("Offline. This session was saved on Mon 16 Mar. Today's is not loaded yet."),
    ).toBeVisible()
    expect(checkinQuestion()).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Check-in' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Not today' })).not.toBeInTheDocument()
    // The rule and the papers behind the session are still there to read.
    expect(within(card).getByRole('button', { name: 'Explain' })).toBeVisible()
  })

  test('the same holds for a copy the worker served with the browser online', async () => {
    renderToday(dayOf('2026-03-16', { servedFromCache: true }))
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(checkinQuestion()).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
  })

  test("a live answer is not judged by the phone's clock: its check-in and Done stay", async () => {
    renderToday(dayOf('2026-03-16'))
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(await screen.findByRole('radiogroup', { name: 'How do you feel today?' })).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Done' })).toBeVisible()
    expect(screen.queryByText(/^Offline\./)).not.toBeInTheDocument()
  })

  test("today's own copy keeps its check-in and Done", async () => {
    goOffline()
    renderToday(dayOf('2026-03-19'))
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(await screen.findByRole('radiogroup', { name: 'How do you feel today?' })).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Done' })).toBeVisible()
    expect(screen.getByText('Offline. Showing the session saved at 06:12.')).toBeVisible()
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

  /** A page the browser treats as secure (https or localhost), or not. */
  function setSecureContext(secure: boolean): void {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: secure })
  }

  afterEach(() => {
    Reflect.deleteProperty(window, 'isSecureContext')
  })

  test('says a development build is not a production build, whatever the page or the browser', async () => {
    installContainer()
    registerServiceWorker({ production: false })
    renderSettings()
    expect(
      await screen.findByText('Offline use: not available (this is not a production build).'),
    ).toBeVisible()
    expect(screen.queryByText(/needs https/)).not.toBeInTheDocument()
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

  test('asks for https on a page that is not secure (http on a network address)', async () => {
    setSecureContext(false)
    registerServiceWorker({ production: true })
    renderSettings()
    expect(await screen.findByText('Offline use: not available (needs https).')).toBeVisible()
  })

  test('blames the browser, not https, when a secure page has no service workers', async () => {
    setSecureContext(true)
    registerServiceWorker({ production: true })
    renderSettings()
    expect(
      await screen.findByText('Offline use: not available (this browser does not support it).'),
    ).toBeVisible()
    expect(screen.queryByText(/needs https/)).not.toBeInTheDocument()
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

  test('says the browser did not allow it when it refuses the worker, on a secure page', async () => {
    setSecureContext(true)
    installContainer(() => Promise.reject(new Error('blocked')))
    registerServiceWorker({ production: true })
    renderSettings()
    expect(
      await screen.findByText('Offline use: not available (the browser did not allow it).'),
    ).toBeVisible()
    expect(screen.queryByText(/needs https/)).not.toBeInTheDocument()
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

  test('a new session also starts without the unsent drafts and the queue of the one that ended', async () => {
    stubCaches()
    mockApi({ 'POST /api/auth/login': () => user, 'POST /api/setup': () => user })
    const draftKeys = [
      `${DONE_DRAFT_PREFIX}u-a_2026-03-19`,
      `${FUEL_DRAFT_PREFIX}run9`,
      `${STRENGTH_DRAFT_PREFIX}3f2b7c1e-8d4a-4f6b-9a31-5c0e2d7b6a10`,
    ]
    const seed = async () => {
      for (const key of draftKeys) window.localStorage.setItem(key, '{"notes":"left"}')
      window.localStorage.setItem('theme', 'dark')
      return queuedOutbox()
    }
    const queryClient = new QueryClient()

    let outbox = await seed()
    const login = renderHook(() => useLogin(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await login.result.current.mutateAsync({ email: user.email, password: 'a long password' })
    })
    expect(draftKeys.map((key) => window.localStorage.getItem(key))).toEqual([null, null, null])
    expect(outbox.getState().entries).toEqual([])
    expect(window.localStorage.getItem('theme')).toBe('dark')

    outbox = await seed()
    const setup = renderHook(() => useSetup(), { wrapper: withClient(queryClient) })
    await act(async () => {
      await setup.result.current.mutateAsync({ email: user.email, password: 'a long password' })
    })
    expect(draftKeys.map((key) => window.localStorage.getItem(key))).toEqual([null, null, null])
    expect(outbox.getState().entries).toEqual([])
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
