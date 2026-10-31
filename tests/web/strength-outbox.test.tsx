import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import {
  strengthLogUrl,
  useSaveStrengthLog,
  useStrengthView,
  type StrengthLogBody,
} from '../../web/api/strength.ts'
import { getOutbox, useOutboxReplay } from '../../web/pwa/outbox.ts'
import { delayResponses, mockApi } from './helpers.tsx'
import { DAY, lb, makeView, savedLog, SESSION_ID } from './strength-fixtures.ts'

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
