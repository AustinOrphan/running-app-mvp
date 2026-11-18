// The first step with no plan (FH1a): Today and the Generate form say the same thing from the one
// reason the server derived, and Today has one primary action.
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FirstAction } from '../../shared/engine/firstAction.ts'
import type { Goal, UserSettings, WeekRow } from '../../shared/types.ts'
import { PlanPage } from '../../web/pages/PlanPage.tsx'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'
import { makeProfile } from './plan-fixtures.ts'
import { makeCoach, makeToday } from './today-fixtures.ts'
import { renderToday, startToday } from './today-render.tsx'
import { wristRoutes } from './wrist-fixtures.ts'

const RUNS: FirstAction = { reason: 'runs', belowFloor: false, levelMin: 0, floorMin: 60 }
const FEW: FirstAction = { reason: 'goal', belowFloor: true, levelMin: 20, floorMin: 60 }
const GOAL: FirstAction = { reason: 'goal', belowFloor: false, levelMin: 120, floorMin: 60 }

const settings: UserSettings = {
  email: 'runner@example.com',
  displayName: null,
  units: 'mi',
  weightUnit: 'lb',
  showBodyWeight: false,
  hideMapEnds: true,
}

const goal: Goal = {
  id: 'g1',
  userId: 'u1',
  name: 'Synthetic half',
  priority: 'A',
  status: 'target',
  targetDate: '2027-03-07',
  dateProvisional: false,
  distanceM: 21098,
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
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
}

const NEED = 'No runs are on file yet.'
const FEW_NEED =
  'The runs on file add up to about 20 min in a typical week. The plan starts with a short programme below 60 min a week.'

beforeEach(() => {
  startToday()
})

afterEach(() => {
  vi.useRealTimers()
})

function renderPlanWithNoPlan(firstAction: FirstAction) {
  mockApi({
    'GET /api/plan': () => null,
    'GET /api/goals': () => [goal],
    'GET /api/settings': () => settings,
    'GET /api/profile': () => makeProfile(),
    'GET /api/weeks': () => [] as WeekRow[],
    'GET /api/today': () => makeToday({ coach: makeCoach({ firstAction }) }),
    ...wristRoutes(),
  })
  return renderWithProviders(<PlanPage />)
}

describe('first action with no plan', () => {
  test('too few runs: Today shows the need and one primary action to bring in runs', async () => {
    const { container } = renderToday(makeToday({ coach: makeCoach({ firstAction: RUNS }) }))
    expect(
      await screen.findByText('No plan yet. A plan starts from the running on file.'),
    ).toBeInTheDocument()
    expect(screen.getByText(NEED)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Bring in your runs' })).toHaveAttribute(
      'href',
      '/integrations',
    )
    // The other way is a plain link, and the one primary button is the first step.
    expect(screen.getByRole('link', { name: 'Choose a goal' })).toHaveAttribute('href', '/goals')
    expect(screen.queryByRole('link', { name: 'Generate a plan' })).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('too few runs: the Generate form shows the same sentence and the same link', async () => {
    renderPlanWithNoPlan(RUNS)
    expect(await screen.findByText(NEED)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Bring in your runs' })).toHaveAttribute(
      'href',
      '/integrations',
    )
    // The form keeps its own one primary button.
    expect(screen.getByRole('button', { name: 'Generate plan' })).toBeInTheDocument()
  })

  test('a few runs under the floor: the goal is the primary action, with the level beside it, on both pages', async () => {
    const today = renderToday(makeToday({ coach: makeCoach({ firstAction: FEW }) }))
    expect(
      await screen.findByText('No plan yet. Choose a goal race, then generate weekly targets.'),
    ).toBeInTheDocument()
    expect(screen.getByText(FEW_NEED)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Choose a goal' })).toHaveAttribute('href', '/goals')
    expect(screen.queryByRole('link', { name: 'Bring in your runs' })).not.toBeInTheDocument()
    expectCleanCopy(today.container)
    today.unmount()

    renderPlanWithNoPlan(FEW)
    expect(await screen.findByText(FEW_NEED)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Bring in your runs' })).not.toBeInTheDocument()
  })

  test('enough runs: Today asks for a goal and the Generate form adds no line', async () => {
    const today = renderToday(makeToday({ coach: makeCoach({ firstAction: GOAL }) }))
    expect(
      await screen.findByText('No plan yet. Choose a goal race, then generate weekly targets.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Choose a goal' })).toHaveAttribute('href', '/goals')
    expect(screen.queryByRole('link', { name: 'Bring in your runs' })).not.toBeInTheDocument()
    expect(screen.queryByText(/runs on file/)).not.toBeInTheDocument()
    today.unmount()

    renderPlanWithNoPlan(GOAL)
    expect(
      await screen.findByText('No plan yet. Choose a goal race, then generate weekly targets.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Bring in your runs' })).not.toBeInTheDocument()
    expect(screen.queryByText(/runs on file/)).not.toBeInTheDocument()
  })

  test('Today with no first action in the payload (an older copy) reads as the goal', async () => {
    renderToday(makeToday())
    expect(
      await screen.findByText('No plan yet. Choose a goal race, then generate weekly targets.'),
    ).toBeInTheDocument()
    const section = screen.getByText(/^No plan yet/).closest('div')
    expect(section).not.toBeNull()
    expect(within(section as HTMLElement).getAllByRole('link')).toHaveLength(1)
  })
})
