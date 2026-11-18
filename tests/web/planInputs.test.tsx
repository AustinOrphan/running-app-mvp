// What the plan can see (rule T2): the page reads the one view `GET /api/plan-inputs` sends, by role
// and name, and is reachable from Profile and from More.
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { raceHeatSentences } from '../../shared/copy/raceHeat.ts'
import type { OwnAnswers, PlanInputsView } from '../../shared/domain/planInputs.ts'
import type { RaceHeatPlaces } from '../../shared/domain/raceHeat.ts'
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
    sleep: {
      nights: 5,
      windowNights: 7,
      minNights: 4,
      efficiency: {
        nights: 3,
        windowNights: 7,
        minNights: 4,
        baselineNights: 6,
        baselineMinNights: 7,
        read: false,
      },
    },
    runs: {
      windowDays: 365,
      count: 120,
      withStream: 100,
      withAltitude: 80,
      strap: 10,
      wrist: 90,
      unknown: 5,
      passing: 70,
      watchRatings: {
        count: 4,
        distinct: 2,
        used: false,
        minCount: 12,
        minDistinct: 3,
        maxModalShare: 0.6,
      },
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
    raceHeat: null,
    ...over,
  }
}

function rowOf(region: HTMLElement, label: string): HTMLElement {
  const term = within(region).getByText(label)
  return term.parentElement as HTMLElement
}

function answers(over: { j6?: Partial<OwnAnswers['j6']>; j11?: Partial<OwnAnswers['j11']> } = {}) {
  const ratings = { inApp: 6, watch: 0, feel: 5, pain: 2 }
  return {
    j6: {
      windowDays: 28,
      mastersAge: 40,
      applies: 'on',
      checkins: 9,
      items: { fatigue: 9, soreness: 8, mood: 7 },
      minCheckins: 7,
      reading: true,
      ratings,
      ...over.j6,
    },
    j11: {
      windowDays: 7,
      painCheckins: 4,
      reports: 3,
      mostOfOneArea: 3,
      minReports: 3,
      minScore: 2,
      flagScore: 4,
      reading: true,
      ratings,
      ...over.j11,
    },
  } satisfies OwnAnswers
}

