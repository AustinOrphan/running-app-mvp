import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import { ceilingWeeklyRate } from '../../shared/engine/limits.ts'
import { P } from '../../shared/engine/params/index.ts'
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
import { makeProfile } from './plan-fixtures.ts'
import { expectCleanCopy, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import { wristRoutes } from './wrist-fixtures.ts'

const settings: UserSettings = {
  email: 'runner@example.com',
  displayName: null,
  units: 'mi',
  weightUnit: 'lb',
}
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
    plannedRunMin: over.targetRunMin ?? 420,
    overshoot: false,
    targetSource: 'baseline',
    longRunMin: 100,
    day2Min: null,
    runDays: 4,
    strengthSessions: 2,
    overrideNote: null,
    tid: null,
    flags: [],
    gainTargetM: null,
    qualitySessions: 0,
    isRecovery: false,
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
    'GET /api/profile': () => makeProfile(),
    'GET /api/weeks': () => [] as WeekRow[],
    ...wristRoutes(),
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
    // the version-1 fields are gone; the engine options are offered instead
    expect(screen.queryByLabelText('Weekly run minutes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Plan start (Monday)')).not.toBeInTheDocument()
    const cycle = screen.getByRole('radiogroup', { name: 'Easier week' })
    expect(
      within(cycle)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Plan decides', 'Every 4th week', 'Every 3rd week'])
    expect(within(cycle).getByRole('radio', { name: 'Plan decides' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radiogroup', { name: 'Strength sessions a week' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true')
    // a half marathon is not a 5 to 10 km goal
    expect(
      screen.queryByRole('radiogroup', { name: 'Polarized specific phase' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate plan' })).toBeInTheDocument()
    first.unmount()

    mockApi(routes(null, {}, []))
    renderWithProviders(<PlanPage />)
    const link = await screen.findByRole('link', { name: 'Add goal' })
    expect(link).toHaveAttribute('href', '/goals')
    expect(screen.queryByRole('button', { name: 'Generate plan' })).not.toBeInTheDocument()
  })

  test('generate posts { goalId, options } and shows the server validation message inline', async () => {
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
                  message: 'The goal date is in the past.',
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
    expect(await screen.findByText('The goal date is in the past.')).toBeInTheDocument()
    const first = calls.find((c) => c.method === 'POST')?.body as Record<string, unknown>
    // the plan decides the cycle until the runner chooses one, so none is sent
    expect(first).toEqual({
      goalId: 'g1',
      options: { strengthSessions: 2, loadAppetite: 'steady' },
    })

    await user.click(screen.getByRole('radio', { name: 'Every 3rd week' }))
    await user.click(screen.getByRole('radio', { name: '1' }))
    await user.click(screen.getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2)
    })
    expect(calls.filter((c) => c.method === 'POST')[1]?.body).toEqual({
      goalId: 'g1',
      options: { recoveryCycle: '2:1', strengthSessions: 1, loadAppetite: 'steady' },
    })
    expect(await screen.findByRole('button', { name: 'Regenerate plan' })).toBeInTheDocument()
  })

  test('a 5 or 10 km goal offers the polarized specific phase, off by default, and sends it when on', async () => {
    const user = userEvent.setup()
    const short: Goal = { ...goal, distanceM: 10_000 }
    const { calls } = mockApi(
      routes(null, { 'POST /api/plan/generate': () => ({ status: 201, body: makePlan() }) }, [
        short,
      ]),
    )
    renderWithProviders(<PlanPage />)

    const group = await screen.findByRole('radiogroup', { name: 'Polarized specific phase' })
    expect(within(group).getByRole('radio', { name: 'Off' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      goalId: 'g1',
      options: { strengthSessions: 2, loadAppetite: 'steady' },
    })

    await user.click(within(group).getByRole('radio', { name: 'On' }))
    await user.click(screen.getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2)
    })
    expect(calls.filter((c) => c.method === 'POST')[1]?.body).toEqual({
      goalId: 'g1',
      options: {
        strengthSessions: 2,
        loadAppetite: 'steady',
        tidModel: 'polarized',
      },
    })
  })

  test('a week flagged post-race reads "After the race", the race week "Race week"', async () => {
    const weeks = phases.map((_, i) => makeWeek(i))
    const after = makeWeek(phases.length, { phase: 'race', flags: ['post-race'] })
    mockApi(routes(makePlan([...weeks, after])))
    renderWithProviders(<PlanPage />)
    await screen.findByText('Focus 2')

    expect(within(row(weeks[9]!.weekStart)).getByText('Race week')).toBeInTheDocument()
    expect(within(row(after.weekStart)).getByText('After the race')).toBeInTheDocument()
    expect(within(row(after.weekStart)).queryByText('Race week')).not.toBeInTheDocument()
    expect(row(after.weekStart)).not.toHaveAttribute('data-race')
    expect(screen.getAllByText('Race week')).toHaveLength(1)
  })

  test('week table: phase chips with --phase-level 1..6 (taper and race dashed), cutback rows italic with the word "cutback", race row emphasised, current week aria-current="date", targets via minutesToHours1', async () => {
    const user = userEvent.setup()
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
    await screen.findByText('Focus 2')
    await user.click(screen.getByRole('button', { name: 'Earlier weeks (2)' }))

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

  test('the weeks before this Monday sit behind "Earlier weeks (2)", closed, with the current week first', async () => {
    const user = userEvent.setup()
    mockApi(routes(makePlan()))
    renderWithProviders(<PlanPage />)
    await screen.findByText('Focus 2')

    const toggle = screen.getByRole('button', { name: 'Earlier weeks (2)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const rows = () =>
      [...document.querySelectorAll<HTMLElement>('tr[data-week]')].map((tr) => tr.dataset.week)
    // closed: the table opens on the current week, then the weeks after it
    expect(rows()[0]).toBe(CURRENT_WEEK)
    expect(rows()).toHaveLength(phases.length - 2)
    expect(screen.queryByRole('button', { name: 'Edit week of 28 Dec' })).not.toBeInTheDocument()
    // the fold is the first row of the table, above the current week
    const first = document.querySelector('tbody tr')
    expect(first).toContainElement(toggle)

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(rows()).toHaveLength(phases.length)
    expect(rows()[0]).toBe(START)
    expect(rows()[2]).toBe(CURRENT_WEEK)
    expect(screen.getByRole('button', { name: 'Edit week of 28 Dec' })).toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(rows()[0]).toBe(CURRENT_WEEK)
  })

  test('a plan that today has not reached, or has left, shows every week with no fold', async () => {
    mockApi(routes(makePlan()))
    vi.setSystemTime(new Date('2026-12-01T12:00:00'))
    const before = renderWithProviders(<PlanPage />)
    await screen.findByText('Focus 2')
    expect(screen.queryByRole('button', { name: /Earlier weeks/ })).not.toBeInTheDocument()
    expect(document.querySelectorAll('tr[data-week]')).toHaveLength(phases.length)
    before.unmount()

    vi.setSystemTime(new Date('2027-06-01T12:00:00'))
    renderWithProviders(<PlanPage />)
    await screen.findByText('Focus 2')
    expect(screen.queryByRole('button', { name: /Earlier weeks/ })).not.toBeInTheDocument()
    expect(document.querySelectorAll('tr[data-week]')).toHaveLength(phases.length)
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
    await screen.findByText('Focus 2')

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
    await screen.findByText('Focus 2')

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
    const user = userEvent.setup()
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

    await user.click(await screen.findByRole('button', { name: 'Earlier weeks (2)' }))
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
    await screen.findByText('Focus 2')

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
    await screen.findByText('Focus 2')
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

    await user.click(within(dialog).getByRole('radio', { name: 'Every 3rd week' }))
    await user.click(within(dialog).getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/plan/generate')).toBe(true)
    })
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      goalId: 'g1',
      options: { recoveryCycle: '2:1', strengthSessions: 2, loadAppetite: 'steady' },
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

describe('Plan page, the load setting on the Generate form', () => {
  /** A fraction as the copy writes it: 0.12 reads "12%". */
  const pct = (fraction: number) => `${String(Math.round(fraction * 1000) / 10)}%`
  const STEADY = "Adds up to 10% a week, the plan's usual step."
  const STANDARD = `Adds up to ${pct(P.g8.stepStandard.value)} a week while rebuilding toward a level held in the last ${String(P.g8.creditWindowWeeks.value)} weeks.`
  const RESPONSE =
    'Weeks run above the plan raise the starting point of the next week, within the same limits.'
  const UPPER = `Adds up to ${pct(ceilingWeeklyRate())} a week while rebuilding, the most the plan allows (30% over two weeks). Long runs and recovery weeks keep their usual rules.`
  const AGE_RULE = 'At age 45 or over, Upper band is held at Standard.'
  const TRADE_OFF =
    'A faster step brings the earlier weekly level back sooner. Studies comparing weekly increases found no clear difference in injuries between steps of about 10% and about 24%. They followed mostly new runners, and none followed a return after a break, so the effect here is not known. Staying with 10% is the more cautious choice.'

  test('offers Steady, Standard and Upper band, with Steady chosen, its hint and the trade-off line', async () => {
    mockApi(routes(null))
    const { container } = renderWithProviders(<PlanPage />)

    const group = await screen.findByRole('radiogroup', { name: 'Load' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Steady', 'Standard', 'Upper band'])
    expect(within(group).getByRole('radio', { name: 'Steady' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(group).getByRole('radio', { name: 'Standard' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByText(STEADY)).toBeInTheDocument()
    expect(screen.getByText(TRADE_OFF)).toBeInTheDocument()
    expect(group).toHaveAccessibleDescription(`${STEADY} ${TRADE_OFF}`)
    expect(screen.queryByText(STANDARD)).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('each position shows its own hint, and Upper band adds the age rule', async () => {
    const user = userEvent.setup()
    mockApi(routes(null))
    const { container } = renderWithProviders(<PlanPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Load' })

    await user.click(within(group).getByRole('radio', { name: 'Standard' }))
    expect(screen.getByText(STANDARD)).toBeInTheDocument()
    expect(screen.getByText(RESPONSE)).toBeInTheDocument()
    expect(screen.queryByText(STEADY)).not.toBeInTheDocument()
    expect(screen.queryByText(AGE_RULE)).not.toBeInTheDocument()
    expect(screen.getByText(TRADE_OFF)).toBeInTheDocument()
    expectCleanCopy(container)

    await user.click(within(group).getByRole('radio', { name: 'Upper band' }))
    expect(screen.getByText(UPPER)).toBeInTheDocument()
    expect(screen.getByText(AGE_RULE)).toBeInTheDocument()
    expect(screen.queryByText(STANDARD)).not.toBeInTheDocument()
    expect(screen.getByText(TRADE_OFF)).toBeInTheDocument()
    expectCleanCopy(container)

    await user.click(within(group).getByRole('radio', { name: 'Steady' }))
    expect(screen.getByText(STEADY)).toBeInTheDocument()
    expect(screen.queryByText(AGE_RULE)).not.toBeInTheDocument()
  })

  test('the chosen position is sent as options.loadAppetite, steady by default', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(null, { 'POST /api/plan/generate': () => ({ status: 201, body: makePlan() }) }),
    )
    renderWithProviders(<PlanPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Load' })
    const sent = () =>
      calls.filter((c) => c.method === 'POST' && c.url === '/api/plan/generate').map((c) => c.body)

    await user.click(screen.getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(sent()).toHaveLength(1)
    })
    await user.click(within(group).getByRole('radio', { name: 'Standard' }))
    await user.click(screen.getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(sent()).toHaveLength(2)
    })
    await user.click(within(group).getByRole('radio', { name: 'Upper band' }))
    await user.click(screen.getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(sent()).toHaveLength(3)
    })
    expect(sent()).toEqual(
      (['steady', 'standard', 'upper'] as const).map((loadAppetite) => ({
        goalId: 'g1',
        options: { strengthSessions: 2, loadAppetite },
      })),
    )
  })
})

describe('Plan page, the recovery cycle on the Generate form', () => {
  const AUTO = [
    'The plan chooses the rhythm: a lighter week every 4th week.',
    `It comes every 3rd week for a new runner, for one under ${String(P.a5.lowFrequencyRunsPerWeek.value)} runs a week and after a recent injury.`,
  ]
  const USUAL = [
    'Three building weeks, then a lighter one, even for a new or low-frequency runner.',
    'A recent injury on file still gives every 3rd week.',
  ]
  const SHORT = [
    'Two building weeks, then a lighter one. It suits a new runner or a return from a break.',
  ]

  test('starts on "Plan decides", and each choice says what it does', async () => {
    const user = userEvent.setup()
    mockApi(routes(null))
    const { container } = renderWithProviders(<PlanPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Easier week' })

    expect(within(group).getByRole('radio', { name: 'Plan decides' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(group).toHaveAccessibleDescription(AUTO.join(' '))
    expectCleanCopy(container)

    await user.click(within(group).getByRole('radio', { name: 'Every 4th week' }))
    expect(group).toHaveAccessibleDescription(USUAL.join(' '))
    expectCleanCopy(container)

    await user.click(within(group).getByRole('radio', { name: 'Every 3rd week' }))
    expect(group).toHaveAccessibleDescription(SHORT.join(' '))
    expectCleanCopy(container)
  })

  test('sends no recoveryCycle until one is chosen, then sends the one chosen', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(null, { 'POST /api/plan/generate': () => ({ status: 201, body: makePlan() }) }),
    )
    renderWithProviders(<PlanPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Easier week' })
    const sent = () =>
      calls
        .filter((c) => c.method === 'POST' && c.url === '/api/plan/generate')
        .map((c) => (c.body as { options: Record<string, unknown> }).options)
    const generate = async (count: number) => {
      await user.click(screen.getByRole('button', { name: 'Generate plan' }))
      await waitFor(() => {
        expect(sent()).toHaveLength(count)
      })
    }

    await generate(1)
    await user.click(within(group).getByRole('radio', { name: 'Every 4th week' }))
    await generate(2)
    await user.click(within(group).getByRole('radio', { name: 'Every 3rd week' }))
    await generate(3)
    // going back to the plan's own decision takes the option out again
    await user.click(within(group).getByRole('radio', { name: 'Plan decides' }))
    await generate(4)

    expect(sent().map((options) => options.recoveryCycle)).toEqual([
      undefined,
      '3:1',
      '2:1',
      undefined,
    ])
    expect(sent().map((options) => 'recoveryCycle' in options)).toEqual([false, true, true, false])
  })
})

describe('Plan page, the plan shape on the Generate form', () => {
  const OWN =
    'Run days follow your weekly minutes and the days you have free, and the base comes first.'
  const THREE =
    "At most three run days a week. The long run and the quality runs stay, and no week plans more minutes than the plan's own shape."
  const BASE =
    "Strides only in the base, for up to two more weeks, then threshold and hill runs. No week plans more minutes than the plan's own shape."
  const GRADE = 'A choice, not a better plan (grade D).'
  const marathon: Goal = { ...goal, id: 'g2', name: 'Autumn marathon', distanceM: 42195 }
  const tenK: Goal = { ...goal, id: 'g3', name: 'City 10 km', distanceM: 10000 }

  /** The generate request options, in the order the requests were sent. */
  const sentOptions = (calls: Array<{ method: string; url: string; body: unknown }>) =>
    calls
      .filter((c) => c.method === 'POST' && c.url === '/api/plan/generate')
      .map((c) => (c.body as { options: Record<string, unknown> }).options)

  test("offers the plan's own shape, three run days and a longer base, each with one line of help", async () => {
    mockApi(routes(null))
    const { container } = renderWithProviders(<PlanPage />)

    const group = await screen.findByRole('radiogroup', { name: 'Plan shape' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual([
      'default',
      'three-run-days',
      'longer-base',
    ])
    expect(within(group).getByRole('radio', { name: "The plan's own shape" })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Three run days a week' })).not.toBeChecked()
    expect(within(group).getByRole('radio', { name: 'A longer base' })).not.toBeChecked()
    expect(within(group).getByText(OWN)).toBeInTheDocument()
    expect(within(group).getByText(THREE)).toBeInTheDocument()
    expect(within(group).getByText(BASE)).toBeInTheDocument()
    // every shape carries the one line that says it is a choice and not a better plan
    expect(within(group).getAllByText(GRADE)).toHaveLength(1)
    expect(group).toHaveAccessibleDescription(GRADE)
    expect(radios.every((radio) => radio instanceof HTMLInputElement && !radio.disabled)).toBe(true)
    // it sits beside the load setting's choice
    const load = screen.getByRole('radiogroup', { name: 'Load' })
    expect(load.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expectCleanCopy(container)
  })

  test("sends the shape chosen as options.method, and nothing for the plan's own shape", async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(null, { 'POST /api/plan/generate': () => ({ status: 201, body: makePlan() }) }),
    )
    renderWithProviders(<PlanPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Plan shape' })
    const generate = async (count: number) => {
      await user.click(screen.getByRole('button', { name: 'Generate plan' }))
      await waitFor(() => {
        expect(sentOptions(calls)).toHaveLength(count)
      })
    }

    await generate(1)
    await user.click(within(group).getByRole('radio', { name: 'Three run days a week' }))
    await generate(2)
    await user.click(within(group).getByRole('radio', { name: 'A longer base' }))
    await generate(3)
    // going back to the plan's own shape takes the option out again
    await user.click(within(group).getByRole('radio', { name: "The plan's own shape" }))
    await generate(4)

    expect(sentOptions(calls).map((options) => options.method)).toEqual([
      undefined,
      'three-run-days',
      'longer-base',
      undefined,
    ])
    expect(sentOptions(calls).map((options) => 'method' in options)).toEqual([
      false,
      true,
      true,
      false,
    ])
    // the other options are sent as before
    expect(sentOptions(calls)[1]).toEqual({
      strengthSessions: 2,
      loadAppetite: 'steady',
      method: 'three-run-days',
    })
  })

  test('shows three run days disabled with its reason for a marathon goal, and offers the others', async () => {
    mockApi(routes(null, {}, [marathon]))
    const { container } = renderWithProviders(<PlanPage />)

    const group = await screen.findByRole('radiogroup', { name: 'Plan shape' })
    const three = within(group).getByRole('radio', { name: 'Three run days a week' })
    expect(three).toBeDisabled()
    expect(three).toHaveAccessibleDescription(`${THREE} Not for a marathon or longer`)
    expect(within(group).getByText('Not for a marathon or longer')).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: 'A longer base' })).toBeEnabled()
    expect(within(group).getByRole('radio', { name: "The plan's own shape" })).toBeEnabled()
    expectCleanCopy(container)
  })

  test('a shape picked for one goal is not sent for a goal it is not for', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(null, { 'POST /api/plan/generate': () => ({ status: 201, body: makePlan() }) }, [
        goal,
        marathon,
      ]),
    )
    renderWithProviders(<PlanPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Plan shape' })
    await user.click(within(group).getByRole('radio', { name: 'Three run days a week' }))
    expect(within(group).getByRole('radio', { name: 'Three run days a week' })).toBeChecked()

    // the marathon: the choice reads as the plan's own shape, and that is what is sent
    await user.selectOptions(screen.getByLabelText('Goal'), 'g2')
    expect(within(group).getByRole('radio', { name: "The plan's own shape" })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Three run days a week' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(sentOptions(calls)).toHaveLength(1)
    })
    expect('method' in sentOptions(calls)[0]!).toBe(false)

    // back to a goal it is for: the pick is still there
    await user.selectOptions(screen.getByLabelText('Goal'), 'g1')
    expect(within(group).getByRole('radio', { name: 'Three run days a week' })).toBeChecked()
  })

  test('a 10 km goal offers three run days', async () => {
    mockApi(routes(null, {}, [tenK]))
    renderWithProviders(<PlanPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Plan shape' })
    expect(within(group).getByRole('radio', { name: 'Three run days a week' })).toBeEnabled()
    expect(within(group).queryByText('Not for a marathon or longer')).not.toBeInTheDocument()
  })

  test.each([
    [5, 'You have 5 days open; three run days leave two free.'],
    [7, 'You have 7 days open; three run days leave four free.'],
    [3, 'You have 3 days open; three run days use all of them.'],
    [2, 'You have 2 days open, fewer than three run days.'],
  ])('states the days open from the profile as a note: %i days', async (open, note) => {
    mockApi(routes(null, { 'GET /api/profile': () => makeProfile(open) }))
    const { container } = renderWithProviders(<PlanPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Plan shape' })

    expect(await within(group).findByText(note)).toBeInTheDocument()
    expect(
      within(group).getByRole('radio', { name: 'Three run days a week' }),
    ).toHaveAccessibleDescription(`${THREE} ${note}`)
    // a note and not a score: nothing else on the form counts days or rates the shape
    expect(within(group).getAllByText(/days open/)).toHaveLength(1)
    expectCleanCopy(container)
  })

  test('adds no note when the profile does not load, and the form still works', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(null, {
        'GET /api/profile': () => ({ status: 500, body: { error: { code: 'x', message: 'no' } } }),
        'POST /api/plan/generate': () => ({ status: 201, body: makePlan() }),
      }),
    )
    renderWithProviders(<PlanPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Plan shape' })
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/profile')).toBe(true)
    })
    expect(within(group).queryByText(/days open/)).not.toBeInTheDocument()
    await user.click(within(group).getByRole('radio', { name: 'Three run days a week' }))
    await user.click(screen.getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(sentOptions(calls)).toHaveLength(1)
    })
    expect(sentOptions(calls)[0]).toMatchObject({ method: 'three-run-days' })
  })

  test('names no hold when a plan is first generated: the server reports none yet', async () => {
    const user = userEvent.setup()
    mockApi(routes(null))
    renderWithProviders(<PlanPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Plan shape' })
    await user.click(within(group).getByRole('radio', { name: 'A longer base' }))
    expect(within(group).queryByText(/Held at the plan's own shape/)).not.toBeInTheDocument()
  })
})
