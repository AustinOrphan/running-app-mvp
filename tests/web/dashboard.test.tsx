import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import type { PlanWeek, PlanWithWeeks } from '../../shared/types.ts'
import { WeeklyHoursChart } from '../../web/components/charts/WeeklyHoursChart.tsx'
import { makeActivity, makeWeekRow } from '../factories.ts'
import { activityPage } from './helpers.tsx'
import { makeCoach, makeHero, makeRace, makeStrip, makeToday } from './today-fixtures.ts'
import { renderToday, scrollToFoot, startToday } from './today-render.tsx'

// The fixed clock is Wednesday 2026-03-18, so the current week starts on Monday 2026-03-16.
const THIS_WEEK = '2026-03-16'
const FIRST_WINDOW_WEEK = '2025-12-29' // 12 weeks ending this week
const FIRST_PLAN_WEEK = '2026-02-16'

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

beforeEach(startToday)

afterEach(() => {
  vi.useRealTimers()
})

/** A runner with a plan: today's easy run, a week with a target and a race. */
function planned(over: Parameters<typeof makeCoach>[0] = {}) {
  const hero = makeHero()
  return makeToday({
    sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
    coach: makeCoach({
      hero,
      weekStrip: makeStrip({ runMin: 120, targetRunMin: 450 }),
      race: makeRace(),
      ...over,
    }),
  })
}

describe('DashboardPage', () => {
  test('data-health flags: possible duplicates link to /activities?duplicates=1; past plan weeks without complete data link to /review; a finished unreviewed week shows "Last week is ready to review."', async () => {
    renderToday(
      planned({
        health: {
          possibleDuplicates: 1,
          pastUnconfirmedWeeks: 2,
          lastWeekReady: true,
          notes: [],
        },
      }),
    )
    expect(
      await screen.findByRole('link', { name: '1 possible duplicate to check' }),
    ).toHaveAttribute('href', '/activities?duplicates=1')
    expect(
      screen.getByRole('link', { name: '2 past weeks without confirmed data' }),
    ).toHaveAttribute('href', '/review')
    expect(screen.getByRole('link', { name: 'Last week is ready to review.' })).toHaveAttribute(
      'href',
      '/review',
    )
  })

  test('no flags when everything is confirmed and reviewed', async () => {
    renderToday(planned())
    await screen.findByRole('article', { name: 'Easy run' })
    expect(screen.queryByRole('region', { name: 'Data health' })).not.toBeInTheDocument()
    expect(screen.queryByText(/possible duplicate/)).not.toBeInTheDocument()
    expect(screen.queryByText(/past weeks? without/)).not.toBeInTheDocument()
    expect(screen.queryByText('Last week is ready to review.')).not.toBeInTheDocument()
  })

  test('"Log activity" links to /activities?new=1', async () => {
    renderToday(planned())
    expect(await screen.findByRole('link', { name: 'Log activity' })).toHaveAttribute(
      'href',
      '/activities?new=1',
    )
  })

  test('new account: no goal and no plan shows "No plan yet. Choose a goal race, then generate weekly targets." with a link to /goals; no NaN, Infinity or "0:00" anywhere', async () => {
    const empty = renderToday(makeToday())
    expect(
      await screen.findByText('No plan yet. Choose a goal race, then generate weekly targets.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Choose a goal' })).toHaveAttribute('href', '/goals')
    expect(screen.queryByText(/to the race/)).not.toBeInTheDocument()
    expect(screen.queryByText('Nothing is planned today.')).not.toBeInTheDocument()
    expect(empty.container.textContent).not.toMatch(/NaN|Infinity|0:00/)
  })

  test('a goal without a plan sends the runner to generate one', async () => {
    renderToday(makeToday({ coach: makeCoach({ race: makeRace() }) }))
    expect(await screen.findByRole('link', { name: 'Generate a plan' })).toHaveAttribute(
      'href',
      '/plan',
    )
  })

  test('a week outside the plan says so', async () => {
    const hero = makeHero()
    renderToday(
      makeToday({
        sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
        coach: makeCoach({ hero, weekStrip: makeStrip({ runMin: 60, targetRunMin: null }) }),
      }),
    )
    expect(await screen.findByText('This week is outside the plan.')).toBeInTheDocument()
  })

  test('a plan with a run today and no NaN, Infinity or "0:00" anywhere', async () => {
    const { container } = renderToday(planned())
    await screen.findByRole('article', { name: 'Easy run' })
    expect(container.textContent).not.toMatch(/NaN|Infinity|0:00/)
    expect(screen.queryByText(/No plan yet/)).not.toBeInTheDocument()
  })
})

describe('DashboardPage: the history below the first screen', () => {
  const history = {
    'GET /api/activities': () =>
      activityPage([
        makeActivity({ date: '2026-03-17', durationSec: 2700, distanceM: 8000 }),
        makeActivity({ date: '2026-03-17', type: 'strength', durationSec: 1800, distanceM: null }),
        makeActivity({ date: '2026-03-15', durationSec: 1800, distanceM: 5000 }),
      ]),
    'GET /api/weeks': () =>
      Array.from({ length: 12 }, (_, i) =>
        makeWeekRow({
          weekStart: addDays(FIRST_WINDOW_WEEK, 7 * i),
          ...(addDays(FIRST_WINDOW_WEEK, 7 * i) === THIS_WEEK ? { runMin: 384 } : {}),
        }),
      ),
    'GET /api/plan': () => makePlan(),
  }

  test('asks for nothing until the foot of the page comes near', async () => {
    const { api } = renderToday(planned(), history)
    await screen.findByRole('article', { name: 'Easy run' })
    expect(api.calls.map((call) => call.url).sort()).toEqual(['/api/settings', '/api/today'])
    expect(screen.queryByText(/^Last 28 days$/)).not.toBeInTheDocument()
  })

  test('last 28 days strip and the last 12 weeks chart expose their data in a visually hidden table', async () => {
    scrollToFoot()
    renderToday(planned(), history)
    const strip = await screen.findByRole('table', { name: 'Run minutes per day, last 28 days' })
    expect(within(strip).getAllByRole('row')).toHaveLength(29)
    const tuesday = within(strip).getByRole('row', { name: /17 Mar/ })
    expect(within(tuesday).getByText('45')).toBeInTheDocument()
    expect(screen.getByText('2 runs, 8.08 mi in the last 28 days')).toBeInTheDocument()

    const chart = await screen.findByRole('table', { name: 'Run hours per week, last 12 weeks' })
    expect(within(chart).getAllByRole('row')).toHaveLength(13)
    const current = within(chart).getByRole('row', { name: /16 Mar/ })
    expect(within(current).getByText('6.4')).toBeInTheDocument()
    expect(within(current).getByText('7.5')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Run hours per week, last 12 weeks' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Solid is actual, outline is planned.')).toBeInTheDocument()
  })

  test('a failed history request leaves the page as it is', async () => {
    scrollToFoot()
    renderToday(planned(), {
      ...history,
      'GET /api/activities': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Server error' } },
      }),
    })
    await waitFor(() => {
      expect(screen.getByRole('table', { name: 'Run hours per week, last 12 weeks' })).toBeTruthy()
    })
    expect(screen.queryByRole('table', { name: /last 28 days/ })).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Easy run' })).toBeInTheDocument()
  })
})

describe('WeeklyHoursChart', () => {
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
})
