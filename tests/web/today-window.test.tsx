import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  DisruptionSlot,
  DisruptionView,
  ReadinessSignal,
  TodayCoach,
  TodayView,
  TodayVerdict,
} from '../../shared/types.ts'
import { expectCleanCopy } from './helpers.tsx'
import { makePreview, makeWindow } from './plan-fixtures.ts'
import { makeCoach, makeHero, makeSession, makeToday } from './today-fixtures.ts'
import { renderToday as render, startToday } from './today-render.tsx'

// STATUS follow-up 19: a window is stated once (the band), the verdict names the day instead of
// "Ready as planned.", and every open window has its own line with its own buttons. The fixed clock is
// Wednesday 2026-03-18; the payloads are what the server sends (`tests/api/disruptions.test.ts`
// pins that it composes them so).

// Stands in for the drawer so the wiring is visible: which rules it was opened with.
vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, open }: { rules: string[]; open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Why">
        {`rules: ${rules.join(', ')}`}
      </div>
    ) : null,
}))

beforeEach(startToday)

afterEach(() => {
  vi.useRealTimers()
})

const WINDOW_LINE = 'Resting for illness until Fri 20 Mar.'
const ILLNESS_NOTE =
  'Illness was reported. Intensity is suspended; easy running resumes after one symptom-free day.'
const ILLNESS_SIGNAL = 'Illness was reported: rest until you have had one symptom-free day.'

