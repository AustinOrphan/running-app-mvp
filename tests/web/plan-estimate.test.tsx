// The distance estimate on the Plan page (STATUS follow-up 17): the day cards and the week row
// word the figures the server sent, and the session sheet opened from a card agrees with the card.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  Goal,
  PlanSessionView,
  PlanWeekView,
  PlanWithSessions,
  UserSettings,
  WeekRow,
} from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { PlanPage } from '../../web/pages/PlanPage.tsx'
import {
  activityPage,
  expectCleanCopy,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import { makeRevision, makeV2Plan, settings } from './plan-fixtures.ts'
import { sheetRoutes } from './wrist-fixtures.ts'

vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Why" /> : null,
}))

const goal = {
  id: 'g1',
  name: 'Spring marathon',
  status: 'target',
  isActive: true,
  targetDate: '2027-03-07',
  distanceM: 42195,
} as Goal

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-13T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

function routes(plan: PlanWithSessions, units: UserSettings['units'] = 'km'): MockRoutes {
  return {
    'GET /api/plan': () => plan,
    'GET /api/goals': () => [goal],
    'GET /api/settings': () => ({ ...settings, units }),
    'GET /api/weeks': () => [] as WeekRow[],
    'GET /api/plan/revisions': () => [makeRevision()],
    'GET /api/plan/disruptions': () => [],
    'GET /api/activities': () => activityPage([]),
    ...sheetRoutes(plan.sessions),
  }
}

function renderPlan() {
  return renderWithProviders(
    <ToastProvider>
      <PlanPage />
    </ToastProvider>,
  )
}

const row = (weekStart: string) =>
  document.querySelector<HTMLElement>(`tr[data-week="${weekStart}"]`)!

/** The sample plan with estimates: the week of 11 Jan holds two runs, the week of 4 Jan one. */
function estimated(): PlanWithSessions {
  const base = makeV2Plan()
  const estimates: Record<string, PlanSessionView['distanceEstimate']> = {
    a: { distanceM: 6200, basis: 'easy' },
    b: { distanceM: 16_100, basis: 'easy' },
    c: { distanceM: 9300, basis: 'pace' },
    d: null,
  }
  const weeks: Record<string, number | null> = {
    '2027-01-04': 6200,
    '2027-01-11': 25_400,
    '2027-01-18': null,
  }
  return {
    ...base,
    weeks: base.weeks.map((week): PlanWeekView => ({
      ...week,
      distanceEstimateM: weeks[week.weekStart] ?? null,
    })),
    sessions: base.sessions.map((s) => ({ ...s, distanceEstimate: estimates[s.id] ?? null })),
  }
}

describe('Plan page: the day cards', () => {
  test('say "about" beside the minutes, in place of the plan’s own distance', async () => {
    mockApi(routes(estimated()))
    renderPlan()
    const long = await screen.findByRole('button', { name: /Steady long run/ })
    // The units arrive with the settings; the cards word the distance once they have.
    await vi.waitFor(() => {
      expect(long).toHaveTextContent('55 min, about 16 km, Planned')
    })
    expect(long).not.toHaveTextContent('9.00 km')
    const strides = screen.getByRole('button', { name: /Hill strides/ })
    expect(strides).toHaveTextContent('55 min, about 9 km, Planned')
  })

  test('follow the runner’s units: miles', async () => {
    mockApi(routes(estimated(), 'mi'))
    renderPlan()
    const long = await screen.findByRole('button', { name: /Steady long run/ })
    await vi.waitFor(() => {
      expect(long).toHaveTextContent('55 min, about 10 mi, Planned')
    })
  })

  test('keep the plan’s own distance when the server sent no estimate', async () => {
    mockApi(routes(makeV2Plan()))
    renderPlan()
    const long = await screen.findByRole('button', { name: /Steady long run/ })
    expect(await screen.findByText('Tue 12 Jan')).toBeInTheDocument()
    await vi.waitFor(() => {
      expect(long).toHaveTextContent('55 min, 9.00 km, Planned')
    })
    expect(long).not.toHaveTextContent('about')
  })

  test('open a session sheet that words the same estimate', async () => {
    const user = userEvent.setup()
    mockApi(routes(estimated()))
    renderPlan()
    await user.click(await screen.findByRole('button', { name: /Steady long run/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Steady long run' })
    expect(await within(sheet).findByText('about 16 km at your easy pace')).toBeInTheDocument()
  })

  test('read a plan answer without the field as no estimate', async () => {
    const plan = estimated()
    const stale = {
      ...plan,
      weeks: plan.weeks.map((week) => {
        const { distanceEstimateM: _dropped, ...older } = week
        return older
      }),
      sessions: plan.sessions.map((session) => {
        const { distanceEstimate: _dropped, ...older } = session
        return older
      }),
    } as unknown as PlanWithSessions
    mockApi(routes(stale))
    renderPlan()
    const long = await screen.findByRole('button', { name: /Steady long run/ })
    await vi.waitFor(() => {
      expect(long).toHaveTextContent('55 min, 9.00 km, Planned')
    })
  })
})

describe('Plan page: the week row', () => {
  test('says what the week’s runs come to, under the target', async () => {
    const user = userEvent.setup()
    mockApi(routes(estimated()))
    renderPlan()
    await screen.findByText('Week focus 1')
    const target = row('2027-01-11').querySelector<HTMLElement>('[data-cell="target"]')!
    expect(within(target).getByText('5.0 h')).toBeInTheDocument()
    expect(await within(target).findByText('about 25 km')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Earlier weeks (1)' }))
    const first = row('2027-01-04').querySelector<HTMLElement>('[data-cell="target"]')!
    expect(within(first).getByText('about 6 km')).toBeInTheDocument()
  })

  test('follows the runner’s units', async () => {
    mockApi(routes(estimated(), 'mi'))
    renderPlan()
    await screen.findByText('Week focus 1')
    const target = row('2027-01-11').querySelector<HTMLElement>('[data-cell="target"]')!
    expect(await within(target).findByText('about 16 mi')).toBeInTheDocument()
  })

  test('says nothing for a week the server had no figure for', async () => {
    mockApi(routes(estimated()))
    renderPlan()
    await screen.findByText('Week focus 1')
    // The week before it has a figure, so the units have loaded when that one shows.
    expect(await within(row('2027-01-11')).findByText('about 25 km')).toBeInTheDocument()
    const target = row('2027-01-18').querySelector<HTMLElement>('[data-cell="target"]')!
    expect(within(target).queryByText(/about/)).not.toBeInTheDocument()
  })

  test('keeps the minutes as the target: the estimate is not a second target and is never graded', async () => {
    mockApi(routes(estimated()))
    const { container } = renderPlan()
    await screen.findByText('Week focus 1')
    const target = row('2027-01-11').querySelector<HTMLElement>('[data-cell="target"]')!
    await within(target).findByText('about 25 km')
    // The minutes lead and the estimate follows them, with no second target beside them.
    const spans = [...target.querySelectorAll('span')].map((span) => span.textContent ?? '')
    expect(spans).toHaveLength(2)
    expect(spans[0]).toMatch(/^5\.0\sh$/)
    expect(spans[1]).toBe('about 25 km')
    expect(row('2027-01-11').querySelector<HTMLElement>('[data-cell="actual"]')!.textContent).toBe(
      '',
    )
    expectCleanCopy(container)
  })
})
