import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { GoalsPage } from '../../web/pages/GoalsPage.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import type {
  ArchivedPlanView,
  Goal,
  PlanWithSessions,
  PredictionView,
  UserSettings,
} from '../../shared/types.ts'
import {
  expectCleanCopy,
  explainOf,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'

// The real drawer is Task E14's; this stand-in shows which rules a Why button passes on.
vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, explain, open }: { rules: string[]; explain?: unknown; open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Evidence" data-explain={JSON.stringify(explain ?? null)}>
        {rules.join(',')}
      </div>
    ) : null,
}))

const miUser: UserSettings = { email: 'runner@example.com', displayName: null, units: 'mi' }
const kmUser: UserSettings = { ...miUser, units: 'km' }

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    userId: 'u1',
    name: 'Spring half',
    priority: 'A',
    status: 'target',
    targetDate: '2027-05-09',
    dateProvisional: false,
    distanceM: 21098,
    location: null,
    successCriteria: null,
    notes: null,
    url: null,
    isActive: false,
    gainM: null,
    lossM: null,
    surface: 'road',
    goalType: 'time',
    targetTimeSec: null,
    startTime: null,
    raceLat: null,
    raceLng: null,
    supportLevel: 'aided',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  }
}

function routes(goals: Goal[], user: UserSettings, extra: MockRoutes = {}): MockRoutes {
  return {
    'GET /api/goals': () => goals,
    'GET /api/settings': () => user,
    'GET /api/plan': () => null,
    'GET /api/plan/archived': () => [],
    'GET /api/predictions': () => ({ prediction: null, log: [] }),
    ...extra,
  }
}

function makePlan(over: Partial<PlanWithSessions> = {}): PlanWithSessions {
  return {
    id: 'p1',
    userId: 'u1',
    goalId: 'g1',
    name: 'Spring half',
    startDate: '2026-10-05',
    raceWeekStart: '2027-05-03',
    status: 'active',
    generatorVersion: 2,
    paramsVersion: '1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    weeks: [],
    sessions: [],
    feasibility: null,
    warnings: [],
    checklist: [],
    zones: null,
    ...over,
  }
}

type User = ReturnType<typeof userEvent.setup>

async function openAddSheet(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Add goal' }))
  return screen.findByRole('dialog', { name: 'Add goal' })
}

async function fillBasics(user: User, dialog: HTMLElement, name: string) {
  await user.type(within(dialog).getByLabelText('Name'), name)
  await user.type(within(dialog).getByLabelText('Race date'), '2027-10-17')
}

