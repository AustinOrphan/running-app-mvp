import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ResolvedTargets } from '../../shared/engine/types.ts'
import type { TodayView } from '../../shared/types.ts'
import { SessionTargets } from '../../web/components/today/SessionTargets.tsx'
import { TodaySkeleton } from '../../web/components/today/TodaySkeleton.tsx'
import { activityPage, expectCleanCopy } from './helpers.tsx'
import {
  makeCoach,
  makeHeat,
  makeHero,
  makeSession,
  makeStrip,
  makeTarget,
  makeToday,
} from './today-fixtures.ts'
import { renderToday, startToday } from './today-render.tsx'
import { sheetRoutes } from './wrist-fixtures.ts'

// Stands in for the real drawer so the wiring is visible: which rules it was opened with.
vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, open }: { rules: string[]; open: boolean }) =>
    open ? <div role="dialog" aria-label="Why">{`rules: ${rules.join(', ')}`}</div> : null,
}))

beforeEach(startToday)

afterEach(() => {
  vi.useRealTimers()
})

function dayOf(over: Parameters<typeof makeHero>[0] = {}, view: Partial<TodayView> = {}) {
  const hero = makeHero(over)
  return makeToday({
    sessions: [{ session: hero.session, advice: hero.advice, reasons: hero.reasons }],
    coach: makeCoach({ hero, ...view.coach }),
    ...view,
  })
}

