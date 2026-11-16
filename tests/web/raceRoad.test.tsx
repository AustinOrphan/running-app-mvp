// The road race plan on the web (rule H15, ADR 0023): the Race page blocks, the More row, the Today
// card and the race-day block of the session sheet, each cut from one fixture plan, plus the shapes
// an older or newer server may send. Synthetic plans only.
import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { raceEmptyText } from '../../shared/copy/racePlan.ts'
import { describeRoadRacePlan, describeRoadRaceSummary } from '../../shared/copy/racePlanRoad.ts'
import { addDays } from '../../shared/dates.ts'
import type { PlanSession, UserSettings } from '../../shared/types.ts'
import { keys } from '../../web/api/client.ts'
import { RaceSessionSection } from '../../web/components/race/RaceSessionSection.tsx'
import { TodaySlot } from '../../web/components/today/TodaySlot.tsx'
import { MorePage } from '../../web/pages/MorePage.tsx'
import { RacePage } from '../../web/pages/RacePage.tsx'
import { expectCleanCopy, makeTestQueryClient, mockApi, renderWithProviders } from './helpers.tsx'
import { ROAD_RACE, roadPlan, roadSummary } from './road-fixtures.ts'
import { makeCoach, makeToday } from './today-fixtures.ts'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

const SETTINGS: UserSettings = {
  email: 'runner@example.com',
  displayName: null,
  units: 'km',
  weightUnit: 'lb',
  showBodyWeight: false,
  hideMapEnds: true,
}

const headingsOf = async () =>
  (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent)

function renderRace(view: unknown, route = '/race') {
  mockApi({
    'GET /api/race/plan': () => view,
    'GET /api/settings': () => SETTINGS,
  })
  return renderWithProviders(<RacePage />, { route })
}

describe('RacePage: the road blocks', () => {
  test('a marathon in heat lays out every block in reading order, from the one object', async () => {
    const road = roadPlan('marathon-heat')
    renderRace({ plan: null, reason: 'not-ultra', road })
    expect(await screen.findByRole('heading', { level: 1, name: 'Race plan' })).toBeInTheDocument()
    expect(await headingsOf()).toEqual([
      'Expected time',
      'Average pace',
      'First half',
      'Heat',
      'Fuel and fluid',
      'Race week',
      'Not in this plan',
    ])
    const text = describeRoadRacePlan(road, 'km')
    expect(screen.getByText(text.expected.figure)).toBeInTheDocument()
    expect(screen.getByText(text.expected.source)).toBeInTheDocument()
    expect(screen.getByText(text.pace?.range ?? '')).toBeInTheDocument()
    expect(screen.getByText(text.firstHalf?.population ?? '')).toBeInTheDocument()
    expect(screen.getByText(text.firstHalf?.figure ?? '')).toBeInTheDocument()
    for (const line of text.heat) expect(screen.getByText(line)).toBeInTheDocument()
    expect(screen.getByText(text.fuel?.rate ?? '')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Disclaimer' })).toBeInTheDocument()
    // no checkpoint editor, course import or printable card for a road race
    expect(screen.queryByRole('button', { name: /checkpoint/i })).toBeNull()
    expect(screen.queryByRole('radio', { name: /card/i })).toBeNull()
    expectCleanCopy(document.body)
  })

  test('a half under 2 hours states no rate and shows the fluid lines and the safety card', async () => {
    const road = roadPlan('half-under-2h')
    renderRace({ plan: null, reason: 'not-ultra', road })
    await screen.findByRole('heading', { level: 2, name: 'Expected time' })
    const text = describeRoadRacePlan(road, 'km')
    expect(text.fluid).not.toBeNull()
    expect(text.fuel).toBeNull()
    for (const line of text.fluid?.short ?? []) expect(screen.getByText(line)).toBeInTheDocument()
    expect(screen.getByText(text.fluid?.fluid ?? '')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: text.fluid?.labLink ?? '' })).toHaveAttribute(
      'href',
      '/fuel',
    )
    expect(screen.getByRole('note', { name: text.fluid?.eah.heading })).toBeInTheDocument()
    expect(screen.queryByText(/Nausea/i)).toBeNull()
    // a half has no first-half line
    expect(screen.queryByRole('heading', { name: 'First half' })).toBeNull()
    expectCleanCopy(document.body)
  })

  test('a 10 km gets the time, pace and heat blocks and no fuel, first half or race week', async () => {
    const road = roadPlan('10k')
    renderRace({ plan: null, reason: 'not-ultra', road })
    await screen.findByRole('heading', { level: 2, name: 'Expected time' })
    const headings = await headingsOf()
    expect(headings).toContain('Average pace')
    expect(headings).not.toContain('First half')
    expect(headings).not.toContain('Fuel and fluid')
    expect(headings).not.toContain('Race week')
    expectCleanCopy(document.body)
  })

  test('a trail marathon has no pace and no first-half block, and says why', async () => {
    const road = roadPlan('trail-marathon')
    renderRace({ plan: null, reason: 'not-ultra', road })
    await screen.findByRole('heading', { level: 2, name: 'Expected time' })
    const headings = await headingsOf()
    expect(headings).not.toContain('Average pace')
    expect(headings).not.toContain('First half')
    const text = describeRoadRacePlan(road, 'km')
    expect(text.notices.length).toBeGreaterThan(0)
    for (const notice of text.notices) expect(screen.getByText(notice.text)).toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('?view=card on a road plan shows the page', async () => {
    renderRace(
      { plan: null, reason: 'not-ultra', road: roadPlan('marathon-heat') },
      '/race?view=card',
    )
    expect(await screen.findByRole('heading', { level: 2, name: 'Expected time' })).toBeVisible()
  })

  test('on the phone copy it says when the plan was saved', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderRace({
      plan: null,
      reason: 'not-ultra',
      road: roadPlan('marathon-heat'),
      servedFromCache: true,
      savedAt: '2026-06-08T06:12:00.000Z',
    })
    expect(await screen.findByText(/^Offline\. Showing the race plan saved/)).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: 'Expected time' })).toBeVisible()
  })
})

