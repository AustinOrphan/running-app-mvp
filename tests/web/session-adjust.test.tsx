import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  AdjustResult,
  PlanAdjustment,
  PlanGuardView,
  PlanSession,
} from '../../shared/types.ts'
import { AdjustSection } from '../../web/components/disruption/AdjustSection.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import {
  expectCleanCopy,
  mockApi,
  renderWithProviders,
  type MockRequest,
  type MockRoutes,
} from './helpers.tsx'
import {
  AVAILABLE,
  makeBrief,
  makeDiff,
  makeLine,
  makeRevision,
  makeSession,
  makeV2Plan,
  settings,
} from './plan-fixtures.ts'

// Wednesday 13 January 2027; the session is Thursday's threshold run of 55 minutes in this week.
const SESSION = makeSession({ id: 's1', date: '2027-01-14', title: 'Threshold intervals' })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-01-13T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

const HASH = '1'.repeat(64)

function movedLine(to: string) {
  return makeLine({
    externalId: 'x1',
    sessionId: 's1',
    date: to,
    before: makeBrief({ date: '2027-01-14', title: 'Threshold intervals', durationMin: 55 }),
    after: makeBrief({ date: to, title: 'Threshold intervals', durationMin: 55 }),
    fields: ['date'],
  })
}

function block(
  code: PlanGuardView['code'],
  message: string,
  suggest: PlanGuardView['suggest'] = null,
) {
  return { code, message, rules: ['F1'], effect: 'blocks', suggest } satisfies PlanGuardView
}

function dryRun(adjustment: PlanAdjustment, over: Partial<AdjustResult> = {}): AdjustResult {
  const to = adjustment.type === 'move' ? adjustment.date : '2027-01-14'
  return {
    allowed: true,
    guards: [],
    diff: makeDiff([movedLine(to)]),
    session: makeSession({ id: 's1', date: to, status: 'moved' }),
    revision: null,
    hash: HASH,
    ...over,
  }
}

function committed(summary: string, session: PlanSession = SESSION): AdjustResult {
  return {
    allowed: true,
    guards: [],
    diff: makeDiff([movedLine('2027-01-15')]),
    session,
    revision: makeRevision({
      id: 'r5',
      reason: 'owner',
      auto: false,
      summary,
      diff: makeDiff([movedLine('2027-01-15')]),
      causes: { sessions: { x1: ['owner-edit'] }, weeks: {} },
      undo: AVAILABLE,
      seenAt: null,
    }),
    hash: HASH,
  }
}

interface Body {
  adjustment: PlanAdjustment
  dryRun?: boolean
  expectHash?: string
}

function render(
  session: PlanSession = SESSION,
  adjust: (req: MockRequest & { body: Body }) => unknown,
  extra: MockRoutes = {},
) {
  const { calls } = mockApi({
    'GET /api/settings': () => settings,
    'POST /api/plan/sessions/s1/adjust': (req) => adjust(req as MockRequest & { body: Body }),
    'POST /api/plan/revisions/r5/seen': () => ({ status: 204, body: undefined }),
    ...extra,
  })
  renderWithProviders(
    <ToastProvider>
      <AdjustSection session={session} />
    </ToastProvider>,
  )
  const adjustCalls = () => calls.filter((c) => c.url === '/api/plan/sessions/s1/adjust')
  return { calls, adjustCalls }
}

