import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { IntegrationStatus, SyncRunView } from '../../shared/types.ts'
import { SyncHistory } from '../../web/components/SyncHistory.tsx'
import { IntegrationsPage } from '../../web/pages/IntegrationsPage.tsx'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'

function run(over: Partial<SyncRunView> = {}): SyncRunView {
  return {
    id: 'r1',
    provider: 'intervals',
    channel: 'pull',
    trigger: 'schedule',
    startedAt: new Date(2026, 9, 22, 6, 0).toISOString(),
    finishedAt: new Date(2026, 9, 22, 6, 1).toISOString(),
    status: 'ok',
    accepted: 0,
    duplicate: 0,
    failed: 0,
    wellnessStatus: 'none',
    wellnessDays: null,
    wellnessTotal: null,
    message: null,
    failures: [],
    importBatchId: null,
    ...over,
  }
}

const RUNS = 'GET /api/integrations/intervals/runs'

async function open() {
  const user = userEvent.setup()
  await user.click(screen.getByText('Recent syncs'))
  return user
}

describe('SyncHistory', () => {
  test('is closed and fetches nothing until it is opened, then fetches once', async () => {
    const { calls } = mockApi({ [RUNS]: () => [run()] })
    renderWithProviders(<SyncHistory provider="intervals" />)

    expect(screen.getByText('Recent syncs')).toBeInTheDocument()
    expect(calls).toEqual([])

    const user = await open()
    expect(await screen.findByText('Nothing new.')).toBeInTheDocument()
    expect(calls.map((call) => call.url)).toEqual(['/api/integrations/intervals/runs'])

    // Closing and opening again reads what is already there.
    await user.click(screen.getByText('Recent syncs'))
    await user.click(screen.getByText('Recent syncs'))
    expect(calls).toHaveLength(1)
  })

  test('lists each run with its time, how it began and one sentence, newest first', async () => {
    mockApi({
      [RUNS]: () => [
        run({
          id: 'newest',
          accepted: 3,
          duplicate: 1,
          wellnessStatus: 'read',
          wellnessDays: 7,
          startedAt: new Date(2026, 9, 22, 6, 0).toISOString(),
        }),
        run({
          id: 'manual',
          trigger: 'manual',
          status: 'partial',
          accepted: 5,
          failed: 2,
          startedAt: new Date(2026, 9, 21, 18, 30).toISOString(),
        }),
        run({
          id: 'paused',
          status: 'paused',
          wellnessStatus: 'truncated',
          wellnessDays: 12,
          wellnessTotal: 30,
          startedAt: new Date(2026, 9, 21, 17, 30).toISOString(),
        }),
        run({
          id: 'waiting',
          status: 'paused',
          wellnessStatus: 'waiting',
          startedAt: new Date(2026, 9, 21, 16, 30).toISOString(),
        }),
        run({
          id: 'error',
          status: 'error',
          message: 'The service answered HTTP 503.',
          startedAt: new Date(2026, 9, 21, 15, 30).toISOString(),
        }),
        run({
          id: 'idle',
          channel: 'folder',
          startedAt: new Date(2026, 9, 21, 14, 30).toISOString(),
        }),
      ],
    })
    const { container } = renderWithProviders(<SyncHistory provider="intervals" />)
    await open()

    const items = await screen.findAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      '22 Oct, 06:00 · ScheduledStored 3 new activities, skipped 1 already stored. Read 7 wellness days.',
      '21 Oct, 18:30 · ManualStored 5 new activities. 2 could not be imported.',
      "21 Oct, 17:30 · ScheduledPaused to stay within the service's limits. Read 12 of 30 wellness days; the rest follow on the next run.",
      "21 Oct, 16:30 · ScheduledPaused to stay within the service's limits. Wellness waits until the activity backfill finishes.",
      '21 Oct, 15:30 · ScheduledDid not finish: The service answered HTTP 503.',
      '21 Oct, 14:30 · Folder scanNothing new.',
    ])
    expectCleanCopy(container)
  })

  test('a run with failures has a nested disclosure that names each one', async () => {
    mockApi({
      [RUNS]: () => [
        run({
          status: 'partial',
          accepted: 5,
          failed: 2,
          failures: [
            { ref: 'intervals:i2', reason: 'The stream could not be read.' },
            { ref: 'intervals:i9', reason: 'The stream could not be read.' },
          ],
        }),
        run({ id: 'plain', accepted: 1 }),
      ],
    })
    const { container } = renderWithProviders(<SyncHistory provider="intervals" />)
    await open()

    const label = await screen.findByText('Show the 2 that could not be imported')
    // Only the run with failures has one.
    expect(screen.getAllByText(/could not be imported$/)).toHaveLength(1)
    const nested = label.closest('details')
    expect(nested).not.toBeNull()
    expect(nested).not.toHaveAttribute('open')
    expect(within(nested as HTMLElement).getAllByRole('listitem')).toHaveLength(2)
    expect(within(nested as HTMLElement).getByText('intervals:i9')).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('says when a run kept fewer failures than it had', async () => {
    mockApi({
      [RUNS]: () => [
        run({
          status: 'partial',
          failed: 12,
          failures: Array.from({ length: 10 }, (_, i) => ({
            ref: `intervals:f${String(i)}`,
            reason: 'Unreadable.',
          })),
        }),
      ],
    })
    renderWithProviders(<SyncHistory provider="intervals" />)
    await open()
    expect(await screen.findByText('Show the 12 that could not be imported')).toBeInTheDocument()
    expect(screen.getByText('Showing the first 10.')).toBeInTheDocument()
  })

  test('says so when nothing has been recorded', async () => {
    mockApi({ [RUNS]: () => [] })
    const { container } = renderWithProviders(<SyncHistory provider="intervals" />)
    await open()
    expect(await screen.findByText('No syncs recorded yet.')).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('shows a loading line while the runs come in', async () => {
    // An answer that never arrives keeps the query pending.
    vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined))
    const { container } = renderWithProviders(<SyncHistory provider="intervals" />)
    await open()
    expect(await screen.findByText('Loading recent syncs.')).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('a failed load says so and offers to try again', async () => {
    let answer: unknown = { status: 500, body: { error: { code: 'internal', message: 'Nope.' } } }
    const { calls } = mockApi({ [RUNS]: () => answer })
    const { container } = renderWithProviders(<SyncHistory provider="intervals" />)
    const user = await open()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Recent syncs did not load.')
    expectCleanCopy(container)

    answer = [run({ accepted: 2 })]
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Stored 2 new activities.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(calls).toHaveLength(2)
  })
})

describe('the Integrations page', () => {
  const info = {
    key: 'intervals',
    label: 'intervals.icu',
    experimental: false,
    channels: ['pull'] as Array<'pull'>,
    wellness: true,
    docsUrl: 'https://intervals.example.com/docs',
  }
  const strava = { ...info, key: 'strava', label: 'Strava', wellness: false }

  function statusOf(key: typeof info, over: Partial<IntegrationStatus> = {}): IntegrationStatus {
    return {
      provider: key.key,
      info: key,
      status: 'disconnected',
      config: {},
      pushEnabled: false,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
      ...over,
    }
  }

  test('a connected card has the history and a card that is not connected does not', async () => {
    const { calls } = mockApi({
      'GET /api/integrations': () => [statusOf(info, { status: 'connected' }), statusOf(strava)],
      [RUNS]: () => [run({ accepted: 2 })],
    })
    renderWithProviders(<IntegrationsPage />)

    const connected = await screen.findByRole('region', { name: 'intervals.icu' })
    expect(within(connected).getByText('Recent syncs')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Strava' })).queryByText('Recent syncs'),
    ).not.toBeInTheDocument()
    // Opening the page reads no history.
    expect(calls.map((call) => call.url)).toEqual(['/api/integrations'])

    const user = userEvent.setup()
    await user.click(within(connected).getByText('Recent syncs'))
    await waitFor(() => {
      expect(within(connected).getByText('Stored 2 new activities.')).toBeInTheDocument()
    })
  })
})
