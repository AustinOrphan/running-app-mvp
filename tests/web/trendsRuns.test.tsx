import { configure, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import { hrWindows, longRunReadings, type TrendsRunsView } from '../../shared/domain/trendsRuns.ts'
import type { Units, UserSettings } from '../../shared/types.ts'
import { TrendsPage } from '../../web/pages/TrendsPage.tsx'
import { makeWeekRow, steadyTrendRun, trendRun } from '../factories.ts'
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
  }
}

/** Fifty steady flat runs, one every four days, on the line HR = 90 + 20 x speed, 2.4 to 3.0 m/s. */
const STEADY = Array.from({ length: 50 }, (_, i) =>
  steadyTrendRun(TODAY, 2 + i * 4, 2.4 + (i % 7) * 0.1),
)

/** Two-hour runs on cool days every week, drifting 2 to 7 percent, `count` of them. */
function longRuns(count: number) {
  return longRunReadings(
    Array.from({ length: count }, (_, i) =>
      trendRun({
        date: addDays(TODAY, -10 - 7 * i),
        durationSec: (115 + (i % 3) * 5) * 60,
        decouplingPct: 2 + (i % 6),
        tempC: 12 + (i % 4),
      }),
    ),
  )
}

function view(over: Partial<TrendsRunsView> = {}): TrendsRunsView {
  return { asOf: TODAY, longRuns: [], hrWindows: hrWindows([], TODAY), ...over }
}

function mockPage(runs: TrendsRunsView | 'error', units: Units = 'km') {
  const weeks = Array.from({ length: 104 }, (_, i) =>
    makeWeekRow({ weekStart: addDays(THIS_WEEK, -7 * (103 - i)), runMin: 240, runM: 40_000 }),
  )
  return mockApi({
    'GET /api/trends/runs': () =>
      runs === 'error'
        ? { status: 500, body: { error: { code: 'internal', message: 'Something went wrong.' } } }
        : runs,
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

describe('Trends, heart-rate drift on long runs', () => {
  test('sits between the running weeks and the recovery readings', async () => {
    mockPage(view({ longRuns: longRuns(6) }))
    renderWithProviders(<TrendsPage />)
    await screen.findByRole('heading', { level: 2, name: 'Heart-rate drift on long runs' })
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.slice(0, 4)).toEqual([
      'Running per week',
      'Heart-rate drift on long runs',
      'Heart rate at one speed',
      'Recovery readings',
    ])
  })

  test('draws a dot per run with its median, described and not judged', async () => {
    mockPage(view({ longRuns: longRuns(6) }))
    const { container } = renderWithProviders(<TrendsPage />)
    const chart = await screen.findByRole('img', { name: /^Heart-rate drift of 6 flat runs/ })
    expect(chart).toHaveAccessibleName(
      'Heart-rate drift of 6 flat runs, last 12 months. Latest 2% on 8 Mar.',
    )
    // The sentence of the median line is a template over the engine's own group (rule A7).
    expect(
      screen.getByText(/^Median \d(\.\d)?% over 6 comparable runs of about 2 h on cool days\.$/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Filled dots are runs of 90 min to 3 h in air under 25 °C\./),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Comparable runs are within 20% in length and 5 °C/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Runs that climb more than 15 m per km are left out: a climbing second half reads as drift, and wrist heart rate is not trusted on hills.',
      ),
    ).toBeInTheDocument()

    // The hidden table holds the same numbers, one row per run, and says which are in the median.
    const table = within(chart.closest('figure') as HTMLElement).getByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Run on', 'Drift (%)', 'Length (min)', 'Air (°C)', 'In the median'])
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 6)
    expect(within(table).getAllByText('Yes')).toHaveLength(6)
    expectCleanCopy(container)
  })

  test('says how far a thin set is from a median, and what a median needs', async () => {
    mockPage(view({ longRuns: longRuns(2) }))
    renderWithProviders(<TrendsPage />)
    await screen.findByRole('img', { name: /^Heart-rate drift of 2 flat runs/ })
    expect(
      screen.getByText('No median yet: the largest set of comparable runs holds 2 of 3.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Median /)).not.toBeInTheDocument()
  })

  test('draws runs that are not candidates as rings and gives no median for them', async () => {
    // Forty-five minutes is a reading, but not a long run of rule A7.
    const short = longRunReadings(
      Array.from({ length: 4 }, (_, i) =>
        trendRun({ date: addDays(TODAY, -10 - 7 * i), durationSec: 2700, decouplingPct: 3 + i }),
      ),
    )
    mockPage(view({ longRuns: short }))
    renderWithProviders(<TrendsPage />)
    const chart = await screen.findByRole('img', { name: /^Heart-rate drift of 4 flat runs/ })
    const table = within(chart.closest('figure') as HTMLElement).getByRole('table')
    expect(within(table).getAllByText('No')).toHaveLength(4)
    expect(
      screen.getByText(
        'No median yet. It needs 3 comparable runs of 90 min to 3 h in air under 25 °C.',
      ),
    ).toBeInTheDocument()
  })

  test('says what would fill the panel when the range holds no reading', async () => {
    mockPage(view())
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByText('No long-run readings in this range yet.')).toBeInTheDocument()
    expect(
      screen.getByText(/^A reading needs a flat run with a heart-rate stream, from a watch file/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^Heart-rate drift/ })).not.toBeInTheDocument()
  })

  test('draws only the runs of the range, and the range switch moves them', async () => {
    // One run 5 months ago, one 20 months ago: 6 months shows one, 24 months shows both.
    const runs = longRunReadings([
      trendRun({ date: addDays(TODAY, -150), decouplingPct: 3 }),
      trendRun({ date: addDays(TODAY, -600), decouplingPct: 5 }),
    ])
    mockPage(view({ longRuns: runs }))
    renderWithProviders(<TrendsPage />)
    expect(
      await screen.findByRole('img', { name: /^Heart-rate drift of 1 flat runs, last 12 months/ }),
    ).toBeInTheDocument()
    const group = await screen.findByRole('radiogroup', { name: 'Range' })
    fireEvent.click(within(group).getByRole('radio', { name: '24 months' }))
    expect(
      await screen.findByRole('img', { name: /^Heart-rate drift of 2 flat runs, last 24 months/ }),
    ).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('radio', { name: '6 months' }))
    expect(
      await screen.findByRole('img', { name: /^Heart-rate drift of 1 flat runs, last 6 months/ }),
    ).toBeInTheDocument()
  })

  test('words the climb limit in feet per mile for a runner in miles', async () => {
    mockPage(view({ longRuns: longRuns(3) }), 'mi')
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByText(/more than 79 ft per mile are left out/)).toBeInTheDocument()
  })
})

