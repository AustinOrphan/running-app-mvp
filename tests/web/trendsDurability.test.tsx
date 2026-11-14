import { configure, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import type {
  DurabilityHour,
  DurabilityRun,
  TrendsDurabilityView,
} from '../../shared/domain/durabilityByHour.ts'
import type { Units, UserSettings } from '../../shared/types.ts'
import { TrendsPage } from '../../web/pages/TrendsPage.tsx'
import { makeWeekRow } from '../factories.ts'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'

configure({ asyncUtilTimeout: 6000 })

// The fixed clock is Wednesday 2026-03-18.
const TODAY = '2026-03-18'
const THIS_WEEK = '2026-03-16'

const settings = (units: Units): UserSettings => ({
  email: 'runner@example.com',
  displayName: null,
  units,
  weightUnit: 'lb',
  showBodyWeight: false,
  hideMapEnds: true,
})

const hour = (n: number, over: Partial<DurabilityHour> = {}): DurabilityHour => ({
  hour: n,
  partial: false,
  minutes: 60,
  paceSecPerKm: 330 + n * 6,
  hrBpm: 138 + n,
  ...over,
})

function run(id: string, daysAgo: number, over: Partial<DurabilityRun> = {}): DurabilityRun {
  return {
    activityId: id,
    date: addDays(TODAY, -daysAgo),
    type: 'run',
    durationSec: 4 * 3600 + 120,
    fuel: 'none',
    hours: [hour(1), hour(2), hour(3), hour(4)],
    hrGap: null,
    ...over,
  }
}

function view(over: Partial<TrendsDurabilityView> = {}): TrendsDurabilityView {
  return { asOf: TODAY, runs: [], leftOut: [], ...over }
}

function mockPage(durability: TrendsDurabilityView | 'error', units: Units = 'km') {
  const weeks = Array.from({ length: 104 }, (_, i) =>
    makeWeekRow({ weekStart: addDays(THIS_WEEK, -7 * (103 - i)), runMin: 240, runM: 40_000 }),
  )
  return mockApi({
    'GET /api/trends/load': () => ({ asOf: TODAY, zones: null, runs: [] }),
    'GET /api/trends/runs': () => ({ asOf: TODAY, longRuns: [], hrWindows: [] }),
    'GET /api/trends/durability': () =>
      durability === 'error'
        ? { status: 500, body: { error: { code: 'internal', message: 'Something went wrong.' } } }
        : durability,
    'GET /api/trends': () => ({
      asOf: TODAY,
      recovery: { hrv: [], restingHr: [], sleep: [], cycleBaseline: false },
    }),
    'GET /api/weeks': () => weeks,
    'GET /api/settings': () => settings(units),
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0))
  localStorage.removeItem('trends-range')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.removeItem('trends-range')
})

/** The section once its read has finished (the skeleton is gone). */
const panel = async () => {
  const region = await screen.findByRole('region', { name: /Long runs by the hour/ })
  await waitFor(() => expect(within(region).queryByLabelText('Loading')).toBeNull())
  return within(region)
}

