import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import type { PlanWeek, PlanWithWeeks, TodayCoach, TodayView } from '../../shared/types.ts'
import { WeeklyHoursChart } from '../../web/components/charts/WeeklyHoursChart.tsx'
import { makeActivity, makeWeekRow } from '../factories.ts'
import { loggedRun, makeLab, saved } from './fuel-fixtures.ts'
import { activityPage, expectCleanCopy } from './helpers.tsx'
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
import { renderToday, scrollToFoot, startToday } from './today-render.tsx'

// The fixed clock is Wednesday 2026-03-18, so the current week starts on Monday 2026-03-16.
const THIS_WEEK = '2026-03-16'
const FIRST_WINDOW_WEEK = '2025-12-29' // 12 weeks ending this week
const FIRST_PLAN_WEEK = '2026-02-16'

function makePlan(): PlanWithWeeks {
  const weeks: PlanWeek[] = Array.from({ length: 18 }, (_, i) => ({
    id: `w${String(i)}`,
    planId: 'p1',
    weekStart: addDays(FIRST_PLAN_WEEK, 7 * i),
    index: i,
    phase: i < 4 ? 'base1' : 'base2',
    focus: null,
    baselineRunMin: 400,
    targetRunMin: 450,
    plannedRunMin: 450,
    overshoot: false,
    targetSource: 'baseline',
    longRunMin: 120,
    day2Min: null,
    runDays: 4,
    strengthSessions: 2,
    overrideNote: null,
    tid: null,
    flags: [],
    gainTargetM: null,
    qualitySessions: 0,
    isRecovery: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }))
  return {
    id: 'p1',
    userId: 'u1',
    goalId: 'g1',
    name: 'Example Half plan',
    startDate: FIRST_PLAN_WEEK,
    raceWeekStart: '2026-06-08',
    status: 'active',
    generatorVersion: 1,
    paramsVersion: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    weeks,
  }
}

beforeEach(startToday)

afterEach(() => {
  vi.useRealTimers()
})

/** A runner with a plan: today's easy run, a week with a target and a race. */
function planned(over: Parameters<typeof makeCoach>[0] = {}) {
  const hero = makeHero()
  return makeToday({
    sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
    coach: makeCoach({
      hero,
      weekStrip: makeStrip({ runMin: 120, targetRunMin: 450 }),
      race: makeRace(),
      ...over,
    }),
  })
}

describe('DashboardPage', () => {
  test('data-health flags: possible duplicates link to /activities?duplicates=1; past plan weeks without complete data link to /review; a finished unreviewed week shows "Last week is ready to review."', async () => {
    renderToday(
      planned({
        health: {
          possibleDuplicates: 1,
          pastUnconfirmedWeeks: 2,
          lastWeekReady: true,
          notes: [],
        },
      }),
    )
    expect(
      await screen.findByRole('link', { name: '1 possible duplicate to check' }),
    ).toHaveAttribute('href', '/activities?duplicates=1')
    expect(
      screen.getByRole('link', { name: '2 past weeks without confirmed data' }),
    ).toHaveAttribute('href', '/review')
    expect(screen.getByRole('link', { name: 'Last week is ready to review.' })).toHaveAttribute(
      'href',
      '/review',
    )
  })

  test('no flags when everything is confirmed and reviewed', async () => {
    renderToday(planned())
    await screen.findByRole('article', { name: 'Easy run' })
    expect(screen.queryByRole('region', { name: 'Data health' })).not.toBeInTheDocument()
    expect(screen.queryByText(/possible duplicate/)).not.toBeInTheDocument()
    expect(screen.queryByText(/past weeks? without/)).not.toBeInTheDocument()
    expect(screen.queryByText('Last week is ready to review.')).not.toBeInTheDocument()
  })

  test('"Log activity" links to /activities?new=1', async () => {
    renderToday(planned())
    expect(await screen.findByRole('link', { name: 'Log activity' })).toHaveAttribute(
      'href',
      '/activities?new=1',
    )
  })

  test('new account: no goal and no plan shows "No plan yet. Choose a goal race, then generate weekly targets." with a link to /goals; no NaN, Infinity or "0:00" anywhere', async () => {
    const empty = renderToday(makeToday())
    expect(
      await screen.findByText('No plan yet. Choose a goal race, then generate weekly targets.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Choose a goal' })).toHaveAttribute('href', '/goals')
    expect(screen.queryByText(/to the race/)).not.toBeInTheDocument()
    expect(screen.queryByText('Nothing is planned today.')).not.toBeInTheDocument()
    expect(empty.container.textContent).not.toMatch(/NaN|Infinity|0:00/)
  })

  test('a goal without a plan sends the runner to generate one', async () => {
    renderToday(makeToday({ coach: makeCoach({ race: makeRace() }) }))
    expect(await screen.findByRole('link', { name: 'Generate a plan' })).toHaveAttribute(
      'href',
      '/plan',
    )
  })

  test('a week outside the plan says so', async () => {
    const hero = makeHero()
    renderToday(
      makeToday({
        sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
        coach: makeCoach({ hero, weekStrip: makeStrip({ runMin: 60, targetRunMin: null }) }),
      }),
    )
    expect(await screen.findByText('This week is outside the plan.')).toBeInTheDocument()
  })

  test('a plan with a run today and no NaN, Infinity or "0:00" anywhere', async () => {
    const { container } = renderToday(planned())
    await screen.findByRole('article', { name: 'Easy run' })
    expect(container.textContent).not.toMatch(/NaN|Infinity|0:00/)
    expect(screen.queryByText(/No plan yet/)).not.toBeInTheDocument()
  })
})

