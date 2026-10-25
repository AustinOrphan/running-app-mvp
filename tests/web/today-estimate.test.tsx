// The distance estimate on Today (STATUS follow-up 17): the hero, the next session and the week
// strip word the figure the server sent, in the runner's units, and work out nothing of their own.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PlanSessionView, TodayView, WeekStrip } from '../../shared/types.ts'
import { activityPage, expectCleanCopy } from './helpers.tsx'
import { makeCoach, makeHero, makeSession, makeStrip, makeToday } from './today-fixtures.ts'
import { renderToday, startToday } from './today-render.tsx'
import { sheetRoutes } from './wrist-fixtures.ts'

vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Why" /> : null,
}))

beforeEach(startToday)

afterEach(() => {
  vi.useRealTimers()
})

function dayOf(session: PlanSessionView, over: Parameters<typeof makeCoach>[0] = {}) {
  const hero = makeHero({ session })
  return makeToday({
    sessions: [{ session, advice: hero.advice, reasons: hero.reasons }],
    coach: makeCoach({ hero, ...over }),
  })
}

const EASY_9 = { distanceM: 14_480, basis: 'easy' } as const
const PACED_7 = { distanceM: 10_900, basis: 'pace' } as const

describe('Today: the hero', () => {
  test('words the estimate beside the minutes, naming the easy pace', async () => {
    const { container } = renderToday(dayOf(makeSession({ distanceEstimate: EASY_9 })))
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('45')).toBeInTheDocument()
    expect(within(card).getByText('about 9 mi at your easy pace')).toBeInTheDocument()
    // One distance on the hero: the plan's own 5.00 mi gives way to the estimate.
    expect(within(card).queryByText('5.00 mi')).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('is the figure alone for a session with a pace target of its own', async () => {
    renderToday(
      dayOf(makeSession({ kind: 'threshold', title: 'Threshold', distanceEstimate: PACED_7 })),
    )
    const card = await screen.findByRole('article', { name: 'Threshold' })
    expect(within(card).getByText('about 7 mi')).toBeInTheDocument()
    expect(within(card).queryByText(/easy pace/)).not.toBeInTheDocument()
  })

  test('follows the runner’s units: kilometres', async () => {
    renderToday(dayOf(makeSession({ distanceEstimate: EASY_9 })), {}, 'km')
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('about 14 km at your easy pace')).toBeInTheDocument()
  })

  test('keeps the plan’s own distance when the server sent no estimate', async () => {
    renderToday(dayOf(makeSession({ distanceEstimate: null })))
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('5.00 mi')).toBeInTheDocument()
    expect(within(card).queryByText(/about [0-9.]+ (mi|km)/)).not.toBeInTheDocument()
  })

  test('shows no distance for an eased session, which is run by time', async () => {
    const planned = makeSession({
      kind: 'intervals',
      title: 'Intervals',
      distanceEstimate: PACED_7,
    })
    const eased = makeSession({
      kind: 'easy',
      title: 'Easy run',
      distanceM: null,
      distanceEstimate: null,
      rules: ['J3'],
    })
    renderToday(
      makeToday({
        sessions: [{ session: planned, advice: 'downgrade-easy', reasons: [] }],
        coach: makeCoach({
          hero: makeHero({ session: planned, advice: 'downgrade-easy', eased }),
        }),
      }),
    )
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).queryByText(/about [0-9.]+ (mi|km)/)).not.toBeInTheDocument()
    expect(within(card).queryByText(/[0-9.]+ (mi|km)\b/)).not.toBeInTheDocument()
  })

  test('reads an answer the phone kept from before the estimate existed as no estimate', async () => {
    const stale = makeSession() as Partial<PlanSessionView>
    delete stale.distanceEstimate
    renderToday(dayOf(stale as PlanSessionView))
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('5.00 mi')).toBeInTheDocument()
  })
})

