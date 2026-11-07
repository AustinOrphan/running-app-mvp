// My paces (rule C9, ADR 0020): the easy pace, the zones and what the runner can run now, read by
// role and name from the one view `GET /api/paces` sends and the zones `GET /api/zones` sends.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { PACE_EVENTS } from '../../shared/domain/paceEvents.ts'
import { eventRow } from '../../shared/engine/myPaces.ts'
import { P } from '../../shared/engine/params/index.ts'
import { buildZones } from '../../shared/engine/zones.ts'
import type { MyPacesView, Units, UserSettings } from '../../shared/types.ts'
import { MorePage } from '../../web/pages/MorePage.tsx'
import { MyPacesPage } from '../../web/pages/MyPacesPage.tsx'
import {
  paces,
  profileFixture,
  run,
  RUNS,
  stateWith,
  TODAY,
} from '../unit/engine/myPacesFixtures.ts'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'

function settings(units: Units): UserSettings {
  return {
    email: 'runner@example.com',
    displayName: null,
    units,
    weightUnit: 'lb',
    showBodyWeight: false,
  }
}

const TEN_K = { date: '2026-03-14', distanceM: 10000, timeSec: 3000 }
const FITNESS = { races: [TEN_K], csMps: 3.5, dPrimeM: 150, csEfforts: 3 }

/** The routes of the page; a custom course in the query is answered from the same state. */
function serve(
  state = stateWith(FITNESS),
  activities = RUNS,
  units: Units = 'km',
): { view: MyPacesView; routes: Parameters<typeof mockApi>[0] } {
  const { view, zones } = paces({ state, activities, events: [...PACE_EVENTS] })
  const full: MyPacesView = { ...view, custom: null }
  return {
    view: full,
    routes: {
      'GET /api/paces': ({ query }) => {
        const distance = query.get('distanceM')
        return distance === null
          ? full
          : {
              ...full,
              custom: eventRow(state, {
                key: 'custom',
                distanceM: Number(distance),
                gainM: Number(query.get('gainM') ?? 0),
              }),
            }
      },
      'GET /api/settings': () => settings(units),
      'GET /api/zones': () => zones,
    },
  }
}