describe('RacePage: shapes an older or newer server sends', () => {
  test('a view with no road key and an unknown extra field renders the empty state', async () => {
    renderRace({ plan: null, reason: 'not-ultra', somethingNew: { a: 1 } })
    expect(await screen.findByText(raceEmptyText('not-ultra', 'km'))).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull()
  })

  test('a view with road null renders the empty state', async () => {
    renderRace({ plan: null, reason: 'not-ultra', road: null })
    expect(await screen.findByText(raceEmptyText('not-ultra', 'km'))).toBeInTheDocument()
  })

  test('a road plan with fields and a notice the client does not know renders without them', async () => {
    const road = roadPlan('marathon-heat')
    const odd = {
      ...road,
      futureBlock: { lines: ['x'] },
      heat: { ...road.heat, futureField: 3 },
      notices: [...road.notices, 'a-notice-from-a-newer-server'],
    }
    renderRace({ plan: null, reason: 'not-ultra', road: odd })
    expect(await screen.findByRole('heading', { level: 2, name: 'Expected time' })).toBeVisible()
    expect(screen.queryByText(/a-notice-from-a-newer-server/)).toBeNull()
    expect(screen.queryByText('undefined')).toBeNull()
  })
})

describe('MorePage: the Race plan row for a road goal', () => {
  test('is listed when the view holds a road plan', async () => {
    mockApi({
      'GET /api/race/plan': () => ({
        plan: null,
        reason: 'not-ultra',
        road: roadPlan('marathon-heat'),
      }),
    })
    renderWithProviders(<MorePage />, { route: '/more' })
    const nav = within(screen.getByRole('navigation', { name: 'More pages' }))
    expect(await nav.findByRole('link', { name: /^Race plan/ })).toHaveAttribute('href', '/race')
  })

  test('is not listed for an old view with no road key', async () => {
    const { calls } = mockApi({
      'GET /api/race/plan': () => ({ plan: null, reason: 'not-ultra' }),
    })
    renderWithProviders(<MorePage />, { route: '/more' })
    await screen.findByRole('link', { name: /^Settings/ })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls.map((call) => call.url)).toContain('/api/race/plan')
    expect(screen.queryByRole('link', { name: /^Race plan/ })).toBeNull()
  })
})

/** A Today payload in the cache with `roadRace` filled (and `race` null), as the page holds it. */
function seededRoadClient(kind: Parameters<typeof roadPlan>[0], date: string, extra = {}) {
  const road = roadPlan(kind)
  const summary = roadSummary(road, date)
  const queryClient = makeTestQueryClient()
  queryClient.setQueryData(
    [keys.today],
    makeToday({
      date,
      coach: makeCoach({
        slots: { ...makeCoach().slots, race: null, roadRace: summary, ...extra },
      }),
    }),
  )
  queryClient.setQueryData([keys.settings], SETTINGS)
  return { queryClient, summary }
}

