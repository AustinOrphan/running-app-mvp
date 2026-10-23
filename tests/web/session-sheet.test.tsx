import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PlanSession } from '../../shared/types.ts'
import { SessionSheet } from '../../web/components/SessionSheet.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { makeActivity } from '../factories.ts'
import {
  activityPage,
  explainOf,
  mockApi,
  renderWithProviders,
  type MockRoutes,
} from './helpers.tsx'
import {
  makeBrief,
  makeDiff,
  makeLine,
  makeRevision,
  makeSession,
  settings,
} from './plan-fixtures.ts'
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-13T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

const nearby = [
  makeActivity({ id: 'act1', date: '2027-01-13', durationSec: 3300, distanceM: 9100 }),
  makeActivity({ id: 'act2', date: '2027-01-12', durationSec: 1800, distanceM: 5000 }),
]

function renderSheet(session: PlanSession, extra: MockRoutes = {}) {
  const onClose = vi.fn()
  const api = mockApi({
    'GET /api/settings': () => settings,
    'GET /api/activities': () => activityPage(nearby),
    ...sheetRoutes([session]),
    ...extra,
  })
  renderWithProviders(
    <ToastProvider>
      <SessionSheet session={session} onClose={onClose} />
    </ToastProvider>,
  )
  return { ...api, onClose }
}