describe('MyPacesPage: the easy pace', () => {
  test('leads with the range, the heart rate, the basis and the confidence', async () => {
    const { view, routes } = serve()
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    expect(await screen.findByRole('heading', { level: 1, name: 'My paces' })).toBeInTheDocument()
    const easy = await screen.findByRole('region', { name: 'Easy pace' })
    const pace = view.easy.pace!
    expect(pace.basis).toBe('hr-model')
    expect(within(easy).getByText('/km')).toBeInTheDocument()
    expect(
      within(easy).getByText(
        `Easy running keeps your heart rate at or under ${String(pace.ceilingBpm)} bpm, on the flat in cool air.`,
      ),
    ).toBeInTheDocument()
    expect(
      within(easy).getByText(/^From 9 steady runs since 10 Jun, where your own heart rate meets/),
    ).toBeInTheDocument()
    expect(within(easy).getByText('Confidence is moderate.')).toBeInTheDocument()
    expect(within(easy).getByText('Evidence grade D')).toBeInTheDocument()
  })

  test('shows the cool, hot and climbing figures as a list of terms', async () => {
    const { routes } = serve()
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const easy = await screen.findByRole('region', { name: 'Easy pace' })
    const terms = within(easy)
      .getAllByRole('term')
      .map((term) => term.textContent)
    expect(terms).toEqual([
      'Cool and flat',
      `Hot day, WBGT ${String(P.i9.warnWbgtC.value)} °C, default heat rise`,
      `Climb of ${String(P.c9.exampleGradePct.value)}%`,
    ])
    expect(within(easy).getAllByRole('definition')).toHaveLength(3)
  })

  test('writes the pace in miles for a runner who uses them', async () => {
    const { routes } = serve(stateWith(FITNESS), RUNS, 'mi')
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const easy = await screen.findByRole('region', { name: 'Easy pace' })
    expect(within(easy).getByText('/mi')).toBeInTheDocument()
    expect(within(easy).queryByText('/km')).toBeNull()
  })

  test('with only zones, names where they came from, says heat has no figure and what a line needs', async () => {
    const { routes } = serve(stateWith(FITNESS), RUNS.slice(0, 3))
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const easy = await screen.findByRole('region', { name: 'Easy pace' })
    expect(
      within(easy).getByText(/^From your critical speed, which sets the end of zone 1/),
    ).toBeInTheDocument()
    expect(
      within(easy).getByText(/^Confidence is low: the range is a share of critical speed/),
    ).toBeInTheDocument()
    expect(within(easy).getByText(/^Heat cannot be put in minutes/)).toBeInTheDocument()
    expect(within(easy).getAllByRole('term')).toHaveLength(2)
    expect(
      within(easy).getByText(
        `A pace from your own heart rate needs ${String(P.hrModel.minQualifyingRuns.value)} steady, flat runs with heart rate in ${String(P.hrModel.windowWeeks.value)} weeks. 3 so far.`,
      ),
    ).toBeInTheDocument()
  })

  test('says a line that cannot be read yet leaves zone 1 standing in, and names a default heat rise', async () => {
    // nine runs, all at 140 bpm whatever the speed: a flat line
    const flat = Array.from({ length: 9 }, (_, i) => run(i, 3 + i * 0.005, {}, 140))
    const { routes } = serve(stateWith(FITNESS), flat)
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const easy = await screen.findByRole('region', { name: 'Easy pace' })
    expect(
      within(easy).getByText(/^Your heart-rate line does not give an easy pace yet/),
    ).toBeInTheDocument()
    expect(within(easy).queryByText(/default heat rise/)).toBeNull()
  })

  test('says in the disclosure that the heat rise is a default until hot runs of the runner exist', async () => {
    const user = userEvent.setup()
    const { routes } = serve()
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const easy = await screen.findByRole('region', { name: 'Easy pace' })
    await user.click(within(easy).getByText('How this is made'))
    expect(
      within(easy).getByText(/^The hot day uses a default rise of heart rate with heat/),
    ).toBeInTheDocument()
  })

  test('with no pace says what would give one, and links to the test', async () => {
    const { routes } = serve(stateWith({}), [])
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const easy = await screen.findByRole('region', { name: 'Easy pace' })
    expect(within(easy).getByText('No easy pace yet')).toBeInTheDocument()
    expect(
      within(easy).getByText(/^Wear a heart-rate monitor on 8 steady, flat runs/),
    ).toBeInTheDocument()
    expect(within(easy).getByRole('link', { name: 'A short test' })).toHaveAttribute(
      'href',
      '#test',
    )
  })

  test('with no heart-rate ceiling points to Profile', async () => {
    const { zones } = paces({})
    mockApi({
      'GET /api/paces': () => ({
        ...paces({
          state: { ...stateWith({}), age: null },
          profile: { ...profileFixture, hrMax: null, hrMaxSource: null, birthYear: null },
          activities: [],
        }).view,
        custom: null,
      }),
      'GET /api/settings': () => settings('km'),
      'GET /api/zones': () => zones,
    })
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const easy = await screen.findByRole('region', { name: 'Easy pace' })
    expect(within(easy).getByText(/^Your zones hold no heart-rate ceiling yet/)).toBeInTheDocument()
    expect(within(easy).getByRole('link', { name: 'Open Profile' })).toHaveAttribute(
      'href',
      '/profile',
    )
  })

  test('traces its figures to their rules in a disclosure', async () => {
    const user = userEvent.setup()
    const { routes } = serve()
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const easy = await screen.findByRole('region', { name: 'Easy pace' })
    const summary = within(easy).getByText('How this is made')
    await user.click(summary)
    expect(within(easy).getByText(/\(A8\)/)).toBeVisible()
    expect(within(easy).getByRole('button', { name: 'Why: the easy pace' })).toBeInTheDocument()
  })
})