describe('Trends, heart rate at one speed', () => {
  test('draws a point per window at one pace of the runner, with a hidden table', async () => {
    mockPage(view({ hrWindows: hrWindows(STEADY, TODAY) }))
    const { container } = renderWithProviders(<TrendsPage />)
    const chart = await screen.findByRole('img', { name: /^Heart rate at .* one point per 8-week/ })
    expect(chart).toHaveAccessibleName(
      expect.stringMatching(
        /^Heart rate at \d:\d\d \/km, one point per 8-week window, last 12 months\. Latest point: \d+ bpm\.$/,
      ),
    )
    expect(
      screen.getByText(
        /^Each point is the heart rate your own line gives at \d:\d\d \/km in cool air, from the steady flat runs of the 8 weeks to that date\.$/,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^A point comes every 4 weeks, so neighbouring points share runs\./),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^A point needs 8 steady flat runs with heart rate in 8 weeks, and /),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^Sleep, caffeine, heat, tiredness and wrist-sensor error/),
    ).toBeInTheDocument()

    const table = within(chart.closest('figure') as HTMLElement).getByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Window ending', 'Heart rate (bpm)', 'Runs fitted', 'Runs in the window'])
    // 12 months of windows every 4 weeks: 13 of them end inside the range.
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 13)
    // The windows older than the runs have no line, and say why instead of a number.
    expect(within(table).getAllByText('Too few runs').length).toBeGreaterThan(0)
    expectCleanCopy(container)
  })

  test('reads the pace in miles for a runner in miles', async () => {
    mockPage(view({ hrWindows: hrWindows(STEADY, TODAY) }), 'mi')
    renderWithProviders(<TrendsPage />)
    expect(
      await screen.findByRole('img', { name: /one point per 8-week window/ }),
    ).toHaveAccessibleName(expect.stringMatching(/ \/mi, one point per/))
  })

  test('says what would fill the panel, with the runs the latest window has', async () => {
    const few = Array.from({ length: 5 }, (_, i) => steadyTrendRun(TODAY, 3 + i * 6, 2.6))
    mockPage(view({ hrWindows: hrWindows(few, TODAY) }))
    const { container } = renderWithProviders(<TrendsPage />)
    expect(await screen.findByText('No heart-rate line in this range yet.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'A line needs 8 steady flat runs with heart rate within 8 weeks. The latest 8 weeks have 5.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^Heart rate at/ })).not.toBeInTheDocument()
    expectCleanCopy(container)
  })
})

describe('Trends, the run panels fail', () => {
  test('tell one failure once, keep both headings and leave the rest of the page', async () => {
    mockPage('error')
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The long-run and heart-rate panels did not load. Reload the page to try again.',
    )
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Heart-rate drift on long runs' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Heart rate at one speed' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /^Run hours per week/ })).toBeVisible()
  })

  test('say they need a connection when offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    mockPage('error')
    renderWithProviders(<TrendsPage />)
    await screen.findAllByText('Trends need a connection. Today works offline.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