describe('AdjustSection, a move', () => {
  test('asks the server about each date as it is chosen, then applies that dry run with its hash', async () => {
    const user = userEvent.setup()
    const { calls, adjustCalls } = render(SESSION, ({ body }) =>
      body.dryRun === true
        ? dryRun(body.adjustment)
        : committed('Moved Threshold intervals from Thu 14 Jan to Fri 15 Jan.'),
    )
    const section = screen.getByRole('region', { name: 'Change this session' })
    expect(within(section).getByLabelText('Move to')).toHaveValue('2027-01-14')
    // Nothing is asked until a different day is chosen.
    expect(adjustCalls()).toHaveLength(0)

    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    expect(await within(section).findByText('What would change')).toBeInTheDocument()
    expect(adjustCalls()[0]?.body).toEqual({
      adjustment: { type: 'move', date: '2027-01-15' },
      dryRun: true,
    })
    expect(
      within(section).getByText(/Fri 15 Jan: Threshold intervals 55 min, moved from Thu/),
    ).toBeInTheDocument()
    expectCleanCopy(section)

    await user.click(within(section).getByRole('button', { name: 'Apply change' }))
    const group = await within(section).findByRole('group', { name: 'Applied change' })
    expect(adjustCalls().at(-1)?.body).toEqual({
      adjustment: { type: 'move', date: '2027-01-15' },
      expectHash: HASH,
    })
    expect(group).toHaveFocus()
    expect(
      await screen.findAllByText('Moved Threshold intervals from Thu 14 Jan to Fri 15 Jan.'),
    ).not.toHaveLength(0)
    // The revision it wrote, shown as every revision is, with its undo and no "New" marker.
    expect(within(group).getByRole('button', { name: 'Undo update' })).toBeInTheDocument()
    expect(within(group).queryByText('New')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(calls.some((c) => c.url === '/api/plan/revisions/r5/seen')).toBe(true)
    })
    // The web never uses the older route.
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([])
    expectCleanCopy(section)
  })

  test('a refusal is shown in the guard words with its suggestion, and cannot be applied', async () => {
    const user = userEvent.setup()
    const message =
      "Sun 17 Jan already has a run; one run a day keeps the week's spacing (rule F1)."
    const { adjustCalls } = render(
      SESSION,
      ({ body }) => {
        if (body.adjustment.type === 'swap') return dryRun(body.adjustment)
        return dryRun(body.adjustment, {
          allowed: false,
          diff: makeDiff([]),
          guards: [
            block('one-run-a-day', message, {
              label: 'Swap with Easy run 40 min instead',
              adjustment: { type: 'swap', withSessionId: 'e1' },
            }),
          ],
        })
      },
      {
        'GET /api/plan': () =>
          makeV2Plan({
            sessions: [
              SESSION,
              makeSession({
                id: 'e1',
                weekStart: '2027-01-11',
                date: '2027-01-17',
                title: 'Easy run',
                kind: 'easy',
                durationMin: 40,
              }),
            ],
          }),
      },
    )
    const section = screen.getByRole('region', { name: 'Change this session' })
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-17' } })
    const why = await within(section).findByRole('list', { name: 'Why this cannot be done' })
    expect(within(why).getByText(message)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Apply change' })).toBeDisabled()
    expect(within(section).queryByText('What would change')).not.toBeInTheDocument()
    expectCleanCopy(section)

    await user.click(within(why).getByRole('button', { name: 'Swap with Easy run 40 min instead' }))
    await within(section).findByText('What would change')
    expect(adjustCalls().at(-1)?.body).toEqual({
      adjustment: { type: 'swap', withSessionId: 'e1' },
      dryRun: true,
    })
    // The swap control now shows the partner the suggestion chose.
    expect(await within(section).findByLabelText('Swap with')).toHaveValue('e1')
    expect(within(section).getByRole('button', { name: 'Apply change' })).toBeEnabled()
  })

  test('a guard that only warns lets the change through and says why it deserves a look', async () => {
    const warn: PlanGuardView = {
      code: 'spike',
      message: 'This is longer than your recent longest run (rule g-1).',
      rules: ['g-1'],
      effect: 'warns',
      suggest: null,
    }
    render(SESSION, ({ body }) => dryRun(body.adjustment, { guards: [warn] }))
    const section = screen.getByRole('region', { name: 'Change this session' })
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    const worth = await within(section).findByRole('list', { name: 'Worth knowing' })
    expect(within(worth).getByText(/longer than your recent longest run/)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Apply change' })).toBeEnabled()
  })

  test('Cancel puts the controls back, sends nothing and returns to the heading', async () => {
    const user = userEvent.setup()
    const { adjustCalls } = render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    await within(section).findByText('What would change')
    await user.click(within(section).getByRole('button', { name: 'Cancel' }))
    expect(within(section).queryByText('What would change')).not.toBeInTheDocument()
    expect(within(section).getByLabelText('Move to')).toHaveValue('2027-01-14')
    expect(adjustCalls().every((c) => (c.body as Body).dryRun === true)).toBe(true)
    await waitFor(() => {
      expect(within(section).getByRole('heading', { name: 'Change this session' })).toHaveFocus()
    })
  })

  test('a dry run that would change nothing says so and offers no apply', async () => {
    render(SESSION, ({ body }) => dryRun(body.adjustment, { diff: makeDiff([]) }))
    const section = screen.getByRole('region', { name: 'Change this session' })
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    expect(await within(section).findByText('This would not change the plan.')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Apply change' })).toBeDisabled()
  })
})

describe('AdjustSection, the commit', () => {
  test('a plan that moved answers with a newer preview, which replaces the one on screen', async () => {
    const user = userEvent.setup()
    let commits = 0
    const newer = {
      action: { type: 'adjust', sessionId: 's1', adjustment: { type: 'move', date: '2027-01-15' } },
      diff: makeDiff([movedLine('2027-01-15'), makeLine({ externalId: 'x2', date: '2027-01-16' })]),
      summary: 'Moved.',
      warnings: [],
      blocked: false,
      guards: [],
      reasons: [],
      hash: '2'.repeat(64),
      today: '2027-01-13',
    }
    const { adjustCalls } = render(SESSION, ({ body }) => {
      if (body.dryRun === true) return dryRun(body.adjustment)
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
        : committed('Moved Threshold intervals from Thu 14 Jan to Fri 15 Jan.')
    })
    const section = screen.getByRole('region', { name: 'Change this session' })
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    await within(section).findByText('What would change')
    await user.click(within(section).getByRole('button', { name: 'Apply change' }))
    expect(
      await within(section).findByText(
        'The plan changed while you were reading. This is the new preview.',
      ),
    ).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Apply change' }))
    await within(section).findByRole('group', { name: 'Applied change' })
    expect(
      adjustCalls()
        .filter((c) => (c.body as Body).dryRun !== true)
        .map((c) => (c.body as Body).expectHash),
    ).toEqual([HASH, '2'.repeat(64)])
  })

  test('a guard that now refuses the change is read again from the server', async () => {
    const user = userEvent.setup()
    let refused = false
    const message =
      'Running is on hold on Fri 15 Jan, so Threshold intervals cannot go there (rule J9).'
    render(SESSION, ({ body }) => {
      if (body.dryRun === true) {
        return refused
          ? dryRun(body.adjustment, {
              allowed: false,
              guards: [block('rest-window', message)],
              diff: makeDiff([]),
            })
          : dryRun(body.adjustment)
      }
      refused = true
      return {
        status: 409,
        body: {
          error: {
            code: 'conflict',
            message,
            details: { guards: [block('rest-window', message)] },
          },
        },
      }
    })
    const section = screen.getByRole('region', { name: 'Change this session' })
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    await within(section).findByText('What would change')
    await user.click(within(section).getByRole('button', { name: 'Apply change' }))
    const why = await within(section).findByRole('list', { name: 'Why this cannot be done' })
    expect(within(why).getByText(message)).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Apply change' })).toBeDisabled()
  })

  test('says the server could not be reached, and that nothing was changed', async () => {
    const user = userEvent.setup()
    render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    await within(section).findByText('What would change')
    const online = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      (input instanceof Request ? input.url : String(input)).includes('/adjust') &&
      !(typeof init?.body === 'string' && init.body.includes('dryRun'))
        ? Promise.reject(new TypeError('Failed to fetch'))
        : online(input, init),
    )
    await user.click(within(section).getByRole('button', { name: 'Apply change' }))
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'You are offline. Nothing was changed.',
    )
  })

  test('says so when the check itself fails', async () => {
    render(SESSION, () => ({
      status: 500,
      body: { error: { code: 'internal', message: 'Something broke.' } },
    }))
    const section = screen.getByRole('region', { name: 'Change this session' })
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'This change could not be checked. Try again.',
    )
  })
})

