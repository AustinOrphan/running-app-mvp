import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ZoneSet } from '../../shared/engine/types.ts'
import type { AthleteProfile, Availability, Screening, Units, Weekday } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ProfilePage } from '../../web/pages/ProfilePage.tsx'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'

// The real drawer is Task E14's; this stand-in shows which rules a Why button passes on.
vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, open }: { rules: string[]; open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Evidence">
        {rules.join(',')}
      </div>
    ) : null,
}))

const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function everyDay(): Availability {
  return Object.fromEntries(
    DAYS.map((day) => [day, { available: true, maxMin: null }]),
  ) as Availability
}

function makeProfile(over: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
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
    availability: everyDay(),
    longRunDay: 'sat',
    terrain: { trail: false, hills: false, treadmill: false, track: false },
    strengthPreference: 2,
    timezone: 'Europe/London',
    homeLat: null,
    homeLng: null,
    useHomeWeather: true,
    ...over,
  }
}

type User = ReturnType<typeof userEvent.setup>

function settings(units: Units) {
  return () => ({ email: 'runner@example.com', displayName: null, units })
}

function emptyZones(over: Partial<ZoneSet> = {}): ZoneSet {
  return {
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
    ...over,
  }
}

function makeScreening(over: Partial<Screening> = {}): Screening {
  return {
    id: 'sc1',
    date: '2026-09-01',
    kind: 'reds',
    answers: {},
    flags: 0,
    createdAt: '2026-09-01T09:00:00.000Z',
    ...over,
  }
}

function setup(profile: AthleteProfile, extra: MockRoutes = {}) {
  const api = mockApi({
    'GET /api/settings': settings('km'),
    'GET /api/zones': () => emptyZones(),
    'GET /api/screenings': () => [],
    'GET /api/profile': () => profile,
    'PUT /api/profile': ({ body }) => body,
    ...extra,
  })
  const user = userEvent.setup()
  renderWithProviders(<ProfilePage />)
  return { api, user }
}

async function loaded() {
  await screen.findByRole('heading', { name: 'About you' })
}

function puts(api: ReturnType<typeof mockApi>) {
  return api.calls.filter((c) => c.method === 'PUT' && c.url === '/api/profile')
}

