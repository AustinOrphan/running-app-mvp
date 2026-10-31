import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loadTradeoff } from '../../shared/copy/load.ts'
import { loadSettingSummary } from '../../shared/copy/revision.ts'
import type { LoadHold, LoadPosition } from '../../shared/engine/loadSetting.ts'
import type { LoadAppetite } from '../../shared/engine/types.ts'
import type {
  Goal,
  PlanPreview,
  PlanRevisionView,
  PlanWithSessions,
  PlanWithWeeks,
  WeekRow,
} from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { PlanPage } from '../../web/pages/PlanPage.tsx'
import { makeActivity, makeWeekRow } from '../factories.ts'
import {
  activityPage,
  explainOf,
  expectCleanCopy,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import {
  AVAILABLE,
  makeBrief,
  makeDiff,
  makeLine,
  makePreview,
  makeRevision,
  makeSession,
  makeV1Plan,
  makeV2Plan,
  makeV2Week,
  makeWeekLine,
  makeWindow,
  settings,
} from './plan-fixtures.ts'
import { makeToday } from './today-fixtures.ts'
import { sheetRoutes } from './wrist-fixtures.ts'

vi.mock('../../web/components/WhyDrawer.tsx', () => ({
  WhyDrawer: ({ rules, explain, open }: { rules: string[]; explain?: unknown; open: boolean }) =>
    open ? (
      <div
        role="complementary"
        aria-label="Why drawer"
        data-explain={JSON.stringify(explain ?? null)}
      >
        {rules.join(',')}
      </div>
    ) : null,
}))

const goal = {
  id: 'g1',
  name: 'Spring marathon',
  status: 'target',
  isActive: true,
  targetDate: '2027-03-07',
  distanceM: 42195,
} as Goal

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-13T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

function routes(plan: PlanWithSessions | PlanWithWeeks | null, extra: MockRoutes = {}): MockRoutes {
  return {
    'GET /api/plan': () => plan,
    'GET /api/goals': () => [goal],
    'GET /api/settings': () => settings,
    'GET /api/weeks': () => [] as WeekRow[],
    'GET /api/plan/revisions': () => [makeRevision()],
    'GET /api/plan/disruptions': () => [],
    'GET /api/activities': () => activityPage([]),
    ...sheetRoutes(plan !== null && 'sessions' in plan ? plan.sessions : []),
    ...extra,
  }
}

function renderPlan() {
  renderWithProviders(
    <ToastProvider>
      <PlanPage />
    </ToastProvider>,
  )
}

describe('Plan page, version-2 plans', () => {
  test('shows feasibility with its notes, warnings, and the plan checks', async () => {
    mockApi(routes(makeV2Plan()))
    renderPlan()
    const feasibility = await screen.findByRole('region', { name: 'Feasibility' })
    expect(within(feasibility).getByText('Tight')).toBeInTheDocument()
    expect(within(feasibility).getByText(/14 weeks needed, 12 available/)).toBeInTheDocument()
    expect(within(feasibility).getByText('Two fewer weeks than usual.')).toBeInTheDocument()

    const warnings = screen.getByRole('region', { name: 'Warnings' })
    expect(
      within(warnings).getByText('Week of 18 Jan held at the weekly ramp limit.'),
    ).toBeInTheDocument()
    expect(within(warnings).getByText('Caution')).toBeInTheDocument()

    const checks = screen.getByRole('region', { name: 'Plan checks' })
    expect(within(checks).getByText('1 of 2 checks pass')).toBeInTheDocument()
    expect(within(checks).getByText('Every week is within the ramp limit.')).toBeInTheDocument()
    expect(within(checks).getByText('Taper is one week long.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/behind|missed|streak/i)
  })

  test('marks the cutback chip from the engine recovery flag, not from the week index', async () => {
    mockApi(
      routes(
        makeV2Plan({
          weeks: [
            makeV2Week(0),
            makeV2Week(1, { flags: ['recovery'] }),
            makeV2Week(2, { flags: ['ladder-2'] }),
            // The index a version-1 plan would mark as a cutback, without the engine's flag.
            makeV2Week(3),
          ],
        }),
      ),
    )
    renderPlan()
    await screen.findByRole('region', { name: 'Feasibility' })
    const row = (weekStart: string) =>
      document.querySelector<HTMLElement>(`tr[data-week="${weekStart}"]`)!
    expect(row('2027-01-11')).toHaveAttribute('data-cutback', 'true')
    expect(within(row('2027-01-11')).getByText('cutback')).toBeInTheDocument()
    expect(row('2027-01-25')).not.toHaveAttribute('data-cutback')
    expect(row('2027-01-18')).not.toHaveAttribute('data-cutback')
    expect(screen.getAllByText('cutback')).toHaveLength(1)
  })

  test('groups warnings of one code into a line with a disclosure of the weeks', async () => {
    const user = userEvent.setup()
    const warning = (week: string, gain: number) => ({
      code: 'gain-ramp-soft',
      severity: 'warn' as const,
      message: `Climbing in the week of ${week} is ${String(gain)} m, above a 10% step.`,
      rules: ['H4'],
    })
    mockApi(
      routes(
        makeV2Plan({
          warnings: [
            warning('2027-01-04', 700),
            warning('2027-01-11', 800),
            warning('2027-01-18', 900),
          ],
        }),
      ),
    )
    renderPlan()
    const warnings = await screen.findByRole('region', { name: 'Warnings' })
    expect(within(warnings).getAllByRole('button', { name: 'Why this warning' })).toHaveLength(1)
    expect(within(warnings).getByText('Climbing above the 10% step in 3 weeks')).toBeInTheDocument()
    expect(within(warnings).queryByText(/2027-01/)).not.toBeInTheDocument()
    await user.click(within(warnings).getByText('Show each one'))
    expect(
      within(warnings).getByText('Climbing in the week of 4 Jan is 700 m, above a 10% step.'),
    ).toBeInTheDocument()
    expect(
      within(warnings).getByText('Climbing in the week of 18 Jan is 900 m, above a 10% step.'),
    ).toBeInTheDocument()
  })

  test('shows engine text in feet and miles with the miles setting', async () => {
    mockApi(
      routes(
        makeV2Plan({
          warnings: [
            {
              code: 'gain-ramp-soft',
              severity: 'warn',
              message: 'Climbing in the week of 2027-01-04 is 700 m, above 550 m.',
              rules: ['H4'],
            },
          ],
        }),
        { 'GET /api/settings': () => ({ ...settings, units: 'mi' }) },
      ),
    )
    renderPlan()
    const warnings = await screen.findByRole('region', { name: 'Warnings' })
    expect(
      await within(warnings).findByText('Climbing in the week of 4 Jan is 2297 ft, above 1804 ft.'),
    ).toBeInTheDocument()
  })

  test('a not-reachable plan says so in the spec wording', async () => {
    mockApi(
      routes(
        makeV2Plan({
          feasibility: { label: 'not-reachable', weeksNeeded: 30, weeksAvailable: 8, notes: [] },
        }),
      ),
    )
    renderPlan()
    expect(await screen.findByText('Not reachable within default limits')).toBeInTheDocument()
  })

  test('why buttons open the drawer with the rules of that warning', async () => {
    const user = userEvent.setup()
    mockApi(routes(makeV2Plan()))
    renderPlan()
    const warnings = await screen.findByRole('region', { name: 'Warnings' })
    await user.click(within(warnings).getByRole('button', { name: 'Why this warning' }))
    const drawer = await screen.findByLabelText('Why drawer')
    expect(drawer).toHaveTextContent('g-3')
    expect(explainOf(drawer)).toEqual({ subject: 'rules', rules: ['g-3'] })
  })

  test.each([
    { name: 'Why this note', index: 0, rules: ['d-1'] },
    { name: 'Why this warning', index: 0, rules: ['g-3'] },
    { name: 'Why this check', index: 0, rules: ['g-3'] },
    { name: 'Why this check', index: 1, rules: ['k-1'] },
    { name: 'Why this update', index: 0, rules: ['j-5'] },
  ])(
    'every why button on the page passes a subject: $name ($index) asks about $rules',
    async ({ name, index, rules }) => {
      const user = userEvent.setup()
      mockApi(routes(makeV2Plan()))
      renderPlan()
      await screen.findByRole('region', { name: 'Warnings' })
      // The plan checks and the list of changes sit in disclosures.
      await user.click(screen.getByText('Plan checks'))
      await user.click(screen.getByText('What changed'))
      const buttons = await screen.findAllByRole('button', { name })
      const button = buttons[index]
      if (button === undefined) throw new Error(`No ${name} button at ${String(index)}`)
      await user.click(button)
      expect(explainOf(await screen.findByLabelText('Why drawer'))).toEqual({
        subject: 'rules',
        rules,
      })
    },
  )

  test('What changed lists revisions with their summary and changes', async () => {
    mockApi(routes(makeV2Plan()))
    renderPlan()
    const changed = await screen.findByRole('region', { name: 'What changed' })
    expect(
      await within(changed).findByText('Held week 3 after an easier-than-expected long run.'),
    ).toBeInTheDocument()
    expect(within(changed).getByText('Weekly update')).toBeInTheDocument()
    expect(
      within(changed).getByText(/Week of 18 Jan: Weekly running time 330 min to 300 min/),
    ).toBeInTheDocument()
  })

  test('the current week opens to its day cards; other weeks open on request', async () => {
    const user = userEvent.setup()
    mockApi(routes(makeV2Plan()))
    renderPlan()
    await screen.findByText('Week focus 0')
    expect(screen.getByRole('button', { name: /Steady long run/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hill strides/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Easy run/ })).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Days for week of 4 Jan' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Easy run/ })).toBeInTheDocument()
    await user.click(toggle)
    expect(screen.queryByRole('button', { name: /Easy run/ })).not.toBeInTheDocument()
  })

  test('a day card summarises the session and opens the session sheet', async () => {
    const user = userEvent.setup()
    mockApi(routes(makeV2Plan()))
    renderPlan()
    const card = await screen.findByRole('button', { name: /Steady long run/ })
    expect(screen.getByText('Tue 12 Jan')).toBeInTheDocument()
    expect(card).toHaveTextContent('55 min')
    await waitFor(() => {
      expect(card).toHaveTextContent('9.00 km')
    })
    expect(card).toHaveTextContent('Planned')
    await user.click(card)
    expect(await screen.findByRole('dialog', { name: 'Steady long run' })).toBeInTheDocument()
  })

  test('the session sheet follows the plan data after an update', async () => {
    const user = userEvent.setup()
    let plan = makeV2Plan()
    mockApi(
      routes(plan, {
        'GET /api/plan': () => plan,
        'POST /api/plan/sessions/b/link': () => {
          plan = makeV2Plan({
            sessions: plan.sessions.map((s) =>
              s.id === 'b'
                ? { ...s, activityId: 'act9', linkSource: 'owner', status: 'completed' }
                : s,
            ),
          })
          return plan.sessions[1]
        },
        'GET /api/activities': () =>
          activityPage([
            makeActivity({ id: 'act9', date: '2027-01-12', durationSec: 3300, distanceM: 9000 }),
          ]),
      }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: /Steady long run/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Steady long run' })
    await user.selectOptions(await within(dialog).findByLabelText('Link an activity'), 'act9')
    await user.click(within(dialog).getByRole('button', { name: 'Link' }))
    expect(await within(dialog).findByRole('button', { name: 'Unlink' })).toBeInTheDocument()
    expect(await within(dialog).findByText(/Linked by you/)).toBeInTheDocument()
  })

  test('the sheet closes when its session leaves the plan', async () => {
    const user = userEvent.setup()
    let current = makeV2Plan()
    mockApi(
      routes(current, {
        'GET /api/plan': () => current,
        'POST /api/plan/preview': () => replanPreview(),
        'POST /api/plan/replan': () => makeRevision(),
        'POST /api/plan/revisions/r1/seen': () => ({ status: 204, body: undefined }),
      }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: /Hill strides/ }))
    await screen.findByRole('dialog', { name: 'Hill strides' })
    current = makeV2Plan({
      sessions: [makeSession({ id: 'z', weekStart: '2027-01-11', date: '2027-01-15' })],
    })
    await user.click(screen.getByRole('button', { name: 'Update plan from latest data' }))
    const update = await screen.findByRole('dialog', { name: 'Update plan from latest data' })
    await user.click(await within(update).findByRole('button', { name: 'Apply to my plan' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Hill strides/ })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog', { name: 'Hill strides' })).not.toBeInTheDocument()
  })

  test('Update plan from latest data previews first, then applies that preview with its hash', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(makeV2Plan(), {
        'POST /api/plan/preview': () => replanPreview(),
        'POST /api/plan/replan': () => makeRevision({ id: 'r3' }),
        'POST /api/plan/revisions/r3/seen': () => ({ status: 204, body: undefined }),
      }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: 'Update plan from latest data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Update plan from latest data' })
    expect(await within(dialog).findByText('1 change across 1 week.')).toBeInTheDocument()
    expect(
      within(dialog).getByText(/Thu 14 Jan: Threshold intervals 40 min to/),
    ).toBeInTheDocument()
    // The preview is a request that writes nothing.
    expect(calls.find((c) => c.url === '/api/plan/preview')?.body).toEqual({ type: 'replan' })
    expect(calls.some((c) => c.url === '/api/plan/replan')).toBe(false)
    expectCleanCopy(dialog)

    await user.click(within(dialog).getByRole('button', { name: 'Apply to my plan' }))
    const updated = await within(dialog).findByRole('heading', { name: 'Plan updated' })
    expect(calls.find((c) => c.url === '/api/plan/replan')?.body).toEqual({
      expectHash: 'a'.repeat(64),
    })
    // The Apply button is gone: focus moves to what was done, inside the dialog.
    await waitFor(() => {
      expect(updated).toHaveFocus()
    })
    // The server wrote the revision as seen (as it does for every request): nothing is stamped.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(calls.some((c) => c.url.includes('/seen'))).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(
      screen.queryByRole('dialog', { name: 'Update plan from latest data' }),
    ).not.toBeInTheDocument()
  })

  test('a re-plan whose revision is still unseen stamps it once', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(makeV2Plan(), {
        'POST /api/plan/preview': () => replanPreview(),
        'POST /api/plan/replan': () => makeRevision({ id: 'r3', seenAt: null }),
        'POST /api/plan/revisions/r3/seen': () => ({ status: 204, body: undefined }),
      }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: 'Update plan from latest data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Update plan from latest data' })
    await user.click(await within(dialog).findByRole('button', { name: 'Apply to my plan' }))
    await within(dialog).findByRole('heading', { name: 'Plan updated' })
    await waitFor(() => {
      expect(calls.filter((c) => c.url === '/api/plan/revisions/r3/seen')).toHaveLength(1)
    })
  })

  test('a re-plan that would change nothing says so and only closes', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(makeV2Plan(), { 'POST /api/plan/preview': () => makePreview() }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: 'Update plan from latest data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Update plan from latest data' })
    expect(await within(dialog).findByText('No changes to the plan.')).toBeInTheDocument()
    expectCleanCopy(dialog)
    expect(
      within(dialog).queryByRole('button', { name: 'Apply to my plan' }),
    ).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(calls.some((c) => c.url === '/api/plan/replan')).toBe(false)
  })

  test('a stale re-plan preview is replaced by the new one before it is applied', async () => {
    const user = userEvent.setup()
    let commits = 0
    const newer = replanPreview({ hash: 'b'.repeat(64), summary: '2 changes across 1 week.' })
    const { calls } = mockApi(
      routes(makeV2Plan(), {
        'POST /api/plan/preview': () => replanPreview(),
        'POST /api/plan/replan': () => {
          commits += 1
          return commits === 1
            ? {
                status: 409,
                body: {
                  error: {
                    code: 'conflict',
                    message: 'This preview is out of date. Review the new one before applying it.',
                    details: { code: 'stale-preview', preview: newer },
                  },
                },
              }
            : makeRevision({ id: 'r3' })
        },
        'POST /api/plan/revisions/r3/seen': () => ({ status: 204, body: undefined }),
      }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: 'Update plan from latest data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Update plan from latest data' })
    await user.click(await within(dialog).findByRole('button', { name: 'Apply to my plan' }))
    expect(
      await within(dialog).findByText(
        'The plan changed while you were reading. This is the new preview.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('2 changes across 1 week.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Apply to my plan' }))
    await within(dialog).findByText('Plan updated')
    expect(
      calls
        .filter((c) => c.url === '/api/plan/replan')
        .map((c) => (c.body as { expectHash: string }).expectHash),
    ).toEqual(['a'.repeat(64), 'b'.repeat(64)])
  })

  test('a re-plan the plan checks refuse says why and cannot be applied', async () => {
    const user = userEvent.setup()
    mockApi(
      routes(makeV2Plan(), {
        'POST /api/plan/preview': () =>
          replanPreview({
            blocked: true,
            reasons: [
              {
                code: 'checklist',
                message: 'The plan did not pass the plan checks, so it was not published.',
              },
            ],
          }),
      }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: 'Update plan from latest data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Update plan from latest data' })
    expect(await within(dialog).findByText(/did not pass the plan checks/)).toBeInTheDocument()
    expectCleanCopy(dialog)
    expect(within(dialog).getByRole('button', { name: 'Apply to my plan' })).toBeDisabled()
  })
})

