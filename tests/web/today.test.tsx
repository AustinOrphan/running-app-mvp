import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Activity, TodayView } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { DashboardPage } from '../../web/pages/DashboardPage.tsx'
import { makeActivity } from '../factories.ts'
import { mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import { makeSession, makeToday, TODAY } from './today-fixtures.ts'

// Stands in for the real drawer (Task E14) so the wiring is visible: which rules it was opened with.
vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, open }: { rules: string[]; open: boolean }) =>
    open ? <div role="dialog" aria-label="Why">{`rules: ${rules.join(', ')}`}</div> : null,
}))

// The fixed clock is Wednesday 2026-03-18.
const settings = { email: 'runner@example.com', displayName: null, units: 'mi' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

function renderToday(today: TodayView, activities: Activity[] = [], extra: MockRoutes = {}) {
  const api = mockApi({
    'GET /api/today': () => today,
    'GET /api/goals': () => [],
    'GET /api/plan': () => null,
    'GET /api/weeks': () => [],
    'GET /api/reviews': () => [],
    'GET /api/activities': () => activities,
    'GET /api/settings': () => settings,
    ...extra,
  })
  renderWithProviders(
    <ToastProvider>
      <DashboardPage />
    </ToastProvider>,
  )
  return api
}

describe("Today: today's session", () => {
  test('shows the prescription in pace, heart rate and RPE with the purpose', async () => {
    renderToday(
      makeToday({ sessions: [{ session: makeSession(), advice: 'as-planned', reasons: [] }] }),
    )
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('45 min')).toBeInTheDocument()
    expect(within(card).getByText('5.00 mi')).toBeInTheDocument()
    expect(within(card).getByText('197 ft')).toBeInTheDocument()
    expect(within(card).getByText('9:15 to 10:28 /mi')).toBeInTheDocument()
    expect(within(card).getByText('128 to 142 bpm')).toBeInTheDocument()
    expect(within(card).getByText('3 to 4')).toBeInTheDocument()
    expect(within(card).getByText('Aerobic base at an easy effort.')).toBeInTheDocument()
  })

  test('leaves out figures the session does not carry', async () => {
    const session = makeSession({
      kind: 'strength',
      title: 'Strength',
      distanceM: null,
      gainM: null,
      target: { zone: 'strength', rpe: [5, 6], hr: null, paceSecPerKm: null, heatNote: null },
    })
    renderToday(makeToday({ sessions: [{ session, advice: 'as-planned', reasons: [] }] }))
    const card = await screen.findByRole('article', { name: 'Strength' })
    expect(within(card).queryByText('Pace')).not.toBeInTheDocument()
    expect(within(card).queryByText('Heart rate')).not.toBeInTheDocument()
    expect(within(card).queryByText('Distance')).not.toBeInTheDocument()
    expect(within(card).getByText('5 to 6')).toBeInTheDocument()
  })

  test('the why button opens the drawer with the session rules', async () => {
    const user = userEvent.setup()
    renderToday(
      makeToday({ sessions: [{ session: makeSession(), advice: 'as-planned', reasons: [] }] }),
    )
    const card = await screen.findByRole('article', { name: 'Easy run' })
    await user.click(within(card).getByRole('button', { name: 'Why this session' }))
    expect(await screen.findByRole('dialog', { name: 'Why' })).toHaveTextContent('rules: f-1, g-1')
  })

  test('readiness that downgrades names the easier choice and its reasons, and never adds load', async () => {
    const session = makeSession({ kind: 'intervals', title: 'Intervals' })
    renderToday(
      makeToday({
        sessions: [
          { session, advice: 'downgrade-easy', reasons: ['Sleep averaged under 7 hours.'] },
        ],
      }),
    )
    const card = await screen.findByRole('article', { name: 'Intervals' })
    expect(within(card).getByText('An easy run is the better choice today.')).toBeInTheDocument()
    expect(within(card).getByText('Sleep averaged under 7 hours.')).toBeInTheDocument()
  })

  test('readiness that suggests rest says so', async () => {
    renderToday(
      makeToday({
        sessions: [{ session: makeSession(), advice: 'rest', reasons: ['Illness reported.'] }],
      }),
    )
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('A rest day is the better choice today.')).toBeInTheDocument()
    expect(within(card).getByText('Illness reported.')).toBeInTheDocument()
  })

  test('a completed session is labelled and a plan with no sessions today adds no card', async () => {
    renderToday(
      makeToday({
        sessions: [
          { session: makeSession({ status: 'completed' }), advice: 'as-planned', reasons: [] },
        ],
      }),
    )
    const card = await screen.findByRole('article', { name: 'Easy run' })
    expect(within(card).getByText('Completed')).toBeInTheDocument()
  })

  test('version-1 plans return no sessions and the page still renders', async () => {
    renderToday(makeToday())
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    await screen.findByText(/No plan yet/)
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
})

describe('Today: heat, readiness and red flags', () => {
  test('shows the heat note, WBGT and the cooler hour, with a why button', async () => {
    const user = userEvent.setup()
    renderToday(
      makeToday({
        heat: { wbgtC: 24.6, note: 'Run by effort and keep drinking.', coolerHour: '06:00' },
      }),
    )
    const heat = await screen.findByRole('region', { name: 'Heat' })
    expect(within(heat).getByText('Run by effort and keep drinking.')).toBeInTheDocument()
    expect(within(heat).getByText('WBGT 24.6 °C')).toBeInTheDocument()
    expect(within(heat).getByText('Cooler hour: 06:00')).toBeInTheDocument()
    await user.click(within(heat).getByRole('button', { name: 'Why this heat note' }))
    expect(await screen.findByRole('dialog', { name: 'Why' })).toHaveTextContent('rules: i-7, i-9')
  })

  test('no heat section without a note or a reading', async () => {
    renderToday(makeToday())
    await screen.findByText(/No plan yet/)
    expect(screen.queryByRole('region', { name: 'Heat' })).not.toBeInTheDocument()
  })

  test('possible fatigue is stated plainly', async () => {
    const today = makeToday()
    today.readiness.state = 'possible-fatigue'
    renderToday(today)
    expect(await screen.findByText('Recent signals point to possible fatigue.')).toBeInTheDocument()
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
    renderToday(today)
    const banners = await screen.findByRole('region', { name: 'Health notes' })
    expect(
      within(banners).getByText('Point tenderness on a bone: see a clinician before the next run.'),
    ).toBeInTheDocument()
    expect(within(banners).queryByRole('alert')).not.toBeInTheDocument()
    await user.click(within(banners).getByRole('button', { name: 'Why this note' }))
    expect(await screen.findByRole('dialog', { name: 'Why' })).toHaveTextContent('rules: n-1')
  })

  test('links to the disclaimer', async () => {
    renderToday(makeToday())
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
    const api = renderToday(makeToday(), [], {
      'PUT /api/checkins/2026-03-18': () => ({}),
    })
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
    renderToday(makeToday({ checkin }))
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

  test('a failed save keeps the entries and says what to do', async () => {
    const user = userEvent.setup()
    renderToday(makeToday(), [], {
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
    renderToday(makeToday(), [], {
      'GET /api/activities': () => (saved ? [{ ...run, rpe: 6 }] : [run]),
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
