import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { IntegrationStatus, ProviderInfo, SyncRunView } from '../../shared/types.ts'
import {
  expectCleanCopy,
  makeTestQueryClient,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { DashboardPage } from '../../web/pages/DashboardPage.tsx'
import { makeCoach, makeToday } from './today-fixtures.ts'
import { renderToday, settingsOf, startToday } from './today-render.tsx'

// The "Check for new runs" control of Today's header (build list item 1): the same sync route as
// the Integrations page, one pull when Today opens with a stale one, and a toast naming what came.

// The fixed clock of Today tests: Wednesday 2026-03-18, noon local time.
const NOW = new Date(2026, 2, 18, 12, 0, 0).getTime()
const minutesAgo = (min: number) => new Date(NOW - min * 60_000).toISOString()

function info(key: string, label: string, channels: ProviderInfo['channels']): ProviderInfo {
  return { key, label, experimental: false, channels, wellness: false, docsUrl: '' }
}

function service(
  key: string,
  label: string,
  over: Partial<IntegrationStatus> = {},
  channels: ProviderInfo['channels'] = ['pull'],
): IntegrationStatus {
  return {
    provider: key,
    info: info(key, label, channels),
    status: 'connected',
    config: {},
    pushEnabled: false,
    lastSyncAt: minutesAgo(5),
    lastSyncStatus: 'ok',
    lastError: null,
    pausedUntil: null,
    ...over,
  }
}

function run(startedAt: string, accepted: number): SyncRunView {
  return {
    id: `run-${startedAt}`,
    provider: 'intervals',
    channel: 'pull',
    trigger: 'manual',
    startedAt,
    finishedAt: startedAt,
    status: 'ok',
    accepted,
    duplicate: 0,
    failed: 0,
    wellnessStatus: 'none',
    wellnessDays: null,
    wellnessTotal: null,
    message: null,
    failures: [],
    importBatchId: null,
  }
}

/**
 * A fake services list. `answered` flips the services to the `after` timestamp, as the server does
 * when a run ends; until then the list shows the `before` one.
 */
function fakeServices(services: IntegrationStatus[], before: string | null, after: string) {
  const state = { answered: false, syncs: [] as string[] }
  const routes: MockRoutes = {
    'GET /api/integrations': () =>
      services.map((item) => ({
        ...item,
        lastSyncAt: state.answered ? after : before,
      })),
  }
  for (const item of services) {
    routes[`POST /api/integrations/${item.provider}/sync`] = () => {
      state.syncs.push(item.provider)
      state.answered = true
      return item
    }
  }
  return { state, routes }
}

beforeEach(startToday)

afterEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true })
})

