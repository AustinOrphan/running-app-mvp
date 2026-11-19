import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'
import type { MergeCandidate } from '../../shared/domain/manualMerge.ts'
import type { Activity, ActivityDetail } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ActivityDetailPage } from '../../web/pages/ActivityDetailPage.tsx'
import { makeActivity } from '../factories.ts'
import { makeToday } from './today-fixtures.ts'
import {
  expectCleanCopy,
  mockApi,
  noTrackRoute,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'

// MM1: "Same session as…" on the activity page, and "Merged into" with Separate on the copy.

function detailOf(activity: Activity): ActivityDetail {
  return { activity, stream: null, laps: null, hasFile: false, hrUse: null }
}

const MINE = makeActivity({
  id: 'a1',
  type: 'run',
  source: 'manual',
  date: '2026-03-02',
  durationSec: 2400,
})
const WATCH = makeActivity({
  id: 'a2',
  type: 'run',
  source: 'intervals',
  date: '2026-03-02',
  startTime: '07:10',
  durationSec: 2760,
  avgHr: 141,
})

const CANDIDATE: MergeCandidate = {
  id: 'a2',
  date: '2026-03-02',
  startTime: '07:10',
  type: 'run',
  durationSec: 2760,
  source: 'intervals',
  avgHr: 141,
}

function renderPage(activity: Activity, routes: MockRoutes = {}) {
  const api = mockApi({
    'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'mi' }),
    [`GET /api/activities/${activity.id}/detail`]: () => detailOf(activity),
    'GET /api/activities/a2/detail': () => detailOf(WATCH),
    'GET /api/activities/a1/standout': () => ({ items: [], more: 0 }),
    ...noTrackRoute,
    'GET /api/plan': () => null,
    'GET /api/zones': () => ({ hr: null }),
    'GET /api/today': () => makeToday(),
    'GET /api/plan-inputs': () => ({ runs: { watchRatings: { used: false } } }),
    ...routes,
  })
  renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/activities/:id" element={<ActivityDetailPage />} />
      </Routes>
    </ToastProvider>,
    { route: `/activities/${activity.id}` },
  )
  return api
}

describe('Same session as…', () => {
  test('the sheet lists the candidates and the confirm step calls merge', async () => {
    const user = userEvent.setup()
    const api = renderPage(MINE, {
      'GET /api/activities/a1/merge-candidates': () => [CANDIDATE],
      'POST /api/activities/a1/merge': () => ({ ...MINE, duplicateStatus: 'confirmed' }),
    })

    await user.click(await screen.findByRole('button', { name: 'Same session as…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Which entry is the same session?' })
    const choice = await within(dialog).findByRole('button', {
      name: /Run · .*2026, 07:10 · 46 min · 141 bpm · intervals\.icu/,
    })
    expectCleanCopy(dialog)
    await user.click(choice)

    const confirm = await screen.findByRole('dialog', { name: 'Merge these two entries?' })
    expect(
      within(confirm).getByText(
        /The one you chose \(intervals\.icu, .*2026, 07:10, 46 min\) stays as the record/,
      ),
    ).toBeTruthy()
    expect(
      within(confirm).getByText(/This entry \(entered by hand, .*2026, 40 min\) is not counted/),
    ).toBeTruthy()
    expect(within(confirm).getByText(/heat mark and race result are copied/)).toBeTruthy()
    expect(within(confirm).getByText(/Logs that moved stay on the record/)).toBeTruthy()
    // Focus follows the step: Merge on the confirm step, the first choice again on Back.
    expect(within(confirm).getByRole('button', { name: 'Merge' })).toHaveFocus()
    await user.click(within(confirm).getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('button', { name: /intervals\.icu/ })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: /intervals\.icu/ }))
    expectCleanCopy(confirm)
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)

    await user.click(within(confirm).getByRole('button', { name: 'Merge' }))
    await waitFor(() => {
      expect(api.calls.filter((c) => c.method === 'POST')).toEqual([
        { method: 'POST', url: '/api/activities/a1/merge', body: { withId: 'a2' } },
      ])
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  test('says so when there is nothing to pair with', async () => {
    const user = userEvent.setup()
    renderPage(MINE, { 'GET /api/activities/a1/merge-candidates': () => [] })
    await user.click(await screen.findByRole('button', { name: 'Same session as…' }))
    expect(await screen.findByText('No other run within a day of this one.')).toBeTruthy()
  })

  test('a refusal stays in the sheet in the server’s words', async () => {
    const user = userEvent.setup()
    renderPage(MINE, {
      'GET /api/activities/a1/merge-candidates': () => [CANDIDATE],
      'POST /api/activities/a1/merge': () => ({
        status: 409,
        body: {
          error: {
            code: 'conflict',
            message: 'Only entries dated within a day of each other can be merged.',
          },
        },
      }),
    })
    await user.click(await screen.findByRole('button', { name: 'Same session as…' }))
    await user.click(await screen.findByRole('button', { name: /intervals\.icu/ }))
    await user.click(await screen.findByRole('button', { name: 'Merge' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not merged. Only entries dated within a day of each other can be merged. Try again.',
    )
    expect(screen.getByRole('dialog', { name: 'Merge these two entries?' })).toBeTruthy()
  })

  test('is not offered on a cross-training entry', async () => {
    renderPage(makeActivity({ id: 'a1', type: 'cross', source: 'manual' }))
    await screen.findByRole('heading', { name: 'Summary' })
    expect(screen.queryByRole('button', { name: 'Same session as…' })).toBeNull()
  })
})

describe('a merged duplicate', () => {
  const MERGED = makeActivity({
    id: 'a1',
    type: 'run',
    source: 'manual',
    duplicateStatus: 'confirmed',
    duplicateOfId: 'a2',
  })

  test('shows where it went and Separate sets it back to dismissed', async () => {
    const user = userEvent.setup()
    const api = renderPage(MERGED, {
      'POST /api/activities/a1/duplicate': () => ({ ...MERGED, duplicateStatus: 'dismissed' }),
    })

    const link = await screen.findByRole('link', { name: 'Run, intervals.icu' })
    expect(link).toHaveAttribute('href', '/activities/a2')
    expect(screen.getByText(/Merged into/)).toBeTruthy()
    expect(screen.getByText(/It is not counted in totals\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Same session as…' })).toBeNull()
    // The rating form belongs to the record, not to the merged copy.
    expect(screen.queryByRole('heading', { name: 'How did it go?' })).toBeNull()
    expect(screen.getByText(/open the record it was paired with/)).toBeTruthy()
    expectCleanCopy(document.body)

    await user.click(screen.getByRole('button', { name: 'Separate' }))
    await waitFor(() => {
      expect(api.calls.filter((c) => c.method === 'POST')).toEqual([
        { method: 'POST', url: '/api/activities/a1/duplicate', body: { status: 'dismissed' } },
      ])
    })
  })
})
