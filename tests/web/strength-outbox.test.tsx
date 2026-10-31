import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  strengthLogUrl,
  useSaveStrengthLog,
  useStrengthView,
  type StrengthLogBody,
} from '../../web/api/strength.ts'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { StrengthSheet } from '../../web/components/strength/StrengthSheet.tsx'
import { STRENGTH_DRAFT_PREFIX } from '../../web/pwa/drafts.ts'
import { getOutbox, useOutboxReplay } from '../../web/pwa/outbox.ts'
import { delayResponses, mockApi, renderWithProviders } from './helpers.tsx'
import {
  DAY,
  lb,
  makeView,
  makeWorkout,
  savedLog,
  SESSION_ID,
  SETTINGS,
} from './strength-fixtures.ts'

const LOG_ID = '3f2b7c1e-8d4a-4f6b-9a31-5c0e2d7b6a10'
const BODY: StrengthLogBody = {
  date: DAY,
  sessionId: SESSION_ID,
  durationMin: 40,
  prescribed: { template: 'heavy', variant: 'A', week: 6, mode: 'normal', lifts: [] },
  sets: [
    { exerciseId: 'back-squat', loadG: lb(110), count: 5, rir: 1 },
    { exerciseId: 'back-squat', loadG: lb(110), count: 5, rir: 1 },
  ],
}
const NEXT = [{ exerciseId: 'back-squat', change: 'increase' as const, loadG: lb(115) }]

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(
    () => {
      useOutboxReplay('u1')
      return { view: useStrengthView(), save: useSaveStrengthLog() }
    },
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    },
  )
}

