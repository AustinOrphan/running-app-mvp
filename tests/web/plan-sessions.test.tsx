import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Goal, PlanWithSessions, PlanWithWeeks, WeekRow } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { PlanPage } from '../../web/pages/PlanPage.tsx'
import { makeActivity } from '../factories.ts'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import { makeRevision, makeSession, makeV1Plan, makeV2Plan, settings } from './plan-fixtures.ts'

vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, open }: { rules: string[]; open: boolean }) =>
    open ? (
      <div role="complementary" aria-label="Why drawer">
        {rules.join(',')}
      </div>
    ) : null,
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

function routes(plan: PlanWithSessions | PlanWithWeeks | null, extra: MockRoutes = {}): MockRoutes {
  return {
    'GET /api/plan': () => plan,
    'GET /api/goals': () => [goal],
    'GET /api/settings': () => settings,
    'GET /api/weeks': () => [] as WeekRow[],
    'GET /api/plan/revisions': () => [makeRevision()],
    'GET /api/activities': () => [],
    ...extra,
  }
}

function renderPlan() {
  renderWithProviders(
    <ToastProvider>
      <PlanPage />
    </ToastProvider>,
  )
}

describe('Plan page, version-2 plans', () => {
  test('shows feasibility with its notes, warnings, and the plan checks', async () => {
    mockApi(routes(makeV2Plan()))
    renderPlan()
    const feasibility = await screen.findByRole('region', { name: 'Feasibility' })
    expect(within(feasibility).getByText('Tight')).toBeInTheDocument()
    expect(within(feasibility).getByText(/14 weeks needed, 12 available/)).toBeInTheDocument()
    expect(within(feasibility).getByText('Two fewer weeks than usual.')).toBeInTheDocument()

    const warnings = screen.getByRole('region', { name: 'Warnings' })
    expect(
      within(warnings).getByText('Week of 18 Jan held at the weekly ramp limit.'),
    ).toBeInTheDocument()
    expect(within(warnings).getByText('Caution')).toBeInTheDocument()

    const checks = screen.getByRole('region', { name: 'Plan checks' })
    expect(within(checks).getByText('1 of 2 checks pass')).toBeInTheDocument()
    expect(within(checks).getByText('Every week is within the ramp limit.')).toBeInTheDocument()
    expect(within(checks).getByText('Taper is one week long.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/behind|missed|streak/i)
  })

  test('a not-reachable plan says so in the spec wording', async () => {
    mockApi(
      routes(
        makeV2Plan({
          feasibility: { label: 'not-reachable', weeksNeeded: 30, weeksAvailable: 8, notes: [] },
        }),
      ),
    )
    renderPlan()
    expect(await screen.findByText('Not reachable within default limits')).toBeInTheDocument()
  })

  test('why buttons open the drawer with the rules of that warning', async () => {
    const user = userEvent.setup()
    mockApi(routes(makeV2Plan()))
    renderPlan()
    const warnings = await screen.findByRole('region', { name: 'Warnings' })
    await user.click(within(warnings).getByRole('button', { name: 'Why this warning' }))
    expect(await screen.findByLabelText('Why drawer')).toHaveTextContent('g-3')
  })

  test('What changed lists revisions with their summary and changes', async () => {
    mockApi(routes(makeV2Plan()))
    renderPlan()
    const changed = await screen.findByRole('region', { name: 'What changed' })
    expect(
      await within(changed).findByText('Held week 3 after an easier-than-expected long run.'),
    ).toBeInTheDocument()
    expect(within(changed).getByText('Weekly update')).toBeInTheDocument()
    expect(
      within(changed).getByText(/Week of 18 Jan: Weekly running time 330 min to 300 min/),
    ).toBeInTheDocument()
  })

  test('the current week opens to its day cards; other weeks open on request', async () => {
    const user = userEvent.setup()
    mockApi(routes(makeV2Plan()))
    renderPlan()
    await screen.findByText('Week focus 0')
    expect(screen.getByRole('button', { name: /Steady long run/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hill strides/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Easy run/ })).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Days for week of 4 Jan' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Easy run/ })).toBeInTheDocument()
    await user.click(toggle)
    expect(screen.queryByRole('button', { name: /Easy run/ })).not.toBeInTheDocument()
  })

  test('a day card summarises the session and opens the session sheet', async () => {
    const user = userEvent.setup()
    mockApi(routes(makeV2Plan()))
    renderPlan()
    const card = await screen.findByRole('button', { name: /Steady long run/ })
    expect(screen.getByText('Tue 12 Jan')).toBeInTheDocument()
    expect(card).toHaveTextContent('55 min')
    await waitFor(() => {
      expect(card).toHaveTextContent('9.00 km')
    })
    expect(card).toHaveTextContent('Planned')
    await user.click(card)
    expect(await screen.findByRole('dialog', { name: 'Steady long run' })).toBeInTheDocument()
  })

  test('the session sheet follows the plan data after an update', async () => {
    const user = userEvent.setup()
    let plan = makeV2Plan()
    mockApi(
      routes(plan, {
        'GET /api/plan': () => plan,
        'POST /api/plan/sessions/b/link': () => {
          plan = makeV2Plan({
            sessions: plan.sessions.map((s) =>
              s.id === 'b'
                ? { ...s, activityId: 'act9', linkSource: 'owner', status: 'completed' }
                : s,
            ),
          })
          return plan.sessions[1]
        },
        'GET /api/activities': () => [
          makeActivity({ id: 'act9', date: '2027-01-12', durationSec: 3300, distanceM: 9000 }),
        ],
      }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: /Steady long run/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Steady long run' })
    await user.selectOptions(await within(dialog).findByLabelText('Link an activity'), 'act9')
    await user.click(within(dialog).getByRole('button', { name: 'Link' }))
    expect(await within(dialog).findByRole('button', { name: 'Unlink' })).toBeInTheDocument()
    expect(await within(dialog).findByText(/Linked by you/)).toBeInTheDocument()
  })

  test('the sheet closes when its session leaves the plan', async () => {
    const user = userEvent.setup()
    let current = makeV2Plan()
    mockApi(
      routes(current, {
        'GET /api/plan': () => current,
        'POST /api/plan/replan': () => makeRevision(),
      }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: /Hill strides/ }))
    await screen.findByRole('dialog', { name: 'Hill strides' })
    current = makeV2Plan({
      sessions: [makeSession({ id: 'z', weekStart: '2027-01-11', date: '2027-01-15' })],
    })
    await user.click(screen.getByRole('button', { name: 'Update plan from latest data' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Hill strides/ })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog', { name: 'Hill strides' })).not.toBeInTheDocument()
  })

  test('Update plan posts a re-plan and confirms with a toast', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(makeV2Plan(), { 'POST /api/plan/replan': () => makeRevision() }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: 'Update plan from latest data' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/plan/replan')).toBe(true)
    })
    expect(await screen.findByText('Plan updated')).toBeInTheDocument()
  })
})

describe('Plan page, version-1 plans', () => {
  test('stay as before: no feasibility, no checks, no day cards, no revisions request', async () => {
    const { calls } = mockApi(routes(makeV1Plan()))
    renderPlan()
    await screen.findByText('Week focus 0')
    expect(screen.queryByRole('region', { name: 'Feasibility' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Plan checks' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Days for week/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Update plan from latest data' }),
    ).not.toBeInTheDocument()
    expect(calls.some((c) => c.url.startsWith('/api/plan/revisions'))).toBe(false)
  })
})