describe('Today: check for new runs', () => {
  test('shows no control while no pull service is connected', async () => {
    renderToday(makeToday({ coach: makeCoach() }), {
      'GET /api/integrations': () => [
        service('folder', 'Folder', {}, ['folder']),
        service('strava', 'Strava', { status: 'disconnected' }),
      ],
    })
    await screen.findByRole('link', { name: 'Log activity' })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Check for new runs' })).not.toBeInTheDocument()
    })
  })

  test('a click asks each connected pull service once, then names what arrived', async () => {
    const user = userEvent.setup()
    const services = [
      service('intervals', 'Intervals.icu'),
      service('strava', 'Strava'),
      service('garmin', 'Garmin', { status: 'needs_auth' }),
    ]
    const after = minutesAgo(0)
    const { state, routes } = fakeServices(services, minutesAgo(5), after)
    const { api } = renderToday(makeToday({ coach: makeCoach() }), {
      ...routes,
      'GET /api/integrations/intervals/runs': () => [run(after, 1)],
      'GET /api/integrations/strava/runs': () => [run(after, 2)],
    })
    const button = await screen.findByRole('button', { name: 'Check for new runs' })
    await user.click(button)
    expect(
      await screen.findByText('3 new runs added from Intervals.icu and Strava'),
    ).toBeInTheDocument()
    expect(state.syncs.sort()).toEqual(['intervals', 'strava'])
    // One announcement for the whole check, however many services answered.
    expect(screen.getAllByText(/new runs? added/)).toHaveLength(1)
    // The button is usable again and kept focus throughout.
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-busy', 'true')
    })
    expect(button).toHaveFocus()
    // Today is read again so the new run shows.
    await waitFor(() => {
      expect(api.calls.filter((call) => call.url === '/api/today').length).toBeGreaterThan(1)
    })
  })

  test('says it is busy while the run is going, and keeps focus', async () => {
    const user = userEvent.setup()
    const { state, routes } = fakeServices(
      [service('intervals', 'Intervals.icu')],
      minutesAgo(5),
      minutesAgo(0),
    )
    // The server accepts the request, but the run has not ended.
    routes['POST /api/integrations/intervals/sync'] = () => {
      state.syncs.push('intervals')
      return service('intervals', 'Intervals.icu')
    }
    routes['GET /api/integrations/intervals/runs'] = () => [run(minutesAgo(0), 1)]
    renderToday(makeToday({ coach: makeCoach() }), routes)
    const button = await screen.findByRole('button', { name: 'Check for new runs' })
    await user.click(button)
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-busy', 'true')
    })
    expect(screen.getByText('Checking for new runs.')).toBeInTheDocument()
    expect(button).toHaveFocus()
    // A second tap while it runs asks for nothing more.
    await user.click(button)
    expect(state.syncs).toEqual(['intervals'])
    // The run ends: the service shows a newer pull (the poll of the services list picks it up).
    state.answered = true
    expect(
      await screen.findByText('One new run added from Intervals.icu', {}, { timeout: 6000 }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(button).not.toHaveAttribute('aria-busy', 'true')
    })
  })

  test('announces once when the services list shows the finished pull before the request is answered', async () => {
    const user = userEvent.setup()
    const after = minutesAgo(0)
    const { routes } = fakeServices([service('intervals', 'Intervals.icu')], minutesAgo(5), after)
    const queryClient = makeTestQueryClient()
    mockApi({
      'GET /api/today': () => makeToday({ coach: makeCoach() }),
      'GET /api/settings': () => settingsOf(),
      ...routes,
      'GET /api/integrations/intervals/runs': () => [run(after, 1)],
    })
    renderWithProviders(
      <ToastProvider>
        <DashboardPage />
      </ToastProvider>,
      { queryClient },
    )
    const button = await screen.findByRole('button', { name: 'Check for new runs' })
    // Hold the sync answer back, as a slow connection does, while the server has already run it.
    const answer = globalThis.fetch
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await answer(input, init)
      if (init?.method === 'POST' && (typeof input === 'string' ? input : '').includes('/sync'))
        await gate
      return response
    })
    await user.click(button)
    // The list is read again meanwhile and shows the new pull.
    await queryClient.invalidateQueries({ queryKey: ['integrations'] })
    await new Promise((resolve) => setTimeout(resolve, 50))
    release()
    expect(await screen.findByText('One new run added from Intervals.icu')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(screen.getAllByText('One new run added from Intervals.icu')).toHaveLength(1)
  })

  test('a sync request that never settles ends as slow after 90 seconds, and a later press works', async () => {
    const { state, routes } = fakeServices(
      [service('intervals', 'Intervals.icu')],
      minutesAgo(5),
      minutesAgo(0),
    )
    renderToday(makeToday({ coach: makeCoach() }), {
      ...routes,
      'GET /api/integrations/intervals/runs': () => [],
    })
    const button = await screen.findByRole('button', { name: 'Check for new runs' })
    const answer = globalThis.fetch
    let hold = true
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await answer(input, init)
      if (
        hold &&
        init?.method === 'POST' &&
        (typeof input === 'string' ? input : '').includes('/sync')
      ) {
        await new Promise(() => {})
      }
      return response
    })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    fireEvent.click(button)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(button).toHaveAttribute('aria-busy', 'true')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Intervals.icu has not answered yet. Its runs show once it does.',
    )
    expect(button).not.toHaveAttribute('aria-busy', 'true')
    // The control is not stuck: a later press asks again.
    hold = false
    fireEvent.click(button)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(state.syncs).toEqual(['intervals', 'intervals'])
    vi.useRealTimers()
  })

  describe('after 90 seconds with a request that never settles', () => {
    /** Holds back the sync answer of the named services for ever; the rest answer as usual. */
    function hang(...providers: string[]) {
      const answer = globalThis.fetch
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await answer(input, init)
        const url = typeof input === 'string' ? input : ''
        if (init?.method === 'POST' && providers.some((p) => url.endsWith(`/${p}/sync`))) {
          await new Promise(() => {})
        }
        return response
      })
    }

    async function pressAndWait(button: HTMLElement) {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
      vi.setSystemTime(NOW)
      fireEvent.click(button)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000)
      })
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    test('one refused source keeps its own reason, and only the hung one reads as slow', async () => {
      const { routes } = fakeServices(
        [service('intervals', 'Intervals.icu'), service('strava', 'Strava')],
        minutesAgo(5),
        minutesAgo(0),
      )
      renderToday(makeToday({ coach: makeCoach() }), {
        ...routes,
        'POST /api/integrations/intervals/sync': () => ({
          status: 409,
          body: { error: { code: 'conflict', message: 'Reconnect Intervals.icu first.' } },
        }),
        'GET /api/integrations/strava/runs': () => [],
      })
      const button = await screen.findByRole('button', { name: 'Check for new runs' })
      hang('strava')
      await pressAndWait(button)
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(
        'Could not check Intervals.icu. Reconnect Intervals.icu first. Try again.',
      )
      expect(alert).toHaveTextContent('Strava has not answered yet. Its runs show once it does.')
      expect(alert).not.toHaveTextContent('Intervals.icu and Strava')
      expect(button).not.toHaveAttribute('aria-busy', 'true')
    })

    test('two hung sources are named together, in the plural', async () => {
      const { routes } = fakeServices(
        [service('intervals', 'Intervals.icu'), service('strava', 'Strava')],
        minutesAgo(5),
        minutesAgo(0),
      )
      // The list never shows a newer pull for either, so both stay unanswered.
      renderToday(makeToday({ coach: makeCoach() }), {
        ...routes,
        'GET /api/integrations': () => [
          service('intervals', 'Intervals.icu', { lastSyncAt: minutesAgo(5) }),
          service('strava', 'Strava', { lastSyncAt: minutesAgo(5) }),
        ],
      })
      const button = await screen.findByRole('button', { name: 'Check for new runs' })
      hang('intervals', 'strava')
      await pressAndWait(button)
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Intervals.icu and Strava have not answered yet. Their runs show once they do.',
      )
      expect(button).not.toHaveAttribute('aria-busy', 'true')
    })
  })

  test('says so when nothing new came', async () => {
    const user = userEvent.setup()
    const after = minutesAgo(0)
    const { routes } = fakeServices([service('intervals', 'Intervals.icu')], minutesAgo(5), after)
    renderToday(makeToday({ coach: makeCoach() }), {
      ...routes,
      'GET /api/integrations/intervals/runs': () => [run(after, 0)],
    })
    await user.click(await screen.findByRole('button', { name: 'Check for new runs' }))
    expect(await screen.findByText('No new runs')).toBeInTheDocument()
  })

  test('a service that refuses is named in a line under the header, and the button comes back', async () => {
    const user = userEvent.setup()
    const { container } = renderToday(makeToday({ coach: makeCoach() }), {
      'GET /api/integrations': () => [service('intervals', 'Intervals.icu')],
      'POST /api/integrations/intervals/sync': () => ({
        status: 409,
        body: { error: { code: 'conflict', message: 'Reconnect Intervals.icu first.' } },
      }),
    })
    const button = await screen.findByRole('button', { name: 'Check for new runs' })
    await user.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not check Intervals.icu. Reconnect Intervals.icu first. Try again.',
    )
    expect(button).not.toHaveAttribute('aria-busy', 'true')
    expect(button).toBeEnabled()
    expectCleanCopy(container)
  })

  test('a service whose last pull failed is still asked, and the control stays', async () => {
    const user = userEvent.setup()
    const after = minutesAgo(0)
    const { state, routes } = fakeServices(
      [service('intervals', 'Intervals.icu', { status: 'error', lastError: 'It answered 500.' })],
      minutesAgo(5),
      after,
    )
    renderToday(makeToday({ coach: makeCoach() }), {
      ...routes,
      'GET /api/integrations/intervals/runs': () => [run(after, 1)],
    })
    await user.click(await screen.findByRole('button', { name: 'Check for new runs' }))
    expect(await screen.findByText('One new run added from Intervals.icu')).toBeInTheDocument()
    expect(state.syncs).toEqual(['intervals'])
  })

  test('a service inside its rate-limit pause is not asked, and the control goes away', async () => {
    const paused = service('intervals', 'Intervals.icu', {
      pausedUntil: new Date(NOW + 30 * 60_000).toISOString(),
      lastSyncStatus: 'paused',
    })
    renderToday(makeToday({ coach: makeCoach() }), {
      'GET /api/integrations': () => [paused],
    })
    await screen.findByRole('link', { name: 'Log activity' })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Check for new runs' })).not.toBeInTheDocument()
    })
  })

  test.each([
    ['paused', 'Rate limit reached.'],
    ['partial', 'Two files could not be read.'],
  ] as const)(
    'a pull that ends %s is not "no new runs": it says what the service said',
    async (status, said) => {
      const user = userEvent.setup()
      const after = minutesAgo(0)
      const { routes } = fakeServices(
        [service('intervals', 'Intervals.icu', { lastSyncStatus: status, lastError: said })],
        minutesAgo(5),
        after,
      )
      renderToday(makeToday({ coach: makeCoach() }), {
        ...routes,
        'GET /api/integrations/intervals/runs': () => [{ ...run(after, 0), status }],
      })
      await user.click(await screen.findByRole('button', { name: 'Check for new runs' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        `Intervals.icu did not finish. ${said} Try again later.`,
      )
      expect(screen.queryByText('No new runs')).not.toBeInTheDocument()
    },
  )

  test('is off while the browser has no connection', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true })
    renderToday(makeToday({ coach: makeCoach() }), {
      'GET /api/integrations': () => [service('intervals', 'Intervals.icu')],
    })
    expect(await screen.findByRole('button', { name: 'Check for new runs' })).toBeDisabled()
  })

  describe('on opening', () => {
    test('pulls once when the last pull is older than 15 minutes, and stays quiet when nothing came', async () => {
      const after = minutesAgo(0)
      const { state, routes } = fakeServices(
        [service('intervals', 'Intervals.icu')],
        minutesAgo(16),
        after,
      )
      renderToday(makeToday({ coach: makeCoach() }), {
        ...routes,
        'GET /api/integrations/intervals/runs': () => [run(after, 0)],
      })
      await waitFor(() => {
        expect(state.syncs).toEqual(['intervals'])
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Check for new runs' })).not.toHaveAttribute(
          'aria-busy',
          'true',
        )
      })
      expect(screen.queryByText('No new runs')).not.toBeInTheDocument()
      expect(state.syncs).toHaveLength(1)
    })

    test('names what arrived even though nobody asked', async () => {
      const after = minutesAgo(0)
      const { routes } = fakeServices([service('intervals', 'Intervals.icu')], null, after)
      renderToday(makeToday({ coach: makeCoach() }), {
        ...routes,
        'GET /api/integrations/intervals/runs': () => [run(after, 1)],
      })
      expect(await screen.findByText('One new run added from Intervals.icu')).toBeInTheDocument()
    })

    test('does not pull when the last pull is under 15 minutes old', async () => {
      const { state, routes } = fakeServices(
        [service('intervals', 'Intervals.icu')],
        minutesAgo(14),
        minutesAgo(0),
      )
      renderToday(makeToday({ coach: makeCoach() }), routes)
      const button = await screen.findByRole('button', { name: 'Check for new runs' })
      expect(within(button).queryByText('Checking for new runs.')).not.toBeInTheDocument()
      expect(state.syncs).toEqual([])
    })

    test('a failed pull nobody asked for stays quiet', async () => {
      renderToday(makeToday({ coach: makeCoach() }), {
        'GET /api/integrations': () => [
          service('intervals', 'Intervals.icu', { lastSyncAt: null }),
        ],
        'POST /api/integrations/intervals/sync': () => ({
          status: 409,
          body: { error: { code: 'conflict', message: 'Reconnect Intervals.icu first.' } },
        }),
      })
      const button = await screen.findByRole('button', { name: 'Check for new runs' })
      await waitFor(() => {
        expect(button).not.toHaveAttribute('aria-busy', 'true')
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
