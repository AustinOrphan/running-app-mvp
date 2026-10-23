import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  PlanPreview,
  PlanRevisionReason,
  PlanRevisionView,
  UndoReasonCode,
  UndoResult,
} from '../../shared/types.ts'
import { useMarkRevisionsSeen } from '../../web/api/plan.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { PlanDiffView } from '../../web/components/revisions/PlanDiffView.tsx'
import { RevisionDiff } from '../../web/components/revisions/RevisionDiff.tsx'
import { UndoControl } from '../../web/components/revisions/UndoControl.tsx'
import { expectCleanCopy, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import {
  AVAILABLE,
  makeBrief,
  makeDiff,
  makeLine,
  makeRevision,
  makeWeekLine,
} from './plan-fixtures.ts'

// Wednesday 13 Jan 2027, noon. The revision was written on Sunday 10 Jan at noon UTC, which is that
// day in every zone the suite is likely to run in.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-13T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

const WRITTEN = '2027-01-10T12:00:00.000Z'

/** Seven changed sessions, one a day from Monday 11 Jan, so the list is longer than five rows. */
function manyLines(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeLine({
      externalId: `x${String(i)}`,
      date: `2027-01-${String(11 + i).padStart(2, '0')}`,
      before: makeBrief({ date: `2027-01-${String(11 + i).padStart(2, '0')}`, durationMin: 50 }),
      after: makeBrief({ date: `2027-01-${String(11 + i).padStart(2, '0')}`, durationMin: 40 }),
    }),
  )
}

function revisionWithDiff(over: Partial<PlanRevisionView> = {}): PlanRevisionView {
  const lines = [
    makeLine({
      externalId: 'x1',
      date: '2027-01-14',
      before: makeBrief({ durationMin: 40 }),
      after: makeBrief({ kind: 'easy', title: 'Easy run', durationMin: 30 }),
      fields: ['kind', 'durationMin'],
    }),
  ]
  return makeRevision({
    id: 'r1',
    createdAt: WRITTEN,
    reason: 'weekly',
    auto: true,
    summary: "1 change across 1 week. Last week's decision: hold, next week up to 270 min.",
    changes: [
      { weekStart: '2027-01-11', field: 'targetRunMin', from: 300, to: 270, rules: ['g-2'] },
    ],
    decision: { decision: 'hold', signals: [], nextWeekTargetMin: 270 },
    diff: makeDiff(lines, [makeWeekLine()]),
    causes: { sessions: { x1: ['decision-hold'] }, weeks: { '2027-01-11': ['decision-hold'] } },
    undo: AVAILABLE,
    seenAt: null,
    ...over,
  })
}

function previewOf(over: Partial<PlanPreview> = {}): PlanPreview {
  return {
    action: { type: 'undo', revisionId: 'r1' },
    diff: makeDiff([
      makeLine({
        externalId: 'x1',
        date: '2027-01-14',
        before: makeBrief({ kind: 'easy', title: 'Easy run', durationMin: 30 }),
        after: makeBrief({ durationMin: 40 }),
      }),
    ]),
    summary: 'Undid: 1 change across 1 week.',
    warnings: [],
    blocked: false,
    guards: [],
    reasons: [],
    hash: 'a'.repeat(64),
    today: '2027-01-13',
    ...over,
  }
}