describe('a strength log saved through the outbox', () => {
  test('is queued with no connection, sent when it returns with the same id, and the page is read again then', async () => {
    let connected = false
    const { calls } = mockApi({
      'GET /api/strength': () => makeView(),
      [`PUT ${strengthLogUrl(LOG_ID)}`]: () =>
        connected
          ? savedLog(LOG_ID, NEXT)
          : { status: 503, body: { error: { code: 'internal', message: 'Offline.' } } },
    })
    const { result } = mount()
    await waitFor(() => {
      expect(result.current.view.isSuccess).toBe(true)
    })
    const reads = () => calls.filter((call) => call.method === 'GET').length

    let answer: unknown
    await act(async () => {
      answer = await result.current.save.mutateAsync({ logId: LOG_ID, body: BODY })
    })
    expect(answer).toEqual({ status: 'queued' })
    const [entry] = getOutbox().getState().entries
    expect(entry?.url).toBe(`/api/strength/logs/${LOG_ID}`)
    // Nothing reached the server, so nothing changed there and the page is not read again.
    expect(reads()).toBe(1)

    connected = true
    await act(async () => {
      await getOutbox().flush()
    })
    await waitFor(() => {
      expect(reads()).toBeGreaterThan(1)
    })
    // The replay is the same PUT to the same id with the same body: the server upserts it.
    expect(
      calls.filter((call) => call.method === 'PUT').map((call) => [call.url, call.body]),
    ).toEqual([
      [`/api/strength/logs/${LOG_ID}`, BODY],
      [`/api/strength/logs/${LOG_ID}`, BODY],
    ])
    expect(getOutbox().getState().entries).toEqual([])
  })

  test('sent at once, it answers with the loads for next time and reads the page again once', async () => {
    const { calls } = mockApi({
      'GET /api/strength': () => makeView(),
      [`PUT ${strengthLogUrl(LOG_ID)}`]: () => savedLog(LOG_ID, NEXT),
    })
    // A real request takes a moment; the two refreshes meet while the first read is on its way.
    delayResponses(15)
    const { result } = mount()
    await waitFor(() => {
      expect(result.current.view.isSuccess).toBe(true)
    })
    let answer: unknown
    await act(async () => {
      answer = await result.current.save.mutateAsync({ logId: LOG_ID, body: BODY })
    })
    expect(answer).toEqual({ status: 'sent', next: NEXT })
    await waitFor(() => {
      expect(result.current.view.isFetching).toBe(false)
    })
    // The first read, and one more for the save: the listener's refresh and the mutation's joined.
    expect(calls.filter((call) => call.url === '/api/strength')).toHaveLength(2)
  })

  test('a sent answer with no usable next loads still says sent', async () => {
    mockApi({
      'GET /api/strength': () => makeView(),
      [`PUT ${strengthLogUrl(LOG_ID)}`]: () => ({ ...savedLog(LOG_ID), next: 'unavailable' }),
    })
    const { result } = mount()
    let answer: unknown
    await act(async () => {
      answer = await result.current.save.mutateAsync({ logId: LOG_ID, body: BODY })
    })
    expect(answer).toEqual({ status: 'sent', next: [] })
  })

  test('a second save of the same id replaces the queued one instead of joining it', async () => {
    mockApi({
      'GET /api/strength': () => makeView(),
      [`PUT ${strengthLogUrl(LOG_ID)}`]: () => ({
        status: 503,
        body: { error: { code: 'internal', message: 'Offline.' } },
      }),
    })
    const { result } = mount()
    await act(async () => {
      await result.current.save.mutateAsync({ logId: LOG_ID, body: BODY })
    })
    const longer: StrengthLogBody = { ...BODY, durationMin: 55, sets: BODY.sets.slice(0, 1) }
    await act(async () => {
      await result.current.save.mutateAsync({ logId: LOG_ID, body: longer })
    })
    const entries = getOutbox().getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]?.body).toEqual(longer)
  })

  test('two sessions queue as two entries, each under its own id', async () => {
    mockApi({
      'GET /api/strength': () => makeView(),
      [`PUT ${strengthLogUrl(LOG_ID)}`]: () => ({
        status: 503,
        body: { error: { code: 'internal', message: 'Offline.' } },
      }),
      [`PUT ${strengthLogUrl('0a1b2c3d-1111-4222-8333-444455556666')}`]: () => ({
        status: 503,
        body: { error: { code: 'internal', message: 'Offline.' } },
      }),
    })
    const { result } = mount()
    await act(async () => {
      await result.current.save.mutateAsync({ logId: LOG_ID, body: BODY })
      await result.current.save.mutateAsync({
        logId: '0a1b2c3d-1111-4222-8333-444455556666',
        body: { ...BODY, date: '2026-03-17' },
      })
    })
    expect(
      getOutbox()
        .getState()
        .entries.map((entry) => entry.url),
    ).toEqual([
      `/api/strength/logs/${LOG_ID}`,
      '/api/strength/logs/0a1b2c3d-1111-4222-8333-444455556666',
    ])
  })

  test('a refusal comes back as the answer, with nothing queued', async () => {
    mockApi({
      'GET /api/strength': () => makeView(),
      [`PUT ${strengthLogUrl(LOG_ID)}`]: () => ({
        status: 409,
        body: { error: { code: 'conflict', message: 'That activity already has a log.' } },
      }),
    })
    const { result } = mount()
    await waitFor(() => {
      expect(result.current.view.isSuccess).toBe(true)
    })
    let answer: unknown
    await act(async () => {
      answer = await result.current.save.mutateAsync({ logId: LOG_ID, body: BODY })
    })
    expect(answer).toEqual({ status: 'rejected', reason: 'That activity already has a log.' })
    expect(getOutbox().getState().entries).toEqual([])
  })
})

