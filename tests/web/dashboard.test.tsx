import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DashboardPage } from '../../web/pages/DashboardPage.tsx'
import { WeeklyHoursChart } from '../../web/components/charts/WeeklyHoursChart.tsx'
import type {
  Activity,
  Goal,
  PlanWeek,
  PlanWithWeeks,
  UserSettings,
  WeekRow,
  WeeklyReview,
} from '../../shared/types.ts'
import { addDays } from '../../shared/dates.ts'
import { makeActivity, makeWeekRow } from '../factories.ts'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import { makeToday } from './today-fixtures.ts'

// The fixed clock is Wednesday 2026-03-18, so the current week starts on Monday 2026-03-16.
const THIS_WEEK = '2026-03-16'
const FIRST_WINDOW_WEEK = '2025-12-29' // 12 weeks ending this week
const FIRST_PLAN_WEEK = '2026-02-16' // week 5 of 18 is the current one

const settings: UserSettings = { email: 'runner@example.com', displayName: null, units: 'mi' }

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    userId: 'u1',
    name: 'Example Half',
    priority: 'A',
    status: 'target',
    targetDate: '2026-06-13',
    dateProvisional: false,
    distanceM: 21097,
    location: null,
    successCriteria: null,
    notes: null,
    url: null,
    isActive: true,
    gainM: null,
    lossM: null,
    surface: 'road',
    goalType: 'time',
    targetTimeSec: null,
    startTime: null,
    raceLat: null,
    raceLng: null,
    supportLevel: 'aided',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function makePlan(): PlanWithWeeks {
  const weeks: PlanWeek[] = Array.from({ length: 18 }, (_, i) => ({
    id: `w${String(i)}`,
    planId: 'p1',
    weekStart: addDays(FIRST_PLAN_WEEK, 7 * i),
    index: i,
    phase: i < 4 ? 'base1' : 'base2',
    focus: null,
    baselineRunMin: 400,
    targetRunMin: 450,
    targetSource: 'baseline',
    longRunMin: 120,
    day2Min: null,
    runDays: 4,
    strengthSessions: 2,
    overrideNote: null,
    tid: null,
    flags: [],
    gainTargetM: null,
    qualitySessions: 0,
    isRecovery: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }))
  return {
    id: 'p1',
    userId: 'u1',
    goalId: 'g1',
    name: 'Example Half plan',
    startDate: FIRST_PLAN_WEEK,
    raceWeekStart: '2026-06-08',
    status: 'active',
    generatorVersion: 1,
    paramsVersion: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function windowWeeks(over: Record<string, Partial<WeekRow>> = {}): WeekRow[] {
  return Array.from({ length: 12 }, (_, i) => {
    const weekStart = addDays(FIRST_WINDOW_WEEK, 7 * i)
    return makeWeekRow({ weekStart, ...over[weekStart] })
  })
}

function windowReviews(over: Record<string, Partial<WeeklyReview>> = {}): WeeklyReview[] {
  return Array.from({ length: 12 }, (_, i) => {
    const weekStart = addDays(FIRST_WINDOW_WEEK, 7 * i)
    return makeReview(weekStart, over[weekStart])
  })
}

interface Scenario {
  goals?: Goal[]
  plan?: PlanWithWeeks | null
  weeks?: WeekRow[]
  reviews?: WeeklyReview[]
  activities?: Activity[]
}

function routes(s: Scenario): MockRoutes {
  return {
    'GET /api/goals': () => s.goals ?? [makeGoal()],
    'GET /api/plan': () => (s.plan === undefined ? makePlan() : s.plan),
    'GET /api/weeks': () => s.weeks ?? windowWeeks(),
    'GET /api/reviews': () => s.reviews ?? windowReviews(),
    'GET /api/activities': () => s.activities ?? [],
    'GET /api/settings': () => settings,
    'GET /api/today': () => makeToday(),
  }
}

async function renderDashboard(s: Scenario = {}) {
  mockApi(routes(s))
  const view = renderWithProviders(<DashboardPage />)
  const hero = await screen.findByRole('region', { name: 'This week' })
  return { ...view, hero }
}

// A figure and its words sit in separate elements; match the paragraph that holds both.
function phrase(text: string) {
  return screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DashboardPage', () => {
  test('hero: week hours as the display figure ("6.4"), "h of 7.5 h target", a Meter, and the line "Base 2, week 5 of 18"', async () => {
    const { hero } = await renderDashboard({
      weeks: windowWeeks({ [THIS_WEEK]: { runMin: 384, runSessions: 3, runDays: 3 } }),
    })
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument()
    expect(screen.getByText('Week of 16 Mar, Base 2')).toBeInTheDocument()
    expect(within(hero).getByText('6.4')).toBeInTheDocument()
    expect(within(hero).getByText('h of 7.5 h target')).toBeInTheDocument()
    expect(within(hero).getByRole('meter')).toHaveAttribute('aria-valuetext', '6.4 of 7.5 hours')
    expect(within(hero).getByText('Base 2, week 5 of 18')).toBeInTheDocument()
  })

  test('the under-target figure appears once: the headline states it and the meter adds no caption', async () => {
    const { hero } = await renderDashboard({
      weeks: windowWeeks({ [THIS_WEEK]: { runMin: 186, runSessions: 2, runDays: 2 } }),
    })
    expect(within(hero).getByText('3.1')).toBeInTheDocument()
    expect(within(hero).getAllByText(/h of 7\.5 h target/)).toHaveLength(1)
    expect(within(hero).getByRole('meter', { name: 'Run time this week' })).toBeInTheDocument()
  })

  test("with a plan, the countdown and goal name come from the plan's goal, not the active goal", async () => {
    await renderDashboard({
      goals: [
        makeGoal({ id: 'g1', name: 'Example Half', targetDate: '2026-06-13', isActive: false }),
        makeGoal({ id: 'g2', name: 'Example Ten', targetDate: '2026-04-18', isActive: true }),
      ],
    })
    expect(phrase('87 days to the race')).toBeInTheDocument()
    expect(screen.getByText('Example Half, Sat 13 Jun 2026')).toBeInTheDocument()
    expect(screen.queryByText(/Example Ten/)).not.toBeInTheDocument()
  })

  test('without a plan, the countdown uses the active goal', async () => {
    await renderDashboard({
      plan: null,
      goals: [
        makeGoal({ id: 'g1', name: 'Example Half', targetDate: '2026-06-13', isActive: false }),
        makeGoal({ id: 'g2', name: 'Example Ten', targetDate: '2026-04-18', isActive: true }),
      ],
    })
    expect(phrase('31 days to the race')).toBeInTheDocument()
    expect(screen.getByText('Example Ten, Sat 18 Apr 2026')).toBeInTheDocument()
  })

  test('"87 days to the race" from daysBetween and "34 min a day left, through Sunday" with the caption "advisory" from remainingPlan', async () => {
    await renderDashboard({
      weeks: windowWeeks({ [THIS_WEEK]: { runMin: 280, runSessions: 2, runDays: 2 } }),
    })
    expect(phrase('87 days to the race')).toBeInTheDocument()
    expect(phrase('34 min a day left, through Sunday')).toBeInTheDocument()
    expect(screen.getByText('advisory')).toBeInTheDocument()
    expect(screen.getByText('Example Half, Sat 13 Jun 2026')).toBeInTheDocument()
  })

  test('run days and strength are stated against target as text ("3 of 4 run days", "1 of 2 strength sessions")', async () => {
    const { hero } = await renderDashboard({
      weeks: windowWeeks({
        [THIS_WEEK]: { runMin: 200, runSessions: 3, runDays: 3, strengthSessions: 1 },
      }),
    })
    expect(within(hero).getByText('3 of 4 run days')).toBeInTheDocument()
    expect(within(hero).getByText('1 of 2 strength sessions')).toBeInTheDocument()
  })

  test('last 28 days strip and the last 12 weeks chart expose their data in a visually hidden table', async () => {
    await renderDashboard({
      weeks: windowWeeks({ [THIS_WEEK]: { runMin: 384, runSessions: 3, runDays: 3 } }),
      activities: [
        makeActivity({ date: '2026-03-17', durationSec: 2700, distanceM: 8000 }),
        makeActivity({
          date: '2026-03-17',
          type: 'strength',
          durationSec: 1800,
          distanceM: null,
        }),
        makeActivity({ date: '2026-03-15', durationSec: 1800, distanceM: 5000 }),
      ],
    })
    const strip = screen.getByRole('table', { name: 'Run minutes per day, last 28 days' })
    expect(within(strip).getAllByRole('row')).toHaveLength(29)
    const tuesday = within(strip).getByRole('row', { name: /17 Mar/ })
    expect(within(tuesday).getByText('45')).toBeInTheDocument()
    expect(screen.getByText('2 runs, 8.08 mi in the last 28 days')).toBeInTheDocument()

    const chart = screen.getByRole('table', { name: 'Run hours per week, last 12 weeks' })
    expect(within(chart).getAllByRole('row')).toHaveLength(13)
    const current = within(chart).getByRole('row', { name: /16 Mar/ })
    expect(within(current).getByText('6.4')).toBeInTheDocument()
    expect(within(current).getByText('7.5')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Run hours per week, last 12 weeks' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Solid is actual, outline is planned.')).toBeInTheDocument()
  })

  test('the planned bar sits centred behind the narrower actual bar', () => {
    // jsdom has no layout; give the chart a size so recharts draws the bars.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ width: 640, height: 200 }),
    )
    try {
      const { container } = render(
        <WeeklyHoursChart
          weeks={[makeWeekRow({ weekStart: THIS_WEEK, runMin: 300 })]}
          planned={[{ weekStart: THIS_WEEK, targetRunMin: 450 }]}
          ariaLabel="Run hours"
        />,
      )
      const bars = [...container.querySelectorAll('.recharts-rectangle')].map((el) => ({
        x: Number(el.getAttribute('x')),
        width: Number(el.getAttribute('width')),
        fill: el.getAttribute('fill'),
      }))
      expect(bars).toHaveLength(2)
      const [planned, actual] = bars as [(typeof bars)[0], (typeof bars)[0]]
      // Drawn first, so behind; outlined, so unfilled.
      expect(planned.fill).toBe('none')
      expect(actual.width).toBeLessThan(planned.width)
      expect(actual.x + actual.width / 2).toBeCloseTo(planned.x + planned.width / 2)
    } finally {
      vi.restoreAllMocks()
    }
  })

  test('data-health flags: possible duplicates link to /activities?duplicates=1; past plan weeks without complete data link to /review; a finished unreviewed week shows "Last week is ready to review."', async () => {
    await renderDashboard({
      activities: [
        makeActivity({ date: '2026-03-10' }),
        makeActivity({ date: '2026-03-10', duplicateStatus: 'possible', duplicateOfId: 'x' }),
      ],
      reviews: windowReviews({
        '2026-02-16': { dataStatus: 'complete', reviewedAt: '2026-02-24T08:00:00.000Z' },
        '2026-02-23': { dataStatus: 'complete', reviewedAt: '2026-03-03T08:00:00.000Z' },
        '2026-03-02': { dataStatus: 'unconfirmed' },
        '2026-03-09': { dataStatus: 'missing' },
      }),
    })
    expect(screen.getByRole('link', { name: '1 possible duplicate to check' })).toHaveAttribute(
      'href',
      '/activities?duplicates=1',
    )
    expect(
      screen.getByRole('link', { name: '2 past weeks without confirmed data' }),
    ).toHaveAttribute('href', '/review')
    expect(screen.getByRole('link', { name: 'Last week is ready to review.' })).toHaveAttribute(
      'href',
      '/review',
    )
  })

  test('no flags when everything is confirmed and reviewed', async () => {
    const done = { dataStatus: 'complete', reviewedAt: '2026-03-10T08:00:00.000Z' } as const
    await renderDashboard({
      reviews: windowReviews({
        '2026-02-16': done,
        '2026-02-23': done,
        '2026-03-02': done,
        '2026-03-09': done,
      }),
    })
    expect(screen.queryByText(/possible duplicate/)).not.toBeInTheDocument()
    expect(screen.queryByText(/past weeks? without/)).not.toBeInTheDocument()
    expect(screen.queryByText('Last week is ready to review.')).not.toBeInTheDocument()
  })

  test('"Log activity" links to /activities?new=1', async () => {
    await renderDashboard()
    expect(screen.getByRole('link', { name: 'Log activity' })).toHaveAttribute(
      'href',
      '/activities?new=1',
    )
  })

  test('new account: no goal and no plan shows "No plan yet. Choose a goal race, then generate weekly targets." with a link to /goals; a plan with no runs says "No runs this week yet. Log one when you\'re out."; no NaN, Infinity or "0:00" anywhere', async () => {
    const empty = await renderDashboard({
      goals: [],
      plan: null,
      weeks: [],
      reviews: [],
      activities: [],
    })
    expect(
      screen.getByText('No plan yet. Choose a goal race, then generate weekly targets.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Choose a goal' })).toHaveAttribute('href', '/goals')
    expect(screen.queryByText(/to the race/)).not.toBeInTheDocument()
    expect(empty.container.textContent).not.toMatch(/NaN|Infinity|0:00/)
    empty.unmount()

    const planned = await renderDashboard()
    expect(screen.getByText("No runs this week yet. Log one when you're out.")).toBeInTheDocument()
    expect(planned.container.textContent).not.toMatch(/NaN|Infinity|0:00/)
  })

  test('race day shows "Race day" and a past race date shows no countdown', async () => {
    const raceDay = await renderDashboard({ goals: [makeGoal({ targetDate: '2026-03-18' })] })
    expect(screen.getByText('Race day')).toBeInTheDocument()
    expect(screen.queryByText(/days to the race/)).not.toBeInTheDocument()
    raceDay.unmount()

    await renderDashboard({ goals: [makeGoal({ targetDate: '2026-03-10' })] })
    expect(screen.queryByText('Race day')).not.toBeInTheDocument()
    expect(screen.queryByText(/to the race/)).not.toBeInTheDocument()
  })
})
