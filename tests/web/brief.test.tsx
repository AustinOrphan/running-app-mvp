import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BriefReplanCode } from '../../shared/engine/types.ts'
import type { BriefView, Units } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { BriefPage } from '../../web/pages/BriefPage.tsx'
import {
  explainOf,
  expectCleanCopy,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import { makeFacts, makeLater, makeUpdate, makeView, WEEK } from './brief-fixtures.ts'
import { makeRevision } from './plan-fixtures.ts'

// Wednesday 13 Jan 2027, noon: the brief of Monday 11 Jan is the current week's.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-13T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

// Stands in for the real drawer so the wiring is visible: which rules and subject it opened with.
vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, explain, open }: { rules: string[]; explain?: unknown; open: boolean }) =>
    open ? (
      <div role="dialog" aria-label="Why" data-explain={JSON.stringify(explain ?? null)}>
        {`rules: ${rules.join(', ')}`}
      </div>
    ) : null,
}))

const settings = (units: Units = 'km') => ({
  email: 'runner@example.com',
  displayName: null,
  units,
})

function renderBrief(route: string, brief: () => unknown, extra: MockRoutes = {}, units?: Units) {
  const api = mockApi({
    'GET /api/settings': () => settings(units),
    'GET /api/brief': brief,
    ...extra,
  })
  const view = renderWithProviders(
    <ToastProvider>
      <Routes>
        <Route path="/brief" element={<BriefPage />} />
        <Route path="/brief/:weekStart" element={<BriefPage />} />
      </Routes>
    </ToastProvider>,
    { route },
  )
  return { api, ...view }
}

const served = (brief: BriefView | null) => () => ({ brief })
const SEEN = { 'POST /api/briefs/2027-01-11/seen': () => ({ status: 204, body: undefined }) }