describe('Today: the next session', () => {
  test('adds the estimate after the minutes when the day has none planned', async () => {
    renderToday(
      makeToday({
        coach: makeCoach({
          next: makeSession({
            id: 's2',
            date: '2026-03-20',
            title: 'Long run',
            durationMin: 90,
            distanceEstimate: EASY_9,
          }),
          weekStrip: makeStrip({ targetRunMin: 300 }),
        }),
      }),
    )
    const none = await screen.findByRole('region', { name: "Today's session" })
    expect(
      within(none).getByText('Next: Fri 20 Mar, Long run, 90 min, about 9 mi.'),
    ).toBeInTheDocument()
  })

  test('is the same line as before when there is no estimate', async () => {
    renderToday(
      makeToday({
        coach: makeCoach({
          next: makeSession({ id: 's2', date: '2026-03-20', title: 'Long run', durationMin: 90 }),
        }),
      }),
    )
    const none = await screen.findByRole('region', { name: "Today's session" })
    expect(within(none).getByText('Next: Fri 20 Mar, Long run, 90 min.')).toBeInTheDocument()
  })

  test('is named under a rest day with the estimate too', async () => {
    const planned = makeSession({ kind: 'threshold', title: 'Threshold', durationMin: 50 })
    renderToday(
      makeToday({
        sessions: [{ session: planned, advice: 'rest', reasons: [] }],
        coach: makeCoach({
          hero: makeHero({ session: planned, advice: 'rest', target: null }),
          next: makeSession({
            id: 's2',
            date: '2026-03-19',
            title: 'Long run',
            durationMin: 90,
            distanceEstimate: EASY_9,
          }),
        }),
      }),
    )
    const card = await screen.findByRole('article', { name: 'Rest day.' })
    expect(
      within(card).getByText('Next: Thu 19 Mar, Long run, 90 min, about 9 mi.'),
    ).toBeInTheDocument()
  })
})

describe('Today: the week strip', () => {
  function withWeek(over: Partial<WeekStrip>): TodayView {
    return makeToday({
      coach: makeCoach({ weekStrip: makeStrip({ targetRunMin: 300, ...over }) }),
    })
  }

  test('says what the week’s planned runs come to, as an estimate', async () => {
    renderToday(withWeek({ distanceEstimateM: 31_000 }))
    const strip = await screen.findByRole('region', { name: 'This week' })
    expect(
      within(strip).getByText("The week's planned runs come to about 19 mi."),
    ).toBeInTheDocument()
    // The meter stays in minutes.
    expect(within(strip).getByRole('meter', { name: 'Run time this week' })).toBeInTheDocument()
  })

  test('words it in kilometres for a runner of kilometres', async () => {
    renderToday(withWeek({ distanceEstimateM: 31_000 }), {}, 'km')
    const strip = await screen.findByRole('region', { name: 'This week' })
    expect(
      within(strip).getByText("The week's planned runs come to about 31 km."),
    ).toBeInTheDocument()
  })

  test('says nothing when the server had no figure for the week', async () => {
    renderToday(withWeek({ distanceEstimateM: null }))
    const strip = await screen.findByRole('region', { name: 'This week' })
    expect(within(strip).queryByText(/planned runs come to/)).not.toBeInTheDocument()
  })

  test('reads an answer the phone kept from before the estimate existed as no figure', async () => {
    const stale = makeStrip({ targetRunMin: 300 }) as Partial<WeekStrip>
    delete stale.distanceEstimateM
    renderToday(makeToday({ coach: makeCoach({ weekStrip: stale as WeekStrip }) }))
    const strip = await screen.findByRole('region', { name: 'This week' })
    expect(within(strip).queryByText(/planned runs come to/)).not.toBeInTheDocument()
  })

  test('a tap on a day opens its sheet with the estimate the strip carried', async () => {
    const user = userEvent.setup()
    const session = makeSession({
      id: 's-wed',
      date: '2026-03-18',
      distanceEstimate: EASY_9,
    })
    const today = makeToday({
      coach: makeCoach({
        weekStrip: makeStrip(
          { targetRunMin: 300, distanceEstimateM: 14_480 },
          { '2026-03-18': { mark: 'planned', sessions: [session] } },
        ),
      }),
    })
    renderToday(today, {
      'GET /api/activities': () => activityPage([]),
      ...sheetRoutes([session]),
    })
    await user.click(await screen.findByRole('button', { name: 'Wednesday 18 Mar, Planned' }))
    const sheet = await screen.findByRole('dialog', { name: 'Easy run' })
    expect(await within(sheet).findByText('about 9 mi at your easy pace')).toBeInTheDocument()
  })
})