/** An illness window from Monday 16 to Friday 20 March; Wednesday 18 March is inside it. */
function illness(over: Partial<DisruptionView> = {}): DisruptionView {
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

/** A niggle that caps the runs at 30 minutes, from Tuesday 17 to Saturday 21 March. */
function niggle(over: Partial<DisruptionView> = {}): DisruptionView {
  return makeWindow({
    id: 'w2',
    reason: 'niggle',
    mode: 'limited',
    maxRunMin: 30,
    area: 'left calf',
    pain: 3,
    startDate: '2026-03-17',
    endDate: '2026-03-21',
    runFrom: '2026-03-17',
    qualityFrom: '2026-03-24',
    phase: 'limited',
    ...over,
  })
}

const REST_DAY = makeSession({
  kind: 'rest',
  title: 'Rest',
  durationMin: 0,
  distanceM: null,
  gainM: null,
  rules: ['J9', 'n-3', 'g-6'],
})

const CHECKIN_FEELING_NORMAL: ReadinessSignal = {
  code: 'checkin',
  noted: false,
  template: 'today.signal.checkin-normal',
  slots: {},
}

/**
 * Today inside the windows, as the server composes it: the windows on the slot and on the payload,
 * the verdict that names the day, and no illness note or signal while the band states the window.
 */
function insideWindows(
  windows: DisruptionView[],
  verdict: TodayVerdict = {
    code: 'window-rest',
    template: 'today.verdict.window-rest',
    slots: {},
  },
  over: Partial<TodayCoach> = {},
): TodayView {
  const slot: DisruptionSlot = { windows, offer: false }
  const base = makeCoach()
  return makeToday({
    sessions: [{ session: REST_DAY, advice: 'as-planned', reasons: [] }],
    coach: makeCoach({
      verdict,
      signals: [CHECKIN_FEELING_NORMAL],
      hero: makeHero({ session: REST_DAY, target: null }),
      disruptions: windows,
      slots: { ...base.slots, disruption: slot },
      ...over,
    }),
  })
}

describe('Today inside an illness window: the window is stated once', () => {
  test('one element states the window, and the verdict names the day', async () => {
    const { container } = render(insideWindows([illness()]))
    const band = await screen.findByRole('region', { name: 'Rest window' })
    expect(within(band).getByText(WINDOW_LINE)).toBeInTheDocument()

    // the verdict says what the day is, never "Ready as planned."
    const read = screen.getByRole('region', { name: 'Readiness' })
    expect(within(read).getByRole('status')).toHaveTextContent('A rest day of the window.')
    expect(screen.queryByText(/Ready as planned/)).not.toBeInTheDocument()

    // nothing else says the illness a second or a third time
    expect(screen.queryByRole('region', { name: 'Health notes' })).not.toBeInTheDocument()
    expect(screen.queryByText(ILLNESS_NOTE)).not.toBeInTheDocument()
    expect(screen.queryByText(ILLNESS_SIGNAL)).not.toBeInTheDocument()
    expect(
      screen.getAllByText(/Resting for illness|Illness was reported|Returning from illness/),
    ).toHaveLength(1)
    // the readings that are not the window stay
    expect(within(read).getByText('Check-in: feeling normal.')).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test.each([
    ['limited', 'window-limited', 'A day of limited running.'],
    ['easy-only', 'window-easy', 'Easy running only today.'],
    ['returning', 'window-return', 'A day of the return week.'],
  ] as const)(
    'in the %s phase the verdict names that day, and "Ready as planned." is not said',
    async (phase, code, sentence) => {
      render(
        insideWindows([illness({ phase })], {
          code,
          template: `today.verdict.${code}`,
          slots: {},
        }),
      )
      await screen.findByRole('region', { name: 'Rest window' })
      const read = screen.getByRole('region', { name: 'Readiness' })
      expect(within(read).getByRole('status')).toHaveTextContent(sentence)
      expect(screen.queryByText(/Ready as planned/)).not.toBeInTheDocument()
    },
  )

  test('a check-in that reports illness with no window keeps its note, its signal and the offer', async () => {
    const view = makeToday({
      readiness: {
        ...makeToday().readiness,
        redFlags: [{ code: 'illness', message: ILLNESS_NOTE, rules: ['n-3'] }],
      },
      coach: makeCoach({
        verdict: { code: 'rest', template: 'today.verdict.rest', slots: {} },
        signals: [
          {
            code: 'illness',
            noted: true,
            template: 'today.signal.illness-rest',
            slots: { free: 'one symptom-free day' },
          },
        ],
        slots: { ...makeCoach().slots, disruption: { windows: [], offer: true } },
      }),
    })
    render(view)
    expect(await screen.findByText(ILLNESS_NOTE)).toBeInTheDocument()
    expect(screen.getByText(ILLNESS_SIGNAL)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Rest window offer' })).toBeInTheDocument()
  })
})

describe('Today: every window open today has its own line', () => {
  test('an illness and an injury window on the same day show two lines with their own buttons', async () => {
    const { container } = render(insideWindows([illness(), niggle()]))
    const bands = await screen.findAllByRole('region', { name: 'Rest window' })
    expect(bands).toHaveLength(2)

    expect(within(bands[0]!).getByText(WINDOW_LINE)).toBeInTheDocument()
    expect(
      within(bands[0]!)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(["I'm better", 'Extend', 'Remove window'])

    expect(
      within(bands[1]!).getByText('Niggle: runs up to 30 min until Sat 21 Mar.'),
    ).toBeInTheDocument()
    expect(
      within(bands[1]!)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(["I'm better", 'Extend', 'Remove window'])
    // one slot holds both, and the sentence of one is not in the other
    expect(bands[0]!.closest('[data-slot]')).toBe(bands[1]!.closest('[data-slot]'))
    expect(container.querySelectorAll('[data-slot="disruption"]')).toHaveLength(1)
    expect(within(bands[0]!).queryByText(/Niggle/)).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test("a button acts on its own line's window", async () => {
    const user = userEvent.setup()
    const { api } = render(insideWindows([illness(), niggle()]), {
      'POST /api/plan/preview': () => makePreview(),
    })
    const bands = await screen.findAllByRole('region', { name: 'Rest window' })
    await user.click(within(bands[1]!).getByRole('button', { name: 'Extend' }))
    await screen.findByRole('dialog', { name: 'Extend this window' })
    const preview = api.calls.find((call) => call.url === '/api/plan/preview')
    expect(preview?.body).toMatchObject({ type: 'disruption-update', id: 'w2' })
  })

  test('with none open, the next window ahead has the line alone', async () => {
    render(insideWindows([illness({ phase: 'upcoming', startDate: '2026-03-23' })]))
    const bands = await screen.findAllByRole('region', { name: 'Rest window' })
    expect(bands).toHaveLength(1)
  })

  test('the buttons are 44 px touch targets that fit the row at 360 px', () => {
    // jsdom lays nothing out, so the stylesheet is read: the box of a button and its room.
    const css = readFileSync(
      join(process.cwd(), 'web/components/disruption/disruption.module.css'),
      'utf8',
    )
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`)
      return start < 0 ? '' : css.slice(start, css.indexOf('}', start))
    }
    const action = rule('.compact .compactAction')
    expect(action).toMatch(/min-height:\s*2\.75rem/)
    // 8 px each side: "I'm better", "Extend" and "Remove window" in the 328 px column
    expect(action).toMatch(/padding:\s*0\s+var\(--space-2\)/)
    // the row takes 28 px of the 64 px budget: 44 px less 6 px up and 10 px down
    expect(rule('.compact .bannerActions')).toMatch(/margin:\s*-0\.375rem\s+0\s+-0\.625rem/)
  })
})
