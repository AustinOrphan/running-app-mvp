import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { encodePolyline } from '../../shared/importers/files/track.ts'
import type { ActivityDetail, ActivityTrackView } from '../../shared/types.ts'
import { createDistanceCursor } from '../../web/components/map/distanceCursor.ts'
import { RunMap } from '../../web/components/map/RunMap.tsx'
import { MAP_TILES_KEY } from '../../web/components/map/useMapTiles.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ActivityDetailPage } from '../../web/pages/ActivityDetailPage.tsx'
import { makeActivity } from '../factories.ts'
import { mockApi, noTrackRoute, renderWithProviders, type MockRoutes } from './helpers.tsx'

// The chart's own pointer handling needs layout that jsdom does not have; the tooltip is replaced
// by a stand-in that calls the chart's `content` as recharts does, so the chart's wiring to the map
// is what the tests exercise (the e2e suite drives the real chart).
let hoverLabel = 0.5
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  function Tooltip(props: { content?: (p: object) => ReactNode }) {
    const [active, setActive] = useState(false)
    return (
      <g
        data-testid="chart-pointer"
        onClick={() => {
          setActive((on) => !on)
        }}
      >
        {props.content?.({ active, label: hoverLabel, payload: [] })}
      </g>
    )
  }
  return { ...actual, Tooltip }
})

const BOX = { width: 360, height: 240 }

function stubLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const framed = this.className.toString().includes('frame')
    const size = framed ? BOX : { width: 0, height: 0 }
    return {
      ...size,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: size.width,
      bottom: size.height,
    } as DOMRect
  })
}

/** A made-up loop in open ocean, a few hundred metres across. */
const LOOP: Array<[number, number]> = [
  [12.3456, -45.6789],
  [12.3466, -45.6789],
  [12.3476, -45.6779],
  [12.3476, -45.6759],
  [12.3466, -45.6749],
  [12.3456, -45.6759],
  [12.3456, -45.6789],
]

function makeTrack(over: Partial<ActivityTrackView> = {}): ActivityTrackView {
  const lats = LOOP.map(([lat]) => lat)
  const lngs = LOOP.map(([, lng]) => lng)
  return {
    activityId: 'a1',
    v: 1,
    polyline: encodePolyline(LOOP),
    distM: [0, 110, 250, 470, 620, 780, 900],
    pointCount: LOOP.length,
    bbox: {
      minLat: Math.min(...lats),
      minLng: Math.min(...lngs),
      maxLat: Math.max(...lats),
      maxLng: Math.max(...lngs),
    },
    endsHiddenM: 0,
    ...over,
  }
}

const TILE_HOST = 'https://tile.openstreetmap.org/'

function tileImages(container: ParentNode = document.body): HTMLImageElement[] {
  return Array.from(container.querySelectorAll('img')).filter((img) =>
    img.src.startsWith(TILE_HOST),
  )
}

/** The route section once its map has been laid out (the loading frame has the same name). */
async function routeSection(): Promise<HTMLElement> {
  const section = await screen.findByRole('region', { name: 'Route of this run' })
  await within(section).findByRole('img', { name: 'Map of the route' })
  return section
}

function renderPage(track: ActivityTrackView | null, routes: MockRoutes = {}) {
  const t = Array.from({ length: 12 }, (_, i) => i * 10)
  const detail: ActivityDetail = {
    activity: makeActivity({
      id: 'a1',
      date: '2026-03-02',
      durationSec: 1800,
      distanceM: 5000,
      type: 'run',
    }),
    stream: {
      sampleSec: 10,
      t,
      d: t.map((_, i) => (i + 1) * 30),
      hr: t.map((_, i) => 140 + i),
      alt: t.map((_, i) => 100 + i),
      cad: null,
      pwr: null,
    },
    laps: null,
    hasFile: false,
  }
  mockApi({
    'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
    'GET /api/activities/a1/detail': () => detail,
    'GET /api/activities/a1/standout': () => ({ items: [], more: 0 }),
    'GET /api/plan': () => null,
    ...(track === null ? noTrackRoute : { 'GET /api/activities/a1/track': () => track }),
    ...routes,
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

beforeEach(() => {
  stubLayout()
  localStorage.removeItem(MAP_TILES_KEY)
  hoverLabel = 0.5
  vi.stubGlobal('devicePixelRatio', 1)
  class FixedObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { ...BOX } as DOMRectReadOnly } as ResizeObserverEntry],
        this,
      )
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FixedObserver)
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(MAP_TILES_KEY)
})