describe('Today: the first screen', () => {
  test('requests only the payload and the settings', async () => {
    const { api } = renderToday(dayOf())
    await screen.findByRole('article', { name: 'Easy run' })
    expect([...new Set(api.calls.map((call) => call.url))].sort()).toEqual([
      '/api/settings',
      '/api/today',
    ])
  })

  test('shows the page header and the date while the payload loads, then the hero', async () => {
    renderToday(dayOf())
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument()
    await screen.findByRole('article', { name: 'Easy run' })
    expect(screen.getByText('Wed 18 Mar')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Log activity' })).toHaveAttribute(
      'href',
      '/activities?new=1',
    )
  })

  test('a failed payload says so and offers nothing else', async () => {
    renderToday(dayOf(), {
      'GET /api/today': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Server error' } },
      }),
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Today did not load. Reload the page to try again.',
    )
  })

  test('a failed refetch keeps the last payload on the page', async () => {
    let answers = 0
    const { api } = renderToday(dayOf(), {
      'GET /api/today': () => {
        answers += 1
        return answers === 1
          ? dayOf()
          : { status: 500, body: { error: { code: 'internal', message: 'Server error' } } }
      },
    })
    const hero = await screen.findByRole('article', { name: 'Easy run' })

    // The window comes back to the front and the payload is read again; the connection is down.
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => {
      expect(api.calls.filter((call) => call.url === '/api/today')).toHaveLength(2)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    // The hero is the same node (an open sheet or a half-typed answer stays), with no alert.
    expect(screen.getByRole('article', { name: 'Easy run' })).toBe(hero)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('the skeleton mirrors the first screen and waits 300 ms before it shows', async () => {
    render(<TodaySkeleton />)
    expect(screen.queryByRole('group', { name: 'Loading' })).not.toBeInTheDocument()
    expect(await screen.findByRole('group', { name: 'Loading' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })
})

describe('Today: the hero variants', () => {
  test('as planned: title, duration, targets, Done, Explain and Not today in that order', async () => {
    renderToday(dayOf())
    const card = await screen.findByRole('article', { name: 'Easy run' })
    const actions = [
      within(card).getByRole('button', { name: 'Done' }),
      within(card).getByRole('button', { name: 'Explain' }),
      within(card).getByRole('button', { name: 'Not today' }),
    ]
    expect(actions[0]!.compareDocumentPosition(actions[1]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(actions[1]!.compareDocumentPosition(actions[2]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  test('eased: the easy run is the hero, the planned session sits above it, and J3 is behind Explain', async () => {
    const user = userEvent.setup()
    const planned = makeSession({
      kind: 'intervals',
      title: 'Intervals',
      durationMin: 50,
      rules: ['c-1'],
    })
    const eased = makeSession({
      kind: 'easy',
      title: 'Easy run',
      durationMin: 50,
      distanceM: null,
      rules: ['c-1', 'J3'],
    })
    const day = makeToday({
      sessions: [{ session: planned, advice: 'downgrade-easy', reasons: ['Pain was reported.'] }],
      coach: makeCoach({
        verdict: { code: 'easy', template: 'today.verdict.easy', slots: {} },
        hero: makeHero({
          session: planned,
          advice: 'downgrade-easy',
          reasons: ['Pain was reported: keep to easy effort today.'],
          eased,
        }),
      }),
    })
    const { container } = renderToday(day)
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('Planned: Intervals, 50 min')).toBeInTheDocument()
    expect(within(card).getByText('50')).toBeInTheDocument()
    expect(within(card).queryByText(/ mi$/)).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Readiness' })).getByRole('status'),
    ).toHaveTextContent('An easy run is the better choice today.')
    await user.click(within(card).getByRole('button', { name: 'Explain' }))
    expect(await screen.findByRole('dialog', { name: 'Why' })).toHaveTextContent('rules: c-1, J3')
    await user.click(within(card).getByText('What to know today'))
    expect(
      within(card).getByText('Pain was reported: keep to easy effort today.'),
    ).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('rest advice: the hero says rest, keeps the planned session and offers no Done', async () => {
    const planned = makeSession({ kind: 'threshold', title: 'Threshold', durationMin: 50 })
    const day = makeToday({
      sessions: [{ session: planned, advice: 'rest', reasons: [] }],
      coach: makeCoach({
        verdict: { code: 'rest', template: 'today.verdict.rest', slots: {} },
        hero: makeHero({
          session: planned,
          advice: 'rest',
          reasons: ['Illness was reported: rest until a symptom-free day has passed.'],
          target: null,
        }),
        next: makeSession({ id: 's2', date: '2026-03-19', title: 'Long run', durationMin: 90 }),
      }),
    })
    const { container } = renderToday(day)
    const card = await screen.findByRole('article', { name: 'Rest day.' })
    expect(within(card).getByText('Planned: Threshold, 50 min. Not today.')).toBeInTheDocument()
    expect(within(card).queryByText('Heart rate')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Not today' })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Explain' })).toBeInTheDocument()
    expect(within(card).getByText('Next: Thu 19 Mar, Long run, 90 min.')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Readiness' })).getByRole('status'),
    ).toHaveTextContent('A rest day is the better choice today.')
    expectCleanCopy(container)
  })

  test('a planned rest day reads "Rest day." with nothing to explain', async () => {
    const rest = makeSession({
      kind: 'rest',
      title: 'Rest',
      durationMin: 0,
      distanceM: null,
      gainM: null,
      rules: [],
    })
    renderToday(
      makeToday({ coach: makeCoach({ hero: makeHero({ session: rest, target: null }) }) }),
    )
    const card = await screen.findByRole('article', { name: 'Rest day.' })
    expect(within(card).queryByRole('button', { name: 'Explain' })).not.toBeInTheDocument()
    expect(within(card).queryByText(/^Planned:/)).not.toBeInTheDocument()
  })

  test('a day with nothing planned says so and names the next session', async () => {
    renderToday(
      makeToday({
        coach: makeCoach({
          next: makeSession({ id: 's2', date: '2026-03-20', title: 'Long run', durationMin: 90 }),
          weekStrip: makeStrip({ targetRunMin: 300 }),
        }),
      }),
    )
    const none = await screen.findByRole('region', { name: "Today's session" })
    expect(within(none).getByText('Nothing is planned today.')).toBeInTheDocument()
    expect(within(none).getByText(/^Next: Fri 20 Mar, Long run, /)).toBeInTheDocument()
  })

  test("the day's other sessions are named under the actions", async () => {
    renderToday(
      dayOf({
        others: [makeSession({ id: 's3', kind: 'strength', title: 'Strength', durationMin: 30 })],
      }),
    )
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('Also today: Strength (30 min).')).toBeInTheDocument()
  })

  test('an eased session reads the same on the hero chip and in its sheet', async () => {
    const user = userEvent.setup()
    const eased = makeSession({ status: 'downgraded' })
    const hero = makeHero({ session: eased })
    renderToday(
      makeToday({
        sessions: [{ session: eased, advice: hero.advice, reasons: hero.reasons }],
        coach: makeCoach({
          hero,
          weekStrip: makeStrip({}, { '2026-03-18': { mark: 'planned', sessions: [eased] } }),
        }),
      }),
      { 'GET /api/activities': () => activityPage([]), ...sheetRoutes([eased]) },
    )
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('Eased')).toBeInTheDocument()
    expect(within(card).queryByText('Adjusted')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Wednesday 18 Mar, Planned' }))
    const sheet = await screen.findByRole('dialog', { name: 'Easy run' })
    expect(within(sheet).getByText('Eased')).toBeInTheDocument()
  })

  test('Not today opens the sheet that moves or skips the session', async () => {
    const user = userEvent.setup()
    renderToday(dayOf())
    const card = await screen.findByRole('article', { name: 'Easy run' })
    await user.click(within(card).getByRole('button', { name: 'Not today' }))
    const sheet = await screen.findByRole('dialog', { name: 'Not today' })
    expect(within(sheet).getByLabelText('Move to')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Skip session' })).toBeInTheDocument()
    expect(within(sheet).getByText('A skipped session is not made up later.')).toBeInTheDocument()
  })
})

describe('Today: the targets', () => {
  function targets(over: Partial<ResolvedTargets>): ResolvedTargets {
    return makeTarget(over)
  }
  function rows(t: ResolvedTargets, units: 'km' | 'mi' = 'mi') {
    render(<SessionTargets targets={t} units={units} />)
    return screen
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextElementSibling?.textContent])
  }

  test('lead with the heart-rate ceiling, then the pace as a guide, then effort', () => {
    expect(rows(targets({}))).toEqual([
      ['Heart rate', 'under 142 bpm'],
      ['Pace', 'about 9:15 to 10:28 /mi'],
      ['Effort', '3 to 4 out of 10'],
    ])
  })

  test('lead with a heart-rate band', () => {
    expect(rows(targets({ mode: 'hr-band', hrCeiling: null, hrRange: [149, 165] }))).toEqual([
      ['Heart rate', '149 to 165 bpm'],
      ['Pace', 'about 9:15 to 10:28 /mi'],
      ['Effort', '3 to 4 out of 10'],
    ])
  })

  test('lead with the work pace, then effort, then heart rate', () => {
    expect(rows(targets({ mode: 'pace', hrCeiling: null, hrRange: [149, 165] }))).toEqual([
      ['Pace', '9:15 to 10:28 /mi'],
      ['Effort', '3 to 4 out of 10'],
      ['Heart rate', '149 to 165 bpm'],
    ])
  })

  test('lead with effort, then heart rate, then pace', () => {
    expect(rows(targets({ mode: 'effort' }))).toEqual([
      ['Effort', '3 to 4 out of 10'],
      ['Heart rate', 'under 142 bpm'],
      ['Pace', 'about 9:15 to 10:28 /mi'],
    ])
  })

  test('read in kilometres for a runner who chose them', () => {
    expect(rows(targets({}), 'km')[1]).toEqual(['Pace', 'about 5:45 to 6:30 /km'])
  })

  test('a one-step effort range reads as one number', () => {
    expect(rows(targets({ rpe: [3, 3] }))[2]).toEqual(['Effort', '3 out of 10'])
  })

  test('on a hot day effort leads and each figure says how to use it', () => {
    render(<SessionTargets targets={targets({ mode: 'effort', hot: true })} units="mi" />)
    const lead = screen.getAllByRole('term')[0]!
    expect(lead).toHaveTextContent('Effort')
    expect(screen.getByText('Go by this today.')).toBeInTheDocument()
    expect(screen.getByText('It runs high in heat.')).toBeInTheDocument()
  })

  test('no figure, no row', () => {
    const { container } = render(
      <SessionTargets
        targets={targets({ hrCeiling: null, hrRange: null, paceSecPerKm: null, mode: 'effort' })}
        units="mi"
      />,
    )
    expect(screen.getAllByRole('term')).toHaveLength(1)
    expectCleanCopy(container)
  })
})

describe('Today: the cooler start and the notes', () => {
  test('an air-temperature day names the cooler hour only', async () => {
    renderToday(
      dayOf(
        {},
        {
          heat: makeHeat({ coolerHour: '06:00', coolerValue: 15.6, index: 'air-temperature' }),
        },
      ),
    )
    expect(
      await screen.findByText('Cooler start: 06:00. Air temperature about 16 °C then.'),
    ).toBeInTheDocument()
  })

  test('a rest day shows no cooler start', async () => {
    renderToday(
      dayOf(
        { advice: 'rest', target: null },
        { heat: makeHeat({ coolerHour: '06:00', coolerValue: 17, index: 'wbgt', wbgtC: 25 }) },
      ),
    )
    await screen.findByRole('article', { name: 'Rest day.' })
    expect(screen.queryByText(/Cooler start/)).not.toBeInTheDocument()
  })

  test('the climb note and the zones note sit in the disclosure', async () => {
    const user = userEvent.setup()
    renderToday(
      dayOf({
        target: makeTarget({
          climbNote: 'This run climbs a good deal. Climb by effort.',
          zonesNote: 'Heart rate and pace use your zones as they are now.',
        }),
      }),
    )
    const card = await screen.findByRole('article', { name: 'Easy run' })
    await user.click(within(card).getByText('What to know today'))
    expect(within(card).getByText('This run climbs a good deal. Climb by effort.')).toBeVisible()
    expect(
      within(card).getByText('Heart rate and pace use your zones as they are now.'),
    ).toBeVisible()
  })

  test('notes from registered producers link to where they can be put right', async () => {
    const { container } = renderToday(
      makeToday({
        coach: makeCoach({
          health: {
            possibleDuplicates: 0,
            pastUnconfirmedWeeks: 0,
            lastWeekReady: false,
            notes: [
              {
                code: 'sync-paused',
                template: 'sync.paused',
                slots: {},
                href: '/integrations',
              },
            ],
          },
        }),
      }),
    )
    const notes = await screen.findByRole('region', { name: 'Health notes' })
    expect(within(notes).getByRole('link')).toHaveAttribute('href', '/integrations')
    expectCleanCopy(container)
  })
})
