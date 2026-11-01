import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
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
import { makeToday } from './today-fixtures.ts'

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

const NOW = new Date('2027-01-13T12:00:00')

/** Timers the test steps by hand: the component's wait for a typed value to settle. */
function steppedTimers() {
  vi.useRealTimers()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
}

/** Back to the file's usual clock (the date only), so the queries and `findBy` run in real time. */
function realTimers() {
  vi.useRealTimers()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
}

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

function committed(
  summary: string,
  session: PlanSession = SESSION,
  seenAt: string | null = null,
): AdjustResult {
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
      seenAt,
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
    // The server's day, which the swap list is judged by (Wednesday 13 January 2027).
    'GET /api/today': () => makeToday({ date: '2027-01-13' }),
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

  test('a revision that was seen when it was written is not stamped as seen again', async () => {
    const user = userEvent.setup()
    const { calls } = render(SESSION, ({ body }) =>
      body.dryRun === true
        ? dryRun(body.adjustment)
        : committed(
            'Moved Threshold intervals from Thu 14 Jan to Fri 15 Jan.',
            SESSION,
            '2027-01-13T12:00:00.000Z',
          ),
    )
    const section = screen.getByRole('region', { name: 'Change this session' })
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    await within(section).findByText('What would change')
    await user.click(within(section).getByRole('button', { name: 'Apply change' }))
    await within(section).findByRole('group', { name: 'Applied change' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(calls.filter((c) => c.url.endsWith('/seen'))).toEqual([])
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
    // The button leaves the page with its list; focus goes to the part that speaks for the change.
    await waitFor(() => {
      expect(within(section).getByRole('status', { name: 'Check of this change' })).toHaveFocus()
    })
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

describe('AdjustSection, bringing the answer into view', () => {
  // jsdom has no `scrollIntoView`; the section calls it only when the device has one.
  const scrollIntoView = vi.fn()
  beforeEach(() => {
    scrollIntoView.mockClear()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    })
  })
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })

  test('a tap on Skip scrolls the check of the change into view by the least scroll, once', async () => {
    const user = userEvent.setup()
    render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    expect(scrollIntoView).not.toHaveBeenCalled()

    await user.click(within(section).getByRole('button', { name: 'Skip session' }))
    expect(await within(section).findByText('What would change')).toBeInTheDocument()
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    // the element that scrolls is the panel that holds the answer, Apply change and Cancel
    expect(scrollIntoView.mock.contexts[0]).toBe(
      within(section).getByRole('status', { name: 'Check of this change' }),
    )
    expect(within(section).getByRole('button', { name: 'Apply change' })).toBeEnabled()
  })

  test('a typed field that has focus keeps the view where the runner is typing', async () => {
    render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    const move = within(section).getByLabelText('Move to')
    move.focus()
    fireEvent.change(move, { target: { value: '2027-01-15' } })
    expect(await within(section).findByText('What would change')).toBeInTheDocument()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  test('the number typed into Shorten keeps the view too, and a button after it scrolls', async () => {
    const user = userEvent.setup()
    render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    const shorten = within(section).getByLabelText('Shorten to (minutes)')
    shorten.focus()
    fireEvent.change(shorten, { target: { value: '40' } })
    expect(await within(section).findByText('What would change')).toBeInTheDocument()
    expect(scrollIntoView).not.toHaveBeenCalled()

    await user.click(within(section).getByRole('button', { name: 'Skip session' }))
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    })
  })

  test('a device with no scrollIntoView takes the answer as it is', async () => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    const user = userEvent.setup()
    render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    await user.click(within(section).getByRole('button', { name: 'Skip session' }))
    expect(await within(section).findByText('What would change')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Apply change' })).toBeEnabled()
  })
})

describe('AdjustSection, the answer to a check', () => {
  const message = "Sun 17 Jan already has a run; one run a day keeps the week's spacing (rule F1)."

  test('is read out: the status region is in the page before the answer, and the answer lands in it', async () => {
    render(SESSION, ({ body }) =>
      dryRun(body.adjustment, {
        allowed: false,
        diff: makeDiff([]),
        guards: [block('one-run-a-day', message)],
      }),
    )
    const section = screen.getByRole('region', { name: 'Change this session' })
    // Present and empty before anything is asked, so a screen reader is already listening to it.
    const region = within(section).getByRole('status', { name: 'Check of this change' })
    expect(region).toBeEmptyDOMElement()
    expect(region).toHaveAttribute('aria-atomic', 'false')

    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-17' } })
    const why = await within(region).findByRole('list', { name: 'Why this cannot be done' })
    expect(within(why).getByText(message)).toBeInTheDocument()
    expect(within(section).getByRole('status', { name: 'Check of this change' })).toBe(region)
  })

  test('says "Checking this change." inside the same region while the server answers', async () => {
    render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    const region = within(section).getByRole('status', { name: 'Check of this change' })
    fireEvent.change(within(section).getByLabelText('Move to'), { target: { value: '2027-01-15' } })
    await waitFor(() => {
      expect(within(region).getByText('Checking this change.')).toBeInTheDocument()
    })
    expect(await within(region).findByText('What would change')).toBeInTheDocument()
  })

  test('the panel keeps a focus ring for the keyboard and stays in the accessibility tree when empty', () => {
    // jsdom applies no stylesheet, so the rules are read: `:focus { outline: none }` is more
    // specific than the global `:focus-visible` ring, and `display: none` drops a live region.
    const css = readFileSync(
      join(process.cwd(), 'web/components/disruption/disruption.module.css'),
      'utf8',
    )
    const ring = /\.adjustPanel:focus-visible\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(ring).toMatch(/outline:\s*var\(--focus-ring\)/)
    expect(ring).toMatch(/outline-offset:\s*var\(--focus-offset\)/)
    const empty = /\.adjustPanel:empty\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(empty).not.toMatch(/display:\s*none/)
  })
})

describe('AdjustSection, a value that is typed', () => {
  test('a number typed digit by digit is asked about once, when it has settled', async () => {
    const { adjustCalls } = render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    const minutes = within(section).getByLabelText('Shorten to (minutes)')
    steppedTimers()
    fireEvent.change(minutes, { target: { value: '4' } })
    act(() => {
      vi.advanceTimersByTime(250)
    })
    fireEvent.change(minutes, { target: { value: '40' } })
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(adjustCalls()).toHaveLength(0)
    expect(within(section).queryByText('Checking this change.')).not.toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    realTimers()
    await within(section).findByText('What would change')
    expect(adjustCalls().map((c) => c.body)).toEqual([
      { adjustment: { type: 'shorten', durationMin: 40 }, dryRun: true },
    ])
  })

  test('a date typed part by part is asked about once, for the last date', async () => {
    const { adjustCalls } = render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    const day = within(section).getByLabelText('Move to')
    steppedTimers()
    for (const value of ['0002-01-15', '0202-01-15', '2027-01-15']) {
      fireEvent.change(day, { target: { value } })
      act(() => {
        vi.advanceTimersByTime(100)
      })
    }
    expect(adjustCalls()).toHaveLength(0)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    realTimers()
    await within(section).findByText('What would change')
    expect(adjustCalls().map((c) => c.body)).toEqual([
      { adjustment: { type: 'move', date: '2027-01-15' }, dryRun: true },
    ])
  })

  test('the answer for the last value goes at once, so Apply never sits beside a value that was changed', async () => {
    const { adjustCalls } = render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    const minutes = within(section).getByLabelText('Shorten to (minutes)')
    fireEvent.change(minutes, { target: { value: '40' } })
    await within(section).findByText('What would change')
    expect(within(section).getByRole('button', { name: 'Apply change' })).toBeEnabled()

    fireEvent.change(minutes, { target: { value: '400' } })
    expect(within(section).queryByRole('button', { name: 'Apply change' })).not.toBeInTheDocument()
    expect(within(section).queryByText('What would change')).not.toBeInTheDocument()
    await within(section).findByText('What would change')
    expect(adjustCalls().at(-1)?.body).toEqual({
      adjustment: { type: 'shorten', durationMin: 400 },
      dryRun: true,
    })
  })

  test('a field that is emptied, or holds no whole number, asks nothing and drops the pending timer', () => {
    const { adjustCalls } = render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    const minutes = within(section).getByLabelText('Shorten to (minutes)')
    steppedTimers()
    fireEvent.change(minutes, { target: { value: '40' } })
    fireEvent.change(minutes, { target: { value: '' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(adjustCalls()).toHaveLength(0)
    expect(within(section).queryByText('Checking this change.')).not.toBeInTheDocument()
  })

  test('a button asks at once: nothing waits for the typed fields to settle', () => {
    render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    steppedTimers()
    fireEvent.click(within(section).getByRole('button', { name: 'Skip session' }))
    // No timer has been stepped: the question is already on its way.
    expect(within(section).getByText('Checking this change.')).toBeInTheDocument()
  })

  test('a button pressed while a typed number waits takes its place', async () => {
    const { adjustCalls } = render(SESSION, ({ body }) => dryRun(body.adjustment))
    const section = screen.getByRole('region', { name: 'Change this session' })
    steppedTimers()
    fireEvent.change(within(section).getByLabelText('Shorten to (minutes)'), {
      target: { value: '40' },
    })
    fireEvent.click(within(section).getByRole('button', { name: 'Skip session' }))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    realTimers()
    await within(section).findByText('What would change')
    expect(adjustCalls().map((c) => (c.body as Body).adjustment)).toEqual([{ type: 'skip' }])
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

  test.each(['hike', 'race'] as const)(
    'is not offered for a %s, which the server refuses to shorten',
    (kind) => {
      render(makeSession({ id: 's1', kind, title: 'Planned', durationMin: 120 }), () => ({}))
      const section = screen.getByRole('region', { name: 'Change this session' })
      expect(within(section).queryByLabelText('Shorten to (minutes)')).not.toBeInTheDocument()
    },
  )

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
  // Today is Wednesday 13 January 2027 (the clock and `GET /api/today`); the session is Thursday's.
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
        // A day that has passed, still marked "planned": the server refuses it (adjust.past).
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
        // A back-to-back pair stays together: neither day is offered.
        makeSession({
          id: 'f',
          weekStart: '2027-01-11',
          date: '2027-01-16',
          order: 1,
          title: 'Back-to-back day 1',
          kind: 'b2b',
          durationMin: 100,
          flags: ['b2b-day1'],
        }),
        makeSession({
          id: 'g',
          weekStart: '2027-01-11',
          date: '2027-01-17',
          title: 'Back-to-back day 2',
          kind: 'b2b',
          durationMin: 80,
          flags: ['b2b-day2'],
        }),
        // Today still counts as to run.
        makeSession({
          id: 'h',
          weekStart: '2027-01-11',
          date: '2027-01-13',
          title: 'Strides',
          kind: 'strides',
          durationMin: 30,
        }),
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
    expect(calls.some((c) => c.url === '/api/plan' || c.url === '/api/today')).toBe(false)
    await user.click(within(section).getByRole('button', { name: 'Swap with another session' }))
    const select = await within(section).findByLabelText('Swap with')
    await waitFor(() => {
      expect(select).toBeEnabled()
    })
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose a session', 'Wed 13 Jan, Strides, 30 min', 'Sat 16 Jan, Long run, 90 min'])
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
