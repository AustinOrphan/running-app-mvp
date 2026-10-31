import { act, renderHook, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { isoDateInZone } from '../../shared/dates.ts'
import type { TodayView } from '../../shared/types.ts'
import { useServerToday } from '../../web/api/today.ts'
import { RecentWeeks } from '../../web/components/today/RecentWeeks.tsx'
import { useMediaQuery } from '../../web/components/useMediaQuery.ts'
import { makeWeekRow } from '../factories.ts'
import { makeItem } from './brief-fixtures.ts'
import { mockApi, renderWithProviders } from './helpers.tsx'
import {
  makeCoach,
  makeFuelPrompts,
  makeFuelSlot,
  makeHero,
  makeRace,
  makeSession,
  makeStrip,
  makeToday,
} from './today-fixtures.ts'
import { makeV2Plan, makeV2Week } from './plan-fixtures.ts'
import { renderToday, startToday } from './today-render.tsx'

// The order test stands one in for the disruption and watch slots: the banner is filled by the
// disruption epic (E5-8) and the wrist line reads the watch status (E1-8), so neither has its data
// in the Today payload that this test builds. Their own tests cover the real mounts; `fuel`,
// `brief` and `fuelPrompt` use the real mounts here.
vi.mock('../../web/components/today/slotMounts.tsx', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../web/components/today/slotMounts.tsx')>()
  const { SlotFrame } = await import('../../web/components/today/SlotFrame.tsx')
  return {
    ...original,
    SLOT_MOUNTS: {
      ...original.SLOT_MOUNTS,
      disruption: () => (
        <SlotFrame name="disruption">
          <p>Stand-in for the disruption banner</p>
        </SlotFrame>
      ),
      watch: () => (
        <SlotFrame name="watch">
          <p>Stand-in for the wrist line</p>
        </SlotFrame>
      ),
    },
  }
})

const WIDE = '(min-width: 900px)'

/** A `matchMedia` whose answer for the two-column query the test sets, and tells listeners of. */
function controlMedia(initial: boolean) {
  const original = window.matchMedia.bind(window)
  let wide = initial
  const listeners = new Set<() => void>()
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      get matches() {
        return query === WIDE && wide
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener)
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener)
      },
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
  return {
    set(next: boolean) {
      wide = next
      for (const listener of listeners) listener()
    },
    listeners: () => listeners.size,
    restore() {
      window.matchMedia = original
    },
  }
}

describe('useMediaQuery', () => {
  let media: ReturnType<typeof controlMedia>
  afterEach(() => {
    media.restore()
  })

  test('answers on the first render and follows the query as it changes', () => {
    media = controlMedia(false)
    const { result, unmount } = renderHook(() => useMediaQuery(WIDE))
    expect(result.current).toBe(false)
    expect(media.listeners()).toBe(1)

    act(() => {
      media.set(true)
    })
    expect(result.current).toBe(true)
    act(() => {
      media.set(false)
    })
    expect(result.current).toBe(false)

    unmount()
    expect(media.listeners()).toBe(0)
  })

  test('starts true when the query already matches, so no layout is painted and then swapped', () => {
    media = controlMedia(true)
    const seen: boolean[] = []
    renderHook(() => {
      const matches = useMediaQuery(WIDE)
      seen.push(matches)
      return matches
    })
    expect(seen.every(Boolean)).toBe(true)
  })

  test('reads false where the browser has no matchMedia', () => {
    media = controlMedia(true)
    const original = window.matchMedia.bind(window)
    // @ts-expect-error An old browser: the property is absent.
    window.matchMedia = undefined
    try {
      const { result } = renderHook(() => useMediaQuery(WIDE))
      expect(result.current).toBe(false)
    } finally {
      window.matchMedia = original
    }
  })
})

/** A long-run day with every slot that has data filled: fuel, the brief and the fuel prompt. */
function fullDay(): TodayView {
  const hero = makeHero({
    session: makeSession({ id: 'long1', kind: 'long', title: 'Long run', durationMin: 150 }),
  })
  return makeToday({
    sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
    coach: makeCoach({
      hero,
      weekStrip: makeStrip({ runMin: 60, targetRunMin: 300 }),
      race: makeRace(),
      health: { possibleDuplicates: 1, pastUnconfirmedWeeks: 0, lastWeekReady: false, notes: [] },
      slots: {
        disruption: null,
        fuel: makeFuelSlot(),
        watch: null,
        brief: makeItem(),
        fuelPrompt: makeFuelPrompts(),
        strength: null,
      },
    }),
  })
}