/** A re-plan that turns Thursday's threshold run into an easy run of 30 minutes. */
function replanPreview(over: Partial<PlanPreview> = {}): PlanPreview {
  return makePreview({
    diff: makeDiff(
      [
        makeLine({
          externalId: 'x1',
          date: '2027-01-14',
          before: makeBrief({ durationMin: 40 }),
          after: makeBrief({ kind: 'easy', title: 'Easy run', durationMin: 30 }),
          fields: ['kind', 'durationMin'],
        }),
      ],
      [makeWeekLine()],
    ),
    summary: '1 change across 1 week.',
    ...over,
  })
}

/** A weekly update the runner has not opened: a diff, its cause and an undo. */
function unseenUpdate(over: Partial<PlanRevisionView> = {}): PlanRevisionView {
  return makeRevision({
    id: 'r9',
    createdAt: '2027-01-11T12:00:00.000Z',
    reason: 'weekly',
    auto: true,
    summary: "2 changes across 1 week. Last week's decision: hold, next week up to 270 min.",
    decision: { decision: 'hold', signals: [], nextWeekTargetMin: 270 },
    diff: makeDiff(
      [
        makeLine({
          externalId: 'x1',
          date: '2027-01-14',
          before: makeBrief({ durationMin: 40 }),
          after: makeBrief({ kind: 'easy', title: 'Easy run', durationMin: 30 }),
          fields: ['kind', 'durationMin'],
        }),
      ],
      [makeWeekLine()],
    ),
    causes: { sessions: { x1: ['decision-hold'] }, weeks: { '2027-01-11': ['decision-hold'] } },
    undo: AVAILABLE,
    seenAt: null,
    ...over,
  })
}