describe('MyPacesPage: the zones', () => {
  test('shows the Profile zones with their sources, from the same read', async () => {
    const { routes } = serve()
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const section = await screen.findByRole('region', { name: 'Zones' })
    const zones = buildZones(profileFixture, stateWith(FITNESS), TODAY)
    expect(await within(section).findByText('Maximum heart rate')).toBeInTheDocument()
    expect(within(section).getByText('Easy pace limit')).toBeInTheDocument()
    expect(within(section).getAllByText(/^From critical speed, as of /).length).toBeGreaterThan(0)
    const table = within(section).getByRole('table')
    expect(within(table).getByRole('row', { name: /^Zone 1/ })).toHaveTextContent(
      `${String(zones.hr!.z1[0])} to ${String(zones.hr!.z1[1])} bpm`,
    )
    expect(within(section).getByRole('link', { name: 'Open Profile' })).toBeInTheDocument()
  })

  test('says so when the zones did not load, and the rest of the page stays', async () => {
    const { routes } = serve()
    mockApi({
      ...routes,
      'GET /api/zones': () => ({ status: 500, body: { error: { code: 'x' } } }),
    })
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    expect(
      await screen.findByText('The zones did not load. Reload the page to try again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Easy pace' })).toBeInTheDocument()
  })
})

describe('MyPacesPage: what you can run now', () => {
  test('lays out the five distances with their time, pace, basis and grade', async () => {
    const { routes } = serve()
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const events = await screen.findByRole('region', { name: 'What you can run now' })
    for (const name of ['5 km', '10 km', 'Half marathon', 'Marathon', '50 km']) {
      expect(within(events).getByRole('article', { name })).toBeInTheDocument()
    }
    const ten = within(events).getByRole('article', { name: '10 km' })
    expect(within(ten).getByText('Time')).toBeInTheDocument()
    expect(within(ten).getByText('Pace')).toBeInTheDocument()
    expect(
      within(ten).getByText(/^From your 10 km on 14 Mar and your critical speed\.$/),
    ).toBeInTheDocument()
    expect(within(ten).getByText('Evidence grade D')).toBeInTheDocument()
    // the fifty: wide on purpose, and a source from critical speed only
    const fifty = within(events).getByRole('article', { name: '50 km' })
    expect(
      within(fifty).getByText('The range is wide on purpose at this length.'),
    ).toBeInTheDocument()
    expect(within(events).getByText(/^Grade D: /)).toBeInTheDocument()
  })

  test('says a distance the data cannot support is not predicted yet', async () => {
    const { routes } = serve(stateWith({ races: [TEN_K] }))
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const events = await screen.findByRole('region', { name: 'What you can run now' })
    const fifty = within(events).getByRole('article', { name: '50 km' })
    expect(within(fifty).getByText('Not enough to say yet for this distance.')).toBeInTheDocument()
    const marathon = within(events).getByRole('article', { name: 'Marathon' })
    expect(
      within(marathon).getByText('One source only, so the range is wider.'),
    ).toBeInTheDocument()
  })

  test('asks for a course of the runner, with climb, and shows its card', async () => {
    const user = userEvent.setup()
    const { routes } = serve()
    const { calls } = mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const events = await screen.findByRole('region', { name: 'What you can run now' })
    await user.type(within(events).getByLabelText('Distance (km)'), '15')
    await user.type(within(events).getByLabelText('Climb (m), optional'), '300')
    await user.click(within(events).getByRole('button', { name: 'Show paces' }))
    const card = await within(events).findByRole('article', { name: '15.00 km' })
    expect(
      within(card).getByText(
        'Climb is counted as flat distance, and the range is widened for trail.',
      ),
    ).toBeInTheDocument()
    expect(calls.map((call) => call.url)).toContain('/api/paces?distanceM=15000&gainM=300')
    await user.click(within(events).getByRole('button', { name: 'Clear' }))
    await waitFor(() => {
      expect(within(events).queryByRole('article', { name: '15.00 km' })).toBeNull()
    })
    expect(within(events).getByLabelText('Distance (km)')).toHaveValue('')
  })

  test('keeps the page when the course does not load, and says so in its row', async () => {
    const user = userEvent.setup()
    const { routes } = serve()
    mockApi({
      ...routes,
      'GET /api/paces': ({ query }) =>
        query.get('distanceM') === null
          ? (routes['GET /api/paces'] as (r: { query: URLSearchParams }) => unknown)({ query })
          : { status: 500, body: { error: { code: 'server' } } },
    })
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const events = await screen.findByRole('region', { name: 'What you can run now' })
    await user.type(within(events).getByLabelText('Distance (km)'), '15')
    await user.click(within(events).getByRole('button', { name: 'Show paces' }))
    expect(await within(events).findByRole('alert')).toHaveTextContent(
      'That distance did not load. Try it again, or clear it.',
    )
    // the rest of the page stands, and the course can be cleared
    expect(screen.getByRole('region', { name: 'Easy pace' })).toBeInTheDocument()
    expect(within(events).getByRole('article', { name: '10 km' })).toBeInTheDocument()
    await user.click(within(events).getByRole('button', { name: 'Clear' }))
    await waitFor(() => {
      expect(within(events).queryByRole('alert')).toBeNull()
    })
  })

  test('checks the distance and the climb before asking', async () => {
    const user = userEvent.setup()
    const { routes } = serve()
    const { calls } = mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const events = await screen.findByRole('region', { name: 'What you can run now' })
    await user.click(within(events).getByRole('button', { name: 'Show paces' }))
    expect(await within(events).findByText('Enter a distance, like 12.5.')).toBeInTheDocument()
    await user.type(within(events).getByLabelText('Distance (km)'), '0.2')
    await user.type(within(events).getByLabelText('Climb (m), optional'), '12.5')
    await user.click(within(events).getByRole('button', { name: 'Show paces' }))
    expect(within(events).getByText('That distance is out of range.')).toBeInTheDocument()
    expect(within(events).getByText('Enter whole metres, like 400.')).toBeInTheDocument()
    expect(calls.filter((call) => call.url.includes('distanceM'))).toEqual([])
  })
})

