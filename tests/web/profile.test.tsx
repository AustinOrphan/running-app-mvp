import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AthleteProfile, Availability, Weekday } from '../../shared/types.ts'
import { ProfilePage } from '../../web/pages/ProfilePage.tsx'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'

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

function setup(profile: AthleteProfile, extra: MockRoutes = {}) {
  const api = mockApi({
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
      'GET /api/profile': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Boom' } },
      }),
    })
    renderWithProviders(<ProfilePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not load/)
    expect(within(document.body).queryByRole('button', { name: 'Save profile' })).toBeNull()
  })
})