async function type(user: User, name: string | RegExp, text: string) {
  const input = screen.getByRole('textbox', { name })
  await user.clear(input)
  await user.type(input, text)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ProfilePage', () => {
  test('shows every section and the saved values', async () => {
    setup(
      makeProfile({
        birthYear: 1988,
        sex: 'female',
        hrMax: 190,
        hrMaxSource: 'measured',
        thresholdPaceSecPerKm: 330,
        longRunDay: 'sun',
        strengthPreference: 3,
      }),
    )
    await loaded()
    for (const name of [
      'About you',
      'Heart rate',
      'Pace',
      'Availability',
      'Terrain',
      'Strength',
      'Injury history',
      'Location and timezone',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('textbox', { name: 'Birth year' })).toHaveValue('1988')
    expect(screen.getByRole('combobox', { name: 'Sex' })).toHaveValue('female')
    expect(screen.getByRole('textbox', { name: 'Maximum heart rate' })).toHaveValue('190')
    expect(screen.getByRole('combobox', { name: 'Maximum heart rate source' })).toHaveValue(
      'measured',
    )
    expect(screen.getByRole('textbox', { name: /Threshold pace/ })).toHaveValue('5:30')
    expect(screen.getByRole('combobox', { name: 'Long-run day' })).toHaveValue('sun')
    expect(screen.getByRole('radio', { name: 'A lot' })).toBeChecked()
  })

  test('saves edited numbers, pace and selects with a full profile body', async () => {
    const { api, user } = setup(makeProfile())
    await loaded()

    await type(user, 'Birth year', '1990')
    await type(user, 'Height (cm)', '172.5')
    await type(user, 'Maximum heart rate', '188')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Maximum heart rate source' }), [
      'estimated',
    ])
    await type(user, 'Threshold heart rate', '168')
    await type(user, /Threshold pace/, '5:05')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Long-run day' }), ['sun'])
    await user.click(screen.getByRole('radio', { name: 'None' }))
    await user.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    expect(puts(api)[0]?.body).toMatchObject({
      birthYear: 1990,
      heightCm: 172.5,
      weightKg: null,
      hrMax: 188,
      hrMaxSource: 'estimated',
      lthr: 168,
      hrRest: null,
      thresholdPaceSecPerKm: 305,
      longRunDay: 'sun',
      strengthPreference: 0,
      timezone: 'Europe/London',
      useHomeWeather: true,
    })
  })

  test('pace is shown and entered per mile for a runner using miles', async () => {
    const { api, user } = setup(makeProfile({ thresholdPaceSecPerKm: 300 }), {
      'GET /api/settings': settings('mi'),
    })
    await loaded()
    const pace = screen.getByRole('textbox', { name: 'Threshold pace (min:sec per mi)' })
    // 300 s/km × 1.609344 = 482.8 s/mi.
    expect(pace).toHaveValue('8:03')

    await type(user, /Threshold pace/, '8:00')
    await user.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    // 480 s/mi ÷ 1.609344 = 298.3 s/km.
    expect(puts(api)[0]?.body).toMatchObject({ thresholdPaceSecPerKm: 298 })
  })

  test('availability: a day can be switched off and given a time cap', async () => {
    const { api, user } = setup(makeProfile())
    await loaded()

    await user.click(screen.getByRole('checkbox', { name: 'Friday' }))
    expect(screen.getByRole('textbox', { name: 'Friday maximum minutes' })).toBeDisabled()
    await type(user, 'Tuesday maximum minutes', '45')
    await user.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    const body = puts(api)[0]?.body as AthleteProfile
    expect(body.availability.fri.available).toBe(false)
    expect(body.availability.tue).toEqual({ available: true, maxMin: 45 })
    expect(body.availability.mon).toEqual({ available: true, maxMin: null })
  })

  test('terrain checkboxes are saved', async () => {
    const { api, user } = setup(makeProfile())
    await loaded()
    await user.click(screen.getByRole('checkbox', { name: 'Trails' }))
    await user.click(screen.getByRole('checkbox', { name: 'Track' }))
    await user.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    expect((puts(api)[0]?.body as AthleteProfile).terrain).toEqual({
      trail: true,
      hills: false,
      treadmill: false,
      track: true,
    })
  })

  test('injury history rows can be added and removed', async () => {
    const { api, user } = setup(
      makeProfile({
        injuries: [
          { area: 'Shin', side: 'left', year: 2022, month: 3, kind: 'bone-stress', notes: null },
        ],
      }),
    )
    await loaded()
    expect(screen.getByRole('textbox', { name: 'Injury 1 area' })).toHaveValue('Shin')

    await user.click(screen.getByRole('button', { name: 'Add an injury' }))
    await type(user, 'Injury 2 area', 'Achilles')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Injury 2 type' }), ['tendon'])
    await type(user, 'Injury 2 year', '2024')
    await user.click(screen.getByRole('button', { name: 'Remove injury 1' }))
    expect(screen.queryByRole('textbox', { name: 'Injury 2 area' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    expect((puts(api)[0]?.body as AthleteProfile).injuries).toEqual([
      { area: 'Achilles', side: null, year: 2024, month: null, kind: 'tendon', notes: null },
    ])
  })

  test('shows a server field error beside the field and keeps the entry', async () => {
    const { user } = setup(makeProfile(), {
      'PUT /api/profile': () => ({
        status: 400,
        body: {
          error: {
            code: 'validation',
            message: 'Some fields need attention.',
            details: {
              issues: [
                { path: 'lthr', message: 'Threshold heart rate must be below the maximum.' },
              ],
            },
          },
        },
      }),
    })
    await loaded()
    await type(user, 'Maximum heart rate', '150')
    await type(user, 'Threshold heart rate', '160')
    await user.click(screen.getByRole('button', { name: 'Save profile' }))

    const field = await screen.findByRole('textbox', { name: 'Threshold heart rate' })
    await waitFor(() => {
      expect(field).toHaveAccessibleDescription('Threshold heart rate must be below the maximum.')
    })
    expect(field).toHaveValue('160')
    expect(screen.getAllByRole('alert')).toHaveLength(1)

    // A later attempt that fails locally shows only its own problem, not the stale server one.
    await type(user, 'Birth year', 'abc')
    await user.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => {
      expect(field).not.toHaveAccessibleDescription(
        'Threshold heart rate must be below the maximum.',
      )
    })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  test('rejects text in a number field without calling the server', async () => {
    const { api, user } = setup(makeProfile())
    await loaded()
    await type(user, 'Birth year', 'nineteen')
    await user.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByRole('textbox', { name: 'Birth year' })).toHaveAccessibleDescription(
      'Enter a whole number.',
    )
    expect(puts(api)).toHaveLength(0)
  })

  test('"Use my location" fills coordinates rounded to 0.01 degrees', async () => {
    const getCurrentPosition = vi.fn((ok: (p: unknown) => void) => {
      ok({ coords: { latitude: 12.3456, longitude: -65.4321 } })
    })
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    })
    const { api, user } = setup(makeProfile())
    await loaded()
    await user.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(screen.getByRole('textbox', { name: 'Home latitude' })).toHaveValue('12.35')
    expect(screen.getByRole('textbox', { name: 'Home longitude' })).toHaveValue('-65.43')

    await user.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => {
      expect(puts(api)).toHaveLength(1)
    })
    expect(puts(api)[0]?.body).toMatchObject({ homeLat: 12.35, homeLng: -65.43 })
  })

  test('timezone defaults to the browser zone when the profile still has UTC', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-US',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Pacific/Auckland',
    })
    setup(makeProfile({ timezone: 'UTC' }))
    await loaded()
    expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveValue('Pacific/Auckland')
  })

  test('a saved timezone is kept', async () => {
    setup(makeProfile({ timezone: 'Europe/London' }))
    await loaded()
    expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveValue('Europe/London')
  })

  test('shows a load failure', async () => {
    mockApi({
      'GET /api/settings': settings('km'),
      'GET /api/profile': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Boom' } },
      }),
    })
    renderWithProviders(<ProfilePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not load/)
    expect(within(document.body).queryByRole('button', { name: 'Save profile' })).toBeNull()
  })

  describe('zones', () => {
    test('shows each boundary with its value, range and source, and says so when one is not estimated yet', async () => {
      const user = userEvent.setup()
      setup(makeProfile(), {
        'GET /api/zones': () =>
          emptyZones({
            hrMax: { value: 188, band: [182, 194], source: 'hrmax-age', asOf: '2026-10-01' },
            thresholdPaceSecPerKm: {
              value: 330,
              band: [322, 338],
              source: 'cs',
              asOf: '2026-10-20',
            },
            hr: { z1: [120, 148], z2: [149, 168], z3: [169, 182] },
            pace: { z1: [420, 360], z2: [359, 335], z3: [334, 300] },
          }),
      })
      const section = await screen.findByRole('region', { name: 'Zones' })

      const hrMax = (await within(section).findByText('Maximum heart rate')).closest('li')
      expect(within(hrMax as HTMLElement).getByText('188 bpm')).toBeInTheDocument()
      expect(within(hrMax as HTMLElement).getByText('Range 182 bpm to 194 bpm')).toBeInTheDocument()
      expect(
        within(hrMax as HTMLElement).getByText('Estimated from age, as of 2026-10-01'),
      ).toBeInTheDocument()

      const threshold = within(section).getByText('Threshold pace').closest('li')
      expect(within(threshold as HTMLElement).getByText('5:30 /km')).toBeInTheDocument()
      expect(
        within(threshold as HTMLElement).getByText('From critical speed, as of 2026-10-20'),
      ).toBeInTheDocument()

      const cs = within(section).getByText('Critical speed').closest('li')
      expect(within(cs as HTMLElement).getByText('Not estimated yet.')).toBeInTheDocument()

      const z2 = within(section).getByRole('row', { name: /Zone 2/ })
      expect(within(z2).getByText('149 to 168 bpm')).toBeInTheDocument()
      expect(within(z2).getByText('5:59 to 5:35 /km')).toBeInTheDocument()
      expect(within(z2).getByText('4 to 6')).toBeInTheDocument()

      await user.click(within(section).getByRole('button', { name: 'Why: zones' }))
      expect(await screen.findByRole('dialog', { name: 'Evidence' })).toHaveTextContent('c-1,c-2')
    })

    test('a failed load is stated and the form still works', async () => {
      setup(makeProfile(), {
        'GET /api/zones': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'Something went wrong.' } },
        }),
      })
      expect(await screen.findByText('The zones did not load.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save profile' })).toBeInTheDocument()
    })
  })

  describe('risk profile', () => {
    test('a bone stress entry is reflected in the risk note, live', async () => {
      const { user } = setup(makeProfile())
      await loaded()
      expect(screen.getByText(/Bone stress history: none listed/)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Add an injury' }))
      await user.selectOptions(screen.getByLabelText('Injury 1 type'), 'bone-stress')
      expect(screen.getByText(/Bone stress history: listed/)).toBeInTheDocument()
      expect(screen.queryByText(/none listed/)).not.toBeInTheDocument()
    })
  })

  describe('energy availability screen', () => {
    function setupScreening(screenings: Screening[], extra: MockRoutes = {}) {
      const user = userEvent.setup()
      const api = mockApi({
        'GET /api/settings': settings('km'),
        'GET /api/zones': () => emptyZones(),
        'GET /api/profile': () => makeProfile(),
        'GET /api/screenings': () => screenings,
        ...extra,
      })
      renderWithProviders(
        <ToastProvider>
          <ProfilePage />
        </ToastProvider>,
      )
      return { api, user }
    }

    test('with no screen yet it offers to start one', async () => {
      setupScreening([])
      const section = await screen.findByRole('region', { name: 'Energy availability screen' })
      expect(await within(section).findByText(/No screen yet/)).toBeInTheDocument()
      expect(within(section).getByRole('button', { name: 'Start screen' })).toBeInTheDocument()
    })

    test('shows the last screen and when the next is due, 12 weeks on', async () => {
      setupScreening([makeScreening({ date: '2026-09-01', flags: 1 })])
      const section = await screen.findByRole('region', { name: 'Energy availability screen' })
      expect(
        await within(section).findByText(/Last screened Tue 1 Sep\w* 2026: 1 sign\./),
      ).toBeInTheDocument()
      expect(within(section).getByText(/Next screen due Tue 24 Nov 2026/)).toBeInTheDocument()
      expect(within(section).queryByText(/Two or more signs/)).not.toBeInTheDocument()
      expect(within(section).getByRole('button', { name: 'Screen again' })).toBeInTheDocument()
    })

    test('two or more signs show the clinician prompt and no diagnosis', async () => {
      setupScreening([makeScreening({ flags: 2 })])
      const section = await screen.findByRole('region', { name: 'Energy availability screen' })
      const prompt = await within(section).findByText(/Two or more signs/)
      expect(prompt).toHaveTextContent('clinician')
      expect(prompt).toHaveTextContent('not a diagnosis')
    })

    test('saving posts every answer as yes or no, toasts and refreshes the last screen', async () => {
      let screenings: Screening[] = []
      const { api, user } = setupScreening([], {
        'GET /api/screenings': () => screenings,
        'POST /api/screenings': () => {
          screenings = [makeScreening({ id: 'sc2', date: '2026-10-21', flags: 2 })]
          return { status: 201, body: screenings[0] }
        },
      })
      await user.click(await screen.findByRole('button', { name: 'Start screen' }))
      const dialog = await screen.findByRole('dialog', { name: 'Energy availability screen' })
      await user.click(within(dialog).getByRole('checkbox', { name: /Unintended weight loss/ }))
      await user.click(
        within(dialog).getByRole('checkbox', { name: /Tiredness that does not lift/ }),
      )
      await user.click(within(dialog).getByRole('button', { name: 'Save screen' }))

      expect(await screen.findByText('Screen saved')).toBeInTheDocument()
      const post = api.calls.find((c) => c.method === 'POST' && c.url === '/api/screenings')
      expect(post?.body).toEqual({
        answers: {
          unintendedWeightLoss: true,
          menstrualChanges: false,
          recurrentInjuryOrIllness: false,
          persistentFatigue: true,
          giSymptoms: false,
          disorderedEating: false,
        },
      })
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Energy availability screen' }),
        ).not.toBeInTheDocument()
      })
      expect(
        await screen.findByText(/Last screened Wed 21 Oct 2026: 2 signs\./),
      ).toBeInTheDocument()
      expect(screen.getByText(/Two or more signs/)).toBeInTheDocument()
    })

    test('a failed save stays in the sheet with the reason', async () => {
      const { user } = setupScreening([], {
        'POST /api/screenings': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'The database is busy.' } },
        }),
      })
      await user.click(await screen.findByRole('button', { name: 'Start screen' }))
      const dialog = await screen.findByRole('dialog', { name: 'Energy availability screen' })
      await user.click(within(dialog).getByRole('button', { name: 'Save screen' }))
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Screen not saved. The database is busy.',
      )
    })
  })
})
