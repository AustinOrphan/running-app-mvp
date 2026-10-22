import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import type {
  Goal,
  Phase,
  PlanWeek,
  PlanWithWeeks,
  UserSettings,
  WeekRow,
} from '../../shared/types.ts'
import { PlanPage } from '../../web/pages/PlanPage.tsx'
import { makeWeekRow } from '../factories.ts'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'

const settings: UserSettings = { email: 'runner@example.com', displayName: null, units: 'mi' }
const START = '2026-12-28'
const CURRENT_WEEK = '2027-01-11'

const goal: Goal = {
  id: 'g1',
  userId: 'u1',
  name: 'Spring half',
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

const phases: Phase[] = [
  'restart',
  'base1',
  'base1',
  'base1',
  'base2',
  'endurance',
  'specific',
  'peak',
  'taper',
  'race',
]

function makeWeek(index: number, over: Partial<PlanWeek> = {}): PlanWeek {
  return {
    id: `w${index}`,
    planId: 'p1',
    weekStart: addDays(START, index * 7),
    index,
    phase: phases[index] ?? 'base1',
    focus: `Focus ${index}`,
    baselineRunMin: 420,
    targetRunMin: 420,
    targetSource: 'baseline',
    longRunMin: 100,
    day2Min: null,
    runDays: 4,
    strengthSessions: 2,
    overrideNote: null,
    tid: null,
    flags: [],
    gainTargetM: null,
    updatedAt: '2026-12-01T10:00:00.000Z',
    ...over,
  }
}

function makePlan(weeks: PlanWeek[] = phases.map((_, i) => makeWeek(i))): PlanWithWeeks {
  return {
    id: 'p1',
    userId: 'u1',
    goalId: 'g1',
    name: 'Spring half plan',
    startDate: START,
    raceWeekStart: '2027-03-01',
    status: 'active',
    generatorVersion: 1,
    paramsVersion: null,
    createdAt: '2026-12-01T10:00:00.000Z',
    updatedAt: '2026-12-01T10:00:00.000Z',
    weeks,
  }
}

function routes(
  plan: PlanWithWeeks | null,
  extra: MockRoutes = {},
  goals: Goal[] = [goal],
): MockRoutes {
  return {
    'GET /api/plan': () => plan,
    'GET /api/goals': () => goals,
    'GET /api/settings': () => settings,
    'GET /api/weeks': () => [] as WeekRow[],
    ...extra,
  }
}

function row(weekStart: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`tr[data-week="${weekStart}"]`)
  if (!el) throw new Error(`No row for ${weekStart}`)
  return el
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`2027-01-13T12:00:00`))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Plan page', () => {
  test('no plan: shows "No plan yet. Choose a goal race, then generate weekly targets." and the generate form; no goals shows an Add goal link instead', async () => {
    mockApi(routes(null))
    const first = renderWithProviders(<PlanPage />)

    expect(
      await screen.findByText('No plan yet. Choose a goal race, then generate weekly targets.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Plan', level: 1 })).toBeInTheDocument()
    expect(screen.getByLabelText('Goal')).toHaveValue('g1')
    expect(screen.getByLabelText('Weekly run minutes')).toBeInTheDocument()
    expect(screen.getByLabelText('Plan start (Monday)')).toHaveValue(CURRENT_WEEK)
    expect(
      screen.getByRole('radiogroup', { name: 'Strength sessions per week' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Generate plan' })).toBeInTheDocument()
    first.unmount()

    mockApi(routes(null, {}, []))
    renderWithProviders(<PlanPage />)
    const link = await screen.findByRole('link', { name: 'Add goal' })
    expect(link).toHaveAttribute('href', '/goals')
    expect(screen.queryByRole('button', { name: 'Generate plan' })).not.toBeInTheDocument()
  })

  test('generate posts { goalId, baselineRunMin, startDate, strengthPreference } and shows the server validation message inline (for example no baseline)', async () => {
    const user = userEvent.setup()
    let plan: PlanWithWeeks | null = null
    let attempts = 0
    const { calls } = mockApi(
      routes(null, {
        'GET /api/plan': () => plan,
        'POST /api/plan/generate': () => {
          attempts += 1
          if (attempts === 1) {
            return {
              status: 400,
              body: {
                error: {
                  code: 'validation',
                  message: 'No recent runs to take a baseline from. Enter weekly run minutes.',
                },
              },
            }
          }
          plan = makePlan()
          return { status: 201, body: plan }
        },
      }),
    )
    renderWithProviders(<PlanPage />)

    await user.click(await screen.findByRole('button', { name: 'Generate plan' }))
    expect(
      await screen.findByText('No recent runs to take a baseline from. Enter weekly run minutes.'),
    ).toBeInTheDocument()
    const first = calls.find((c) => c.method === 'POST')?.body as Record<string, unknown>
    expect(first).toEqual({ goalId: 'g1', startDate: CURRENT_WEEK, strengthPreference: 2 })

    await user.type(screen.getByLabelText('Weekly run minutes'), '180')
    await user.click(screen.getByRole('radio', { name: '1' }))
    await user.click(screen.getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2)
    })
    expect(calls.filter((c) => c.method === 'POST')[1]?.body).toEqual({
      goalId: 'g1',
      baselineRunMin: 180,
      startDate: CURRENT_WEEK,
      strengthPreference: 1,
    })
    expect(await screen.findByRole('button', { name: 'Regenerate plan' })).toBeInTheDocument()
  })

  test('week table: phase chips with --phase-level 1..6 (taper and race dashed), cutback rows italic with the word "cutback", race row emphasised, current week aria-current="date", targets via minutesToHours1', async () => {
    mockApi(
      routes(
        makePlan([
          ...phases.map((_, i) =>
            makeWeek(i, i === 2 ? { targetRunMin: 450, baselineRunMin: 450 } : {}),
          ),
        ]),
      ),
    )
    renderWithProviders(<PlanPage />)
    await screen.findByText('Focus 0')

    const chips = [...document.querySelectorAll<HTMLElement>('[data-phase]')]
    expect(chips.map((c) => c.dataset.phase)).toEqual(phases)
    const levels = chips.map((c) => c.style.getPropertyValue('--phase-level'))
    expect(levels).toEqual(['1', '2', '2', '2', '3', '4', '5', '6', '', ''])
    expect(chips.filter((c) => c.dataset.dashed === 'true').map((c) => c.dataset.phase)).toEqual([
      'taper',
      'race',
    ])

    expect(row('2027-01-18')).toHaveAttribute('data-cutback', 'true')
    expect(within(row('2027-01-18')).getByText('cutback')).toBeInTheDocument()
    expect(row('2027-02-15')).toHaveAttribute('data-cutback', 'true')
    expect(screen.getAllByText('cutback')).toHaveLength(2)
    expect(row('2027-03-01')).toHaveAttribute('data-race', 'true')

    const current = document.querySelectorAll('tr[aria-current="date"]')
    expect(current).toHaveLength(1)
    expect(current[0]).toBe(row(CURRENT_WEEK))

    expect(within(row(CURRENT_WEEK)).getByText('7.5 h')).toBeInTheDocument()
    expect(within(row('2027-01-04')).getByText('7.0 h')).toBeInTheDocument()
  })

  test('numeric cells keep number and unit together with a non-breaking space, and a zero long run shows a dash', async () => {
    mockApi(
      routes(
        makePlan(
          phases.map((_, i) =>
            makeWeek(i, i === phases.length - 1 ? { longRunMin: 0 } : { day2Min: 50 }),
          ),
        ),
      ),
    )
    renderWithProviders(<PlanPage />)
    await screen.findByText('Focus 0')

    const cell = (weekStart: string, name: string) =>
      row(weekStart).querySelector(`[data-cell="${name}"]`)
    expect(cell(CURRENT_WEEK, 'target')?.textContent).toContain('7.0 h')
    expect(cell(CURRENT_WEEK, 'long-run')?.textContent).toBe('100 min')
    expect(cell(CURRENT_WEEK, 'day2')?.textContent).toBe('50 min')

    const raceWeek = '2027-03-01'
    expect(cell(raceWeek, 'long-run')?.textContent).toBe('—')
    expect(row(raceWeek)).not.toHaveTextContent('0 min')
  })

  test('edited week shows the baseline struck through, "edited" and the note on focus; a review-sourced week shows "from review"', async () => {
    const weeks = phases.map((_, i) => makeWeek(i))
    weeks[4] = makeWeek(4, {
      targetRunMin: 360,
      targetSource: 'override',
      overrideNote: 'Travel week',
    })
    weeks[5] = makeWeek(5, { targetRunMin: 390, targetSource: 'review' })
    mockApi(routes(makePlan(weeks)))
    renderWithProviders(<PlanPage />)
    await screen.findByText('Focus 0')

    const edited = row(addDays(START, 28))
    const struck = edited.querySelector('s')
    expect(struck).toHaveTextContent('7.0 h')
    expect(within(edited).getByText('6.0 h')).toBeInTheDocument()
    expect(screen.queryByText('Travel week')).not.toBeInTheDocument()
    const marker = within(edited).getByRole('button', { name: 'edited' })
    act(() => {
      marker.focus()
    })
    expect(await screen.findByText('Travel week')).toBeInTheDocument()
    act(() => {
      marker.blur()
    })
    await waitFor(() => {
      expect(screen.queryByText('Travel week')).not.toBeInTheDocument()
    })

    const reviewed = row(addDays(START, 35))
    expect(within(reviewed).getByText('from review')).toBeInTheDocument()
    expect(reviewed.querySelector('s')).toBeNull()
    expect(screen.getAllByText('from review')).toHaveLength(1)
    expect(screen.getAllByText('edited')).toHaveLength(1)
  })

  test('actual hours appear for past weeks from useWeeks and are absent for future weeks', async () => {
    const { calls } = mockApi(
      routes(makePlan(), {
        'GET /api/weeks': () => [
          makeWeekRow({ weekStart: '2026-12-28', runMin: 150 }),
          makeWeekRow({ weekStart: '2027-01-04', runMin: 200 }),
          makeWeekRow({ weekStart: CURRENT_WEEK, runMin: 60 }),
        ],
      }),
    )
    renderWithProviders(<PlanPage />)

    await waitFor(() => {
      expect(within(row('2026-12-28')).getByText('2.5 h')).toBeInTheDocument()
    })
    expect(within(row('2027-01-04')).getByText('3.3 h')).toBeInTheDocument()
    expect(within(row(CURRENT_WEEK)).getByText('1.0 h')).toBeInTheDocument()
    const future = row('2027-01-18').querySelector('[data-cell="actual"]')
    expect(future).not.toBeNull()
    expect(future?.textContent).toBe('')
    expect(calls.some((c) => c.url === `/api/weeks?from=${START}&to=${CURRENT_WEEK}`)).toBe(true)
  })

  test('edit week: target different from baseline without a note shows "Add a note explaining the change" and posts nothing; with a note PUTs { targetRunMin, overrideNote }; Reset to baseline PUTs the baseline value', async () => {
    const user = userEvent.setup()
    const weeks = phases.map((_, i) => makeWeek(i))
    weeks[7] = makeWeek(7, {
      targetRunMin: 360,
      targetSource: 'override',
      overrideNote: 'Travel week',
    })
    const put = vi.fn((): PlanWeek => makeWeek(5))
    const { calls } = mockApi(
      routes(makePlan(weeks), {
        'PUT /api/plan/weeks/2027-02-08': put,
        'PUT /api/plan/weeks/2027-02-15': put,
      }),
    )
    renderWithProviders(<PlanPage />)
    await screen.findByText('Focus 0')

    await user.click(screen.getByRole('button', { name: 'Edit week of 8 Feb' }))
    let dialog = await screen.findByRole('dialog', { name: 'Edit week of 8 Feb' })
    const target = within(dialog).getByLabelText('Target (minutes)')
    expect(target).toHaveValue(420)
    await user.clear(target)
    await user.type(target, '400')
    await user.click(within(dialog).getByRole('button', { name: 'Save week' }))
    expect(await within(dialog).findByText('Add a note explaining the change')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)

    await user.type(within(dialog).getByLabelText('Override note'), 'Race on Saturday')
    await user.click(within(dialog).getByRole('button', { name: 'Save week' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    })
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      url: '/api/plan/weeks/2027-02-08',
      body: { targetRunMin: 400, overrideNote: 'Race on Saturday' },
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Edit week of 15 Feb' }))
    dialog = await screen.findByRole('dialog', { name: 'Edit week of 15 Feb' })
    expect(within(dialog).getByLabelText('Override note')).toHaveValue('Travel week')
    await user.click(within(dialog).getByRole('button', { name: 'Reset to baseline' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2)
    })
    expect(calls.filter((c) => c.method === 'PUT')[1]).toMatchObject({
      url: '/api/plan/weeks/2027-02-15',
      body: { targetRunMin: 420 },
    })
  })

  test('a note on a review-sourced week pins its target as an override; a failed weeks load is stated', async () => {
    const user = userEvent.setup()
    const weeks = phases.map((_, i) => makeWeek(i))
    weeks[5] = makeWeek(5, { targetRunMin: 390, targetSource: 'review' })
    const { calls } = mockApi(
      routes(makePlan(weeks), {
        'GET /api/weeks': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'Something went wrong.' } },
        }),
        'PUT /api/plan/weeks/2027-02-01': () => makeWeek(5),
      }),
    )
    renderWithProviders(<PlanPage />)
    await screen.findByText('Focus 0')
    expect(
      await screen.findByText('Actual hours did not load. Reload the page to try again.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit week of 1 Feb' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit week of 1 Feb' })
    await user.type(within(dialog).getByLabelText('Override note'), 'Keep it here')
    await user.click(within(dialog).getByRole('button', { name: 'Save week' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    })
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      targetRunMin: 390,
      overrideNote: 'Keep it here',
    })
  })

  test('Regenerate plan explains that edited weeks are not carried over and reviews are kept, then posts generate', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(makePlan(), {
        'POST /api/plan/generate': () => ({ status: 201, body: makePlan() }),
      }),
    )
    renderWithProviders(<PlanPage />)

    await user.click(await screen.findByRole('button', { name: 'Regenerate plan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Regenerate plan' })
    expect(
      within(dialog).getByText(/Edited weeks are not carried over\. Reviews are kept\./),
    ).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    await user.type(within(dialog).getByLabelText('Weekly run minutes'), '200')
    await user.click(within(dialog).getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/plan/generate')).toBe(true)
    })
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      goalId: 'g1',
      baselineRunMin: 200,
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
