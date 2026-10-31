import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { App } from '../../web/App.tsx'
import { Layout, useTheme } from '../../web/components/Layout.tsx'
import { Nav } from '../../web/components/Nav.tsx'
import { MorePage } from '../../web/pages/MorePage.tsx'
import { makeUpdate, makeView } from './brief-fixtures.ts'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'
import { PROFILE, pageView } from './strength-page-fixtures.ts'

function primaryLinks() {
  return within(screen.getByRole('navigation', { name: 'Primary' })).getAllByRole('link')
}

describe('Nav', () => {
  test('five items in order; exactly one is current', () => {
    renderWithProviders(<Nav />, { route: '/plan' })
    const links = primaryLinks()
    expect(links.map((l) => l.textContent)).toEqual(['Today', 'Log', 'Plan', 'Review', 'More'])
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/',
      '/activities',
      '/plan',
      '/review',
      '/more',
    ])
    const current = links.filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current.map((l) => l.textContent)).toEqual(['Plan'])
  })

  test.each(['/more', '/goals', '/stats', '/settings', '/integrations', '/profile', '/strength'])(
    'More is current on %s',
    (route) => {
      renderWithProviders(<Nav />, { route })
      const current = primaryLinks().filter((l) => l.getAttribute('aria-current') === 'page')
      expect(current.map((l) => l.textContent)).toEqual(['More'])
      // Both groups share the DOM at every width, so only one link in the whole nav may be current.
      const everywhere = screen
        .getAllByRole('link')
        .filter((l) => l.getAttribute('aria-current') === 'page')
      expect(everywhere.map((l) => l.textContent)).toEqual(['More'])
    },
  )

  test('Today is current only on the root path', () => {
    renderWithProviders(<Nav />, { route: '/' })
    const current = primaryLinks().filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current.map((l) => l.textContent)).toEqual(['Today'])
  })

  test('the rail group lists Goals, Stats and Settings', () => {
    renderWithProviders(<Nav />, { route: '/stats' })
    const group = within(screen.getByRole('navigation', { name: 'Other pages' }))
    expect(group.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Goals',
      'Stats',
      'Settings',
    ])
    expect(group.getByRole('link', { name: 'Stats' })).toHaveAttribute('data-current', 'true')
    expect(group.getByRole('link', { name: 'Stats' })).not.toHaveAttribute('aria-current')
  })
})

