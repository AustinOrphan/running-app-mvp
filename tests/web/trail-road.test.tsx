import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SURFACE_VERSION } from '../../shared/domain/surface.ts'
import type { ActivityDetail, MapAreaView, SurfaceBins } from '../../shared/types.ts'
import { MAP_TILES_KEY } from '../../web/components/map/useMapTiles.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ActivityDetailPage } from '../../web/pages/ActivityDetailPage.tsx'
import { SettingsPage } from '../../web/pages/SettingsPage.tsx'
import { makeActivity } from '../factories.ts'
import { mockApi, noTrackRoute, renderWithProviders, type MockRoutes } from './helpers.tsx'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(MAP_TILES_KEY)
})

const SETTINGS = {
  email: 'runner@example.com',
  displayName: null,
  units: 'km',
  weightUnit: 'kg',
  showBodyWeight: false,
  hideMapEnds: true,
}

const AREA: NonNullable<MapAreaView['area']> = {
  minLat: 44.8,
  minLng: -93.2,
  maxLat: 45.2,
  maxLng: -92.8,
  fetchedAt: '2026-11-09T10:00:00.000Z',
  dataTimestamp: '2026-11-08T09:00:00Z',
  wayCount: 12345,
  outdated: false,
  runs: 12,
  done: 12,
}

function renderSettings(routes: MockRoutes) {
  const mocked = mockApi({
    'GET /api/settings': () => SETTINGS,
    'GET /api/auth/me': () => ({ id: 'u1', email: 'runner@example.com', displayName: null }),
    ...routes,
  })
  renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </ToastProvider>,
    { route: '/settings' },
  )
  return mocked
}

async function block(): Promise<HTMLElement> {
  return screen.findByRole('group', { name: 'Trail and road' })
}

