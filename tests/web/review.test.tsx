import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, weekStartsBetween } from '../../shared/dates.ts'
import type { WeeklyDecision } from '../../shared/engine/types.ts'
import type {
  Activity,
  PlanSession,
  PlanWeek,
  PlanWithSessions,
  WeekRow,
  WeeklyReview,
  ZoneProposalView,
} from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ReviewPage } from '../../web/pages/ReviewPage.tsx'
import { makeActivity, makeWeekRow } from '../factories.ts'
import { activityPage, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'

// The real drawer is Task E14's; this stand-in shows which rules a Why button passes on.
vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, open }: { rules: string[]; open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Evidence">
        {rules.join(',')}
      </div>
    ) : null,
}))

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
    tid: null,
    flags: [],
    gainTargetM: null,
    qualitySessions: 0,
    isRecovery: false,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

function makePlan(weeks: PlanWeek[], over: Partial<PlanWithSessions> = {}): PlanWithSessions {
  return {
    id: 'p1',
    userId: 'u1',
    goalId: 'g1',
    name: 'Autumn build',
    startDate: '2026-10-05',
    raceWeekStart: '2027-01-04',
    status: 'active',
    generatorVersion: 1,
    paramsVersion: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    weeks,
    sessions: [],
    feasibility: null,
    warnings: [],
    checklist: [],
    zones: null,
    ...over,
  }
}

