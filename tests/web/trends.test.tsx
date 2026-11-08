import { configure, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import {
  seriesByDate,
  weeklyBands,
  weeklySleep,
  type WellnessSeriesRow,
} from '../../shared/domain/trends.ts'
import { hrWindows, type TrendsRunsView } from '../../shared/domain/trendsRuns.ts'
import type { TrendsView, Units, UserSettings, WeekRow } from '../../shared/types.ts'
import { monthTicks } from '../../web/components/charts/monthTicks.ts'
import { TrendsPage } from '../../web/pages/TrendsPage.tsx'
import { makeWeekRow } from '../factories.ts'
import {
  drawnArt,
  expectCleanCopy,
  mockApi,
  renderWithProviders,
  showIllustrations,
} from './helpers.tsx'

// The charts load as a lazy chunk, which a busy CI runner can take more than the default second
// to resolve (a push run failed on it while its pull_request twin passed), so every find in this
// file waits up to 6 s, as the integrations page test does for its chart.
configure({ asyncUtilTimeout: 6000 })

// The fixed clock is Wednesday 2026-03-18; this week starts on Monday 2026-03-16 and 104 weeks
// end on it.
const THIS_WEEK = '2026-03-16'
const FIRST_WEEK = addDays(THIS_WEEK, -7 * 103)

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

/** 104 weeks: 4 h a week, a race week, two strength sessions in one week, the current week short. */
function history(): WeekRow[] {
  return Array.from({ length: 104 }, (_, i) => {
    const weekStart = addDays(FIRST_WEEK, 7 * i)
    if (i === 103) {
      return makeWeekRow({ weekStart, runMin: 45, runM: 8000, runSessions: 1, runDays: 1 })
    }
    return makeWeekRow({
      weekStart,
      runMin: 240,
      runM: 40_000,
      runSessions: 4,
      runDays: 4,
      avg4wRunMin: 240,
      raceMin: i === 90 ? 50 : 0,
      strengthSessions: i === 100 ? 2 : 0,
    })
  })
}

/** The 104 Mondays the server answers, oldest first. */
const WEEK_STARTS = Array.from({ length: 104 }, (_, i) => addDays(FIRST_WEEK, 7 * i))

/**
 * The view the server would answer for these nights: the same pure functions over a synthetic
 * series, a night a day for `days` days before today (rMSSD 55 to 65, resting heart rate 48 to 52,
 * sleep 6.5 to 8 h), with the nights in `skip` left out.
 */
function recoveryView(
  opts: {
    days?: number
    skip?: (back: number) => boolean
    sdnnOnly?: boolean
    cyclic?: boolean
  } = {},
): TrendsView {
  const rows: WellnessSeriesRow[] = []
  for (let back = 0; back < (opts.days ?? 200); back += 1) {
    if (opts.skip?.(back)) continue
    rows.push({
      date: addDays('2026-03-18', -back),
      hrvRmssd: opts.sdnnOnly === true ? null : 55 + ((back * 7) % 11),
      restingHr: 48 + ((back * 3) % 5),
      sleepSec: Math.round((6.5 + ((back * 5) % 4) * 0.5) * 3600),
    })
  }
  const byDate = seriesByDate(rows)
  const cyclic = opts.cyclic === true
  return {
    asOf: '2026-03-18',
    recovery: {
      hrv: weeklyBands(byDate, WEEK_STARTS, 'hrv', cyclic),
      restingHr: weeklyBands(byDate, WEEK_STARTS, 'resting-hr', cyclic),
      sleep: weeklySleep(byDate, WEEK_STARTS),
      cycleBaseline: cyclic,
    },
  }
}

/** What the server answers a runner with no run: no long run, and 26 windows with no line. */
function noRuns(): TrendsRunsView {
  return { asOf: '2026-03-18', longRuns: [], hrWindows: hrWindows([], '2026-03-18') }
}

function mockTrends(
  opts: { units?: Units; weeks?: WeekRow[]; trends?: TrendsView; runs?: TrendsRunsView } = {},
) {
  return mockApi({
    'GET /api/trends': () => opts.trends ?? recoveryView(),
    'GET /api/trends/runs': () => opts.runs ?? noRuns(),
    'GET /api/weeks': () => opts.weeks ?? history(),
    'GET /api/settings': () => settings(opts.units ?? 'km'),
  })
}

function setOnline(online: boolean) {
  return vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online)
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

describe('TrendsPage, running per week', () => {
  test('names the page, says nothing here is a target, and draws the weeks with their own code', async () => {
    const { calls } = mockTrends()
    const { container } = renderWithProviders(<TrendsPage />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Trends' })).toBeInTheDocument()
    expect(
      await screen.findByText(
        'Weeks and months of what was run and logged, against your own recent ranges. Nothing here is a target.',
      ),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('img', {
        name: 'Run hours per week, last 12 months. Latest complete week 4.0 h.',
      }),
    ).toBeInTheDocument()
    // One weeks request for the whole 24 months; the range switch never asks again.
    expect(calls.filter((c) => c.url.startsWith('/api/weeks'))).toHaveLength(1)
    const url = new URL(calls.find((c) => c.url.startsWith('/api/weeks'))!.url, 'http://x')
    expect(url.searchParams.get('from')).toBe(FIRST_WEEK)
    expect(url.searchParams.get('to')).toBe(THIS_WEEK)
    expectCleanCopy(container)
  })

  test('has a hidden table of the same numbers, one row per week of the range', async () => {
    mockTrends()
    renderWithProviders(<TrendsPage />)
    const table = await screen.findByRole('table', {
      name: 'Run hours per week, last 12 months. Latest complete week 4.0 h.',
    })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(1 + 52)
    // The current week: its time so far, and no point on the 4-week line.
    const last = within(rows.at(-1)!)
    expect(last.getByRole('rowheader')).toHaveTextContent('16 Mar')
    expect(last.getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '0.8',
      '8.00 km',
      '1',
      '0',
      '–',
      '',
    ])
    // A complete week carries the mean and the race flag.
    const raceRow = rows.find((row) => within(row).queryByText('Yes') !== null)
    expect(raceRow).toBeDefined()
    expect(within(raceRow!).getAllByRole('cell')[4]).toHaveTextContent('4.0')
  })

  test('the range switch shows 6, 12 or 24 months, 12 first, and remembers the choice', async () => {
    mockTrends()
    renderWithProviders(<TrendsPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Range' })
    expect(within(group).getByRole('radio', { name: '12 months' })).toBeChecked()

    fireEvent.click(within(group).getByRole('radio', { name: '24 months' }))
    const wide = await screen.findByRole('table', { name: /^Run hours per week, last 24 months/ })
    expect(within(wide).getAllByRole('row')).toHaveLength(1 + 104)
    expect(localStorage.getItem('trends-range')).toBe('24')

    fireEvent.click(within(group).getByRole('radio', { name: '6 months' }))
    const narrow = await screen.findByRole('table', { name: /^Run hours per week, last 6 months/ })
    expect(within(narrow).getAllByRole('row')).toHaveLength(1 + 26)
  })

  test('opens on the range last chosen, and works without storage', async () => {
    localStorage.setItem('trends-range', '6')
    mockTrends()
    const { unmount } = renderWithProviders(<TrendsPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Range' })
    expect(within(group).getByRole('radio', { name: '6 months' })).toBeChecked()
    unmount()

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderWithProviders(<TrendsPage />)
    const again = await screen.findByRole('radiogroup', { name: 'Range' })
    expect(within(again).getByRole('radio', { name: '12 months' })).toBeChecked()
    fireEvent.click(within(again).getByRole('radio', { name: '24 months' }))
    expect(within(again).getByRole('radio', { name: '24 months' })).toBeChecked()
  })

  test('switches to distance in the runner unit and drops the 4-week line', async () => {
    mockTrends({ units: 'mi' })
    renderWithProviders(<TrendsPage />)
    const show = await screen.findByRole('radiogroup', { name: 'Show' })
    expect(
      screen.getByText(
        'Bars are run hours per week. The line is the mean of that week and the three before it.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(within(show).getByRole('radio', { name: 'Distance' }))
    expect(screen.getByText('Bars are run distance per week, in mi.')).toBeInTheDocument()
    expect(
      await screen.findByRole('img', {
        name: 'Run distance per week, last 12 months. Latest complete week 24.9 mi.',
      }),
    ).toBeInTheDocument()
  })

  test('puts a strength square under the week of each session and links to Strength', async () => {
    mockTrends()
    renderWithProviders(<TrendsPage />)
    const squares = await screen.findByTestId('strength-squares')
    const columns = Array.from(squares.children)
    expect(columns).toHaveLength(52)
    expect(columns.map((c) => c.getAttribute('data-strength')).filter((n) => n !== '0')).toEqual([
      '2',
    ])
    expect(squares.querySelectorAll('span > span')).toHaveLength(2)
    expect(screen.getByText(/Squares are strength sessions\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lifts and loads are on Strength' })).toHaveAttribute(
      'href',
      '/strength',
    )
    expect(screen.getByText('The outlined bar is this week so far.')).toBeInTheDocument()
  })

  test('starts the plot at the first record and says where the records start', async () => {
    const recent = history().map((week, i) =>
      i < 94 ? makeWeekRow({ weekStart: week.weekStart }) : week,
    )
    mockTrends({ weeks: recent })
    renderWithProviders(<TrendsPage />)
    const chart = await screen.findByRole('img', { name: /Run hours per week/ })
    const table = within(chart.closest('figure') as HTMLElement).getByRole('table')
    // 94 weeks have nothing; the ten from 2026-01-12 are drawn, and the caption names the start.
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    expect(screen.getAllByText('Records start the week of 12 Jan.').length).toBeGreaterThan(0)
    // The chart is named for the span it draws, not the range it was asked for.
    expect(chart).toHaveAccessibleName(
      'Run hours per week, since the week of 12 Jan. Latest complete week 4.0 h.',
    )
    expect(chart.closest('figure')).not.toHaveAccessibleName('Records start the week of 12 Jan.')
  })

  test('draws a quiet stretch at the start of a range when older records exist', async () => {
    // Records in the first ten weeks and the last fourteen; nothing between. The 6 month range
    // starts inside the lull, but the history's first record is older, so no week is cut.
    const lull = history().map((week, i) =>
      i >= 10 && i < 90 ? makeWeekRow({ weekStart: week.weekStart }) : week,
    )
    localStorage.setItem('trends-range', '6')
    mockTrends({ weeks: lull })
    renderWithProviders(<TrendsPage />)
    const chart = await screen.findByRole('img', { name: /^Run hours per week, last 6 months\./ })
    expect(within(chart.closest('figure') as HTMLElement).getAllByRole('row')).toHaveLength(27)
    expect(screen.queryByText(/^Records start the week of/)).not.toBeInTheDocument()
  })

  test('draws every week and no caption when the records reach the start of the range', async () => {
    mockTrends()
    renderWithProviders(<TrendsPage />)
    const chart = await screen.findByRole('img', { name: /Run hours per week/ })
    expect(
      within(chart.closest('figure') as HTMLElement).getAllByRole('row').length,
    ).toBeGreaterThan(40)
    expect(
      within(chart.closest('figure') as HTMLElement).queryByText(/Records start/),
    ).not.toBeInTheDocument()
  })

  test('says so when the range holds no run, with the range switch still there', async () => {
    showIllustrations()
    mockTrends({ weeks: history().map((w) => ({ ...w, runMin: 0, runM: 0 })) })
    const { container } = renderWithProviders(<TrendsPage />)
    expect(await screen.findByText('No runs in this range yet.')).toBeInTheDocument()
    expect(drawnArt()).toEqual(['trends'])
    expect(screen.getByRole('radiogroup', { name: 'Range' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^Run hours per week/ })).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('says so when the weeks did not load', async () => {
    mockApi({
      'GET /api/weeks': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Something went wrong on the server.' } },
      }),
      'GET /api/trends': () => recoveryView(),
      'GET /api/settings': () => settings('km'),
    })
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Trends did not load. Reload the page to try again.',
    )
  })

  test('offline with no data, says Trends need a connection and what still works', async () => {
    setOnline(false)
    mockApi({
      'GET /api/trends': () => ({
        status: 503,
        body: { error: { code: 'offline', message: 'x' } },
      }),
      'GET /api/weeks': () => ({ status: 503, body: { error: { code: 'offline', message: 'x' } } }),
      'GET /api/settings': () => ({
        status: 503,
        body: { error: { code: 'offline', message: 'x' } },
      }),
    })
    const { container } = renderWithProviders(<TrendsPage />)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Trends need a connection. Today works offline.',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectCleanCopy(container)
  })
})

describe('TrendsPage, recovery readings', () => {
  test('draws heart-rate variability, resting heart rate and sleep, each with its caption and range', async () => {
    mockTrends()
    const { container } = renderWithProviders(<TrendsPage />)
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Recovery readings' }),
    ).toBeVisible()
    for (const name of ['Overnight HRV', 'Resting heart rate', 'Sleep']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument()
    }
    expect(
      screen.getByText(
        'Weekly mean of overnight rMSSD in ms, for weeks with at least 4 nights recorded.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Weekly mean of resting heart rate in bpm, for weeks with at least 4 nights recorded.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Weekly mean of recorded sleep in hours, for weeks with at least 4 nights recorded. No range is drawn.',
      ),
    ).toBeInTheDocument()
    // The band is the recent range of Today's baseline, named as that and never as a verdict.
    const band =
      'The band is your recent range: the mean of the latest 10 readings within the 21 days before the week, plus or minus 1 SD.'
    expect(screen.getAllByText(band)).toHaveLength(2)
    // One line, under the HRV panel only: sleep and resting heart rate can corroborate a hold.
    const note = screen.getByText('Heart-rate variability alone never changes a plan.')
    expect(screen.getAllByText('Heart-rate variability alone never changes a plan.')).toHaveLength(
      1,
    )
    const panel = screen.getByRole('heading', { level: 3, name: 'Overnight HRV' }).parentElement
    expect(panel).toContainElement(note)
    expect(
      await screen.findByRole('img', {
        name: /^Overnight HRV in ms, weekly mean, since the week of \d{1,2} \w{3}\./,
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('img', { name: /^Resting heart rate in bpm, weekly mean/ }),
    ).toBeVisible()
    expect(screen.getByRole('img', { name: /^Sleep in hours, weekly mean/ })).toBeVisible()
    expectCleanCopy(container)
  })

  test('gives each chart a hidden table of week, mean, nights, low and high', async () => {
    const view = recoveryView()
    mockTrends({ trends: view })
    renderWithProviders(<TrendsPage />)
    const table = await screen.findByRole('table', { name: /^Overnight HRV in ms, weekly mean/ })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Week of', 'Mean (ms)', 'Nights', 'Low (ms)', 'High (ms)'])
    const rows = within(table).getAllByRole('row')
    // The plot starts at the first week with a night; the weeks before it are not drawn.
    const last52 = view.recovery.hrv.slice(-52)
    const drawn = last52.slice(last52.findIndex((w) => w.nights > 0))
    expect(rows).toHaveLength(1 + drawn.length)
    // The last row is the current week, as the server computed it.
    const week = view.recovery.hrv.at(-1)!
    expect(
      within(rows.at(-1)!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual([
      week.mean === null ? '' : week.mean.toFixed(0),
      String(week.nights),
      week.low === null ? '' : week.low.toFixed(0),
      week.high === null ? '' : week.high.toFixed(0),
    ])
    expect(week.low).not.toBeNull()
    // Sleep has no range: the low and high cells are empty on every row.
    const sleep = await screen.findByRole('table', { name: /^Sleep in hours, weekly mean/ })
    for (const row of within(sleep).getAllByRole('row').slice(1)) {
      const cells = within(row).getAllByRole('cell')
      expect([cells[2]!.textContent, cells[3]!.textContent]).toEqual(['', ''])
    }
  })

  test('leaves a week without enough nights blank, never filled in', async () => {
    // Nothing recorded between 22 and 28 days ago.
    mockTrends({ trends: recoveryView({ skip: (back) => back >= 22 && back <= 28 }) })
    renderWithProviders(<TrendsPage />)
    const table = await screen.findByRole('table', {
      name: /^Resting heart rate in bpm, weekly mean/,
    })
    const blank = within(table)
      .getAllByRole('row')
      .slice(1)
      .filter((row) => within(row).getAllByRole('cell')[0]!.textContent === '')
    expect(blank.length).toBeGreaterThanOrEqual(1)
    for (const row of blank) {
      expect(Number(within(row).getAllByRole('cell')[1]!.textContent)).toBeLessThan(4)
    }
  })

  test('says the recent range is still being built, with the count, before ten readings', async () => {
    mockTrends({ trends: recoveryView({ days: 6 }) })
    renderWithProviders(<TrendsPage />)
    const building = await screen.findAllByText(
      /^The recent range is still being built: \d of 10 readings\.$/,
    )
    expect(building).toHaveLength(2)
    expect(screen.queryByText(/^The band is your recent range/)).not.toBeInTheDocument()
  })

  test('reads the 35 days before a week for the cycle-aware profile', async () => {
    mockTrends({ trends: recoveryView({ cyclic: true }) })
    renderWithProviders(<TrendsPage />)
    expect(
      await screen.findByText(
        'The band is your recent range: the mean of the readings within the 35 days before the week, plus or minus 1 SD.',
      ),
    ).toBeInTheDocument()
    // Resting heart rate has no cycle handling, as on Today.
    expect(
      screen.getByText(
        'The band is your recent range: the mean of the latest 10 readings within the 21 days before the week, plus or minus 1 SD.',
      ),
    ).toBeInTheDocument()
  })

  test('says so when the source holds only SDNN, and draws the other two', async () => {
    mockTrends({ trends: recoveryView({ sdnnOnly: true }) })
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByText('No rMSSD readings yet.')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^Overnight HRV/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /^Resting heart rate in bpm/ })).toBeVisible()
  })

  test('says so when there is no night at all', async () => {
    mockTrends({
      trends: {
        asOf: '2026-03-18',
        recovery: { hrv: [], restingHr: [], sleep: [], cycleBaseline: false },
      },
    })
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByText('No rMSSD readings yet.')).toBeInTheDocument()
    expect(screen.getByText('No resting heart rate readings yet.')).toBeInTheDocument()
    expect(screen.getByText('No sleep readings yet.')).toBeInTheDocument()
  })

  test('follows the range switch', async () => {
    mockTrends()
    renderWithProviders(<TrendsPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Range' })
    fireEvent.click(within(group).getByRole('radio', { name: '6 months' }))
    const table = await screen.findByRole('table', {
      name: /^Sleep in hours, weekly mean, last 6 months/,
    })
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 26)
  })

  test('says the readings did not load and leaves the running weeks', async () => {
    mockApi({
      'GET /api/trends': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Something went wrong on the server.' } },
      }),
      'GET /api/trends/runs': () => noRuns(),
      'GET /api/weeks': () => history(),
      'GET /api/settings': () => settings('km'),
    })
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The recovery readings did not load. Reload the page to try again.',
    )
    expect(await screen.findByRole('img', { name: /^Run hours per week/ })).toBeVisible()
  })

  test('says Trends need a connection when the readings cannot load offline', async () => {
    setOnline(false)
    mockApi({
      'GET /api/trends': () => ({
        status: 503,
        body: { error: { code: 'offline', message: 'x' } },
      }),
      'GET /api/trends/runs': () => noRuns(),
      'GET /api/weeks': () => history(),
      'GET /api/settings': () => settings('km'),
    })
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Trends need a connection. Today works offline.',
    )
  })
})

