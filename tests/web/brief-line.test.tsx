import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BriefListItem, UserSettings } from '../../shared/types.ts'
import { keys } from '../../web/api/client.ts'
import { BriefLine } from '../../web/components/BriefLine.tsx'
import { SLOT_BUDGETS_PX } from '../../web/components/today/slots.ts'
import { TodaySlot } from '../../web/components/today/TodaySlot.tsx'
import { makeItem } from './brief-fixtures.ts'
import { expectCleanCopy, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import { renderToday, startToday } from './today-render.tsx'
import { makeCoach, makeToday } from './today-fixtures.ts'

// Wednesday 13 Jan 2027, noon: the brief of Monday 11 Jan is the current week's.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-13T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

const line = (item: Partial<BriefListItem> = {}) =>
  renderWithProviders(<BriefLine item={makeItem(item)} units="km" />)

describe('BriefLine', () => {
  test('says how many sessions the update changed and the next key session', () => {
    const { container } = line()
    const region = screen.getByRole('region', { name: 'Weekly brief' })
    expect(region).toHaveTextContent(
      'Since last week: 3 changes, next key session Saturday (long run).',
    )
    expectCleanCopy(container)
  })

  test.each([
    [1, 'Since last week: 1 change, next key session Saturday (long run).'],
    [0, 'Since last week: no changes, next key session Saturday (long run).'],
  ])('%i changes', (changeCount, sentence) => {
    line({ changeCount })
    expect(screen.getByRole('region', { name: 'Weekly brief' })).toHaveTextContent(sentence)
  })

  test.each([
    [3, 'Since last week: 3 changes, no key session this week.'],
    [1, 'Since last week: 1 change, no key session this week.'],
    [0, 'Since last week: no changes, no key session this week.'],
  ])('a week without a key session leaves that half out (%i changes)', (changeCount, sentence) => {
    const { container } = line({ changeCount, nextKey: null })
    expect(screen.getByRole('region', { name: 'Weekly brief' })).toHaveTextContent(sentence)
    expectCleanCopy(container)
  })

  test('an update that was undone changed nothing now', () => {
    line({ changeCount: 3, undone: true })
    expect(screen.getByRole('region', { name: 'Weekly brief' })).toHaveTextContent(
      'Since last week: no changes, next key session Saturday (long run).',
    )
  })

  test('the whole line is one link to the brief, named by its sentence and "Open the brief"', () => {
    line()
    const link = screen.getByRole('link', { name: /Open the brief/ })
    expect(link).toHaveAttribute('href', '/brief')
    expect(link).toHaveTextContent(/Since last week: 3 changes, .* Open the brief$/)
  })

  test('one quiet "New" marker while the brief is unseen, none once it has been opened', () => {
    const { unmount } = line({ seen: false })
    expect(screen.getAllByText('New')).toHaveLength(1)
    unmount()
    line({ seen: true })
    expect(screen.queryByText('New')).not.toBeInTheDocument()
  })

  test('uses no alert and no status: it is a quiet line', () => {
    line()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

const SETTINGS: UserSettings = { email: 'runner@example.com', displayName: null, units: 'km' }

/** Makes the observer report an intersection for the targets `match` accepts, and no others. */
function nearViewport(match: (target: Element) => boolean): void {
  class Near {
    private readonly callback: IntersectionObserverCallback
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback
    }
    observe(target: Element): void {
      if (!match(target)) return
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      )
    }
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }
  vi.stubGlobal('IntersectionObserver', Near)
}

/** The `brief` slot of Today with the settings already in the cache, as the page leaves them. */
function renderSlot(
  routes: MockRoutes,
  settings: UserSettings | null = SETTINGS,
  children?: ReactNode,
) {
  const api = mockApi(routes)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  if (settings !== null) queryClient.setQueryData([keys.settings], settings)
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TodaySlot name="brief">{children}</TodaySlot>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { api, ...view }
}

const briefs = (items: BriefListItem[]) => () => ({ briefs: items })

describe('the brief slot', () => {
  test('is 52 px, the budget the line is built to', () => {
    expect(SLOT_BUDGETS_PX.brief).toBe(52)
  })

  test('asks for nothing and draws nothing until the slot is near the viewport', () => {
    const { api, container } = renderSlot({ 'GET /api/briefs': briefs([makeItem()]) })
    expect(api.calls).toEqual([])
    expect(container.querySelector('[data-slot]')).toBeNull()
  })

  test('near the viewport it asks for the newest brief and fills the slot within its budget', async () => {
    nearViewport(() => true)
    const { api, container } = renderSlot({ 'GET /api/briefs': briefs([makeItem()]) })
    const region = await screen.findByRole('region', { name: 'Weekly brief' })
    expect(api.calls.map((call) => call.url)).toEqual(['/api/briefs?limit=1'])
    const slot = region.closest('[data-slot]')
    expect(slot).toHaveAttribute('data-slot', 'brief')
    expect(slot).toHaveAttribute('data-budget-px', '52')
    expect(within(region).getByText('New')).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('the marker that finds the slot takes no room: it is out of the layout', async () => {
    nearViewport(() => true)
    const { container } = renderSlot({ 'GET /api/briefs': briefs([makeItem()]) })
    await screen.findByRole('region', { name: 'Weekly brief' })
    const marker = container.querySelector('[aria-hidden="true"]')
    expect(marker).toHaveStyle({ position: 'absolute', width: '1px', height: '1px' })
  })

  test('without the settings in the cache it does nothing, whatever is in view', () => {
    nearViewport(() => true)
    const { api, container } = renderSlot({ 'GET /api/briefs': briefs([makeItem()]) }, null)
    expect(api.calls).toEqual([])
    expect(container).toBeEmptyDOMElement()
  })

  test('shows only the brief of the current week', async () => {
    nearViewport(() => true)
    const { api, container } = renderSlot({
      'GET /api/briefs': briefs([makeItem({ weekStart: '2027-01-04' })]),
    })
    await waitFor(() => {
      expect(api.calls).toHaveLength(1)
    })
    await waitFor(() => {
      expect(container.querySelector('[data-slot]')).toBeNull()
    })
    expect(screen.queryByRole('region', { name: 'Weekly brief' })).not.toBeInTheDocument()
  })

  test('an account with no brief yet has no line', async () => {
    nearViewport(() => true)
    const { api, container } = renderSlot({ 'GET /api/briefs': briefs([]) })
    await waitFor(() => {
      expect(api.calls).toHaveLength(1)
    })
    expect(container.querySelector('[data-slot]')).toBeNull()
  })

  test('a failed request leaves the slot empty and raises no alert', async () => {
    nearViewport(() => true)
    const { api, container } = renderSlot({
      'GET /api/briefs': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Something broke.' } },
      }),
    })
    await waitFor(() => {
      expect(api.calls).toHaveLength(1)
    })
    expect(container.querySelector('[data-slot]')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('content a page passes to the slot is kept, and the mount is not used', () => {
    nearViewport(() => true)
    const { api } = renderSlot(
      { 'GET /api/briefs': briefs([makeItem()]) },
      SETTINGS,
      <p>The page&apos;s own line</p>,
    )
    expect(screen.getByText("The page's own line").closest('[data-slot]')).toHaveAttribute(
      'data-slot',
      'brief',
    )
    expect(api.calls).toEqual([])
  })
})

describe('Today', () => {
  beforeEach(startToday)

  test('keeps to its two requests on the first screen, then fills the slot when it is near', async () => {
    // Only the slot's marker is near the viewport: the history sections stay unloaded.
    nearViewport((target) => target.getAttribute('aria-hidden') === 'true')
    const { api } = renderToday(makeToday({ coach: makeCoach({ change: null }) }), {
      'GET /api/briefs': briefs([makeItem({ weekStart: '2026-03-16', seen: false })]),
    })
    const region = await screen.findByRole('region', { name: 'Weekly brief' })
    expect(region.closest('[data-slot]')).toHaveAttribute('data-slot', 'brief')
    expect(api.calls.map((call) => call.url).sort()).toEqual([
      '/api/briefs?limit=1',
      '/api/settings',
      '/api/today',
    ])
  })
})