describe('PlanDiffView', () => {
  test('lists weeks as running time before and after and sessions as from and to', () => {
    const diff = makeDiff(
      [
        makeLine({
          externalId: 'x1',
          date: '2027-01-14',
          before: makeBrief({ durationMin: 40 }),
          after: makeBrief({ kind: 'easy', title: 'Easy run', durationMin: 30 }),
          fields: ['kind', 'durationMin'],
        }),
        makeLine({
          change: 'added',
          externalId: 'x2',
          date: '2027-01-16',
          before: null,
          after: makeBrief({
            date: '2027-01-16',
            kind: 'long',
            title: 'Long run',
            durationMin: 105,
          }),
        }),
        makeLine({
          change: 'removed',
          externalId: 'x3',
          date: '2027-01-17',
          before: makeBrief({
            date: '2027-01-17',
            kind: 'easy',
            title: 'Easy run',
            durationMin: 45,
          }),
          after: null,
        }),
      ],
      [makeWeekLine()],
    )
    render(<PlanDiffView diff={diff} units="km" />)
    const list = screen.getByRole('list', { name: 'Changes in this update' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Week of 11 Jan: running time 300 min to 270 min',
      'Thu 14 Jan: Threshold intervals 40 min to Easy run 30 min',
      'Sat 16 Jan: Long run 105 min, added',
      'Sun 17 Jan: Easy run 45 min, taken out',
    ])
    expectCleanCopy(list)
  })

  test('shows a session on another day as moved', () => {
    const diff = makeDiff([
      makeLine({
        change: 'removed',
        externalId: 'a',
        date: '2027-01-12',
        before: makeBrief({ date: '2027-01-12' }),
        after: null,
      }),
      makeLine({
        change: 'added',
        externalId: 'b',
        date: '2027-01-14',
        before: null,
        after: makeBrief({ date: '2027-01-14' }),
      }),
    ])
    render(<PlanDiffView diff={diff} units="km" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(
      screen.getByText('Thu 14 Jan: Threshold intervals 40 min, moved from Tue 12 Jan'),
    ).toBeInTheDocument()
  })

  test('reads distances and climbs in miles and feet when the runner uses miles', () => {
    const diff = makeDiff([
      makeLine({
        before: makeBrief({ distanceM: 8000, gainM: 100 }),
        after: makeBrief({ distanceM: 8000, gainM: 200 }),
        fields: ['gainM'],
      }),
    ])
    const { rerender } = render(<PlanDiffView diff={diff} units="mi" />)
    expect(
      screen.getByText(
        'Thu 14 Jan: Threshold intervals 40 min, 5 mi, 328 ft to Threshold intervals 40 min, 5 mi, 656 ft',
      ),
    ).toBeInTheDocument()
    rerender(<PlanDiffView diff={diff} units="km" />)
    expect(
      screen.getByText(
        'Thu 14 Jan: Threshold intervals 40 min, 8 km, 100 m to Threshold intervals 40 min, 8 km, 200 m',
      ),
    ).toBeInTheDocument()
  })

  test('shows five rows, then "Show all N changes", and folds back', async () => {
    const user = userEvent.setup()
    render(<PlanDiffView diff={makeDiff(manyLines(7))} units="km" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    const more = screen.getByRole('button', { name: 'Show all 7 changes' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await user.click(more)
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    const fewer = screen.getByRole('button', { name: 'Show fewer changes' })
    expect(fewer).toHaveAttribute('aria-expanded', 'true')
    await user.click(fewer)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  test('has no button when everything fits, and says so for a diff with nothing in it', () => {
    const { rerender } = render(<PlanDiffView diff={makeDiff(manyLines(5))} units="km" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<PlanDiffView diff={makeDiff([])} units="km" />)
    expect(screen.getByText('No changes to the plan.')).toBeInTheDocument()
  })

  test('counts a folded move once in "Show all N changes"', () => {
    const lines = [
      makeLine({
        change: 'removed',
        externalId: 'a',
        date: '2027-01-12',
        before: makeBrief({ date: '2027-01-12' }),
        after: null,
      }),
      makeLine({
        change: 'added',
        externalId: 'b',
        date: '2027-01-14',
        before: null,
        after: makeBrief({ date: '2027-01-14' }),
      }),
      ...manyLines(5).map((line, i) => ({ ...line, externalId: `m${String(i)}` })),
    ]
    render(<PlanDiffView diff={makeDiff(lines)} units="km" />)
    expect(screen.getByRole('button', { name: 'Show all 6 changes' })).toBeInTheDocument()
  })
})

describe('RevisionDiff', () => {
  test('shows the reason, the day, the stored summary, the cause once, the rows and the undo', () => {
    mockApi({})
    renderWithProviders(<RevisionDiff revision={revisionWithDiff()} units="km" onWhy={() => {}} />)
    expect(screen.getByText('Weekly update')).toBeInTheDocument()
    expect(screen.getByText('10 Jan')).toBeInTheDocument()
    expect(
      screen.getByText(
        "1 change across 1 week. Last week's decision: hold, next week up to 270 min.",
      ),
    ).toBeInTheDocument()
    // Both rows share one cause, so it is said once and not under each row.
    expect(
      screen.getAllByText('Last week called for holding steady, so the plan did not step up.'),
    ).toHaveLength(1)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Undo update' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Why this update' })).toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('names the cause under each row when the rows have different causes', () => {
    mockApi({})
    const revision = revisionWithDiff({
      causes: { sessions: { x1: ['trim', 'decision-hold'] }, weeks: { '2027-01-11': ['ramp'] } },
    })
    renderWithProviders(<RevisionDiff revision={revision} units="km" />)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Week of 11 Jan: running time 300 min to 270 min')
    expect(rows[0]).toHaveTextContent('The weekly build moved with your recent running.')
    expect(rows[1]).toHaveTextContent(
      'The next quality session is a little shorter. Last week called for holding steady, so the plan did not step up.',
    )
    expectCleanCopy(document.body)
  })

  test('marks a revision nobody has opened as New, and not one that was opened', () => {
    mockApi({})
    const opened = '2027-01-11T08:00:00.000Z'
    const cases: Array<[string, PlanRevisionView, boolean | undefined, boolean]> = [
      ['unseen', revisionWithDiff({ seenAt: null }), undefined, true],
      ['seen', revisionWithDiff({ seenAt: opened }), undefined, false],
      // A surface that stamps the revision when it opens keeps the marker it had on arrival.
      ['seen, marked on arrival', revisionWithDiff({ seenAt: opened }), true, true],
      ['unseen, marker off', revisionWithDiff({ seenAt: null }), false, false],
    ]
    for (const [name, revision, isNew, shown] of cases) {
      const { unmount } = renderWithProviders(
        <RevisionDiff revision={revision} units="km" isNew={isNew} />,
      )
      expect(screen.queryByText('New') !== null, name).toBe(shown)
      unmount()
    }
  })

  test('labels every reason a revision can have', () => {
    mockApi({})
    const labels: Record<PlanRevisionReason, string> = {
      generate: 'Plan generated',
      weekly: 'Weekly update',
      review: 'After a review',
      owner: 'Your edit',
      break: 'Restart after a break',
      disruption: 'Rest window',
      undo: 'Undo',
      'goal-switch': 'New plan for another goal',
    }
    for (const [reason, label] of Object.entries(labels)) {
      const { unmount } = renderWithProviders(
        <RevisionDiff
          revision={makeRevision({ reason: reason as PlanRevisionReason })}
          units="km"
        />,
      )
      expect(screen.getByText(label, { selector: 'strong' }), reason).toBeInTheDocument()
      unmount()
    }
  })

  test('shows the week-level changes of a revision from before the revision model', () => {
    mockApi({})
    renderWithProviders(
      <RevisionDiff
        revision={makeRevision({
          changes: [
            { weekStart: '2027-01-18', field: 'targetRunMin', from: 330, to: 300, rules: ['j-5'] },
            {
              weekStart: '2027-01-11',
              field: 'zones.thresholdPace.declined',
              from: 330,
              to: 320,
              rules: [],
            },
          ],
        })}
        units="km"
      />,
    )
    const list = screen.getByRole('list', { name: 'Changes in this update' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Week of 18 Jan: Weekly running time 330 min to 300 min',
      expect.stringMatching(/^Week of 11 Jan: Declined proposal for threshold pace/),
    ])
    // Nothing to restore: the reason is a muted line, and there is no button.
    expect(screen.getByText('This update has nothing to restore.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo update' })).not.toBeInTheDocument()
  })

  test('passes the rules of the update to the Why control, the weekly decision included', async () => {
    mockApi({})
    const user = userEvent.setup()
    const onWhy = vi.fn()
    renderWithProviders(<RevisionDiff revision={revisionWithDiff()} units="km" onWhy={onWhy} />)
    await user.click(screen.getByRole('button', { name: 'Why this update' }))
    expect(onWhy).toHaveBeenCalledWith(['g-2', 'J5'])
  })

  test('has no Why control without a drawer to open, and none without a rule', () => {
    mockApi({})
    renderWithProviders(<RevisionDiff revision={revisionWithDiff()} units="km" />)
    expect(screen.queryByRole('button', { name: 'Why this update' })).not.toBeInTheDocument()
    renderWithProviders(
      <RevisionDiff revision={makeRevision({ changes: [] })} units="km" onWhy={() => {}} />,
    )
    expect(screen.queryByRole('button', { name: 'Why this update' })).not.toBeInTheDocument()
  })

  test('shows no list for a revision whose diff is empty, only its summary', () => {
    mockApi({})
    renderWithProviders(
      <RevisionDiff
        revision={revisionWithDiff({
          summary: 'No changes to the plan.',
          diff: makeDiff([]),
          causes: { sessions: {}, weeks: {} },
          undo: {
            available: false,
            reasons: [{ code: 'not-undoable', message: 'This update has nothing to restore.' }],
            undoneAt: null,
          },
        })}
        units="km"
      />,
    )
    expect(screen.getByText('No changes to the plan.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Changes in this update' })).not.toBeInTheDocument()
  })
})

describe('UndoControl, when the update cannot be undone', () => {
  const REASONS: Array<[UndoReasonCode, string]> = [
    ['already-undone', 'This update was already undone.'],
    ['is-undo', 'An undo cannot be undone.'],
    ['not-undoable', 'This update has nothing to restore.'],
    ['window-passed', 'The 7-day window for undoing this update has passed.'],
    ['plan-archived', 'This plan is archived, so its updates stay as they are.'],
    ['edited-since', 'Thu 14 Jan changed after this update, so it cannot be restored.'],
    ['session-run', 'A run is linked to Easy run on Thu 14 Jan, so this update stays.'],
    [
      'safety-rule',
      'This update followed a safety rule that still applies (illness), so it stays.',
    ],
    [
      'checklist',
      'The restored plan does not pass the quality checklist (progression), so the plan stays as it is.',
    ],
  ]

  test.each(REASONS)('says %s as a muted line from the reason the server gave', (code, message) => {
    mockApi({})
    renderWithProviders(
      <UndoControl
        revision={revisionWithDiff({
          undo: { available: false, reasons: [{ code, message }], undoneAt: null },
        })}
        units="km"
      />,
    )
    const list = screen.getByRole('list', { name: 'Why this cannot be undone' })
    expect(within(list).getByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo update' })).not.toBeInTheDocument()
    expectCleanCopy(list)
  })

  test('words a reason that arrives without a sentence, and a revision with no reason at all', () => {
    mockApi({})
    const first = renderWithProviders(
      <UndoControl
        revision={revisionWithDiff({
          undo: {
            available: false,
            reasons: [{ code: 'session-run', message: '' }],
            undoneAt: null,
          },
        })}
        units="km"
      />,
    )
    expect(
      screen.getByText('A run is linked to a session in this update, so it stays.'),
    ).toBeInTheDocument()
    first.unmount()
    renderWithProviders(
      <UndoControl
        revision={revisionWithDiff({ undo: { available: false, reasons: [], undoneAt: null } })}
        units="km"
      />,
    )
    expect(screen.getByText('This update has nothing to restore.')).toBeInTheDocument()
  })
})

function renderUndo(routes: MockRoutes, revision = revisionWithDiff(), units: 'km' | 'mi' = 'km') {
  const api = mockApi(routes)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <UndoControl revision={revision} units={units} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...api, invalidate }
}

const UNDO_OK: UndoResult = {
  revision: revisionWithDiff({
    id: 'r2',
    reason: 'undo',
    auto: false,
    undoOf: 'r1',
    undo: AVAILABLE,
  }),
  target: revisionWithDiff({ undo: { available: false, reasons: [], undoneAt: WRITTEN } }),
}

describe('UndoControl, when the update can be undone', () => {
  test('previews first: the restore diff and the confirm sentences, with nothing written yet', async () => {
    const user = userEvent.setup()
    const { calls } = renderUndo({ 'POST /api/plan/preview': () => previewOf() })
    await user.click(screen.getByRole('button', { name: 'Undo update' }))

    const dialog = await screen.findByRole('dialog', { name: 'Undo this update' })
    expect(calls).toEqual([
      { method: 'POST', url: '/api/plan/preview', body: { type: 'undo', revisionId: 'r1' } },
    ])
    expect(
      within(dialog).getByText('Put the plan back as it was before this update?'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Sessions you have run since stay as they are. Sessions before today stay as they are.',
      ),
    ).toBeInTheDocument()
    // The update was the scheduler's, so the confirm says the next one may make the same change.
    expect(
      within(dialog).getByText(
        'The next weekly update on Mon 18 Jan may make the same change if your data still points that way.',
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('Thu 14 Jan: Easy run 30 min to Threshold intervals 40 min'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Undo update' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Keep' })).toBeInTheDocument()
    expectCleanCopy(dialog)
  })

  test('leaves out the next-update sentence for a revision the runner asked for', async () => {
    const user = userEvent.setup()
    renderUndo(
      { 'POST /api/plan/preview': () => previewOf() },
      revisionWithDiff({ auto: false, reason: 'owner' }),
    )
    await user.click(screen.getByRole('button', { name: 'Undo update' }))
    const dialog = await screen.findByRole('dialog', { name: 'Undo this update' })
    await within(dialog).findByText('Put the plan back as it was before this update?')
    expect(within(dialog).queryByText(/The next weekly update/)).not.toBeInTheDocument()
  })

  test('moves focus into the confirm, and back to the button on Keep or Escape', async () => {
    const user = userEvent.setup()
    renderUndo({ 'POST /api/plan/preview': () => previewOf() })
    const opener = screen.getByRole('button', { name: 'Undo update' })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Undo this update' })
    expect(dialog).toHaveFocus()

    await within(dialog).findByRole('button', { name: 'Keep' })
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo update' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Undo update' }))
    await screen.findByRole('dialog', { name: 'Undo this update' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo update' })).toHaveFocus()
  })

  test('sends the hash of the preview, thanks the runner with a toast and refreshes what shows the plan', async () => {
    const user = userEvent.setup()
    const { calls, invalidate } = renderUndo({
      'POST /api/plan/preview': () => previewOf({ hash: 'b'.repeat(64) }),
      'POST /api/plan/revisions/r1/undo': () => UNDO_OK,
    })
    await user.click(screen.getByRole('button', { name: 'Undo update' }))
    const dialog = await screen.findByRole('dialog', { name: 'Undo this update' })
    await user.click(await within(dialog).findByRole('button', { name: 'Undo update' }))

    expect(
      await screen.findByText('Plan restored to how it was on Sun 10 Jan.'),
    ).toBeInTheDocument()
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      url: '/api/plan/revisions/r1/undo',
      body: { expectHash: 'b'.repeat(64) },
    })
    const keys = invalidate.mock.calls.map(
      ([filter]) => (filter as { queryKey: string[] }).queryKey[0],
    )
    // The windows and the reviews are read again too: undoing the update that added a window
    // withdraws it, and an undo moves the plan targets the reviews read.
    expect(keys.sort()).toEqual([
      'brief',
      'disruptions',
      'plan',
      'planRevisions',
      'reviews',
      'state',
      'today',
    ])
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test('shows a newer preview when the plan moved, and applies that one on the next tap', async () => {
    const user = userEvent.setup()
    let commits = 0
    const newer = previewOf({
      hash: 'c'.repeat(64),
      diff: makeDiff([
        makeLine({
          externalId: 'x9',
          date: '2027-01-15',
          before: makeBrief({
            date: '2027-01-15',
            kind: 'easy',
            title: 'Easy run',
            durationMin: 25,
          }),
          after: makeBrief({ date: '2027-01-15', durationMin: 40 }),
        }),
      ]),
    })
    const { calls } = renderUndo({
      'POST /api/plan/preview': () => previewOf(),
      'POST /api/plan/revisions/r1/undo': () => {
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
          : UNDO_OK
      },
    })
    await user.click(screen.getByRole('button', { name: 'Undo update' }))
    const dialog = await screen.findByRole('dialog', { name: 'Undo this update' })
    await user.click(await within(dialog).findByRole('button', { name: 'Undo update' }))

    expect(
      await within(dialog).findByText(
        'This preview is out of date. Review the new one before applying it.',
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('Fri 15 Jan: Easy run 25 min to Threshold intervals 40 min'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Plan restored/)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Undo update' }))
    await screen.findByText('Plan restored to how it was on Sun 10 Jan.')
    expect(calls.filter((c) => c.url.endsWith('/undo')).map((c) => c.body)).toEqual([
      { expectHash: 'a'.repeat(64) },
      { expectHash: 'c'.repeat(64) },
    ])
  })

  test('says why when the preview is already refused, and offers no confirm', async () => {
    const user = userEvent.setup()
    const { calls } = renderUndo({
      'POST /api/plan/preview': () =>
        previewOf({
          blocked: true,
          reasons: [
            {
              code: 'checklist',
              message:
                'The restored plan does not pass the quality checklist (progression), so the plan stays as it is.',
            },
          ],
        }),
    })
    await user.click(screen.getByRole('button', { name: 'Undo update' }))
    const dialog = await screen.findByRole('dialog', { name: 'Undo this update' })
    expect(
      await within(dialog).findByText('This update cannot be undone right now.'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'The restored plan does not pass the quality checklist (progression), so the plan stays as it is.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Undo update' })).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Keep')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls).toHaveLength(1)
    expectCleanCopy(document.body)
  })

  test('shows the reasons of a 409 and the checklist of a 422 as information', async () => {
    const user = userEvent.setup()
    let answer: 'reasons' | 'checklist' = 'reasons'
    renderUndo({
      'POST /api/plan/preview': () => previewOf(),
      'POST /api/plan/revisions/r1/undo': () =>
        answer === 'reasons'
          ? {
              status: 409,
              body: {
                error: {
                  code: 'conflict',
                  message: 'Thu 14 Jan changed after this update, so it cannot be restored.',
                  details: {
                    reasons: [
                      {
                        code: 'edited-since',
                        message: 'Thu 14 Jan changed after this update, so it cannot be restored.',
                      },
                    ],
                  },
                },
              },
            }
          : {
              status: 422,
              body: {
                error: {
                  code: 'validation',
                  message:
                    'The restored plan does not pass the quality checklist (progression), so the plan stays as it is.',
                  details: { checklist: [] },
                },
              },
            },
    })
    await user.click(screen.getByRole('button', { name: 'Undo update' }))
    const dialog = await screen.findByRole('dialog', { name: 'Undo this update' })
    await user.click(await within(dialog).findByRole('button', { name: 'Undo update' }))
    expect(
      await within(dialog).findByText(
        'Thu 14 Jan changed after this update, so it cannot be restored.',
      ),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Undo update' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    answer = 'checklist'
    await user.click(screen.getByRole('button', { name: 'Undo update' }))
    const again = await screen.findByRole('dialog', { name: 'Undo this update' })
    await user.click(await within(again).findByRole('button', { name: 'Undo update' }))
    expect(
      await within(again).findByText(/does not pass the quality checklist \(progression\)/),
    ).toBeInTheDocument()
  })

  test('says so when the preview or the undo could not be reached, and keeps the plan as it is', async () => {
    const user = userEvent.setup()
    let previews = 0
    renderUndo({
      'POST /api/plan/preview': () => {
        previews += 1
        return previews === 1
          ? { status: 500, body: { error: { code: 'internal', message: 'Boom.' } } }
          : previewOf()
      },
      'POST /api/plan/revisions/r1/undo': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Boom.' } },
      }),
    })
    await user.click(screen.getByRole('button', { name: 'Undo update' }))
    const first = await screen.findByRole('dialog', { name: 'Undo this update' })
    expect(await within(first).findByRole('alert')).toHaveTextContent(
      'The preview could not be loaded. Close this and try again.',
    )
    await user.click(within(first).getByRole('button', { name: 'Close' }))

    await user.click(screen.getByRole('button', { name: 'Undo update' }))
    const second = await screen.findByRole('dialog', { name: 'Undo this update' })
    await user.click(await within(second).findByRole('button', { name: 'Undo update' }))
    expect(await within(second).findByRole('alert')).toHaveTextContent(
      'The plan could not be restored. Try again.',
    )
    expectCleanCopy(document.body)
  })

  test('reads the preview in miles when the runner uses miles', async () => {
    const user = userEvent.setup()
    renderUndo(
      {
        'POST /api/plan/preview': () =>
          previewOf({
            diff: makeDiff([
              makeLine({
                before: makeBrief({ distanceM: 8000 }),
                after: makeBrief({ distanceM: 9000 }),
                fields: ['distanceM'],
              }),
            ]),
          }),
      },
      revisionWithDiff(),
      'mi',
    )
    await user.click(screen.getByRole('button', { name: 'Undo update' }))
    expect(
      await screen.findByText(
        'Thu 14 Jan: Threshold intervals 40 min, 5 mi to Threshold intervals 40 min, 5.6 mi',
      ),
    ).toBeInTheDocument()
  })
})

describe('useMarkRevisionsSeen', () => {
  function Harness({ batches }: { batches: string[][] }) {
    const markSeen = useMarkRevisionsSeen()
    return (
      <>
        {batches.map((ids, i) => (
          <button
            key={ids.join()}
            type="button"
            onClick={() => {
              markSeen(ids)
            }}
          >
            {`batch ${String(i)}`}
          </button>
        ))}
      </>
    )
  }

  test('sends each id once, and refreshes the revisions, the brief and Today', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({
      'POST /api/plan/revisions/a/seen': () => ({ status: 204, body: undefined }),
      'POST /api/plan/revisions/b/seen': () => ({ status: 204, body: undefined }),
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    render(
      <QueryClientProvider client={queryClient}>
        <Harness batches={[['a'], ['a', 'b'], []]} />
      </QueryClientProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'batch 0' }))
    await user.click(screen.getByRole('button', { name: 'batch 1' }))
    await user.click(screen.getByRole('button', { name: 'batch 2' }))
    await act(async () => {
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(calls.map((c) => c.url).sort()).toEqual([
        '/api/plan/revisions/a/seen',
        '/api/plan/revisions/b/seen',
      ])
    })
    await waitFor(() => {
      const keys = invalidate.mock.calls.map(([f]) => (f as { queryKey: string[] }).queryKey[0])
      expect(new Set(keys)).toEqual(new Set(['planRevisions', 'brief', 'today']))
    })
  })
})