describe('Goals page', () => {
  test('empty state "No goals yet." with an Add goal action', async () => {
    mockApi(routes([], miUser))
    renderWithProviders(<GoalsPage />)

    expect(await screen.findByText('No goals yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Goals', level: 1 })).toBeInTheDocument()
    const add = screen.getAllByRole('button', { name: 'Add goal' })
    expect(add).toHaveLength(1)

    await userEvent.setup().click(add[0] as HTMLElement)
    expect(await screen.findByRole('dialog', { name: 'Add goal' })).toBeInTheDocument()
  })

  test('the status and the race details read as one line with no stray full stop', async () => {
    mockApi(routes([makeGoal({ status: 'target' })], miUser))
    renderWithProviders(<GoalsPage />)
    const line = await screen.findByText(/^Target · /)
    expect(line.textContent).not.toMatch(/Target\./)
  })

  test('creating a goal posts metres: Marathon preset -> distanceM 42195; custom 10 mi -> 16093; km user custom 12 -> 12000; the date is not shifted by timezone', async () => {
    const user = userEvent.setup()
    const mi = mockApi(
      routes([], miUser, { 'POST /api/goals': () => ({ status: 201, body: makeGoal() }) }),
    )
    const first = renderWithProviders(<GoalsPage />)

    let dialog = await openAddSheet(user)
    await fillBasics(user, dialog, 'Autumn marathon')
    await user.click(within(dialog).getByRole('button', { name: 'Marathon' }))
    expect(within(dialog).getByRole('button', { name: 'Marathon' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))

    await waitFor(() => {
      expect(mi.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    })
    expect(mi.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      name: 'Autumn marathon',
      priority: 'A',
      status: 'target',
      targetDate: '2027-10-17',
      dateProvisional: false,
      distanceM: 42195,
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    dialog = await openAddSheet(user)
    await fillBasics(user, dialog, 'Hill 10')
    await user.type(within(dialog).getByLabelText('Distance (mi)'), '10')
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))
    await waitFor(() => {
      expect(mi.calls.filter((c) => c.method === 'POST')).toHaveLength(2)
    })
    expect(mi.calls.filter((c) => c.method === 'POST')[1]?.body).toMatchObject({
      distanceM: 16093,
    })
    first.unmount()

    const km = mockApi(
      routes([], kmUser, { 'POST /api/goals': () => ({ status: 201, body: makeGoal() }) }),
    )
    renderWithProviders(<GoalsPage />)
    dialog = await openAddSheet(user)
    await fillBasics(user, dialog, 'River 12')
    await user.type(within(dialog).getByLabelText('Distance (km)'), '12')
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))
    await waitFor(() => {
      expect(km.calls.some((c) => c.method === 'POST')).toBe(true)
    })
    expect(km.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      distanceM: 12000,
      targetDate: '2027-10-17',
    })
  })

  test('invalid link shows the server error under Link; Make active posts /activate and only one badge shows; delete asks for confirmation and surfaces a 409 message', async () => {
    const user = userEvent.setup()
    let goals = [
      makeGoal({ id: 'g1', name: 'Spring half', isActive: true }),
      makeGoal({ id: 'g2', name: 'Autumn marathon', priority: 'B', distanceM: 42195 }),
    ]
    const linkMessage = 'Enter a web address starting with http:// or https://'
    const { calls } = mockApi(
      routes([], miUser, {
        'GET /api/goals': () => goals,
        'PUT /api/goals/g1': () => ({
          status: 400,
          body: {
            error: {
              code: 'validation',
              message: 'Request body is invalid.',
              details: { issues: [{ path: 'url', message: linkMessage }] },
            },
          },
        }),
        'POST /api/goals/g2/activate': () => {
          goals = goals.map((g) => ({ ...g, isActive: g.id === 'g2' }))
          return goals[1]
        },
        'DELETE /api/goals/g2': () => ({
          status: 409,
          body: {
            error: {
              code: 'conflict',
              message: 'This goal has an active plan. Archive the plan first.',
            },
          },
        }),
      }),
    )
    renderWithProviders(<GoalsPage />)

    expect(await screen.findAllByText('Active goal')).toHaveLength(1)
    expect(
      within(screen.getByRole('article', { name: 'Spring half' })).getByText(/Sun 9 May 2027/),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Make active' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Edit Spring half' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' })
    await user.type(within(dialog).getByLabelText('Link'), 'javascript:alert(1)')
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))
    expect(await within(dialog).findByText(linkMessage)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Link')).toHaveAttribute('aria-invalid', 'true')
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    await user.click(screen.getByRole('button', { name: 'Make active' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/goals/g2/activate')).toBe(
        true,
      )
    })
    await waitFor(() => {
      expect(
        within(screen.getByRole('article', { name: 'Autumn marathon' })).getByText('Active goal'),
      ).toBeInTheDocument()
    })
    expect(screen.getAllByText('Active goal')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Delete Autumn marathon' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByText('Delete Autumn marathon?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete goal' }))
    expect(
      await screen.findByText('This goal has an active plan. Archive the plan first.'),
    ).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
  })

  test('renaming a goal with a custom distance keeps the stored metres instead of re-parsing the rounded text', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes([makeGoal({ distanceM: 15000 })], miUser, {
        'PUT /api/goals/g1': () => makeGoal({ distanceM: 15000, name: 'Renamed' }),
      }),
    )
    renderWithProviders(<GoalsPage />)

    await user.click(await screen.findByRole('button', { name: 'Edit Spring half' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' })
    expect(within(dialog).getByLabelText('Distance (mi)')).toHaveValue('9.32')
    await user.clear(within(dialog).getByLabelText('Name'))
    await user.type(within(dialog).getByLabelText('Name'), 'Renamed')
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT')).toBe(true)
    })
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      name: 'Renamed',
      distanceM: 15000,
    })
  })

  test('the form carries the race descriptors and posts them: gain, loss, surface, finish goal, start time, support', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes([], kmUser, { 'POST /api/goals': () => ({ status: 201, body: makeGoal() }) }),
    )
    renderWithProviders(<GoalsPage />)

    const dialog = await openAddSheet(user)
    await fillBasics(user, dialog, 'Mountain 50')
    await user.click(within(dialog).getByRole('button', { name: '50K' }))
    await user.type(within(dialog).getByLabelText('Elevation gain (m)'), '2400')
    await user.type(within(dialog).getByLabelText('Elevation loss (m)'), '2350')
    await user.selectOptions(within(dialog).getByLabelText('Surface'), 'trail')
    await user.click(within(dialog).getByRole('radio', { name: 'Finish' }))
    await user.type(within(dialog).getByLabelText('Start time'), '06:30')
    await user.click(within(dialog).getByRole('radio', { name: 'Self-supported' }))
    await user.type(within(dialog).getByLabelText('Race latitude'), '46.8123')
    await user.type(within(dialog).getByLabelText('Race longitude'), '8.2271')
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true)
    })
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      distanceM: 50000,
      gainM: 2400,
      lossM: 2350,
      surface: 'trail',
      goalType: 'finish',
      targetTimeSec: null,
      startTime: '06:30',
      supportLevel: 'self',
      raceLat: 46.81,
      raceLng: 8.23,
    })
  })

  test('a time goal asks for a target time and posts it in seconds; a distance above 42.2 km defaults to a finish goal', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes([], miUser, { 'POST /api/goals': () => ({ status: 201, body: makeGoal() }) }),
    )
    renderWithProviders(<GoalsPage />)

    const dialog = await openAddSheet(user)
    await fillBasics(user, dialog, 'Autumn half')
    await user.click(within(dialog).getByRole('button', { name: 'Half' }))
    expect(within(dialog).getByRole('radio', { name: 'Time' })).toBeChecked()
    await user.type(within(dialog).getByLabelText('Target time (h:mm:ss)'), '1:45:30')
    await user.click(within(dialog).getByRole('button', { name: '100K' }))
    expect(within(dialog).getByRole('radio', { name: 'Finish' })).toBeChecked()
    expect(within(dialog).queryByLabelText('Target time (h:mm:ss)')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Half' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Time' }))
    await user.type(within(dialog).getByLabelText('Target time (h:mm:ss)'), 'abc')
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))
    expect(await within(dialog).findByText('Enter a time like 1:45:30.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    await user.clear(within(dialog).getByLabelText('Target time (h:mm:ss)'))
    await user.type(within(dialog).getByLabelText('Target time (h:mm:ss)'), '1:45:30')
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true)
    })
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      goalType: 'time',
      targetTimeSec: 6330,
    })
  })

  test('a time goal the runner chose needs a target; one that only follows the distance posts without a type', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes([], miUser, { 'POST /api/goals': () => ({ status: 201, body: makeGoal() }) }),
    )
    renderWithProviders(<GoalsPage />)

    const dialog = await openAddSheet(user)
    await fillBasics(user, dialog, 'Autumn half')
    await user.click(within(dialog).getByRole('button', { name: 'Half' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Time' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save goal' }))
    expect(
      await within(dialog).findByText('Enter a target time like 1:45:30, or choose a finish goal.'),
    ).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  test('editing shows the stored descriptors', async () => {
    const user = userEvent.setup()
    mockApi(
      routes(
        [
          makeGoal({
            gainM: 800,
            lossM: 790,
            surface: 'mixed',
            goalType: 'time',
            targetTimeSec: 7200,
            startTime: '08:00',
            supportLevel: 'self',
          }),
        ],
        miUser,
      ),
    )
    renderWithProviders(<GoalsPage />)
    await user.click(await screen.findByRole('button', { name: 'Edit Spring half' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit goal' })
    expect(within(dialog).getByLabelText('Elevation gain (m)')).toHaveValue('800')
    expect(within(dialog).getByLabelText('Elevation loss (m)')).toHaveValue('790')
    expect(within(dialog).getByLabelText('Surface')).toHaveValue('mixed')
    expect(within(dialog).getByLabelText('Target time (h:mm:ss)')).toHaveValue('2:00:00')
    expect(within(dialog).getByLabelText('Start time')).toHaveValue('08:00')
    expect(within(dialog).getByRole('radio', { name: 'Self-supported' })).toBeChecked()
  })

  test('the active goal shows its feasibility label, prediction range and method, and race-day heat, each with a Why button', async () => {
    const user = userEvent.setup()
    const prediction: PredictionView = {
      prediction: {
        method: 'Critical speed with a half-marathon anchor',
        predictedSec: 6300,
        lowSec: 6000,
        highSec: 6700,
        conditions: ['Race-day WBGT 21.0 C adds 2.1% to the time.', 'No gain counted.'],
        rules: ['L1', 'L2'],
      },
      log: [],
    }
    mockApi(
      routes([makeGoal({ isActive: true })], miUser, {
        'GET /api/plan': () =>
          makePlan({
            feasibility: {
              label: 'tight',
              weeksNeeded: 18,
              weeksAvailable: 16,
              notes: [
                {
                  code: 'heat-acclimation',
                  severity: 'info',
                  message:
                    'Race-day WBGT is 21.0 C, so the plan includes a heat acclimation block.',
                  rules: ['D6'],
                },
              ],
            },
          }),
        'GET /api/predictions': () => prediction,
      }),
    )
    renderWithProviders(<GoalsPage />)

    const card = await screen.findByRole('article', { name: 'Spring half' })
    expect(await within(card).findByText('Tight')).toBeInTheDocument()
    expect(within(card).getByText(/18 weeks needed, 16 available/)).toBeInTheDocument()
    expect(within(card).getByText('1:45:00')).toBeInTheDocument()
    expect(within(card).getByText('1:40:00 to 1:51:40')).toBeInTheDocument()
    expect(within(card).getByText('Critical speed with a half-marathon anchor')).toBeInTheDocument()
    expect(
      within(card).getByText('Race-day WBGT 21.0 C adds 2.1% to the time.'),
    ).toBeInTheDocument()
    expect(within(card).getByText(/heat acclimation block/)).toBeInTheDocument()

    // Each button passes the subject of its figure: the prediction of this goal, or the rules.
    const drawers = () => screen.getAllByRole('dialog', { name: 'Evidence' })
    const drawerWith = (text: string) => {
      const found = drawers().find((d) => d.textContent === text)
      if (found === undefined) throw new Error(`No drawer with ${text}`)
      return found
    }
    await user.click(within(card).getByRole('button', { name: 'Why: predicted time' }))
    expect(await screen.findByRole('dialog', { name: 'Evidence' })).toHaveTextContent('L1,L2')
    expect(explainOf(drawerWith('L1,L2'))).toEqual({ subject: 'prediction', goalId: 'g1' })

    await user.click(within(card).getByRole('button', { name: 'Why: race-day heat' }))
    expect(explainOf(drawerWith('D6'))).toEqual({ subject: 'rules', rules: ['D6'] })

    await user.click(within(card).getByRole('button', { name: 'Why: feasibility' }))
    expect(explainOf(drawerWith('D4'))).toEqual({ subject: 'rules', rules: ['D4'] })
  })

  test('a goal that is not reachable within default limits says so and offers options, with no prediction text when none exists', async () => {
    mockApi(
      routes([makeGoal({ isActive: true })], miUser, {
        'GET /api/plan': () =>
          makePlan({
            feasibility: {
              label: 'not-reachable',
              weeksNeeded: 40,
              weeksAvailable: 12,
              notes: [
                {
                  code: 'not-reachable',
                  severity: 'warn',
                  message:
                    'Within the default limits this goal needs about 40 weeks and 12 are available. The plan keeps every limit; a later race, a shorter distance or a finish-first goal would fit better.',
                  rules: ['D4'],
                },
              ],
            },
          }),
      }),
    )
    renderWithProviders(<GoalsPage />)
    const card = await screen.findByRole('article', { name: 'Spring half' })
    expect(await within(card).findByText('Not reachable within default limits')).toBeInTheDocument()
    // The engine's note carries the options; the page shows it once, without adding its own.
    expect(within(card).getAllByText(/a later race, a shorter distance/)).toHaveLength(1)
    expect(within(card).getByText(/No prediction yet/)).toBeInTheDocument()
  })

  test('a plan for another goal does not lend its feasibility to the active one', async () => {
    mockApi(
      routes([makeGoal({ isActive: true })], miUser, {
        'GET /api/plan': () =>
          makePlan({
            goalId: 'other',
            feasibility: { label: 'tight', weeksNeeded: 1, weeksAvailable: 1, notes: [] },
          }),
      }),
    )
    renderWithProviders(<GoalsPage />)
    const card = await screen.findByRole('article', { name: 'Spring half' })
    expect(await within(card).findByText(/No prediction yet/)).toBeInTheDocument()
    expect(within(card).queryByText('Tight')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------------------
// Make active while a plan follows another goal, and restoring an archived plan (design 5.7)
// ---------------------------------------------------------------------------------------------

function archivedPlan(over: Partial<ArchivedPlanView> = {}): ArchivedPlanView {
  return {
    id: 'p2',
    goalId: 'g2',
    goalName: 'Autumn 10K',
    raceWeekStart: '2026-12-28',
    archivedAt: '2026-10-22T12:00:00.000Z',
    restorable: true,
    reason: null,
    ...over,
  }
}

const mustReplace = {
  status: 409,
  body: {
    error: {
      code: 'conflict',
      message: 'The plan follows Spring half. Making Autumn 10K active builds a new plan for it.',
      details: { requires: 'replacePlan', planGoalId: 'g1', planGoalName: 'Spring half' },
    },
  },
}

function renderWithToasts() {
  return renderWithProviders(
    <ToastProvider>
      <GoalsPage />
    </ToastProvider>,
  )
}

/** The question that "Make active" opens, found by its text. */
const confirmText = () =>
  screen.findByText(/^The plan follows Spring half\. Making Autumn 10K active builds a new plan/)

describe('Make active while a plan follows another goal', () => {
  function twoGoals(extra: MockRoutes = {}) {
    let goals = [
      makeGoal({ id: 'g1', name: 'Spring half', isActive: true }),
      makeGoal({ id: 'g2', name: 'Autumn 10K', priority: 'B', distanceM: 10_000 }),
    ]
    const mock = mockApi(
      routes([], miUser, {
        'GET /api/goals': () => goals,
        'GET /api/plan': () => makePlan({ goalId: 'g1' }),
        'POST /api/goals/g2/activate': ({ body }) => {
          if ((body as { replacePlan?: boolean } | undefined)?.replacePlan !== true) {
            return mustReplace
          }
          goals = goals.map((g) => ({ ...g, isActive: g.id === 'g2' }))
          return goals[1]
        },
        ...extra,
      }),
    )
    return mock
  }

  test('opens a question with focus on its text; Cancel and Escape close it and return focus', async () => {
    const user = userEvent.setup()
    const { calls } = twoGoals()
    renderWithToasts()

    await user.click(await screen.findByRole('button', { name: 'Make active' }))
    const text = await confirmText()
    expect(text).toHaveTextContent(
      'The plan follows Spring half. Making Autumn 10K active builds a new plan for it. The current plan is archived, not deleted, and targets you set by hand do not carry over.',
    )
    expect(text).toHaveFocus()
    // The group is named by the text, and the 409 that opened it is not shown as an error.
    expect(
      screen.getByRole('group', { name: /^The plan follows Spring half\./ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make active' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build plan for Autumn 10K' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/The plan follows Spring half/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make active' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Make active' }))
    expect(await confirmText()).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByText(/The plan follows Spring half/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make active' })).toHaveFocus()

    // Closing the question built nothing.
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts.map((c) => c.body)).toEqual([undefined, undefined])
  })

  test('Build plan asks again with replacePlan, then says so and moves focus to the goal', async () => {
    const user = userEvent.setup()
    const { calls } = twoGoals()
    renderWithToasts()

    await user.click(await screen.findByRole('button', { name: 'Make active' }))
    await confirmText()
    await user.click(screen.getByRole('button', { name: 'Build plan for Autumn 10K' }))

    expect(await screen.findByText('Plan built for Autumn 10K.')).toBeInTheDocument()
    expect(screen.queryByText(/The plan follows Spring half/)).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      undefined,
      { replacePlan: true },
    ])
    const card = await screen.findByRole('article', { name: 'Autumn 10K' })
    await waitFor(() => {
      expect(within(card).getByText('Active goal')).toBeInTheDocument()
    })
    expect(within(card).getByRole('heading', { name: 'Autumn 10K' })).toHaveFocus()
    expect(screen.getAllByText('Active goal')).toHaveLength(1)
  })

  test('a plan that cannot be built keeps the question open with the server s words', async () => {
    const user = userEvent.setup()
    twoGoals({
      'POST /api/goals/g2/activate': ({ body }) =>
        (body as { replacePlan?: boolean } | undefined)?.replacePlan === true
          ? {
              status: 400,
              body: {
                error: { code: 'validation', message: 'Add a distance to this goal first.' },
              },
            }
          : mustReplace,
    })
    renderWithToasts()

    await user.click(await screen.findByRole('button', { name: 'Make active' }))
    await confirmText()
    await user.click(screen.getByRole('button', { name: 'Build plan for Autumn 10K' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Add a distance to this goal first.')
    expect(screen.getByText(/The plan follows Spring half/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.queryByText('Plan built for Autumn 10K.')).not.toBeInTheDocument()
    // Cancelling clears the message.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('a goal with no plan to move is made active at once, with no question', async () => {
    const user = userEvent.setup()
    let goals = [makeGoal({ id: 'g2', name: 'Autumn 10K' })]
    const { calls } = mockApi(
      routes([], miUser, {
        'GET /api/goals': () => goals,
        'POST /api/goals/g2/activate': () => {
          goals = goals.map((g) => ({ ...g, isActive: true }))
          return goals[0]
        },
      }),
    )
    renderWithToasts()

    await user.click(await screen.findByRole('button', { name: 'Make active' }))
    expect(await screen.findByText('Active goal')).toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  test('the question and its buttons read cleanly', async () => {
    const user = userEvent.setup()
    twoGoals()
    const { container } = renderWithToasts()
    await user.click(await screen.findByRole('button', { name: 'Make active' }))
    await confirmText()
    expectCleanCopy(container)
  })
})

describe('Restore this plan', () => {
  function withArchive(archived: ArchivedPlanView[], extra: MockRoutes = {}) {
    const goals = [
      makeGoal({ id: 'g1', name: 'Spring half', isActive: false }),
      makeGoal({ id: 'g2', name: 'Autumn 10K', isActive: true, priority: 'B' }),
    ]
    return mockApi(
      routes([], miUser, {
        'GET /api/goals': () => goals,
        'GET /api/plan': () => makePlan({ id: 'p2', goalId: 'g2' }),
        'GET /api/plan/archived': () => archived,
        ...extra,
      }),
    )
  }

  test('notes the archive under the goal it belongs to, in the runner s words', async () => {
    withArchive([archivedPlan({ id: 'p1', goalId: 'g1', goalName: 'Spring half' })])
    const { container } = renderWithToasts()

    const card = await screen.findByRole('article', { name: 'Spring half' })
    expect(
      await within(card).findByText('The plan for Spring half was archived on 22 Oct.'),
    ).toBeInTheDocument()
    expect(
      within(card).getByRole('button', { name: 'Restore this plan' }),
    ).toHaveAccessibleDescription('The plan for Spring half was archived on 22 Oct.')
    // The goal that has the plan now offers nothing to restore.
    const active = screen.getByRole('article', { name: 'Autumn 10K' })
    expect(within(active).queryByRole('button', { name: 'Restore this plan' })).toBeNull()
    expectCleanCopy(container)
  })

  test('offers nothing for a plan that cannot come back, or for a goal that has the plan', async () => {
    withArchive([
      archivedPlan({
        id: 'p1',
        goalId: 'g1',
        restorable: false,
        reason: 'The race date has passed.',
      }),
      archivedPlan({ id: 'p3', goalId: 'g2' }),
    ])
    renderWithToasts()
    await screen.findByRole('article', { name: 'Spring half' })
    await waitFor(() => {
      expect(screen.getByRole('article', { name: 'Autumn 10K' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Restore this plan' })).not.toBeInTheDocument()
    expect(screen.queryByText(/was archived on/)).not.toBeInTheDocument()
  })

  test('restores the plan and says so', async () => {
    const user = userEvent.setup()
    const { calls } = withArchive(
      [archivedPlan({ id: 'p1', goalId: 'g1', goalName: 'Spring half' })],
      {
        'POST /api/plan/archived/p1/restore': () => ({
          planId: 'p1',
          goalId: 'g1',
          replanned: true,
          message: null,
        }),
      },
    )
    renderWithToasts()

    await user.click(await screen.findByRole('button', { name: 'Restore this plan' }))
    expect(await screen.findByText('Plan restored.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Spring half' })).toHaveFocus()
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
      '/api/plan/archived/p1/restore',
    ])
  })

  test('says when the restored plan could not be brought up to date', async () => {
    const user = userEvent.setup()
    withArchive([archivedPlan({ id: 'p1', goalId: 'g1', goalName: 'Spring half' })], {
      'POST /api/plan/archived/p1/restore': () => ({
        planId: 'p1',
        goalId: 'g1',
        replanned: false,
        message: 'The plan did not pass the quality checklist (G-1), so it was not published.',
      }),
    })
    renderWithToasts()

    await user.click(await screen.findByRole('button', { name: 'Restore this plan' }))
    expect(
      await screen.findByText(
        'Plan restored as it was archived. Bringing it up to date did not pass the plan checks.',
      ),
    ).toBeInTheDocument()
  })

  test('shows the server s refusal when the plan can no longer come back', async () => {
    const user = userEvent.setup()
    withArchive([archivedPlan({ id: 'p1', goalId: 'g1', goalName: 'Spring half' })], {
      'POST /api/plan/archived/p1/restore': () => ({
        status: 409,
        body: {
          error: {
            code: 'conflict',
            message: 'The race date has passed, so this plan cannot be restored.',
          },
        },
      }),
    })
    renderWithToasts()

    await user.click(await screen.findByRole('button', { name: 'Restore this plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The race date has passed, so this plan cannot be restored.',
    )
  })
})
