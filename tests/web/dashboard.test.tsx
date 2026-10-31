import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import type {
  PlanSessionView,
  PlanWeek,
  PlanWithWeeks,
  StrengthWorkout,
  TodayCoach,
  TodayView,
} from '../../shared/types.ts'
import { WeeklyHoursChart } from '../../web/components/charts/WeeklyHoursChart.tsx'
import { getOutbox } from '../../web/pwa/outbox.ts'
import { makeActivity, makeWeekRow } from '../factories.ts'
import { loggedRun, makeLab, saved } from './fuel-fixtures.ts'
import { activityPage, expectCleanCopy, type MockRoutes } from './helpers.tsx'
import {
  SESSION_ID,
  bodyweightWorkout,
  lb,
  lighterDayWorkout,
  makeView,
  makeWorkout,
  plank,
  rdl,
  savedLog,
  squat,
} from './strength-fixtures.ts'
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

describe('DashboardPage: a strength session', () => {
  const LOG_ID = '3f2b7c1e-8d4a-4f6b-9a31-5c0e2d7b6a10'
  const NO_SLOTS: TodayCoach['slots'] = {
    disruption: null,
    fuel: null,
    watch: null,
    brief: null,
    fuelPrompt: null,
    strength: null,
  }
  const unreachable = {
    status: 503,
    body: { error: { code: 'internal', message: 'No connection.' } },
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const strengthSession = (over: Partial<PlanSessionView> = {}) =>
    makeSession({
      id: SESSION_ID,
      kind: 'strength',
      title: 'Strength',
      durationMin: 40,
      distanceM: null,
      gainM: null,
      purpose: 'Heavy lifts and jumps for a stronger stride.',
      ...over,
    })

  /** A day whose only session is strength, with the workout in the payload's `strength` slot. */
  function strengthDay(
    workout: StrengthWorkout | null = makeWorkout(),
    over: Partial<TodayView> = {},
    session: PlanSessionView = strengthSession(),
  ): TodayView {
    return makeToday({
      sessions: [{ session, advice: 'as-planned', reasons: [] }],
      coach: makeCoach({
        hero: makeHero({ session, target: null }),
        weekStrip: makeStrip({ targetRunMin: 450 }),
        race: makeRace(),
        slots: { ...NO_SLOTS, strength: workout },
      }),
      ...over,
    })
  }

  /** A day with an easy run and a strength session beside it: the run is the hero. */
  function runAndStrength(workout: StrengthWorkout | null = makeWorkout()): TodayView {
    const hero = makeHero({ others: [strengthSession()] })
    return makeToday({
      sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
      coach: makeCoach({
        hero,
        weekStrip: makeStrip({ targetRunMin: 450 }),
        race: makeRace(),
        slots: { ...NO_SLOTS, strength: workout },
      }),
    })
  }

  const routes = (extra: MockRoutes = {}): MockRoutes => ({
    'GET /api/strength': () => makeView(),
    [`PUT /api/strength/logs/${LOG_ID}`]: () => savedLog(LOG_ID),
    ...extra,
  })

  const inKilograms: MockRoutes = {
    'GET /api/settings': () => ({
      email: 'runner@example.com',
      displayName: null,
      units: 'mi',
      weightUnit: 'kg',
    }),
  }

  const rowsOf = (card: HTMLElement, name = 'Strength, heavy A'): string[] =>
    within(within(card).getByRole('list', { name }))
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')

  test('lists the lifts, the jumps and the trunk movements, with Log sets in place of Done', async () => {
    const lead = squat({ evidence: { latest: null, judged: null, estimateG: lb(200) } })
    const workout = makeWorkout()
    const { api, container } = renderToday(
      strengthDay({ ...workout, lifts: [lead, ...workout.lifts.slice(1)] }),
      routes(),
    )
    const card = await screen.findByRole('article', { name: 'Strength' })
    expect(rowsOf(card)).toEqual([
      'Back squat: 4 x 3 to 6, 110 lb, leave 1 to 3.',
      'Dumbbell Romanian deadlift: 3 x 3 to 6, 40 lb, leave 2 or more.',
      'Standing calf raise: 3 x 8 to 15, leave 1 to 3.',
      'Pogo hops, 40 contacts.',
      'Side plank, 2 sets.',
    ])
    // the hero keeps its title, the planned minutes and its action row
    expect(within(card).getByRole('heading', { level: 2, name: 'Strength' })).toBeVisible()
    expect(within(card).getByText('40')).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Log sets' })).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Explain' })).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Not today' })).toBeVisible()
    expect(within(card).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    // no targets list, no lighter-day line on an ordinary day, and the estimated maximum is never shown
    expect(within(card).queryByText('Effort and heart rate come first.')).not.toBeInTheDocument()
    expect(within(card).queryByText(/^Lighter today/)).not.toBeInTheDocument()
    expect(card.textContent).not.toMatch(/maximum|\b200\b/i)
    // the hero adds no request to the first screen
    expect(api.calls.map((call) => call.url).sort()).toEqual(['/api/settings', '/api/today'])
    expectCleanCopy(container)
  })

  test('reads the loads in the weight unit of the settings, and a bodyweight lift has no load', async () => {
    renderToday(strengthDay(bodyweightWorkout()), routes(inKilograms))
    const bodyweight = await screen.findByRole('article', { name: 'Strength' })
    expect(rowsOf(bodyweight, 'Strength, ramp-in A')).toEqual([
      'Tempo squat: 3 x 8 to 15, leave 1 to 3.',
      'Hip thrust (glute bridge): 3 x 8 to 15, leave 1 to 3.',
      'Standing calf raise: 3 x 8 to 15, leave 1 to 3.',
    ])
    cleanup()
    renderToday(strengthDay(), routes(inKilograms))
    const kg = await screen.findByRole('article', { name: 'Strength' })
    expect(rowsOf(kg)[0]).toBe('Back squat: 4 x 3 to 6, 50 kg, leave 1 to 3.')
  })

  test('shows at most five rows: a lift gives way before the jumps and the trunk work do', async () => {
    const workout = makeWorkout()
    const extra = rdl({ exerciseId: 'goblet-squat', slot: 'knee' })
    renderToday(strengthDay({ ...workout, lifts: [...workout.lifts, extra] }), routes())
    const card = await screen.findByRole('article', { name: 'Strength' })
    const rows = rowsOf(card)
    expect(rows).toHaveLength(5)
    expect(rows.slice(-2)).toEqual(['Pogo hops, 40 contacts.', 'Side plank, 2 sets.'])
  })

  test('Log sets opens the logging sheet for the session; saving closes it and returns focus to the title', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
    const user = userEvent.setup()
    const { api } = renderToday(strengthDay(), routes())
    const card = await screen.findByRole('article', { name: 'Strength' })
    await user.click(within(card).getByRole('button', { name: 'Log sets' }))
    const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
    await user.click(await within(dialog).findByRole('button', { name: 'As suggested' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()
    })
    const put = api.calls.find((call) => call.method === 'PUT')
    expect(put?.url).toBe(`/api/strength/logs/${LOG_ID}`)
    expect(put?.body).toMatchObject({ date: '2026-03-18', sessionId: SESSION_ID })
    await waitFor(() => {
      expect(within(card).getByRole('heading', { level: 2 })).toHaveFocus()
    })
  })

  test('Escape closes the sheet and leaves the hero as it was', async () => {
    const user = userEvent.setup()
    renderToday(strengthDay(), routes())
    const card = await screen.findByRole('article', { name: 'Strength' })
    await user.click(within(card).getByRole('button', { name: 'Log sets' }))
    await screen.findByRole('dialog', { name: 'Strength, heavy A' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Log sets' })).toHaveFocus()
  })

  test('without a workout in the payload the session is the plain one, with Done', async () => {
    renderToday(strengthDay(null), routes())
    const card = await screen.findByRole('article', { name: 'Strength' })
    expect(within(card).getByRole('button', { name: 'Done' })).toBeVisible()
    expect(within(card).queryByRole('button', { name: 'Log sets' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('list', { name: /^Strength, / })).not.toBeInTheDocument()
  })

  test('a settled strength session keeps its rows and offers no Log sets', async () => {
    const done = strengthSession({ status: 'completed', activityId: 'a1' })
    renderToday(strengthDay(makeWorkout(), {}, done), routes())
    const card = await screen.findByRole('article', { name: 'Strength' })
    expect(within(card).getByText('Completed')).toBeVisible()
    expect(within(card).queryByRole('button', { name: 'Log sets' })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Explain' })).toBeVisible()
  })

  describe('on a lighter day', () => {
    test('shows the lighter loads and the line that says so, with the usual load one tap away', async () => {
      const { container } = renderToday(strengthDay(lighterDayWorkout()), routes())
      const card = await screen.findByRole('article', { name: 'Strength' })
      expect(rowsOf(card)).toEqual([
        'Back squat: 3 x 3 to 6, 100 lb, leave 1 to 3.',
        'Dumbbell Romanian deadlift: 2 x 3 to 6, 40 lb, leave 2 or more.',
      ])
      expect(
        within(card).getByText(
          'Lighter today: one set fewer and 10% less. The usual load is one tap away.',
        ),
      ).toBeVisible()
      expect(within(card).getByRole('button', { name: 'Use the usual load' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
      expectCleanCopy(container)
    })

    test('"Use the usual load" shows the usual loads and the sheet opens with them', async () => {
      const user = userEvent.setup()
      renderToday(strengthDay(lighterDayWorkout()), routes())
      const card = await screen.findByRole('article', { name: 'Strength' })
      const usual = within(card).getByRole('button', { name: 'Use the usual load' })
      await user.click(usual)
      expect(usual).toHaveAttribute('aria-pressed', 'true')
      expect(rowsOf(card)[0]).toBe('Back squat: 3 x 3 to 6, 110 lb, leave 1 to 3.')
      // the cut in sets still stands, so the line says that and no more
      expect(within(card).getByText('Usual loads, with one set fewer.')).toBeVisible()
      await user.click(within(card).getByRole('button', { name: 'Log sets' }))
      const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
      expect(
        await within(dialog).findByRole('textbox', { name: 'Back squat, set 1, load' }),
      ).toHaveValue('110')
      // a lift with no usual load is where it was
      expect(
        within(dialog).getByRole('textbox', { name: 'Dumbbell Romanian deadlift, set 1, load' }),
      ).toHaveValue('40')
    })

    test('the switch is a toggle: pressed again it is the lighter day, and the sheet opens at the lighter load', async () => {
      const user = userEvent.setup()
      renderToday(strengthDay(lighterDayWorkout()), routes())
      const card = await screen.findByRole('article', { name: 'Strength' })
      const usual = within(card).getByRole('button', { name: 'Use the usual load' })
      await user.click(usual)
      await user.click(usual)
      expect(usual).toHaveAttribute('aria-pressed', 'false')
      expect(rowsOf(card)[0]).toBe('Back squat: 3 x 3 to 6, 100 lb, leave 1 to 3.')
      await user.click(within(card).getByRole('button', { name: 'Log sets' }))
      const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
      expect(
        await within(dialog).findByRole('textbox', { name: 'Back squat, set 1, load' }),
      ).toHaveValue('100')
    })

    test('the usual load does not overwrite a draft the runner left in the sheet', async () => {
      vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
      const user = userEvent.setup()
      renderToday(strengthDay(lighterDayWorkout()), routes())
      const card = await screen.findByRole('article', { name: 'Strength' })
      await user.click(within(card).getByRole('button', { name: 'Log sets' }))
      const first = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
      const set1 = await within(first).findByRole('group', { name: 'Back squat, set 1, load' })
      await user.click(within(set1).getByRole('button', { name: 'Raise the load by one step' }))
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()

      await user.click(within(card).getByRole('button', { name: 'Use the usual load' }))
      await user.click(within(card).getByRole('button', { name: 'Log sets' }))
      const again = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
      // the draft is what the sheet opens on: the raised set, and the others as they were left
      expect(
        await within(again).findByRole('textbox', { name: 'Back squat, set 1, load' }),
      ).toHaveValue('105')
      expect(within(again).getByRole('textbox', { name: 'Back squat, set 2, load' })).toHaveValue(
        '100',
      )
    })

    test('the usual load does not overwrite a save still queued on the phone', async () => {
      vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
      const user = userEvent.setup()
      renderToday(
        strengthDay(lighterDayWorkout()),
        routes({ [`PUT /api/strength/logs/${LOG_ID}`]: () => unreachable }),
      )
      const card = await screen.findByRole('article', { name: 'Strength' })
      await user.click(within(card).getByRole('button', { name: 'Log sets' }))
      const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
      await user.click(await within(dialog).findByRole('button', { name: 'As suggested' }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()
      })
      expect(getOutbox().getState().entries).toHaveLength(1)

      await user.click(within(card).getByRole('button', { name: 'Use the usual load' }))
      await user.click(within(card).getByRole('button', { name: 'Log sets' }))
      const again = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
      // the queued body is the sheet's state on reopen: the lighter load it was saved with
      expect(
        await within(again).findByRole('textbox', { name: 'Back squat, set 1, load' }),
      ).toHaveValue('100')
    })

    test('a day that only cut sets has no switch and does not promise one', async () => {
      const setsOnly = makeWorkout({
        lifts: [
          squat({ sets: 3, targets: [5, 5, 4], usualLoadG: null, change: 'lighter-day' }),
          rdl({ sets: 2, targets: [6, 6] }),
        ],
        plyo: null,
        trunk: [plank()],
      })
      renderToday(strengthDay(setsOnly), routes())
      const card = await screen.findByRole('article', { name: 'Strength' })
      expect(within(card).getByText('Lighter today: one set fewer.')).toBeVisible()
      expect(
        within(card).queryByRole('button', { name: 'Use the usual load' }),
      ).not.toBeInTheDocument()
      expect(within(card).queryByText(/usual load/)).not.toBeInTheDocument()
    })
  })

  describe('"Also today"', () => {
    test('is a button with the accessible name of design 11.1 when the payload carries the workout, and opens the sheet', async () => {
      const user = userEvent.setup()
      const { container } = renderToday(runAndStrength(), routes())
      const card = await screen.findByRole('article', { name: 'Easy run' })
      const item = within(card).getByRole('button', {
        name: 'Strength, 40 minutes: open the workout',
      })
      // the line reads as it did, with the strength item in it
      expect(item).toHaveTextContent('Strength (40 min)')
      expect(item.closest('p')).toHaveTextContent('Also today: Strength (40 min).')
      // the run stays the hero: its targets and Done are where they were
      expect(within(card).getByRole('button', { name: 'Done' })).toBeVisible()
      expect(within(card).getByText('Effort and heart rate come first.')).toBeVisible()
      expectCleanCopy(container)

      await user.click(item)
      const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
      expect(
        await within(dialog).findByRole('textbox', { name: 'Back squat, set 1, load' }),
      ).toHaveValue('110')
    })

    test('saving from it closes the sheet and leaves the run as it was', async () => {
      vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
      const user = userEvent.setup()
      const { api } = renderToday(runAndStrength(), routes())
      const card = await screen.findByRole('article', { name: 'Easy run' })
      await user.click(
        within(card).getByRole('button', { name: 'Strength, 40 minutes: open the workout' }),
      )
      const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
      await user.click(await within(dialog).findByRole('button', { name: 'As suggested' }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()
      })
      expect(api.calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
        sessionId: SESSION_ID,
      })
      expect(within(card).getByRole('button', { name: 'Done' })).toBeVisible()
    })

    test('is plain text when the payload has no workout, or one for another session', async () => {
      renderToday(runAndStrength(null), routes())
      const card = await screen.findByRole('article', { name: 'Easy run' })
      expect(within(card).getByText('Also today: Strength (40 min).')).toBeVisible()
      expect(
        within(card).queryByRole('button', { name: /open the workout/ }),
      ).not.toBeInTheDocument()
      cleanup()
      renderToday(runAndStrength(makeWorkout({ sessionId: 'another' })), routes())
      const other = await screen.findByRole('article', { name: 'Easy run' })
      expect(within(other).getByText('Also today: Strength (40 min).')).toBeVisible()
      expect(
        within(other).queryByRole('button', { name: /open the workout/ }),
      ).not.toBeInTheDocument()
    })

    test('names a second session beside the button, in the same sentence', async () => {
      const hero = makeHero({
        others: [
          strengthSession(),
          makeSession({ id: 'm1', kind: 'mobility', title: 'Mobility', durationMin: 10 }),
        ],
      })
      renderToday(
        makeToday({
          sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
          coach: makeCoach({ hero, slots: { ...NO_SLOTS, strength: makeWorkout() } }),
        }),
        routes(),
      )
      const card = await screen.findByRole('article', { name: 'Easy run' })
      const item = within(card).getByRole('button', { name: /open the workout/ })
      expect(item.closest('p')).toHaveTextContent(
        'Also today: Strength (40 min), Mobility (10 min).',
      )
    })
  })

  describe('a strength log the server refuses when it is finally sent', () => {
    const NOTICE =
      'A strength log saved on this phone was not accepted and was removed. Enter it again if it still applies.'

    test('leaves the entry gone and a notice on Today until it is dismissed', async () => {
      vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
      const user = userEvent.setup()
      let connected = false
      const refused = {
        status: 409,
        body: { error: { code: 'conflict', message: 'That session no longer exists.' } },
      }
      const { container } = renderToday(
        strengthDay(),
        routes({
          [`PUT /api/strength/logs/${LOG_ID}`]: () => (connected ? refused : unreachable),
        }),
      )
      const card = await screen.findByRole('article', { name: 'Strength' })
      await user.click(within(card).getByRole('button', { name: 'Log sets' }))
      const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
      await user.click(await within(dialog).findByRole('button', { name: 'As suggested' }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()
      })
      // kept on the phone, and nothing to say yet
      expect(getOutbox().getState().entries).toHaveLength(1)
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()

      // the connection returns and the server turns the replay down
      connected = true
      await act(async () => {
        await getOutbox().flush()
      })
      expect(getOutbox().getState().entries).toEqual([])
      const notice = await screen.findByText(NOTICE)
      expect(notice).toBeVisible()
      expect(notice).toHaveAttribute('role', 'alert')
      expectCleanCopy(container)

      await user.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
      expect(getOutbox().getState().notices).toEqual([])
    })
  })

  describe('a day ahead', () => {
    test('shows the workout and offers no Log sets and no Not today', async () => {
      // The fixed clock is Wednesday 2026-03-18; the payload is Thursday's preview.
      const session = strengthSession({ date: '2026-03-19' })
      const view = strengthDay(makeWorkout({ date: '2026-03-19' }), { date: '2026-03-19' }, session)
      view.coach.preview = true
      renderToday(view, routes())
      const card = await screen.findByRole('article', { name: 'Strength' })
      expect(rowsOf(card)).toHaveLength(5)
      expect(within(card).queryByRole('button', { name: 'Log sets' })).not.toBeInTheDocument()
      expect(within(card).queryByRole('button', { name: 'Not today' })).not.toBeInTheDocument()
      expect(within(card).getByRole('button', { name: 'Explain' })).toBeVisible()
    })
  })

  describe('with no connection', () => {
    test('the hero and the sheet open from the payload the phone kept, with nothing else asked for', async () => {
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
      vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
      const user = userEvent.setup()
      const { api } = renderToday(
        { ...strengthDay(), servedFromCache: true },
        routes({
          'GET /api/strength': () => unreachable,
          [`PUT /api/strength/logs/${LOG_ID}`]: () => unreachable,
        }),
      )
      const card = await screen.findByRole('article', { name: 'Strength' })
      expect(rowsOf(card)).toHaveLength(5)
      await user.click(within(card).getByRole('button', { name: 'Log sets' }))
      const dialog = await screen.findByRole('dialog', { name: 'Strength, heavy A' })
      // the lifts, their loads and the unit come from the kept payload and settings
      expect(
        await within(dialog).findByRole('textbox', { name: 'Back squat, set 1, load' }),
      ).toHaveValue('110')
      expect(
        await within(dialog).findByText('Same as last time and Swap need a connection.'),
      ).toBeVisible()
      await user.click(within(dialog).getByRole('button', { name: 'As suggested' }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Strength, heavy A' })).not.toBeInTheDocument()
      })
      // the save is kept on the phone, as one entry
      expect(
        getOutbox()
          .getState()
          .entries.map((entry) => entry.url),
      ).toEqual([`/api/strength/logs/${LOG_ID}`])
      // and no read of the workouts was made: the payload carries the one the hero shows
      expect(api.calls.some((call) => call.url.startsWith('/api/strength/workouts'))).toBe(false)
    })
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