describe('AdjustSection, shorten', () => {
  test('sends a whole number of minutes as a shorten and says nothing is added back', async () => {
    const user = userEvent.setup()
    const { adjustCalls } = render(SESSION, ({ body }) =>
      dryRun(body.adjustment, {
        diff: makeDiff([
          makeLine({
            externalId: 'x1',
            date: '2027-01-14',
            before: makeBrief({ date: '2027-01-14', durationMin: 55 }),
            after: makeBrief({ date: '2027-01-14', durationMin: 40 }),
            fields: ['durationMin', 'status'],
          }),
        ]),
      }),
    )
    const section = screen.getByRole('region', { name: 'Change this session' })
    expect(within(section).getByText('Nothing is added back to another day.')).toBeInTheDocument()
    const minutes = within(section).getByLabelText('Shorten to (minutes)')
    // Not a whole number of minutes: nothing is asked.
    await user.type(minutes, '0')
    expect(adjustCalls()).toHaveLength(0)
    await user.clear(minutes)
    await user.type(minutes, '40')
    await within(section).findByText('What would change')
    expect(adjustCalls().at(-1)?.body).toEqual({
      adjustment: { type: 'shorten', durationMin: 40 },
      dryRun: true,
    })
    expect(
      within(section).getByText(/Thu 14 Jan: Threshold intervals 55 min to/),
    ).toBeInTheDocument()
  })

  test('is not offered for a session that holds no running', () => {
    render(
      makeSession({ id: 's1', kind: 'strength', title: 'Strength', durationMin: 30 }),
      () => ({}),
    )
    const section = screen.getByRole('region', { name: 'Change this session' })
    expect(within(section).queryByLabelText('Shorten to (minutes)')).not.toBeInTheDocument()
    expect(within(section).getByLabelText('Move to')).toBeInTheDocument()
  })
})

