import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GoalsPage } from '../../web/pages/GoalsPage.tsx'
import { ProfilePage } from '../../web/pages/ProfilePage.tsx'
import { SettingsPage } from '../../web/pages/SettingsPage.tsx'
import { SetupPage } from '../../web/pages/SetupPage.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { makeRecord } from './track-record-fixtures.ts'
import { delayResponses, expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'

// A failed first read ends in one sentence, one muted line and a "Try again" button that reads the
// resource again and draws the page. The old state was a sentence with no way out.

const FAILED = { status: 500, body: { error: { code: 'internal', message: 'Boom' } } }

/** A route that fails once, then answers; `reads()` counts the requests. */
function failOnce<T>(answer: T) {
  let reads = 0
  return {
    route: () => (++reads === 1 ? FAILED : answer),
    reads: () => reads,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ErrorState on a failed load', () => {
  test('Goals: Try again reads the goals again and shows the page', async () => {
    const goals = failOnce([])
    mockApi({
      'GET /api/goals': goals.route,
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
      'GET /api/plan': () => null,
      'GET /api/plan/archived': () => [],
      'GET /api/predictions': () => ({ prediction: null, log: [] }),
      'GET /api/predictions/record': () => makeRecord(),
    })
    renderWithProviders(
      <ToastProvider>
        <GoalsPage />
      </ToastProvider>,
    )
    expect(await screen.findByText('Goals did not load.')).toBeInTheDocument()
    expectCleanCopy(document.body)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No goals yet.')).toBeInTheDocument()
    expect(goals.reads()).toBe(2)
  })

  test('Settings: Try again reads the settings again and shows the page', async () => {
    const settings = failOnce({ email: 'runner@example.com', displayName: null, units: 'mi' })
    mockApi({ 'GET /api/settings': settings.route })
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('Settings did not load.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('radiogroup', { name: 'Distance units' })).toBeInTheDocument()
    expect(settings.reads()).toBe(2)
  })

  test('Profile: Try again reads the profile again and shows the form', async () => {
    const profile = failOnce({
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
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
          d,
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
    })
    mockApi({
      'GET /api/profile': profile.route,
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
      'GET /api/zones': () => ({
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
      }),
      'GET /api/screenings': () => [],
    })
    renderWithProviders(
      <ToastProvider>
        <ProfilePage />
      </ToastProvider>,
    )
    expect(await screen.findByText('The profile did not load.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument()
    expect(profile.reads()).toBe(2)
  })

  test('Setup: Try again reads the setup status again', async () => {
    const status = failOnce({ needsSetup: true })
    mockApi({ 'GET /api/setup': status.route })
    renderWithProviders(<SetupPage />, { route: '/setup' })
    expect(await screen.findByText('Setup did not load.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(status.reads()).toBe(2)
  })

  test('focus stays on Try again while the retry runs, and the button is busy, not disabled', async () => {
    const settings = failOnce({ email: 'runner@example.com', displayName: null, units: 'mi' })
    mockApi({ 'GET /api/settings': settings.route })
    delayResponses(150)
    renderWithProviders(<SettingsPage />)
    const retry = await screen.findByRole('button', { name: 'Try again' })
    const user = userEvent.setup()
    await user.click(retry)
    // the read is back to pending: the same button is still on the page, focused and busy
    const during = screen.getByRole('button', { name: 'Try again' })
    expect(during).toBe(retry)
    expect(during).toHaveFocus()
    expect(during).toHaveAttribute('aria-busy', 'true')
    expect(during).toHaveAttribute('aria-disabled', 'true')
    expect(during).not.toBeDisabled()
    expect(await screen.findByRole('radiogroup', { name: 'Distance units' })).toBeInTheDocument()
  })

  test('offline, the sentence says the page needs a connection', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    mockApi({ 'GET /api/settings': () => FAILED })
    renderWithProviders(<SettingsPage />)
    expect(await screen.findByText('Settings needs a connection.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
