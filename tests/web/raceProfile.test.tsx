// The course profile that leads the Race page: a named picture with hidden tables, the marks the
// plan's data gives and none it does not, and a readout of the nearest known point.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, test } from 'vitest'
import { replayLadder } from '../../shared/engine/fuel.ts'
import { racePlanFor } from '../../shared/engine/racePlan.ts'
import type { RacePlan } from '../../shared/engine/racePlan.ts'
import type { CheckpointInput } from '../../shared/engine/raceSplits.ts'
import type { GoalModel } from '../../shared/engine/types.ts'
import type { UserSettings } from '../../shared/types.ts'
import { RacePage } from '../../web/pages/RacePage.tsx'
import { mockApi, renderWithProviders } from './helpers.tsx'

const HOUR = 3600

const SETTINGS: UserSettings = {
  email: 'runner@example.com',
  displayName: null,
  units: 'km',
  weightUnit: 'lb',
  showBodyWeight: false,
  hideMapEnds: true,
}

const ROWS: CheckpointInput[] = [
  { name: 'Aid 1', distanceM: 40_000, gainM: 900, lossM: 300, cutoffSec: 9 * HOUR },
  { name: 'Aid 2', distanceM: 90_000, gainM: 700, lossM: 800, cutoffSec: null },
]

const COURSE = [
  { distanceM: 0, relM: 0 },
  { distanceM: 40_000, relM: 600 },
  { distanceM: 90_000, relM: 500 },
  { distanceM: 160_934, relM: 100 },
]

function planWith(over: Partial<GoalModel> = {}): RacePlan {
  const goal: GoalModel = {
    goalId: 'goal-1',
    name: 'Example 100',
    date: '2026-03-20',
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
  return JSON.parse(
    JSON.stringify(
      racePlanFor({
        goal,
        supportLevel: 'aided',
        prediction: { predictedSec: 31 * HOUR, lowSec: 27 * HOUR, highSec: 37 * HOUR },
        z1CeilingBpm: 142,
        ladder: replayLadder({
          settings: { optIn90: true, optInAdvanced: true, giDisease: false },
          runs: [],
          gutTrainingWeeks: [],
        }),
        weightKg: 70,
        acclimationCredit: 0.2,
        checkpoints: ROWS,
        today: '2026-03-18',
      }),
    ),
  ) as RacePlan
}

async function open(plan: RacePlan, course: typeof COURSE | null | undefined) {
  mockApi({
    'GET /api/race/plan': () => ({
      plan,
      reason: null,
      ...(course === undefined ? {} : { course }),
    }),
    'GET /api/settings': () => SETTINGS,
  })
  renderWithProviders(<RacePage />, { route: '/race' })
  await screen.findByRole('heading', { level: 1, name: 'Race plan' })
}

describe('the course profile that leads the Race page', () => {
  // The chart is a lazy chunk (recharts); the first import() transforms it on demand, which on a
  // loaded machine outlasts a findBy's default 1 s. Loading it once here keeps that cost out of the
  // first test's waits.
  beforeAll(async () => {
    await import('../../web/components/charts/RaceProfileChart.tsx')
  }, 60_000)

  test('is the first section, a named picture with its figures in hidden tables', async () => {
    await open(planWith(), COURSE)
    expect(await screen.findByRole('img', { name: /^Course profile over 160.9 km/ })).toBeVisible()
    const headings = (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent)
    expect(headings[0]).toBe('Course')
    const stops = screen.getByRole('table', { name: 'Course points, with the height at each' })
    const rows = within(stops).getAllByRole('row')
    // the header, the start, both points, the finish
    expect(rows).toHaveLength(5)
    expect(within(rows[2]!).getByText('Cutoff 15:00')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Stretches in the dark' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Hourly fuel marks' })).toBeInTheDocument()
  })

  test('keeps one line under the chart and the notes for each drawn mark in a closed disclosure', async () => {
    await open(planWith(), COURSE)
    const figure = (await screen.findByRole('img', { name: /^Course profile/ })).closest('figure')!
    const caption = figure.querySelector('figcaption')!
    expect(caption.querySelector('.line, [class*="_line_"]')!.textContent).toBe(
      'Net height by leg, a smooth line between the points entered.',
    )
    const how = caption.querySelector('details')!
    expect(how.open).toBe(false)
    expect(within(how).getByText('How to read this')).toBeInTheDocument()
    expect(how.textContent).toContain('Band: the dark hours')
    expect(how.textContent).toContain('Ticks: each hour')
    expect(how.textContent).toContain('Diamonds: the cutoffs entered, with the time of day.')
  })

  test('reads the nearest known point with the next stop, by the arrow keys', async () => {
    await open(planWith(), COURSE)
    const group = await screen.findByRole('group', { name: 'Readout' })
    const user = userEvent.setup()
    group.focus()
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByText('Start, 0 m in')).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(
      screen.getByText('600 m above the start · Cutoff 15:00 · Next: Aid 2, 50 km on'),
    ).toBeInTheDocument()
    expect(screen.getByText('Aid 1, 40 km in')).toBeInTheDocument()
    await user.keyboard('{End}')
    expect(screen.getByText('Finish, 160.9 km in')).toBeInTheDocument()
    expect(screen.getByText('100 m above the start')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByText('Touch or move along the course to read a point.')).toBeInTheDocument()
  })

  test('is not on the page without a course, nor in a copy kept before the field existed', async () => {
    await open(planWith(), null)
    await screen.findByRole('heading', { level: 2, name: 'Expected time' })
    expect(screen.queryByRole('img', { name: /^Course profile/ })).not.toBeInTheDocument()
  })

  test('draws no dark band for a race with no start time', async () => {
    await open(planWith({ startTime: null }), COURSE)
    await screen.findByRole('img', { name: /^Course profile/ })
    expect(screen.queryByRole('table', { name: 'Stretches in the dark' })).not.toBeInTheDocument()
    // the diamonds' note does not promise a time of day that is not drawn
    const how = screen.getByText('How to read this').closest('details')!
    expect(how.textContent).toContain('Diamonds: the cutoffs entered.')
    expect(how.textContent).not.toContain('time of day')
  })

  test('heads the net height as height against the start', async () => {
    await open(planWith(), COURSE)
    await screen.findByRole('img', { name: /^Course profile/ })
    expect(
      screen.getByRole('columnheader', { name: 'Height against the start (m)' }),
    ).toBeInTheDocument()
  })
})
