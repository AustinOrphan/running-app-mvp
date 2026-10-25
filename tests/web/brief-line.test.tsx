import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  BriefListItem,
  DistanceEstimate,
  TodayView,
  UserSettings,
} from '../../shared/types.ts'
import { keys } from '../../web/api/client.ts'
import { BriefLine } from '../../web/components/BriefLine.tsx'
import { SLOT_BUDGETS_PX } from '../../web/components/today/slots.ts'
import { TodaySlot } from '../../web/components/today/TodaySlot.tsx'
import { makeItem } from './brief-fixtures.ts'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'
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

  describe('the distance estimate', () => {
    const next = (distanceEstimate: DistanceEstimate | null) => ({
      date: '2027-01-16',
      kind: 'long' as const,
      distanceEstimate,
    })

    test('follows the kind of the next key session, in the runner’s units', () => {
      const { container } = line({ nextKey: next({ distanceM: 16_100, basis: 'easy' }) })
      expect(screen.getByRole('region', { name: 'Weekly brief' })).toHaveTextContent(
        'Since last week: 3 changes, next key session Saturday (long run, about 16 km).',
      )
      expectCleanCopy(container)
    })

    test('reads in miles for a runner of miles', () => {
      renderWithProviders(
        <BriefLine
          item={makeItem({ nextKey: next({ distanceM: 16_100, basis: 'easy' }) })}
          units="mi"
        />,
      )
      expect(screen.getByRole('region', { name: 'Weekly brief' })).toHaveTextContent(
        'next key session Saturday (long run, about 10 mi).',
      )
    })

    test('is left out when there is none, and when an older answer has no field', () => {
      line({ nextKey: next(null) })
      expect(screen.getByRole('region', { name: 'Weekly brief' })).toHaveTextContent(
        'next key session Saturday (long run).',
      )
      const stale = { date: '2027-01-16', kind: 'long' } as unknown as BriefListItem['nextKey']
      line({ nextKey: stale })
      for (const region of screen.getAllByRole('region', { name: 'Weekly brief' })) {
        expect(region).not.toHaveTextContent('about')
      }
    })
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

/** `navigator.onLine` as the test needs it. */
function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

beforeEach(() => {
  setOnline(true)
})

/** A Today payload whose `brief` slot holds `brief`. */
const todayWith = (brief: BriefListItem | null) =>
  makeToday({ coach: makeCoach({ slots: { ...makeCoach().slots, brief } }) })

/**
 * The `brief` slot of Today with the payload and the settings already in the cache, as the page
 * leaves them. No route is mocked: a request of any kind fails the test.
 */
function renderSlot(
  brief: BriefListItem | null,
  settings: UserSettings | null = SETTINGS,
  children?: ReactNode,
  /** Fields of the payload that differ from a live answer (`servedFromCache`). */
  payload: Partial<TodayView> = {},
) {
  const api = mockApi({})
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  queryClient.setQueryData([keys.today], { ...todayWith(brief), ...payload })
  if (settings !== null) queryClient.setQueryData([keys.settings], settings)
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TodaySlot name="brief">{children}</TodaySlot>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { api, queryClient, ...view }
}

describe('the brief slot', () => {
  test('is 52 px, the budget the line is built to', () => {
    expect(SLOT_BUDGETS_PX.brief).toBe(52)
  })

  test('fills the slot from the payload within its budget, and asks for nothing', () => {
    const { api, container } = renderSlot(makeItem())
    const region = screen.getByRole('region', { name: 'Weekly brief' })
    expect(api.calls).toEqual([])
    const slot = region.closest('[data-slot]')
    expect(slot).toHaveAttribute('data-slot', 'brief')
    expect(slot).toHaveAttribute('data-budget-px', '52')
    expect(within(region).getByText('New')).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('a week with no brief yet has no line, and no slot frame', () => {
    const { api, container } = renderSlot(null)
    expect(api.calls).toEqual([])
    expect(container.querySelector('[data-slot]')).toBeNull()
  })

  test('without the settings in the cache it does nothing', () => {
    const { api, container } = renderSlot(makeItem(), null)
    expect(api.calls).toEqual([])
    expect(container).toBeEmptyDOMElement()
  })

  test('shows the brief of the payload, whatever week the device clock is in', () => {
    // The server decides which week is current; the payload holds that week's brief or none.
    vi.setSystemTime(new Date('2027-06-02T12:00:00'))
    renderSlot(makeItem({ weekStart: '2027-01-11' }))
    expect(screen.getByRole('region', { name: 'Weekly brief' })).toBeInTheDocument()
  })

  test('follows the payload when the server asks again: the new week brings its brief', async () => {
    const { queryClient } = renderSlot(makeItem({ weekStart: '2027-01-04', changeCount: 3 }))
    expect(screen.getByRole('region', { name: 'Weekly brief' })).toHaveTextContent(
      'Since last week: 3 changes',
    )

    // The server's Monday: the answer carries the new week, with no brief written yet ...
    act(() => {
      queryClient.setQueryData([keys.today], todayWith(null))
    })
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Weekly brief' })).not.toBeInTheDocument()
    })

    // ... and then the brief the weekly update wrote.
    act(() => {
      queryClient.setQueryData(
        [keys.today],
        todayWith(makeItem({ weekStart: '2027-01-11', changeCount: 1 })),
      )
    })
    expect(await screen.findByRole('region', { name: 'Weekly brief' })).toHaveTextContent(
      'Since last week: 1 change',
    )
  })

  test('offline it draws nothing: the brief page is not cached', () => {
    setOnline(false)
    const { container } = renderSlot(makeItem())
    expect(container.querySelector('[data-slot]')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Weekly brief' })).not.toBeInTheDocument()
  })

  test("a copy the worker served draws nothing either, with the browser online and the week's brief maybe gone", () => {
    const { container } = renderSlot(makeItem(), SETTINGS, undefined, { servedFromCache: true })
    expect(container.querySelector('[data-slot]')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Weekly brief' })).not.toBeInTheDocument()
  })

  test("the server's own answer, with no mark, draws it", () => {
    renderSlot(makeItem(), SETTINGS)
    expect(screen.getByRole('region', { name: 'Weekly brief' })).toBeInTheDocument()
  })

  test('content a page passes to the slot is kept, and the mount is not used', () => {
    renderSlot(makeItem(), SETTINGS, <p>The page&apos;s own line</p>)
    expect(screen.getByText("The page's own line").closest('[data-slot]')).toHaveAttribute(
      'data-slot',
      'brief',
    )
    expect(screen.queryByRole('region', { name: 'Weekly brief' })).not.toBeInTheDocument()
  })
})

describe('Today', () => {
  beforeEach(startToday)

  test('keeps to its two requests, with the brief line in the first answer', async () => {
    const { api } = renderToday(todayWith(makeItem({ weekStart: '2026-03-16', seen: false })))
    const region = await screen.findByRole('region', { name: 'Weekly brief' })
    expect(region.closest('[data-slot]')).toHaveAttribute('data-slot', 'brief')
    expect(api.calls.map((call) => call.url).sort()).toEqual(['/api/settings', '/api/today'])
  })

  test('a week with no brief has no line, and still only the two requests', async () => {
    const { api } = renderToday(todayWith(null))
    await screen.findByRole('region', { name: 'Readiness' })
    expect(screen.queryByRole('region', { name: 'Weekly brief' })).not.toBeInTheDocument()
    expect(api.calls.map((call) => call.url).sort()).toEqual(['/api/settings', '/api/today'])
  })
})