describe('Plan page, What changed', () => {
  test('lists a revision through the shared components: reason, cause, rows and undo', async () => {
    mockApi(
      routes(makeV2Plan(), {
        'GET /api/plan/revisions': () => [unseenUpdate()],
        'POST /api/plan/revisions/r9/seen': () => ({ status: 204, body: undefined }),
      }),
    )
    renderPlan()
    const changed = await screen.findByRole('region', { name: 'What changed' })
    await userEvent.setup().click(within(changed).getByText('What changed'))
    expect(within(changed).getByText('Weekly update')).toBeInTheDocument()
    expect(
      within(changed).getByText('Week of 11 Jan: running time 300 min to 270 min'),
    ).toBeInTheDocument()
    expect(
      within(changed).getByText('Thu 14 Jan: Threshold intervals 40 min to Easy run 30 min'),
    ).toBeInTheDocument()
    expect(
      within(changed).getByText(
        'Last week called for holding steady, so the plan did not step up.',
      ),
    ).toBeInTheDocument()
    expect(within(changed).getByRole('button', { name: 'Undo update' })).toBeInTheDocument()
    expectCleanCopy(changed)
  })

  test('marks the closed panel New for a revision nobody opened, and stamps it when the panel opens', async () => {
    const user = userEvent.setup()
    let seen = false
    const { calls } = mockApi(
      routes(makeV2Plan(), {
        'GET /api/plan/revisions': () => [
          unseenUpdate({ seenAt: seen ? '2027-01-13T12:00:00.000Z' : null }),
          makeRevision({ id: 'old', seenAt: '2027-01-09T12:00:00.000Z' }),
        ],
        'POST /api/plan/revisions/r9/seen': () => {
          seen = true
          return { status: 204, body: undefined }
        },
      }),
    )
    renderPlan()
    const changed = await screen.findByRole('region', { name: 'What changed' })
    // The panel is closed: the marker sits on its summary, where the runner will see it.
    await waitFor(() => {
      expect(within(changed).getByText('New')).toBeInTheDocument()
    })
    expect(calls.some((c) => c.url.includes('/seen'))).toBe(false)

    await user.click(within(changed).getByText('What changed'))
    await waitFor(() => {
      expect(calls.filter((c) => c.url.includes('/seen')).map((c) => c.url)).toEqual([
        '/api/plan/revisions/r9/seen',
      ])
    })
    // Only the revision that was unseen is sent, and the marker stays on it while the panel is open.
    const revision = changed.querySelector('[data-revision="r9"]') as HTMLElement
    await waitFor(() => {
      expect(within(revision).getByText('New')).toBeInTheDocument()
    })
    expect(changed.querySelector('[data-revision="old"]')).not.toHaveTextContent('New')

    // Closing and opening again: it was seen, so nothing is marked and nothing is sent again.
    await user.click(within(changed).getByText('What changed'))
    await user.click(within(changed).getByText('What changed'))
    expect(within(changed).queryByText('New')).not.toBeInTheDocument()
    expect(calls.filter((c) => c.url.includes('/seen'))).toHaveLength(1)
  })

  test('sends nothing for a panel whose revisions were all seen', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(makeV2Plan(), {
        'GET /api/plan/revisions': () => [unseenUpdate({ seenAt: '2027-01-11T13:00:00.000Z' })],
      }),
    )
    renderPlan()
    const changed = await screen.findByRole('region', { name: 'What changed' })
    await user.click(within(changed).getByText('What changed'))
    await within(changed).findByText('Weekly update')
    expect(within(changed).queryByText('New')).not.toBeInTheDocument()
    expect(calls.some((c) => c.url.includes('/seen'))).toBe(false)
  })

  test('words an update in miles, the account default, while the settings are not known', async () => {
    const user = userEvent.setup()
    mockApi(
      routes(makeV2Plan(), {
        'GET /api/settings': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'The settings could not be read.' } },
        }),
        'GET /api/plan/revisions': () => [
          unseenUpdate({
            seenAt: '2027-01-11T13:00:00.000Z',
            diff: makeDiff([
              makeLine({
                externalId: 'x1',
                date: '2027-01-14',
                before: makeBrief({ distanceM: 8000 }),
                after: makeBrief({ distanceM: 16_093 }),
                fields: ['distanceM'],
              }),
            ]),
          }),
        ],
      }),
    )
    renderPlan()
    const changed = await screen.findByRole('region', { name: 'What changed' })
    await user.click(within(changed).getByText('What changed'))
    expect(
      await within(changed).findByText(
        'Thu 14 Jan: Threshold intervals 40 min, 5 mi to Threshold intervals 40 min, 10 mi',
      ),
    ).toBeInTheDocument()
    expect(changed).not.toHaveTextContent(/\bkm\b/)
  })

  test('opens the why drawer with the rules of an update', async () => {
    const user = userEvent.setup()
    mockApi(
      routes(makeV2Plan(), {
        'GET /api/plan/revisions': () => [unseenUpdate({ seenAt: '2027-01-11T13:00:00.000Z' })],
        'POST /api/plan/revisions/r9/seen': () => ({ status: 204, body: undefined }),
      }),
    )
    renderPlan()
    const changed = await screen.findByRole('region', { name: 'What changed' })
    await user.click(within(changed).getByText('What changed'))
    await user.click(await within(changed).findByRole('button', { name: 'Why this update' }))
    expect(await screen.findByLabelText('Why drawer')).toHaveTextContent('j-5,J5')
  })
})

