import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import { seasonDescription } from '../../shared/copy/season.ts'
import type { Goal, PlanPhase, PlanWithSessions, WeekRow } from '../../shared/types.ts'
import { seasonRuns } from '../../web/components/season.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { PlanPage } from '../../web/pages/PlanPage.tsx'
import { makeWeekRow } from '../factories.ts'
import { expectCleanCopy, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import {
  makeRevision,
  makeProfile,
  makeSession,
  makeV1Plan,
  makeV2Plan,
  makeV2Week,
  settings,
} from './plan-fixtures.ts'
import { sheetRoutes } from './wrist-fixtures.ts'

// The season strip above the week table: one bar and one button per plan week, brackets for the
// phases, and a tap that shows the week's row.

const START = '2026-12-14'
const CURRENT = '2027-01-11'
const goal = { id: 'g1', name: 'Spring marathon', status: 'target', isActive: true } as Goal

/** Twelve weeks from Monday 14 Dec: base, build, specific, taper, the race, two after it. */
const PHASES: Array<[PlanPhase, string[]]> = [
  ['base', []],
  ['base', ['recovery']],
  ['base', []],
  ['build', []],
  ['build', []],
  ['build', ['recovery']],
  ['specific', []],
  ['specific', []],
  ['taper', []],
  ['race', []],
  ['race', ['post-race']],
  ['race', ['post-race']],
]

function plan(): PlanWithSessions {
  const weeks = PHASES.map(([phase, flags], index) =>
    makeV2Week(index, {
      weekStart: addDays(START, 7 * index),
      phase,
      flags,
      targetRunMin: 300 + index * 10,
    }),
  )
  const session = (id: string, weekStart: string, day: number) =>
    makeSession({ id, weekStart, date: addDays(weekStart, day), title: `Run ${id}` })
  return makeV2Plan({
    startDate: START,
    raceWeekStart: addDays(START, 7 * 9),
    weeks,
    // an earlier week, the current one and a later one carry days to open
    sessions: [
      session('early', addDays(START, 7), 1),
      session('now', CURRENT, 2),
      session('later', addDays(START, 7 * 7), 1),
    ],
  })
}

const RAN: WeekRow[] = [
  makeWeekRow({ weekStart: addDays(START, 0), runMin: 200 }),
  makeWeekRow({ weekStart: addDays(START, 7), runMin: 0 }),
  makeWeekRow({ weekStart: addDays(START, 14), runMin: 150 }),
  makeWeekRow({ weekStart: addDays(START, 21), runMin: 240 }),
  makeWeekRow({ weekStart: CURRENT, runMin: 90 }),
]

function routes(data: PlanWithSessions | ReturnType<typeof makeV1Plan>, extra: MockRoutes = {}) {
  return {
    'GET /api/plan': () => data,
    'GET /api/goals': () => [goal],
    'GET /api/settings': () => settings,
    'GET /api/profile': () => makeProfile(),
    'GET /api/weeks': () => RAN,
    'GET /api/plan/revisions': () => [makeRevision()],
    'GET /api/plan/disruptions': () => [],
    ...sheetRoutes('sessions' in data ? data.sessions : []),
    ...extra,
  }
}

function renderPlan() {
  return renderWithProviders(
    <ToastProvider>
      <PlanPage />
    </ToastProvider>,
  )
}

const scrolled = vi.fn()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-13T12:00:00'))
  // jsdom has no scrollIntoView
  scrolled.mockClear()
  Element.prototype.scrollIntoView = scrolled
  // jsdom has no layout, so the chart's box measures 0 by 0 and draws nothing: it is a phone's
  // 358 px wide, the width the strip is laid out for before it measures itself
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 358,
    height: 80,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 358,
    bottom: 80,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function strip() {
  return screen.findByRole('region', { name: 'Season' })
}

const row = (weekStart: string) => {
  const el = document.querySelector<HTMLElement>(`tr[data-week="${weekStart}"]`)
  if (el === null) throw new Error(`No row for ${weekStart}`)
  return el
}

/** The element the page last scrolled to. */
const lastScrolledTo = () => scrolled.mock.contexts[scrolled.mock.contexts.length - 1] as Element

describe('the season strip, its buttons and its words', () => {
  test('sits under the header, above the watch strip and the prose of the plan', async () => {
    mockApi(routes(plan()))
    renderPlan()
    const season = await strip()
    const header = screen.getByRole('heading', { level: 1, name: 'Plan' })
    const feasibility = await screen.findByRole('region', { name: 'Feasibility' })
    const table = screen.getByRole('table')
    const order = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(order(header, season)).toBe(true)
    expect(order(season, feasibility)).toBe(true)
    expect(order(season, await screen.findByRole('region', { name: 'Watch' }))).toBe(true)
    expect(order(feasibility, table)).toBe(true)
    // the regions the page already had keep their names
    expect(screen.getByRole('region', { name: 'Load setting' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Plan shape' })).toBeInTheDocument()
  })

  test('is described as a short sentence of the plan, which a screen reader reads on entering', async () => {
    const data = plan()
    mockApi(routes(data))
    renderPlan()
    const season = await strip()
    const expected = seasonDescription(seasonRuns(data.weeks), CURRENT)
    expect(expected).toBe(
      'A 12-week plan: base to 3 Jan, build to 24 Jan, specific to 7 Feb, taper, race week of 15 Feb, then 2 weeks after the race. This week is the week of 11 Jan.',
    )
    expect(season).toHaveAccessibleDescription(expected)
    expect(expected).not.toMatch(/target/i)
    expectCleanCopy(season)
  })

  test('has one button for each plan week, in order, in a group named "Weeks of the plan"', async () => {
    const data = plan()
    mockApi(routes(data))
    renderPlan()
    const group = within(await strip()).getByRole('group', { name: 'Weeks of the plan' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons).toHaveLength(data.weeks.length)
    expect(buttons[0]).toHaveAccessibleName('Week of 14 Dec, base, 5.0 h planned')
    expect(buttons[9]).toHaveAccessibleName('Week of 15 Feb, race week, 6.5 h planned')
    expect(buttons[10]).toHaveAccessibleName('Week of 22 Feb, after the race, 6.7 h planned')
  })

  test('names the minutes run of the weeks that have been read, and "This week" on the current one', async () => {
    mockApi(routes(plan()))
    renderPlan()
    const season = await strip()
    const group = within(season).getByRole('group', { name: 'Weeks of the plan' })
    await waitFor(() => {
      expect(within(group).getAllByRole('button')[0]).toHaveAccessibleName(
        'Week of 14 Dec, base, 5.0 h planned, 3.3 h run',
      )
    })
    expect(within(group).getByRole('button', { name: /^Week of 21 Dec/ })).toHaveAccessibleName(
      'Week of 21 Dec, base, 5.2 h planned, 0.0 h run',
    )
    const now = within(group).getByRole('button', { name: /^This week/ })
    expect(now).toHaveAccessibleName('This week, week of 11 Jan, build, 5.7 h planned, 1.5 h run')
    expect(now).toHaveAttribute('aria-current', 'date')
    // no other week says "This week", and a week to come has no minutes run
    expect(within(group).getAllByRole('button', { name: /^This week/ })).toHaveLength(1)
    expect(within(group).getAllByRole('button', { current: 'date' })).toHaveLength(1)
    const future = within(group).getByRole('button', { name: /^Week of 25 Jan/ })
    expect(future).toHaveAccessibleName('Week of 25 Jan, specific, 6.0 h planned')
    expectCleanCopy(season)
  })

  test('says no running is planned for a week planned at none', async () => {
    const data = plan()
    data.weeks[11] = makeV2Week(11, {
      weekStart: addDays(START, 77),
      phase: 'race',
      flags: ['post-race'],
      targetRunMin: 0,
    })
    mockApi(routes(data))
    renderPlan()
    const group = within(await strip()).getByRole('group', { name: 'Weeks of the plan' })
    expect(within(group).getAllByRole('button')[11]).toHaveAccessibleName(
      'Week of 1 Mar, after the race, no running planned',
    )
  })

  test('is the one Tab stop of the strip, on this week, moved with the arrow keys', async () => {
    const user = userEvent.setup()
    mockApi(routes(plan()))
    renderPlan()
    const group = within(await strip()).getByRole('group', { name: 'Weeks of the plan' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.filter((b) => b.tabIndex === 0)).toEqual([buttons[4]])

    buttons[4]!.focus()
    await user.keyboard('{ArrowRight}')
    expect(buttons[5]).toHaveFocus()
    expect(buttons.filter((b) => b.tabIndex === 0)).toEqual([buttons[5]])
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(buttons[3]).toHaveFocus()
    await user.keyboard('{End}')
    expect(buttons[11]).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(buttons[11]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(buttons[0]).toHaveFocus()
    // the stop stays where the keyboard left it
    expect(buttons.filter((b) => b.tabIndex === 0)).toEqual([buttons[0]])
  })

  test('has its Tab stop on the first week when today is outside the plan', async () => {
    vi.setSystemTime(new Date('2026-11-02T12:00:00'))
    mockApi(routes(plan()))
    renderPlan()
    const season = await strip()
    const buttons = within(season).getAllByRole('button')
    expect(buttons.filter((b) => b.tabIndex === 0)).toEqual([buttons[0]])
    expect(within(season).queryByRole('button', { name: /^This week/ })).not.toBeInTheDocument()
    expect(season).toHaveAccessibleDescription(/The plan starts the week of 14 Dec\.$/)
  })

  test('is drawn for a version-1 plan too, which has no sessions', async () => {
    mockApi(routes(makeV1Plan()))
    renderPlan()
    const season = await strip()
    expect(within(season).getAllByRole('button')).toHaveLength(3)
  })
})

describe('the bars and the brackets', () => {
  async function bars() {
    const season = await strip()
    const chart = await waitFor(() => {
      const found = season.querySelector('[data-compact="true"]')
      expect(found?.querySelector('rect[height]')).not.toBeNull()
      return found as HTMLElement
    })
    const rects = [...chart.querySelectorAll<SVGRectElement>('rect[height]')]
    return {
      chart,
      outlined: rects.filter((r) => r.getAttribute('fill') === 'none'),
      solid: rects.filter((r) => r.getAttribute('fill') === 'var(--chart-actual)'),
    }
  }

  test('draws one outlined bar per plan week, and a solid one for each week that has run', async () => {
    const data = plan()
    mockApi(routes(data))
    renderPlan()
    const { outlined, solid } = await bars()
    expect(outlined).toHaveLength(data.weeks.length)
    // 14 Dec, 28 Dec, 4 Jan and this week ran; 21 Dec ran nothing and the weeks to come none
    await waitFor(() => {
      expect(
        document.querySelectorAll('[data-compact="true"] rect[fill="var(--chart-actual)"]'),
      ).toHaveLength(4)
    })
    expect(solid.length).toBeLessThanOrEqual(4)
  })

  test('shows the cutback weeks shorter by their own height', async () => {
    const data = plan()
    data.weeks[1]!.targetRunMin = 210
    data.weeks[1]!.plannedRunMin = 210
    mockApi(routes(data))
    renderPlan()
    const { outlined } = await bars()
    const height = (i: number) => Number(outlined[i]!.getAttribute('height'))
    expect(height(1)).toBeLessThan(height(0))
    expect(height(1)).toBeLessThan(height(2))
  })

  test('marks the current week in the accent, the race week with one flag, the weeks after muted', async () => {
    mockApi(routes(plan()))
    renderPlan()
    const { chart, outlined } = await bars()
    expect(outlined.map((r) => r.getAttribute('stroke')).indexOf('var(--accent)')).toBe(4)
    expect(outlined.filter((r) => r.getAttribute('stroke') === 'var(--accent)')).toHaveLength(1)
    expect(chart.querySelectorAll('[data-mark="current"]')).toHaveLength(1)
    const flags = chart.querySelectorAll('[data-mark="race"]')
    expect(flags).toHaveLength(1)
    // the flag stands on the race week, the tenth bar
    const race = outlined[9]!
    expect(flags[0]!.getAttribute('d')).toMatch(
      new RegExp(
        `^M${String(Number(race.getAttribute('x')) + Number(race.getAttribute('width')) / 2)} `,
      ),
    )
    expect(outlined.map((r) => r.getAttribute('stroke-dasharray'))).toEqual(
      Array.from({ length: 12 }, (_, i) => (i >= 10 ? '2 2' : null)),
    )
  })

  test('brackets every phase, and names the ones the width has room for', async () => {
    mockApi(routes(plan()))
    renderPlan()
    const season = await strip()
    const brackets = [...season.querySelectorAll<HTMLElement>('[data-run]')]
    expect(brackets.map((b) => b.dataset.run)).toEqual([
      'Base',
      'Build',
      'Specific',
      'Taper',
      'Race week',
      'After the race',
    ])
    // each bracket spans the weeks of its run
    expect(brackets.map((b) => b.style.gridColumn)).toEqual([
      '1 / span 3',
      '4 / span 3',
      '7 / span 2',
      '9 / span 1',
      '10 / span 1',
      '11 / span 2',
    ])
    // 12 weeks in 358 px, 30 px a week: a name needs about 7 px a letter, so Base and Build fit
    // their brackets and the rest are left to the buttons and the description
    expect(brackets.map((b) => b.textContent)).toEqual(['Base', 'Build', '', '', '', ''])
    expect(season.querySelector('[data-run]')?.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  test('says what the bars are under them: solid is actual, outline is planned', async () => {
    mockApi(routes(plan()))
    renderPlan()
    expect(await screen.findByText('Solid is actual, outline is planned.')).toBeInTheDocument()
  })
})

describe('a tap on a week', () => {
  test('scrolls to the week row and opens its days', async () => {
    const user = userEvent.setup()
    mockApi(routes(plan()))
    renderPlan()
    const season = await strip()
    const later = addDays(START, 7 * 7)
    expect(within(row(later)).getByRole('button', { name: /^Days for week of/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    await user.click(within(season).getByRole('button', { name: /^Week of 1 Feb/ }))

    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(lastScrolledTo()).toBe(row(later))
    expect(scrolled).toHaveBeenLastCalledWith({ block: 'start', behavior: 'smooth' })
    expect(within(row(later)).getByRole('button', { name: /^Days for week of/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(document.querySelector(`tr[data-days-for="${later}"]`)).not.toBeNull()
    // focus follows, so the next Tab reaches the row's own buttons
    expect(row(later)).toHaveFocus()
  })

  test('scrolls without opening anything for a week with no days', async () => {
    const user = userEvent.setup()
    mockApi(routes(plan()))
    renderPlan()
    const season = await strip()
    await user.click(within(season).getByRole('button', { name: /^Week of 22 Feb/ }))
    expect(lastScrolledTo()).toBe(row(addDays(START, 70)))
    expect(document.querySelectorAll('tr[data-days-for]')).toHaveLength(1)
  })

  test('keeps the days of this week open: a tap shows the row, it never closes it', async () => {
    const user = userEvent.setup()
    mockApi(routes(plan()))
    renderPlan()
    const season = await strip()
    const days = within(row(CURRENT)).getByRole('button', { name: /^Days for week of/ })
    expect(days).toHaveAttribute('aria-expanded', 'true')
    await user.click(within(season).getByRole('button', { name: /^This week/ }))
    expect(lastScrolledTo()).toBe(row(CURRENT))
    expect(days).toHaveAttribute('aria-expanded', 'true')
  })

  test('opens "Earlier weeks" first for a week before this Monday', async () => {
    const user = userEvent.setup()
    mockApi(routes(plan()))
    renderPlan()
    const season = await strip()
    const toggle = await screen.findByRole('button', { name: 'Earlier weeks (4)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector(`tr[data-week="${addDays(START, 7)}"]`)).toBeNull()

    await user.click(within(season).getByRole('button', { name: /^Week of 21 Dec/ }))

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const earlier = row(addDays(START, 7))
    expect(lastScrolledTo()).toBe(earlier)
    expect(within(earlier).getByRole('button', { name: /^Days for week of/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(earlier).toHaveFocus()
  })

  test('does not open "Earlier weeks" for a week from this Monday on', async () => {
    const user = userEvent.setup()
    mockApi(routes(plan()))
    renderPlan()
    const season = await strip()
    await user.click(within(season).getByRole('button', { name: /^Week of 8 Feb/ }))
    expect(screen.getByRole('button', { name: 'Earlier weeks (4)' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  test('answers a second tap on the same week by scrolling to it again', async () => {
    const user = userEvent.setup()
    mockApi(routes(plan()))
    renderPlan()
    const season = await strip()
    const week = within(season).getByRole('button', { name: /^Week of 1 Feb/ })
    await user.click(week)
    await user.click(week)
    expect(scrolled).toHaveBeenCalledTimes(2)
  })

  test('scrolls without animation for a runner who asks for less motion', async () => {
    const user = userEvent.setup()
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    // a runner who has asked for reduced motion; every other query is false, as in the setup
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })
    try {
      mockApi(routes(plan()))
      renderPlan()
      await user.click(within(await strip()).getByRole('button', { name: /^Week of 1 Feb/ }))
      expect(scrolled).toHaveBeenLastCalledWith({ block: 'start', behavior: 'auto' })
    } finally {
      if (original !== undefined) Object.defineProperty(window, 'matchMedia', original)
    }
  })
})

describe('the strip when the weeks run do not load', () => {
  test('still draws the plan and names the weeks by their plan alone', async () => {
    mockApi(routes(plan(), { 'GET /api/weeks': () => ({ status: 500, body: { error: {} } }) }))
    renderPlan()
    const season = await strip()
    const group = within(season).getByRole('group', { name: 'Weeks of the plan' })
    expect(within(group).getAllByRole('button')).toHaveLength(12)
    expect(within(group).getAllByRole('button')[0]).toHaveAccessibleName(
      'Week of 14 Dec, base, 5.0 h planned',
    )
    // the table says so once; the strip adds no second alert
    expect(await screen.findAllByRole('alert')).toHaveLength(1)
  })
})
