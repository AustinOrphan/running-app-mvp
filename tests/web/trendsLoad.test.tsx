import { configure, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import type { TrendLoadRun, TrendsLoadView } from '../../shared/domain/trendsLoad.ts'
import type { Units, UserSettings } from '../../shared/types.ts'
import { TrendsPage } from '../../web/pages/TrendsPage.tsx'
import { makeWeekRow } from '../factories.ts'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'

// The charts load as a lazy chunk, which a busy CI runner can take more than the default second.
configure({ asyncUtilTimeout: 6000 })

// The fixed clock is Wednesday 2026-03-18.
const TODAY = '2026-03-18'
const THIS_WEEK = '2026-03-16'

function settings(units: Units): UserSettings {
  return {
    email: 'runner@example.com',
    displayName: null,
    units,
    weightUnit: 'lb',
    showBodyWeight: false,
    hideMapEnds: true,
  }
}

/** An hour-long run `daysAgo` days back with 100 m of gain and 20 minutes in each zone. */
function run(daysAgo: number, over: Partial<TrendLoadRun> = {}): TrendLoadRun {
  return {
    date: addDays(TODAY, -daysAgo),
    durationSec: 3600,
    elevationGainM: 100,
    bandSec: [1200, 1200, 1200],
    ...over,
  }
}

function view(over: Partial<TrendsLoadView> = {}): TrendsLoadView {
  return { asOf: TODAY, zones: { lt1Hr: 140, lt2Hr: 160 }, runs: [], ...over }
}

function mockPage(load: TrendsLoadView | 'error', units: Units = 'km') {
  const weeks = Array.from({ length: 104 }, (_, i) =>
    makeWeekRow({ weekStart: addDays(THIS_WEEK, -7 * (103 - i)), runMin: 240, runM: 40_000 }),
  )
  return mockApi({
    'GET /api/trends/load': () =>
      load === 'error'
        ? { status: 500, body: { error: { code: 'internal', message: 'Something went wrong.' } } }
        : load,
    'GET /api/trends/runs': () => ({ asOf: TODAY, longRuns: [], hrWindows: [] }),
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

/** Runs on four weeks (the week of 23 Feb to this one): one with no gain, one with no usable heart rate. */
const RUNS = [
  run(20),
  run(13, { elevationGainM: null }),
  run(6, { bandSec: null }),
  run(1, { elevationGainM: 250 }),
]

describe('Trends, climbing per week', () => {
  test('sits right after the running weeks, then the intensity panel', async () => {
    mockPage(view({ runs: RUNS }))
    renderWithProviders(<TrendsPage />)
    await screen.findByRole('heading', { level: 2, name: 'Climbing per week' })
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.slice(0, 4)).toEqual([
      'Running per week',
      'Climbing per week',
      'Intensity per week',
      'Heart-rate drift on long runs',
    ])
  })

  test('draws the weeks with their gain, names the runs with none, and promises no correction', async () => {
    mockPage(view({ runs: RUNS }))
    renderWithProviders(<TrendsPage />)
    const chart = await screen.findByRole('img', { name: /^Climbing per week/ })
    expect(chart).toHaveAccessibleName(
      'Climbing per week, since the week of 23 Feb. Latest complete week with elevation: 100 m.',
    )
    expect(
      screen.getByText(
        'Bars are the elevation gain recorded on your runs each week, in metres. The line is the mean of that week and the three before it.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/^3 of 4 runs have elevation\./)).toBeInTheDocument()
    expect(screen.getByText(/barometer or GPS is rough/)).toBeInTheDocument()
    expect(screen.getAllByText('Records start the week of 23 Feb.').length).toBeGreaterThan(0)

    const table = within(chart.closest('figure') as HTMLElement).getByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Week of', 'Runs', 'Runs with elevation', 'Climb', 'Mean of 4 weeks'])
    const rows = within(table).getAllByRole('row').slice(1)
    // 23 Feb, 2 Mar, 9 Mar and this week: the plot starts at the first run.
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      ),
    ).toEqual([
      ['1', '1', '100 m', '25 m'],
      ['1', '0', '–', '33 m'],
      ['1', '1', '100 m', '67 m'],
      ['1', '1', '250 m', '–'],
    ])
  })

  test('words the unit in feet for a runner in miles', async () => {
    mockPage(view({ runs: RUNS }), 'mi')
    renderWithProviders(<TrendsPage />)
    const chart = await screen.findByRole('img', { name: /^Climbing per week/ })
    expect(chart).toHaveAccessibleName(
      'Climbing per week, since the week of 23 Feb. Latest complete week with elevation: 328 ft.',
    )
    expect(screen.getByText(/in feet\. The line is the mean/)).toBeInTheDocument()
    const table = within(chart.closest('figure') as HTMLElement).getByRole('table')
    expect(
      within(table)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toContain('328 ft')
  })

  test('says so, with the count, when no run in the range has elevation', async () => {
    mockPage(view({ runs: [run(12, { elevationGainM: null }), run(5, { elevationGainM: null })] }))
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByText('No elevation recorded in this range yet.')).toBeInTheDocument()
    expect(screen.getByText(/^0 of 2 runs have elevation\./)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^Climbing per week/ })).not.toBeInTheDocument()
  })

  test('says so when the range holds no run', async () => {
    mockPage(view({ runs: [] }))
    renderWithProviders(<TrendsPage />)
    await screen.findByRole('heading', { level: 2, name: 'Climbing per week' })
    expect((await screen.findAllByText('No runs in this range yet.')).length).toBeGreaterThan(1)
  })

  test('follows the range switch without asking the server again', async () => {
    const api = mockPage(
      view({ runs: [run(200, { elevationGainM: 500 }), run(6), run(1, { elevationGainM: 250 })] }),
    )
    renderWithProviders(<TrendsPage />)
    const chart = await screen.findByRole('img', { name: /^Climbing per week/ })
    const table = () => within(chart.closest('figure') as HTMLElement).getByRole('table')
    // 12 months starts at the first run (week of 25 Aug), 30 weeks.
    expect(within(table()).getAllByRole('row').length - 1).toBe(30)
    const loads = () => api.calls.filter((c) => c.url === '/api/trends/load').length
    const before = loads()
    expect(before).toBe(1)
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Range' })).getByRole('radio', {
        name: '6 months',
      }),
    )
    const six = await screen.findByRole('img', { name: /^Climbing per week, last 6 months/ })
    expect(
      within(within(six.closest('figure') as HTMLElement).getByRole('table')).getAllByRole('row')
        .length - 1,
    ).toBe(26)
    expect(loads()).toBe(before)
  })
})

