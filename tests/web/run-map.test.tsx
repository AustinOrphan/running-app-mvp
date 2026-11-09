import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler } from 'react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { encodePolyline } from '../../shared/importers/files/track.ts'
import type { Activity, ActivityDetail, ActivityTrackView } from '../../shared/types.ts'
import { createDistanceCursor } from '../../web/components/map/distanceCursor.ts'
import { RunMap } from '../../web/components/map/RunMap.tsx'
import { MAP_TILES_KEY } from '../../web/components/map/useMapTiles.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { ActivityDetailPage } from '../../web/pages/ActivityDetailPage.tsx'
import { makeActivity } from '../factories.ts'
import { makeToday } from './today-fixtures.ts'
import { makeView } from './strength-fixtures.ts'
import { mockApi, noTrackRoute, renderWithProviders, type MockRoutes } from './helpers.tsx'

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

interface PageOptions {
  activity?: Partial<Activity>
  /** Replaces fields of the stream (`d: null` makes a chart against time). */
  stream?: Partial<NonNullable<ActivityDetail['stream']>>
}

function renderPage(
  track: ActivityTrackView | null,
  routes: MockRoutes = {},
  options: PageOptions = {},
) {
  const t = Array.from({ length: 12 }, (_, i) => i * 10)
  const detail: ActivityDetail = {
    activity: makeActivity({
      id: 'a1',
      date: '2026-03-02',
      durationSec: 1800,
      distanceM: 5000,
      type: 'run',
      ...options.activity,
    }),
    stream: {
      sampleSec: 10,
      t,
      d: t.map((_, i) => (i + 1) * 30),
      hr: t.map((_, i) => 140 + i),
      alt: t.map((_, i) => 100 + i),
      cad: null,
      pwr: null,
      ...options.stream,
    },
    laps: null,
    hasFile: false,
  }
  mockApi({
    'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'km' }),
    'GET /api/activities/a1/detail': () => detail,
    'GET /api/activities/a1/standout': () => ({ items: [], more: 0 }),
    'GET /api/plan': () => null,
    'GET /api/zones': () => ({ hr: null }),
    'GET /api/today': () => makeToday(),
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
      // the tile server's usage policy asks for a referer; the page's own policy sends none
      expect(tile).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
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

  test('shows no section when the track answers 404', async () => {
    renderPage(null)
    await screen.findByRole('heading', { level: 2, name: 'Summary' })
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Route of this run' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: 'Route' })).not.toBeInTheDocument()
  })

  test.each([
    ['a treadmill run', { type: 'run' as const, subtype: 'treadmill' }],
    ['a strength session', { type: 'strength' as const, subtype: null }],
  ])('%s shows no section and never asks for a track', async (_name, activity) => {
    const asked: string[] = []
    renderPage(
      makeTrack(),
      {
        'GET /api/activities/a1/track': () => {
          asked.push('track')
          return makeTrack()
        },
        'GET /api/strength': () => makeView(),
        'GET /api/strength/logs': () => [],
      },
      { activity },
    )
    await screen.findByRole('heading', { level: 2, name: 'Summary' })
    // let anything the page was going to ask for reach the mock
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(asked).toEqual([])
    expect(screen.queryByRole('region', { name: 'Route of this run' })).not.toBeInTheDocument()
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

  test('after every tile failed, going offline and back online asks for the tiles again', async () => {
    let onLine = true
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => onLine)
    renderPage(makeTrack())
    const section = await routeSection()
    for (const tile of tileImages(section)) fireEvent.error(tile)
    await waitFor(() => {
      expect(within(section).getByText(/The street map did not load\./)).toBeInTheDocument()
    })

    onLine = false
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(tileImages()).toHaveLength(0)
    onLine = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => {
      expect(tileImages(section).length).toBeGreaterThan(0)
    })
    for (const tile of tileImages(section)) expect(tile).toBeVisible()
    expect(within(section).queryByText(/did not load/)).not.toBeInTheDocument()
    expect(within(section).getByRole('link', { name: /OpenStreetMap/ })).toBeInTheDocument()
  })

  test('turning the switch off and on again also gives failed tiles another go', async () => {
    renderPage(makeTrack())
    const section = await routeSection()
    for (const tile of tileImages(section)) fireEvent.error(tile)
    await waitFor(() => {
      expect(within(section).getByText(/The street map did not load\./)).toBeInTheDocument()
    })
    act(() => {
      localStorage.setItem(MAP_TILES_KEY, 'off')
      window.dispatchEvent(new StorageEvent('storage', { key: MAP_TILES_KEY }))
    })
    expect(tileImages()).toHaveLength(0)
    act(() => {
      localStorage.setItem(MAP_TILES_KEY, 'on')
      window.dispatchEvent(new StorageEvent('storage', { key: MAP_TILES_KEY }))
    })
    await waitFor(() => {
      expect(tileImages(section).length).toBeGreaterThan(0)
    })
    for (const tile of tileImages(section)) expect(tile).toBeVisible()
  })

  test('a Try again link after every tile failed loads them again', async () => {
    const user = userEvent.setup()
    renderPage(makeTrack())
    const section = await routeSection()
    for (const tile of tileImages(section)) fireEvent.error(tile)
    await user.click(await within(section).findByRole('button', { name: 'Try again.' }))
    // the button left with the note: focus is on the map, not dropped to the page
    expect(document.activeElement).toBe(section.querySelector('figure'))
    await waitFor(() => {
      expect(within(section).queryByText(/did not load/)).not.toBeInTheDocument()
    })
    expect(tileImages(section).length).toBeGreaterThan(0)
    for (const tile of tileImages(section)) expect(tile).toBeVisible()
    expect(within(section).getByRole('link', { name: /OpenStreetMap/ })).toBeInTheDocument()
  })

  test('a tile that errors and then loads is shown again', async () => {
    renderPage(makeTrack())
    const section = await routeSection()
    const [tile] = tileImages(section)
    fireEvent.error(tile!)
    await waitFor(() => {
      expect(tile).not.toBeVisible()
    })
    fireEvent.load(tile!)
    await waitFor(() => {
      expect(tile).toBeVisible()
    })
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
    const focusable = section.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])')
    expect(Array.from(focusable).map((el) => el.textContent)).toEqual([
      '© OpenStreetMap contributors',
    ])
    for (const img of tileImages(section)) expect(img.draggable).toBe(false)
  })
})