describe('SessionSheet', () => {
  test('shows the prescription: title, date, duration, distance, targets, steps and purpose', async () => {
    renderSheet(makeSession())
    const dialog = await screen.findByRole('dialog', { name: 'Threshold intervals' })
    expect(within(dialog).getByText(/Wed 13 Jan 2027/)).toBeInTheDocument()
    expect(within(dialog).getByText('55 min')).toBeInTheDocument()
    expect(await within(dialog).findByText('9.00 km')).toBeInTheDocument()
    expect(within(dialog).getByText('60 m')).toBeInTheDocument()
    expect(within(dialog).getByText('Zone 3')).toBeInTheDocument()
    expect(await within(dialog).findByText('6 to 7 out of 10')).toBeInTheDocument()
    expect(within(dialog).getByText('158 to 168 bpm')).toBeInTheDocument()
    expect(within(dialog).getByText('5:10 to 5:30 /km')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Warm afternoon: start the work reps by feel.'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Raise the pace you can hold for a long stretch without adding distance.',
      ),
    ).toBeInTheDocument()
    const steps = within(dialog)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(steps).toContain('Warm-up 15 min, Zone 1')
    expect(steps).toContain('3 x work 8 min, Zone 3')
    expect(steps).toContain('3 x recover 2 min, Zone 1')
    expect(steps).toContain('Cool-down 10 min, Zone 1')
  })

  test('a single work step starts with a capital letter', async () => {
    renderSheet(
      makeSession({
        structure: [{ kind: 'work', reps: 1, durationSec: 1200, distanceM: null, zone: 'z3' }],
      }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Work 20 min, Zone 3')).toBeInTheDocument()
  })

  test('converts distance and pace to miles when the runner uses miles', async () => {
    renderSheet(makeSession(), { 'GET /api/settings': () => ({ ...settings, units: 'mi' }) })
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('5.59 mi')).toBeInTheDocument()
    expect(await within(dialog).findByText('8:19 to 8:51 /mi')).toBeInTheDocument()
    // The climb follows the setting too: 60 m is 197 ft.
    expect(within(dialog).getByText('197 ft')).toBeInTheDocument()
    expect(within(dialog).queryByText('60 m')).not.toBeInTheDocument()
  })

  test('the why button opens the drawer on the session and its rule ids', async () => {
    const user = userEvent.setup()
    renderSheet(makeSession())
    const dialog = await screen.findByRole('dialog')
    expect(screen.queryByLabelText('Why drawer')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Why this session' }))
    const drawer = await screen.findByLabelText('Why drawer')
    expect(drawer).toHaveTextContent('e-2,f-1')
    expect(explainOf(drawer)).toEqual({ subject: 'session', id: 's1' })
  })

  test('shows the execution assessment in plain words, with no judging copy', async () => {
    renderSheet(
      makeSession({
        status: 'completed',
        activityId: 'act1',
        linkSource: 'auto',
        execution: {
          completion: 'completed',
          intensity: 'above',
          effort: {
            score: 1,
            confidence: 'moderate',
            parts: { rpeDelta: 1, feel: 1, hrResidualZ: null, paceResidualPct: null },
          },
          conditions: { wbgtC: 24, heatAdjusted: true, gradeAdjusted: false },
          flags: ['hr-unqualified'],
          lines: ['Felt harder than the plan expected on a warm day.'],
        },
      }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Completed as planned')).toBeInTheDocument()
    expect(within(dialog).getByText('Above the target zone')).toBeInTheDocument()
    expect(within(dialog).getByText(/Harder than expected/)).toBeInTheDocument()
    expect(within(dialog).getByText(/moderate confidence/)).toBeInTheDocument()
    expect(within(dialog).getByText(/WBGT 24/)).toBeInTheDocument()
    expect(within(dialog).getByText('Adjusted for heat')).toBeInTheDocument()
    expect(within(dialog).getByText('Heart rate not reliable enough to use')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Felt harder than the plan expected on a warm day.'),
    ).toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/behind|missed|streak/i)
  })

  describe('an effort verdict without a rating', () => {
    const unrated = {
      completion: 'completed',
      intensity: 'on',
      effort: {
        score: 1,
        confidence: 'low',
        parts: { rpeDelta: null, feel: null, hrResidualZ: 1.4, paceResidualPct: 4 },
      },
      conditions: { wbgtC: null, heatAdjusted: false, gradeAdjusted: false },
      flags: [],
      lines: [],
    } as const satisfies NonNullable<PlanSession['execution']>

    test('says a rating is what lets the plan adjust, and links to where to give it', async () => {
      renderSheet(
        makeSession({
          status: 'completed',
          activityId: 'act1',
          linkSource: 'auto',
          execution: unrated,
        }),
      )
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/Harder than expected, low confidence/)).toBeInTheDocument()
      const note = within(dialog).getByRole('note')
      expect(note).toHaveTextContent(
        "Rate this activity (effort or feel) so the plan can adjust. Without a rating, the plan's read of this activity stays a low-confidence guess from heart rate and pace, and the plan never changes because of it.",
      )
      expect(
        within(note).getByRole('link', { name: 'Open the activity to rate it.' }),
      ).toHaveAttribute('href', '/activities/act1')
      expect(dialog.textContent).not.toMatch(/behind|missed|streak/i)
    })

    test('with no score the note only asks', async () => {
      renderSheet(
        makeSession({
          status: 'completed',
          activityId: 'act1',
          execution: {
            ...unrated,
            effort: {
              ...unrated.effort,
              score: null,
              parts: { ...unrated.effort.parts, hrResidualZ: null, paceResidualPct: null },
            },
          },
        }),
      )
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Effort not assessed')).toBeInTheDocument()
      const note = within(dialog).getByRole('note')
      expect(note).toHaveTextContent('Rate this activity (effort or feel) so the plan can adjust.')
      expect(note).not.toHaveTextContent(/low-confidence guess/)
    })

    test('an activity of a different kind asks for a feel rating only', async () => {
      renderSheet(
        makeSession({
          status: 'completed',
          activityId: 'act1',
          execution: {
            ...unrated,
            completion: 'modified',
            intensity: 'unknown',
            effort: {
              score: null,
              confidence: 'low',
              parts: { rpeDelta: null, feel: null, hrResidualZ: null, paceResidualPct: null },
            },
          },
        }),
      )
      const dialog = await screen.findByRole('dialog')
      const note = within(dialog).getByRole('note')
      expect(note).toHaveTextContent('Rate how this activity felt so the plan can adjust.')
      expect(note).not.toHaveTextContent(/effort or feel/)
      expect(
        within(note).getByRole('link', { name: 'Open the activity to rate it.' }),
      ).toHaveAttribute('href', '/activities/act1')
    })

    test.each([
      ['an RPE', { rpeDelta: 1, feel: null }],
      ['a feel', { rpeDelta: null, feel: 1 }],
    ])('has no note once %s is behind the verdict', async (_name, rating) => {
      renderSheet(
        makeSession({
          status: 'completed',
          activityId: 'act1',
          execution: {
            ...unrated,
            effort: { ...unrated.effort, parts: { ...unrated.effort.parts, ...rating } },
          },
        }),
      )
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/Harder than expected/)).toBeInTheDocument()
      expect(within(dialog).queryByRole('note')).not.toBeInTheDocument()
      expect(within(dialog).queryByText(/Rate this activity/)).not.toBeInTheDocument()
    })
  })

  test('a linked activity is described and can be unlinked', async () => {
    const user = userEvent.setup()
    const { calls } = renderSheet(
      makeSession({ status: 'completed', activityId: 'act1', linkSource: 'owner' }),
      { 'POST /api/plan/sessions/s1/link': () => makeSession() },
    )
    const dialog = await screen.findByRole('dialog')
    const linked = await within(dialog).findByRole('link', { name: /Wed 13 Jan/ })
    expect(linked).toHaveAttribute('href', '/activities/act1')
    expect(within(dialog).getByText(/Linked by you/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Unlink' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true)
    })
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: '/api/plan/sessions/s1/link',
      body: { activityId: null },
    })
  })

  test('an unlinked session offers nearby activities to link', async () => {
    const user = userEvent.setup()
    const { calls } = renderSheet(makeSession(), {
      'POST /api/plan/sessions/s1/link': () => makeSession({ activityId: 'act2' }),
    })
    const dialog = await screen.findByRole('dialog')
    const select = await within(dialog).findByLabelText('Link an activity')
    expect(calls.find((c) => c.url.startsWith('/api/activities'))?.url).toBe(
      '/api/activities?from=2027-01-06&to=2027-01-20&limit=500&offset=0',
    )
    const link = within(dialog).getByRole('button', { name: 'Link' })
    expect(link).toBeDisabled()
    await user.selectOptions(select, 'act2')
    await user.click(link)
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true)
    })
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ activityId: 'act2' })
  })

  test('holds the change section: a move is asked about, applied with its hash, and the sheet stays', async () => {
    const user = userEvent.setup()
    const dry = {
      allowed: true,
      guards: [],
      diff: makeDiff([
        makeLine({
          externalId: 'x1',
          sessionId: 's1',
          date: '2027-01-15',
          before: makeBrief({ date: '2027-01-13' }),
          after: makeBrief({ date: '2027-01-15' }),
          fields: ['date'],
        }),
      ]),
      session: makeSession({ date: '2027-01-15', status: 'moved' }),
      revision: null,
      hash: '1'.repeat(64),
    }
    const { calls, onClose } = renderSheet(makeSession(), {
      'POST /api/plan/sessions/s1/adjust': ({ body }) =>
        (body as { dryRun?: boolean }).dryRun === true
          ? dry
          : {
              ...dry,
              revision: makeRevision({
                id: 'r5',
                reason: 'owner',
                auto: false,
                summary: 'Moved Threshold intervals from Wed 13 Jan to Fri 15 Jan.',
                seenAt: null,
              }),
            },
      'POST /api/plan/revisions/r5/seen': () => ({ status: 204, body: undefined }),
    })
    const dialog = await screen.findByRole('dialog')
    const section = within(dialog).getByRole('region', { name: 'Change this session' })
    expect(within(section).getByLabelText('Move to')).toHaveValue('2027-01-13')
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    await user.click(await within(section).findByRole('button', { name: 'Apply change' }))
    expect(
      await screen.findAllByText(/^Moved Threshold intervals from Wed 13 Jan/),
    ).not.toHaveLength(0)
    const writes = calls.filter(
      (c) =>
        c.url === '/api/plan/sessions/s1/adjust' &&
        (c.body as { dryRun?: boolean }).dryRun !== true,
    )
    expect(writes.map((c) => c.body)).toEqual([
      { adjustment: { type: 'move', date: '2027-01-15' }, expectHash: '1'.repeat(64) },
    ])
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([])
    // The sheet shows what was done and stays open for the undo.
    expect(onClose).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('group', { name: 'Applied change' })).toBeInTheDocument()
  })

  test('a skip waits for the confirmation and says it is not made up later', async () => {
    const user = userEvent.setup()
    const { calls, onClose } = renderSheet(makeSession(), {
      'POST /api/plan/sessions/s1/adjust': () => ({
        allowed: true,
        guards: [],
        diff: makeDiff([]),
        session: makeSession({ status: 'skipped' }),
        revision: null,
        hash: '1'.repeat(64),
      }),
    })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('A skipped session is not made up later.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Skip session' }))
    await within(dialog).findByText('This would not change the plan.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).getByRole('button', { name: 'Skip session' })).toBeInTheDocument()
    // Keeping the session writes nothing: every call to the adjust route was a dry run.
    const asked = calls.filter((c) => c.url === '/api/plan/sessions/s1/adjust')
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((c) => (c.body as { dryRun?: boolean }).dryRun === true)).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  test('a skipped session can be restored', async () => {
    const user = userEvent.setup()
    const { calls } = renderSheet(makeSession({ status: 'skipped' }), {
      'POST /api/plan/sessions/s1/adjust': () => ({
        allowed: true,
        guards: [],
        diff: makeDiff([]),
        session: makeSession(),
        revision: null,
        hash: '1'.repeat(64),
      }),
    })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Skip session' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Restore session' }))
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/plan/sessions/s1/adjust')).toBe(true)
    })
    expect(calls.find((c) => c.url === '/api/plan/sessions/s1/adjust')?.body).toEqual({
      adjustment: { type: 'restore' },
      dryRun: true,
    })
  })

  test('a completed session cannot be moved or skipped', async () => {
    renderSheet(makeSession({ status: 'completed', activityId: 'act1', linkSource: 'auto' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText('Move to')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Skip session' })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/so it stays as it is/)).toBeInTheDocument()
  })

  test('an eased session shows what it was before', async () => {
    renderSheet(
      makeSession({
        status: 'downgraded',
        durationMin: 40,
        original: { durationMin: 55, title: 'Threshold intervals', kind: 'threshold' },
      }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Eased/)).toBeInTheDocument()
    expect(
      within(dialog).getByText(/First planned: Threshold intervals, 55 min/),
    ).toBeInTheDocument()
  })
})