function makeSession(over: Partial<PlanSession> = {}): PlanSession {
  return {
    id: 's1',
    externalId: 'ext-s1',
    planId: 'p1',
    weekStart: W,
    date: '2026-10-13',
    order: 0,
    kind: 'easy',
    title: 'Easy run',
    durationMin: 45,
    distanceM: null,
    gainM: null,
    structure: [],
    target: { zone: 'z2', rpe: [3, 4], hr: null, paceSecPerKm: null, heatNote: null },
    purpose: 'Aerobic base.',
    rules: ['e-1'],
    flags: [],
    status: 'planned',
    activityId: null,
    linkSource: null,
    execution: null,
    original: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

function makeProposal(over: Partial<ZoneProposalView> = {}): ZoneProposalView {
  return {
    id: 'zp1',
    boundary: 'thresholdPace',
    from: 330,
    to: 320,
    observations: 3,
    reason: 'The last 3 threshold sessions felt easier than expected.',
    rules: ['C8'],
    ...over,
  }
}

/** A version-2 plan: the server's weekly decision arrives on the review row. */
function v2Plan(sessions: PlanSession[] = []): PlanWithSessions {
  return makePlan(
    [planWeek(W, { tid: { z1: 80, z2: 12, z3: 8 } }), planWeek(CURRENT, { index: 2 })],
    { generatorVersion: 2, paramsVersion: '1', sessions },
  )
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
  plan?: PlanWithSessions | null
  proposals?: ZoneProposalView[]
  reviews?: Record<string, Partial<WeeklyReview>>
  weeks?: Record<string, Partial<WeekRow>>
  activities?: Activity[]
  /** Mark every week as reviewed. */
  allReviewed?: boolean
}

const defaultPlan = (): PlanWithSessions =>
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
    'GET /api/activities': () => activityPage(fixture.activities ?? []),
    'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
    'GET /api/zones/proposals': () => fixture.proposals ?? [],
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
  test('opens on the last finished week even when it was reviewed already', async () => {
    renderReview({
      reviews: { [W]: { reviewedAt: '2026-10-20T00:00:00.000Z', finalDecision: 'hold' } },
    })
    expect(await screen.findByRole('heading', { name: 'Review' })).toBeInTheDocument()
    expect(await screen.findByText('Week of 12 Oct')).toBeInTheDocument()
  })

  test('opens on the last finished week when every week is reviewed', async () => {
    renderReview({ allReviewed: true })
    expect(await screen.findByText('Week of 12 Oct')).toBeInTheDocument()
  })

  test.each([
    ['Monday', '2026-10-19T08:00:00', 'Week of 12 Oct'],
    ['Tuesday', '2026-10-20T08:00:00', 'Week of 12 Oct'],
    ['Wednesday', '2026-10-21T08:00:00', 'Week of 12 Oct'],
    ['Thursday', '2026-10-22T08:00:00', 'Week of 12 Oct'],
    ['Friday', '2026-10-23T08:00:00', 'Week of 12 Oct'],
    ['Saturday', '2026-10-24T23:30:00', 'Week of 12 Oct'],
    ['Sunday', '2026-10-25T23:30:00', 'Week of 12 Oct'],
    ['the next Monday', '2026-10-26T00:30:00', 'Week of 19 Oct'],
  ])('on %s the last finished week is the Monday before this week', async (_day, now, label) => {
    vi.setSystemTime(new Date(now))
    renderReview()
    expect(await screen.findByText(label)).toBeInTheDocument()
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

  describe('version-2 plans', () => {
    const decision: WeeklyDecision = {
      decision: 'hold',
      signals: [
        {
          code: 'completion-low',
          detail: '210 of 300 planned minutes were run (70%). Volume holds.',
          rules: ['J5', 'G-6'],
        },
        {
          code: 'sleep-warning',
          detail: 'Sleep averaged 6.2 h over the last 7 nights.',
          rules: ['J5'],
        },
      ],
      nextWeekTargetMin: 280,
    }
    const decided: Partial<WeeklyReview> & { signals: WeeklyDecision['signals'] } = {
      suggestedAction: 'hold',
      suggestedReason: 'Signals ask for a steady week.',
      suggestedNextMin: decision.nextWeekTargetMin,
      signals: decision.signals,
    }

    test("shows the server's weekly decision with each signal, and the Why button passes the signals' rules", async () => {
      const user = userEvent.setup()
      renderReview({ plan: v2Plan(), weeks: { [W]: fullWeek }, reviews: { [W]: decided } })
      await ready()

      const region = screen.getByRole('region', { name: 'Suggested action' })
      expect(within(region).getByText('Hold')).toBeInTheDocument()
      expect(within(region).getByText('Signals ask for a steady week.')).toBeInTheDocument()
      expect(within(region).getByText('Suggested next week: 280 min (4.7 h)')).toBeInTheDocument()
      const signals = within(region).getByRole('list', { name: 'Signals' })
      expect(within(signals).getAllByRole('listitem')).toHaveLength(2)
      expect(within(signals).getByText(/210 of 300 planned minutes/)).toBeInTheDocument()

      await user.click(within(region).getByRole('button', { name: 'Why: weekly decision' }))
      expect(await screen.findByRole('dialog', { name: 'Evidence' })).toHaveTextContent('J5,G-6')
    })

    test("puts the signals' dates and distances in the reader's words, as the plan page does", async () => {
      const postRace: typeof decided = {
        ...decided,
        signals: [
          {
            code: 'post-race',
            detail: 'After the race: rest, no running until 2027-05-23. Longest run 16 km.',
            rules: ['H12'],
          },
        ],
      }
      renderReview(
        { plan: v2Plan(), weeks: { [W]: fullWeek }, reviews: { [W]: postRace } },
        {
          'GET /api/settings': () => ({
            email: 'runner@example.com',
            displayName: null,
            units: 'mi',
          }),
        },
      )
      await ready()

      const signals = within(screen.getByRole('region', { name: 'Suggested action' })).getByRole(
        'list',
        { name: 'Signals' },
      )
      await waitFor(() => {
        expect(signals).toHaveTextContent(
          'After the race: rest, no running until 23 May. Longest run 9.9 mi.',
        )
      })
      expect(signals.textContent).not.toMatch(/2027-05-23/)
    })

    test('the suggestion does not change live with the form; the final decision defaults to it and has no Repeat', async () => {
      const user = userEvent.setup()
      renderReview({ plan: v2Plan(), weeks: { [W]: fullWeek }, reviews: { [W]: decided } })
      await ready()
      await user.click(screen.getByRole('radio', { name: '9' }))
      const region = screen.getByRole('region', { name: 'Suggested action' })
      expect(within(region).getByText('Hold')).toBeInTheDocument()
      expect(within(region).getByText(/updates when the review is saved/)).toBeInTheDocument()

      const decisionGroup = screen.getByRole('radiogroup', { name: 'Final decision' })
      expect(within(decisionGroup).getByRole('radio', { name: 'Hold' })).toBeChecked()
      expect(within(decisionGroup).queryByRole('radio', { name: 'Repeat' })).not.toBeInTheDocument()
      expect(screen.getByLabelText('Next week minutes')).toHaveValue('280')
    })

    test('saving shows what changed in the plan, with the changes the re-plan made', async () => {
      const user = userEvent.setup()
      renderReview(
        { plan: v2Plan(), weeks: { [W]: fullWeek }, reviews: { [W]: decided } },
        {
          [`PUT /api/reviews/${W}`]: () => ({
            ...makeReview(W, { id: 'r1', dataStatus: 'complete', ...decided }),
            revision: {
              id: 'rev1',
              planId: 'p1',
              createdAt: '2026-10-21T12:00:00.000Z',
              reason: 'review',
              summary:
                "2 changes across 1 week. Last week's decision: hold, next week up to 280 min.",
              changes: [
                { weekStart: CURRENT, field: 'targetRunMin', from: 320, to: 280, rules: ['J5'] },
                { weekStart: CURRENT, field: 'longRunMin', from: 90, to: 80, rules: ['G-6'] },
              ],
            },
          }),
        },
      )
      await ready()
      expect(screen.queryByRole('region', { name: 'What changed' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('radio', { name: 'Data complete' }))
      await user.click(screen.getByRole('button', { name: 'Save review' }))

      const region = await screen.findByRole('region', { name: 'What changed' })
      expect(
        within(region).getByText(
          "2 changes across 1 week. Last week's decision: hold, next week up to 280 min.",
        ),
      ).toBeInTheDocument()
      const changes = within(region).getAllByRole('listitem')
      expect(changes).toHaveLength(2)
      expect(changes[0]).toHaveTextContent('Week of 19 Oct: Weekly running time 320 min to 280 min')
      expect(changes[1]).toHaveTextContent('Week of 19 Oct: Long run 90 min to 80 min')
    })

    test('a re-plan that could not run is said plainly and the review stays saved', async () => {
      const user = userEvent.setup()
      renderReview(
        { plan: v2Plan(), weeks: { [W]: fullWeek }, reviews: { [W]: decided } },
        {
          [`PUT /api/reviews/${W}`]: () => ({
            ...makeReview(W, { id: 'r1', dataStatus: 'complete', ...decided }),
            revision: null,
            replanError: 'The goal date has passed. Move the date or choose another goal.',
          }),
        },
      )
      await ready()
      await user.click(screen.getByRole('radio', { name: 'Data complete' }))
      await user.click(screen.getByRole('button', { name: 'Save review' }))

      expect(await screen.findByText('Week of 12 Oct saved')).toBeInTheDocument()
      const region = await screen.findByRole('region', { name: 'What changed' })
      expect(within(region).getByText(/The plan was not re-planned/)).toBeInTheDocument()
      expect(
        within(region).getByText(/The goal date has passed. Move the date or choose another goal./),
      ).toBeInTheDocument()
    })

    test('a save that did not re-plan shows no What changed section', async () => {
      const user = userEvent.setup()
      renderReview(
        { plan: v2Plan(), weeks: { [W]: fullWeek }, reviews: { [W]: decided } },
        {
          [`PUT /api/reviews/${W}`]: () => ({
            ...makeReview(W, { id: 'r1', dataStatus: 'missing', ...decided }),
            revision: null,
          }),
        },
      )
      await ready()
      await user.click(screen.getByRole('radio', { name: 'Missing data' }))
      await user.click(screen.getByRole('button', { name: 'Save review' }))
      expect(await screen.findByText('Week of 12 Oct saved')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'What changed' })).not.toBeInTheDocument()
    })

    test('with no decision from the server yet, the page says so and still saves', async () => {
      renderReview({ plan: v2Plan(), weeks: { [W]: fullWeek } })
      await ready()
      expect(screen.getByText('The weekly decision is not ready yet.')).toBeInTheDocument()
    })

    test('lists the sessions of the week with what happened, in words that never say missed or behind', async () => {
      const user = userEvent.setup()
      renderReview({
        plan: v2Plan([
          makeSession({
            id: 's1',
            status: 'completed',
            activityId: 'a1',
            execution: {
              completion: 'completed',
              intensity: 'on',
              effort: {
                score: 0,
                confidence: 'moderate',
                parts: { rpeDelta: 0, feel: 3, hrResidualZ: null, paceResidualPct: null },
              },
              conditions: { wbgtC: null, heatAdjusted: false, gradeAdjusted: false },
              flags: [],
              lines: [
                '45 min against 45 planned (100%).',
                'Intensity stayed in the target range.',
                'Effort matched expectation.',
              ],
            },
          }),
          makeSession({
            id: 's2',
            date: '2026-10-15',
            title: 'Threshold intervals',
            status: 'skipped',
          }),
          makeSession({
            id: 's3',
            date: '2026-10-17',
            title: 'Long run',
            status: 'partial',
            execution: {
              completion: 'partial',
              intensity: 'below',
              effort: {
                score: 2,
                confidence: 'low',
                parts: { rpeDelta: 2, feel: null, hrResidualZ: null, paceResidualPct: null },
              },
              conditions: { wbgtC: 24, heatAdjusted: true, gradeAdjusted: false },
              flags: ['heat'],
              lines: [
                '70 min against 100 planned (70%).',
                'Effort felt much harder than expected.',
                'Warm conditions (WBGT about 24 C): the heart-rate expectation was raised and pace was not judged.',
              ],
            },
          }),
          makeSession({ id: 's4', weekStart: CURRENT, date: '2026-10-20', title: 'Later run' }),
        ]),
        weeks: { [W]: fullWeek },
      })
      await ready()

      const section = screen.getByRole('region', { name: 'Planned sessions' })
      const items = within(section).getAllByRole('listitem')
      expect(items).toHaveLength(3)
      expect(within(items[0] as HTMLElement).getByText('Easy run')).toBeInTheDocument()
      expect(within(items[0] as HTMLElement).getByText('Completed')).toBeInTheDocument()
      expect(
        within(items[0] as HTMLElement).getByText('Effort matched expectation.'),
      ).toBeInTheDocument()
      // The engine's lines are the summary; the page adds no second wording of the same facts.
      expect(within(items[0] as HTMLElement).getAllByText(/target range|target zone/)).toHaveLength(
        1,
      )
      expect(within(items[0] as HTMLElement).queryByText(/^Felt /)).not.toBeInTheDocument()
      expect(within(items[1] as HTMLElement).getByText('Skipped')).toBeInTheDocument()
      expect(within(items[2] as HTMLElement).getByText('Partly done')).toBeInTheDocument()
      expect(within(items[2] as HTMLElement).getAllByText(/harder than expected/)).toHaveLength(1)
      expect(within(items[2] as HTMLElement).getByText(/WBGT about 24 C/)).toBeInTheDocument()
      expect(section.textContent).not.toMatch(/missed|behind/i)

      await user.click(
        within(items[0] as HTMLElement).getByRole('button', { name: 'Why: Easy run' }),
      )
      expect(await screen.findByRole('dialog', { name: 'Evidence' })).toHaveTextContent('e-1')
    })

    test('a version-1 plan still uses the live suggestion and has no sessions section', async () => {
      renderReview({ weeks: { [W]: fullWeek } })
      await ready()
      expect(screen.queryByRole('region', { name: 'Planned sessions' })).not.toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Repeat' })).toBeInTheDocument()
    })
  })

  describe('zone proposals', () => {
    test('no proposals, no section', async () => {
      renderReview({ plan: v2Plan(), weeks: { [W]: fullWeek } })
      await ready()
      expect(screen.queryByRole('region', { name: 'Zone proposals' })).not.toBeInTheDocument()
    })

    test('shows the change, its reason and observations; Accept posts and toasts', async () => {
      const user = userEvent.setup()
      let proposals = [makeProposal()]
      const api = renderReview(
        { plan: v2Plan(), weeks: { [W]: fullWeek } },
        {
          'GET /api/zones/proposals': () => proposals,
          'POST /api/zones/proposals/zp1/accept': () => {
            proposals = []
            return {}
          },
        },
      )
      await ready()

      const region = await screen.findByRole('region', { name: 'Zone proposals' })
      expect(within(region).getByText('Threshold pace')).toBeInTheDocument()
      expect(within(region).getByText('5:30 /km to 5:20 /km')).toBeInTheDocument()
      expect(
        within(region).getByText('The last 3 threshold sessions felt easier than expected.'),
      ).toBeInTheDocument()
      expect(within(region).getByText('Based on 3 sessions.')).toBeInTheDocument()

      await user.click(within(region).getByRole('button', { name: 'Why: Threshold pace change' }))
      expect(await screen.findByRole('dialog', { name: 'Evidence' })).toHaveTextContent('C8')
      await user.keyboard('{Escape}')

      await user.click(within(region).getByRole('button', { name: 'Accept Threshold pace change' }))
      expect(await screen.findByText('Zones updated')).toBeInTheDocument()
      expect(
        api.calls.some((c) => c.method === 'POST' && c.url === '/api/zones/proposals/zp1/accept'),
      ).toBe(true)
      await waitFor(() => {
        expect(screen.queryByRole('region', { name: 'Zone proposals' })).not.toBeInTheDocument()
      })
    })

    test('Decline posts and toasts; zones stay as they were', async () => {
      const user = userEvent.setup()
      let proposals = [makeProposal()]
      const api = renderReview(
        { plan: v2Plan(), weeks: { [W]: fullWeek } },
        {
          'GET /api/zones/proposals': () => proposals,
          'POST /api/zones/proposals/zp1/decline': () => {
            proposals = []
            return undefined
          },
        },
      )
      await ready()
      await user.click(await screen.findByRole('button', { name: 'Decline Threshold pace change' }))
      expect(await screen.findByText('Proposal declined. Zones are unchanged.')).toBeInTheDocument()
      expect(api.calls.some((c) => c.url === '/api/zones/proposals/zp1/decline')).toBe(true)
    })

    test('a failed accept is stated and the proposal stays', async () => {
      const user = userEvent.setup()
      renderReview(
        { plan: v2Plan(), weeks: { [W]: fullWeek }, proposals: [makeProposal()] },
        {
          'POST /api/zones/proposals/zp1/accept': () => ({
            status: 409,
            body: { error: { code: 'conflict', message: 'The proposal is out of date.' } },
          }),
        },
      )
      await ready()
      await user.click(await screen.findByRole('button', { name: 'Accept Threshold pace change' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Zone change not saved. The proposal is out of date.',
      )
      expect(screen.getByRole('region', { name: 'Zone proposals' })).toBeInTheDocument()
    })

    test("a critical speed proposal is shown as a pace, in the runner's units", async () => {
      renderReview({
        plan: v2Plan(),
        weeks: { [W]: fullWeek },
        proposals: [makeProposal({ boundary: 'cs', from: 4, to: 4.1, reason: 'Efforts agree.' })],
      })
      await ready()
      expect(await screen.findByText('Critical speed')).toBeInTheDocument()
      expect(screen.getByText('4:10 /km to 4:04 /km')).toBeInTheDocument()
    })
  })
})
