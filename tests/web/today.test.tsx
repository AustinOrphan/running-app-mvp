import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Checkin, DisruptionSlot, DisruptionView, TodayView } from '../../shared/types.ts'
import { getOutbox } from '../../web/pwa/outbox.ts'
import { makeActivity } from '../factories.ts'
import { explainOf, expectCleanCopy, type MockRoutes } from './helpers.tsx'
import {
  AVAILABLE,
  makeBrief,
  makeDiff,
  makeLine,
  makePreview,
  makeRevision,
  makeV2Plan,
  makeWeekLine,
  makeWindow,
} from './plan-fixtures.ts'
import {
  makeCoach,
  makeHeat,
  makeHero,
  makeSession,
  makeTarget,
  makeToday,
  TODAY,
} from './today-fixtures.ts'
import { renderToday as render, startToday } from './today-render.tsx'

// Stands in for the real drawer (Task E14) so the wiring is visible: which rules it was opened with.
vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, explain, open }: { rules: string[]; explain?: unknown; open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Why" data-explain={JSON.stringify(explain ?? null)}>
        {`rules: ${rules.join(', ')}`}
      </div>
    ) : null,
}))

// The fixed clock is Wednesday 2026-03-18.
beforeEach(startToday)

afterEach(() => {
  vi.useRealTimers()
})

/** A day with one easy run, as the server sends it: the hero and the legacy session list agree. */
function withEasyRun(over: Partial<TodayView> = {}): TodayView {
  const hero = makeHero()
  return makeToday({
    sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
    coach: makeCoach({ hero }),
    ...over,
  })
}