describe('MyPacesPage: the test', () => {
  test('opens the steps when no distance can be predicted, from the Params of the fit', async () => {
    const { routes } = serve(stateWith({}), [])
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const test = await screen.findByRole('region', { name: 'A short test' })
    expect(
      within(test).getByText(
        `Run ${String(P.a6.csMinEfforts.value)} hard, flat efforts of 400 m to 5 km, on separate days and at different distances, after an easy warm-up.`,
      ),
    ).toBeVisible()
    expect(within(test).getByText('0 of 3 efforts found so far.')).toBeInTheDocument()
    expect(within(test).getByText(/^Make the longest last at least 2 times as long/)).toBeVisible()
  })

  test('says critical speed is in place once it is, and keeps the steps closed', async () => {
    const { routes } = serve()
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const test = await screen.findByRole('region', { name: 'A short test' })
    expect(within(test).getByText(/^Critical speed is in place\./)).toBeInTheDocument()
    expect(within(test).getByText(/^Run 3 hard, flat efforts/)).not.toBeVisible()
  })
})

describe('MyPacesPage: states', () => {
  test('says it did not load, as an alert', async () => {
    mockApi({
      'GET /api/paces': () => ({ status: 500, body: { error: { code: 'server' } } }),
      'GET /api/settings': () => settings('km'),
    })
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'My paces did not load. Reload the page to try again.',
    )
  })

  test('jumps to each section from links under the title', async () => {
    const { routes } = serve()
    mockApi(routes)
    renderWithProviders(<MyPacesPage />, { route: '/paces' })
    const nav = await screen.findByRole('navigation', { name: 'On this page' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['#easy', '#zones', '#events', '#test'])
  })

  test('every sentence of the page passes the copy lint', async () => {
    const { routes } = serve()
    mockApi(routes)
    const { container } = renderWithProviders(<MyPacesPage />, { route: '/paces' })
    await screen.findByRole('region', { name: 'A short test' })
    await screen.findByText('Maximum heart rate')
    expectCleanCopy(container)
  })

  test('a thin page passes the copy lint too', async () => {
    const { routes } = serve(stateWith({}), [])
    mockApi(routes)
    const { container } = renderWithProviders(<MyPacesPage />, { route: '/paces' })
    await screen.findByRole('region', { name: 'A short test' })
    await screen.findByText('Maximum heart rate')
    expectCleanCopy(container)
  })
})

describe('the More page', () => {
  test('lists My paces beside Goals', async () => {
    mockApi({ 'GET /api/race/plan': () => ({ plan: null, reason: 'not-ultra' }) })
    renderWithProviders(<MorePage />, { route: '/more' })
    const nav = await screen.findByRole('navigation', { name: 'More pages' })
    const link = within(nav).getByRole('link', { name: /^My paces/ })
    expect(link).toHaveAttribute('href', '/paces')
    expect(link).toHaveTextContent('Easy pace, zones and what you can run now')
  })
})
