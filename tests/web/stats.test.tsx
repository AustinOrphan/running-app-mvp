import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { StatsPage } from '../../web/pages/StatsPage.tsx'
import type { Activity, Units, UserSettings, WeekRow } from '../../shared/types.ts'
import { addDays } from '../../shared/dates.ts'
import { statsOf } from '../../shared/domain/stats.ts'
import { makeActivity, makeWeekRow } from '../factories.ts'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'

// The fixed clock is Wednesday 2026-03-18; 26 weeks end on Monday 2026-03-16.
const FIRST_WEEK = '2025-09-22'

function settings(units: Units): UserSettings {
  return { email: 'runner@example.com', displayName: null, units }
}

function history(): WeekRow[] {
  return Array.from({ length: 26 }, (_, i) => {
    const weekStart = addDays(FIRST_WEEK, 7 * i)
    if (i === 25) {
      return makeWeekRow({
        weekStart,
        runMin: 150,
        runM: 24000,
        runSessions: 3,
        runDays: 3,
        longestRunMin: 75,
        longRunShare: 0.5,
      })
    }
    return makeWeekRow({ weekStart })
  })
}

const activities = [
  makeActivity({ id: 'r1', date: '2025-11-02', durationSec: 1500, distanceM: 5000 }),
  makeActivity({ id: 'r2', date: '2026-01-10', durationSec: 6000, distanceM: 21200 }),
  makeActivity({ id: 'r3', date: '2026-02-03', durationSec: 1380, distanceM: 5050 }),
  makeActivity({ id: 'r4', date: '2026-02-20', durationSec: 420, distanceM: 1620 }),
  makeActivity({
    id: 'dup',
    date: '2026-02-21',
    durationSec: 9000,
    distanceM: 30000,
    duplicateStatus: 'possible',
    duplicateOfId: 'r4',
  }),
  makeActivity({
    id: 's1',
    date: '2026-02-22',
    type: 'strength',
    durationSec: 1800,
    distanceM: null,
  }),
]

/** The page reads `GET /api/stats`; the server's figures are `statsOf` over the same rows. */
function mockStats(opts: { units?: Units; activities?: Activity[]; weeks?: WeekRow[] } = {}) {
  return mockApi({
    'GET /api/stats': () => statsOf(opts.activities ?? activities),
    'GET /api/weeks': () => opts.weeks ?? history(),
    'GET /api/settings': () => settings(opts.units ?? 'mi'),
  })
}

function cellTexts(row: HTMLElement): Array<string | null> {
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('StatsPage', () => {
  test('monthly totals, yearly totals, longest runs and fastest efforts render from activities in the user units', async () => {
    mockStats()
    renderWithProviders(<StatsPage />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Stats' })).toBeInTheDocument()

    const monthly = await screen.findByRole('table', { name: 'Monthly totals' })
    expect(cellTexts(within(monthly).getByRole('row', { name: /Feb 2026/ }))).toEqual([
      '0.5',
      '2',
      '4.14 mi',
      '23 min',
    ])

    const yearly = screen.getByRole('table', { name: 'Yearly totals' })
    expect(cellTexts(within(yearly).getByRole('row', { name: /2026/ }))).toEqual([
      '2.2',
      '3',
      '17.32 mi',
    ])
    expect(within(yearly).getByRole('row', { name: /2025/ })).toBeInTheDocument()

    const longest = screen.getByRole('table', { name: 'Longest runs' })
    const rows = within(longest).getAllByRole('row')
    expect(cellTexts(rows[1] as HTMLElement)).toEqual(['1:40:00', '13.17 mi', '7:35 /mi'])
    expect(within(rows[1] as HTMLElement).getByRole('rowheader')).toHaveTextContent('10 Jan 2026')
    expect(rows).toHaveLength(5)

    const efforts = screen.getByRole('table', { name: 'Fastest efforts' })
    const fiveK = within(efforts).getByRole('row', { name: /5K/ })
    expect(cellTexts(fiveK)).toEqual(['23:00', '7:20 /mi', '3.14 mi', '3 Feb 2026'])
  })

  test('the tables show at once and the two charts arrive with their own code', async () => {
    mockStats()
    renderWithProviders(<StatsPage />)
    const monthly = await screen.findByRole('table', { name: 'Monthly totals' })
    expect(within(monthly).getByRole('row', { name: /Feb 2026/ })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Run hours per month' })).toBeInTheDocument()
    expect(
      await screen.findByRole('img', { name: 'Run hours per week, last 12 weeks' }),
    ).toBeInTheDocument()
  })

  test('reads the statistics from the server and requests no activities', async () => {
    const { calls } = mockStats()
    const { container } = renderWithProviders(<StatsPage />)
    await screen.findByRole('table', { name: 'Monthly totals' })

    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0]}`).sort()).toEqual([
      'GET /api/settings',
      'GET /api/stats',
      'GET /api/weeks',
    ])
    expectCleanCopy(container)
  })

  test('says so when the statistics did not load', async () => {
    mockApi({
      'GET /api/stats': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Something went wrong on the server.' } },
      }),
      'GET /api/weeks': () => history(),
      'GET /api/settings': () => settings('mi'),
    })
    renderWithProviders(<StatsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Stats did not load. Reload the page to try again.',
    )
  })

  test('the header says totals come from runs and that races count only for fastest efforts', async () => {
    mockStats()
    renderWithProviders(<StatsPage />)
    expect(
      await screen.findByText(
        'Totals and longest runs use runs only; races count toward fastest efforts; flagged duplicates are left out',
      ),
    ).toBeInTheDocument()
  })

  test('the same figures follow the kilometre setting', async () => {
    mockStats({ units: 'km' })
    renderWithProviders(<StatsPage />)
    const efforts = await screen.findByRole('table', { name: 'Fastest efforts' })
    const fiveK = within(efforts).getByRole('row', { name: /5K/ })
    expect(cellTexts(fiveK)).toEqual(['23:00', '4:33 /km', '5.05 km', '3 Feb 2026'])
  })

  test('fastest efforts with sparse data say which distances have no qualifying run and that a run counts from 0.5% under to 2% over the distance', async () => {
    mockStats()
    renderWithProviders(<StatsPage />)
    await screen.findByRole('table', { name: 'Fastest efforts' })
    expect(screen.getByText('No qualifying run yet for 10K, Marathon, 50K.')).toBeInTheDocument()
    expect(
      screen.getByText('A run counts for a distance when it is within 0.5% under to 2% over it.'),
    ).toBeInTheDocument()
  })

  test('weekly history table lists the last 26 weeks with run hours, runs, run days and long-run share (an en dash when null)', async () => {
    mockStats()
    renderWithProviders(<StatsPage />)
    const table = await screen.findByRole('table', { name: 'Weekly history, last 26 weeks' })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(27)
    // Newest week first.
    expect(within(rows[1] as HTMLElement).getByRole('rowheader')).toHaveTextContent('16 Mar')
    expect(cellTexts(rows[1] as HTMLElement)).toEqual(['2.5', '3', '3', '50%'])
    expect(cellTexts(rows[2] as HTMLElement)).toEqual(['0.0', '0', '0', '–'])
  })

  test('no runs: "No runs yet. Stats appear after the first run." and no charts', async () => {
    mockStats({ activities: [], weeks: [] })
    const { container } = renderWithProviders(<StatsPage />)
    expect(
      await screen.findByText('No runs yet. Stats appear after the first run.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/NaN|Infinity|0:00/)
  })
})
