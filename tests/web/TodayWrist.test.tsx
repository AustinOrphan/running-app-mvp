import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TodayCoach, TodayView, WristItem } from '../../shared/types.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { DashboardPage } from '../../web/pages/DashboardPage.tsx'
import { expectCleanCopy, mockApi, renderWithProviders } from './helpers.tsx'
import { makeCoach, makeHero, makeSession, makeToday } from './today-fixtures.ts'
import { renderToday, settingsOf, startToday } from './today-render.tsx'
import { makeWristItem, refocus } from './wrist-fixtures.ts'

// The `watch` slot of Today (design 6.7, 7.6): one line of 24 px under the session's actions,
// filled from the page's own payload, so it asks the server for nothing.

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

beforeEach(() => {
  startToday()
  setOnline(true)
})

afterEach(() => {
  vi.useRealTimers()
})

const EMPTY_SLOTS: TodayCoach['slots'] = {
  disruption: null,
  fuel: null,
  watch: null,
  brief: null,
  fuelPrompt: null,
}

/** A day with the easy run `s1` as its hero and the given items in the `watch` slot. */
function dayWith(items: WristItem[] | null): TodayView {
  const hero = makeHero({ session: makeSession({ id: 's1' }) })
  return makeToday({
    sessions: [{ session: hero.session, advice: 'as-planned', reasons: [] }],
    coach: makeCoach({
      hero,
      slots: { ...EMPTY_SLOTS, watch: items === null ? null : { items } },
    }),
  })
}

const slotOf = async (): Promise<HTMLElement> => {
  const hero = await screen.findByRole('article', { name: 'Easy run' })
  return hero.querySelector('[data-slot="watch"]') as HTMLElement
}

describe('Today: the watch line', () => {
  test('fills the watch slot of the hero, under the actions, within its 24 px budget', async () => {
    renderToday(dayWith([makeWristItem({ status: 'on-watch' })]))
    const slot = await slotOf()
    expect(slot).not.toBeNull()
    expect(slot).toHaveAttribute('data-budget-px', '24')
    expect(within(slot).getByText('On your watch.')).toBeInTheDocument()
    // one line: the paragraph holds the sentence and nothing else while the run is there
    expect(slot.children).toHaveLength(1)
    expect(slot.firstElementChild!.tagName).toBe('P')

    const actions = screen.getByRole('button', { name: 'Not today' })
    expect(actions.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('asks the server for nothing: the payload carries the line', async () => {
    const { api } = renderToday(dayWith([makeWristItem({ status: 'on-watch' })]))
    await slotOf()
    expect([...new Set(api.calls.map((call) => call.url))].sort()).toEqual([
      '/api/settings',
      '/api/today',
    ])
  })

  test.each([
    ['sent', { status: 'sent' }, 'Sent to intervals.icu.'],
    [
      'an eased run',
      { status: 'on-watch', variant: 'eased' },
      'The watch has the easy version of this run.',
    ],
  ] as const)('%s: says so, with no link', async (_name, over, sentence) => {
    renderToday(dayWith([makeWristItem(over)]))
    const slot = await slotOf()
    expect(within(slot).getByText(sentence)).toBeInTheDocument()
    expect(within(slot).queryByRole('link')).not.toBeInTheDocument()
  })

  test.each([
    ['waiting', { status: 'waiting' }, 'Not on the watch yet: waiting to send.'],
    [
      'the key',
      { status: 'not-delivered', failCode: 'auth' },
      'Not on the watch yet: reconnect intervals.icu.',
    ],
    ['removed', { status: 'removed' }, 'Not on the watch yet: removed in intervals.icu.'],
  ] as const)('%s: a short reason and the workout file', async (_name, over, sentence) => {
    renderToday(dayWith([makeWristItem(over)]))
    const slot = await slotOf()
    expect(within(slot).getByText(sentence)).toBeInTheDocument()
    const link = within(slot).getByRole('link', { name: 'Download the workout file' })
    expect(link).toHaveAttribute('href', '/api/plan/sessions/s1/workout.fit')
    expectCleanCopy(slot)
  })

  test.each([
    ['sending is off, so the slot is empty', null],
    ['the slot lists no run of the hero', [makeWristItem({ sessionId: 's2' })]],
    ['the app took the run off the watch', [makeWristItem({ status: 'withdrawn' })]],
  ])('has no slot when %s', async (_name, items) => {
    renderToday(dayWith(items))
    await slotOf()
    expect(document.querySelector('[data-slot="watch"]')).toBeNull()
  })

  test('has no slot offline, where a saved "On your watch." could be false', async () => {
    setOnline(false)
    renderToday(dayWith([makeWristItem({ status: 'on-watch' })]))
    await slotOf()
    expect(document.querySelector('[data-slot="watch"]')).toBeNull()
    expect(screen.queryByText('On your watch.')).not.toBeInTheDocument()
  })

  test('has no slot for a copy the worker served, with the browser online', async () => {
    renderToday({ ...dayWith([makeWristItem({ status: 'on-watch' })]), servedFromCache: true })
    await slotOf()
    expect(document.querySelector('[data-slot="watch"]')).toBeNull()
    expect(screen.queryByText('On your watch.')).not.toBeInTheDocument()
  })

  test('announces a change of state after the page loaded, and only a change', async () => {
    let view = dayWith([makeWristItem({ status: 'waiting' })])
    mockApi({
      'GET /api/today': () => view,
      'GET /api/settings': () => settingsOf(),
    })
    renderWithProviders(
      <ToastProvider>
        <DashboardPage />
      </ToastProvider>,
    )
    const slot = await slotOf()
    const loaded = await within(slot).findByText('Not on the watch yet: waiting to send.')
    // the page loaded with this state: nothing to announce
    expect(within(slot).queryByRole('status')).not.toBeInTheDocument()
    expect(loaded.parentElement).not.toHaveAttribute('role')

    // the same state again (a refetch on focus): still quiet. The new payload differs from the
    // first only in the retry time, which the line's title carries and its state does not, and the
    // wait is for that title. A payload equal to the first keeps the cached object and renders
    // nothing, and the request alone is made before the refetched payload has rendered.
    view = dayWith([makeWristItem({ status: 'waiting', retryAt: '2027-01-13T14:20:00.000Z' })])
    await refocus()
    await waitFor(() => {
      expect(loaded.parentElement).toHaveAttribute('title', expect.stringContaining('tries again'))
    })
    expect(within(slot).getByText('Not on the watch yet: waiting to send.')).toBeInTheDocument()
    expect(within(slot).queryByRole('status')).not.toBeInTheDocument()

    view = dayWith([makeWristItem({ status: 'on-watch' })])
    await refocus()
    expect(await within(await slotOf()).findByRole('status')).toHaveTextContent('On your watch.')
  })
})
