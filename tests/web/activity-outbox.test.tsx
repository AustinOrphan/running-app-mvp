import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  doneUrl,
  ratingUrl,
  useActivityNotices,
  useQueuedSentToasts,
  useSaveDone,
  useSaveRating,
} from '../../web/api/activityOutbox.ts'
import { DoneSheet } from '../../web/components/today/DoneSheet.tsx'
import { ToastProvider } from '../../web/components/Toast.tsx'
import { getOutbox, resetOutboxForTests, useOutboxReplay } from '../../web/pwa/outbox.ts'
import { mockApi } from './helpers.tsx'

const ID = '0b6f3c1e-8d4a-4f6b-9a31-5c0e2d7b6a10'
const OTHER_ID = '11111111-2222-4333-8444-555566667777'
const DAY = '2026-03-18'
const BODY = { date: DAY, type: 'run' as const, durationSec: 2700, sessionId: 's1' }
const offline = { status: 503, body: { error: { code: 'internal', message: 'Offline.' } } }
const ALREADY = 'This session already has a run logged, so the one from this phone was not added.'
const conflict = { status: 409, body: { error: { code: 'conflict', message: ALREADY } } }

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(ToastProvider, null, children),
  )
}

beforeEach(() => {
  resetOutboxForTests()
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a Done through the outbox', () => {
  test('is queued with no connection, then sent under the same id', async () => {
    let connected = false
    const { calls } = mockApi({
      [`PUT ${doneUrl(ID)}`]: () => (connected ? { id: ID } : offline),
    })
    const { result } = renderHook(
      () => {
        useOutboxReplay('u1')
        return useSaveDone()
      },
      { wrapper },
    )
    let landed: unknown
    await act(async () => {
      landed = await result.current.mutateAsync({ id: ID, body: BODY })
    })
    expect(landed).toBe('queued')
    expect(
      getOutbox()
        .getState()
        .entries.map((e) => [e.url, e.held]),
    ).toEqual([[doneUrl(ID), true]])

    connected = true
    await act(async () => {
      await getOutbox().flush()
    })
    expect(getOutbox().getState().entries).toEqual([])
    // The same id both times: a replay is the same write.
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual([
      doneUrl(ID),
      doneUrl(ID),
    ])
  })

  test('a held run and a held rating are announced when they go up, an immediate send is not', async () => {
    let connected = false
    mockApi({
      [`PUT ${doneUrl(ID)}`]: () => (connected ? { id: ID } : offline),
      [`PUT ${ratingUrl('r1')}`]: () => (connected ? { id: 'r1' } : offline),
      [`PUT ${doneUrl(OTHER_ID)}`]: () => ({ id: 'x' }),
    })
    function Probe() {
      useQueuedSentToasts()
      return null
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <Probe />
        </ToastProvider>
      </QueryClientProvider>,
    )
    await act(async () => {
      await getOutbox().save(doneUrl(OTHER_ID), BODY)
    })
    expect(screen.queryByText(/has gone up/)).not.toBeInTheDocument()

    await act(async () => {
      await getOutbox().save(doneUrl(ID), BODY)
      await getOutbox().save(ratingUrl('r1'), { rpe: 5 })
    })
    connected = true
    await act(async () => {
      await getOutbox().flush()
    })
    expect(await screen.findByText('The run saved on this phone has gone up.')).toBeVisible()
    expect(await screen.findByText('The rating saved on this phone has gone up.')).toBeVisible()
  })

  test('a session logged elsewhere, found on replay, leaves one plain notice and no entry', async () => {
    let connected = false
    mockApi({ [`PUT ${doneUrl(ID)}`]: () => (connected ? conflict : offline) })
    const { result } = renderHook(() => ({ save: useSaveDone(), notices: useActivityNotices() }), {
      wrapper,
    })
    await act(async () => {
      await result.current.save.mutateAsync({ id: ID, body: BODY })
    })
    connected = true
    await act(async () => {
      await getOutbox().flush()
    })
    expect(getOutbox().getState().entries).toEqual([])
    expect(result.current.notices.notices.map((n) => n.message)).toEqual([ALREADY])
  })
})

describe('a conflict found on replay', () => {
  test('reads Today again, so the card agrees with the notice', async () => {
    let connected = false
    mockApi({ [`PUT ${doneUrl(ID)}`]: () => (connected ? conflict : offline) })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(
      () => {
        useOutboxReplay('u1')
        return useSaveDone()
      },
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      },
    )
    await act(async () => {
      await result.current.mutateAsync({ id: ID, body: BODY })
    })
    invalidate.mockClear()
    connected = true
    await act(async () => {
      await getOutbox().flush()
    })
    const keysRead = invalidate.mock.calls.map(
      ([filter]) => (filter as { queryKey: string[] }).queryKey[0],
    )
    expect(keysRead).toContain('today')
  })
})

describe('a rating through the outbox', () => {
  test('is queued with no connection and merges a second rating into the first', async () => {
    mockApi({ [`PUT ${ratingUrl('r1')}`]: () => offline })
    const { result } = renderHook(() => useSaveRating('r1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ rpe: 6 })
    })
    await act(async () => {
      await result.current.mutateAsync({ pain: 2 })
    })
    const entries = getOutbox().getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]?.body).toEqual({ rpe: 6, pain: 2 })
  })
})

describe('the Done sheet when the session was logged elsewhere', () => {
  test('says so in plain words, offers Back to Today and keeps no draft', async () => {
    const user = userEvent.setup()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(ID)
    mockApi({ [`PUT ${doneUrl(ID)}`]: () => conflict })
    const onSaved = vi.fn()
    render(
      <MemoryRouter>
        <DoneSheet
          plan={{ kind: 'easy', durationMin: 45, distanceM: 6000 }}
          sessionId="s1"
          date={DAY}
          units="km"
          onClose={vi.fn()}
          onSaved={onSaved}
        />
      </MemoryRouter>,
      { wrapper },
    )
    const sheet = await screen.findByRole('dialog', { name: "Log today's run" })
    await user.click(within(sheet).getByRole('button', { name: 'RPE 5' }))
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await within(sheet).findByRole('status')).toHaveTextContent(ALREADY)
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(Object.keys(window.localStorage).filter((k) => k.startsWith('rl_done_draft'))).toEqual(
      [],
    )
    expect(getOutbox().getState().entries).toEqual([])
    await user.click(within(sheet).getByRole('button', { name: 'Back to Today' }))
    expect(onSaved).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(getOutbox().getState().notices).toEqual([])
    })
  })
})
