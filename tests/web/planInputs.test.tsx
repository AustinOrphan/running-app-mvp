// What the plan can see (rule T2): the page reads the one view `GET /api/plan-inputs` sends, by role
// and name, and is reachable from Profile and from More.
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { PlanInputsView } from '../../shared/domain/planInputs.ts'
import type { ZoneSet } from '../../shared/engine/types.ts'
import { MorePage } from '../../web/pages/MorePage.tsx'
import { PlanInputsPage } from '../../web/pages/PlanInputsPage.tsx'
import { ProfilePage } from '../../web/pages/ProfilePage.tsx'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'

afterEach(() => {
  vi.restoreAllMocks()
})

function view(over: Partial<PlanInputsView> = {}): PlanInputsView {
  return {
    asOf: '2026-06-30',
    wellnessWindowDays: 60,
    hrv: {
      kind: 'sdnn',
      rmssdDays: 0,
      sdnnDays: 31,
      baselineReadings: 0,
      lookbackDays: 21,
      baselineKeeps: 10,
      minReadings: 10,
    },
    restingHr: {
      days: 40,
      baselineReadings: 10,
      lookbackDays: 21,
      baselineKeeps: 10,
      minReadings: 10,
    },
    sleep: { nights: 5, windowNights: 7, minNights: 4 },
    runs: {
      windowDays: 365,
      count: 120,
      withStream: 100,
      withAltitude: 80,
      strap: 10,
      wrist: 90,
      unknown: 5,
      passing: 70,
      hrLine: { runs: 6, need: 8, windowWeeks: 8, fitted: false },
    },
    zones: [
      { key: 'hrMax', boundary: { source: 'hrmax-age', asOf: '2026-06-01' } },
      { key: 'lt1Hr', boundary: { source: 'hrr', asOf: '2026-06-01' } },
      { key: 'lt2Hr', boundary: null },
      {
        key: 'csMps',
        boundary: { source: 'cs', asOf: '2026-06-02', fromTraining: true },
      },
      { key: 'lt1PaceSecPerKm', boundary: null },
      { key: 'thresholdPaceSecPerKm', boundary: { source: 'tested', asOf: '2026-06-03' } },
    ],
    sources: {
      named: [{ key: 'apple-health', label: 'Apple Health', activities: 3, wellnessDays: 31 }],
      other: { activities: 117, wellnessDays: 0 },
    },
    ...over,
  }
}

function rowOf(region: HTMLElement, label: string): HTMLElement {
  const term = within(region).getByText(label)
  return term.parentElement as HTMLElement
}