/** Whether `later` comes after `earlier` in document order. */
function follows(earlier: Element, later: Element): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('DashboardPage: the layout', () => {
  let media: ReturnType<typeof controlMedia>
  beforeEach(startToday)
  afterEach(() => {
    media.restore()
    vi.useRealTimers()
  })

  test('on a phone the sections follow one another in the order of spec 7.6, every slot filled', async () => {
    media = controlMedia(false)
    const { container } = renderToday(fullDay())
    const hero = await screen.findByRole('article', { name: 'Long run' })

    const slot = (name: string) => container.querySelector<HTMLElement>(`[data-slot="${name}"]`)
    const named = (name: string) => {
      const found = slot(name)
      if (found === null) throw new Error(`The ${name} slot is empty.`)
      return found
    }
    const order = [
      named('disruption'),
      screen.getByRole('region', { name: 'Readiness' }),
      hero,
      named('fuel'),
      named('watch'),
      screen.getByRole('region', { name: 'This week' }),
      named('brief'),
      named('fuelPrompt'),
      screen.getByRole('region', { name: 'Race' }),
      screen.getByRole('region', { name: 'Data health' }),
      screen.getByRole('region', { name: 'Disclaimer' }),
    ]
    for (const [index, element] of order.slice(1).entries()) {
      expect(follows(order[index]!, element), `${element.outerHTML.slice(0, 60)} comes late`).toBe(
        true,
      )
    }
    // The three slots inside the hero sit in it: the fuel line and the wrist line.
    expect(hero.contains(named('fuel'))).toBe(true)
    expect(hero.contains(named('watch'))).toBe(true)
    expect(screen.getByRole('radiogroup', { name: 'How do you feel today?' })).toBeInTheDocument()
  })

  test.each([
    ['one', false],
    ['two', true],
  ])(
    'a %s-column page keeps the hero in the first group and the week in the second',
    async (name, wide) => {
      media = controlMedia(wide)
      renderToday(fullDay())
      const hero = await screen.findByRole('article', { name: 'Long run' })
      const columns = hero.closest('[data-layout]')
      expect(columns).toHaveAttribute('data-layout', name)
      expect(columns?.children).toHaveLength(2)
      const [session, week] = Array.from(columns?.children ?? [])
      // The hero leads the page's first group, behind the readiness read; the strip leads the second.
      expect(session?.contains(hero)).toBe(true)
      expect(session?.contains(screen.getByRole('region', { name: 'Readiness' }))).toBe(true)
      expect(week?.contains(screen.getByRole('region', { name: 'This week' }))).toBe(true)
      expect(week?.contains(hero)).toBe(false)
      // The groups are in the DOM in one order at both widths: nothing is moved with `order`, so tab
      // order follows the picture.
      expect(follows(hero, screen.getByRole('region', { name: 'This week' }))).toBe(true)
    },
  )

  test('a window that grows past 900 px changes the layout without remounting the hero', async () => {
    media = controlMedia(false)
    renderToday(fullDay())
    const hero = await screen.findByRole('article', { name: 'Long run' })
    const columns = hero.closest('[data-layout]')
    expect(columns).toHaveAttribute('data-layout', 'one')

    act(() => {
      media.set(true)
    })
    expect(columns).toHaveAttribute('data-layout', 'two')
    // The same node, so an open sheet or a half-typed answer survives the resize.
    expect(screen.getByRole('article', { name: 'Long run' })).toBe(hero)
  })
})

