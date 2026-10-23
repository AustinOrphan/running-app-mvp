import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { wristChipLabel } from '../../shared/copy/publish.ts'
import type {
  PlanSession,
  SessionWorkoutView,
  WristItem,
  WristItemStatus,
  WristStatus,
} from '../../shared/types.ts'
import { useWristLine, WristLineText } from '../../web/components/WristLine.tsx'
import { WristChip, WristSection } from '../../web/components/WristStatus.tsx'
import { WristSettings } from '../../web/components/WristSettings.tsx'
import { expectCleanCopy, mockApi, renderWithProviders, type MockRoutes } from './helpers.tsx'
import { makeSession } from './plan-fixtures.ts'
import {
  makeWorkoutView,
  makeWristItem,
  makeWristStatus,
  sendingOn,
  wristRoutes,
} from './wrist-fixtures.ts'

// The words of a session on its way to the watch (design 6.7) as the components render them: every
// chip state and failure code, the section of the session sheet and Today's line, offline too.

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2027, 0, 13, 12, 0, 0))
  setOnline(true)
})

afterEach(() => {
  vi.useRealTimers()
  setOnline(true)
})

const RETRY_AT = new Date(2027, 0, 13, 14, 20, 0).toISOString()

describe('the chip', () => {
  const cases: Array<[string, Partial<WristItem>, string, string]> = [
    [
      'not-sent',
      { status: 'not-sent' },
      'Not sent yet',
      'Sending is on and this run has not been sent yet. The app sends it within a few minutes.',
    ],
    ['waiting', { status: 'waiting' }, 'Waiting to send', 'The app sends this run by itself.'],
    ['sent', { status: 'sent' }, 'Sent to intervals.icu', 'intervals.icu has this run.'],
    [
      'on-watch',
      { status: 'on-watch' },
      'On your watch',
      'intervals.icu has this run and uploads it to Garmin Connect.',
    ],
    [
      'not-delivered',
      { status: 'not-delivered' },
      'Not delivered',
      'This run did not reach the watch. Send it again, or download the workout file.',
    ],
    [
      'removed',
      { status: 'removed', failCode: 'owner-removed' },
      'Removed in intervals.icu',
      'You removed this one in intervals.icu, so the app leaves it alone.',
    ],
    [
      'the key',
      { status: 'not-delivered', failCode: 'auth' },
      'Not delivered',
      'intervals.icu did not accept the API key. Reconnect it on the Integrations page.',
    ],
    [
      'a wait',
      { status: 'waiting', failCode: 'rate-limit', retryAt: RETRY_AT },
      'Waiting to send',
      'intervals.icu asked the app to wait. It tries again at 14:20.',
    ],
    [
      'the network',
      { status: 'waiting', failCode: 'network', retryAt: RETRY_AT },
      'Waiting to send',
      'intervals.icu could not be reached. It tries again at 14:20.',
    ],
    [
      'a rejection',
      {
        status: 'not-delivered',
        failCode: 'rejected',
        failMessage: 'intervals.icu did not accept the workout: Cannot read step 3',
      },
      'Not delivered',
      'intervals.icu did not accept the workout: Cannot read step 3',
    ],
    [
      'the device',
      { status: 'not-delivered', failCode: 'device', deviceMessage: 'Upload is switched off' },
      'Not delivered',
      'Garmin Connect did not take it: Upload is switched off.',
    ],
  ]

  test.each(cases)('%s: a word, and its sentence as the title', (_name, over, word, sentence) => {
    render(<WristChip item={makeWristItem(over)} />)
    const chip = screen.getByText(word)
    expect(chip).toHaveAttribute('title', sentence)
    expectCleanCopy(document.body)
  })

  test('shows no chip for a run the app took off the watch', () => {
    const { container } = render(<WristChip item={makeWristItem({ status: 'withdrawn' })} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('has a word for every status, so no state rests on its look', () => {
    const all: WristItemStatus[] = [
      'not-sent',
      'waiting',
      'sent',
      'on-watch',
      'not-delivered',
      'removed',
    ]
    for (const status of all) {
      const { unmount } = render(<WristChip item={makeWristItem({ status })} />)
      expect(screen.getByText(wristChipLabel(status)!)).toHaveAttribute('data-status', status)
      unmount()
    }
  })
})

describe("Today's line", () => {
  // The line is given the hero's item from the Today payload and asks for nothing; the mount that
  // picks the item, and what happens offline, is in TodayWrist.test.tsx. This is the hook and the
  // text that mount uses, without the mount.
  function Line({ item }: { item: WristItem | undefined }) {
    const line = useWristLine(item)
    return line === null ? null : <WristLineText line={line} />
  }
  function renderLine(item: WristItem | undefined) {
    return render(<Line item={item} />)
  }

  test('says "On your watch." and "Sent to intervals.icu."', () => {
    renderLine(makeWristItem({ status: 'on-watch' }))
    expect(screen.getByText('On your watch.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  test('says "Sent to intervals.icu." before the watch has had it', () => {
    renderLine(makeWristItem({ status: 'sent' }))
    expect(screen.getByText('Sent to intervals.icu.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  test('says the watch has the easy version of an eased run', () => {
    renderLine(makeWristItem({ status: 'on-watch', variant: 'eased' }))
    expect(screen.getByText('The watch has the easy version of this run.')).toBeVisible()
    // the reason is never named
    expect(document.body.textContent).not.toMatch(/readiness|signal|pain|illness/i)
  })

  test.each([
    ['waiting', { status: 'waiting' }, 'Not on the watch yet: waiting to send.'],
    ['not sent', { status: 'not-sent' }, 'Not on the watch yet: not sent yet.'],
    [
      'the key',
      { status: 'not-delivered', failCode: 'auth' },
      'Not on the watch yet: reconnect intervals.icu.',
    ],
    ['removed', { status: 'removed' }, 'Not on the watch yet: removed in intervals.icu.'],
  ] as const)('%s: a short reason, and the workout file one tap away', (_n, over, line) => {
    renderLine(makeWristItem(over))
    expect(screen.getByText(line)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Download the workout file' })
    expect(link).toHaveAttribute('href', '/api/plan/sessions/s1/workout.fit')
    expect(link).toHaveAttribute('download')
    expectCleanCopy(document.body)
  })

  test('is one line: the sentence gives way, the link does not', () => {
    renderLine(makeWristItem({ status: 'waiting' }))
    const text = screen.getByText('Not on the watch yet: waiting to send.')
    const line = text.parentElement!
    expect(line.tagName).toBe('P')
    expect(line.children).toHaveLength(2)
    // the whole sentence stays reachable when the screen cuts it
    expect(line).toHaveAttribute('title', 'The app sends this run by itself.')
  })

  test.each([
    ['there is no item', undefined],
    ['the run was taken off the watch', makeWristItem({ status: 'withdrawn' })],
    ['the plan no longer holds the session', makeWristItem({ sessionId: null })],
  ])('says nothing when %s', (_name, item) => {
    const { container } = renderLine(item)
    expect(container).toBeEmptyDOMElement()
  })

  test('announces a change of state, and only a change', () => {
    const view = renderLine(makeWristItem({ status: 'waiting' }))
    const loaded = screen.getByText('Not on the watch yet: waiting to send.')
    // the page loaded with this state: nothing to announce
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(loaded.parentElement).not.toHaveAttribute('role')

    view.rerender(<Line item={makeWristItem({ status: 'on-watch' })} />)
    expect(screen.getByRole('status')).toHaveTextContent('On your watch.')
  })

  test('keeps quiet when a refresh brings the same state', () => {
    const view = renderLine(makeWristItem({ status: 'sent' }))
    view.rerender(<Line item={makeWristItem({ status: 'sent' })} />)
    expect(screen.getByText('Sent to intervals.icu.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('the section of the session sheet', () => {
  const run: PlanSession = makeSession({ id: 's1', kind: 'easy', title: 'Easy run' })

  function renderSection(
    status: WristStatus | null,
    options: {
      session?: PlanSession
      workout?: Partial<SessionWorkoutView>
      extra?: MockRoutes
    } = {},
  ) {
    const session = options.session ?? run
    const api = mockApi({
      ...(status === null ? {} : wristRoutes(status)),
      'POST /api/wrist/publish': () => ({ enabled: true }),
      ...options.extra,
    })
    renderWithProviders(
      <WristSection session={session} workout={makeWorkoutView(session, options.workout)} />,
    )
    return api
  }

  test('says sending is off, and offers the file and Integrations', async () => {
    renderSection(makeWristStatus())
    const section = screen.getByRole('region', { name: 'On your watch' })
    expect(
      await within(section).findByText(
        'Sending to your watch is off. Download the workout file, or turn it on under Integrations.',
      ),
    ).toBeInTheDocument()
    expect(
      within(section).getByRole('link', { name: 'Download the workout file' }),
    ).toHaveAttribute('href', '/api/plan/sessions/s1/workout.fit')
    expect(within(section).getByRole('link', { name: 'Open Integrations' })).toHaveAttribute(
      'href',
      '/integrations',
    )
    expect(within(section).queryByRole('button')).not.toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test('shows the chip, its sentence and the warnings of a sent run', async () => {
    renderSection(
      sendingOn([makeWristItem({ status: 'sent', warnings: ['no-threshold-pace', 'surprise'] })]),
    )
    const section = screen.getByRole('region', { name: 'On your watch' })
    expect(await within(section).findByText('Sent to intervals.icu')).toBeInTheDocument()
    expect(within(section).getByText('intervals.icu has this run.')).toBeInTheDocument()
    expect(
      within(section).getByText(
        'intervals.icu has no running threshold pace yet, so pace targets are written in the text of each step only. Set it in intervals.icu under Settings, Run.',
      ),
    ).toBeInTheDocument()
    // a code this build does not know is left out, never shown raw
    expect(section).not.toHaveTextContent('surprise')
    expect(within(section).queryByRole('button', { name: 'Send again' })).not.toBeInTheDocument()
    expectCleanCopy(document.body)
  })

  test.each([
    ['waiting', { status: 'waiting' }],
    ['not delivered', { status: 'not-delivered', failCode: 'auth' }],
    ['not sent', { status: 'not-sent' }],
  ] as const)('sends a %s run again when asked', async (_name, over) => {
    const user = userEvent.setup()
    const { calls } = renderSection(sendingOn([makeWristItem(over)]))
    await user.click(await screen.findByRole('button', { name: 'Send again' }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'POST')).toEqual([
        { method: 'POST', url: '/api/wrist/publish', body: { sessionId: 's1' } },
      ])
    })
  })

  test('offers no "Send again" for a run the runner removed or the watch has', async () => {
    renderSection(sendingOn([makeWristItem({ status: 'removed', failCode: 'owner-removed' })]))
    const section = screen.getByRole('region', { name: 'On your watch' })
    expect(await within(section).findByText('Removed in intervals.icu')).toBeInTheDocument()
    expect(
      within(section).getByText(
        'You removed this one in intervals.icu, so the app leaves it alone.',
      ),
    ).toBeInTheDocument()
    expect(within(section).queryByRole('button')).not.toBeInTheDocument()
  })

  test('shows why a send again was refused', async () => {
    const user = userEvent.setup()
    renderSection(sendingOn([makeWristItem({ status: 'waiting' })]), {
      extra: {
        'POST /api/wrist/publish': () => ({
          status: 409,
          body: { error: { code: 'conflict', message: 'Reconnect intervals.icu first.' } },
        }),
      },
    })
    await user.click(await screen.findByRole('button', { name: 'Send again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect intervals.icu first.')
  })

  test('says the watch has the easy version when readiness eased today, with sending off or on', async () => {
    renderSection(makeWristStatus(), { workout: { eased: true } })
    expect(
      await screen.findByText(
        "Today's readiness eased this session. The watch has the easy version; this page keeps the plan.",
      ),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/pain|illness|injur|tired|signal/i)
  })

  test.each([
    [
      'done',
      { status: 'completed' },
      undefined,
      'This session is already done or skipped, so it has no workout file.',
    ],
    [
      'skipped',
      { status: 'skipped' },
      undefined,
      'This session is already done or skipped, so it has no workout file.',
    ],
    [
      'rested by readiness',
      {},
      { file: { available: false, reason: 'rest-advice' } },
      'Rest is the better choice today, so there is no workout file.',
    ],
  ] as const)(
    'refuses the file of a session that is %s, in the words of the route',
    (_n, session, workout, sentence) => {
      renderSection(sendingOn([makeWristItem()]), {
        session: makeSession({ id: 's1', kind: 'easy', ...session }),
        workout,
      })
      const section = screen.getByRole('region', { name: 'On your watch' })
      expect(within(section).getByText(sentence)).toBeInTheDocument()
      expect(within(section).queryByRole('link')).not.toBeInTheDocument()
      expect(within(section).queryByRole('button')).not.toBeInTheDocument()
    },
  )

  test.each(['strength', 'mobility', 'rest', 'race', 'cross'] as const)(
    'is left out of a %s session, which has no workout',
    (kind) => {
      mockApi({})
      renderWithProviders(
        <WristSection
          session={makeSession({ kind })}
          workout={makeWorkoutView(makeSession({ kind }))}
        />,
      )
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    },
  )

  test('keeps only the heading, the eased note and the download offline', () => {
    setOnline(false)
    const { calls } = renderSection(sendingOn([makeWristItem({ status: 'on-watch' })]), {
      workout: { eased: true },
    })
    const section = screen.getByRole('region', { name: 'On your watch' })
    expect(calls).toEqual([])
    expect(section.querySelector('[data-status]')).toBeNull()
    expect(within(section).queryByText(/intervals.icu has this run/)).not.toBeInTheDocument()
    expect(within(section).queryByText(/Sending to your watch is off/)).not.toBeInTheDocument()
    expect(within(section).queryByRole('button')).not.toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Download the workout file' })).toBeVisible()
    // what the app knows without asking, it keeps saying
    expect(within(section).getByText(/The watch has the easy version/)).toBeInTheDocument()
  })

  test('keeps only the download when the status cannot be read', async () => {
    renderSection(null, {
      extra: {
        'GET /api/wrist/status': () => ({
          status: 500,
          body: { error: { code: 'internal', message: 'Down.' } },
        }),
      },
    })
    const section = screen.getByRole('region', { name: 'On your watch' })
    await waitFor(() => {
      expect(within(section).getByRole('link', { name: 'Download the workout file' })).toBeVisible()
    })
    expect(within(section).queryByRole('button')).not.toBeInTheDocument()
    expect(within(section).queryByText(/off/)).not.toBeInTheDocument()
  })
})

describe('the settings on the intervals.icu card', () => {
  const SEND = 'Send my next 14 days of runs to intervals.icu'
  const GARMIN = 'intervals.icu uploads planned workouts to my Garmin Connect'

  function renderSettings(status: WristStatus, extra: MockRoutes = {}) {
    const api = mockApi({
      ...wristRoutes(status),
      'PUT /api/wrist/intervals': () => status.settings,
      ...extra,
    })
    renderWithProviders(<WristSettings />)
    return api
  }

  test('start with sending off and the Garmin upload unticked, in words the sentences use', async () => {
    renderSettings(makeWristStatus())
    const group = await screen.findByRole('group', { name: 'Send sessions to your watch' })
    expect(within(group).getByRole('checkbox', { name: SEND })).not.toBeChecked()
    const garmin = within(group).getByRole('checkbox', { name: GARMIN })
    expect(garmin).not.toBeChecked()
    expect(garmin).toHaveAccessibleDescription(
      'In intervals.icu open Settings, Garmin Connect, and switch on uploading planned workouts. The app cannot check this.',
    )
    expectCleanCopy(group)
  })

  test('show what the server keeps', async () => {
    renderSettings(sendingOn([]))
    expect(await screen.findByRole('checkbox', { name: SEND })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: GARMIN })).toBeChecked()
  })

  test('turn sending on with the choices as they stand', async () => {
    const user = userEvent.setup()
    const { calls } = renderSettings(makeWristStatus())
    await user.click(await screen.findByRole('checkbox', { name: SEND }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')).toEqual([
        {
          method: 'PUT',
          url: '/api/wrist/intervals',
          body: { enabled: true, garminLinked: false },
        },
      ])
    })
  })

  test('record the tick for the Garmin upload without changing whether sending is on', async () => {
    const user = userEvent.setup()
    const { calls } = renderSettings(sendingOn([], { settings: sendingOn([]).settings }))
    await user.click(await screen.findByRole('checkbox', { name: GARMIN }))
    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'PUT')[0]?.body).toEqual({
        enabled: true,
        garminLinked: false,
      })
    })
  })

  test('say why sending could not be turned on', async () => {
    const user = userEvent.setup()
    renderSettings(makeWristStatus(), {
      'PUT /api/wrist/intervals': () => ({
        status: 409,
        body: {
          error: {
            code: 'conflict',
            message: 'Reconnect intervals.icu first.',
            details: { requires: 'reconnect-intervals' },
          },
        },
      }),
    })
    await user.click(await screen.findByRole('checkbox', { name: SEND }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect intervals.icu first.')
    expect(screen.getByRole('checkbox', { name: SEND })).not.toBeChecked()
  })

  test('are left out offline, because nothing could be saved', () => {
    setOnline(false)
    const { calls } = renderSettings(makeWristStatus())
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(calls).toEqual([])
  })
})
