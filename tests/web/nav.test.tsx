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

/** A viewport from 720 px, where the tab bar has become the rail. */
function stubRailWidth(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 720px)',
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

describe('Nav', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  test.each([
    '/more',
    '/goals',
    '/stats',
    '/trends',
    '/settings',
    '/integrations',
    '/profile',
    '/strength',
  ])('More is current on %s', (route) => {
    renderWithProviders(<Nav />, { route })
    const current = primaryLinks().filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current.map((l) => l.textContent)).toEqual(['More'])
    // Both groups share the DOM at every width, so only one link in the whole nav may be current.
    const everywhere = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page')
    expect(everywhere.map((l) => l.textContent)).toEqual(['More'])
  })

  test('Today is current only on the root path', () => {
    renderWithProviders(<Nav />, { route: '/' })
    const current = primaryLinks().filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current.map((l) => l.textContent)).toEqual(['Today'])
  })

  test('the rail lists every page that is not a tab, in the groups of the More page', () => {
    renderWithProviders(<Nav />, { route: '/stats' })
    const rail = within(screen.getByRole('navigation', { name: 'Other pages' }))
    const groups = rail.getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-labelledby'))).toEqual([
      'rail-training',
      'rail-data',
      'rail-you',
    ])
    expect(
      groups.map((g) =>
        within(g)
          .getAllByRole('link')
          .map((l) => l.textContent),
      ),
    ).toEqual([
      ['Weekly brief', 'Goals', 'My paces', 'Strength', 'Fuel lab'],
      ['Stats', 'Trends', 'Integrations', 'Research'],
      ['Profile', 'Settings'],
    ])
    expect(rail.getByRole('link', { name: 'Stats' })).toHaveAttribute('data-current', 'true')
    // On a phone the More tab is the current item, so the rail's link is styled and not announced.
    expect(rail.getByRole('link', { name: 'Stats' })).not.toHaveAttribute('aria-current')
  })

  test('from 720 px the rail link is the current page and the hidden More tab is not announced', () => {
    stubRailWidth()
    mockApi({ 'GET /api/race/plan': () => ({ plan: null, reason: 'no-goal' }) })
    renderWithProviders(<Nav />, { route: '/stats' })
    const current = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current.map((l) => l.textContent)).toEqual(['Stats'])
  })

  test('the race plan joins the Training group once the plan exists', async () => {
    stubRailWidth()
    mockApi({ 'GET /api/race/plan': () => ({ plan: { sections: [] }, reason: null }) })
    renderWithProviders(<Nav />, { route: '/' })
    const rail = within(screen.getByRole('navigation', { name: 'Other pages' }))
    expect(await rail.findByRole('link', { name: 'Race plan' })).toHaveAttribute('href', '/race')
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

/** The More page asks whether the goal race has a plan; these tests answer that there is none. */
function noRacePlan(): void {
  mockApi({ 'GET /api/race/plan': () => ({ plan: null, reason: 'no-goal' }) })
}

describe('MorePage', () => {
  beforeEach(noRacePlan)

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

  test('groups the pages under Training, Data and You and reaches every page that is not a tab', () => {
    renderWithProviders(<MorePage />, { route: '/more' })
    const nav = within(screen.getByRole('navigation', { name: 'More pages' }))
    const groups = nav.getAllByRole('region')
    expect(groups.map((g) => within(g).getByRole('heading', { level: 2 }).textContent)).toEqual([
      'Training',
      'Data',
      'You',
    ])
    expect(
      groups.map((g) =>
        within(g)
          .getAllByRole('link')
          .map((l) => l.getAttribute('href')),
      ),
    ).toEqual([
      ['/brief', '/goals', '/paces', '/strength', '/fuel'],
      ['/stats', '/trends', '/integrations', '/research'],
      ['/profile', '/settings'],
    ])
  })

  test('has no theme control: Settings has it', () => {
    renderWithProviders(<MorePage />, { route: '/more' })
    expect(screen.queryByRole('group', { name: 'Theme' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Light|Dark|System/ })).not.toBeInTheDocument()
  })

  test('the rail and the More page list the same pages', () => {
    renderWithProviders(
      <>
        <Nav />
        <MorePage />
      </>,
      { route: '/more' },
    )
    const hrefs = (name: string) =>
      within(screen.getByRole('navigation', { name }))
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
    expect(hrefs('Other pages')).toEqual(hrefs('More pages'))
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
  beforeEach(noRacePlan)

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
  beforeEach(noRacePlan)

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
