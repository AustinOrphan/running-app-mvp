import { screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { App } from '../../web/App.tsx'
import { mockApi, renderWithProviders } from './helpers.tsx'

const signedOut = {
  status: 401,
  body: { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
}

describe('App routing', () => {
  test('goes to setup on a fresh install', async () => {
    mockApi({
      'GET /api/setup': () => ({ needsSetup: true }),
      'GET /api/auth/me': () => signedOut,
    })
    renderWithProviders(<App />)
    expect(
      await screen.findByRole('heading', { name: 'Set up your training log' }),
    ).toBeInTheDocument()
  })

  test('goes to login when set up but signed out', async () => {
    mockApi({
      'GET /api/setup': () => ({ needsSetup: false }),
      'GET /api/auth/me': () => signedOut,
    })
    renderWithProviders(<App />)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  test('shows the dashboard for a signed-in user', async () => {
    mockApi({
      'GET /api/setup': () => ({ needsSetup: false }),
      'GET /api/auth/me': () => ({
        id: 'u1',
        email: 'runner@example.com',
        displayName: null,
        units: 'mi',
      }),
      // The dashboard's own data: a new account with nothing logged yet.
      'GET /api/goals': () => [],
      'GET /api/plan': () => null,
      'GET /api/weeks': () => [],
      'GET /api/reviews': () => [],
      'GET /api/activities': () => [],
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'mi' }),
    })
    renderWithProviders(<App />)
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
  })

  test.each([
    ['/activities/a1', 'Activity'],
    ['/integrations', 'Integrations'],
    ['/profile', 'Profile'],
  ])('%s renders its page inside the signed-in layout', async (route, heading) => {
    mockApi({
      'GET /api/setup': () => ({ needsSetup: false }),
      'GET /api/auth/me': () => ({
        id: 'u1',
        email: 'runner@example.com',
        displayName: null,
        units: 'mi',
      }),
      // The profile page's own data: a profile that was never filled in.
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'mi' }),
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
        timezone: 'UTC',
        homeLat: null,
        homeLng: null,
        useHomeWeather: true,
      }),
    })
    renderWithProviders(<App />, { route })
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
  })
})