describe('AdjustSection, swap', () => {
  const week = () =>
    makeV2Plan({
      sessions: [
        SESSION,
        makeSession({
          id: 'a',
          weekStart: '2027-01-11',
          date: '2027-01-16',
          title: 'Long run',
          kind: 'long',
          durationMin: 90,
        }),
        makeSession({
          id: 'b',
          weekStart: '2027-01-11',
          date: '2027-01-12',
          title: 'Easy run',
          kind: 'easy',
          durationMin: 40,
        }),
        makeSession({
          id: 'c',
          weekStart: '2027-01-11',
          date: '2027-01-15',
          title: 'Race',
          kind: 'race',
          durationMin: 60,
        }),
        makeSession({
          id: 'd',
          weekStart: '2027-01-11',
          date: '2027-01-15',
          title: 'Done run',
          status: 'completed',
          activityId: 'act1',
        }),
        makeSession({ id: 'e', weekStart: '2027-01-18', date: '2027-01-19', title: 'Next week' }),
      ],
    })

  test('loads the sessions of the week only when asked, and lists those that can trade days', async () => {
    const user = userEvent.setup()
    const { calls, adjustCalls } = render(
      SESSION,
      ({ body }) => dryRun(body.adjustment, { diff: makeDiff([]) }),
      { 'GET /api/plan': () => week() },
    )
    const section = screen.getByRole('region', { name: 'Change this session' })
    expect(calls.some((c) => c.url === '/api/plan')).toBe(false)
    await user.click(within(section).getByRole('button', { name: 'Swap with another session' }))
    const select = await within(section).findByLabelText('Swap with')
    await waitFor(() => {
      expect(select).toBeEnabled()
    })
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose a session', 'Tue 12 Jan, Easy run, 40 min', 'Sat 16 Jan, Long run, 90 min'])
    await user.selectOptions(select, 'a')
    await within(section).findByText('This would not change the plan.')
    expect(adjustCalls().at(-1)?.body).toEqual({
      adjustment: { type: 'swap', withSessionId: 'a' },
      dryRun: true,
    })
  })
})

