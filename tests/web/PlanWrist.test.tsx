import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ResolvedTargets } from '../../shared/engine/types.ts'
import type { Goal, PlanWithSessions, WeekRow, WristStatus } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { PlanPage } from '../../web/pages/PlanPage.tsx'
import {
  activityPage,
  expectCleanCopy,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import { makeRevision, makeSession, makeV2Plan, settings } from './plan-fixtures.ts'
import {
  makeWorkoutView,
  makeWristItem,
  makeWristStatus,
  refocus,
  sendingOn,
  workoutRoutes,
} from './wrist-fixtures.ts'

// The Plan page and the session sheet with the watch in them (design 6.7, task E1-7): the strip,
// the chips of the next 14 days, the week's zip, the sheet's section and its targets.

vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: () => null,
}))

const goal = {
  id: 'g1',
  name: 'Spring marathon',
  status: 'target',
  isActive: true,
  targetDate: '2027-03-07',
  distanceM: 42195,
} as Goal

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // a Wednesday: the week of 11 Jan is the current one, and opens to its days
  vi.setSystemTime(new Date('2027-01-13T12:00:00'))
  setOnline(true)
})

afterEach(() => {
  vi.useRealTimers()
  setOnline(true)
})

function routes(plan: PlanWithSessions, wrist: WristStatus, extra: MockRoutes = {}): MockRoutes {
  return {
    'GET /api/plan': () => plan,
    'GET /api/goals': () => [goal],
    'GET /api/settings': () => settings,
    'GET /api/weeks': () => [] as WeekRow[],
    'GET /api/plan/revisions': () => [makeRevision()],
    'GET /api/plan/disruptions': () => [],
    'GET /api/activities': () => activityPage([]),
    'GET /api/wrist/status': () => wrist,
    ...workoutRoutes(plan.sessions),
    ...extra,
  }
}

function renderPlan() {
  return renderWithProviders(
    <ToastProvider>
      <PlanPage />
    </ToastProvider>,
  )
}