describe('theme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.removeItem('rl_theme')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('data-theme')
    localStorage.removeItem('rl_theme')
  })

  test('the toggle cycles system, light, dark and sets data-theme', () => {
    renderWithProviders(<Nav />)
    const toggle = screen.getByRole('button', { name: /Theme: System/ })
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    fireEvent.click(toggle)
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    fireEvent.click(screen.getByRole('button', { name: /Theme: Light/ }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem('rl_theme')).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: /Theme: Dark/ }))
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(localStorage.getItem('rl_theme')).toBe('system')
  })

  test('survives a storage error', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderWithProviders(<Nav />)
    fireEvent.click(screen.getByRole('button', { name: /Theme: System/ }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  test('a stored theme is applied when the layout mounts', () => {
    localStorage.setItem('rl_theme', 'dark')
    function Probe() {
      return <span data-testid="probe">{useTheme().theme}</span>
    }
    renderWithProviders(
      <>
        <Layout />
        <Probe />
      </>,
    )
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(screen.getByTestId('probe')).toHaveTextContent('dark')
  })
})

describe('Layout', () => {
  test('has a skip link and a main landmark', () => {
    renderWithProviders(<Layout />)
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })
})

describe('MorePage', () => {
  test('the Settings note names only what Settings offers: no import', () => {
    renderWithProviders(<MorePage />, { route: '/more' })
    const settings = within(screen.getByRole('navigation', { name: 'More pages' })).getByRole(
      'link',
      { name: /^Settings/ },
    )
    expect(settings).toHaveTextContent('Units, display name, export')
    expect(settings).not.toHaveTextContent(/import/i)
  })

  test('every link and note in the navigation passes the copy lint', () => {
    renderWithProviders(<MorePage />, { route: '/more' })
    const nav = screen.getByRole('navigation', { name: 'More pages' })
    expectCleanCopy(nav)
    // The Research note is the template's words, in the same wording as the Research page.
    expect(within(nav).getByRole('link', { name: /^Research/ })).toHaveTextContent(
      'The papers and rules the plan rests on',
    )
  })

  test('links to Integrations and Profile', () => {
    renderWithProviders(<MorePage />, { route: '/more' })
    const nav = within(screen.getByRole('navigation', { name: 'More pages' }))
    expect(nav.getByRole('link', { name: /^Integrations/ })).toHaveAttribute(
      'href',
      '/integrations',
    )
    expect(nav.getByRole('link', { name: /^Profile/ })).toHaveAttribute('href', '/profile')
  })
})

describe('Strength navigation', () => {
  test('More lists Strength with its note, and the link goes to /strength', () => {
    renderWithProviders(<MorePage />, { route: '/more' })
    const nav = within(screen.getByRole('navigation', { name: 'More pages' }))
    const link = nav.getByRole('link', { name: /^Strength/ })
    expect(link).toHaveAttribute('href', '/strength')
    expect(link).toHaveTextContent('Lifts, loads and history')
    expectCleanCopy(link)
  })

  test('Strength is not in the tab bar: More is the one current item on its page', () => {
    renderWithProviders(<Nav />, { route: '/strength' })
    expect(primaryLinks().map((l) => l.textContent)).toEqual([
      'Today',
      'Log',
      'Plan',
      'Review',
      'More',
    ])
    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual(['More'])
  })

  test('the app routes /strength to the Strength page, inside the layout', async () => {
    const { calls } = mockApi({
      'GET /api/setup': () => ({ needsSetup: false }),
      'GET /api/auth/me': () => ({
        id: 'u1',
        email: 'runner@example.com',
        displayName: null,
        units: 'km',
        weightUnit: 'lb',
      }),
      'GET /api/settings': () => ({
        email: 'runner@example.com',
        displayName: null,
        units: 'km',
        weightUnit: 'lb',
      }),
      'GET /api/strength': () => pageView(),
      'GET /api/profile': () => PROFILE,
    })
    renderWithProviders(<App />, { route: '/strength' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Strength' })).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Next session' }),
    ).toBeInTheDocument()
    expect(calls.map((call) => call.url)).toContain('/api/strength')
    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})

describe('Weekly brief navigation', () => {
  test('More lists Weekly brief, and the link goes to /brief', () => {
    renderWithProviders(<MorePage />, { route: '/more' })
    const nav = within(screen.getByRole('navigation', { name: 'More pages' }))
    const link = nav.getByRole('link', { name: /^Weekly brief/ })
    expect(link).toHaveAttribute('href', '/brief')
    expectCleanCopy(link)
  })

  test.each(['/brief', '/brief/2027-01-04'])('More is the one current item on %s', (route) => {
    renderWithProviders(<Nav />, { route })
    const current = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual(['More'])
  })

  test.each([
    ['/brief', '/api/brief'],
    ['/brief/2027-01-04', '/api/brief?weekStart=2027-01-04'],
  ])('the app routes %s to the brief page, inside the layout', async (route, url) => {
    const { calls } = mockApi({
      'GET /api/setup': () => ({ needsSetup: false }),
      'GET /api/auth/me': () => ({
        id: 'u1',
        email: 'runner@example.com',
        displayName: null,
        units: 'km',
      }),
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
      'GET /api/brief': () => ({
        brief: makeView({
          seen: true,
          revision: makeUpdate({ seenAt: '2027-01-12T08:00:00.000Z' }),
        }),
      }),
    })
    renderWithProviders(<App />, { route })
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Weekly brief' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 2, name: 'What changed and why' }),
    ).toBeInTheDocument()
    expect(calls.map((call) => call.url)).toContain(url)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})