describe('TrendsPage, body weight', () => {
  /** Two weigh-ins in each of the last 20 weeks, 70.0 kg then 70.5 kg (mean 70 250 g); the week before has one. */
  function weightView(over: Partial<TrendsView> = {}): TrendsView {
    return {
      ...recoveryView(),
      weight: WEEK_STARTS.map((weekStart, i) =>
        i >= 84
          ? { weekStart, grams: 70_250, weighIns: 2 }
          : { weekStart, grams: null, weighIns: 0 },
      ),
      ...over,
    }
  }

  test('never mentions weight when the response has no weight key', async () => {
    mockTrends()
    const { container } = renderWithProviders(<TrendsPage />)
    expect(await screen.findByRole('img', { name: /^Sleep in hours/ })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Body weight' })).not.toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(/weight|weigh-in/i)
  })

  test('draws weekly means in the runner unit with a hidden table, and no verdict', async () => {
    mockTrends({ trends: weightView(), units: 'km' })
    const { container } = renderWithProviders(<TrendsPage />)
    expect(await screen.findByRole('heading', { level: 2, name: 'Body weight' })).toBeVisible()
    // The runner's weight unit is pounds in these settings: 70.25 kg is 154.9 lb.
    expect(
      await screen.findByRole('img', {
        name: 'Body weight, weekly mean, last 12 months. Latest week with enough weigh-ins: 154.9 lb.',
      }),
    ).toBeVisible()
    expect(
      screen.getByText(
        "Mean of each week's weigh-ins, for weeks with at least 2 weigh-ins. A scale varies within a day, so read the line, not a point.",
      ),
    ).toBeVisible()
    const table = await screen.findByRole('table', { name: /^Body weight, weekly mean/ })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Week of', 'Mean (lb)', 'Weigh-ins'])
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(1 + 52)
    // A week with too few weigh-ins is a blank cell, never filled in.
    expect(
      within(rows[1]!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['', '0'])
    expect(
      within(rows.at(-1)!)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['154.9', '2'])
    expect(screen.getByRole('link', { name: 'the energy screen on Profile' })).toHaveAttribute(
      'href',
      '/profile',
    )
    expect(container.textContent ?? '').not.toMatch(/\b(gain|gained|loss|lost|goal|BMI)\b/i)
    expectCleanCopy(container)
  })

  test('says there are no weigh-ins when the series is empty', async () => {
    mockTrends({ trends: weightView({ weight: [] }) })
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByText('No weigh-ins yet.')).toBeVisible()
    expect(screen.queryByRole('img', { name: /^Body weight/ })).not.toBeInTheDocument()
  })

  test('says there are no weigh-ins, and draws no axis, when no week has enough of them', async () => {
    mockTrends({
      trends: weightView({
        weight: WEEK_STARTS.map((weekStart, i) => ({
          weekStart,
          grams: null,
          weighIns: i === 100 ? 1 : 0,
        })),
      }),
    })
    renderWithProviders(<TrendsPage />)
    expect(await screen.findByText('No weigh-ins yet.')).toBeVisible()
    expect(screen.queryByRole('img', { name: /^Body weight/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /^Body weight/ })).not.toBeInTheDocument()
  })

  test('with the screening gate, draws no chart and says so neutrally, with a link to Profile', async () => {
    const view = recoveryView()
    mockTrends({ trends: { ...view, weightGate: 'reds' } })
    const { container } = renderWithProviders(<TrendsPage />)
    expect(await screen.findByRole('heading', { level: 2, name: 'Body weight' })).toBeVisible()
    expect(
      screen.getByText('Body weight is not shown while the screening has open items.'),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'The screening and where to find care are on Profile.' }),
    ).toHaveAttribute('href', '/profile')
    expect(screen.queryByRole('img', { name: /^Body weight/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /^Body weight/ })).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('follows the range switch', async () => {
    mockTrends({ trends: weightView() })
    renderWithProviders(<TrendsPage />)
    const group = await screen.findByRole('radiogroup', { name: 'Range' })
    fireEvent.click(within(group).getByRole('radio', { name: '6 months' }))
    const table = await screen.findByRole('table', {
      name: /^Body weight, weekly mean, last 6 months/,
    })
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 26)
  })
})

describe('the month ticks of the running chart', () => {
  const weeks = Array.from({ length: 104 }, (_, i) => addDays(FIRST_WEEK, 7 * i))

  test('open each calendar month on its first Monday, at the step asked for', () => {
    const every = monthTicks(weeks, 1)
    expect(every).toHaveLength(24)
    for (const weekStart of every) expect(Number(weekStart.slice(8, 10))).toBeLessThanOrEqual(7)
    expect(monthTicks(weeks, 3)).toHaveLength(8)
    expect(
      monthTicks(weeks, 3).every((w) => ['01', '04', '07', '10'].includes(w.slice(5, 7))),
    ).toBe(true)
  })

  test('name no week twice', () => {
    const ticks = monthTicks(weeks, 1)
    expect(new Set(ticks.map((w) => w.slice(0, 7))).size).toBe(ticks.length)
  })
})