describe('DashboardPage: the history below the first screen', () => {
  const history = {
    'GET /api/activities': () =>
      activityPage([
        makeActivity({ date: '2026-03-17', durationSec: 2700, distanceM: 8000 }),
        makeActivity({ date: '2026-03-17', type: 'strength', durationSec: 1800, distanceM: null }),
        makeActivity({ date: '2026-03-15', durationSec: 1800, distanceM: 5000 }),
      ]),
    'GET /api/weeks': () =>
      Array.from({ length: 12 }, (_, i) =>
        makeWeekRow({
          weekStart: addDays(FIRST_WINDOW_WEEK, 7 * i),
          ...(addDays(FIRST_WINDOW_WEEK, 7 * i) === THIS_WEEK ? { runMin: 384 } : {}),
        }),
      ),
    'GET /api/plan': () => makePlan(),
  }

  test('asks for nothing until the foot of the page comes near', async () => {
    const { api } = renderToday(planned(), history)
    await screen.findByRole('article', { name: 'Easy run' })
    expect(api.calls.map((call) => call.url).sort()).toEqual(['/api/settings', '/api/today'])
    expect(screen.queryByText(/^Last 28 days$/)).not.toBeInTheDocument()
  })

  test('last 28 days strip and the last 12 weeks chart expose their data in a visually hidden table', async () => {
    scrollToFoot()
    renderToday(planned(), history)
    const strip = await screen.findByRole('table', { name: 'Run minutes per day, last 28 days' })
    expect(within(strip).getAllByRole('row')).toHaveLength(29)
    const tuesday = within(strip).getByRole('row', { name: /17 Mar/ })
    expect(within(tuesday).getByText('45')).toBeInTheDocument()
    expect(screen.getByText('2 runs, 8.08 mi in the last 28 days')).toBeInTheDocument()

    const chart = await screen.findByRole('table', { name: 'Run hours per week, last 12 weeks' })
    expect(within(chart).getAllByRole('row')).toHaveLength(13)
    const current = within(chart).getByRole('row', { name: /16 Mar/ })
    expect(within(current).getByText('6.4')).toBeInTheDocument()
    expect(within(current).getByText('7.5')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Run hours per week, last 12 weeks' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Solid is actual, outline is planned.')).toBeInTheDocument()
  })

  test('a failed history request leaves the page as it is', async () => {
    scrollToFoot()
    renderToday(planned(), {
      ...history,
      'GET /api/activities': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Server error' } },
      }),
    })
    await waitFor(() => {
      expect(screen.getByRole('table', { name: 'Run hours per week, last 12 weeks' })).toBeTruthy()
    })
    expect(screen.queryByRole('table', { name: /last 28 days/ })).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Easy run' })).toBeInTheDocument()
  })
})

