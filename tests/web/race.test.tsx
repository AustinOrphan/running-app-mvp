// The Race page, the More row, the Today card and the race-day block of the session sheet (rule
// H14, ADR 0018): each reads the one plan, and every sentence passes the copy lint.
import { screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { describeRacePlan, describeRaceSummary } from '../../shared/copy/racePlan.ts'
import { addDays } from '../../shared/dates.ts'
import { replayLadder } from '../../shared/engine/fuel.ts'
import { racePlanFor, summaryOf } from '../../shared/engine/racePlan.ts'
import type { RacePlan } from '../../shared/engine/racePlan.ts'
import type { GoalModel } from '../../shared/engine/types.ts'
import type { PlanSession, UserSettings } from '../../shared/types.ts'
import { keys } from '../../web/api/client.ts'
import { RaceSessionSection } from '../../web/components/race/RaceSessionSection.tsx'
import { TodaySlot } from '../../web/components/today/TodaySlot.tsx'
import { MorePage } from '../../web/pages/MorePage.tsx'
import { RacePage } from '../../web/pages/RacePage.tsx'
import { expectCleanCopy, makeTestQueryClient, mockApi, renderWithProviders } from './helpers.tsx'
import { makeCoach, makeToday } from './today-fixtures.ts'

const HOUR = 3600
const RACE = '2026-03-20'
const TODAY = '2026-03-18'

const SETTINGS: UserSettings = {
  email: 'runner@example.com',
  displayName: null,
  units: 'km',
  weightUnit: 'lb',
}

function goal(over: Partial<GoalModel> = {}): GoalModel {
  return {
    goalId: 'goal-1',
    name: 'Example 100',
    date: RACE,
    distanceM: 160_934,
    gainM: 6_000,
    lossM: 6_000,
    surface: 'trail',
    goalType: 'finish',
    targetTimeSec: null,
    startTime: '06:00',
    isUltra: true,
    distanceClass: 'ultra100mi',
    expectedDurationSec: 30 * HOUR,
    crossesDarkness: true,
    raceWbgtC: 12,
    ...over,
  }
}

function planWith(
  over: Partial<GoalModel> = {},
  supportLevel: 'aided' | 'self' = 'aided',
): RacePlan {
  return JSON.parse(
    JSON.stringify(
      racePlanFor({
        goal: goal(over),
        supportLevel,
        prediction: { predictedSec: 31 * HOUR, lowSec: 27 * HOUR, highSec: 37 * HOUR },
        z1CeilingBpm: 142,
        ladder: replayLadder({
          settings: { optIn90: true, optInAdvanced: true, giDisease: false },
          runs: [],
          gutTrainingWeeks: [],
        }),
        weightKg: 70,
        acclimationCredit: 0.2,
        checkpoints: [],
        today: TODAY,
      }),
    ),
  ) as RacePlan
}

describe('RacePage', () => {
  test('lays out the sections of the plan in reading order, from the one object', async () => {
    const plan = planWith()
    mockApi({
      'GET /api/race/plan': () => ({ plan, reason: null }),
      'GET /api/settings': () => SETTINGS,
    })
    renderWithProviders(<RacePage />, { route: '/race' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Race plan' })).toBeInTheDocument()
    const headings = (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent)
    expect(headings).toEqual([
      'Expected time',
      'Effort',
      'Climbing',
      'Fuel and fluid',
      'Heat',
      'Race week',
      'Dark hours',
    ])
    const text = describeRacePlan(plan, 'km')
    expect(screen.getByText(text.expected.headline)).toBeInTheDocument()
    // the instruction stands once over the parts and once in each of them
    expect(screen.getAllByText(text.effort.instruction)).toHaveLength(plan.thirds.length + 1)
    for (const part of text.parts) {
      expect(screen.getByRole('article', { name: part.label })).toBeInTheDocument()
    }
    expect(screen.getByText(text.fuel.rate)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Disclaimer' })).toBeInTheDocument()
  })

  test('shows the context under the title and every sentence passes the copy lint', async () => {
    mockApi({
      'GET /api/race/plan': () => ({ plan: planWith(), reason: null }),
      'GET /api/settings': () => SETTINGS,
    })
    const { container } = renderWithProviders(<RacePage />, { route: '/race' })
    await screen.findByRole('heading', { level: 2, name: 'Effort' })
    expect(screen.getByText(/Example 100, /)).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('has no aid-station wording for a runner without support, and says to carry everything', async () => {
    mockApi({
      'GET /api/race/plan': () => ({ plan: planWith({}, 'self'), reason: null }),
      'GET /api/settings': () => SETTINGS,
    })
    const { container } = renderWithProviders(<RacePage />, { route: '/race' })
    await screen.findByRole('heading', { level: 2, name: 'Fuel and fluid' })
    expect(container.textContent).not.toMatch(/aid station/i)
    expect(container.textContent).toMatch(/You carry everything/)
  })

  test('on a hot race leads with effort and drops the heart rate', async () => {
    mockApi({
      'GET /api/race/plan': () => ({ plan: planWith({ raceWbgtC: 27 }), reason: null }),
      'GET /api/settings': () => SETTINGS,
    })
    const { container } = renderWithProviders(<RacePage />, { route: '/race' })
    await screen.findByRole('heading', { level: 2, name: 'Heat' })
    expect(container.textContent).toMatch(/so effort leads/)
    expect(container.textContent).not.toMatch(/at or below 142/)
    expect(container.textContent).toMatch(/not a forecast/)
  })

  test('points to the Fuel lab while only the floor is the rate', async () => {
    mockApi({
      'GET /api/race/plan': () => ({ plan: planWith(), reason: null }),
      'GET /api/settings': () => SETTINGS,
    })
    renderWithProviders(<RacePage />, { route: '/race' })
    const link = await screen.findByRole('link', { name: 'Open the fuel lab' })
    expect(link).toHaveAttribute('href', '/fuel')
  })

  test.each([
    ['no-goal', /Add a goal race/],
    ['no-distance', /needs a distance/],
    ['not-ultra', /for ultra distances/],
    ['race-over', /race is over/],
  ] as const)('says why there is no plan: %s', async (reason, line) => {
    mockApi({
      'GET /api/race/plan': () => ({ plan: null, reason }),
      'GET /api/settings': () => SETTINGS,
    })
    renderWithProviders(<RacePage />, { route: '/race' })
    expect(await screen.findByText(line)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  })

  test('says it needs a connection when the plan cannot be read', async () => {
    mockApi({
      'GET /api/race/plan': () => ({
        status: 503,
        body: { error: { code: 'unavailable', message: 'x' } },
      }),
      'GET /api/settings': () => SETTINGS,
    })
    renderWithProviders(<RacePage />, { route: '/race' })
    expect(await screen.findByRole('alert')).toHaveTextContent(/needs a connection/)
  })
})

describe('MorePage: the Race plan row', () => {
  test('is listed with its note when the goal has a plan, and links to /race', async () => {
    mockApi({ 'GET /api/race/plan': () => ({ plan: planWith(), reason: null }) })
    renderWithProviders(<MorePage />, { route: '/more' })
    const nav = within(screen.getByRole('navigation', { name: 'More pages' }))
    const link = await nav.findByRole('link', { name: /^Race plan/ })
    expect(link).toHaveAttribute('href', '/race')
    expect(link).toHaveTextContent('Effort, fuel, heat and the expected time for the goal race')
    expectCleanCopy(link)
  })

  test.each(['no-goal', 'not-ultra', 'race-over'] as const)(
    'is not listed when there is no plan (%s)',
    async (reason) => {
      const { calls } = mockApi({ 'GET /api/race/plan': () => ({ plan: null, reason }) })
      renderWithProviders(<MorePage />, { route: '/more' })
      await screen.findByRole('link', { name: /^Settings/ })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(calls.map((call) => call.url)).toContain('/api/race/plan')
      expect(screen.queryByRole('link', { name: /^Race plan/ })).toBeNull()
    },
  )
})

/** A Today payload in the cache with the race slot filled, as the page holds it. */
function seededClient(plan: RacePlan, date: string) {
  const summary = summaryOf(plan, date)
  const queryClient = makeTestQueryClient()
  queryClient.setQueryData(
    [keys.today],
    makeToday({
      date,
      coach: makeCoach({
        slots: { ...makeCoach().slots, race: summary === null ? null : summary },
      }),
    }),
  )
  queryClient.setQueryData([keys.settings], SETTINGS)
  return { queryClient, summary }
}

describe('Today: the race slot', () => {
  test('renders nothing without a summary', () => {
    const plan = planWith()
    const { queryClient } = seededClient(plan, addDays(RACE, -10))
    const { container } = renderWithProviders(<TodaySlot name="race" />, { queryClient })
    expect(container).toBeEmptyDOMElement()
  })

  test('is one unbudgeted card with the days to go, the carbohydrate line and the link', () => {
    const plan = planWith()
    const { queryClient, summary } = seededClient(plan, addDays(RACE, -1))
    const { container } = renderWithProviders(<TodaySlot name="race" />, { queryClient })
    const slot = container.querySelector('[data-slot="race"]')
    expect(slot).not.toBeNull()
    expect(slot).not.toHaveAttribute('data-budget-px')
    if (summary === null) throw new Error('expected a summary')
    const text = describeRaceSummary(summary, 'km')
    const card = within(slot as HTMLElement)
    expect(card.getByRole('heading', { name: '1 day to go' })).toBeInTheDocument()
    expect(card.getByText(text.carb ?? '')).toBeInTheDocument()
    expect(card.getByRole('link', { name: 'Open the race plan' })).toHaveAttribute('href', '/race')
    expectCleanCopy(container)
  })

  test('leaves the carbohydrate line out before the final window', () => {
    const plan = planWith()
    const { queryClient } = seededClient(plan, addDays(RACE, -5))
    renderWithProviders(<TodaySlot name="race" />, { queryClient })
    expect(screen.getByRole('heading', { name: '5 days to go' })).toBeInTheDocument()
    expect(screen.queryByText(/eat .* of carbohydrate per kg/)).toBeNull()
  })

  test('adds the effort sentence on the race day', () => {
    const plan = planWith()
    const { queryClient } = seededClient(plan, RACE)
    renderWithProviders(<TodaySlot name="race" />, { queryClient })
    expect(screen.getByRole('heading', { name: 'Race day' })).toBeInTheDocument()
    expect(screen.getByText(/Keep heart rate at or below 142/)).toBeInTheDocument()
  })
})

const RACE_SESSION = {
  id: 's-race',
  date: RACE,
  kind: 'race',
  title: 'Race',
  durationMin: 1800,
  status: 'planned',
  flags: [],
} as unknown as PlanSession

describe('the race-day block of the session sheet', () => {
  test('shows the effort, the fuel and fluid lines and the safety card on the race day', () => {
    const plan = planWith()
    const { queryClient, summary } = seededClient(plan, RACE)
    renderWithProviders(<RaceSessionSection session={RACE_SESSION} units="km" />, { queryClient })
    if (summary === null) throw new Error('expected a summary')
    const text = describeRaceSummary(summary, 'km')
    expect(screen.getByRole('heading', { name: 'Race day' })).toBeInTheDocument()
    expect(screen.getByText(text.instruction)).toBeInTheDocument()
    expect(screen.getByText(text.fuel.rate)).toBeInTheDocument()
    expect(screen.getByText(text.fuel.fluid)).toBeInTheDocument()
    expect(screen.getByRole('note', { name: text.fuel.eah.heading })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the race plan' })).toHaveAttribute(
      'href',
      '/race',
    )
    // the page and the block say the same thing: the same sentence for the same object
    expect(text.instruction).toBe(describeRacePlan(plan, 'km').effort.instruction)
  })

  test('is the link alone on any other day', () => {
    const plan = planWith()
    const { queryClient } = seededClient(plan, addDays(RACE, -2))
    renderWithProviders(<RaceSessionSection session={RACE_SESSION} units="km" />, { queryClient })
    expect(screen.getByRole('heading', { name: 'Race plan' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the race plan' })).toBeInTheDocument()
    expect(screen.queryByText(/Keep heart rate/)).toBeNull()
  })

  test('is the link alone when Today has not been read', () => {
    renderWithProviders(<RaceSessionSection session={RACE_SESSION} units="km" />)
    expect(screen.getByRole('link', { name: 'Open the race plan' })).toBeInTheDocument()
  })
})
