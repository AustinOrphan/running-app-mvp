import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { IntegrationStatus, ProviderInfo, SyncRunView } from '../../shared/types.ts'
import { expectCleanCopy, type MockRoutes } from './helpers.tsx'
import { makeCoach, makeToday } from './today-fixtures.ts'
import { renderToday, startToday } from './today-render.tsx'

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