describe('DashboardPage: the fuel slots', () => {
  const longRun = () =>
    makeHero({
      session: makeSession({ id: 'long1', kind: 'long', title: 'Long run', durationMin: 150 }),
    })
  const EMPTY_SLOTS: TodayCoach['slots'] = {
    disruption: null,
    fuel: null,
    watch: null,
    brief: null,
    fuelPrompt: null,
    strength: null,
  }
  const withSlots = (slots: Partial<TodayCoach['slots']>, hero = longRun()): TodayView =>
    makeToday({
      sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
      coach: makeCoach({ hero, slots: { ...EMPTY_SLOTS, ...slots } }),
    })
  const fuelSlotOf = async (name: string): Promise<HTMLElement> => {
    const hero = await screen.findByRole('article', { name })
    return hero.querySelector('[data-slot="fuel"]') as HTMLElement
  }

  test('the target line fills the fuel slot inside the hero, within its 26 px budget', async () => {
    renderToday(withSlots({ fuel: makeFuelSlot() }))
    const slot = await fuelSlotOf('Long run')
    expect(slot).not.toBeNull()
    expect(slot).toHaveAttribute('data-budget-px', '26')
    expect(within(slot).getByText('Fuel target: 30 to 50 g/h of carbohydrate')).toBeInTheDocument()
    // The reason waits behind the line, so the slot stays one line tall until it is asked for.
    expect(within(slot).getByText(makeFuelSlot().targets[0]!.text.basis)).not.toBeVisible()
  })

  test('the line opens to why this rate, the fluid and sodium wording, the nausea plan and the safety card', async () => {
    const user = userEvent.setup()
    const fuel = makeFuelSlot()
    const view = fuel.targets[0]!
    renderToday(withSlots({ fuel }))
    const slot = await fuelSlotOf('Long run')
    await user.click(within(slot).getByText('Fuel target: 30 to 50 g/h of carbohydrate'))
    expect(within(slot).getByText(view.text.basis)).toBeVisible()
    expect(within(slot).getByText(view.text.fluid)).toBeVisible()
    expect(within(slot).getByText(view.text.sodium)).toBeVisible()
    expect(within(slot).getByText('If your stomach turns')).toBeVisible()
    expect(within(slot).getByRole('button', { name: 'Why: the fuel target' })).toBeInTheDocument()
    const eah = within(slot).getByRole('note', { name: fuel.eah.heading })
    for (const line of fuel.eah.lines) expect(within(eah).getByText(line)).toBeInTheDocument()
    expectCleanCopy(slot)
  })

  test("says whose day it is when the target belongs to tomorrow and today's session has none", async () => {
    const fuel = makeFuelSlot()
    const view = fuel.targets[0]!
    const tomorrow = { ...view, session: { ...view.session, id: 'long2', date: '2026-03-19' } }
    renderToday(withSlots({ fuel: { ...fuel, targets: [tomorrow] } }, makeHero()))
    const slot = await fuelSlotOf('Easy run')
    expect(within(slot).getByText('Tomorrow: 30 to 50 g/h of carbohydrate')).toBeInTheDocument()
  })

  test('leaves the fuel slot empty when the target is for neither the hero nor tomorrow', async () => {
    const fuel = makeFuelSlot()
    const view = fuel.targets[0]!
    const later = { ...view, session: { ...view.session, id: 'long3', date: '2026-03-25' } }
    renderToday(withSlots({ fuel: { ...fuel, targets: [later] } }, makeHero()))
    await screen.findByRole('article', { name: 'Easy run' })
    expect(document.querySelector('[data-slot="fuel"]')).toBeNull()
  })

  test('has no fuel slot and no fuel prompt when the payload has neither', async () => {
    renderToday(withSlots({}))
    await screen.findByRole('article', { name: 'Long run' })
    expect(document.querySelector('[data-slot="fuel"]')).toBeNull()
    expect(document.querySelector('[data-slot="fuelPrompt"]')).toBeNull()
  })

  test('the prompt card fills the fuelPrompt slot below the fold, with no budget', async () => {
    renderToday(withSlots({ fuelPrompt: makeFuelPrompts() }))
    const card = await screen.findByRole('region', { name: 'Fuel log' })
    const slot = document.querySelector('[data-slot="fuelPrompt"]')
    expect(slot).toContainElement(card)
    expect(slot).not.toHaveAttribute('data-budget-px')
    expect(within(card).getByText('Wed 18 Mar, 3 h, 18.6 mi')).toBeInTheDocument()
    expect(
      within(card).getByRole('button', { name: 'Log fuel for Wed 18 Mar, 3 h, 18.6 mi' }),
    ).toBeInTheDocument()
    expectCleanCopy(card)
  })

  test('"Not this time" marks the run, shows the server sentence, and the card is gone with the next read', async () => {
    const user = userEvent.setup()
    let current: TodayView = withSlots({ fuelPrompt: makeFuelPrompts() })
    const sentence = 'Not logged this time, so this run does not count toward your ladder.'
    const { api } = renderToday(current, {
      'GET /api/today': () => current,
      'POST /api/fuel/logs/run1/skip': () => {
        current = withSlots({})
        return { log: null, ladder: makeLab().ladder, message: sentence }
      },
    })
    const card = await screen.findByRole('region', { name: 'Fuel log' })
    await user.click(
      within(card).getByRole('button', { name: 'Not this time for Wed 18 Mar, 3 h, 18.6 mi' }),
    )
    expect(await screen.findByText(sentence)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Fuel log' })).not.toBeInTheDocument()
    })
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  test("a prompt that was answered hands focus to the card's heading when other prompts remain", async () => {
    const user = userEvent.setup()
    const run = (activityId: string, date: string) => ({
      activityId,
      date,
      startTime: null,
      durationSec: 3 * 3600,
      distanceM: null,
      block: false,
    })
    let current: TodayView = withSlots({
      fuelPrompt: makeFuelPrompts([run('run1', '2026-03-18'), run('run2', '2026-03-17')]),
    })
    renderToday(current, {
      'GET /api/today': () => current,
      'POST /api/fuel/logs/run1/skip': () => {
        current = withSlots({ fuelPrompt: makeFuelPrompts([run('run2', '2026-03-17')]) })
        return { log: null, ladder: makeLab().ladder, message: 'Marked.' }
      },
    })
    const card = await screen.findByRole('region', { name: 'Fuel log' })
    await user.click(within(card).getByRole('button', { name: /^Not this time for Wed 18 Mar/ }))
    await waitFor(() => {
      expect(within(card).getAllByRole('listitem')).toHaveLength(1)
    })
    expect(within(card).getByText('Tue 17 Mar, 3 h')).toBeInTheDocument()
    await waitFor(() => {
      expect(within(card).getByRole('heading', { name: 'Fuel log' })).toHaveFocus()
    })
  })

  test('says so in an alert when "Not this time" cannot be saved, and keeps the prompt', async () => {
    const user = userEvent.setup()
    renderToday(withSlots({ fuelPrompt: makeFuelPrompts() }), {
      'POST /api/fuel/logs/run1/skip': () => ({
        status: 409,
        body: { error: { code: 'conflict', message: 'This run already has a fuel log.' } },
      }),
    })
    const card = await screen.findByRole('region', { name: 'Fuel log' })
    await user.click(within(card).getByRole('button', { name: /^Not this time for/ }))
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'The run was not marked. This run already has a fuel log. Try again.',
    )
    expect(within(card).getByRole('button', { name: /^Log fuel for/ })).toBeInTheDocument()
  })

  test('"Log fuel" opens the 20-second form for that run; saving closes it, toasts and reads today again', async () => {
    const user = userEvent.setup()
    const runs = [loggedRun(18, { servings: 6, gut: 0 })]
    let current: TodayView = withSlots({ fuelPrompt: makeFuelPrompts() })
    const lab = makeLab([loggedRun(2, { servings: 6, gut: 0 })], {}, { run2: 900 })
    const { api } = renderToday(current, {
      'GET /api/today': () => current,
      'GET /api/fuel': () => lab,
      'GET /api/fuel/logs/run1': () => null,
      'GET /api/activities/run1/detail': () => ({
        activity: makeActivity({
          id: 'run1',
          date: '2026-03-18',
          durationSec: 3 * 3600,
          tempC: 12,
          humidityPct: 60,
          windKph: 5,
        }),
        stream: null,
        laps: null,
        hasFile: false,
      }),
      'PUT /api/fuel/logs/run1': () => {
        current = withSlots({})
        return saved(runs, 'run18')
      },
    })
    const card = await screen.findByRole('region', { name: 'Fuel log' })
    await user.click(within(card).getByRole('button', { name: /^Log fuel for/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Fuel log' })

    // About twenty seconds: the same products as last time, one gut chip, Save.
    await user.click(await within(sheet).findByRole('button', { name: 'Same as last long run' }))
    await user.click(
      within(within(sheet).getByRole('radiogroup', { name: 'Gut' })).getByRole('radio', {
        name: '0 None',
      }),
    )
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Fuel log' })).not.toBeInTheDocument()
    })
    const put = api.calls.find((call) => call.method === 'PUT')
    expect(put?.url).toBe('/api/fuel/logs/run1')
    expect(put?.body).toMatchObject({
      items: [{ productId: 'p-gel', servings: 6 }],
      fluidMl: 900,
      gut: 0,
      hot: null,
    })
    expect(api.calls.filter((c) => c.method === 'GET' && c.url === '/api/today')).toHaveLength(2)
    expect(screen.queryByRole('region', { name: 'Fuel log' })).not.toBeInTheDocument()
    expect(await screen.findByText(saved(runs, 'run18').message ?? '')).toBeInTheDocument()
  })

  test('after a log is saved from the sheet, focus goes to the heading of the card that remains', async () => {
    const user = userEvent.setup()
    const run = (activityId: string, date: string) => ({
      activityId,
      date,
      startTime: null,
      durationSec: 3 * 3600,
      distanceM: null,
      block: false,
    })
    const runs = [loggedRun(18, { servings: 6, gut: 0 })]
    let current: TodayView = withSlots({
      fuelPrompt: makeFuelPrompts([run('run1', '2026-03-18'), run('run2', '2026-03-17')]),
    })
    renderToday(current, {
      'GET /api/today': () => current,
      'GET /api/fuel': () => makeLab(),
      'GET /api/fuel/logs/run1': () => null,
      'GET /api/activities/run1/detail': () => ({
        activity: makeActivity({ id: 'run1', date: '2026-03-18', durationSec: 3 * 3600 }),
        stream: null,
        laps: null,
        hasFile: false,
      }),
      'PUT /api/fuel/logs/run1': () => {
        current = withSlots({ fuelPrompt: makeFuelPrompts([run('run2', '2026-03-17')]) })
        return saved(runs, 'run18')
      },
    })
    const card = await screen.findByRole('region', { name: 'Fuel log' })
    await user.click(within(card).getByRole('button', { name: /^Log fuel for Wed 18 Mar/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Fuel log' })
    await user.click(
      within(await within(sheet).findByRole('radiogroup', { name: 'Gut' })).getByRole('radio', {
        name: '0 None',
      }),
    )
    await user.click(within(sheet).getByRole('button', { name: 'Save fuel log' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Fuel log' })).not.toBeInTheDocument()
    })
    expect(within(card).getAllByRole('listitem')).toHaveLength(1)
    await waitFor(() => {
      expect(within(card).getByRole('heading', { name: 'Fuel log' })).toHaveFocus()
    })
  })

  test('DashboardPage places both slots empty and imports nothing from the fuel components', () => {
    const source = readFileSync(join(process.cwd(), 'web/pages/DashboardPage.tsx'), 'utf8')
    expect(source).toContain('<TodaySlot name="fuelPrompt" />')
    expect(source).not.toMatch(/components\/fuel\//)
    const hero = readFileSync(join(process.cwd(), 'web/components/today/SessionHero.tsx'), 'utf8')
    expect(hero).toContain('<TodaySlot name="fuel" />')
    expect(hero).not.toMatch(/fuel\//)
  })
})

describe('WeeklyHoursChart', () => {
  test('the planned bar sits centred behind the narrower actual bar', () => {
    // jsdom has no layout; give the chart a size so recharts draws the bars.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ width: 640, height: 200 }),
    )
    try {
      const { container } = render(
        <WeeklyHoursChart
          weeks={[makeWeekRow({ weekStart: THIS_WEEK, runMin: 300 })]}
          planned={[{ weekStart: THIS_WEEK, targetRunMin: 450 }]}
          ariaLabel="Run hours"
        />,
      )
      const bars = [...container.querySelectorAll('.recharts-rectangle')].map((el) => ({
        x: Number(el.getAttribute('x')),
        width: Number(el.getAttribute('width')),
        fill: el.getAttribute('fill'),
      }))
      expect(bars).toHaveLength(2)
      const [planned, actual] = bars as [(typeof bars)[0], (typeof bars)[0]]
      // Drawn first, so behind; outlined, so unfilled.
      expect(planned.fill).toBe('none')
      expect(actual.width).toBeLessThan(planned.width)
      expect(actual.x + actual.width / 2).toBeCloseTo(planned.x + planned.width / 2)
    } finally {
      vi.restoreAllMocks()
    }
  })
})