describe("Today: today's session", () => {
  test('shows the duration as the display figure with the targets and the purpose', async () => {
    const { container } = render(withEasyRun())
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('45')).toBeInTheDocument()
    expect(within(card).getByText('min')).toBeInTheDocument()
    expect(within(card).getByText('5.00 mi')).toBeInTheDocument()
    expect(within(card).getByText('197 ft climb')).toBeInTheDocument()
    expect(within(card).getByText('Heart rate')).toBeInTheDocument()
    expect(within(card).getByText('under 142 bpm')).toBeInTheDocument()
    expect(within(card).getByText('about 9:15 to 10:28 /mi')).toBeInTheDocument()
    expect(within(card).getByText('Effort and heart rate come first.')).toBeInTheDocument()
    expect(within(card).getByText('3 to 4 out of 10')).toBeInTheDocument()
    expect(within(card).getByText('Aerobic base at an easy effort.')).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('leaves out figures the session does not carry', async () => {
    const session = makeSession({
      kind: 'strength',
      title: 'Strength',
      distanceM: null,
      gainM: null,
      target: { zone: 'strength', rpe: [5, 6], hr: null, paceSecPerKm: null, heatNote: null },
    })
    const hero = makeHero({
      session,
      target: makeTarget({
        zone: 'strength',
        mode: 'effort',
        hrCeiling: null,
        paceSecPerKm: null,
        rpe: [5, 6],
      }),
    })
    render(
      makeToday({
        sessions: [{ session, advice: 'as-planned', reasons: [] }],
        coach: makeCoach({ hero }),
      }),
    )
    const card = await screen.findByRole('article', { name: 'Strength' })
    expect(within(card).queryByText('Pace')).not.toBeInTheDocument()
    expect(within(card).queryByText('Heart rate')).not.toBeInTheDocument()
    expect(within(card).queryByText(/ mi$/)).not.toBeInTheDocument()
    expect(within(card).getByText('5 to 6 out of 10')).toBeInTheDocument()
  })

  test('Explain opens the drawer with the rules of the session', async () => {
    const user = userEvent.setup()
    render(withEasyRun())
    const card = await screen.findByRole('article', { name: 'Easy run' })
    await user.click(within(card).getByRole('button', { name: 'Explain' }))
    const drawer = await screen.findByRole('dialog', { name: 'Why' })
    expect(drawer).toHaveTextContent('rules: f-1, g-1')
    expect(explainOf(drawer)).toEqual({ subject: 'session', id: 's1' })
  })

  test('a completed session is labelled and shows the run that was logged', async () => {
    const run = makeActivity({ id: 'r1', date: TODAY, durationSec: 2700, distanceM: 8047 })
    const session = makeSession({ status: 'completed', activityId: 'r1' })
    render(
      makeToday({
        sessions: [{ session, advice: 'as-planned', reasons: [] }],
        coach: makeCoach({ hero: makeHero({ session, linkedRun: run }) }),
      }),
    )
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('Completed')).toBeInTheDocument()
    expect(within(card).getByText('Logged: 5.00 mi in 45 min.')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Not today' })).not.toBeInTheDocument()
  })

  test('version-1 plans return no sessions and the page still renders', async () => {
    render(makeToday())
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    await screen.findByText(/No plan yet/)
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
})

describe('Today: heat, readiness and red flags', () => {
  const warm = makeHeat({
    wbgtC: 25.4,
    note: 'Warm day: WBGT reaches 25 C around 15:00. A start near 06:00 is cooler (WBGT about 17 C).',
    coolerHour: '06:00',
    coolerValue: 17.2,
    peakHour: 15,
    index: 'wbgt',
  })

  test('a warm day states the cooler start, and the heat note sits in the disclosure', async () => {
    const user = userEvent.setup()
    render(withEasyRun({ heat: warm }))
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(
      within(card).getByText('Cooler start: 06:00. WBGT about 17 °C then, 25 °C around 15:00.'),
    ).toBeInTheDocument()
    await user.click(within(card).getByText('What to know today'))
    expect(within(card).getByText(/Warm day: WBGT reaches 25 C around 15:00/)).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Why: the heat note' }))
    const drawer = await screen.findByRole('dialog', { name: 'Why' })
    expect(drawer).toHaveTextContent('rules: I7, I9')
    expect(explainOf(drawer)).toEqual({ subject: 'rules', rules: ['I7', 'I9'] })
  })

  test('a day with no heat read has no cooler start and no disclosure', async () => {
    render(withEasyRun())
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).queryByText(/Cooler start/)).not.toBeInTheDocument()
    expect(within(card).queryByText('What to know today')).not.toBeInTheDocument()
  })

  test('the disclosure is a group the runner opens and closes by its summary', async () => {
    const user = userEvent.setup()
    window.localStorage.removeItem('rl_today_more')
    render(withEasyRun({ heat: warm }))
    const card = await screen.findByRole('article', { name: 'Easy run' })
    const group = within(card).getByRole('group')
    expect(group).not.toHaveAttribute('open')
    await user.click(within(group).getByText('What to know today'))
    expect(group).toHaveAttribute('open')
    expect(within(group).getByRole('button', { name: 'Why: the heat note' })).toBeVisible()
    await user.click(within(group).getByText('What to know today'))
    expect(group).not.toHaveAttribute('open')
    window.localStorage.removeItem('rl_today_more')
  })

  test('the summary row keeps the browser marker, the one cue that the line opens', () => {
    // jsdom draws no marker, so the stylesheet is read: `display: flex` or `list-style: none` on
    // the summary removes the marker in Chromium and Firefox.
    const css = readFileSync(
      join(process.cwd(), 'web/components/today/KnowToday.module.css'),
      'utf8',
    )
    const rule = /\.summary\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/display:\s*list-item/)
    expect(rule).not.toMatch(/list-style/)
  })

  test('the disclosure keeps its state on this device', async () => {
    const user = userEvent.setup()
    window.localStorage.removeItem('rl_today_more')
    const first = render(withEasyRun({ heat: warm }))
    await user.click(await screen.findByText('What to know today'))
    await waitFor(() => {
      expect(window.localStorage.getItem('rl_today_more')).toBe('1')
    })
    first.unmount()
    render(withEasyRun({ heat: warm }))
    await screen.findByRole('article', { name: 'Easy run' })
    expect(screen.getByText('What to know today').closest('details')).toHaveAttribute('open')
    window.localStorage.removeItem('rl_today_more')
  })

  test('the verdict and the signals behind it read as the server worded them', async () => {
    const { container } = render(
      makeToday({
        coach: makeCoach({
          verdict: {
            code: 'low-plan-stays',
            template: 'today.verdict.low-plan-stays',
            slots: {},
          },
          signals: [
            {
              code: 'checkin',
              noted: true,
              template: 'today.signal.checkin-tired',
              slots: {},
            },
            {
              code: 'resting-hr',
              noted: false,
              template: 'today.signal.resting-hr-only',
              slots: { latest: { kind: 'bpm', bpm: 58 } },
            },
          ],
        }),
      }),
    )
    const read = await screen.findByRole('region', { name: 'Readiness' })
    expect(within(read).getByRole('status')).toHaveTextContent(
      'Signals are a little low. The plan stays as it is.',
    )
    const signals = within(read).getByRole('list', { name: 'Readiness signals' })
    expect(
      within(signals)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Check-in: feeling tired.', 'Resting heart rate is 58 bpm.'])
    expectCleanCopy(container)
  })

  test('red flags appear as notes with their why button, not as alarms', async () => {
    const user = userEvent.setup()
    const today = makeToday()
    today.readiness.redFlags = [
      {
        code: 'focal-bone-pain',
        message: 'Point tenderness on a bone: see a clinician before the next run.',
        rules: ['n-1'],
      },
    ]
    render(today)
    const banners = await screen.findByRole('region', { name: 'Health notes' })
    expect(
      within(banners).getByText('Point tenderness on a bone: see a clinician before the next run.'),
    ).toBeInTheDocument()
    expect(within(banners).queryByRole('alert')).not.toBeInTheDocument()
    await user.click(within(banners).getByRole('button', { name: 'Why: this note' }))
    const drawer = await screen.findByRole('dialog', { name: 'Why' })
    expect(drawer).toHaveTextContent('rules: n-1')
    expect(explainOf(drawer)).toEqual({ subject: 'rules', rules: ['n-1'] })
  })

  test('links to the disclaimer', async () => {
    render(makeToday())
    const note = await screen.findByRole('region', { name: 'Disclaimer' })
    expect(within(note).getByText(/not medical, nutrition or injury advice/)).toBeInTheDocument()
    expect(within(note).getByRole('link', { name: 'How the numbers are graded' })).toHaveAttribute(
      'href',
      '/research',
    )
  })
})

/** `navigator.onLine` as the test needs it. */
function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

const CHECKIN_ROUTE = 'PUT /api/checkins/2026-03-18'

const savedCheckin = (over: Partial<Checkin> = {}): Checkin => ({
  date: TODAY,
  fatigue: null,
  soreness: null,
  sleepQuality: null,
  mood: null,
  stress: null,
  illness: false,
  painScore: null,
  painArea: null,
  painFocalBone: false,
  ...over,
})

describe('Today: the one-row check-in', () => {
  afterEach(() => {
    setOnline(true)
  })

  test('asks one question with five answers under the verdict, and a way to say something hurts', async () => {
    const { container } = render(makeToday())
    const read = await screen.findByRole('region', { name: 'Readiness' })
    const verdict = within(read).getByRole('status')
    expect(verdict).toHaveTextContent('No readiness signals yet. One tap below adds the first.')
    const group = within(read).getByRole('radiogroup', { name: 'How do you feel today?' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Fresh', 'Good', 'Normal', 'Tired', 'Drained'])
    for (const radio of within(group).getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false')
    }
    expect(verdict.compareDocumentPosition(group)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(read).getByRole('button', { name: "Something hurts, or I'm ill" })).toBeVisible()
    expect(within(read).queryByRole('button', { name: 'Add more' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Check-in' })).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('"One tap below adds the first." is true: the row is the next control after the verdict', async () => {
    const user = userEvent.setup()
    render(makeToday())
    const read = await screen.findByRole('region', { name: 'Readiness' })
    const verdict = within(read).getByRole('status')
    expect(verdict).toHaveTextContent('One tap below adds the first.')
    act(() => {
      verdict.focus()
    })
    await user.tab()
    expect(within(read).getByRole('radio', { name: 'Fresh' })).toHaveFocus()
  })

  test('with signals listed the row still comes next, after the readings', async () => {
    const user = userEvent.setup()
    render(
      makeToday({
        coach: makeCoach({
          verdict: { code: 'low-plan-stays', template: 'today.verdict.low-plan-stays', slots: {} },
          signals: [
            {
              code: 'resting-hr',
              noted: false,
              template: 'today.signal.resting-hr-only',
              slots: { latest: { kind: 'bpm', bpm: 58 } },
            },
          ],
        }),
      }),
    )
    const read = await screen.findByRole('region', { name: 'Readiness' })
    const verdict = within(read).getByRole('status')
    const signals = within(read).getByRole('list', { name: 'Readiness signals' })
    const group = within(read).getByRole('radiogroup', { name: 'How do you feel today?' })
    expect(verdict.compareDocumentPosition(signals)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(signals.compareDocumentPosition(group)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    act(() => {
      verdict.focus()
    })
    await user.tab()
    expect(within(read).getByRole('radio', { name: 'Fresh' })).toHaveFocus()
  })

  test('once the answer waits on the phone the verdict no longer promises a tap', async () => {
    const user = userEvent.setup()
    setOnline(false)
    const { container } = render(makeToday())
    const read = await screen.findByRole('region', { name: 'Readiness' })
    await user.click(within(read).getByRole('radio', { name: 'Tired' }))
    expect(await within(read).findByRole('status')).toHaveTextContent(
      'Your check-in is saved on this phone. Readiness is read again once it is sent.',
    )
    expect(screen.queryByText(/One tap below/)).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('one tap saves { fatigue }, folds into a sentence and moves focus to the verdict', async () => {
    const user = userEvent.setup()
    const { api, container } = render(makeToday(), { [CHECKIN_ROUTE]: () => ({}) })
    const read = await screen.findByRole('region', { name: 'Readiness' })
    await user.click(within(read).getByRole('radio', { name: 'Tired' }))
    await waitFor(() => {
      expect(api.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
    })
    expect(api.calls.find((call) => call.method === 'PUT')).toMatchObject({
      url: '/api/checkins/2026-03-18',
      body: { fatigue: 4 },
    })
    expect(within(read).getByText('Checked in: tired.')).toBeInTheDocument()
    expect(within(read).queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(within(read).getByRole('status')).toHaveFocus()
    expect(within(read).getByRole('button', { name: 'Add more' })).toBeVisible()
    expect(within(read).getByRole('button', { name: "Something hurts, or I'm ill" })).toBeVisible()
    expectCleanCopy(container)
  })

  test('the fold holds until the server shows the answer, whatever the next read says', async () => {
    const user = userEvent.setup()
    let saved = false
    // The server has not caught up: the read that follows the save still holds no answer. It does
    // carry a signal, so the list of signals shows when that read has landed on the page.
    const afterSave = makeToday({
      coach: makeCoach({
        verdict: { code: 'low-plan-stays', template: 'today.verdict.low-plan-stays', slots: {} },
        signals: [
          {
            code: 'resting-hr',
            noted: false,
            template: 'today.signal.resting-hr-only',
            slots: { latest: { kind: 'bpm', bpm: 58 } },
          },
        ],
      }),
    })
    const { api } = render(makeToday(), {
      'GET /api/today': () => (saved ? afterSave : makeToday()),
      [CHECKIN_ROUTE]: () => {
        saved = true
        return savedCheckin({ fatigue: 4 })
      },
    })
    const read = await screen.findByRole('region', { name: 'Readiness' })
    await user.click(within(read).getByRole('radio', { name: 'Tired' }))
    expect(await within(read).findByRole('list', { name: 'Readiness signals' })).toBeVisible()

    const reads = api.calls.filter((call) => call.method === 'GET' && call.url === '/api/today')
    expect(reads).toHaveLength(2)
    // The queued write is gone and the read says no answer, yet the row stays folded.
    expect(getOutbox().getState().entries).toEqual([])
    expect(within(read).getByText('Checked in: tired.')).toBeInTheDocument()
    expect(within(read).queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  test('the arrow keys only move between the answers; Space chooses', async () => {
    const user = userEvent.setup()
    const { api } = render(makeToday(), { [CHECKIN_ROUTE]: () => ({}) })
    const read = await screen.findByRole('region', { name: 'Readiness' })
    const group = within(read).getByRole('radiogroup', { name: 'How do you feel today?' })
    await user.tab()
    // Tab reaches the group's one tab stop after the page's own links.
    while (!group.contains(document.activeElement)) await user.tab()
    expect(document.activeElement).toHaveTextContent('Fresh')
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(document.activeElement).toHaveTextContent('Normal')
    expect(api.calls.filter((call) => call.method === 'PUT')).toEqual([])
    await user.keyboard(' ')
    await waitFor(() => {
      expect(api.calls.find((call) => call.method === 'PUT')?.body).toEqual({ fatigue: 3 })
    })
    expect(within(read).getByText('Checked in: normal.')).toBeInTheDocument()
  })

  test('starts folded when the server already holds an answer', async () => {
    render(makeToday({ checkin: savedCheckin({ fatigue: 2 }) }))
    const read = await screen.findByRole('region', { name: 'Readiness' })
    expect(within(read).getByText('Checked in: good.')).toBeInTheDocument()
    expect(within(read).queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  test('a check-in with other answers but no fatigue still asks the question', async () => {
    render(makeToday({ checkin: savedCheckin({ mood: 4 }) }))
    const read = await screen.findByRole('region', { name: 'Readiness' })
    expect(within(read).getByRole('radiogroup')).toBeInTheDocument()
  })

  test('a day ahead has no check-in', async () => {
    render(makeToday({ coach: makeCoach({ preview: true, verdict: null, signals: [] }) }))
    await screen.findByText(/No plan yet/)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    // No verdict, so nothing promises a tap that is not there.
    expect(screen.queryByText(/One tap below/)).not.toBeInTheDocument()
  })

  test('with no connection the answer is kept on this phone and goes out when it returns', async () => {
    const user = userEvent.setup()
    setOnline(false)
    const { api, container } = render(makeToday(), { [CHECKIN_ROUTE]: () => ({}) })
    const read = await screen.findByRole('region', { name: 'Readiness' })
    await user.click(within(read).getByRole('radio', { name: 'Tired' }))
    expect(await within(read).findByText('Checked in: tired. Saved on this phone.')).toBeVisible()
    expect(api.calls.filter((call) => call.method === 'PUT')).toEqual([])
    expectCleanCopy(container)

    setOnline(true)
    await act(async () => {
      await getOutbox().flush()
    })
    expect(api.calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
    expect(api.calls.find((call) => call.method === 'PUT')?.body).toEqual({ fatigue: 4 })
    expect(await within(read).findByText('Checked in: tired.')).toBeVisible()
  })

  test('a queued answer is still there when the page is opened again', async () => {
    const user = userEvent.setup()
    setOnline(false)
    const first = render(makeToday())
    const read = await screen.findByRole('region', { name: 'Readiness' })
    await user.click(within(read).getByRole('radio', { name: 'Drained' }))
    await within(read).findByText('Checked in: drained. Saved on this phone.')
    first.unmount()

    render(makeToday())
    const again = await screen.findByRole('region', { name: 'Readiness' })
    expect(
      await within(again).findByText('Checked in: drained. Saved on this phone.'),
    ).toBeVisible()
    expect(within(again).queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  test('a refusal puts the question back and says what to do', async () => {
    const user = userEvent.setup()
    render(makeToday(), {
      [CHECKIN_ROUTE]: () => ({
        status: 400,
        body: { error: { code: 'validation', message: 'Use a real date.' } },
      }),
    })
    const read = await screen.findByRole('region', { name: 'Readiness' })
    await user.click(within(read).getByRole('radio', { name: 'Good' }))
    expect(await within(read).findByRole('alert')).toHaveTextContent(
      'Check-in not saved. Use a real date. Try again.',
    )
    expect(within(read).getByRole('radiogroup')).toBeInTheDocument()
  })

  test('an answer the server turns down later is dropped with one message', async () => {
    const user = userEvent.setup()
    setOnline(false)
    render(makeToday(), {
      [CHECKIN_ROUTE]: () => ({
        status: 400,
        body: { error: { code: 'validation', message: 'Use a real date.' } },
      }),
    })
    const read = await screen.findByRole('region', { name: 'Readiness' })
    await user.click(within(read).getByRole('radio', { name: 'Good' }))
    await within(read).findByText('Checked in: good. Saved on this phone.')
    setOnline(true)
    await act(async () => {
      await getOutbox().flush()
    })
    expect(await within(read).findByRole('alert')).toHaveTextContent(
      'A check-in saved on this phone was not accepted and was removed. Enter it again if it still applies.',
    )
    expect(within(read).getByRole('radiogroup')).toBeInTheDocument()
  })
})

describe('Today: the check-in sheet', () => {
  afterEach(() => {
    setOnline(true)
  })

  test('"Something hurts, or I\'m ill" opens the sheet at pain and illness', async () => {
    const user = userEvent.setup()
    const { container } = render(makeToday())
    await user.click(await screen.findByRole('button', { name: "Something hurts, or I'm ill" }))
    const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
    const headings = within(sheet)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual(['Pain and illness', 'How you feel'])
    expect(within(sheet).getByRole('checkbox', { name: 'Feeling ill' })).toHaveFocus()
    expect(
      within(sheet).getByRole('checkbox', { name: 'Point tenderness on a bone' }),
    ).toBeVisible()
    expect(within(sheet).getByRole('button', { name: 'Pain today 10' })).toBeVisible()
    expect(within(sheet).getByRole('textbox', { name: 'Pain area' })).toBeVisible()
    expectCleanCopy(container)
  })

  test('"Add more" opens it at the five scales, starting from the answer given', async () => {
    const user = userEvent.setup()
    render(makeToday({ checkin: savedCheckin({ fatigue: 4 }) }))
    await user.click(await screen.findByRole('button', { name: 'Add more' }))
    const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
    expect(
      within(sheet)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['How you feel', 'Pain and illness'])
    expect(within(sheet).getByRole('button', { name: 'Fatigue 4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(sheet).getByRole('button', { name: 'Fatigue 1' })).toHaveFocus()
    expect(
      within(sheet).getByText('Saved for today. Change any answer and save again.'),
    ).toBeVisible()
    expect(within(sheet).getByRole('button', { name: 'Save check-in' })).toBeDisabled()
  })

  test('saves the chosen answers for today, through the outbox', async () => {
    const user = userEvent.setup()
    const { api } = render(makeToday(), { [CHECKIN_ROUTE]: () => ({}) })
    await user.click(await screen.findByRole('button', { name: "Something hurts, or I'm ill" }))
    const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
    expect(within(sheet).getByRole('button', { name: 'Save check-in' })).toBeDisabled()
    await user.click(within(sheet).getByRole('button', { name: 'Fatigue 4' }))
    await user.click(within(sheet).getByRole('button', { name: 'Sleep quality 2' }))
    await user.click(within(sheet).getByRole('checkbox', { name: 'Feeling ill' }))
    await user.click(within(sheet).getByRole('button', { name: 'Pain today 5' }))
    await user.type(within(sheet).getByRole('textbox', { name: 'Pain area' }), 'left shin')
    await user.click(within(sheet).getByRole('checkbox', { name: 'Point tenderness on a bone' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save check-in' }))
    await waitFor(() => {
      expect(api.calls.some((call) => call.method === 'PUT')).toBe(true)
    })
    expect(api.calls.find((call) => call.method === 'PUT')?.body).toEqual({
      fatigue: 4,
      soreness: null,
      sleepQuality: 2,
      mood: null,
      stress: null,
      illness: true,
      painScore: 5,
      painArea: 'left shin',
      painFocalBone: true,
    })
    expect(await screen.findByText('Check-in saved')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Check-in' })).not.toBeInTheDocument()
    })
  })

  test('with no connection the sheet saves to the phone and says so', async () => {
    const user = userEvent.setup()
    setOnline(false)
    const { api } = render(makeToday(), { [CHECKIN_ROUTE]: () => ({}) })
    await user.click(await screen.findByRole('button', { name: "Something hurts, or I'm ill" }))
    const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
    await user.click(within(sheet).getByRole('checkbox', { name: 'Feeling ill' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save check-in' }))
    expect(await screen.findByText('Check-in saved on this phone')).toBeInTheDocument()
    expect(api.calls.filter((call) => call.method === 'PUT')).toEqual([])
    // Opened again, the sheet starts from the queued answers.
    await user.click(await screen.findByRole('button', { name: "Something hurts, or I'm ill" }))
    const again = await screen.findByRole('dialog', { name: 'Check-in' })
    expect(within(again).getByRole('checkbox', { name: 'Feeling ill' })).toBeChecked()
  })

  test('a fatigue answer given in the sheet folds the row, whatever the next read says', async () => {
    const user = userEvent.setup()
    render(makeToday(), { [CHECKIN_ROUTE]: () => ({}) })
    const read = await screen.findByRole('region', { name: 'Readiness' })
    await user.click(within(read).getByRole('button', { name: "Something hurts, or I'm ill" }))
    const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
    await user.click(within(sheet).getByRole('button', { name: 'Fatigue 5' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save check-in' }))
    expect(await within(read).findByText('Checked in: drained.')).toBeVisible()
    expect(within(read).queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  test('a queued one-tap answer is what the sheet starts from', async () => {
    const user = userEvent.setup()
    setOnline(false)
    render(makeToday())
    const read = await screen.findByRole('region', { name: 'Readiness' })
    await user.click(within(read).getByRole('radio', { name: 'Tired' }))
    await user.click(await within(read).findByRole('button', { name: 'Add more' }))
    const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
    expect(within(sheet).getByRole('button', { name: 'Fatigue 4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('starts from the saved check-in', async () => {
    const user = userEvent.setup()
    render(makeToday({ checkin: savedCheckin({ fatigue: 2, mood: 4 }) }))
    await user.click(await screen.findByRole('button', { name: 'Add more' }))
    const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
    expect(within(sheet).getByRole('button', { name: 'Fatigue 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(sheet).getByRole('button', { name: 'Mood 4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(sheet).getByRole('button', { name: 'Save check-in' })).toBeDisabled()
  })

  describe('bone tenderness that is still reported', () => {
    const activeFlag = {
      code: 'focal-bone-pain',
      message: 'Focal bone pain or point tenderness was reported.',
      rules: ['n-1'],
    }
    const withActiveFlag = (over: Partial<TodayView> = {}) => {
      const today = makeToday(over)
      return { ...today, readiness: { ...today.readiness, redFlags: [activeFlag] } }
    }

    test('is ticked from the active state until the runner unticks it', async () => {
      const user = userEvent.setup()
      const { api } = render(withActiveFlag(), { [CHECKIN_ROUTE]: () => ({}) })
      await user.click(await screen.findByRole('button', { name: "Something hurts, or I'm ill" }))
      const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
      expect(
        within(sheet).getByRole('checkbox', { name: 'Point tenderness on a bone' }),
      ).toBeChecked()
      expect(within(sheet).getByRole('button', { name: 'Save check-in' })).toBeDisabled()

      await user.click(within(sheet).getByRole('button', { name: 'Fatigue 4' }))
      await user.click(within(sheet).getByRole('button', { name: 'Save check-in' }))
      await waitFor(() => {
        expect(api.calls.some((call) => call.method === 'PUT')).toBe(true)
      })
      expect(api.calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
        fatigue: 4,
        painFocalBone: true,
      })
    })

    test('is stored as false only after the runner unticks it', async () => {
      const user = userEvent.setup()
      const { api } = render(withActiveFlag(), { [CHECKIN_ROUTE]: () => ({}) })
      await user.click(await screen.findByRole('button', { name: "Something hurts, or I'm ill" }))
      const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
      await user.click(within(sheet).getByRole('checkbox', { name: 'Point tenderness on a bone' }))
      await user.click(within(sheet).getByRole('button', { name: 'Save check-in' }))
      await waitFor(() => {
        expect(api.calls.some((call) => call.method === 'PUT')).toBe(true)
      })
      expect(api.calls.find((call) => call.method === 'PUT')?.body).toMatchObject({
        painFocalBone: false,
      })
    })

    test("today's own saved answer wins over the active state", async () => {
      const user = userEvent.setup()
      render(withActiveFlag({ checkin: savedCheckin({ fatigue: 3, painFocalBone: false }) }))
      await user.click(await screen.findByRole('button', { name: 'Add more' }))
      const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
      expect(
        within(sheet).getByRole('checkbox', { name: 'Point tenderness on a bone' }),
      ).not.toBeChecked()
    })

    test('the one-tap row leaves it out, so the server inherits the earlier report', async () => {
      const user = userEvent.setup()
      const { api } = render(withActiveFlag(), { [CHECKIN_ROUTE]: () => ({}) })
      await user.click(await screen.findByRole('radio', { name: 'Normal' }))
      await waitFor(() => {
        expect(api.calls.some((call) => call.method === 'PUT')).toBe(true)
      })
      expect(api.calls.find((call) => call.method === 'PUT')?.body).toEqual({ fatigue: 3 })
    })
  })

  test('a refusal keeps the entries and says what to do', async () => {
    const user = userEvent.setup()
    render(makeToday(), {
      [CHECKIN_ROUTE]: () => ({
        status: 400,
        body: { error: { code: 'validation', message: 'Use a real date.' } },
      }),
    })
    await user.click(await screen.findByRole('button', { name: "Something hurts, or I'm ill" }))
    const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
    await user.click(within(sheet).getByRole('button', { name: 'Mood 3' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save check-in' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'Check-in not saved. Use a real date. Try again.',
    )
    expect(within(sheet).getByRole('button', { name: 'Mood 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('a server error keeps the answer on the phone to send again', async () => {
    const user = userEvent.setup()
    render(makeToday(), {
      [CHECKIN_ROUTE]: () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Server error' } },
      }),
    })
    await user.click(await screen.findByRole('button', { name: "Something hurts, or I'm ill" }))
    const sheet = await screen.findByRole('dialog', { name: 'Check-in' })
    await user.click(within(sheet).getByRole('button', { name: 'Mood 3' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save check-in' }))
    expect(await screen.findByText('Check-in saved on this phone')).toBeInTheDocument()
    expect(getOutbox().getState().entries).toHaveLength(1)
  })
})

describe('Today: Done', () => {
  afterEach(() => {
    setOnline(true)
    window.localStorage.clear()
  })

  async function openDone(user: ReturnType<typeof userEvent.setup>) {
    const card = await screen.findByRole('article', { name: 'Easy run' })
    await user.click(within(card).getByRole('button', { name: 'Done' }))
    return screen.findByRole('dialog', { name: "Log today's run" })
  }

  test('opens the log with the planned minutes and distance filled in', async () => {
    const user = userEvent.setup()
    const { container } = render(withEasyRun())
    const sheet = await openDone(user)
    expect(
      within(sheet).getByText('Planned: 45 min, 5.00 mi. Change anything that differs.'),
    ).toBeVisible()
    expect(within(sheet).getByRole('textbox', { name: 'Duration' })).toHaveValue('45')
    expect(within(sheet).getByRole('textbox', { name: 'Distance (mi)' })).toHaveValue('5')
    expect(within(sheet).getByRole('button', { name: 'RPE 6' })).toBeVisible()
    expect(within(sheet).getByRole('button', { name: 'As expected' })).toBeVisible()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeEnabled()
    expectCleanCopy(container)
  })

  test('Save posts one run with the planned figures, exactly as planned', async () => {
    const user = userEvent.setup()
    const { api } = render(withEasyRun(), { 'POST /api/activities': () => ({}) })
    const sheet = await openDone(user)
    await user.click(within(sheet).getByRole('button', { name: 'RPE 4' }))
    await user.click(within(sheet).getByRole('button', { name: 'As expected' }))
    // A second tap while the first is on its way posts nothing more.
    await user.dblClick(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Run saved')).toBeInTheDocument()
    const posts = api.calls.filter((call) => call.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      url: '/api/activities',
      body: { date: TODAY, type: 'run', durationSec: 2700, distanceM: 8047, rpe: 4, feel: 0 },
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: "Log today's run" })).not.toBeInTheDocument()
    })
    // The button that opened the sheet is still there; focus lands on the title either way.
    expect(await screen.findByRole('heading', { level: 2, name: 'Easy run' })).toHaveFocus()
  })

  test('what the runner changes is what is posted', async () => {
    const user = userEvent.setup()
    const { api } = render(withEasyRun(), { 'POST /api/activities': () => ({}) })
    const sheet = await openDone(user)
    const duration = within(sheet).getByRole('textbox', { name: 'Duration' })
    await user.clear(duration)
    await user.type(duration, '0:50:30')
    const distance = within(sheet).getByRole('textbox', { name: 'Distance (mi)' })
    await user.clear(distance)
    await user.type(distance, '6')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(api.calls.some((call) => call.method === 'POST')).toBe(true)
    })
    expect(api.calls.find((call) => call.method === 'POST')?.body).toEqual({
      date: TODAY,
      type: 'run',
      durationSec: 3030,
      distanceM: 9656,
    })
  })

  test('a duration that is not a time says how to write one and posts nothing', async () => {
    const user = userEvent.setup()
    const { api } = render(withEasyRun())
    const sheet = await openDone(user)
    const duration = within(sheet).getByRole('textbox', { name: 'Duration' })
    await user.clear(duration)
    await user.type(duration, 'a while')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await within(sheet).findByText('Enter minutes like 45, or 0:45:00')).toBeVisible()
    expect(api.calls.filter((call) => call.method === 'POST')).toEqual([])
  })

  test('a refusal keeps the entries and says what to do', async () => {
    const user = userEvent.setup()
    render(withEasyRun(), {
      'POST /api/activities': () => ({
        status: 400,
        body: { error: { code: 'validation', message: 'That day is not open.' } },
      }),
    })
    const sheet = await openDone(user)
    await user.click(within(sheet).getByRole('button', { name: 'RPE 7' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'Not saved. That day is not open. Your entries are still here; try again.',
    )
    expect(within(sheet).getByRole('button', { name: 'RPE 7' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('with no connection Save is off, the sheet says why, and the entries stay as a draft', async () => {
    const user = userEvent.setup()
    setOnline(false)
    const { api } = render(withEasyRun())
    const sheet = await openDone(user)
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(
      within(sheet).getByText('Needs a connection. Your entries stay on this phone.'),
    ).toBeVisible()
    const duration = within(sheet).getByRole('textbox', { name: 'Duration' })
    await user.clear(duration)
    await user.type(duration, '52')
    await user.click(within(sheet).getByRole('button', { name: 'RPE 5' }))
    expect(JSON.parse(window.localStorage.getItem('rl_done_draft_2026-03-18') ?? 'null')).toEqual({
      duration: '52',
      distance: '5',
      rpe: 5,
      feel: null,
    })
    await user.click(within(sheet).getByRole('button', { name: 'Close' }))

    // Opened again, with the connection back, the draft is there and Save works.
    setOnline(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    const again = await openDone(user)
    expect(within(again).getByRole('textbox', { name: 'Duration' })).toHaveValue('52')
    expect(within(again).getByRole('button', { name: 'RPE 5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      within(again).queryByText('Needs a connection. Your entries stay on this phone.'),
    ).not.toBeInTheDocument()
    expect(within(again).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(api.calls.filter((call) => call.method === 'POST')).toEqual([])
  })

  test('the draft is removed once the run is saved', async () => {
    const user = userEvent.setup()
    render(withEasyRun(), { 'POST /api/activities': () => ({}) })
    const sheet = await openDone(user)
    await user.click(within(sheet).getByRole('button', { name: 'RPE 3' }))
    expect(window.localStorage.getItem('rl_done_draft_2026-03-18')).not.toBeNull()
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await screen.findByText('Run saved')
    expect(window.localStorage.getItem('rl_done_draft_2026-03-18')).toBeNull()
  })

  test('a strength session is logged as a session, with no distance', async () => {
    const user = userEvent.setup()
    const session = makeSession({
      kind: 'strength',
      title: 'Strength',
      durationMin: 30,
      distanceM: null,
      gainM: null,
    })
    const { api } = render(
      makeToday({
        sessions: [{ session, advice: 'as-planned', reasons: [] }],
        coach: makeCoach({ hero: makeHero({ session, target: null }) }),
      }),
      { 'POST /api/activities': () => ({}) },
    )
    const card = await screen.findByRole('article', { name: 'Strength' })
    await user.click(within(card).getByRole('button', { name: 'Done' }))
    const sheet = await screen.findByRole('dialog', { name: "Log today's session" })
    expect(within(sheet).getByText('Planned: 30 min. Change anything that differs.')).toBeVisible()
    expect(within(sheet).queryByRole('textbox', { name: /^Distance/ })).not.toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Session saved')).toBeInTheDocument()
    expect(api.calls.find((call) => call.method === 'POST')?.body).toEqual({
      date: TODAY,
      type: 'strength',
      durationSec: 1800,
    })
  })

  test('an eased day logs the easy run the hero shows, not the planned session', async () => {
    const user = userEvent.setup()
    const planned = makeSession({ kind: 'threshold', title: 'Threshold', durationMin: 50 })
    const eased = makeSession({ kind: 'easy', title: 'Easy run', durationMin: 30, distanceM: 4828 })
    const { api } = render(
      makeToday({
        sessions: [{ session: planned, advice: 'downgrade-easy', reasons: [] }],
        coach: makeCoach({ hero: makeHero({ session: planned, advice: 'downgrade-easy', eased }) }),
      }),
      { 'POST /api/activities': () => ({}) },
    )
    const card = await screen.findByRole('article', { name: 'Easy run' })
    await user.click(within(card).getByRole('button', { name: 'Done' }))
    const sheet = await screen.findByRole('dialog', { name: "Log today's run" })
    expect(within(sheet).getByRole('textbox', { name: 'Duration' })).toHaveValue('30')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    await screen.findByText('Run saved')
    expect(api.calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      durationSec: 1800,
      distanceM: 4828,
    })
  })
})

describe('Today: Not today', () => {
  const HASH = '1'.repeat(64)

  /** The one row a skip of today's run writes. */
  function skipDiff() {
    return makeDiff([
      makeLine({
        externalId: 'x1',
        sessionId: 's1',
        date: TODAY,
        before: makeBrief({ date: TODAY, title: 'Easy run', durationMin: 45 }),
        after: makeBrief({ date: TODAY, title: 'Easy run', durationMin: 45 }),
        fields: ['status'],
      }),
    ])
  }

  /** A dry run and a commit of skipping the run, as the adjust route answers them. */
  function skipRoutes(): MockRoutes {
    return {
      'POST /api/plan/sessions/s1/adjust': (req) => {
        const body = req.body as { dryRun?: boolean }
        return {
          allowed: true,
          guards: [],
          diff: skipDiff(),
          session: makeSession({ status: 'skipped' }),
          revision:
            body.dryRun === true
              ? null
              : makeRevision({
                  id: 'r5',
                  reason: 'owner',
                  auto: false,
                  summary: 'Skipped Easy run on Wed 18 Mar.',
                  diff: skipDiff(),
                  undo: AVAILABLE,
                  seenAt: null,
                }),
          hash: HASH,
        }
      },
      'POST /api/plan/revisions/r5/seen': () => ({ status: 204, body: undefined }),
    }
  }

  test('skipping the session is checked, saved and puts focus on the title', async () => {
    const user = userEvent.setup()
    const { api } = render(withEasyRun(), skipRoutes())
    const card = await screen.findByRole('article', { name: 'Easy run' })
    await user.click(within(card).getByRole('button', { name: 'Not today' }))
    const sheet = await screen.findByRole('dialog', { name: 'Not today' })
    await user.click(within(sheet).getByRole('button', { name: 'Skip session' }))
    await within(sheet).findByText('What would change')
    await user.click(within(sheet).getByRole('button', { name: 'Apply change' }))
    expect(await screen.findByText('Skipped Easy run on Wed 18 Mar.')).toBeInTheDocument()
    const sent = api.calls.filter((call) => call.url === '/api/plan/sessions/s1/adjust')
    expect(sent.map((call) => call.body)).toEqual([
      { adjustment: { type: 'skip' }, dryRun: true },
      { adjustment: { type: 'skip' }, expectHash: HASH },
    ])
    expect(api.calls.some((call) => call.method === 'PUT')).toBe(false)
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Not today' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { level: 2, name: 'Easy run' })).toHaveFocus()
  })

  test('asking to skip checks the change first, and dropping it puts focus on the section', async () => {
    const user = userEvent.setup()
    const { api } = render(withEasyRun(), skipRoutes())
    const card = await screen.findByRole('article', { name: 'Easy run' })
    await user.click(within(card).getByRole('button', { name: 'Not today' }))
    const sheet = await screen.findByRole('dialog', { name: 'Not today' })
    await user.click(within(sheet).getByRole('button', { name: 'Skip session' }))
    await within(sheet).findByText('What would change')
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(within(sheet).getByRole('heading', { name: 'Change this session' })).toHaveFocus()
    })
    expect(within(sheet).getByRole('button', { name: 'Skip session' })).toBeInTheDocument()
    expect(
      api.calls
        .filter((call) => call.url === '/api/plan/sessions/s1/adjust')
        .every((call) => (call.body as { dryRun?: boolean }).dryRun === true),
    ).toBe(true)
  })

  test('closing it without a change gives focus back to the button', async () => {
    const user = userEvent.setup()
    render(withEasyRun())
    const card = await screen.findByRole('article', { name: 'Easy run' })
    const button = within(card).getByRole('button', { name: 'Not today' })
    await user.click(button)
    const sheet = await screen.findByRole('dialog', { name: 'Not today' })
    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(button).toHaveFocus()
  })
})

describe('Today: How did it go? toast', () => {
  test('"Feedback saved" shows although the rated run leaves the card', async () => {
    const user = userEvent.setup()
    // After the save the server reports the run as rated, so the card drops it and unmounts.
    let saved = false
    const run = makeActivity({ id: 'r1', date: '2026-03-17', type: 'run' })
    const day = () => makeToday({ unrated: saved ? [] : [run] })
    render(day(), {
      'GET /api/today': () => day(),
      'PATCH /api/activities/r1/feedback': () => {
        saved = true
        return {}
      },
    })
    const card = await screen.findByRole('region', { name: 'How did it go?' })
    await user.click(within(card).getByRole('button', { name: 'RPE 6' }))
    await user.click(within(card).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Feedback saved')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'How did it go?' })).not.toBeInTheDocument()
    })
    expect(screen.getByText('Feedback saved')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------------------
// Rest windows on Today (design 9.6, task E5-8)
// ---------------------------------------------------------------------------------------------

/** An illness window from Monday 16 to Friday 20 March; Wednesday 18 March is inside it. */
function resting(over: Partial<DisruptionView> = {}): DisruptionView {
  return makeWindow({
    id: 'w1',
    startDate: '2026-03-16',
    endDate: '2026-03-20',
    runFrom: '2026-03-22',
    qualityFrom: '2026-03-25',
    phase: 'resting',
    ...over,
  })
}

/** The Today payload with the `disruption` slot as the server fills it. */
function withDisruption(slot: DisruptionSlot | null, over: Partial<TodayView> = {}): TodayView {
  const base = withEasyRun()
  return {
    ...base,
    coach: {
      ...base.coach,
      disruptions: slot?.window == null ? [] : [slot.window],
      slots: { ...base.coach.slots, disruption: slot },
    },
    ...over,
  }
}

/** The routes the "Not 100%" sheet reads besides the two of the first screen. */
function sheetRoutes(today: () => TodayView): MockRoutes {
  return {
    'GET /api/today': today,
    'GET /api/plan': () => makeV2Plan(),
    'GET /api/plan/disruptions': () => [],
  }
}

const writesOf = (calls: Array<{ method: string }>) => calls.filter((call) => call.method !== 'GET')

describe('Today: the disruption slot', () => {
  test('a window in effect fills it with the banner, first in the session group, within 64 px', async () => {
    const { container } = render(withDisruption({ window: resting(), offer: false }))
    const banner = await screen.findByRole('region', { name: 'Rest window' })
    const slot = banner.closest('[data-slot]')
    expect(slot).toHaveAttribute('data-slot', 'disruption')
    expect(slot).toHaveAttribute('data-budget-px', '64')
    // the top of the first column, over the readiness read
    expect(slot?.parentElement?.firstElementChild).toBe(slot)
    expect(within(banner).getByText('Resting for illness until Fri 20 Mar.')).toBeInTheDocument()
    expect(
      within(banner)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(["I'm better", 'Extend', 'Remove window'])
    expect(container.querySelectorAll('[data-slot="disruption"]')).toHaveLength(1)
    expectCleanCopy(banner)
  })

  test('a window that starts later fills it too, and says when it starts', async () => {
    render(
      withDisruption({
        window: resting({ phase: 'upcoming', startDate: '2026-03-23', endDate: '2026-03-25' }),
        offer: false,
      }),
    )
    const banner = await screen.findByRole('region', { name: 'Rest window' })
    expect(
      within(banner).getByText('A window starts on Mon 23 Mar and lasts until Wed 25 Mar.'),
    ).toBeInTheDocument()
  })

  test('with no window and no offer there is no slot, so it takes no height', async () => {
    const { container } = render(withDisruption(null))
    await screen.findByRole('article', { name: 'Easy run' })
    expect(container.querySelector('[data-slot="disruption"]')).toBeNull()
    expect(screen.queryByRole('region', { name: /Rest window/ })).not.toBeInTheDocument()
  })

  test('an offer asks once, creates nothing, and "Not now" takes it away', async () => {
    const user = userEvent.setup()
    const { api, container } = render(withDisruption({ window: null, offer: true }))
    const offer = await screen.findByRole('region', { name: 'Rest window offer' })
    expect(offer.closest('[data-slot]')).toHaveAttribute('data-slot', 'disruption')
    expect(offer.closest('[data-slot]')).toHaveAttribute('data-budget-px', '64')
    expect(within(offer).getByText('Set a rest window and a return plan?')).toBeInTheDocument()
    expect(
      within(offer)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Set one up', 'Not now'])
    expectCleanCopy(offer)
    // Showing it wrote nothing
    expect(writesOf(api.calls)).toEqual([])

    await user.click(within(offer).getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('region', { name: 'Rest window offer' })).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot="disruption"]')).toBeNull()
    expect(writesOf(api.calls)).toEqual([])
  })

  test('"Set one up" opens Not 100% dated from the server day, not the device clock', async () => {
    const user = userEvent.setup()
    const { api } = render(
      withDisruption({ window: null, offer: true }),
      sheetRoutes(() => withDisruption({ window: null, offer: true })),
    )
    await user.click(await screen.findByRole('button', { name: 'Set one up' }))
    // the phone says it is 2 April; the server's day is Wednesday 18 March
    vi.setSystemTime(new Date(2026, 3, 2, 9, 0, 0))
    const dialog = await screen.findByRole('dialog', { name: 'Not 100%' })
    await user.click(await within(dialog).findByRole('radio', { name: /Ill, above the neck/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(await within(dialog).findByLabelText('From')).toHaveValue('2026-03-18')
    expect(within(dialog).getByLabelText('From')).toHaveAttribute('min', '2026-02-18')
    // Asking and reading the options created nothing
    expect(writesOf(api.calls)).toEqual([])
  })

  test('the sheet of a window outlives the banner: removing it leaves the slot, not the preview', async () => {
    const user = userEvent.setup()
    let removed = false
    const view = () => withDisruption(removed ? null : { window: resting(), offer: false })
    const { container } = render(view(), {
      ...sheetRoutes(view),
      'POST /api/plan/preview': () =>
        makePreview({
          action: { type: 'disruption-remove', id: 'w1' },
          summary: 'Removed the window (illness) from Mon 16 Mar to Fri 20 Mar.',
          hash: 'f'.repeat(64),
        }),
      'DELETE /api/plan/disruptions/w1': () => {
        removed = true
        return {
          disruption: resting(),
          revision: makeRevision({
            id: 'r8',
            reason: 'disruption',
            auto: false,
            summary: 'Removed the window (illness) from Mon 16 Mar to Fri 20 Mar.',
            diff: makeDiff([], [makeWeekLine({ weekStart: '2026-03-16', runMinAfter: 280 })]),
            undo: AVAILABLE,
            seenAt: null,
            disruptionId: 'w1',
          }),
        }
      },
      'POST /api/plan/revisions/r8/seen': () => ({ status: 204, body: undefined }),
    })
    await user.click(await screen.findByRole('button', { name: 'Remove window' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this window' })
    await user.click(await within(dialog).findByRole('button', { name: 'Apply to my plan' }))
    await within(dialog).findByRole('heading', { name: 'Window removed' })
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Rest window' })).not.toBeInTheDocument()
    })
    // the slot has left the payload and takes no height; the sheet and its undo are still there
    expect(container.querySelector('[data-slot="disruption"]')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Remove this window' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Undo update' })).toBeInTheDocument()
  })
})

describe('Today: Not 100%', () => {
  async function openNotToday(user: ReturnType<typeof userEvent.setup>) {
    const card = await screen.findByRole('article', { name: 'Easy run' })
    await user.click(within(card).getByRole('button', { name: 'Not today' }))
    return screen.findByRole('dialog', { name: 'Not today' })
  }

  test('the Not today sheet hosts the entry above the move, swap, shorten and skip controls', async () => {
    const user = userEvent.setup()
    render(
      withEasyRun(),
      sheetRoutes(() => withEasyRun()),
    )
    const sheet = await openNotToday(user)
    const entry = within(sheet).getByRole('button', { name: 'Not 100%' })
    const section = within(sheet).getByRole('heading', { name: 'Change this session' })
    expect(entry.compareDocumentPosition(section)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      within(sheet).getByText('Tell the plan if you are ill, hurt, short on time or travelling.'),
    ).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Move to')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Skip session' })).toBeInTheDocument()
    expectCleanCopy(sheet)
  })

  test('Not 100% swaps the sheet for the window sheet, dated from the server day', async () => {
    const user = userEvent.setup()
    const { api } = render(
      withEasyRun(),
      sheetRoutes(() => withEasyRun()),
    )
    const sheet = await openNotToday(user)
    // the phone says it is 2 April; the server's day is Wednesday 18 March
    vi.setSystemTime(new Date(2026, 3, 2, 9, 0, 0))
    await user.click(within(sheet).getByRole('button', { name: 'Not 100%' }))

    const dialog = await screen.findByRole('dialog', { name: 'Not 100%' })
    expect(screen.queryByRole('dialog', { name: 'Not today' })).not.toBeInTheDocument()
    await user.click(await within(dialog).findByRole('radio', { name: /Ill, above the neck/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Next' }))
    expect(await within(dialog).findByLabelText('From')).toHaveValue('2026-03-18')
    expect(writesOf(api.calls)).toEqual([])

    // closing it puts focus on the title, as after the other sheets: the Not today button is gone
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { level: 2, name: 'Easy run' })).toHaveFocus()
  })
})