describe('the route map on the activity page', () => {
  test('shows a named section with the map, tiles, route, scale bar, credit and a text summary', async () => {
    renderPage(makeTrack())
    const section = await routeSection()
    expect(within(section).getByRole('heading', { level: 2, name: 'Route' })).toBeInTheDocument()
    expect(within(section).getByRole('img', { name: 'Map of the route' })).toBeInTheDocument()

    const tiles = tileImages(section)
    expect(tiles.length).toBeGreaterThan(0)
    for (const tile of tiles) {
      expect(tile.src).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/)
      expect(tile).toHaveAttribute('alt', '')
    }

    // the route, a start and a finish marker, and no cut ends
    expect(section.querySelectorAll('polyline')).toHaveLength(2)
    expect(section.querySelector('[data-marker="start"]')).not.toBeNull()
    expect(section.querySelector('[data-marker="finish"]')).not.toBeNull()
    expect(section.querySelector('[data-marker^="cut"]')).toBeNull()

    // a scale bar in the runner's unit (kilometres here)
    expect(section.querySelector('[data-scale]')?.getAttribute('data-scale')).toMatch(/ (m|km)$/)

    const credit = within(section).getByRole('link', { name: '© OpenStreetMap contributors' })
    expect(credit).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')

    // the text summary: the activity's distance, and the ends are not hidden
    expect(within(section).getByText(/Route, 5\.00 km\./)).toBeInTheDocument()
    expect(within(section).getByText(/The whole route is shown\./)).toBeInTheDocument()
  })

  test('sits after the summary and before the charts', async () => {
    renderPage(makeTrack())
    await screen.findByRole('region', { name: 'Route of this run' })
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(names.indexOf('Summary')).toBeLessThan(names.indexOf('Route'))
    expect(names.indexOf('Route')).toBeLessThan(names.indexOf('Charts'))
  })

  test('a scale bar in miles for a runner in miles', () => {
    const { container } = renderWithProviders(
      <RunMap track={makeTrack()} units="mi" distanceM={5000} />,
    )
    expect(container.querySelector('[data-scale]')?.getAttribute('data-scale')).toMatch(/ (ft|mi)$/)
  })

  test('uses tiles one zoom deeper on a high-density screen', () => {
    const zoomsAt = (ratio: number): Set<string> => {
      vi.stubGlobal('devicePixelRatio', ratio)
      const { container, unmount } = renderWithProviders(
        <RunMap track={makeTrack()} units="km" distanceM={900} />,
      )
      const zooms = new Set(tileImages(container).map((img) => img.src.split('/')[3] ?? ''))
      unmount()
      return zooms
    }
    const low = [...zoomsAt(1)].map(Number)
    const high = [...zoomsAt(2)].map(Number)
    expect(low).toHaveLength(1)
    expect(high).toEqual([low[0]! + 1])
  })

  test('shows no section for a run with no track, and asks nothing else of the server', async () => {
    renderPage(null)
    await screen.findByRole('heading', { level: 2, name: 'Summary' })
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Route of this run' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: 'Route' })).not.toBeInTheDocument()
  })

  test('says the ends are hidden and marks the cut ends, not a start and a finish', async () => {
    renderPage(makeTrack({ endsHiddenM: 200 }))
    const section = await routeSection()
    expect(within(section).getByText(/The first and last 200 m are hidden\./)).toBeInTheDocument()
    expect(section.querySelector('[data-marker="cut-start"]')).not.toBeNull()
    expect(section.querySelector('[data-marker="cut-end"]')).not.toBeNull()
    expect(section.querySelector('[data-marker="start"]')).toBeNull()
    expect(section.querySelector('[data-marker="finish"]')).toBeNull()
    expect(within(section).queryByText(/The whole route is shown/)).not.toBeInTheDocument()
  })

  test('with Map tiles off it requests no tile, credits no one and draws the route and scale alone', async () => {
    localStorage.setItem(MAP_TILES_KEY, 'off')
    renderPage(makeTrack())
    const section = await routeSection()
    expect(tileImages()).toHaveLength(0)
    expect(within(section).queryByRole('link', { name: /OpenStreetMap/ })).not.toBeInTheDocument()
    expect(section.querySelectorAll('polyline')).toHaveLength(2)
    expect(section.querySelector('[data-scale]')).not.toBeNull()
    expect(within(section).getByText('Map tiles are off.')).toBeInTheDocument()
    expect(
      within(section).getByRole('link', { name: 'Turn them on in Settings.' }),
    ).toHaveAttribute('href', '/settings')
  })

  test('offline it requests no tile and says so', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderPage(makeTrack())
    const section = await routeSection()
    expect(tileImages()).toHaveLength(0)
    expect(
      within(section).getByText(/Offline: the route is drawn without a street map\./),
    ).toBeInTheDocument()
    expect(section.querySelectorAll('polyline')).toHaveLength(2)
  })

  test('when every tile fails the route stays, the credit goes and the page says so', async () => {
    renderPage(makeTrack())
    const section = await routeSection()
    expect(within(section).getByRole('link', { name: /OpenStreetMap/ })).toBeInTheDocument()
    for (const tile of tileImages(section)) fireEvent.error(tile)
    await waitFor(() => {
      expect(within(section).getByText(/The street map did not load\./)).toBeInTheDocument()
    })
    expect(within(section).queryByRole('link', { name: /OpenStreetMap/ })).not.toBeInTheDocument()
    expect(section.querySelectorAll('polyline')).toHaveLength(2)
    expect(section.querySelector('[data-scale]')).not.toBeNull()
  })

  test('one failed tile of several leaves the others and the credit', async () => {
    renderPage(makeTrack())
    const section = await routeSection()
    const tiles = tileImages(section)
    expect(tiles.length).toBeGreaterThan(1)
    fireEvent.error(tiles[0]!)
    await waitFor(() => {
      expect(tiles[0]).not.toBeVisible()
    })
    expect(tiles[1]).toBeVisible()
    expect(within(section).getByRole('link', { name: /OpenStreetMap/ })).toBeInTheDocument()
  })

  test('a track that did not load says so with a Try again button, in the shared pattern', async () => {
    const user = userEvent.setup()
    let fail = true
    renderPage(makeTrack(), {
      'GET /api/activities/a1/track': () =>
        fail
          ? { status: 500, body: { error: { code: 'internal', message: 'Server error.' } } }
          : makeTrack(),
    })
    const section = await screen.findByRole('region', { name: 'Route of this run' })
    expect(await within(section).findByRole('alert')).toHaveTextContent('The route did not load')
    fail = false
    await user.click(within(section).getByRole('button', { name: 'Try again' }))
    expect(
      await within(section).findByRole('img', { name: 'Map of the route' }),
    ).toBeInTheDocument()
  })

  test('has no drag, wheel or key handling of its own and no focusable part but the credit', async () => {
    renderPage(makeTrack())
    const section = await routeSection()
    const focusable = section.querySelectorAll('a[href], button, [tabindex]')
    expect(Array.from(focusable).map((el) => el.textContent)).toEqual([
      '© OpenStreetMap contributors',
    ])
    for (const img of tileImages(section)) expect(img.draggable).toBe(false)
  })
})

