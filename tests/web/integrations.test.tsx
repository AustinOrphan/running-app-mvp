import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { IntegrationStatus, ProviderInfo } from '../../shared/types.ts'
import { providerMessage, count } from '../../shared/copy/pageCopy.ts'
import { FOLDER_SCAN_MINUTES } from '../../shared/limits.ts'
import { SYNC_POLL_MS } from '../../web/api/integrations.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { IntegrationsPage } from '../../web/pages/IntegrationsPage.tsx'
import {
  activityPage,
  expectCleanCopy,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import { makeInputs, makeStateView } from './state-fixtures.ts'
import { wristRoutes } from './wrist-fixtures.ts'

const infos: Record<string, ProviderInfo> = {
  intervals: {
    key: 'intervals',
    label: 'intervals.icu',
    experimental: false,
    channels: ['pull'],
    wellness: true,
    docsUrl: 'https://intervals.example.com/docs',
  },
  strava: {
    key: 'strava',
    label: 'Strava',
    experimental: false,
    channels: ['pull'],
    wellness: false,
    docsUrl: 'https://strava.example.com/docs',
  },
  garmin: {
    key: 'garmin',
    label: 'Garmin Connect',
    experimental: true,
    channels: ['pull'],
    wellness: true,
    docsUrl: 'https://garmin.example.com/docs',
  },
  'apple-health': {
    key: 'apple-health',
    label: 'Apple Health',
    experimental: false,
    channels: ['push', 'upload'],
    wellness: true,
    docsUrl: 'https://apple.example.com/docs',
  },
  folder: {
    key: 'folder',
    label: 'Watched folder',
    experimental: false,
    channels: ['folder'],
    wellness: false,
    docsUrl: 'https://folder.example.com/docs',
  },
}

function status(key: string, over: Partial<IntegrationStatus> = {}): IntegrationStatus {
  const info = infos[key]
  if (!info) throw new Error(`No fixture for ${key}`)
  return {
    provider: key,
    info,
    status: 'disconnected',
    config: {},
    pushEnabled: false,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastError: null,
    ...over,
  }
}

function allStatuses(over: Record<string, Partial<IntegrationStatus>> = {}): IntegrationStatus[] {
  return Object.keys(infos).map((key) => status(key, over[key]))
}

function routes(list: IntegrationStatus[], extra: MockRoutes = {}): MockRoutes {
  return {
    'GET /api/integrations': () => list,
    'GET /api/state': () => makeStateView(),
    // the "Calendar link" section reads the wrist status
    ...wristRoutes(),
    ...extra,
  }
}

function card(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

describe('IntegrationsPage', () => {
  test('shows one card per provider in registry order', async () => {
    mockApi(routes(allStatuses()))
    renderWithProviders(<IntegrationsPage />)

    await screen.findByRole('region', { name: 'intervals.icu' })
    // the calendar link is a section of its own after the providers, not a provider card
    await screen.findByRole('region', { name: 'Calendar link' })
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual([
      'intervals.icu',
      'Strava',
      'Garmin Connect',
      'Apple Health',
      'Watched folder',
      'Calendar link',
    ])
    expect(within(card('intervals.icu')).getByText('Not connected')).toBeInTheDocument()
    // every card, form and note of the page
    expectCleanCopy(document.body)
  })

  test('says what the training advice reads above the cards', async () => {
    mockApi(
      routes(allStatuses(), {
        'GET /api/state': () =>
          makeStateView(
            makeInputs({
              activities: {
                windowDays: 365,
                count: 214,
                latest: '2026-10-21',
                flaggedDuplicates: 0,
              },
              wellness: { windowDays: 60, count: 41, latest: '2026-10-22' },
            }),
          ),
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    const summary = await screen.findByRole('status')
    await waitFor(() => {
      expect(summary).toHaveTextContent(
        'Training advice reads 214 activities, the latest on 21 Oct, and 41 days of wellness, the latest on 22 Oct.',
      )
    })
    const cards = await screen.findByRole('region', { name: 'intervals.icu' })
    expect(summary.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('a summary that did not load leaves the cards usable', async () => {
    mockApi(
      routes(allStatuses(), {
        'GET /api/state': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'Something went wrong.' } },
        }),
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    await screen.findByRole('region', { name: 'intervals.icu' })
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('The data summary did not load.')
    })
    expect(within(card('intervals.icu')).getByRole('button', { name: 'Connect' })).toBeEnabled()
  })

  test('connects intervals.icu with the athlete id and API key', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(allStatuses(), {
        'PUT /api/integrations/intervals': () =>
          status('intervals', { status: 'connected', config: { athleteId: 'i1' } }),
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    const intervals = await screen.findByRole('region', { name: 'intervals.icu' })
    await user.type(within(intervals).getByLabelText('Athlete id'), 'i1')
    await user.type(within(intervals).getByLabelText('API key'), 'synthetic-key')
    await user.click(within(intervals).getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        athleteId: 'i1',
        apiKey: 'synthetic-key',
      })
    })
  })

  test('shows a field error from the server next to the field', async () => {
    const user = userEvent.setup()
    mockApi(
      routes(allStatuses(), {
        'PUT /api/integrations/intervals': () => ({
          status: 400,
          body: {
            error: {
              code: 'validation',
              message: 'Invalid input',
              details: { issues: [{ path: 'apiKey', message: 'Enter the API key.' }] },
            },
          },
        }),
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    const intervals = await screen.findByRole('region', { name: 'intervals.icu' })
    await user.type(within(intervals).getByLabelText('Athlete id'), 'i1')
    await user.click(within(intervals).getByRole('button', { name: 'Connect' }))

    expect(await within(intervals).findByText('Enter the API key.')).toBeInTheDocument()
  })

  test('connected card shows the last sync and syncs from a chosen date', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(
        allStatuses({
          intervals: {
            status: 'connected',
            lastSyncAt: '2026-10-20T08:30:00.000Z',
            lastSyncStatus: 'ok',
          },
        }),
        {
          'POST /api/integrations/intervals/sync': () => ({
            status: 202,
            body: status('intervals', { status: 'connected' }),
          }),
        },
      ),
    )
    renderWithProviders(<IntegrationsPage />)

    const intervals = await screen.findByRole('region', { name: 'intervals.icu' })
    expect(within(intervals).getByText('Connected')).toBeInTheDocument()
    expect(within(intervals).getByText(/Last sync/)).toBeInTheDocument()
    expect(within(intervals).queryByLabelText('API key')).not.toBeInTheDocument()

    await user.type(within(intervals).getByLabelText('Backfill from'), '2026-01-01')
    await user.click(within(intervals).getByRole('button', { name: 'Sync now' }))

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ from: '2026-01-01' })
    })
  })

  test('sync now without a date sends an empty body', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(allStatuses({ intervals: { status: 'connected' } }), {
        'POST /api/integrations/intervals/sync': () => ({
          status: 202,
          body: status('intervals', { status: 'connected' }),
        }),
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    const intervals = await screen.findByRole('region', { name: 'intervals.icu' })
    await user.click(within(intervals).getByRole('button', { name: 'Sync now' }))

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({})
    })
  })

  test('refetches the list while a sync runs and stops when it has finished', async () => {
    const user = userEvent.setup()
    const before = '2026-10-20T08:30:00.000Z'
    const after = '2026-10-22T07:00:00.000Z'
    let finished = false
    const { calls } = mockApi({
      'GET /api/integrations': () =>
        allStatuses({
          intervals: {
            status: 'connected',
            lastSyncAt: finished ? after : before,
            lastSyncStatus: 'ok',
          },
        }),
      'POST /api/integrations/intervals/sync': () => ({
        status: 202,
        body: status('intervals', { status: 'connected', lastSyncAt: before }),
      }),
      'GET /api/activities': () => activityPage([]),
      'GET /api/imports': () => [],
      'GET /api/wellness': () => [],
      'GET /api/state': () => makeStateView(),
      ...wristRoutes(),
    })
    renderWithProviders(<IntegrationsPage />)
    const listCalls = () => calls.filter((c) => c.url === '/api/integrations').length

    const intervals = await screen.findByRole('region', { name: 'intervals.icu' })
    await user.click(within(intervals).getByRole('button', { name: 'Sync now' }))
    // Still running: the list is asked for again on its own.
    await waitFor(
      () => {
        expect(listCalls()).toBeGreaterThanOrEqual(3)
      },
      { timeout: 6000 },
    )

    finished = true
    await waitFor(
      () => {
        expect(
          within(screen.getByRole('region', { name: 'intervals.icu' })).getByText(
            `Last sync ${new Date(after).toLocaleString()}`,
          ),
        ).toBeInTheDocument()
      },
      { timeout: 6000 },
    )

    // Once it shows the new time the polling stops.
    await new Promise((resolve) => setTimeout(resolve, 100))
    const settled = listCalls()
    await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_MS + 500))
    expect(listCalls()).toBe(settled)
  }, 20_000)

  test('shows the stored error and offers a reconnect when authorisation lapsed', async () => {
    mockApi(
      routes(
        allStatuses({
          intervals: {
            status: 'needs_auth',
            lastError: 'Reconnect: the session secret changed.',
          },
        }),
      ),
    )
    renderWithProviders(<IntegrationsPage />)

    const intervals = await screen.findByRole('region', { name: 'intervals.icu' })
    expect(within(intervals).getByText('Needs reconnecting')).toBeInTheDocument()
    expect(
      within(intervals).getByText('Reconnect: the session secret changed.'),
    ).toBeInTheDocument()
    expect(within(intervals).getByLabelText('API key')).toBeInTheDocument()
  })

  test('shows a paused run as waiting, not as a failure', async () => {
    mockApi(
      routes(
        allStatuses({
          strava: {
            status: 'connected',
            lastSyncAt: '2026-10-20T08:30:00.000Z',
            lastSyncStatus: 'paused',
          },
        }),
      ),
    )
    renderWithProviders(<IntegrationsPage />)

    const strava = await screen.findByRole('region', { name: 'Strava' })
    expect(within(strava).getByText(/paused/i)).toBeInTheDocument()
    expect(within(strava).getByText(/continue/i)).toBeInTheDocument()
  })

  test('disconnect calls the API and says activities stay', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(allStatuses({ intervals: { status: 'connected' } }), {
        'DELETE /api/integrations/intervals': () => ({ status: 204, body: undefined }),
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    const intervals = await screen.findByRole('region', { name: 'intervals.icu' })
    expect(within(intervals).getByText(/activities stay/i)).toBeInTheDocument()
    await user.click(within(intervals).getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
    })
  })

  test('Strava card lists the API application steps with the callback domain', async () => {
    mockApi(routes(allStatuses()))
    renderWithProviders(<IntegrationsPage />)

    const strava = await screen.findByRole('region', { name: 'Strava' })
    expect(within(strava).getByText(/strava\.com\/settings\/api/)).toBeInTheDocument()
    expect(within(strava).getByText(window.location.host)).toBeInTheDocument()
  })

  test('Strava connect sends the application details and follows the authorize URL', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    const { calls } = mockApi(
      routes(allStatuses(), {
        'PUT /api/integrations/strava': () => ({
          ...status('strava', { status: 'needs_auth', config: { clientId: '123' } }),
          authorizeUrl: 'https://www.strava.com/oauth/authorize?client_id=123',
        }),
      }),
    )
    vi.stubGlobal('location', { ...window.location, host: 'localhost:3000', assign })
    renderWithProviders(<IntegrationsPage />)

    const strava = await screen.findByRole('region', { name: 'Strava' })
    expect(within(strava).getByText('localhost:3000')).toBeInTheDocument()
    await user.type(within(strava).getByLabelText('Client id'), '123')
    await user.type(within(strava).getByLabelText('Client secret'), 'synthetic-secret')
    await user.click(within(strava).getByRole('button', { name: 'Connect and authorise' }))

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('https://www.strava.com/oauth/authorize?client_id=123')
    })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      clientId: '123',
      clientSecret: 'synthetic-secret',
    })
  })

  test('Garmin card states the risk before the form and requires the acknowledgement', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(allStatuses(), {
        'PUT /api/integrations/garmin': () =>
          status('garmin', { status: 'connected', config: { mode: 'login' } }),
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    const garmin = await screen.findByRole('region', { name: 'Garmin Connect' })
    const risk = within(garmin).getByText(/unofficial/i, { selector: 'p' })
    const username = within(garmin).getByLabelText('Username')
    expect(risk.compareDocumentPosition(username) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(garmin).getByText('Experimental')).toBeInTheDocument()

    await user.type(username, 'runner@example.com')
    await user.type(within(garmin).getByLabelText('Password'), 'synthetic-password')
    const connect = within(garmin).getByRole('button', { name: 'Connect' })
    await user.click(connect)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    expect(within(garmin).getByText(/Tick the box/)).toBeInTheDocument()

    await user.click(within(garmin).getByLabelText(/I understand this is unofficial/))
    await user.click(connect)
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        mode: 'login',
        username: 'runner@example.com',
        password: 'synthetic-password',
        acknowledgeRisk: true,
      })
    })
  })

  test('Garmin asks for the verification code when the login needs one', async () => {
    const user = userEvent.setup()
    let step = 0
    const { calls } = mockApi(
      routes(allStatuses(), {
        'PUT /api/integrations/garmin': () => {
          step += 1
          return step === 1
            ? status('garmin', {
                status: 'disconnected',
                config: { mfaRequired: true, method: 'email' },
              })
            : status('garmin', { status: 'connected' })
        },
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    const garmin = await screen.findByRole('region', { name: 'Garmin Connect' })
    await user.type(within(garmin).getByLabelText('Username'), 'runner@example.com')
    await user.type(within(garmin).getByLabelText('Password'), 'synthetic-password')
    await user.click(within(garmin).getByLabelText(/I understand this is unofficial/))
    await user.click(within(garmin).getByRole('button', { name: 'Connect' }))

    await user.type(await within(garmin).findByLabelText('Verification code'), '123456')
    await user.click(within(garmin).getByRole('button', { name: 'Verify' }))

    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')[1]?.body).toEqual({
        mode: 'mfa',
        code: '123456',
        acknowledgeRisk: true,
      })
    })
  })

  test('Garmin accepts pasted tokens as the fallback', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(allStatuses(), {
        'PUT /api/integrations/garmin': () => status('garmin', { status: 'connected' }),
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    const garmin = await screen.findByRole('region', { name: 'Garmin Connect' })
    await user.click(within(garmin).getByRole('button', { name: 'Paste tokens instead' }))
    await user.click(within(garmin).getByLabelText(/I understand this is unofficial/))
    const tokens = '{"access_token":"a","refresh_token":"b","expires_in":3600}'
    await user.click(within(garmin).getByLabelText('Token JSON'))
    await user.paste(tokens)
    await user.click(within(garmin).getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        mode: 'tokens',
        tokens,
        acknowledgeRisk: true,
      })
    })
  })

  test('Apple Health creates a push token, shows it once and explains the setup', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(allStatuses(), {
        'POST /api/integrations/apple-health/push-token': () => ({ token: 'tok_synthetic_123' }),
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    const apple = await screen.findByRole('region', { name: 'Apple Health' })
    expect(within(apple).queryByText('tok_synthetic_123')).not.toBeInTheDocument()
    await user.click(within(apple).getByRole('button', { name: 'Create push token' }))

    expect(await within(apple).findByText('tok_synthetic_123')).toBeInTheDocument()
    expect(within(apple).getByText(/shown once/i)).toBeInTheDocument()
    expect(within(apple).getByRole('button', { name: 'Copy token' })).toBeInTheDocument()
    expect(within(apple).getByText(/\/api\/ingest\/apple-health/)).toBeInTheDocument()
    expect(within(apple).getByText(/Health Auto Export/)).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(true)
    expectCleanCopy(apple)
  })

  test('Apple Health says how to go on when the token cannot be copied', async () => {
    const user = userEvent.setup()
    mockApi(
      routes(allStatuses(), {
        'POST /api/integrations/apple-health/push-token': () => ({ token: 'tok_synthetic_123' }),
      }),
    )
    renderWithProviders(
      <ToastProvider>
        <IntegrationsPage />
      </ToastProvider>,
    )
    const apple = await screen.findByRole('region', { name: 'Apple Health' })
    await user.click(within(apple).getByRole('button', { name: 'Create push token' }))
    await within(apple).findByText('tok_synthetic_123')
    // user-event installs its own clipboard on setup(); replace it with one that refuses
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Not allowed.')) },
    })
    await user.click(within(apple).getByRole('button', { name: 'Copy token' }))
    expect(
      await screen.findByText('The token could not be copied. Select it and copy it by hand.'),
    ).toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('Apple Health with push on offers a replacement token', async () => {
    mockApi(routes(allStatuses({ 'apple-health': { status: 'connected', pushEnabled: true } })))
    renderWithProviders(<IntegrationsPage />)

    const apple = await screen.findByRole('region', { name: 'Apple Health' })
    expect(within(apple).getByRole('button', { name: 'Create new push token' })).toBeInTheDocument()
  })

  test('Watched folder connects with a path', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(allStatuses(), {
        'PUT /api/integrations/folder': () =>
          status('folder', { status: 'connected', config: { path: '/data/inbox' } }),
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    const folder = await screen.findByRole('region', { name: 'Watched folder' })
    await user.type(within(folder).getByLabelText('Folder path'), '/data/inbox')
    await user.click(within(folder).getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ path: '/data/inbox' })
    })
  })

  test('a connected folder shows its path', async () => {
    mockApi(
      routes(allStatuses({ folder: { status: 'connected', config: { path: '/data/inbox' } } })),
    )
    renderWithProviders(<IntegrationsPage />)

    const folder = await screen.findByRole('region', { name: 'Watched folder' })
    expect(within(folder).getByText('/data/inbox')).toBeInTheDocument()
    // the sentence names the interval the scheduler runs the scan at
    expect(
      within(folder).getByText(
        `The folder is scanned every ${String(FOLDER_SCAN_MINUTES)} minutes.`,
      ),
    ).toBeInTheDocument()
    expectCleanCopy(folder)
  })

  test('announces a finished Strava authorisation or its error from the address', async () => {
    mockApi(routes(allStatuses()))
    renderWithProviders(<IntegrationsPage />, { route: '/integrations?connected=strava' })
    expect(await screen.findByText('Strava is connected.')).toBeInTheDocument()
  })

  test('shows the error the callback passed back', async () => {
    mockApi(routes(allStatuses()))
    renderWithProviders(<IntegrationsPage />, {
      route: '/integrations?error=access_denied',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('access_denied')
  })

  test('a failed run keeps Sync now and does not ask for the credentials again', async () => {
    mockApi(
      routes(
        allStatuses({
          intervals: { status: 'error', lastError: 'intervals.icu answered HTTP 500.' },
        }),
      ),
    )
    renderWithProviders(<IntegrationsPage />)

    const intervals = await screen.findByRole('region', { name: 'intervals.icu' })
    expect(within(intervals).getByText('intervals.icu answered HTTP 500.')).toBeInTheDocument()
    expect(within(intervals).getByRole('button', { name: 'Sync now' })).toBeInTheDocument()
    expect(within(intervals).queryByLabelText('API key')).not.toBeInTheDocument()
    expectCleanCopy(intervals)
  })

  test("a run that stopped on a service error names it in the app's own words", async () => {
    const lastError = providerMessage('provider.garmin.list', { status: count(503) })
    mockApi(routes(allStatuses({ garmin: { status: 'error', lastError } })))
    renderWithProviders(<IntegrationsPage />)

    const garmin = await screen.findByRole('region', { name: 'Garmin Connect' })
    expect(
      within(garmin).getByText('Garmin answered the activity list request with HTTP 503.'),
    ).toBeInTheDocument()
    expectCleanCopy(garmin)
  })

  test('a field error for a field the form does not show goes in the alert', async () => {
    const user = userEvent.setup()
    mockApi(
      routes(allStatuses(), {
        'PUT /api/integrations/garmin': () => ({
          status: 400,
          body: {
            error: {
              code: 'validation',
              message: 'Invalid input',
              details: { issues: [{ path: 'clientId', message: 'Enter the client id.' }] },
            },
          },
        }),
      }),
    )
    renderWithProviders(<IntegrationsPage />)

    const garmin = await screen.findByRole('region', { name: 'Garmin Connect' })
    await user.type(within(garmin).getByLabelText('Username'), 'runner@example.com')
    await user.type(within(garmin).getByLabelText('Password'), 'synthetic-password')
    await user.click(within(garmin).getByLabelText(/I understand this is unofficial/))
    await user.click(within(garmin).getByRole('button', { name: 'Connect' }))

    expect(await within(garmin).findByRole('alert')).toHaveTextContent('Enter the client id.')
  })

  test('says so when the list does not load', async () => {
    mockApi({ 'GET /api/integrations': () => ({ status: 500, body: undefined }) })
    renderWithProviders(<IntegrationsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not load/i)
  })
})
