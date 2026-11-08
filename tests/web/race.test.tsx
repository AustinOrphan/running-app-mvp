// The Race page, the More row, the Today card and the race-day block of the session sheet (rule
// H14, ADR 0018): each reads the one plan, and every sentence passes the copy lint.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import {
  describeRacePlan,
  describeRacePoints,
  describeRaceSummary,
} from '../../shared/copy/racePlan.ts'
import { addDays } from '../../shared/dates.ts'
import { replayLadder } from '../../shared/engine/fuel.ts'
import { racePlanFor, summaryOf } from '../../shared/engine/racePlan.ts'
import type { RacePlan } from '../../shared/engine/racePlan.ts'
import type { CheckpointInput } from '../../shared/engine/raceSplits.ts'
import type { GoalModel } from '../../shared/engine/types.ts'
import type { PlanSession, RaceCheckpointsView, UserSettings } from '../../shared/types.ts'
import { keys } from '../../web/api/client.ts'
import { RaceSessionSection } from '../../web/components/race/RaceSessionSection.tsx'
import { TodaySlot } from '../../web/components/today/TodaySlot.tsx'
import { MorePage } from '../../web/pages/MorePage.tsx'
import { RacePage } from '../../web/pages/RacePage.tsx'
import { courseGpx } from '../fixtures/course/buildCourseGpx.ts'
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
  showBodyWeight: false,
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
  checkpoints: CheckpointInput[] = [],
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
        checkpoints,
        today: TODAY,
      }),
    ),
  ) as RacePlan
}