describe('AdjustSection, skip and restore', () => {
  test('skip is previewed before it is applied, and says it is not made up later', async () => {
    const user = userEvent.setup()
    const { adjustCalls } = render(SESSION, ({ body }) =>
      body.dryRun === true
        ? dryRun(body.adjustment, {
            diff: makeDiff([
              makeLine({
                externalId: 'x1',
                date: '2027-01-14',
                before: makeBrief({ date: '2027-01-14' }),
                after: makeBrief({ date: '2027-01-14' }),
                fields: ['status'],
              }),
            ]),
          })
        : committed('Skipped Threshold intervals on Thu 14 Jan.'),
    )
    const section = screen.getByRole('region', { name: 'Change this session' })
    expect(within(section).getByText('A skipped session is not made up later.')).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Skip session' }))
    await within(section).findByText('What would change')
    // Nothing is written until the runner confirms.
    expect(adjustCalls().every((c) => (c.body as Body).dryRun === true)).toBe(true)
    await user.click(within(section).getByRole('button', { name: 'Apply change' }))
    await within(section).findByRole('group', { name: 'Applied change' })
    expect(adjustCalls().at(-1)?.body).toEqual({ adjustment: { type: 'skip' }, expectHash: HASH })
  })

  test('keeping the session sends no write', async () => {
    const user = userEvent.setup()
    const { adjustCalls } = render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    await user.click(within(section).getByRole('button', { name: 'Skip session' }))
    await within(section).findByText('What would change')
    await user.click(within(section).getByRole('button', { name: 'Cancel' }))
    expect(within(section).getByRole('button', { name: 'Skip session' })).toBeInTheDocument()
    expect(adjustCalls().every((c) => (c.body as Body).dryRun === true)).toBe(true)
  })

  test('a skipped session offers only Restore, and no move, swap or shorten', async () => {
    const user = userEvent.setup()
    const { adjustCalls } = render(makeSession({ id: 's1', status: 'skipped' }), ({ body }) =>
      dryRun(body.adjustment),
    )
    const section = screen.getByRole('region', { name: 'Change this session' })
    expect(within(section).queryByRole('button', { name: 'Skip session' })).not.toBeInTheDocument()
    expect(within(section).queryByLabelText('Move to')).not.toBeInTheDocument()
    expect(within(section).queryByLabelText('Shorten to (minutes)')).not.toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Restore session' }))
    await within(section).findByText('What would change')
    expect(adjustCalls().at(-1)?.body).toEqual({
      adjustment: { type: 'restore' },
      dryRun: true,
    })
  })
})

describe('AdjustSection, a session that stays as it is', () => {
  test('a completed session offers no change and says why in the guard words', () => {
    const { adjustCalls } = render(
      makeSession({ id: 's1', status: 'completed', activityId: 'act1', linkSource: 'auto' }),
      () => ({}),
    )
    const section = screen.getByRole('region', { name: 'Change this session' })
    expect(within(section).queryByRole('button', { name: 'Skip session' })).not.toBeInTheDocument()
    expect(within(section).queryByLabelText('Move to')).not.toBeInTheDocument()
    expect(
      within(section).getByText(/linked to an activity, so it stays as it is/),
    ).toBeInTheDocument()
    expect(adjustCalls()).toHaveLength(0)
    expectCleanCopy(section)
  })

  test('a session done without a link says it is done', () => {
    render(makeSession({ id: 's1', status: 'partial' }), () => ({}))
    expect(
      screen.getByText('This session is already done, so it stays as it is.'),
    ).toBeInTheDocument()
  })
})