describe('Plan page, rest windows', () => {
  const todayRoute = { 'GET /api/today': () => makeToday({ date: '2027-01-13' }) }

  test('the header has Not 100% beside Update plan from latest data, and Not 100% opens the sheet', async () => {
    const user = userEvent.setup()
    mockApi(routes(makeV2Plan(), todayRoute))
    renderPlan()
    await screen.findByRole('button', { name: 'Not 100%' })
    const header = screen.getByRole('banner')
    expect(
      within(header)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Not 100%', 'Update plan from latest data', 'Regenerate plan'])
    await user.click(within(header).getByRole('button', { name: 'Not 100%' }))
    const dialog = await screen.findByRole('dialog', { name: 'Not 100%' })
    expect(await within(dialog).findByRole('radio', { name: /Ill, above the neck/ })).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Not 100%' })).toHaveFocus()
  })

  test('without a window there is no banner and the server is not asked for its day', async () => {
    const { calls } = mockApi(routes(makeV2Plan()))
    renderPlan()
    await screen.findByText('Week focus 0')
    await waitFor(() => {
      expect(calls.some((c) => c.url.startsWith('/api/plan/disruptions'))).toBe(true)
    })
    expect(screen.queryByRole('region', { name: 'Rest window' })).not.toBeInTheDocument()
    expect(calls.some((c) => c.url === '/api/today')).toBe(false)
  })

  test('a window in force is a banner above the plan, with its three buttons', async () => {
    mockApi(
      routes(makeV2Plan(), {
        ...todayRoute,
        'GET /api/plan/disruptions': () => [makeWindow()],
      }),
    )
    renderPlan()
    const banner = await screen.findByRole('region', { name: 'Rest window' })
    expect(within(banner).getByText('Resting for illness until Thu 14 Jan.')).toBeInTheDocument()
    expect(
      within(banner)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(["I'm better", 'Extend', 'Remove window'])
    // Above the overview and the table.
    expect(
      banner.compareDocumentPosition(screen.getByRole('region', { name: 'Feasibility' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expectCleanCopy(document.body)
  })

  test('removing the window from the banner shows the result and its undo after the banner is gone', async () => {
    const user = userEvent.setup()
    let removed = false
    mockApi(
      routes(makeV2Plan(), {
        ...todayRoute,
        'GET /api/plan/disruptions': () => (removed ? [] : [makeWindow()]),
        'POST /api/plan/preview': () =>
          makePreview({
            action: { type: 'disruption-remove', id: 'w1' },
            summary: 'Removed the window (illness) from Mon 11 Jan to Thu 14 Jan.',
            hash: 'f'.repeat(64),
          }),
        'DELETE /api/plan/disruptions/w1': () => {
          removed = true
          return {
            disruption: makeWindow({ status: 'undone', phase: 'done' }),
            revision: makeRevision({
              id: 'r6',
              reason: 'disruption',
              auto: false,
              summary: 'Removed the window (illness) from Mon 11 Jan to Thu 14 Jan.',
              diff: makeDiff([], [makeWeekLine()]),
              causes: { sessions: {}, weeks: { '2027-01-11': ['disruption'] } },
              undo: AVAILABLE,
              seenAt: null,
              disruptionId: 'w1',
            }),
          }
        },
        'POST /api/plan/revisions/r6/seen': () => ({ status: 204, body: undefined }),
      }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: 'Remove window' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this window' })
    await user.click(await within(dialog).findByRole('button', { name: 'Apply to my plan' }))
    expect(await within(dialog).findByText('Window removed')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Rest window' })).not.toBeInTheDocument()
    })
    expect(within(dialog).getByRole('button', { name: 'Undo update' })).toBeInTheDocument()
  })

  test('a week a window touches carries Rest window, and the weeks held to the restart, Return week', async () => {
    mockApi(
      routes(
        makeV2Plan({
          weeks: [
            makeV2Week(0),
            makeV2Week(1, { flags: ['disrupted'] }),
            makeV2Week(2, { flags: ['disrupted', 'disruption-return'] }),
          ],
        }),
      ),
    )
    renderPlan()
    await screen.findByText('Week focus 0')
    const row = (weekStart: string) =>
      document.querySelector<HTMLElement>(`tr[data-week="${weekStart}"]`)!
    expect(within(row('2027-01-04')).queryByText('Rest window')).not.toBeInTheDocument()
    expect(within(row('2027-01-04')).queryByText('Return week')).not.toBeInTheDocument()
    expect(within(row('2027-01-11')).getByText('Rest window')).toBeInTheDocument()
    expect(within(row('2027-01-11')).queryByText('Return week')).not.toBeInTheDocument()
    expect(within(row('2027-01-18')).getByText('Rest window')).toBeInTheDocument()
    expect(within(row('2027-01-18')).getByText('Return week')).toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('a day a window holds reads Rest: illness with the meta Rest window; a skipped one says both', async () => {
    mockApi(
      routes(
        makeV2Plan({
          sessions: [
            makeSession({
              id: 'rest',
              weekStart: '2027-01-11',
              date: '2027-01-13',
              kind: 'rest',
              title: 'Rest: illness',
              durationMin: 0,
              distanceM: null,
              gainM: null,
              structure: [],
              flags: ['rest-window'],
              status: 'planned',
            }),
            makeSession({
              id: 'back',
              weekStart: '2027-01-11',
              date: '2027-01-12',
              kind: 'easy',
              title: 'Easy run',
              durationMin: 40,
              distanceM: null,
              flags: ['rest-window'],
              status: 'skipped',
            }),
          ],
        }),
      ),
    )
    renderPlan()
    const rest = await screen.findByRole('button', { name: /Rest: illness/ })
    expect(rest).toHaveTextContent('Rest: illness')
    expect(rest).toHaveTextContent('Rest window')
    expect(rest).not.toHaveTextContent('Planned')
    const skipped = screen.getByRole('button', { name: /Easy run/ })
    expect(skipped).toHaveTextContent('40 min, Skipped, Rest window')
    expectCleanCopy(document.body)
  })
})

describe('Plan page, the load setting in effect', () => {
  const load = (over: Partial<LoadPosition> = {}): LoadPosition => ({
    requested: 'steady',
    position: 'steady',
    held: null,
    ageCapped: false,
    ...over,
  })
  const panel = () => screen.findByRole('region', { name: 'Load setting' })

  test.each([
    ['steady', 'steady'],
    ['standard', 'standard'],
    ['upper', 'upper'],
  ] as const)(
    'states the trade-off of the choice below the hint at %s, in the panel and not only on the form',
    async (requested, position) => {
      mockApi(routes(makeV2Plan({ load: load({ requested, position }) })))
      renderPlan()
      const region = await panel()
      const tradeoff = within(region).getByText(
        /^A faster step brings the earlier weekly level back/,
      )
      expect(tradeoff).toHaveTextContent(loadTradeoff())
      expect(tradeoff).toHaveTextContent('the effect here is not known')
      expect(tradeoff).toHaveTextContent('Staying with 10% is the more cautious choice.')
      // it follows the hint in the panel
      const hint = within(region).getByText(/^Adds up to /)
      expect(hint.compareDocumentPosition(tradeoff) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
      expectCleanCopy(region)
    },
  )

  /** The panel's paragraphs, in the order they read. */
  const lines = (region: HTMLElement) =>
    Array.from(region.querySelectorAll('p')).map((line) => line.textContent)

  test('leads with the choice and the reason, then the hint in effect, and the trade-off last', async () => {
    mockApi(
      routes(
        makeV2Plan({ load: load({ requested: 'upper', position: 'steady', held: 'rest-window' }) }),
      ),
    )
    renderPlan()
    const region = await panel()
    expect(lines(region)).toEqual([
      'Upper band, held at the steady step for now: a rest window is active.',
      "Adds up to 10% a week, the plan's usual step.",
      loadTradeoff(),
    ])
    // the choice is the bold part of the first line, and the position in effect is not named bold
    const strong = Array.from(region.querySelectorAll('strong')).map((node) => node.textContent)
    expect(strong).toEqual(['Upper band'])
    expect(region.querySelector('strong')!.parentElement).toBe(region.querySelector('p'))
  })

  test('reads as before when the position applies as chosen: name and hint, then the trade-off', async () => {
    mockApi(routes(makeV2Plan({ load: load({ requested: 'standard', position: 'standard' }) })))
    renderPlan()
    const region = await panel()
    const [first, second, ...rest] = lines(region)
    expect(first).toMatch(
      /^Standard Adds up to \d+(\.\d+)?% a week while rebuilding toward a level held in the last 12 weeks\. /,
    )
    expect(second).toBe(loadTradeoff())
    expect(rest).toEqual([])
  })

  test('names Steady and its hint for a plan at the default, with no reason', async () => {
    mockApi(routes(makeV2Plan({ load: load() })))
    renderPlan()
    const region = await panel()
    expect(within(region).getByText('Steady')).toBeInTheDocument()
    expect(within(region).getByText("Adds up to 10% a week, the plan's usual step.")).toBeVisible()
    expect(
      within(region).queryByText(/held at the steady step|read as Standard/),
    ).not.toBeInTheDocument()
    expectCleanCopy(region)
  })

  test.each([
    [
      'standard',
      'Standard',
      /^Adds up to \d+(\.\d+)?% a week while rebuilding toward a level held in the last 12 weeks\. /,
    ],
    [
      'upper',
      'Upper band',
      /^Adds up to \d+(\.\d+)?% a week while rebuilding, the most the plan allows \(30% over two weeks\)\./,
    ],
  ] as const)(
    'names %s when it applies as chosen, with no reason',
    async (position, name, hint) => {
      mockApi(routes(makeV2Plan({ load: load({ requested: position, position }) })))
      renderPlan()
      const region = await panel()
      expect(within(region).getByText(name)).toBeInTheDocument()
      expect(within(region).getByText(hint)).toBeInTheDocument()
      expect(
        within(region).queryByText(/held at the steady step|read as Standard/),
      ).not.toBeInTheDocument()
      expectCleanCopy(region)
    },
  )

  const REASONS: Array<[LoadHold, string]> = [
    ['recent-injury', 'a recent injury is on file'],
    ['bone-stress', 'an earlier bone stress injury is on file'],
    ['bsi-factors', 'at least two risk factors for bone stress injury apply'],
    ['reds-hold', 'flags from the energy availability screening hold progression'],
    ['bone-pain', 'focal bone pain holds progression'],
    ['rest-window', 'a rest window is active'],
    ['post-race', 'the plan is in the weeks after a race'],
  ]

  test.each(REASONS)(
    'leads with the choice and the reason when %s holds the plan',
    async (held, reason) => {
      mockApi(
        routes(makeV2Plan({ load: load({ requested: 'standard', position: 'steady', held }) })),
      )
      renderPlan()
      const region = await panel()
      // the choice leads, then the step in effect; the position in effect is not in the lead
      expect(lines(region)).toEqual([
        `Standard, held at the steady step for now: ${reason}.`,
        "Adds up to 10% a week, the plan's usual step.",
        loadTradeoff(),
      ])
      expect(within(region).getByText('Standard', { selector: 'strong' })).toBeInTheDocument()
      expectCleanCopy(region)
    },
  )

  test('leads with Upper band and the age when it is read as Standard', async () => {
    mockApi(
      routes(
        makeV2Plan({ load: load({ requested: 'upper', position: 'standard', ageCapped: true }) }),
      ),
    )
    renderPlan()
    const region = await panel()
    expect(lines(region)).toEqual([
      'Upper band, read as Standard: age 45 or over.',
      expect.stringMatching(/^Adds up to \d+(\.\d+)?% a week while rebuilding toward a level/),
      loadTradeoff(),
    ])
    expect(within(region).getByText('Upper band', { selector: 'strong' })).toBeInTheDocument()
    expectCleanCopy(region)
  })

  test('shows the position from the payload and no panel without one', async () => {
    mockApi(routes(makeV2Plan({ load: null })))
    renderPlan()
    await screen.findByRole('region', { name: 'Feasibility' })
    expect(screen.queryByRole('region', { name: 'Load setting' })).not.toBeInTheDocument()
  })

  test('Regenerate plan starts from the position the plan was set to, even while it is held', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(
        makeV2Plan({
          load: load({ requested: 'standard', position: 'steady', held: 'rest-window' }),
        }),
        { 'POST /api/plan/generate': () => ({ status: 201, body: makeV2Plan() }) },
      ),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: 'Regenerate plan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Regenerate plan' })
    expect(within(dialog).getByRole('radio', { name: 'Standard' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/plan/generate')).toBe(true)
    })
    expect(calls.find((c) => c.url === '/api/plan/generate')?.body).toMatchObject({
      options: { loadAppetite: 'standard' },
    })
  })

  test.each([
    ['3:1', 'Every 4th week'],
    ['2:1', 'Every 3rd week'],
  ] as const)(
    'Regenerate plan starts from the %s cycle the plan holds and sends it again',
    async (stored, name) => {
      const user = userEvent.setup()
      const { calls } = mockApi(
        routes(makeV2Plan({ recoveryCycle: stored }), {
          'POST /api/plan/generate': () => ({ status: 201, body: makeV2Plan() }),
        }),
      )
      renderPlan()
      await user.click(await screen.findByRole('button', { name: 'Regenerate plan' }))
      const dialog = await screen.findByRole('dialog', { name: 'Regenerate plan' })
      expect(within(dialog).getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true')
      expect(within(dialog).getByRole('radio', { name: 'Let the plan decide' })).toHaveAttribute(
        'aria-checked',
        'false',
      )
      await user.click(within(dialog).getByRole('button', { name: 'Generate plan' }))
      await waitFor(() => {
        expect(calls.some((c) => c.method === 'POST' && c.url === '/api/plan/generate')).toBe(true)
      })
      expect(calls.find((c) => c.url === '/api/plan/generate')?.body).toMatchObject({
        options: { recoveryCycle: stored },
      })
    },
  )

  test('Regenerate plan starts on "Let the plan decide" when the plan holds no cycle, and sends none', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(makeV2Plan({ recoveryCycle: null }), {
        'POST /api/plan/generate': () => ({ status: 201, body: makeV2Plan() }),
      }),
    )
    renderPlan()
    await user.click(await screen.findByRole('button', { name: 'Regenerate plan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Regenerate plan' })
    expect(within(dialog).getByRole('radio', { name: 'Let the plan decide' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Generate plan' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.url === '/api/plan/generate')).toBe(true)
    })
    const body = calls.find((c) => c.url === '/api/plan/generate')?.body as {
      options: Record<string, unknown>
    }
    expect('recoveryCycle' in body.options).toBe(false)
  })
})

// A loading week run past its plan is taken as run (rules g-2, g-6): the stored target and baseline
// are the minutes run (144), and the payload states the plan (79). The page shows the plan in the
// target column, the minutes run in the run column with a note, and edits at the planned figure.
describe('Plan page, a week run past its plan', () => {
  const CURRENT = '2027-01-11'
  const overshot = (over: Parameters<typeof makeV2Week>[1] = {}) =>
    makeV2Week(1, {
      targetRunMin: 144,
      baselineRunMin: 144,
      plannedRunMin: 79,
      overshoot: true,
      flags: ['overshoot', 'planned-79'],
      ...over,
    })
  const plan = (week = overshot()) => makeV2Plan({ weeks: [makeV2Week(0), week, makeV2Week(2)] })
  const withRuns = (extra: MockRoutes = {}) =>
    routes(plan(), {
      'GET /api/weeks': () => [
        makeWeekRow({ weekStart: '2027-01-04', runMin: 280 }),
        makeWeekRow({ weekStart: CURRENT, runMin: 144 }),
      ],
      'PUT /api/plan/weeks/2027-01-11': () => overshot(),
      ...extra,
    })
  const row = (weekStart: string) =>
    document.querySelector<HTMLElement>(`tr[data-week="${weekStart}"]`)!
  const cell = (weekStart: string, name: string) =>
    row(weekStart).querySelector<HTMLElement>(`[data-cell="${name}"]`)!

  test('shows the planned figure as the target, and the minutes run with how far they lie over it', async () => {
    mockApi(withRuns())
    renderPlan()
    await screen.findByText('Week focus 1')
    await waitFor(() => {
      expect(cell(CURRENT, 'actual')).toHaveTextContent('2.4 h')
    })

    // 79 minutes is 1.3 hours; the raised target of 144 minutes (2.4 hours) is not shown as one.
    expect(cell(CURRENT, 'target').textContent?.trim()).toBe('1.3\u00a0h')
    expect(cell(CURRENT, 'target')).not.toHaveTextContent('2.4')
    expect(cell(CURRENT, 'actual').textContent).toBe('2.4\u00a0h1.1 h over the plan')
    expect(within(row(CURRENT)).getAllByText('1.1 h over the plan')).toHaveLength(1)
    expect(screen.getAllByText(/over the plan/)).toHaveLength(1)
    expectCleanCopy(document.body)
  })

  test('leaves a week that was not run past its plan exactly as it was', async () => {
    mockApi(withRuns())
    renderPlan()
    await screen.findByText('Week focus 1')
    await waitFor(() => {
      expect(cell('2027-01-04', 'actual')).toHaveTextContent('4.7 h')
    })

    // The row text of a normal week, target and run beside each other: no note, no extra element.
    expect(cell('2027-01-04', 'target').textContent?.trim()).toBe('5.0\u00a0h')
    expect(cell('2027-01-04', 'actual').textContent).toBe('4.7\u00a0h')
    expect(row('2027-01-04').textContent).toBe(
      '4 JanBase 5.0\u00a0h4.7\u00a0hLong run 90\u00a0min, 4 run days, strength 190\u00a0min—41Week focus 0DaysEdit',
    )
    expect(cell('2027-01-18', 'target').textContent?.trim()).toBe('5.0\u00a0h')
    expect(cell('2027-01-18', 'actual').textContent).toBe('')
  })

  test('says nothing more of the week once the minutes run no longer lie over the plan', async () => {
    mockApi(
      withRuns({
        'GET /api/weeks': () => [makeWeekRow({ weekStart: CURRENT, runMin: 60 })],
      }),
    )
    renderPlan()
    await screen.findByText('Week focus 1')
    await waitFor(() => {
      expect(cell(CURRENT, 'actual')).toHaveTextContent('1.0 h')
    })
    expect(cell(CURRENT, 'target').textContent?.trim()).toBe('1.3\u00a0h')
    expect(screen.queryByText(/over the plan/)).not.toBeInTheDocument()
  })

  test('the editor opens at the planned figure and words the baseline as the plan', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(withRuns())
    renderPlan()
    await screen.findByText('Week focus 1')

    await user.click(screen.getByRole('button', { name: 'Edit week of 11 Jan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit week of 11 Jan' })
    expect(within(dialog).getByLabelText('Target (minutes)')).toHaveValue(79)
    expect(
      within(dialog).getByText('Planned before the week was run: 1.3 h (79 min)'),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText(/Generated baseline/)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Reset to baseline' })).toBeDisabled()
    expectCleanCopy(dialog)

    // Saving what the sheet shows changes no target and asks for no note.
    await user.clear(within(dialog).getByLabelText('Long run (minutes)'))
    await user.type(within(dialog).getByLabelText('Long run (minutes)'), '95')
    await user.click(within(dialog).getByRole('button', { name: 'Save week' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    })
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      url: '/api/plan/weeks/2027-01-11',
      body: { longRunMin: 95 },
    })
    expect(calls.find((c) => c.method === 'PUT')?.body).not.toHaveProperty('targetRunMin')
  })

  test('a target typed over the planned figure is an override and needs its note, as for any week', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(withRuns())
    renderPlan()
    await screen.findByText('Week focus 1')

    await user.click(screen.getByRole('button', { name: 'Edit week of 11 Jan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit week of 11 Jan' })
    const target = within(dialog).getByLabelText('Target (minutes)')
    await user.clear(target)
    await user.type(target, '90')
    await user.click(within(dialog).getByRole('button', { name: 'Save week' }))
    expect(await within(dialog).findByText('Add a note explaining the change')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)

    await user.type(within(dialog).getByLabelText('Override note'), 'Race on Saturday')
    await user.click(within(dialog).getByRole('button', { name: 'Save week' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    })
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      url: '/api/plan/weeks/2027-01-11',
      body: { targetRunMin: 90, overrideNote: 'Race on Saturday' },
    })
  })

  test('an override on the week resets to the stored baseline, and the row still shows the plan', async () => {
    const user = userEvent.setup()
    const edited = overshot({
      targetRunMin: 100,
      plannedRunMin: 79,
      targetSource: 'override',
      overrideNote: 'Travel week',
    })
    const { calls } = mockApi(
      routes(plan(edited), {
        'GET /api/weeks': () => [makeWeekRow({ weekStart: CURRENT, runMin: 144 })],
        'PUT /api/plan/weeks/2027-01-11': () => edited,
      }),
    )
    renderPlan()
    await screen.findByText('Week focus 1')
    await waitFor(() => {
      expect(cell(CURRENT, 'actual')).toHaveTextContent('2.4 h')
    })

    // The planned figure stands in the target column, with the "edited" marker and no struck
    // baseline: the stored baseline is the minutes run, not a figure the plan ever held.
    expect(cell(CURRENT, 'target')).toHaveTextContent('1.3 h')
    expect(within(row(CURRENT)).getByRole('button', { name: 'edited' })).toBeInTheDocument()
    expect(row(CURRENT).querySelector('s')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit week of 11 Jan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit week of 11 Jan' })
    expect(within(dialog).getByLabelText('Target (minutes)')).toHaveValue(79)
    await user.click(within(dialog).getByRole('button', { name: 'Reset to baseline' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    })
    // The server compares with the stored baseline, so that is what is sent.
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ targetRunMin: 144 })
  })

  test('a normal week keeps its generated baseline in the editor', async () => {
    const user = userEvent.setup()
    mockApi(withRuns())
    renderPlan()
    await screen.findByText('Week focus 1')

    await user.click(screen.getByRole('button', { name: 'Edit week of 18 Jan' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit week of 18 Jan' })
    expect(within(dialog).getByLabelText('Target (minutes)')).toHaveValue(300)
    expect(within(dialog).getByText('Generated baseline: 5.0 h (300 min)')).toBeInTheDocument()
    expect(within(dialog).queryByText(/Planned before the week was run/)).not.toBeInTheDocument()
  })
})

describe('Plan page, changing the load setting', () => {
  const load = (over: Partial<LoadPosition> = {}): LoadPosition => ({
    requested: 'steady',
    position: 'steady',
    held: null,
    ageCapped: false,
    ...over,
  })
  const changed = (loadAppetite: string) => ({ loadAppetite, revision: null })
  const putLoad = (calls: Array<{ method: string; url: string }>) =>
    calls.filter((c) => c.method === 'PUT' && c.url === '/api/plan/load')

  async function openSheet(user: ReturnType<typeof userEvent.setup>) {
    const panel = await screen.findByRole('region', { name: 'Load setting' })
    await user.click(within(panel).getByRole('button', { name: 'Change' }))
    return screen.findByRole('dialog', { name: 'Change load setting' })
  }

  test('shows the panel for a plan with no stored option, as Steady, with its Change action', async () => {
    // a plan whose options hold no position reads as Steady (`parsePlanOptions`), so the server
    // names it and the panel shows
    mockApi(routes(makeV2Plan()))
    renderPlan()
    const panel = await screen.findByRole('region', { name: 'Load setting' })
    expect(within(panel).getByText('Steady')).toBeInTheDocument()
    expect(within(panel).getByText("Adds up to 10% a week, the plan's usual step.")).toBeVisible()
    expect(within(panel).getByRole('button', { name: 'Change' })).toBeEnabled()
    expectCleanCopy(panel)
  })

  test('Change opens a sheet with the three positions, their hints, the age line and the trade-off', async () => {
    const user = userEvent.setup()
    mockApi(routes(makeV2Plan()))
    renderPlan()
    const dialog = await openSheet(user)

    // the Generate form's field: one radio group, the three positions, Steady chosen
    const group = within(dialog).getByRole('radiogroup', { name: 'Load' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Steady', 'Standard', 'Upper band'])
    expect(within(group).getByRole('radio', { name: 'Steady' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(within(dialog).getByText("Adds up to 10% a week, the plan's usual step.")).toBeVisible()
    expect(within(dialog).getByText(loadTradeoff())).toBeVisible()
    expect(within(dialog).queryByText(/At age 45 or over/)).not.toBeInTheDocument()

    await user.click(within(group).getByRole('radio', { name: 'Standard' }))
    expect(
      within(dialog).getByText(
        /^Adds up to \d+(\.\d+)?% a week while rebuilding toward a level held in the last 12 weeks\./,
      ),
    ).toBeVisible()
    await user.click(within(group).getByRole('radio', { name: 'Upper band' }))
    expect(
      within(dialog).getByText(/^Adds up to \d+(\.\d+)?% a week while rebuilding, the most/),
    ).toBeVisible()
    expect(
      within(dialog).getByText('At age 45 or over, Upper band is held at Standard.'),
    ).toBeVisible()
    expectCleanCopy(dialog)
  })

  test('Apply sends the position in one request, reads the plan again and closes the sheet', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(makeV2Plan(), { 'PUT /api/plan/load': () => changed('standard') }),
    )
    renderPlan()
    const dialog = await openSheet(user)
    await user.click(within(dialog).getByRole('radio', { name: 'Standard' }))
    const before = calls.length
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Change load setting' })).not.toBeInTheDocument()
    })
    expect(putLoad(calls)).toHaveLength(1)
    expect(putLoad(calls)[0]).toMatchObject({ body: { loadAppetite: 'standard' } })
    // the plan, its revisions and the readers that follow the plan are asked for again
    await waitFor(() => {
      const after = calls.slice(before).map((c) => c.url)
      expect(after).toContain('/api/plan')
      expect(after).toContain('/api/plan/revisions')
    })
    expect(await screen.findByText('Load setting changed')).toBeInTheDocument()
  })

  const withSummary = (loadAppetite: LoadAppetite, summary: string) => ({
    loadAppetite,
    revision: makeRevision({ id: 'load-1', reason: 'owner', auto: false, summary }),
  })

  test('the toast after Apply states the summary of the revision for a position that applies', async () => {
    const user = userEvent.setup()
    const summary = loadSettingSummary(load({ requested: 'standard', position: 'standard' }))
    expect(summary).toBe(
      'Load setting changed to Standard: weeks ahead add up to 12% while rebuilding.',
    )
    mockApi(routes(makeV2Plan(), { 'PUT /api/plan/load': () => withSummary('standard', summary) }))
    renderPlan()
    const dialog = await openSheet(user)
    await user.click(within(dialog).getByRole('radio', { name: 'Standard' }))
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
    const toast = await screen.findByRole('status')
    await waitFor(() => {
      expect(toast).toHaveTextContent(summary)
    })
    expect(screen.queryByText('Load setting changed')).not.toBeInTheDocument()
    expectCleanCopy(toast)
  })

  test('the toast after Apply says why a held position does not apply, at once', async () => {
    const user = userEvent.setup()
    const held = load({ requested: 'upper', position: 'steady', held: 'recent-injury' })
    const summary = loadSettingSummary(held)
    expect(summary).toBe(
      'Load setting changed to Upper band. The steady step applies for now: a recent injury is on file.',
    )
    mockApi(
      routes(makeV2Plan({ load: load() }), {
        'PUT /api/plan/load': () => withSummary('upper', summary),
      }),
    )
    renderPlan()
    const dialog = await openSheet(user)
    await user.click(within(dialog).getByRole('radio', { name: 'Upper band' }))
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
    const toast = await screen.findByRole('status')
    await waitFor(() => {
      expect(toast).toHaveTextContent(summary)
    })
    expect(toast).toHaveTextContent('The steady step applies for now: a recent injury is on file.')
    expectCleanCopy(toast)
  })

  test('the position the plan is set to disables Apply, also while it is held, and sends nothing', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(
      routes(
        makeV2Plan({
          load: load({ requested: 'standard', position: 'steady', held: 'rest-window' }),
        }),
      ),
    )
    renderPlan()
    const dialog = await openSheet(user)
    const apply = within(dialog).getByRole('button', { name: 'Apply' })
    // the sheet starts from what the plan was set to, not from what applies
    expect(within(dialog).getByRole('radio', { name: 'Standard' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(apply).toBeDisabled()
    await user.click(within(dialog).getByRole('radio', { name: 'Steady' }))
    expect(apply).toBeEnabled()
    await user.click(within(dialog).getByRole('radio', { name: 'Standard' }))
    expect(apply).toBeDisabled()
    await user.click(apply)
    expect(putLoad(calls)).toHaveLength(0)
  })

  test('Cancel closes the sheet and sends nothing', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi(routes(makeV2Plan()))
    renderPlan()
    const dialog = await openSheet(user)
    await user.click(within(dialog).getByRole('radio', { name: 'Upper band' }))
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Change load setting' })).not.toBeInTheDocument()
    expect(putLoad(calls)).toHaveLength(0)
  })

  test('a refusal is said in the sheet, which stays open', async () => {
    const user = userEvent.setup()
    mockApi(
      routes(makeV2Plan(), {
        'PUT /api/plan/load': () => ({
          status: 422,
          body: {
            error: {
              code: 'validation',
              message: 'The plan did not pass the plan checks, so it was not published.',
            },
          },
        }),
      }),
    )
    renderPlan()
    const dialog = await openSheet(user)
    await user.click(within(dialog).getByRole('radio', { name: 'Upper band' }))
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('The plan did not pass the plan checks')
    expect(screen.getByRole('dialog', { name: 'Change load setting' })).toBeInTheDocument()
    expectCleanCopy(dialog)
  })
})

describe('Plan page, version-1 plans', () => {
  test('stay as before: no feasibility, no checks, no day cards, no revisions request', async () => {
    const { calls } = mockApi(routes(makeV1Plan()))
    renderPlan()
    await screen.findByText('Week focus 0')
    expect(screen.queryByRole('region', { name: 'Feasibility' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Plan checks' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Days for week/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Update plan from latest data' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Not 100%' })).not.toBeInTheDocument()
    expect(calls.some((c) => c.url.startsWith('/api/plan/revisions'))).toBe(false)
    expect(calls.some((c) => c.url.startsWith('/api/plan/disruptions'))).toBe(false)
  })
})