describe('Trends, long runs by the hour', () => {
  test('lists each run in the group of its fuel log, hours across, pace over heart rate', async () => {
    mockPage(
      view({
        runs: [
          run('a1', 40, { fuel: 'logged' }),
          run('a2', 12, { fuel: 'none', hours: [hour(1), hour(2), hour(3)] }),
        ],
      }),
    )
    renderWithProviders(<TrendsPage />)
    const section = await panel()

    expect(section.getByRole('heading', { level: 2, name: 'Long runs by the hour' })).toBeVisible()
    expect(section.getByRole('heading', { level: 3, name: 'With a fuel log' })).toBeVisible()
    expect(section.getByRole('heading', { level: 3, name: 'No fuel log' })).toBeVisible()
    expect(section.getByText(/^One row for each run or race of 3 h or longer/)).toBeVisible()

    const logged = section.getByRole('region', { name: /^With a fuel log: / })
    const rowLogged = within(logged).getByRole('row', { name: /2026-02-06/ })
    expect(
      within(logged)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Run', 'Hour 1', 'Hour 2', 'Hour 3', 'Hour 4'])
    expect(within(rowLogged).getByRole('link', { name: '2026-02-06' })).toHaveAttribute(
      'href',
      '/activities/a1',
    )
    expect(within(rowLogged).getByText('4:02:00')).toBeVisible()
    // Hour 1: 336 s/km on grade-adjusted pace and 139 bpm.
    expect(within(rowLogged).getAllByRole('cell')[0]).toHaveTextContent('5:36 /km139 bpm')
    expect(within(rowLogged).getAllByRole('cell')[3]).toHaveTextContent('5:54 /km142 bpm')

    const none = section.getByRole('region', { name: /^No fuel log: / })
    // The shorter run has no fourth hour: an empty cell, not a figure.
    const cells = within(within(none).getByRole('row', { name: /2026-03-06/ })).getAllByRole('cell')
    expect(cells).toHaveLength(4)
    expect(cells[3]).toBeEmptyDOMElement()
  })

  test('shows a gap where an hour has no figure, and no figure where the run has none', async () => {
    mockPage(
      view({
        runs: [
          run('a1', 10, {
            hours: [hour(1), hour(2, { paceSecPerKm: null, hrBpm: null }), hour(3), hour(4)],
          }),
        ],
      }),
    )
    renderWithProviders(<TrendsPage />)
    const section = await panel()
    const row = section.getByRole('row', { name: /2026-03-08/ })
    // The dash is hidden from a screen reader and the words are read in its place.
    expect(within(row).getAllByText('–')).toHaveLength(2)
    expect(within(row).getByText('No pace')).toBeInTheDocument()
    expect(within(row).getByText('No heart rate')).toBeInTheDocument()
  })

  test('a run whose heart rate failed the checks keeps its pace and names the reason', async () => {
    mockPage(view({ runs: [run('a1', 10, { hrGap: 'dropouts' })] }))
    renderWithProviders(<TrendsPage />)
    const section = await panel()
    const row = section.getByRole('row', { name: /2026-03-08/ })
    expect(within(row).getByText('Heart rate left out: the heart rate has gaps.')).toBeVisible()
    expect(within(row).getAllByText(/\/km$/)).toHaveLength(4)
    expect(within(row).queryByText(/bpm/)).toBeNull()
    expect(
      section.getByText('Runs with heart rate left out because it did not pass the checks: 1.'),
    ).toBeVisible()
  })

  test('marks a part-hour with its minutes and a race as a race', async () => {
    mockPage(
      view({
        runs: [
          run('a1', 10, {
            type: 'race',
            hours: [hour(1), hour(2), hour(3), hour(4, { partial: true, minutes: 41 })],
          }),
        ],
      }),
    )
    renderWithProviders(<TrendsPage />)
    const section = await panel()
    const row = section.getByRole('row', { name: /2026-03-08/ })
    expect(within(row).getByText('4:02:00, race')).toBeVisible()
    expect(within(row).getByText('41 min')).toBeVisible()
    expect(
      section.getByText(/^A last part-hour is shown when it holds at least 30 min/),
    ).toBeVisible()
  })

  test('says it describes the runs, the plan does not read it, and A7 infers nothing past 3 h', async () => {
    mockPage(view({ runs: [run('a1', 10)] }))
    renderWithProviders(<TrendsPage />)
    const section = await panel()
    expect(
      section.getByText(
        'This describes the runs; the plan does not read it. Rule A7 makes no fitness inference beyond 3 h.',
      ),
    ).toBeVisible()
  })

  test('counts the runs it leaves out and why', async () => {
    mockPage(
      view({
        runs: [run('a1', 10)],
        leftOut: [
          { date: addDays(TODAY, -30), reason: 'no-stream' },
          { date: addDays(TODAY, -40), reason: 'no-stream' },
          { date: addDays(TODAY, -50), reason: 'no-grade' },
        ],
      }),
    )
    renderWithProviders(<TrendsPage />)
    const section = await panel()
    expect(
      section.getByText(
        'Of the runs of that length, not shown: 2 with no stored stream, 1 with no usable altitude profile.',
      ),
    ).toBeVisible()
  })

  test('counts only the left-out runs of the range shown, as the rows are', async () => {
    mockPage(
      view({
        runs: [run('a1', 10)],
        leftOut: [
          { date: addDays(TODAY, -30), reason: 'no-stream' },
          { date: addDays(TODAY, -400), reason: 'no-stream' },
          { date: addDays(TODAY, -500), reason: 'no-grade' },
        ],
      }),
    )
    renderWithProviders(<TrendsPage />)
    const section = await panel()
    // The default range is 12 months: the two runs of more than a year ago are not counted.
    expect(
      section.getByText(
        'Of the runs of that length, not shown: 1 with no stored stream, 0 with no usable altitude profile.',
      ),
    ).toBeVisible()
  })

  test('says a run whose checks have not run is not one that failed them', async () => {
    mockPage(
      view({ runs: [run('a1', 10, { hrGap: 'not-checked' }), run('a2', 20, { hrGap: 'spikes' })] }),
    )
    renderWithProviders(<TrendsPage />)
    const section = await panel()
    expect(
      section.getByText('Runs with heart rate left out because it did not pass the checks: 1.'),
    ).toBeVisible()
    expect(
      section.getByText(
        'Runs with heart rate left out because the checks have not run on them yet: 1.',
      ),
    ).toBeVisible()
  })

  test('is type only when no run qualifies, and still counts what was left out', async () => {
    mockPage(view({ leftOut: [{ date: addDays(TODAY, -30), reason: 'no-stream' }] }))
    renderWithProviders(<TrendsPage />)
    const section = await panel()
    expect(section.getByText('No runs of that length to show yet.')).toBeVisible()
    expect(section.queryByRole('table')).toBeNull()
    expect(section.queryByRole('img')).toBeNull()
    expect(
      section.getByText(/^Of the runs of that length, not shown: 1 with no stored stream/),
    ).toBeVisible()
  })

  test('words the pace in miles for a runner in miles', async () => {
    mockPage(view({ runs: [run('a1', 10)] }), 'mi')
    renderWithProviders(<TrendsPage />)
    const section = await panel()
    expect(section.getAllByText(/\/mi$/).length).toBeGreaterThan(0)
  })

  test('tells a failed read once and keeps the heading', async () => {
    mockPage('error')
    renderWithProviders(<TrendsPage />)
    const section = await panel()
    expect(await section.findByRole('alert')).toBeVisible()
    expect(section.getByRole('heading', { level: 2, name: 'Long runs by the hour' })).toBeVisible()
  })

  test('keeps every sentence clean under the G5 lint and draws no verdict', async () => {
    mockPage(
      view({
        runs: [run('a1', 10, { fuel: 'logged' }), run('a2', 20, { hrGap: 'spikes' })],
        leftOut: [
          { date: addDays(TODAY, -30), reason: 'no-stream' },
          { date: addDays(TODAY, -50), reason: 'no-grade' },
        ],
      }),
    )
    renderWithProviders(<TrendsPage />)
    const section = await panel()
    expectCleanCopy(section.getByRole('heading', { level: 2 }).closest('section')!)
    const text = section.getByRole('heading', { level: 2 }).closest('section')!.textContent ?? ''
    expect(text).not.toMatch(/fade|decline|drop|worse|better|behind|missed|target|unfuelled/i)
  })
})