describe('the chart pointer and the map', () => {
  function dotOf(section: HTMLElement): HTMLElement {
    const dot = section.querySelector<HTMLElement>('[data-marker="cursor"]')
    if (dot === null) throw new Error('no dot')
    return dot
  }

  test('the dot appears where the chart points and goes when the pointer leaves', async () => {
    renderPage(makeTrack())
    const section = await routeSection()
    await screen.findAllByTestId('chart-pointer')
    const dot = dotOf(section)
    expect(dot.hidden).toBe(true)

    const [pace] = screen.getAllByTestId('chart-pointer')
    hoverLabel = 0.5 // 0.5 km = 500 m
    fireEvent.click(pace!)
    expect(dot.hidden).toBe(false)
    const first = dot.style.transform
    expect(first).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\)$/)

    // the same chart, another distance: the dot moves
    fireEvent.click(pace!) // leave
    expect(dot.hidden).toBe(true)
    hoverLabel = 0.8
    fireEvent.click(pace!)
    expect(dot.hidden).toBe(false)
    expect(dot.style.transform).not.toBe(first)
  })

  test('any of the charts moves the same dot', async () => {
    renderPage(makeTrack())
    const section = await routeSection()
    const pointers = await screen.findAllByTestId('chart-pointer')
    expect(pointers).toHaveLength(3)
    for (const pointer of pointers) {
      fireEvent.click(pointer)
      expect(dotOf(section).hidden).toBe(false)
      fireEvent.click(pointer)
      expect(dotOf(section).hidden).toBe(true)
    }
  })

  test('puts the dot on the route: at a vertex distance it sits on that vertex', async () => {
    renderPage(makeTrack())
    const section = await routeSection()
    const [pointer] = await screen.findAllByTestId('chart-pointer')
    hoverLabel = 0.25 // 250 m, the third point of the track
    fireEvent.click(pointer!)
    const third = section.querySelector('polyline')?.getAttribute('points')?.split(' ')[2]
    const [x, y] = (third ?? '').split(',').map(Number)
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(dotOf(section).style.transform)
    expect(Number(m?.[1])).toBeCloseTo(x!, 0)
    expect(Number(m?.[2])).toBeCloseTo(y!, 0)
  })

  test('shows no dot for a distance in the hidden ends', async () => {
    renderPage(
      makeTrack({
        endsHiddenM: 200,
        distM: [200, 250, 300, 470, 620, 700, 720],
      }),
    )
    const section = await routeSection()
    const [pointer] = await screen.findAllByTestId('chart-pointer')
    // the pointer stand-in toggles on each click: on at a distance, off again
    for (const label of [0.1, 0.9]) {
      hoverLabel = label // 100 m is inside the first 200 m, 900 m is past the end
      fireEvent.click(pointer!)
      expect(dotOf(section).hidden).toBe(true)
      fireEvent.click(pointer!)
    }
    hoverLabel = 0.4
    fireEvent.click(pointer!)
    expect(dotOf(section).hidden).toBe(false)
  })

  test('moving the dot renders no component again', () => {
    const cursor = createDistanceCursor()
    let renders = 0
    function Probe({ children }: { children: ReactNode }) {
      renders += 1
      return <>{children}</>
    }
    const { container } = renderWithProviders(
      <Probe>
        <RunMap track={makeTrack()} units="km" distanceM={900} cursor={cursor} />
      </Probe>,
    )
    const before = renders
    const dot = container.querySelector<HTMLElement>('[data-marker="cursor"]')!
    for (const d of [100, 200, 300, 400, 500, 600]) {
      act(() => {
        cursor.set(d)
      })
      expect(dot.hidden).toBe(false)
    }
    expect(renders).toBe(before)
  })
})