describe('Today: the road race card', () => {
  test('shows the days to go, the carbohydrate line and the link in race week', () => {
    const { queryClient, summary } = seededRoadClient('marathon-heat', addDays(ROAD_RACE, -2))
    if (summary === null) throw new Error('expected a summary')
    renderWithProviders(<TodaySlot name="race" />, { queryClient })
    const text = describeRoadRaceSummary(summary, 'km')
    const card = screen.getByRole('region', { name: text.heading })
    expect(within(card).getByRole('heading', { name: text.daysToGo })).toBeInTheDocument()
    expect(within(card).getByText(text.carb ?? '')).toBeInTheDocument()
    expect(within(card).queryByText(text.expected)).toBeNull()
    expect(within(card).getByRole('link', { name: text.open })).toHaveAttribute('href', '/race')
    expectCleanCopy(card)
  })

  test('adds the expected range on the race day', () => {
    const { queryClient, summary } = seededRoadClient('half-under-2h', ROAD_RACE)
    if (summary === null) throw new Error('expected a summary')
    renderWithProviders(<TodaySlot name="race" />, { queryClient })
    expect(screen.getByText(describeRoadRaceSummary(summary, 'km').expected)).toBeInTheDocument()
  })

  test('renders nothing outside race week, or with an unknown extra slot key', () => {
    const { queryClient } = seededRoadClient('marathon-heat', addDays(ROAD_RACE, -30), {
      somethingNew: { a: 1 },
    })
    renderWithProviders(<TodaySlot name="race" />, { queryClient })
    expect(screen.queryByRole('region')).toBeNull()
  })

  test('a Today payload with no roadRace key renders no card', () => {
    const queryClient = makeTestQueryClient()
    queryClient.setQueryData([keys.today], makeToday())
    queryClient.setQueryData([keys.settings], SETTINGS)
    renderWithProviders(<TodaySlot name="race" />, { queryClient })
    expect(screen.queryByRole('region')).toBeNull()
  })
})

const ROAD_SESSION = {
  id: 's-race',
  date: ROAD_RACE,
  kind: 'race',
  title: 'Race',
  durationMin: 240,
  status: 'planned',
  flags: [],
} as unknown as PlanSession

describe('the race-day block of the session sheet, for a road race', () => {
  test('a marathon shows the range, the fuel block and the link on the race day', () => {
    const { queryClient, summary } = seededRoadClient('marathon-heat', ROAD_RACE)
    if (summary === null) throw new Error('expected a summary')
    renderWithProviders(<RaceSessionSection session={ROAD_SESSION} units="km" />, { queryClient })
    const text = describeRoadRaceSummary(summary, 'km')
    expect(screen.getByRole('heading', { name: 'Race day' })).toBeInTheDocument()
    expect(screen.getByText(text.expected)).toBeInTheDocument()
    expect(screen.getByText(text.fuel?.rate ?? '')).toBeInTheDocument()
    expect(screen.getByRole('note', { name: text.fuel?.eah.heading })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the race plan' })).toHaveAttribute(
      'href',
      '/race',
    )
  })

  test('a half under 2 hours shows the fluid lines and no rate', () => {
    const { queryClient, summary } = seededRoadClient('half-under-2h', ROAD_RACE)
    if (summary === null) throw new Error('expected a summary')
    renderWithProviders(<RaceSessionSection session={ROAD_SESSION} units="km" />, { queryClient })
    const text = describeRoadRaceSummary(summary, 'km')
    expect(text.fuel).toBeNull()
    for (const line of text.fluid?.short ?? []) expect(screen.getByText(line)).toBeInTheDocument()
    expect(screen.getByText(text.fluid?.fluid ?? '')).toBeInTheDocument()
    expect(screen.getByRole('note', { name: text.fluid?.eah.heading })).toBeInTheDocument()
  })

  test('is the link alone on any other day', () => {
    const { queryClient } = seededRoadClient('marathon-heat', addDays(ROAD_RACE, -2))
    renderWithProviders(<RaceSessionSection session={ROAD_SESSION} units="km" />, { queryClient })
    expect(screen.getByRole('heading', { name: 'Race plan' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the race plan' })).toBeInTheDocument()
    expect(screen.queryByRole('note')).toBeNull()
  })
})