describe('the Trail and road block in Settings', () => {
  test('before a download: what it does, what is sent and when, the button and the credit', async () => {
    renderSettings({ 'GET /api/map-area': () => ({ area: null, busy: false }) })
    const group = await block()
    expect(
      within(group).getByText(/Says how much of each run was on trail, paved path and road/),
    ).toBeInTheDocument()
    expect(
      within(group).getByText(
        'One request to OpenStreetMap with a box of about 40 × 40 km around where you run. No run or route is sent.',
      ),
    ).toBeInTheDocument()
    expect(within(group).getByText(/made when you press the button/)).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Download map data' })).toBeInTheDocument()
    expect(within(group).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(within(group).queryByRole('button', { name: 'Download again' })).not.toBeInTheDocument()
    const credit = within(group).getByRole('link', {
      name: 'Map data © OpenStreetMap contributors',
    })
    expect(credit).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
    // It sits in the Maps section.
    expect(screen.getByRole('heading', { name: 'Maps' })).toBeInTheDocument()
  })

  test('says so while a download is running, and holds the buttons', async () => {
    renderSettings({
      'GET /api/map-area': () => ({ area: { ...AREA }, busy: true }),
    })
    const group = await block()
    expect(await within(group).findByText(/Asking OpenStreetMap/)).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Download again' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })
})

describe('the download flow', () => {
  test('the button posts an empty body and the answer replaces the block', async () => {
    let area: MapAreaView = { area: null, busy: false }
    const { calls } = renderSettings({
      'GET /api/map-area': () => area,
      'POST /api/map-area': () => {
        area = { area: AREA, busy: false }
        return area
      },
      'DELETE /api/map-area': () => {
        area = { area: null, busy: false }
        return area
      },
    })
    const typist = userEvent.setup()
    const group = await block()
    await typist.click(within(group).getByRole('button', { name: 'Download map data' }))

    await within(group).findByText(
      'Downloaded Mon 9 Nov 2026: 12,345 ways, 12 of your runs inside the area.',
    )
    expect(
      within(group).getByText('The OpenStreetMap data is from Sun 8 Nov 2026.'),
    ).toBeInTheDocument()
    expect(within(group).getByText('Every run inside the area has its shares.')).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Download again' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toEqual([
      { method: 'POST', url: '/api/map-area', body: {} },
    ])

    await typist.click(within(group).getByRole('button', { name: 'Remove' }))
    await within(group).findByRole('button', { name: 'Download map data' })
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    expect(within(group).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  test('says how many runs are worked out while the job catches up', async () => {
    renderSettings({
      'GET /api/map-area': () => ({ area: { ...AREA, done: 3 }, busy: false }),
    })
    const group = await block()
    expect(
      await within(group).findByText(
        '3 of 12 runs are worked out so far; the rest follow in the background.',
      ),
    ).toBeInTheDocument()
  })

  test('says when the stored classes are older than the rules', async () => {
    renderSettings({
      'GET /api/map-area': () => ({ area: { ...AREA, outdated: true }, busy: false }),
    })
    const group = await block()
    expect(await within(group).findByText(/The rules that sort ways changed/)).toBeInTheDocument()
  })

  test('shows the server’s own words when OpenStreetMap refuses, and keeps the block as it was', async () => {
    const { calls } = renderSettings({
      'GET /api/map-area': () => ({ area: null, busy: false }),
      'POST /api/map-area': () => ({
        status: 502,
        body: {
          error: {
            code: 'internal',
            message:
              'OpenStreetMap refused the request (status 429). Its servers may be busy; try again later. Nothing was changed.',
          },
        },
      }),
    })
    const typist = userEvent.setup()
    const group = await block()
    await typist.click(within(group).getByRole('button', { name: 'Download map data' }))
    const alert = await within(group).findByRole('alert')
    expect(alert).toHaveTextContent('OpenStreetMap refused the request (status 429).')
    expect(within(group).getByRole('button', { name: 'Download map data' })).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })
})

describe('the run page line', () => {
  function renderRun(surfaceBins: SurfaceBins | null, type: 'run' | 'strength' = 'run') {
    const detail: ActivityDetail = {
      activity: makeActivity({
        id: 'a1',
        date: '2026-03-02',
        durationSec: 1800,
        distanceM: 5000,
        type,
        surfaceBins,
      }),
      stream: null,
      laps: null,
      hasFile: false,
    }
    mockApi({
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
      'GET /api/activities/a1/detail': () => detail,
      'GET /api/activities/a1/standout': () => ({ items: [], more: 0 }),
      'GET /api/plan': () => null,
      'GET /api/zones': () => ({ hr: null }),
      ...noTrackRoute,
    })
    renderWithProviders(
      <ToastProvider>
        <Routes>
          <Route path="/activities/:id" element={<ActivityDetailPage />} />
        </Routes>
      </ToastProvider>,
      { route: '/activities/a1' },
    )
  }

  const bins = (over: Partial<SurfaceBins>): SurfaceBins => ({
    v: SURFACE_VERSION,
    trailM: 0,
    pavedM: 0,
    roadM: 0,
    unknownM: 0,
    ...over,
  })

  test('is one line in the summary, with the credit', async () => {
    renderRun(bins({ trailM: 3100, pavedM: 500, roadM: 1400 }))
    const summary = await screen.findByRole('heading', { level: 2, name: 'Summary' })
    expect(await screen.findByText('Trail 62 % · paved path 10 % · road 28 %')).toBeInTheDocument()
    expect(screen.getByText('Map data © OpenStreetMap contributors')).toBeInTheDocument()
    expect(summary).toBeInTheDocument()
    expect(screen.queryByText(/not matched/)).not.toBeInTheDocument()
  })

  test('names the unmatched share when it is over 20 %', async () => {
    renderRun(bins({ trailM: 1500, roadM: 1500, unknownM: 1000 }))
    await screen.findByText('Trail 50 % · road 50 %')
    expect(
      screen.getByText('25 % of the route was not matched to a mapped way.'),
    ).toBeInTheDocument()
  })

  test.each([
    ['no shares yet', null],
    ['nothing matched', bins({ unknownM: 5000 })],
  ])('says nothing for a run with %s', async (_name, value) => {
    renderRun(value)
    await screen.findByRole('heading', { level: 2, name: 'Summary' })
    await waitFor(() => {
      expect(screen.queryByText(/Trail \d+ %|paved path|Map data ©/)).not.toBeInTheDocument()
    })
  })
})