describe('RacePage', () => {
  test('lays out the sections of the plan in reading order, from the one object', async () => {
    const plan = {
      ...planWith(),
      notices: ['no-prediction', 'no-heart-rate', 'no-climate'] as RacePlan['notices'],
    }
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
      'Checkpoints',
      'Fuel and fluid',
      'Heat',
      'Race week',
      'Dark hours',
    ])
    const text = describeRacePlan(plan, 'km')
    // the time is one figure, and what is missing sits in one "How firm is this" list with its links
    expect(screen.getByText(text.expected.figure)).toBeInTheDocument()
    expect(screen.getByText(text.expected.source)).toBeInTheDocument()
    expect(text.notices).toHaveLength(3)
    for (const notice of text.notices) {
      const item = screen.getByText(notice.text).closest('li')
      expect(item).not.toBeNull()
      expect(within(item as HTMLElement).getByRole('link', { name: notice.link })).toHaveAttribute(
        'href',
        `/${notice.to}`,
      )
    }
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

  test('says the plan did not load when it cannot be read, and offers to try again', async () => {
    mockApi({
      'GET /api/race/plan': () => ({
        status: 503,
        body: { error: { code: 'unavailable', message: 'x' } },
      }),
      'GET /api/settings': () => SETTINGS,
    })
    renderWithProviders(<RacePage />, { route: '/race' })
    expect(await screen.findByRole('alert')).toHaveTextContent('The race plan did not load.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
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

// ---------------------------------------------------------------------------------------------
// The checkpoint table (step 4)
// ---------------------------------------------------------------------------------------------

const POINTS: CheckpointInput[] = [
  { name: 'Checkpoint A', distanceM: 50_000, gainM: 1200, lossM: 300, cutoffSec: 9 * HOUR },
  { name: 'Checkpoint B', distanceM: 110_000, gainM: null, lossM: null, cutoffSec: null },
]

const ROWS_VIEW = (plan: RacePlan): RaceCheckpointsView => ({
  goalId: plan.goalId,
  distanceM: plan.distanceM,
  checkpoints: POINTS,
})

describe('RacePage: the checkpoint table', () => {
  test('says the plan works without a table, and offers to edit it', async () => {
    mockApi({
      'GET /api/race/plan': () => ({ plan: planWith(), reason: null }),
      'GET /api/settings': () => SETTINGS,
    })
    const { container } = renderWithProviders(<RacePage />, { route: '/race' })
    const section = (await screen.findByRole('heading', { level: 2, name: 'Checkpoints' }))
      .parentElement!
    expect(within(section).getByText(/The plan works without them/)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Edit checkpoints' })).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('lists a row for each point and the finish, with the arrival, the cutoff and the notes', async () => {
    const plan = planWith({}, 'aided', POINTS)
    mockApi({
      'GET /api/race/plan': () => ({ plan, reason: null }),
      'GET /api/settings': () => SETTINGS,
    })
    const { container } = renderWithProviders(<RacePage />, { route: '/race' })
    const text = describeRacePoints(plan, 'km')
    const list = await screen.findByRole('list', { name: text.list })
    const rows = within(list).getAllByRole('article')
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Checkpoint A',
      'Checkpoint B',
      'Finish',
    ])
    const first = within(rows[0]!)
    expect(first.getByText(text.rows[0]!.arrival)).toBeInTheDocument()
    // The cutoff stands in its own lines, apart from the arrival range.
    for (const line of text.rows[0]!.cutoff) {
      const element = first.getByText(line)
      expect(element.textContent).not.toMatch(/About/)
    }
    expect(first.getByText(/Cutoff 15:00/)).toBeInTheDocument()
    expect(first.getByText(/Cutoff 9 h into the race/)).toBeInTheDocument()
    expect(first.queryByText(/Cutoff.*About|About.*Cutoff/)).toBeNull()
    expect(within(rows[2]!).getByText(text.rows[2]!.arrival)).toBeInTheDocument()
    expect(screen.getAllByText(/Carry about \d+ to \d+ g of carbohydrate/)).toHaveLength(3)
    for (const note of text.notes) expect(screen.getByText(note)).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('calls the rows course points and drops grams and aid wording for a self-supported race', async () => {
    const plan = planWith({}, 'self', POINTS)
    mockApi({
      'GET /api/race/plan': () => ({ plan, reason: null }),
      'GET /api/settings': () => SETTINGS,
    })
    const { container } = renderWithProviders(<RacePage />, { route: '/race' })
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Course points' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit course points' })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/aid station|Checkpoints|Carry about/i)
  })

  test('opens the editor with the saved rows, and a save sends them in metres and replaces the table', async () => {
    const plan = planWith({}, 'aided', POINTS)
    const { calls } = mockApi({
      'GET /api/race/plan': () => ({ plan, reason: null }),
      'GET /api/settings': () => SETTINGS,
      'GET /api/race/checkpoints': () => ROWS_VIEW(plan),
      'PUT /api/race/checkpoints': ({ body }) => ({
        goalId: plan.goalId,
        distanceM: plan.distanceM,
        checkpoints: (body as { checkpoints: CheckpointInput[] }).checkpoints,
      }),
    })
    const user = userEvent.setup()
    renderWithProviders(<RacePage />, { route: '/race' })
    await user.click(await screen.findByRole('button', { name: 'Edit checkpoints' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit checkpoints' })
    const first = await within(dialog).findByRole('group', { name: 'Point 1' })
    expect(within(first).getByLabelText('Name')).toHaveValue('Checkpoint A')
    expect(within(first).getByLabelText('Distance from the start (km)')).toHaveValue('50')

    // Add a third point, out of order, with a clock cutoff on the second day.
    await user.click(within(dialog).getByRole('button', { name: 'Add a checkpoint' }))
    const third = await within(dialog).findByRole('group', { name: 'Point 3' })
    await user.type(within(third).getByLabelText('Name'), 'Checkpoint C')
    await user.type(within(third).getByLabelText('Distance from the start (km)'), '20')
    await user.selectOptions(within(third).getByLabelText('Cutoff entered as'), 'clock')
    await user.type(within(third).getByLabelText('Cutoff, time of day'), '03:30')
    await user.selectOptions(within(third).getByLabelText('Cutoff, day'), '1')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    })
    const sent = (calls.find((c) => c.method === 'PUT')!.body as { checkpoints: CheckpointInput[] })
      .checkpoints
    expect(sent).toEqual([
      { name: 'Checkpoint C', distanceM: 20_000, gainM: null, lossM: null, cutoffSec: 21.5 * HOUR },
      { name: 'Checkpoint A', distanceM: 50_000, gainM: 1200, lossM: 300, cutoffSec: 9 * HOUR },
      { name: 'Checkpoint B', distanceM: 110_000, gainM: null, lossM: null, cutoffSec: null },
    ])
  })

  test('refuses a point with no name, a distance past the finish and a repeated distance, and sends nothing', async () => {
    const plan = planWith({}, 'aided', POINTS)
    const { calls } = mockApi({
      'GET /api/race/plan': () => ({ plan, reason: null }),
      'GET /api/settings': () => SETTINGS,
      'GET /api/race/checkpoints': () => ROWS_VIEW(plan),
    })
    const user = userEvent.setup()
    renderWithProviders(<RacePage />, { route: '/race' })
    await user.click(await screen.findByRole('button', { name: 'Edit checkpoints' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit checkpoints' })
    await within(dialog).findByRole('group', { name: 'Point 1' })
    await user.click(within(dialog).getByRole('button', { name: 'Add a checkpoint' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add a checkpoint' }))
    const third = await within(dialog).findByRole('group', { name: 'Point 3' })
    const fourth = within(dialog).getByRole('group', { name: 'Point 4' })
    await user.type(within(third).getByLabelText('Distance from the start (km)'), '999')
    await user.type(within(fourth).getByLabelText('Name'), 'Checkpoint D')
    await user.type(within(fourth).getByLabelText('Distance from the start (km)'), '50')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(third).findByText(/Give the point a name/)).toBeInTheDocument()
    expect(within(third).getByText(/past the start and before the finish/)).toBeInTheDocument()
    expect(within(fourth).getByText(/needs its own distance/)).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([])
  })

  test('removes a point from the editor', async () => {
    const plan = planWith({}, 'aided', POINTS)
    const { calls } = mockApi({
      'GET /api/race/plan': () => ({ plan, reason: null }),
      'GET /api/settings': () => SETTINGS,
      'GET /api/race/checkpoints': () => ROWS_VIEW(plan),
      'PUT /api/race/checkpoints': () => ROWS_VIEW(plan),
    })
    const user = userEvent.setup()
    renderWithProviders(<RacePage />, { route: '/race' })
    await user.click(await screen.findByRole('button', { name: 'Edit checkpoints' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit checkpoints' })
    await user.click(await within(dialog).findByRole('button', { name: 'Remove Point 1' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    })
    expect(
      (
        calls.find((c) => c.method === 'PUT')!.body as { checkpoints: CheckpointInput[] }
      ).checkpoints.map((row) => row.name),
    ).toEqual(['Checkpoint B'])
  })
})

// ---------------------------------------------------------------------------------------------
// The course import
// ---------------------------------------------------------------------------------------------

describe('RacePage: Import course GPX', () => {
  const gpxFile = (text: string, name = 'course.gpx') =>
    new File([text], name, { type: 'application/gpx+xml' })

  function setup(plan: RacePlan = planWith()) {
    return mockApi({
      'GET /api/race/plan': () => ({ plan, reason: null }),
      'GET /api/settings': () => SETTINGS,
      'GET /api/race/checkpoints': () => ROWS_VIEW(plan),
      'PUT /api/race/checkpoints': ({ body }) => ({
        goalId: plan.goalId,
        distanceM: plan.distanceM,
        checkpoints: (body as { checkpoints: CheckpointInput[] }).checkpoints,
      }),
    })
  }

  test('proposes the waypoints, lets the runner rename, drop and type a cutoff, and sends only the confirmed rows', async () => {
    const { calls } = setup()
    const user = userEvent.setup()
    renderWithProviders(<RacePage />, { route: '/race' })
    await screen.findByRole('heading', { level: 2, name: 'Checkpoints' })
    const file = gpxFile(
      courseGpx({
        waypoints: [
          { name: 'Station A', at: 40 },
          { name: 'Station B', at: 90 },
          { name: 'Station C', at: 120 },
        ],
      }),
    )
    await user.upload(screen.getByLabelText('Course GPX file'), file)

    const dialog = await screen.findByRole('dialog', { name: 'Checkpoints from the course' })
    expect(within(dialog).getByText(/Proposed from the waypoints in the file: 3/)).toBeVisible()
    expect(within(dialog).getByText(/Course in the file: 161\.\d km/)).toBeVisible()
    // The saved table is not read: the rows come from the file.
    expect(calls.filter((c) => c.url.includes('/race/checkpoints'))).toEqual([])
    const first = await within(dialog).findByRole('group', { name: 'Point 1' })
    expect(within(first).getByLabelText('Name')).toHaveValue('Station A')
    expect(within(first).getByLabelText('Climb (m)')).not.toHaveValue('')

    await user.clear(within(first).getByLabelText('Name'))
    await user.type(within(first).getByLabelText('Name'), 'Lower station')
    await user.type(within(first).getByLabelText('Cutoff, hours and minutes into the race'), '9:30')
    await user.click(within(dialog).getByRole('button', { name: 'Remove Point 2' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    })
    const sent = (calls.find((c) => c.method === 'PUT')!.body as { checkpoints: CheckpointInput[] })
      .checkpoints
    expect(sent.map((row) => row.name)).toEqual(['Lower station', 'Station C'])
    expect(sent[0]!.cutoffSec).toBe(9.5 * HOUR)
    expect(sent[1]!.cutoffSec).toBeNull()
    // Only the rows go: no track and no waypoint list.
    expect(Object.keys(calls.find((c) => c.method === 'PUT')!.body as object)).toEqual([
      'checkpoints',
    ])
    expect(JSON.stringify(calls.find((c) => c.method === 'PUT')!.body).length).toBeLessThan(600)
  })

  test('draws the profile with a hidden table of the course and the checkpoints', async () => {
    setup()
    const user = userEvent.setup()
    renderWithProviders(<RacePage />, { route: '/race' })
    await screen.findByRole('heading', { level: 2, name: 'Checkpoints' })
    await user.upload(
      screen.getByLabelText('Course GPX file'),
      gpxFile(courseGpx({ waypoints: [{ name: 'Station A', at: 40 }] })),
    )
    const dialog = await screen.findByRole('dialog', { name: 'Checkpoints from the course' })
    expect(
      await within(dialog).findByRole('img', { name: /^Elevation profile, from \d+ m to \d+ m$/ }),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/Dots mark the checkpoints/)).toBeVisible()
    const table = await within(dialog).findByRole('table', { name: 'Checkpoints on the course' })
    expect(within(table).getByRole('rowheader', { name: 'Station A' })).toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test('proposes evenly spaced rows, and says so, when the file has no waypoints', async () => {
    setup()
    const user = userEvent.setup()
    renderWithProviders(<RacePage />, { route: '/race' })
    await screen.findByRole('heading', { level: 2, name: 'Checkpoints' })
    await user.upload(screen.getByLabelText('Course GPX file'), gpxFile(courseGpx()))
    const dialog = await screen.findByRole('dialog', { name: 'Checkpoints from the course' })
    expect(
      within(dialog).getByText(
        /The file holds no waypoints, so the points below are spaced evenly/,
      ),
    ).toBeVisible()
    expect(await within(dialog).findByRole('group', { name: 'Point 1' })).toBeInTheDocument()
  })

  test('says the saved table is replaced when the plan already has rows', async () => {
    setup(planWith({}, 'aided', POINTS))
    const user = userEvent.setup()
    renderWithProviders(<RacePage />, { route: '/race' })
    await screen.findByRole('heading', { level: 2, name: 'Checkpoints' })
    await user.upload(screen.getByLabelText('Course GPX file'), gpxFile(courseGpx()))
    const dialog = await screen.findByRole('dialog', { name: 'Checkpoints from the course' })
    expect(within(dialog).getByText('Saving replaces the checkpoints you have now.')).toBeVisible()
  })

  test('says in one sentence that a file is not a course, and opens nothing', async () => {
    setup()
    const user = userEvent.setup()
    renderWithProviders(<RacePage />, { route: '/race' })
    await screen.findByRole('heading', { level: 2, name: 'Checkpoints' })
    await user.upload(screen.getByLabelText('Course GPX file'), gpxFile('<kml></kml>'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That file could not be read as a course. Choose a GPX file that holds a track.',
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('works with no connection until the save', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { calls } = setup()
    const user = userEvent.setup()
    renderWithProviders(<RacePage />, { route: '/race' })
    await screen.findByRole('heading', { level: 2, name: 'Checkpoints' })
    await user.upload(screen.getByLabelText('Course GPX file'), gpxFile(courseGpx()))
    expect(await screen.findByRole('dialog', { name: 'Checkpoints from the course' })).toBeVisible()
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([])
  })
})