describe('useServerToday', () => {
  const ZONE = 'America/Chicago'
  const originalZone = process.env['TZ']

  /** What the server answers for `GET /api/today`: the day in its own zone, at its own clock. */
  function serverToday(tz = ZONE): TodayView {
    return makeToday({ date: isoDateInZone(new Date(), tz), tz, coach: makeCoach() })
  }

  function Probe() {
    const { data } = useServerToday()
    return <p>{data === undefined ? 'Loading' : `Day ${data.date}`}</p>
  }

  /** Lets requests, their answers and the renders that follow settle, then moves the clock on. */
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  beforeEach(() => {
    // The device is in Kiritimati, 19 hours ahead of the server's Chicago: its midnight and the
    // server's are far apart, and at the start of each test the device's day is already the next.
    process.env['TZ'] = 'Pacific/Kiritimati'
    vi.useFakeTimers()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalZone === undefined) delete process.env['TZ']
    else process.env['TZ'] = originalZone
  })

  test("asks again at midnight in the server's zone, not the device's, and shows the new day", async () => {
    // 23:30 on 21 Oct in Chicago; 18:30 on 22 Oct on the device.
    vi.setSystemTime(new Date('2026-10-22T04:30:00Z'))
    const api = mockApi({ 'GET /api/today': () => serverToday() })
    renderWithProviders(<Probe />)
    await advance(0)
    expect(screen.getByText('Day 2026-10-21')).toBeInTheDocument()
    expect(api.calls).toHaveLength(1)

    // 04:59:30 UTC: half a minute before the server's midnight. A clock that went by the device's
    // day would have asked at once, and the device's own midnight is hours away (10:00 UTC).
    await advance(29 * 60_000 + 30_000)
    expect(api.calls).toHaveLength(1)

    await advance(31_000)
    expect(api.calls).toHaveLength(2)
    expect(screen.getByText('Day 2026-10-22')).toBeInTheDocument()

    // The device's midnight passes (10:00 UTC) and asks for nothing: the server's day did not change.
    await advance(5 * 60 * 60_000)
    expect(api.calls).toHaveLength(2)

    // The next midnight in Chicago, 05:00 UTC on 23 Oct, brings the next day.
    await advance(19 * 60 * 60_000 + 30_000)
    expect(api.calls).toHaveLength(3)
    expect(screen.getByText('Day 2026-10-23')).toBeInTheDocument()
  })

  test('waits for the end of the day set by a change of the clocks, not for 24 hours', async () => {
    // In Chicago the clocks go back at 02:00 on 1 Nov 2026, so that day has 25 hours; its end is
    // 06:00 UTC on 2 Nov. At 04:30 UTC on 1 Nov it is 23:30 CDT on 31 Oct.
    vi.setSystemTime(new Date('2026-11-01T04:30:00Z'))
    const api = mockApi({ 'GET /api/today': () => serverToday() })
    renderWithProviders(<Probe />)
    await advance(0)
    expect(screen.getByText('Day 2026-10-31')).toBeInTheDocument()

    // 05:00 UTC is midnight CDT: the day changes there.
    await advance(30 * 60_000 + 1000)
    expect(api.calls).toHaveLength(2)
    expect(screen.getByText('Day 2026-11-01')).toBeInTheDocument()

    // The next change is 06:00 UTC on 2 Nov: 25 hours later, not 24.
    await advance(24 * 60 * 60_000)
    expect(api.calls).toHaveLength(2)
    await advance(60 * 60_000 + 1000)
    expect(api.calls).toHaveLength(3)
    expect(screen.getByText('Day 2026-11-02')).toBeInTheDocument()
  })

  test('a server that still answers with the old day is asked again a minute later, not at once', async () => {
    vi.setSystemTime(new Date('2026-10-22T04:59:50Z'))
    // Its clock is behind: it keeps saying 21 Oct for a few minutes after midnight.
    const stale = makeToday({ date: '2026-10-21', tz: ZONE, coach: makeCoach() })
    const api = mockApi({ 'GET /api/today': () => stale })
    renderWithProviders(<Probe />)
    await advance(0)
    expect(api.calls).toHaveLength(1)

    await advance(11_000)
    expect(api.calls).toHaveLength(2)
    await advance(58_000)
    expect(api.calls).toHaveLength(2)
    await advance(2_000)
    expect(api.calls).toHaveLength(3)
  })

  test("a payload dated after the device's own day sets no timer and asks for nothing more", async () => {
    // The device's clock runs a day behind the server's: it is 23:30 on 21 Oct in Chicago, and
    // the server answers with 22 Oct. Asking again cannot end that, so there is no loop.
    vi.setSystemTime(new Date('2026-10-22T04:30:00Z'))
    const api = mockApi({
      'GET /api/today': () => makeToday({ date: '2026-10-22', tz: ZONE, coach: makeCoach() }),
    })
    renderWithProviders(<Probe />)
    await advance(0)
    expect(screen.getByText('Day 2026-10-22')).toBeInTheDocument()
    expect(api.calls).toHaveLength(1)

    await advance(3 * 24 * 60 * 60_000)
    expect(api.calls).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('an unknown zone leaves the page as it is and sets no timer', async () => {
    vi.setSystemTime(new Date('2026-10-22T04:30:00Z'))
    const api = mockApi({
      'GET /api/today': () =>
        makeToday({ date: '2026-10-22', tz: 'Mars/Olympus', coach: makeCoach() }),
    })
    renderWithProviders(<Probe />)
    await advance(0)
    expect(screen.getByText('Day 2026-10-22')).toBeInTheDocument()
    await advance(3 * 24 * 60 * 60_000)
    expect(api.calls).toHaveLength(1)
  })

  test('a day ahead is not refreshed: it is not today', async () => {
    vi.setSystemTime(new Date('2026-10-22T04:30:00Z'))
    const api = mockApi({
      'GET /api/today': () =>
        makeToday({ date: '2026-10-23', tz: ZONE, coach: makeCoach({ preview: true }) }),
    })
    renderWithProviders(<Probe />)
    await advance(0)
    await advance(2 * 24 * 60 * 60_000)
    expect(api.calls).toHaveLength(1)
  })

  test('stops asking once the page is gone', async () => {
    vi.setSystemTime(new Date('2026-10-22T04:30:00Z'))
    const api = mockApi({ 'GET /api/today': () => serverToday() })
    const { unmount } = renderWithProviders(<Probe />)
    await advance(0)
    unmount()
    await advance(2 * 24 * 60 * 60_000)
    expect(api.calls).toHaveLength(1)
  })
})

describe('RecentWeeks: the chart and its data', () => {
  beforeEach(startToday)
  afterEach(() => {
    vi.useRealTimers()
  })

  test('fetches nothing until it is near the viewport, then once, and the chart arrives as its own chunk', async () => {
    // An observer the test fires by hand, as a scroll would.
    const fire: Array<() => void> = []
    class Observer {
      private target: Element | null = null
      constructor(private readonly callback: IntersectionObserverCallback) {
        fire.push(() => {
          if (this.target === null) return
          this.callback(
            [{ isIntersecting: true, target: this.target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          )
        })
      }
      observe(target: Element): void {
        this.target = target
      }
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }
    vi.stubGlobal('IntersectionObserver', Observer)

    const week = (weekStart: string, runMin: number) => makeWeekRow({ weekStart, runMin })
    const { api } = renderToday(fullDay(), {
      'GET /api/activities': () => ({
        items: [],
        total: 0,
        limit: 100,
        offset: 0,
        nextOffset: null,
      }),
      'GET /api/weeks': () => [week('2026-03-09', 240), week('2026-03-16', 90)],
      'GET /api/plan': () => null,
    })
    await screen.findByRole('article', { name: 'Long run' })
    const requested = () => api.calls.map((call) => call.url.split('?')[0]).sort()
    expect(requested()).toEqual(['/api/settings', '/api/today'])
    expect(screen.queryByRole('img', { name: /Run hours per week/ })).not.toBeInTheDocument()

    act(() => {
      for (const reveal of fire) reveal()
    })
    expect(
      await screen.findByRole(
        'img',
        { name: 'Run hours per week, last 12 weeks' },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument()
    const weeks = api.calls.filter((call) => call.url.startsWith('/api/weeks'))
    expect(weeks).toHaveLength(1)
    // Twelve weeks ending with this one (Monday 16 Mar 2026), from the server's date.
    expect(weeks[0]?.url).toBe('/api/weeks?from=2025-12-29&to=2026-03-16')
  })

  test('sets a week run past its plan against the planned figure, not the raised target', async () => {
    const overshot = makeV2Week(0, {
      weekStart: '2026-03-16',
      targetRunMin: 144,
      plannedRunMin: 79,
      overshoot: true,
    })
    mockApi({
      'GET /api/weeks': () => [
        makeWeekRow({ weekStart: '2026-03-09', runMin: 240 }),
        makeWeekRow({ weekStart: '2026-03-16', runMin: 144 }),
      ],
      'GET /api/plan': () =>
        makeV2Plan({
          weeks: [makeV2Week(0, { weekStart: '2026-03-09', targetRunMin: 300 }), overshot],
        }),
    })
    renderWithProviders(<RecentWeeks today="2026-03-18" />)
    const table = await screen.findByRole('table', {}, { timeout: 5000 })
    const planned = (weekOf: string) =>
      within(within(table).getByRole('row', { name: new RegExp(weekOf) })).getAllByRole('cell')[1]
    // 79 minutes planned is 1.3 hours; the stored target of 144 minutes would read 2.4.
    expect(planned('16 Mar')).toHaveTextContent('1.3')
    expect(planned('9 Mar')).toHaveTextContent('5.0')
  })

  test('takes the chart through the lazy wrapper, so the page does not carry it', () => {
    const source = readFileSync(join('web', 'components', 'today', 'RecentWeeks.tsx'), 'utf8')
    expect(source).not.toMatch(/^import .*charts\/WeeklyHoursChart\.tsx/m)
    expect(source).toMatch(/from '\.\.\/charts\/lazyCharts\.tsx'/)
    const lazy = readFileSync(join('web', 'components', 'charts', 'lazyCharts.tsx'), 'utf8')
    expect(lazy).toMatch(/import\('\.\/WeeklyHoursChart\.tsx'\)/)
  })
})
