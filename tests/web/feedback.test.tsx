import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Activity } from '../../shared/types.ts'
import { FeelPicker } from '../../web/components/FeelPicker.tsx'
import { ScalePicker } from '../../web/components/ScalePicker.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ActivitiesPage } from '../../web/pages/ActivitiesPage.tsx'
import { makeActivity } from '../factories.ts'
import {
  activityPage,
  expectTouchScale,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import { makeToday } from './today-fixtures.ts'
import { renderToday } from './today-render.tsx'

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

describe('ScalePicker', () => {
  test('keeps every step in one row of equal columns, however many there are', () => {
    const { rerender } = render(
      <ScalePicker legend="Pain" min={0} max={10} value={null} onChange={() => {}} />,
    )
    const group = screen.getByRole('group', { name: 'Pain' })
    expect(within(group).getAllByRole('button')).toHaveLength(11)
    const row = within(group).getAllByRole('button')[0]!.parentElement!
    expect(row.style.getPropertyValue('--steps')).toBe('11')
    rerender(<ScalePicker legend="RPE" min={1} max={10} value={4} onChange={() => {}} />)
    const rpe = screen.getByRole('group', { name: 'RPE' })
    expect(within(rpe).getAllByRole('button')).toHaveLength(10)
    expect(within(rpe).getByRole('button', { name: 'RPE 4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('reports a number and clears the chosen one on a second tap', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ScalePicker legend="Pain" min={0} max={10} value={null} onChange={onChange} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Pain 7' }))
    expect(onChange).toHaveBeenLastCalledWith(7)
    rerender(<ScalePicker legend="Pain" min={0} max={10} value={7} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Pain 7' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})

/** The Today page with `unrated` as the server's list of runs still to rate. */
function renderDashboard(unrated: Activity[], extra: MockRoutes = {}) {
  return renderToday(makeToday({ unrated }), extra).api
}

describe('Today: How did it go?', () => {
  test('lists the runs and races the server sends as unrated', async () => {
    renderDashboard([
      makeActivity({ id: 'r1', date: '2026-03-17', type: 'run', durationSec: 1800 }),
      makeActivity({ id: 'r2', date: '2026-03-12', type: 'race', durationSec: 3600 }),
    ])
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(card).getAllByRole('listitem')).toHaveLength(2)
    expect(within(card).getByText(/Tue 17 Mar/)).toBeInTheDocument()
    expect(within(card).getByText(/Thu 12 Mar/)).toBeInTheDocument()
  })

  test('the invitation says a rating is what lets the plan adjust', async () => {
    renderDashboard([makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })])
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    expect(within(card).getByText(/^Recent runs without a rating\./)).toHaveTextContent(
      'Recent runs without a rating. A rating of effort or feel is what lets the plan adjust. Rate any or all of it.',
    )
    expect(card.textContent).not.toMatch(/behind|missed|streak|!/i)
  })

  test('shows the newest run in full and the others as a list with Rate buttons', async () => {
    const user = userEvent.setup()
    const api = renderDashboard(
      [
        makeActivity({ id: 'older', date: '2026-03-12', type: 'run', durationSec: 3600 }),
        makeActivity({ id: 'newest', date: '2026-03-17', type: 'run', durationSec: 1800 }),
        makeActivity({ id: 'middle', date: '2026-03-14', type: 'race', durationSec: 2400 }),
      ],
      { 'PATCH /api/activities/older/feedback': () => ({}) },
    )
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    // one form, for the newest run
    expect(within(card).getAllByRole('button', { name: 'RPE 6' })).toHaveLength(1)
    expect(within(card).getAllByRole('button', { name: /^Rate / })).toHaveLength(2)
    const items = within(card).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Tue 17 Mar')
    expect(items[1]).toHaveTextContent('Sat 14 Mar')
    expect(items[2]).toHaveTextContent('Thu 12 Mar')

    await user.click(within(card).getByRole('button', { name: /^Rate run Thu 12 Mar/ }))
    expect(within(card).getAllByRole('button', { name: 'RPE 6' })).toHaveLength(2)
    expect(within(card).getAllByRole('button', { name: /^Rate / })).toHaveLength(1)
    const older = within(card).getAllByRole('listitem')[2]!
    await user.click(within(older).getByRole('button', { name: 'RPE 3' }))
    await user.click(within(older).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.find((c) => c.method === 'PATCH')?.url).toContain('/older/feedback')
    })
  })

  test('is absent when nothing needs rating', async () => {
    renderDashboard([])
    await screen.findByText(/No plan yet/)
    expect(screen.queryByRole('region', { name: 'How did it go?' })).not.toBeInTheDocument()
  })

  test('sets RPE and pain as touch scales: 5 and 5, and 6 and 5', async () => {
    renderDashboard([makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })])
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    expectTouchScale(within(card).getByRole('group', { name: 'RPE' }), { steps: 10, columns: 5 })
    expectTouchScale(within(card).getByRole('group', { name: 'Pain' }), { steps: 11, columns: 6 })
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

  test('refreshes today after a save, since the server re-assesses the session', async () => {
    const user = userEvent.setup()
    const api = renderDashboard([makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })], {
      'PATCH /api/activities/r1/feedback': () => ({}),
    })
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    const gets = (path: string) =>
      api.calls.filter((c) => c.method === 'GET' && c.url.startsWith(path)).length
    await waitFor(() => {
      expect(gets('/api/today')).toBe(1)
    })
    await user.click(within(card).getByRole('button', { name: 'RPE 6' }))
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(gets('/api/today')).toBe(2)
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
      'GET /api/activities': () => activityPage(activities),
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
