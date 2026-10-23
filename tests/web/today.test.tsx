import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TodayView } from '../../shared/types.ts'
import { makeActivity } from '../factories.ts'
import { explainOf, expectCleanCopy } from './helpers.tsx'
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
    expect(within(card).queryByRole('link', { name: 'Done' })).not.toBeInTheDocument()
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

describe('Today: check-in', () => {
  test('saves the chosen answers for today', async () => {
    const user = userEvent.setup()
    const { api } = render(makeToday(), { 'PUT /api/checkins/2026-03-18': () => ({}) })
    const card = await screen.findByRole('region', { name: 'Check-in' })
    expect(within(card).getByRole('button', { name: 'Save check-in' })).toBeDisabled()
    await user.click(within(card).getByRole('button', { name: 'Fatigue 4' }))
    await user.click(within(card).getByRole('button', { name: 'Sleep quality 2' }))
    await user.click(within(card).getByRole('checkbox', { name: 'Feeling ill' }))
    await user.click(within(card).getByRole('button', { name: 'Pain today 5' }))
    await user.type(within(card).getByRole('textbox', { name: 'Pain area' }), 'left shin')
    await user.click(within(card).getByRole('checkbox', { name: 'Point tenderness on a bone' }))
    await user.click(within(card).getByRole('button', { name: 'Save check-in' }))
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PUT')).toBe(true)
    })
    expect(api.calls.find((c) => c.method === 'PUT')?.body).toEqual({
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
  })

  test('starts from the saved check-in', async () => {
    const checkin = {
      date: TODAY,
      fatigue: 2,
      soreness: null,
      sleepQuality: null,
      mood: 4,
      stress: null,
      illness: false,
      painScore: null,
      painArea: null,
      painFocalBone: false,
    }
    render(makeToday({ checkin }))
    const card = await screen.findByRole('region', { name: 'Check-in' })
    expect(within(card).getByRole('button', { name: 'Fatigue 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(card).getByRole('button', { name: 'Mood 4' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(card).getByRole('button', { name: 'Save check-in' })).toBeDisabled()
  })

  describe('bone tenderness that is still reported', () => {
    const activeFlag = {
      code: 'focal-bone-pain',
      message: 'Focal bone pain or point tenderness was reported.',
      rules: ['n-1'],
    }
    const withActiveFlag = () => {
      const today = makeToday()
      return { ...today, readiness: { ...today.readiness, redFlags: [activeFlag] } }
    }

    test('is ticked from the active state until the runner unticks it', async () => {
      const user = userEvent.setup()
      const { api } = render(withActiveFlag(), { 'PUT /api/checkins/2026-03-18': () => ({}) })
      const card = await screen.findByRole('region', { name: 'Check-in' })
      const box = within(card).getByRole('checkbox', { name: 'Point tenderness on a bone' })
      expect(box).toBeChecked()
      expect(within(card).getByRole('button', { name: 'Save check-in' })).toBeDisabled()

      await user.click(within(card).getByRole('button', { name: 'Fatigue 4' }))
      await user.click(within(card).getByRole('button', { name: 'Save check-in' }))
      await waitFor(() => {
        expect(api.calls.some((c) => c.method === 'PUT')).toBe(true)
      })
      expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
        fatigue: 4,
        painFocalBone: true,
      })
    })

    test('is stored as false only after the runner unticks it', async () => {
      const user = userEvent.setup()
      const { api } = render(withActiveFlag(), { 'PUT /api/checkins/2026-03-18': () => ({}) })
      const card = await screen.findByRole('region', { name: 'Check-in' })
      await user.click(within(card).getByRole('checkbox', { name: 'Point tenderness on a bone' }))
      await user.click(within(card).getByRole('button', { name: 'Save check-in' }))
      await waitFor(() => {
        expect(api.calls.some((c) => c.method === 'PUT')).toBe(true)
      })
      expect(api.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
        painFocalBone: false,
      })
    })

    test("today's own saved answer wins over the active state", async () => {
      const checkin = {
        date: TODAY,
        fatigue: 3,
        soreness: null,
        sleepQuality: null,
        mood: null,
        stress: null,
        illness: false,
        painScore: null,
        painArea: null,
        painFocalBone: false,
      }
      render({ ...withActiveFlag(), checkin })
      const card = await screen.findByRole('region', { name: 'Check-in' })
      expect(
        within(card).getByRole('checkbox', { name: 'Point tenderness on a bone' }),
      ).not.toBeChecked()
    })
  })

  test('a failed save keeps the entries and says what to do', async () => {
    const user = userEvent.setup()
    render(makeToday(), {
      'PUT /api/checkins/2026-03-18': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Server error' } },
      }),
    })
    const card = await screen.findByRole('region', { name: 'Check-in' })
    await user.click(within(card).getByRole('button', { name: 'Mood 3' }))
    await user.click(within(card).getByRole('button', { name: 'Save check-in' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent(/Check-in not saved/)
    expect(within(card).getByRole('button', { name: 'Mood 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
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
