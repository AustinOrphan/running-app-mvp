import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Activity } from '../../shared/types.ts'
import { FeelPicker } from '../../web/components/FeelPicker.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ActivitiesPage } from '../../web/pages/ActivitiesPage.tsx'
import { DashboardPage } from '../../web/pages/DashboardPage.tsx'
import { makeActivity } from '../factories.ts'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import { makeToday } from './today-fixtures.ts'

// The fixed clock is Wednesday 2026-03-18.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

const settings = { email: 'runner@example.com', displayName: null, units: 'mi' }

describe('FeelPicker', () => {
  test('offers the five ratings and reports a choice', async () => {
    const onChange = vi.fn()
    render(<FeelPicker value={null} onChange={onChange} />)
    const group = screen.getByRole('group', { name: 'How it felt' })
    const names = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(names).toEqual(['Much easier', 'Easier', 'As expected', 'Harder', 'Much harder'])
    await userEvent.click(within(group).getByRole('button', { name: 'Harder' }))
    expect(onChange).toHaveBeenCalledWith(1)
  })

  test('marks the chosen value and clears it on a second tap', async () => {
    const onChange = vi.fn()
    render(<FeelPicker value={0} onChange={onChange} />)
    const chosen = screen.getByRole('button', { name: 'As expected' })
    expect(chosen).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Easier' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(chosen)
    expect(onChange).toHaveBeenCalledWith(null)
  })
})

function renderDashboard(activities: Activity[], extra: MockRoutes = {}) {
  const api = mockApi({
    'GET /api/goals': () => [],
    'GET /api/plan': () => null,
    'GET /api/weeks': () => [],
    'GET /api/reviews': () => [],
    'GET /api/activities': () => activities,
    'GET /api/settings': () => settings,
    'GET /api/today': () => makeToday(),
    ...extra,
  })
  renderWithProviders(
    <ToastProvider>
      <DashboardPage />
    </ToastProvider>,
  )
  return api
}

describe('Today: How did it go?', () => {
  test('lists runs and races of the last 7 days with no RPE and no feel', async () => {
    renderDashboard([
      makeActivity({ id: 'r1', date: '2026-03-17', type: 'run', durationSec: 1800 }),
      makeActivity({ id: 'r2', date: '2026-03-12', type: 'race', durationSec: 3600 }),
      makeActivity({ id: 'old', date: '2026-03-11', type: 'run' }),
      makeActivity({ id: 'rated', date: '2026-03-16', type: 'run', rpe: 5 }),
      makeActivity({ id: 'felt', date: '2026-03-16', type: 'run', feel: 0 }),
      makeActivity({ id: 'gym', date: '2026-03-16', type: 'strength' }),
      makeActivity({ id: 'dupe', date: '2026-03-16', type: 'run', duplicateStatus: 'confirmed' }),
    ])
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(card).getAllByRole('listitem')).toHaveLength(2)
    expect(within(card).getByText(/Tue 17 Mar/)).toBeInTheDocument()
    expect(within(card).getByText(/Thu 12 Mar/)).toBeInTheDocument()
  })

  test('is absent when nothing needs rating', async () => {
    renderDashboard([makeActivity({ date: '2026-03-17', rpe: 4 })])
    await screen.findByText(/No plan yet/)
    expect(screen.queryByRole('region', { name: 'How did it go?' })).not.toBeInTheDocument()
  })

  test('saves RPE, feel and pain for the activity', async () => {
    const user = userEvent.setup()
    const api = renderDashboard([makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })], {
      'PATCH /api/activities/r1/feedback': () => ({}),
    })
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    await user.click(within(card).getByRole('button', { name: 'RPE 6' }))
    await user.click(within(card).getByRole('button', { name: 'Easier' }))
    await user.click(within(card).getByRole('button', { name: 'Pain 0' }))
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true)
    })
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      rpe: 6,
      feel: -1,
      pain: 0,
    })
  })

  test('refreshes today and the plan after a save, since the server re-assesses the session', async () => {
    const user = userEvent.setup()
    const api = renderDashboard([makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })], {
      'PATCH /api/activities/r1/feedback': () => ({}),
    })
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    const gets = (path: string) =>
      api.calls.filter((c) => c.method === 'GET' && c.url.startsWith(path)).length
    await waitFor(() => {
      expect(gets('/api/today')).toBe(1)
      expect(gets('/api/plan')).toBe(1)
    })
    await user.click(within(card).getByRole('button', { name: 'RPE 6' }))
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(gets('/api/today')).toBe(2)
      expect(gets('/api/plan')).toBe(2)
    })
  })

  test('keeps a saved pain score when only RPE is rated', async () => {
    const user = userEvent.setup()
    const api = renderDashboard(
      [makeActivity({ id: 'r1', date: '2026-03-17', type: 'run', pain: 3 })],
      { 'PATCH /api/activities/r1/feedback': () => ({}) },
    )
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(card).getByRole('button', { name: 'Pain 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(within(card).getByRole('button', { name: 'RPE 4' }))
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PATCH')).toBe(true)
    })
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      rpe: 4,
      feel: null,
      pain: 3,
    })
  })

  test('Save waits until something is chosen', async () => {
    renderDashboard([makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })])
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('a failed save stays in the card with the entries', async () => {
    const user = userEvent.setup()
    renderDashboard([makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })], {
      'PATCH /api/activities/r1/feedback': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Server error' } },
      }),
    })
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    await user.click(within(card).getByRole('button', { name: 'RPE 6' }))
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent(/Feedback not saved/)
    expect(within(card).getByRole('button', { name: 'RPE 6' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

describe('Activities list and form', () => {
  function renderList(activities: Activity[]) {
    const api = mockApi({
      'GET /api/settings': () => settings,
      'GET /api/activities': () => activities,
      'PUT /api/activities/a9': () => ({}),
    })
    renderWithProviders(
      <ToastProvider>
        <ActivitiesPage />
      </ToastProvider>,
    )
    return api
  }

  test('each row links to the detail page', async () => {
    renderList([makeActivity({ id: 'a9', date: '2026-03-17', type: 'run' })])
    const link = await screen.findByRole('link', { name: /^Details/ })
    expect(link).toHaveAttribute('href', '/activities/a9')
  })

  test('the edit sheet carries feel and pain and sends them back', async () => {
    const user = userEvent.setup()
    const api = renderList([
      makeActivity({ id: 'a9', date: '2026-03-17', type: 'run', feel: 1, pain: 3 }),
    ])
    await user.click(await screen.findByRole('button', { name: /3\.11 mi/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit activity' })
    expect(within(dialog).getByRole('button', { name: 'Harder' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Much harder' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PUT')).toBe(true)
    })
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ feel: 2, pain: 3 })
  })

  test('labels activities from every source by name', async () => {
    renderList([
      makeActivity({ id: 'a9', date: '2026-03-17', source: 'intervals' }),
      makeActivity({ id: 'a8', date: '2026-03-16', source: 'apple-health' }),
    ])
    expect(await screen.findByText('intervals.icu')).toBeInTheDocument()
    expect(screen.getByText('Apple Health')).toBeInTheDocument()
  })
})