describe('PlanInputsPage', () => {
  test('says that SDNN readings are not used, with the counts of each section', async () => {
    mockApi({ 'GET /api/plan-inputs': () => view() })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'What the plan can see' }),
    ).toBeInTheDocument()

    const hrv = await screen.findByRole('region', { name: 'Heart-rate variability' })
    expect(within(hrv).getByText(/SDNN readings, which the plan does not use/)).toBeInTheDocument()
    expect(rowOf(hrv, 'Days with an SDNN reading')).toHaveTextContent('31')
    expect(rowOf(hrv, 'Days with an rMSSD reading')).toHaveTextContent('0')
    expect(rowOf(hrv, 'rMSSD readings in the baseline for today')).toHaveTextContent('0')

    const rest = screen.getByRole('region', { name: 'Resting heart rate' })
    expect(rowOf(rest, 'Days with a resting heart rate')).toHaveTextContent('40')

    const sleep = screen.getByRole('region', { name: 'Sleep' })
    expect(rowOf(sleep, 'Nights recorded in the last 7')).toHaveTextContent('5')

    const runs = screen.getByRole('region', { name: 'Runs' })
    expect(rowOf(runs, 'Runs and races')).toHaveTextContent('120')
    expect(rowOf(runs, 'With a stored stream')).toHaveTextContent('100')
    expect(rowOf(runs, 'Heart rate from a chest strap or armband')).toHaveTextContent('10')
    expect(rowOf(runs, 'Passing the heart-rate checks')).toHaveTextContent('70')
    expect(rowOf(runs, 'On the heart-rate line, last 8 weeks')).toHaveTextContent('6 of 8')
    expect(within(runs).getByText(/needs 8 runs and is not fitted yet/)).toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('names the tier of each zone boundary in the words of the zone summary', async () => {
    mockApi({ 'GET /api/plan-inputs': () => view() })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    const zones = await screen.findByRole('region', { name: 'Zones' })
    expect(rowOf(zones, 'Maximum heart rate')).toHaveTextContent(
      'Estimated from age, as of 2026-06-01',
    )
    expect(rowOf(zones, 'Critical speed')).toHaveTextContent(
      'From critical speed (from training), as of 2026-06-02',
    )
    expect(rowOf(zones, 'Threshold pace')).toHaveTextContent('From a test')
    expect(rowOf(zones, 'Threshold heart rate')).toHaveTextContent('Not estimated yet.')
  })

  test('lists the connected sources by their registry label', async () => {
    mockApi({ 'GET /api/plan-inputs': () => view() })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    const sources = await screen.findByRole('region', { name: 'Sources' })
    expect(
      within(sources).getByText('Apple Health: activities 3, wellness days 31'),
    ).toBeInTheDocument()
    expect(
      within(sources).getByText(
        'Entered by hand or read from a file: activities 117, wellness days 0',
      ),
    ).toBeInTheDocument()
  })

  test('rMSSD readings are described as used, and an empty log reads as zeros and type', async () => {
    const empty = view({
      hrv: {
        kind: 'none',
        rmssdDays: 0,
        sdnnDays: 0,
        baselineReadings: 0,
        lookbackDays: 21,
        baselineKeeps: 10,
        minReadings: 10,
      },
      sources: { named: [], other: { activities: 0, wellnessDays: 0 } },
    })
    mockApi({ 'GET /api/plan-inputs': () => empty })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    const hrv = await screen.findByRole('region', { name: 'Heart-rate variability' })
    expect(within(hrv).getByText('No heart-rate variability readings are stored.')).toBeVisible()
    const sources = screen.getByRole('region', { name: 'Sources' })
    expect(within(sources).getByText('No activities or wellness days yet.')).toBeVisible()
    expectCleanCopy(document.body)
  })

  test('says it could not load, with a way to ask again', async () => {
    mockApi({
      'GET /api/plan-inputs': () => {
        throw new Error('down')
      },
    })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})

describe('links to the page', () => {
  test('More lists it in the Data group', () => {
    mockApi({ 'GET /api/race/plan': () => ({ plan: null, reason: 'no-goal' }) })
    renderWithProviders(<MorePage />, { route: '/more' })
    const data = screen.getByRole('region', { name: 'Data' })
    expect(within(data).getByRole('link', { name: /What the plan can see/ })).toHaveAttribute(
      'href',
      '/plan-inputs',
    )
  })

  test('Profile links to it under the zones', async () => {
    const zones: ZoneSet = {
      hrMax: null,
      hrRest: null,
      lt1Hr: null,
      lt2Hr: null,
      csMps: null,
      lt1PaceSecPerKm: null,
      thresholdPaceSecPerKm: null,
      hr: null,
      pace: null,
      rpe: { z1: [2, 3], z2: [4, 6], z3: [7, 9] },
    }
    mockApi({
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
      'GET /api/zones': () => zones,
      'GET /api/screenings': () => [],
      'GET /api/profile': () => ({
        birthYear: null,
        sex: null,
        heightCm: null,
        weightKg: null,
        hrMax: null,
        hrMaxSource: null,
        hrRest: null,
        lthr: null,
        thresholdPaceSecPerKm: null,
        runningSinceYear: null,
        injuries: [],
        availability: Object.fromEntries(
          ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
            day,
            { available: true, maxMin: null },
          ]),
        ),
        longRunDay: 'sat',
        terrain: { trail: false, hills: false, treadmill: false, track: false },
        strengthPreference: 2,
        timezone: 'Europe/London',
        homeLat: null,
        homeLng: null,
        useHomeWeather: true,
      }),
    })
    renderWithProviders(<ProfilePage />, { route: '/profile' })
    const link = await screen.findByRole('link', { name: 'What the plan can see' })
    expect(link).toHaveAttribute('href', '/plan-inputs')
  })
})
