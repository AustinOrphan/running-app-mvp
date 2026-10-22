import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, weekStartsBetween } from '../../shared/dates.ts'
import type {
  Activity,
  PlanWeek,
  PlanWithWeeks,
  WeekRow,
  WeeklyReview,
} from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ReviewPage } from '../../web/pages/ReviewPage.tsx'
import { makeActivity, makeWeekRow } from '../factories.ts'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'

// Wednesday 21 Oct 2026: the current week starts 19 Oct, the last finished week 12 Oct.
const W = '2026-10-12'
const CURRENT = '2026-10-19'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

function planWeek(weekStart: string, over: Partial<PlanWeek> = {}): PlanWeek {
  return {
    id: `pw-${weekStart}`,
    planId: 'p1',
    weekStart,
    index: 1,
    phase: 'base2',
    focus: null,
    baselineRunMin: 300,
    targetRunMin: 300,
    targetSource: 'baseline',
    longRunMin: 90,
    day2Min: null,
    runDays: 4,
    strengthSessions: 2,
    overrideNote: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

function makePlan(weeks: PlanWeek[]): PlanWithWeeks {
  return {
    id: 'p1',
    userId: 'u1',
    goalId: 'g1',
    name: 'Autumn build',
    startDate: '2026-10-05',
    raceWeekStart: '2027-01-04',
    status: 'active',
    generatorVersion: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    weeks,
  }
}

function makeReview(weekStart: string, over: Partial<WeeklyReview> = {}): WeeklyReview {
  return {
    id: '',
    userId: 'u1',
    weekStart,
    dataStatus: 'unconfirmed',
    fatigue: null,
    symptoms: null,
    recoveryConstrained: false,
    suggestedAction: null,
    suggestedReason: null,
    suggestedNextMin: null,
    finalDecision: null,
    finalNextMin: null,
    notes: null,
    reviewedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

interface Fixture {
  plan?: PlanWithWeeks | null
  reviews?: Record<string, Partial<WeeklyReview>>
  weeks?: Record<string, Partial<WeekRow>>
  activities?: Activity[]
  /** Mark every week as reviewed. */
  allReviewed?: boolean
}

const defaultPlan = (): PlanWithWeeks =>
  makePlan([planWeek(W), planWeek(CURRENT, { baselineRunMin: 400, targetRunMin: 400, index: 2 })])

function routes(fixture: Fixture = {}): MockRoutes {
  const plan = fixture.plan === undefined ? defaultPlan() : fixture.plan
  return {
    'GET /api/plan': () => plan,
    'GET /api/reviews': ({ query }) =>
      weekStartsBetween(query.get('from') ?? '', query.get('to') ?? '').map((weekStart) =>
        makeReview(weekStart, {
          ...(fixture.allReviewed === true
            ? { reviewedAt: '2026-10-20T00:00:00.000Z', finalDecision: 'hold', finalNextMin: 300 }
            : {}),
          ...fixture.reviews?.[weekStart],
        }),
      ),
    'GET /api/weeks': ({ query }) =>
      weekStartsBetween(query.get('from') ?? '', query.get('to') ?? '').map((weekStart) =>
        makeWeekRow({ weekStart, ...fixture.weeks?.[weekStart] }),
      ),
    'GET /api/activities': () => fixture.activities ?? [],
  }
}

const fullWeek: Partial<WeekRow> = {
  runMin: 300,
  runM: 40000,
  runSessions: 4,
  runDays: 4,
  strengthSessions: 2,
  longestRunMin: 90,
  longRunShare: 0.3,
}

function renderReview(fixture: Fixture = {}, extra: MockRoutes = {}) {
  const api = mockApi({ ...routes(fixture), ...extra })
  renderWithProviders(
    <ToastProvider>
      <ReviewPage />
    </ToastProvider>,
  )
  return api
}

async function ready(label = 'Week of 12 Oct') {
  await screen.findByText(label)
}

describe('ReviewPage', () => {
  test('default week is the latest finished week without reviewedAt, else the latest finished week', async () => {
    renderReview({
      reviews: { [W]: { reviewedAt: '2026-10-20T00:00:00.000Z', finalDecision: 'hold' } },
    })
    expect(await screen.findByRole('heading', { name: 'Review' })).toBeInTheDocument()
    expect(await screen.findByText('Week of 5 Oct')).toBeInTheDocument()
  })

  test('falls back to the latest finished week when every week is reviewed', async () => {
    renderReview({ allReviewed: true })
    expect(await screen.findByText('Week of 12 Oct')).toBeInTheDocument()
  })

  test('shows the week summary: run time against target with Meter, run days against target, longest run share, strength sessions', async () => {
    renderReview({ weeks: { [W]: fullWeek } })
    await ready()
    expect(screen.getByRole('meter', { name: 'Run time' })).toHaveAttribute('aria-valuenow', '300')
    expect(screen.getByText('4 of 4 run days')).toBeInTheDocument()
    expect(screen.getByText('Longest run is 30% of the week')).toBeInTheDocument()
    expect(screen.getByText('2 of 2 strength sessions')).toBeInTheDocument()
  })

  test('the suggestion updates live from the form using suggestAction: fatigue 8 -> Reduce with 70% next minutes; fatigue 4 + symptoms None + 300 of 300 min -> Progress 330', async () => {
    const user = userEvent.setup()
    renderReview({ weeks: { [W]: fullWeek } })
    await ready()
    const region = screen.getByRole('region', { name: 'Suggested action' })
    expect(within(region).getByText('Waiting for data')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Data complete' }))
    await user.click(screen.getByRole('radio', { name: '8' }))
    await user.click(screen.getByRole('radio', { name: 'None' }))
    expect(within(region).getByText('Reduce')).toBeInTheDocument()
    expect(
      within(region).getByText('Fatigue, symptoms or recovery point to a lighter next week.'),
    ).toBeInTheDocument()
    expect(within(region).getByText('Suggested next week: 210 min (3.5 h)')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: '4' }))
    expect(within(region).getByText('Progress')).toBeInTheDocument()
    expect(within(region).getByText('Suggested next week: 330 min (5.5 h)')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Recovery is constrained' }))
    expect(within(region).getByText('Reduce')).toBeInTheDocument()
  })

  test('final decision defaults to the suggested action and Next week minutes to the suggested minutes; both stay editable', async () => {
    const user = userEvent.setup()
    renderReview({ weeks: { [W]: fullWeek } })
    await ready()
    await user.click(screen.getByRole('radio', { name: 'Data complete' }))
    await user.click(screen.getByRole('radio', { name: '4' }))
    await user.click(screen.getByRole('radio', { name: 'None' }))

    const decision = screen.getByRole('radiogroup', { name: 'Final decision' })
    expect(within(decision).getByRole('radio', { name: 'Progress' })).toBeChecked()
    expect(screen.getByLabelText('Next week minutes')).toHaveValue('330')

    await user.click(within(decision).getByRole('radio', { name: 'Hold' }))
    await user.clear(screen.getByLabelText('Next week minutes'))
    await user.type(screen.getByLabelText('Next week minutes'), '300')
    expect(within(decision).getByRole('radio', { name: 'Hold' })).toBeChecked()
    expect(screen.getByLabelText('Next week minutes')).toHaveValue('300')

    // A later change to the form no longer overrides what was chosen.
    await user.click(screen.getByRole('radio', { name: '9' }))
    expect(within(decision).getByRole('radio', { name: 'Hold' })).toBeChecked()
    expect(screen.getByLabelText('Next week minutes')).toHaveValue('300')
  })

  test('choosing another Final decision prefills the minutes for that decision, and the number stays editable', async () => {
    const user = userEvent.setup()
    const api = renderReview(
      { weeks: { [W]: fullWeek } },
      { [`PUT /api/reviews/${W}`]: () => makeReview(W, { id: 'r1', dataStatus: 'complete' }) },
    )
    await ready()
    await user.click(screen.getByRole('radio', { name: 'Data complete' }))
    await user.click(screen.getByRole('radio', { name: '4' }))
    await user.click(screen.getByRole('radio', { name: 'None' }))
    const minutes = screen.getByLabelText('Next week minutes')
    expect(minutes).toHaveValue('330')

    const decision = screen.getByRole('radiogroup', { name: 'Final decision' })
    await user.click(within(decision).getByRole('radio', { name: 'Reduce' }))
    expect(minutes).toHaveValue('210')
    await user.click(within(decision).getByRole('radio', { name: 'Hold' }))
    expect(minutes).toHaveValue('300')
    await user.click(within(decision).getByRole('radio', { name: 'Reduce' }))
    expect(minutes).toHaveValue('210')

    await user.clear(minutes)
    await user.type(minutes, '200')
    await user.click(screen.getByRole('button', { name: 'Save review' }))
    await screen.findByText('Week of 12 Oct saved')
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      finalDecision: 'reduce',
      finalNextMin: 200,
    })
    // The suggestion itself still reads Progress.
    expect(
      within(screen.getByRole('region', { name: 'Suggested action' })).getByText(
        'Suggested next week: 330 min (5.5 h)',
      ),
    ).toBeInTheDocument()
  })

  test('Save review PUTs { dataStatus: "complete", fatigue: 4, symptoms: "none", recoveryConstrained: false, finalDecision: "progress", finalNextMin: 330, notes } and toasts "Week of 12 Oct saved"', async () => {
    const user = userEvent.setup()
    const api = renderReview(
      { weeks: { [W]: fullWeek } },
      {
        [`PUT /api/reviews/${W}`]: () => makeReview(W, { id: 'r1', dataStatus: 'complete' }),
      },
    )
    await ready()
    await user.click(screen.getByRole('radio', { name: 'Data complete' }))
    await user.click(screen.getByRole('radio', { name: '4' }))
    await user.click(screen.getByRole('radio', { name: 'None' }))
    await user.type(screen.getByLabelText('Notes'), 'Legs felt fine.')
    await user.click(screen.getByRole('button', { name: 'Save review' }))

    expect(await screen.findByText('Week of 12 Oct saved')).toBeInTheDocument()
    const put = api.calls.find((c) => c.method === 'PUT')
    expect(put?.url).toBe(`/api/reviews/${W}`)
    expect(put?.body).toEqual({
      dataStatus: 'complete',
      fatigue: 4,
      symptoms: 'none',
      recoveryConstrained: false,
      finalDecision: 'progress',
      finalNextMin: 330,
      notes: 'Legs felt fine.',
    })
  })

  test('a server validation error stays in the form and nothing is toasted', async () => {
    const user = userEvent.setup()
    renderReview(
      { weeks: { [W]: fullWeek } },
      {
        [`PUT /api/reviews/${W}`]: () => ({
          status: 400,
          body: {
            error: {
              code: 'validation',
              message: 'Invalid request.',
              details: { issues: [{ path: 'notes', message: 'Use at most 2000 characters.' }] },
            },
          },
        }),
      },
    )
    await ready()
    await user.click(screen.getByRole('button', { name: 'Save review' }))
    expect(await screen.findByText('Use at most 2000 characters.')).toBeInTheDocument()
    expect(screen.queryByText('Week of 12 Oct saved')).not.toBeInTheDocument()
  })

  test('a validation issue without an inline field is stated in the alert', async () => {
    const user = userEvent.setup()
    renderReview(
      { weeks: { [W]: fullWeek } },
      {
        [`PUT /api/reviews/${W}`]: () => ({
          status: 400,
          body: {
            error: {
              code: 'validation',
              message: 'A decision can be recorded once the week has finished.',
              details: { issues: [{ path: 'finalDecision', message: 'Week not finished.' }] },
            },
          },
        }),
      },
    )
    await ready()
    await user.click(screen.getByRole('button', { name: 'Save review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Review not saved. Week not finished.',
    )
  })

  test('a current or upcoming week shows its reason, disables Final decision and says it becomes available once the week is finished', async () => {
    const user = userEvent.setup()
    renderReview({ weeks: { [CURRENT]: { runMin: 120, runDays: 2 } } })
    await ready()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText('Week of 19 Oct')

    const region = screen.getByRole('region', { name: 'Suggested action' })
    expect(within(region).getByText('This week is in progress.')).toBeInTheDocument()
    const decision = screen.getByRole('radiogroup', { name: 'Final decision' })
    for (const radio of within(decision).getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByLabelText('Next week minutes')).toBeDisabled()
    expect(
      screen.getByText('Final decision becomes available once the week is finished.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled()
  })

  test('saving an unfinished week sends no decision', async () => {
    const user = userEvent.setup()
    const api = renderReview(
      {},
      { [`PUT /api/reviews/${CURRENT}`]: () => makeReview(CURRENT, { id: 'r2' }) },
    )
    await ready()
    await user.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText('Week of 19 Oct')
    await user.click(screen.getByRole('radio', { name: '3' }))
    await user.click(screen.getByRole('button', { name: 'Save review' }))
    await screen.findByText('Week of 19 Oct saved')
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
      dataStatus: 'unconfirmed',
      fatigue: 3,
      symptoms: null,
      recoveryConstrained: false,
      notes: null,
    })
  })

  test('possible duplicates in the week show review_duplicates guidance with a link to /activities?duplicates=1', async () => {
    const user = userEvent.setup()
    renderReview({
      weeks: { [W]: fullWeek },
      activities: [
        makeActivity({ date: '2026-10-14', source: 'manual', duplicateStatus: 'possible' }),
        makeActivity({ date: '2026-10-14', source: 'smashrun' }),
      ],
    })
    await ready()
    await user.click(screen.getByRole('radio', { name: 'Data complete' }))
    const region = screen.getByRole('region', { name: 'Suggested action' })
    expect(
      within(region).getByText('Resolve the possible duplicate runs before deciding.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review possible duplicates' })).toHaveAttribute(
      'href',
      '/activities?duplicates=1',
    )
  })

  test('a duplicate outside the selected week does not trigger the guidance', async () => {
    renderReview({
      weeks: { [W]: fullWeek },
      activities: [makeActivity({ date: '2026-10-05', duplicateStatus: 'possible' })],
    })
    await ready()
    expect(screen.queryByRole('link', { name: 'Review possible duplicates' })).toBeNull()
  })

  test('a week outside the plan says there is no plan for it and offers no suggestion', async () => {
    const user = userEvent.setup()
    renderReview({ weeks: { [W]: fullWeek } })
    await ready()
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    await screen.findByText('Week of 5 Oct')
    expect(screen.getByText('There is no plan for this week.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Suggested action' })).toBeNull()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  test('the subtitle explains a week before the plan starts', async () => {
    const user = userEvent.setup()
    renderReview({ weeks: { [W]: fullWeek } })
    await ready()
    expect(screen.getByText('Base 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    await screen.findByText('Week of 5 Oct')
    expect(
      screen.getByText("Before the plan starts. Suggestions begin with the plan's first week."),
    ).toBeInTheDocument()
    expect(screen.queryByText('Not in the plan')).toBeNull()
  })

  test('with no plan at all the subtitle says suggestions appear once a plan exists', async () => {
    renderReview({ plan: null, weeks: { [W]: fullWeek } })
    await ready()
    expect(
      screen.getByText('No plan yet. Suggestions appear once a plan exists.'),
    ).toBeInTheDocument()
  })

  test('empty states: no plan and no runs shows "Nothing to review. Last week is closed." and the no-plan message, never NaN', async () => {
    renderReview({ plan: null })
    expect(await screen.findByText('Nothing to review. Last week is closed.')).toBeInTheDocument()
    expect(
      screen.getByText('No plan yet. Choose a goal race, then generate weekly targets.'),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined|null/)
  })

  test('a plan with no runs renders the week without NaN', async () => {
    renderReview()
    await ready()
    expect(screen.getByText('0 of 4 run days')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined|null/)
  })

  test('history lists reviewed weeks with decision and next minutes', async () => {
    renderReview({
      reviews: {
        '2026-10-05': {
          reviewedAt: '2026-10-12T00:00:00.000Z',
          finalDecision: 'progress',
          finalNextMin: 330,
        },
        [W]: {
          reviewedAt: '2026-10-20T00:00:00.000Z',
          finalDecision: 'hold',
          finalNextMin: 300,
        },
        '2026-09-28': { finalDecision: 'reduce', finalNextMin: 100 },
      },
    })
    const heading = await screen.findByRole('heading', { name: 'Reviewed weeks' })
    const list = within(heading.parentElement as HTMLElement).getByRole('list')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('12 Oct')
    expect(items[0]).toHaveTextContent('Hold')
    expect(items[0]).toHaveTextContent('300 min next week')
    expect(items[1]).toHaveTextContent('5 Oct')
    expect(items[1]).toHaveTextContent('Progress')
    expect(items[1]).toHaveTextContent('330 min next week')
  })

  test('the week picker spans the 12 finished weeks and the current one', async () => {
    const user = userEvent.setup()
    const api = renderReview({ allReviewed: true })
    await ready()
    const reviewsCall = api.calls.find((c) => c.url.startsWith('/api/reviews'))
    expect(reviewsCall?.url).toBe(`/api/reviews?from=${addDays(CURRENT, -84)}&to=${CURRENT}`)
    for (let i = 0; i < 11; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Previous week' }))
    }
    await waitFor(() => {
      expect(screen.getByText('Week of 27 Jul')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled()
  })
})