describe('Your answers (OA1)', () => {
  test('at the minimum, both rules read the answers', async () => {
    mockApi({ 'GET /api/plan-inputs': () => view({ ownAnswers: answers() }) })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    const j6 = await screen.findByRole('region', { name: 'Your answers: masters recovery check' })
    expect(within(j6).getByText(/the 28 days before today/)).toBeInTheDocument()
    expect(rowOf(j6, 'Check-ins')).toHaveTextContent('9')
    expect(rowOf(j6, 'Check-ins with soreness')).toHaveTextContent('8')
    expect(rowOf(j6, 'Run ratings given in the app')).toHaveTextContent('6')
    expect(
      within(j6).getByText(
        'Rule J6 is reading your check-ins: it takes your own median from 7 of them.',
      ),
    ).toBeInTheDocument()
    const j11 = screen.getByRole('region', { name: 'Your answers: repeated pain' })
    expect(rowOf(j11, 'Check-ins naming an area at 2 or more')).toHaveTextContent('3')
    expect(rowOf(j11, 'Most reports of one area')).toHaveTextContent('3')
    expect(
      within(j11).getByText(
        'The look-back holds 3 reports of one area, so rule J11 can offer a rest window on Today.',
      ),
    ).toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('below the minimum, each rule says what it waits for', async () => {
    mockApi({
      'GET /api/plan-inputs': () =>
        view({
          ownAnswers: answers({
            j6: { checkins: 4, reading: false },
            j11: { reports: 1, mostOfOneArea: 1, reading: false },
          }),
        }),
    })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    const j6 = await screen.findByRole('region', { name: 'Your answers: masters recovery check' })
    expect(rowOf(j6, 'Check-ins')).toHaveTextContent('4')
    expect(
      within(j6).getByText('Rule J6 waits for 7 check-ins before it takes your own median.'),
    ).toBeInTheDocument()
    const j11 = screen.getByRole('region', { name: 'Your answers: repeated pain' })
    expect(
      within(j11).getByText(
        'Rule J11 waits for 3 check-ins that name one area at a pain score of 2 or more.',
      ),
    ).toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('under the masters age and with no birth year, J6 says when it applies', async () => {
    mockApi({
      'GET /api/plan-inputs': () =>
        view({ ownAnswers: answers({ j6: { applies: 'under', reading: false } }) }),
    })
    const first = renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    expect(
      await screen.findByText('Rule J6 applies from age 40 and is off at your age.'),
    ).toBeInTheDocument()
    first.unmount()
    mockApi({
      'GET /api/plan-inputs': () =>
        view({ ownAnswers: answers({ j6: { applies: 'no-birth-year', reading: false } }) }),
    })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    expect(
      await screen.findByText(
        'Rule J6 applies from age 40. It stays off until your profile has a birth year.',
      ),
    ).toBeInTheDocument()
  })

  test('a payload from an older server has no section', async () => {
    mockApi({ 'GET /api/plan-inputs': () => view() })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    await screen.findByRole('region', { name: 'Runs' })
    expect(screen.queryByRole('region', { name: /^Your answers/ })).not.toBeInTheDocument()
  })
})

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
    expect(rowOf(sleep, 'Recorded in the last 7 nights')).toHaveTextContent('5')
    expect(rowOf(sleep, 'With time in bed in the last 7 nights')).toHaveTextContent('3')
    expect(rowOf(sleep, 'With time in bed before them')).toHaveTextContent('6')
    expect(
      within(sleep).getByText(
        /does not read sleep efficiency yet: it needs 4 of the last 7 nights and 7 before them with time in bed/,
      ),
    ).toBeInTheDocument()
    expect(within(sleep).getByText('Only Apple Health supplies time in bed.')).toBeInTheDocument()

    const runs = screen.getByRole('region', { name: 'Runs' })
    expect(rowOf(runs, 'Runs and races')).toHaveTextContent('120')
    expect(rowOf(runs, 'With a stored stream')).toHaveTextContent('100')
    expect(rowOf(runs, 'Heart rate from a chest strap or armband')).toHaveTextContent('10')
    expect(rowOf(runs, 'Passing the heart-rate checks')).toHaveTextContent('70')
    expect(rowOf(runs, 'On the heart-rate line, last 8 weeks')).toHaveTextContent('6 of 8')
    expect(within(runs).getByText(/needs 8 runs and is not fitted yet/)).toBeInTheDocument()
    expect(rowOf(runs, 'Effort ratings from the watch')).toHaveTextContent('4')
    expect(
      within(runs).getByText(
        /does not read your watch ratings yet: it needs 12, at least 3 different values, and no one value above 60%/,
      ),
    ).toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('names the tier of each zone boundary in the words of the zone summary', async () => {
    mockApi({ 'GET /api/plan-inputs': () => view() })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    const zones = await screen.findByRole('region', { name: 'Zones' })
    expect(rowOf(zones, 'Maximum heart rate')).toHaveTextContent(
      'Estimated from your age (maximum = 208 - 0.7 x age), as of Mon 1 Jun 2026',
    )
    expect(rowOf(zones, 'Critical speed')).toHaveTextContent(
      'From critical speed (from training), as of Tue 2 Jun 2026',
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

  test('an empty log reads as zeros and type', async () => {
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

  const HRV_BASE = {
    rmssdDays: 20,
    sdnnDays: 0,
    baselineReadings: 10,
    lookbackDays: 21,
    baselineKeeps: 10,
    minReadings: 10,
  }

  test('rMSSD readings are described as used, with the newest readings the baseline keeps', async () => {
    mockApi({ 'GET /api/plan-inputs': () => view({ hrv: { ...HRV_BASE, kind: 'rmssd' } }) })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    const hrv = await screen.findByRole('region', { name: 'Heart-rate variability' })
    expect(within(hrv).getByText(/uses rMSSD readings, on a log scale/)).toBeVisible()
    expect(
      within(hrv).getByText(
        'The baseline takes the newest 10 rMSSD readings from the last 21 days and needs 10 of them.',
      ),
    ).toBeVisible()
    expectCleanCopy(document.body)
  })

  test('the cycle baseline takes every reading of its wider window', async () => {
    mockApi({
      'GET /api/plan-inputs': () =>
        view({ hrv: { ...HRV_BASE, kind: 'rmssd', lookbackDays: 35, baselineKeeps: null } }),
    })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    const hrv = await screen.findByRole('region', { name: 'Heart-rate variability' })
    expect(
      within(hrv).getByText(
        'The baseline takes every rMSSD reading from the last 35 days and needs 10 of them.',
      ),
    ).toBeVisible()
  })

  test('both kinds: rMSSD is used and SDNN is not mixed in', async () => {
    mockApi({
      'GET /api/plan-inputs': () => view({ hrv: { ...HRV_BASE, kind: 'both', sdnnDays: 20 } }),
    })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    const hrv = await screen.findByRole('region', { name: 'Heart-rate variability' })
    expect(
      within(hrv).getByText(/It does not use the SDNN readings, which are not mixed with them\./),
    ).toBeVisible()
    expect(within(hrv).getByText(/The baseline takes the newest 10 rMSSD readings/)).toBeVisible()
  })

  test('a fitted heart-rate line is said to be fitted, and no run or zone reads as zeros and type', async () => {
    const base = view()
    mockApi({
      'GET /api/plan-inputs': () =>
        view({
          runs: {
            ...base.runs,
            count: 0,
            withStream: 0,
            withAltitude: 0,
            strap: 0,
            wrist: 0,
            unknown: 0,
            passing: 0,
            hrLine: { runs: 9, need: 8, windowWeeks: 8, fitted: true },
          },
          zones: base.zones.map(({ key }) => ({ key, boundary: null })),
        }),
    })
    renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
    const runs = await screen.findByRole('region', { name: 'Runs' })
    expect(within(runs).getByText('The heart-rate line is fitted.')).toBeVisible()
    expect(within(runs).queryByText(/is not fitted yet/)).not.toBeInTheDocument()
    expect(rowOf(runs, 'On the heart-rate line, last 8 weeks')).toHaveTextContent('9 of 8')
    expect(rowOf(runs, 'With climb or descent read from altitude')).toHaveTextContent('0')
    const zones = screen.getByRole('region', { name: 'Zones' })
    expect(within(zones).getAllByText('Not estimated yet.')).toHaveLength(6)
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

  describe('the race heat places (RH1)', () => {
    const places = (over: Partial<RaceHeatPlaces> = {}): RaceHeatPlaces => ({
      using: null,
      racePlaceSet: false,
      homePlaceSet: false,
      homeWeatherOn: false,
      state: 'no-place',
      nausea: true,
      ...over,
    })

    test('with no place, states each place as not set, the gap, what it leaves out and where to set it', async () => {
      mockApi({ 'GET /api/plan-inputs': () => view({ raceHeat: places() }) })
      renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
      const heat = await screen.findByRole('region', { name: 'Race heat' })
      expect(within(rowOf(heat, 'Race place on the goal')).getByText('Not set')).toBeVisible()
      expect(within(rowOf(heat, 'Home place on Profile')).getByText('Not set')).toBeVisible()
      // the same sentences the Race page shows
      for (const sentence of raceHeatSentences('no-place', true)) {
        expect(within(heat).getByText(sentence)).toBeVisible()
      }
      expect(within(heat).getByRole('link', { name: 'Set the race place' })).toHaveAttribute(
        'href',
        '/goals',
      )
      expect(within(heat).getByRole('link', { name: 'Set the home place' })).toHaveAttribute(
        'href',
        '/profile',
      )
      expectCleanCopy(document.body)
    })

    test('a home place with its switch off reads as set but not in use', async () => {
      mockApi({
        'GET /api/plan-inputs': () =>
          view({ raceHeat: places({ homePlaceSet: true, homeWeatherOn: false }) }),
      })
      renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
      const heat = await screen.findByRole('region', { name: 'Race heat' })
      expect(
        within(rowOf(heat, 'Home place on Profile')).getByText('Set, weather switch off'),
      ).toBeVisible()
    })

    test('a place not read yet says so, and a known heat says where it is read', async () => {
      mockApi({
        'GET /api/plan-inputs': () =>
          view({ raceHeat: places({ using: 'race', racePlaceSet: true, state: 'unread' }) }),
      })
      const first = renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
      const heat = await screen.findByRole('region', { name: 'Race heat' })
      expect(within(rowOf(heat, 'Race place on the goal')).getByText('Set')).toBeVisible()
      for (const sentence of raceHeatSentences('unread', true)) {
        expect(within(heat).getByText(sentence)).toBeVisible()
      }
      first.unmount()
      // a goal with no fuel block (a 10 km) and a failed read, in the same sentences
      mockApi({
        'GET /api/plan-inputs': () =>
          view({
            raceHeat: places({
              using: 'race',
              racePlaceSet: true,
              state: 'failed',
              nausea: false,
            }),
          }),
      })
      const second = renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
      const failedHeat = await screen.findByRole('region', { name: 'Race heat' })
      for (const sentence of raceHeatSentences('failed', false)) {
        expect(within(failedHeat).getByText(sentence)).toBeVisible()
      }
      expect(within(failedHeat).queryByText(/nausea/)).toBeNull()
      second.unmount()
      mockApi({
        'GET /api/plan-inputs': () =>
          view({ raceHeat: places({ using: 'race', racePlaceSet: true, state: 'known' }) }),
      })
      renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
      const known = await screen.findByRole('region', { name: 'Race heat' })
      expect(
        within(known).getByText('The usual weather for the race date is read, at the race place.'),
      ).toBeVisible()
      expect(within(known).queryByText(/earlier nausea plan/)).toBeNull()
    })

    test('no row when the race heat does not apply', async () => {
      mockApi({ 'GET /api/plan-inputs': () => view() })
      renderWithProviders(<PlanInputsPage />, { route: '/plan-inputs' })
      await screen.findByRole('region', { name: 'Sources' })
      expect(screen.queryByRole('region', { name: 'Race heat' })).toBeNull()
    })
  })
})