describe('the strength sheet with no connection', () => {
  const OTHER_ID = 'ffffffff-0000-4000-8000-000000000000'
  const offline = {
    status: 503,
    body: { error: { code: 'internal', message: 'Offline.' } },
  }

  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: () => LOG_ID })
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  /** The sheet and the app's replay of the outbox, as the signed-in app mounts them. */
  function openSheet() {
    function Replay() {
      useOutboxReplay('u1')
      return null
    }
    renderWithProviders(
      createElement(
        ToastProvider,
        null,
        createElement(Replay),
        createElement(StrengthSheet, {
          workout: makeWorkout(),
          date: DAY,
          onClose: vi.fn(),
          onSaved: vi.fn(),
        }),
      ),
    )
  }

  test('queues a save, keeps it across the connection coming back, and sends the same id once', async () => {
    let connected = false
    const { calls } = mockApi({
      'GET /api/settings': () => SETTINGS,
      'GET /api/strength': () => makeView(),
      'GET /api/today': () => ({}),
      [`PUT ${strengthLogUrl(LOG_ID)}`]: () => (connected ? savedLog(LOG_ID, NEXT) : offline),
    })
    openSheet()
    await screen.findByRole('region', { name: 'Back squat' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'As suggested' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText(
        'Strength log saved on this phone. It is sent when a connection returns.',
      ),
    ).toBeVisible()
    const [queued] = getOutbox().getState().entries
    expect(queued?.url).toBe(`/api/strength/logs/${LOG_ID}`)
    // the draft of a saved sheet is gone: the outbox holds the session now
    expect(window.localStorage.getItem(`${STRENGTH_DRAFT_PREFIX}${LOG_ID}`)).toBeNull()
    const queuedBody = queued?.body as unknown as StrengthLogBody
    expect(queuedBody.sets).toHaveLength(13)
    expect(queuedBody.sets[0]).toEqual({
      exerciseId: 'back-squat',
      loadG: lb(110),
      count: 5,
      rir: 1,
    })

    connected = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => {
      expect(getOutbox().getState().entries).toEqual([])
    })
    const puts = calls.filter((call) => call.method === 'PUT')
    expect(puts.map((call) => call.url)).toEqual([
      `/api/strength/logs/${LOG_ID}`,
      `/api/strength/logs/${LOG_ID}`,
    ])
    // the replay is the body that was queued, not a new one
    expect(puts[1]?.body).toEqual(queuedBody)
  })

  test('keeps the draft over a reload, so the save that follows is the one it was kept for', async () => {
    let connected = false
    const { calls } = mockApi({
      'GET /api/settings': () => SETTINGS,
      'GET /api/strength': () => offline,
      'GET /api/today': () => ({}),
      [`PUT ${strengthLogUrl(LOG_ID)}`]: () => (connected ? savedLog(LOG_ID, NEXT) : offline),
    })
    openSheet()
    await screen.findByRole('region', { name: 'Back squat' })
    const user = userEvent.setup()
    await user.click(
      within(screen.getByRole('group', { name: 'Back squat, set 1, load' })).getByRole('button', {
        name: 'Raise the load by one step',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'All sets, Back squat, reps left 2' }))
    expect(window.localStorage.getItem(`${STRENGTH_DRAFT_PREFIX}${LOG_ID}`)).not.toBeNull()

    // the page reloads: the sheet is built again and would choose another id
    cleanup()
    vi.stubGlobal('crypto', { randomUUID: () => OTHER_ID })
    openSheet()
    await screen.findByRole('region', { name: 'Back squat' })
    expect(screen.getByRole('textbox', { name: 'Back squat, set 1, load' })).toHaveValue('115')
    expect(screen.getByRole('button', { name: 'Back squat, set 4, reps left 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(getOutbox().getState().entries).toHaveLength(1)
    })
    expect(getOutbox().getState().entries[0]?.url).toBe(`/api/strength/logs/${LOG_ID}`)
    connected = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => {
      expect(getOutbox().getState().entries).toEqual([])
    })
    const sent = calls.filter((call) => call.method === 'PUT' && call.url.endsWith(LOG_ID))
    expect(sent.length).toBeGreaterThanOrEqual(2)
    expect(calls.some((call) => call.url.endsWith(OTHER_ID))).toBe(false)
    expect((sent.at(-1)?.body as StrengthLogBody).sets[0]?.loadG).toBe(lb(115))
  })
})