describe('Brief page: the states', () => {
  test('loading says so in the exact words, as a status and not an alert', () => {
    const { container } = renderBrief('/brief', served(makeView()), SEEN)
    expect(screen.getByRole('heading', { level: 1, name: 'Weekly brief' })).toBeInTheDocument()
    expect(screen.getByText('Loading the brief.')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('a failed request is the one alert, with the exact words', async () => {
    const { container } = renderBrief('/brief', () => ({
      status: 500,
      body: { error: { code: 'internal', message: 'Something broke.' } },
    }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The brief could not be loaded. Reload the page to try again.')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expectCleanCopy(container)
  })

  test('no plan: this week has no brief, and it says why without an alert', async () => {
    const { container } = renderBrief('/brief', served(null))
    expect(
      await screen.findByText(
        'There is no plan yet, so there is no brief. A brief arrives each Monday once a plan is active.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('the current week by its date reads as no plan too', async () => {
    renderBrief(`/brief/${WEEK}`, served(null))
    expect(
      await screen.findByText(/^There is no plan yet, so there is no brief\./),
    ).toBeInTheDocument()
  })

  test('a week that has not begun is not ready yet', async () => {
    const { container } = renderBrief('/brief/2027-01-18', served(null))
    expect(
      await screen.findByText('The brief for the week of 18 Jan is not ready yet.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('an earlier week without a brief says there is none', async () => {
    const { container } = renderBrief('/brief/2026-12-28', served(null))
    expect(await screen.findByText('There is no brief for the week of 28 Dec.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('a week that is not a date asks the server nothing', () => {
    const { api } = renderBrief('/brief/not-a-date', served(null))
    expect(screen.getByText('There is no brief for that week.')).toBeInTheDocument()
    expect(api.calls.filter((call) => call.url.startsWith('/api/brief'))).toEqual([])
  })

  test('a week asks for that week', async () => {
    const { api } = renderBrief('/brief/2026-12-28', served(null))
    await screen.findByText(/^There is no brief for the week of/)
    expect(api.calls.map((call) => call.url)).toContain('/api/brief?weekStart=2026-12-28')
  })

  test('a provisional brief says the update has not run, in the exact words', async () => {
    const { container } = renderBrief(
      '/brief',
      served(
        makeView({
          provisional: true,
          seen: true,
          revision: null,
          since: [],
          facts: makeFacts({ changes: null, decision: null }),
        }),
      ),
    )
    expect(
      await screen.findByText("The weekly update has not run yet. This brief reads today's plan."),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo update' })).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test.each<[BriefReplanCode, string]>([
    [
      'goal-passed',
      'The plan was not updated this week: the goal date has passed. Move the date or choose another goal.',
    ],
    [
      'checklist',
      'The plan was not updated this week: the new plan did not meet the plan checks, so the current plan stays.',
    ],
    ['no-plan', 'The plan was not updated this week: there is no active plan.'],
    ['not-run', 'The plan was not updated this week: the weekly update did not run.'],
    [
      'error',
      'The plan was not updated this week: the update could not finish, so the current plan stays.',
    ],
  ])('a replan note (%s) is a plain sentence, not an alert', async (replan, sentence) => {
    const { container } = renderBrief(
      '/brief',
      served(
        makeView({
          seen: true,
          revision: null,
          facts: makeFacts({ replan, changes: null, decision: null }),
        }),
      ),
    )
    expect(await screen.findByText(sentence)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('an update that changed nothing says so and shows no empty revision', async () => {
    const empty = makeUpdate({
      diff: {
        v: 1,
        sessions: [],
        weeks: [],
        holds: [],
        totals: makeUpdate().diff!.totals,
        empty: true,
      },
      causes: { sessions: {}, weeks: {} },
      undo: { available: false, reasons: [], undoneAt: null },
      seenAt: '2027-01-11T12:00:00.000Z',
    })
    renderBrief(
      '/brief',
      served(
        makeView({
          seen: true,
          revision: empty,
          facts: makeFacts({ changes: { count: 0, lines: [], runMinBefore: 0, runMinAfter: 0 } }),
        }),
      ),
    )
    expect(await screen.findByText('The plan did not change this week.')).toBeInTheDocument()
    expect(document.querySelector('[data-revision]')).toBeNull()
  })
})

describe('Brief page: a brief', () => {
  test('every section of the design, in order, with the headline above them', async () => {
    const { container } = renderBrief('/brief', served(makeView({ since: [makeLater()] })), SEEN)
    expect(await screen.findByText('Week of 11 Jan')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Weekly brief' })).toBeInTheDocument()
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      'What changed and why',
      'What the plan noticed',
      'Next key session',
      'Since this brief',
    ])
    // The headline: last week as a figure and the decision, then the race.
    expect(screen.getByText('Last week you ran 212 of 240 planned minutes.')).toBeInTheDocument()
    expect(
      screen.getByText('The plan holds steady: next week is up to 220 min.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Weeks until Synthetic half: 8.')).toBeInTheDocument()
    expectCleanCopy(container)
  })

  test('what changed: the count, the update as from and to with its cause, and a Why', async () => {
    renderBrief('/brief', served(makeView()), SEEN)
    const section = await screen.findByRole('region', { name: 'What changed and why' })
    expect(within(section).getByText('The weekly update changed one session.')).toBeInTheDocument()
    const rows = within(section).getByRole('list', { name: 'Changes in this update' })
    expect(
      within(rows).getByText(/^Thu 14 Jan: Threshold 40 min to Easy run 30 min/),
    ).toBeInTheDocument()
    expect(within(section).getByText(/^Last week called for holding steady/)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Undo update' })).toBeInTheDocument()
  })

  test("the update's stored summary is not repeated under the brief's own sentence", async () => {
    renderBrief('/brief', served(makeView()), SEEN)
    const section = await screen.findByRole('region', { name: 'What changed and why' })
    expect(within(section).getByText('The weekly update changed one session.')).toBeInTheDocument()
    expect(within(section).queryByText('Held the week after last week.')).not.toBeInTheDocument()
  })

  test('undo that cannot be done names the session or the sign that blocks it', async () => {
    // The server words each reason from the row or the rule it names; the page shows its words.
    const run = 'Thu 14 Jan already has a run linked to it.'
    const sign =
      'A warning sign from your check-in is still active, so this update stays for now. It can be undone once the sign clears.'
    const { container } = renderBrief(
      '/brief',
      served(
        makeView({
          revision: makeUpdate({
            undo: {
              available: false,
              reasons: [
                { code: 'session-run', message: run, sessionId: 's1' },
                { code: 'safety-rule', message: sign, rules: ['n-2'] },
              ],
              undoneAt: null,
            },
          }),
        }),
      ),
      SEEN,
    )
    const section = await screen.findByRole('region', { name: 'What changed and why' })
    expect(within(section).queryByRole('button', { name: 'Undo update' })).not.toBeInTheDocument()
    const reasons = within(section).getByRole('list', { name: 'Why this cannot be undone' })
    expect(
      within(reasons)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([run, sign])
    expectCleanCopy(container)
  })

  test('the Why of the update opens the weekly decision of last week', async () => {
    const user = userEvent.setup()
    renderBrief('/brief', served(makeView()), SEEN)
    await user.click(await screen.findByRole('button', { name: 'Why this update' }))
    const drawer = await screen.findByRole('dialog', { name: 'Why' })
    expect(explainOf(drawer)).toEqual({ subject: 'decision', weekStart: '2027-01-04' })
    expect(drawer).toHaveTextContent('rules: j-5, J5')
  })

  test('what the plan noticed: the fact, the records it rests on with their dates, and a Why', async () => {
    const user = userEvent.setup()
    renderBrief('/brief', served(makeView()), SEEN)
    const section = await screen.findByRole('region', { name: 'What the plan noticed' })
    expect(
      within(section).getByText(
        'Your 16 km run on Sat 9 Jan was the longest in the last 12 weeks.',
      ),
    ).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Run, 16 km, Sat 9 Jan' })).toHaveAttribute(
      'href',
      '/activities/run-1',
    )
    await user.click(
      within(section).getByRole('button', {
        name: 'Why: Your 16 km run on Sat 9 Jan was the longest in the last 12 weeks.',
      }),
    )
    const drawer = await screen.findByRole('dialog', { name: 'Why' })
    expect(explainOf(drawer)).toEqual({ subject: 'brief', weekStart: WEEK })
    expect(drawer).toHaveTextContent('rules: a-3')
  })

  test('nothing noticed says so in the exact words', async () => {
    renderBrief('/brief', served(makeView({ facts: makeFacts({ noticed: [] }) })), SEEN)
    expect(await screen.findByText('Nothing stood out this week.')).toBeInTheDocument()
  })

  test('the next key session: the line, the targets the hero shows and the readiness sentence', async () => {
    renderBrief('/brief', served(makeView()), SEEN)
    const section = await screen.findByRole('region', { name: 'Next key session' })
    expect(within(section).getByText('Sat 16 Jan: long run, 105 min, 16 km.')).toBeInTheDocument()
    const terms = within(section)
      .getAllByRole('term')
      .map((term) => term.textContent)
    expect(terms).toEqual(['Heart rate', 'Pace', 'Effort'])
    expect(within(section).getByText('under 149 bpm')).toBeInTheDocument()
    expect(
      within(section).getByText(
        'Readiness can only make this session easier on the day, never harder.',
      ),
    ).toBeInTheDocument()
  })

  test('a week without a key session says the week is easy running', async () => {
    renderBrief('/brief', served(makeView({ facts: makeFacts({ keySession: null }) })), SEEN)
    expect(
      await screen.findByText('No key session this week. The week is easy running.'),
    ).toBeInTheDocument()
  })

  test('since this brief: nothing, or the later updates through the same diff and undo', async () => {
    const { unmount } = renderBrief(
      '/brief',
      served(makeView({ seen: true, revision: makeUpdate({ seenAt: WEEK }) })),
    )
    expect(await screen.findByText('Nothing has changed since this brief.')).toBeInTheDocument()
    unmount()

    renderBrief('/brief', served(makeView({ since: [makeLater()] })), SEEN)
    const section = await screen.findByRole('region', { name: 'Since this brief' })
    expect(within(section).getByText(/^Fri 15 Jan: Easy run 45 min, taken out/)).toBeInTheDocument()
    expect(within(section).getByText('You made this change yourself.')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Undo update' })).toBeInTheDocument()
  })

  test('a runner using miles sees miles', async () => {
    const { container } = renderBrief('/brief', served(makeView()), SEEN, 'mi')
    expect(await screen.findByText('Sat 16 Jan: long run, 105 min, 9.9 mi.')).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/\bkm\b/)
    expectCleanCopy(container)
  })

  test('earlier and later briefs are links to their weeks', async () => {
    const user = userEvent.setup()
    const { api } = renderBrief('/brief', () => ({
      brief: makeView({
        prev: '2027-01-04',
        next: '2027-01-18',
        seen: true,
        revision: makeUpdate({ seenAt: WEEK }),
      }),
    }))
    const earlier = await screen.findByRole('link', { name: 'Earlier brief' })
    expect(earlier).toHaveAttribute('href', '/brief/2027-01-04')
    expect(screen.getByRole('link', { name: 'Later brief' })).toHaveAttribute(
      'href',
      '/brief/2027-01-18',
    )
    await user.click(earlier)
    await waitFor(() => {
      expect(api.calls.map((call) => call.url)).toContain('/api/brief?weekStart=2027-01-04')
    })
  })

  test('the oldest and newest briefs have one link or none', async () => {
    renderBrief(
      '/brief',
      served(
        makeView({ prev: null, next: null, seen: true, revision: makeUpdate({ seenAt: WEEK }) }),
      ),
    )
    await screen.findByRole('heading', { level: 2, name: 'What changed and why' })
    expect(screen.queryByRole('link', { name: 'Earlier brief' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Later brief' })).not.toBeInTheDocument()
  })
})

describe('Brief page: seen', () => {
  test('opening an unseen brief stamps it once, and the marker stays until the page is left', async () => {
    let served = 0
    const { api } = renderBrief(
      '/brief',
      () => {
        served += 1
        // After the stamp the server reads the revision as seen.
        return {
          brief: makeView(
            served === 1
              ? { since: [makeLater()] }
              : {
                  seen: true,
                  revision: makeUpdate({ seenAt: '2027-01-13T12:00:00.000Z' }),
                  since: [makeLater({ seenAt: '2027-01-13T12:00:00.000Z' })],
                },
          ),
        }
      },
      SEEN,
    )
    await screen.findByRole('region', { name: 'What changed and why' })
    await waitFor(() => {
      expect(api.calls.filter((call) => call.url === '/api/briefs/2027-01-11/seen')).toHaveLength(1)
    })
    // The brief is read again after the stamp; the markers of what was new stay.
    await waitFor(() => {
      expect(served).toBeGreaterThan(1)
    })
    expect(screen.getAllByText('New')).toHaveLength(2)
    expect(api.calls.filter((call) => call.url === '/api/briefs/2027-01-11/seen')).toHaveLength(1)
  })

  test('a brief that was opened before carries no marker and sends no stamp', async () => {
    const { api } = renderBrief(
      '/brief',
      served(
        makeView({ seen: true, revision: makeUpdate({ seenAt: '2027-01-12T08:00:00.000Z' }) }),
      ),
    )
    await screen.findByRole('region', { name: 'What changed and why' })
    expect(screen.queryByText('New')).not.toBeInTheDocument()
    expect(api.calls.some((call) => call.method === 'POST')).toBe(false)
  })

  test('a revision with no diff, written before the revision model, shows its stored changes', async () => {
    renderBrief(
      '/brief',
      served(
        makeView({
          seen: true,
          revision: makeRevision({ id: 'old', seenAt: WEEK, reason: 'weekly' }),
          facts: makeFacts({ changes: { count: 0, lines: [], runMinBefore: 0, runMinAfter: 0 } }),
        }),
      ),
    )
    expect(await screen.findByText(/^Week of 18 Jan: /)).toBeInTheDocument()
  })
})
