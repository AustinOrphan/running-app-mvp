import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { App } from '../../web/App.tsx'
import { activityPage, mockApi, renderWithProviders } from './helpers.tsx'
import { makeToday } from './today-fixtures.ts'

const session = {
  id: 'u1',
  email: 'friend@example.com',
  displayName: null,
  units: 'mi' as const,
  weightUnit: 'lb' as const,
  showBodyWeight: false,
  hideMapEnds: true,
  mustChangePassword: false,
  unitsFromBrowser: true,
  zoneFromBrowser: true,
}

function browser(language: string, timeZone: string): void {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(language)
  const base = new Intl.DateTimeFormat().resolvedOptions()
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => ({
    ...base,
    timeZone,
  }))
}

function renderSignedIn(user: typeof session) {
  let current = user
  const mock = mockApi({
    'GET /api/setup': () => ({ needsSetup: false }),
    'GET /api/auth/me': () => current,
    'POST /api/settings/browser-defaults': () => {
      current = { ...current, unitsFromBrowser: false, zoneFromBrowser: false }
      return current
    },
    'GET /api/goals': () => [],
    'GET /api/plan': () => null,
    'GET /api/weeks': () => [],
    'GET /api/reviews': () => [],
    'GET /api/activities': () => activityPage([]),
    'GET /api/today': () => makeToday(),
    'GET /api/settings': () => current,
    'GET /api/integrations': () => [],
    'GET /api/profile': () => ({}),
    'GET /api/strength/workout': () => null,
  })
  renderWithProviders(<App />)
  return mock
}

const posts = (calls: Array<{ method: string; url: string; body: unknown }>) =>
  calls.filter((call) => call.method === 'POST' && call.url === '/api/settings/browser-defaults')

describe('the first load of an account that create-user made without units or a zone', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('sends miles and pounds for en-US, with the browser zone, once and without a prompt', async () => {
    browser('en-US', 'America/Chicago')
    const { calls } = renderSignedIn(session)
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1)
    })
    expect(posts(calls)[0]?.body).toEqual({
      units: 'mi',
      weightUnit: 'lb',
      timezone: 'America/Chicago',
    })
    // the session is read again, which clears the flags and ends the matter
    await waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/auth/me').length).toBeGreaterThan(1)
    })
    expect(posts(calls)).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('sends kilometres and kilograms for any other locale', async () => {
    browser('de-DE', 'Europe/Berlin')
    const { calls } = renderSignedIn(session)
    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1)
    })
    expect(posts(calls)[0]?.body).toEqual({
      units: 'km',
      weightUnit: 'kg',
      timezone: 'Europe/Berlin',
    })
  })

  test('sends nothing for an account that is not flagged', async () => {
    browser('de-DE', 'Europe/Berlin')
    const { calls } = renderSignedIn({
      ...session,
      unitsFromBrowser: false,
      zoneFromBrowser: false,
    })
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(posts(calls)).toEqual([])
  })

  test('waits while the account still has to choose its password', async () => {
    browser('en-US', 'America/Chicago')
    const { calls } = renderSignedIn({ ...session, mustChangePassword: true })
    expect(await screen.findByRole('heading', { name: 'Choose your password' })).toBeInTheDocument()
    expect(posts(calls)).toEqual([])
  })
})
