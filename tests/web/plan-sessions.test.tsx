import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
import { makeActivity } from '../factories.ts'
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
    expect(await within(dialog).findByText('Plan updated')).toBeInTheDocument()
    expect(calls.find((c) => c.url === '/api/plan/replan')?.body).toEqual({
      expectHash: 'a'.repeat(64),
    })
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/plan/revisions/r3/seen')).toBe(true)
    })
    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(
      screen.queryByRole('dialog', { name: 'Update plan from latest data' }),
    ).not.toBeInTheDocument()
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