describe('the strip on the Plan page', () => {
  test('counts the next 14 days by what they mean to the runner', async () => {
    const plan = makeV2Plan()
    mockApi(
      routes(
        plan,
        sendingOn([
          makeWristItem({ sessionId: 'b', externalId: 'ext-b', status: 'on-watch' }),
          makeWristItem({ sessionId: 'c', externalId: 'ext-c', status: 'sent' }),
          makeWristItem({ sessionId: 'd', externalId: 'ext-d', status: 'waiting' }),
          makeWristItem({ sessionId: 'e', externalId: 'ext-e', status: 'not-delivered' }),
          makeWristItem({ sessionId: 'f', externalId: 'ext-f', status: 'removed' }),
        ]),
      ),
    )
    renderPlan()
    const strip = await screen.findByRole('region', { name: 'Watch' })
    expect(
      await within(strip).findByText(
        'Watch: next 14 days. 2 on your watch or sent, 1 waiting, 1 not delivered.',
      ),
    ).toBeInTheDocument()
    expectCleanCopy(strip)
  })

  test('says a window with nothing to send', async () => {
    mockApi(routes(makeV2Plan(), sendingOn([])))
    renderPlan()
    expect(await screen.findByText('Watch: next 14 days. No runs to send.')).toBeInTheDocument()
  })

  test('offers "Send again" only while something is waiting or not delivered, and sends for all', async () => {
    const user = userEvent.setup()
    const status = sendingOn([makeWristItem({ sessionId: 'b', status: 'sent' })])
    const api = mockApi(
      routes(makeV2Plan(), status, { 'POST /api/wrist/publish': () => status.settings }),
    )
    renderPlan()
    const strip = await screen.findByRole('region', { name: 'Watch' })
    await within(strip).findByText('Watch: next 14 days. 1 on your watch or sent.')
    expect(within(strip).queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument()
    api.calls.length = 0

    // the same page, with a run that did not arrive
    status.items.push(
      makeWristItem({ sessionId: 'c', externalId: 'ext-c', status: 'not-delivered' }),
    )
    await refocus()
    await user.click(await within(strip).findByRole('button', { name: 'Send again' }))
    await waitFor(() => {
      expect(api.calls.filter((c) => c.method === 'POST')).toEqual([
        { method: 'POST', url: '/api/wrist/publish', body: {} },
      ])
    })
  })

  test('links this week as a zip of workout files', async () => {
    mockApi(routes(makeV2Plan(), sendingOn([])))
    renderPlan()
    const strip = await screen.findByRole('region', { name: 'Watch' })
    const link = within(strip).getByRole('link', { name: 'Download this week as .zip' })
    expect(link).toHaveAttribute('href', '/api/plan/weeks/2027-01-11/workouts.zip')
    expect(link).toHaveAttribute('download')
  })

  test('says why there is no zip when this week has no run left', async () => {
    const plan = makeV2Plan()
    plan.sessions = plan.sessions.map((s) =>
      s.weekStart === '2027-01-11' ? { ...s, status: 'completed' as const } : s,
    )
    mockApi(routes(plan, sendingOn([])))
    renderPlan()
    const strip = await screen.findByRole('region', { name: 'Watch' })
    expect(
      within(strip).getByText('This week has no runs left to put on a watch.'),
    ).toBeInTheDocument()
    expect(within(strip).queryByRole('link', { name: /zip/ })).not.toBeInTheDocument()
  })

  test('says sending is off, and points to the files and to Integrations', async () => {
    mockApi(routes(makeV2Plan(), makeWristStatus()))
    renderPlan()
    const strip = await screen.findByRole('region', { name: 'Watch' })
    expect(
      await within(strip).findByText(
        'Sending to your watch is off. Download the workout file, or turn it on under Integrations.',
      ),
    ).toBeInTheDocument()
    expect(within(strip).getByRole('link', { name: 'Open Integrations' })).toHaveAttribute(
      'href',
      '/integrations',
    )
    expect(within(strip).getByRole('link', { name: 'Download this week as .zip' })).toBeVisible()
    expect(within(strip).queryByRole('button')).not.toBeInTheDocument()
  })

  test('renders nothing about the status offline, and the download stays', async () => {
    setOnline(false)
    const api = mockApi(routes(makeV2Plan(), sendingOn([makeWristItem({ sessionId: 'b' })])))
    renderPlan()
    const strip = await screen.findByRole('region', { name: 'Watch' })
    expect(within(strip).queryByText(/Watch: next/)).not.toBeInTheDocument()
    expect(within(strip).queryByText(/Sending to your watch is off/)).not.toBeInTheDocument()
    expect(within(strip).getByRole('link', { name: 'Download this week as .zip' })).toBeVisible()
    expect(api.calls.some((c) => c.url.startsWith('/api/wrist'))).toBe(false)
  })

  test('is not on a version-1 plan, which has no sessions to send', async () => {
    const plan = makeV2Plan()
    mockApi({
      ...routes(plan, makeWristStatus()),
      'GET /api/plan': () => ({ ...plan, generatorVersion: 1, sessions: [] }),
    })
    renderPlan()
    await screen.findByRole('table')
    expect(screen.queryByRole('region', { name: 'Watch' })).not.toBeInTheDocument()
  })
})

describe('the days of a week', () => {
  function days(week = '2027-01-11') {
    return document.querySelector<HTMLElement>(`tr[data-days-for="${week}"]`)!
  }

  test('carry a chip on each run in the window, and its sentence as the title', async () => {
    const plan = makeV2Plan()
    mockApi(
      routes(
        plan,
        sendingOn([
          makeWristItem({ sessionId: 'b', externalId: 'ext-b', status: 'on-watch' }),
          makeWristItem({ sessionId: 'c', externalId: 'ext-c', status: 'waiting' }),
        ]),
      ),
    )
    renderPlan()
    const row = await waitFor(() => {
      const found = days()
      expect(found).not.toBeNull()
      return found
    })
    const chip = await within(row).findByText('On your watch')
    expect(chip).toHaveAttribute(
      'title',
      'intervals.icu has this run and uploads it to Garmin Connect.',
    )
    expect(within(row).getByText('Waiting to send')).toHaveAttribute(
      'title',
      'The app sends this run by itself.',
    )
    // a chip is inside the session's own button, so it reads with the session
    expect(chip.closest('button')).toHaveTextContent('Steady long run')
    expectCleanCopy(row)
  })

  test('carry no chip while sending is off, whatever the old items say', async () => {
    const items = [makeWristItem({ sessionId: 'c', externalId: 'ext-c', status: 'sent' })]
    mockApi(routes(makeV2Plan(), { ...sendingOn(items), settings: makeWristStatus().settings }))
    renderPlan()
    await screen.findByRole('button', { name: /Hill strides/ })
    await screen.findByText(/Sending to your watch is off/)
    expect(document.querySelector('span[data-status]')).toBeNull()
  })

  test('carry no chip for a run the app took off the watch on purpose', async () => {
    mockApi(
      routes(
        makeV2Plan(),
        sendingOn([
          makeWristItem({ sessionId: 'b', externalId: 'ext-b', status: 'withdrawn' }),
          makeWristItem({ sessionId: 'c', externalId: 'ext-c', status: 'sent' }),
        ]),
      ),
    )
    renderPlan()
    expect(await screen.findByText('Sent to intervals.icu')).toBeInTheDocument()
    expect(document.querySelectorAll('span[data-status]')).toHaveLength(1)
  })

  test('carry no chip offline', async () => {
    setOnline(false)
    mockApi(routes(makeV2Plan(), sendingOn([makeWristItem({ sessionId: 'c', status: 'sent' })])))
    renderPlan()
    await screen.findByRole('button', { name: /Hill strides/ })
    expect(document.querySelector('span[data-status]')).toBeNull()
  })

  test("link the week's zip under a name that holds the week", async () => {
    mockApi(routes(makeV2Plan(), sendingOn([])))
    renderPlan()
    const row = await waitFor(() => {
      const found = days()
      expect(found).not.toBeNull()
      return found
    })
    const link = within(row).getByRole('link', { name: 'Download the week of 11 Jan as .zip' })
    expect(link).toHaveAttribute('href', '/api/plan/weeks/2027-01-11/workouts.zip')
  })

  test('say why a week has no zip', async () => {
    const plan = makeV2Plan()
    plan.sessions = plan.sessions.map((s) =>
      s.weekStart === '2027-01-11' ? { ...s, kind: 'strength' as const } : s,
    )
    mockApi(routes(plan, sendingOn([])))
    renderPlan()
    const row = await waitFor(() => {
      const found = days()
      expect(found).not.toBeNull()
      return found
    })
    expect(
      within(row).getByText('This week has no runs left to put on a watch.'),
    ).toBeInTheDocument()
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
  })

  test('open other weeks to their own zip', async () => {
    const user = userEvent.setup()
    mockApi(routes(makeV2Plan(), sendingOn([])))
    renderPlan()
    await screen.findByRole('table')
    await user.click(await screen.findByRole('button', { name: 'Days for week of 4 Jan' }))
    const row = days('2027-01-04')
    expect(
      within(row).getByRole('link', { name: 'Download the week of 4 Jan as .zip' }),
    ).toHaveAttribute('href', '/api/plan/weeks/2027-01-04/workouts.zip')
  })
})

describe('the session sheet', () => {
  const stored = makeSession({
    id: 'c',
    weekStart: '2027-01-11',
    date: '2027-01-14',
    kind: 'easy',
    title: 'Hill strides',
  })

  /** Targets as the server resolves them from the runner's zones today (not the stored ones). */
  const resolved: ResolvedTargets = {
    zone: 'z1',
    mode: 'hr-ceiling',
    hrCeiling: 142,
    hrRange: null,
    paceSecPerKm: [560, 520],
    rpe: [3, 4],
    hot: false,
    hotNote: null,
    zonesNote:
      'Heart rate and pace use your zones as they are now, which changed after this session was planned.',
    source: 'zones',
  }

  function planWith(session = stored) {
    return makeV2Plan({
      sessions: [makeSession({ id: 'b', weekStart: '2027-01-11', date: '2027-01-12' }), session],
    })
  }

  async function openSheet(extra: MockRoutes = {}, wrist = makeWristStatus()) {
    const user = userEvent.setup()
    const plan = planWith()
    const api = mockApi(routes(plan, wrist, extra))
    renderPlan()
    await user.click(await screen.findByRole('button', { name: /Hill strides/ }))
    return { user, api, dialog: await screen.findByRole('dialog', { name: 'Hill strides' }) }
  }

  test('shows the targets the server resolved: "under 142 bpm", not the stored band', async () => {
    const { dialog, api } = await openSheet({
      'GET /api/plan/sessions/c/workout': () => ({ ...makeWorkoutView(stored), targets: resolved }),
    })
    expect(await within(dialog).findByText('under 142 bpm')).toBeInTheDocument()
    expect(within(dialog).getByText('Heart rate')).toBeInTheDocument()
    expect(within(dialog).getByText('3 to 4 out of 10')).toBeInTheDocument()
    expect(within(dialog).getByText(/which changed after this session was planned/)).toBeVisible()
    // the stored band (158 to 168 bpm) is older than the zones and is not shown
    expect(within(dialog).queryByText('158 to 168 bpm')).not.toBeInTheDocument()
    expect(api.calls.some((c) => c.url === '/api/plan/sessions/c/workout')).toBe(true)
    expectCleanCopy(dialog)
  })

  test('shows the stored targets only when the resolved ones cannot be read', async () => {
    const { dialog } = await openSheet({
      'GET /api/plan/sessions/c/workout': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Down.' } },
      }),
    })
    expect(await within(dialog).findByText('158 to 168 bpm')).toBeInTheDocument()
  })

  test('holds the targets back until they are read, so no old figure flashes first', async () => {
    const { dialog } = await openSheet({
      'GET /api/plan/sessions/c/workout': () => ({ ...makeWorkoutView(stored), targets: resolved }),
    })
    // the prescription (time, zone) is there from the first paint; the figures follow the read
    expect(within(dialog).getByText('Zone')).toBeInTheDocument()
    expect(await within(dialog).findByText('under 142 bpm')).toBeInTheDocument()
  })

  test('has an "On your watch" section with the state of the run and its file', async () => {
    const { dialog } = await openSheet(
      {},
      sendingOn([makeWristItem({ sessionId: 'c', externalId: 'ext-c', status: 'on-watch' })]),
    )
    const section = within(dialog).getByRole('region', { name: 'On your watch' })
    expect(
      await within(section).findByText(
        'intervals.icu has this run and uploads it to Garmin Connect.',
      ),
    ).toBeVisible()
    expect(
      within(section).getByRole('link', { name: 'Download the workout file' }),
    ).toHaveAttribute('href', '/api/plan/sessions/c/workout.fit')
  })

  test('says sending is off in the section too', async () => {
    const { dialog } = await openSheet()
    const section = within(dialog).getByRole('region', { name: 'On your watch' })
    expect(
      await within(section).findByText(
        'Sending to your watch is off. Download the workout file, or turn it on under Integrations.',
      ),
    ).toBeInTheDocument()
  })

  test('says an eased run is the easy version on the watch, and keeps the plan', async () => {
    const { dialog } = await openSheet({
      'GET /api/plan/sessions/c/workout': () => ({ ...makeWorkoutView(stored), eased: true }),
    })
    expect(
      await within(dialog).findByText(
        "Today's readiness eased this session. The watch has the easy version; this page keeps the plan.",
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('55 min')).toBeVisible()
  })
})