describe('Trends, intensity per week', () => {
  test('draws the zones as they stand today, with the neutral part named in the key and the table', async () => {
    mockPage(view({ runs: RUNS }))
    renderWithProviders(<TrendsPage />)
    const chart = await screen.findByRole('img', { name: /^Intensity per week by zone/ })
    expect(chart).toHaveAccessibleName(
      'Intensity per week by zone, since the week of 23 Feb. Latest complete week: Zone 1 0 min, Zone 2 0 min, Zone 3 0 min, no usable heart rate 60 min.',
    )
    expect(screen.getByText(/zones as they stand today\./)).toBeInTheDocument()
    expect(
      screen.getByText(
        'Zone 1 is up to 140 bpm, Zone 2 is up to 160 bpm and Zone 3 is above, by the heart rate of the zone table on Profile.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/^3 of 4 runs have usable heart rate\./)).toBeInTheDocument()

    const figure = chart.closest('figure') as HTMLElement
    const key = within(figure).getByRole('list', { name: 'Key' })
    expect(
      within(key)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Zone 1', 'Zone 2', 'Zone 3', 'No usable heart rate'])

    const table = within(figure).getByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual([
      'Week of',
      'Runs',
      'Runs with usable heart rate',
      'Zone 1 (min)',
      'Zone 2 (min)',
      'Zone 3 (min)',
      'No usable heart rate (min)',
    ])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      ),
    ).toEqual([
      ['1', '1', '20', '20', '20', '0'],
      ['1', '1', '20', '20', '20', '0'],
      ['1', '0', '0', '0', '0', '60'],
      ['1', '1', '20', '20', '20', '0'],
    ])
    // No line, no comparison, no verdict.
    expect(figure.closest('section')!.textContent).not.toMatch(
      /\b(ratio|risk|plan(ned)? split|target)\b/i,
    )
  })

  test('says the zones are not set, and draws no chart, without a maximum heart rate', async () => {
    mockPage(view({ zones: null, runs: RUNS.map((r) => ({ ...r, bandSec: null })) }))
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByText('No heart-rate zones are set yet.')).toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: /^Intensity per week by zone/ }),
    ).not.toBeInTheDocument()
  })

  test('keeps a week of only unusable runs as one neutral part, never spread over the zones', async () => {
    mockPage(view({ runs: [run(8, { bandSec: null }), run(9, { bandSec: null })] }))
    renderWithProviders(<TrendsPage />)
    const chart = await screen.findByRole('img', { name: /^Intensity per week by zone/ })
    expect(screen.getByText(/^0 of 2 runs have usable heart rate\./)).toBeInTheDocument()
    const table = within(chart.closest('figure') as HTMLElement).getByRole('table')
    // The last row is this week, which holds no run.
    const cells = within(within(table).getAllByRole('row').at(-2)!)
      .getAllByRole('cell')
      .map((c) => c.textContent)
    expect(cells).toEqual(['2', '0', '0', '0', '0', '120'])
  })
})

describe('Trends, the two load panels', () => {
  test('keep every sentence clean under the G5 lint', async () => {
    mockPage(view({ runs: RUNS }))
    const { container } = renderWithProviders(<TrendsPage />)
    await screen.findByRole('img', { name: /^Intensity per week by zone/ })
    await screen.findByRole('img', { name: /^Climbing per week/ })
    expectCleanCopy(container)
  })

  test('tell the failure once, keep their headings, and leave the running weeks', async () => {
    mockPage('error')
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The climbing and intensity data did not load.',
    )
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Climbing and intensity' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /^Run hours per week, last/ })).toBeVisible()
  })
})