describe('the chart cursor and the map', () => {
  function dotOf(section: HTMLElement): HTMLElement {
    const dot = section.querySelector<HTMLElement>('[data-marker="cursor"]')
    if (dot === null) throw new Error('no dot')
    return dot
  }
  // jsdom has no layout for a pointer to land on, so the arrow keys, which move the same cursor,
  // drive the panel; the e2e suite drives it with a real mouse.
  const panel = () => screen.findByRole('group', { name: /Pace, heart rate and elevation/ })
  const press = (element: HTMLElement, key: string, times = 1) => {
    for (let n = 0; n < times; n++) fireEvent.keyDown(element, { key })
  }
  /** A stream whose buckets are `step` metres apart, from 0. */
  const every = (step: number) => ({ d: Array.from({ length: 12 }, (_, i) => i * step) })

  test('the dot appears where the cursor is and goes when it is cleared', async () => {
    renderPage(makeTrack())
    const section = await routeSection()
    const group = await panel()
    const dot = dotOf(section)
    expect(dot.hidden).toBe(true)

    press(group, 'Home')
    expect(dot.hidden).toBe(false)
    const first = dot.style.transform
    expect(first).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\)$/)

    press(group, 'Escape')
    expect(dot.hidden).toBe(true)
    press(group, 'End')
    expect(dot.hidden).toBe(false)
    expect(dot.style.transform).not.toBe(first)
  })

  test('one cursor for the three plots: a single panel moves the dot', async () => {
    renderPage(makeTrack())
    await routeSection()
    expect(
      await screen.findAllByRole('group', { name: /Pace, heart rate and elevation/ }),
    ).toHaveLength(1)
  })

  test('puts the dot on the route: at a vertex distance it sits on that vertex', async () => {
    renderPage(makeTrack(), {}, { stream: every(50) })
    const section = await routeSection()
    const group = await panel()
    press(group, 'Home')
    press(group, 'ArrowRight', 5) // 250 m, the third point of the track
    const third = section.querySelector('polyline')?.getAttribute('points')?.split(' ')[2]
    const [x, y] = (third ?? '').split(',').map(Number)
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(dotOf(section).style.transform)
    expect(Number(m?.[1])).toBeCloseTo(x!, 0)
    expect(Number(m?.[2])).toBeCloseTo(y!, 0)
  })

  test('a chart against time (a stream with no distance) does not move the dot', async () => {
    renderPage(makeTrack(), {}, { stream: { d: null } })
    const section = await routeSection()
    const group = await panel()
    press(group, 'Home')
    press(group, 'ArrowRight', 3)
    expect(within(group).getByRole('status')).toHaveTextContent('Time')
    expect(dotOf(section).hidden).toBe(true)
  })

  test('shows no dot for a distance in the hidden ends', async () => {
    renderPage(
      makeTrack({
        endsHiddenM: 200,
        distM: [200, 250, 300, 470, 620, 700, 720],
      }),
      {},
      { stream: every(100) },
    )
    const section = await routeSection()
    const group = await panel()
    press(group, 'Home') // 0 m is inside the first 200 m
    press(group, 'ArrowRight')
    expect(dotOf(section).hidden).toBe(true) // 100 m
    press(group, 'End')
    expect(dotOf(section).hidden).toBe(true) // 1100 m is past the end
    press(group, 'Home')
    press(group, 'ArrowRight', 4)
    expect(dotOf(section).hidden).toBe(false) // 400 m
  })

  test('moving the dot commits nothing: no render of the map or its parents', () => {
    const cursor = createDistanceCursor()
    const commits: string[] = []
    const { container } = renderWithProviders(
      <Profiler
        id="map"
        onRender={(id, phase) => {
          commits.push(`${id}:${phase}`)
        }}
      >
        <RunMap track={makeTrack()} units="km" distanceM={900} cursor={cursor} />
      </Profiler>,
    )
    const before = commits.length
    expect(before).toBeGreaterThan(0)
    const dot = container.querySelector<HTMLElement>('[data-marker="cursor"]')!
    const seen = new Set<string>()
    for (const d of [100, 200, 300, 400, 500, 600]) {
      act(() => {
        cursor.set(d)
      })
      expect(dot.hidden).toBe(false)
      seen.add(dot.style.transform)
    }
    // the dot moved to six places, and React committed nothing for any of them
    expect(seen.size).toBeGreaterThan(1)
    expect(commits.length).toBe(before)
  })
})
