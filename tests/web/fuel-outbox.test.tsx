import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { fuelLogUrl, useFuelLab, useSaveFuelLog, type FuelLogBody } from '../../web/api/fuel.ts'
import { getOutbox, useOutboxReplay } from '../../web/pwa/outbox.ts'
import { loggedRun, makeLab, saved } from './fuel-fixtures.ts'
import { delayResponses, mockApi } from './helpers.tsx'

const ACTIVITY = 'run9'
const BODY: FuelLogBody = {
  items: [{ productId: 'p-gel', servings: 2 }],
  fluidMl: 600,
  sodiumMg: null,
  gut: 1,
  nausea: null,
  hot: null,
  notes: null,
}

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(
    () => {
      useOutboxReplay('u1')
      return { lab: useFuelLab(), save: useSaveFuelLog() }
    },
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    },
  )
}

describe('a fuel log saved through the outbox', () => {
  test('is queued with no connection, sent when it returns, and the ladder is read again then', async () => {
    const runs = [loggedRun(9)]
    let connected = false
    const { calls } = mockApi({
      'GET /api/fuel': () => makeLab(),
      [`PUT ${fuelLogUrl(ACTIVITY)}`]: () =>
        connected
          ? saved(runs, ACTIVITY)
          : { status: 503, body: { error: { code: 'internal', message: 'Offline.' } } },
    })
    const { result } = mount()
    await waitFor(() => {
      expect(result.current.lab.isSuccess).toBe(true)
    })
    const labReads = () => calls.filter((call) => call.method === 'GET').length

    let answer: unknown
    await act(async () => {
      answer = await result.current.save.mutateAsync({ activityId: ACTIVITY, body: BODY })
    })
    expect(answer).toEqual({ status: 'queued' })
    expect(getOutbox().getState().entries).toHaveLength(1)
    // Nothing reached the server, so nothing changed there and the ladder is not read again.
    expect(labReads()).toBe(1)

    connected = true
    await act(async () => {
      await getOutbox().flush()
    })
    await waitFor(() => {
      expect(labReads()).toBe(2)
    })
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([
      BODY,
      BODY,
    ])
    expect(getOutbox().getState().entries).toEqual([])
  })

  test('sent at once, it answers with the server sentence and reads the ladder again once', async () => {
    const runs = [loggedRun(9)]
    const answerBody = saved(runs, ACTIVITY)
    const { calls } = mockApi({
      'GET /api/fuel': () => makeLab(),
      [`PUT ${fuelLogUrl(ACTIVITY)}`]: () => answerBody,
    })
    // A real request takes a moment; the two refreshes meet while the first read is on its way.
    delayResponses(15)
    const { result } = mount()
    await waitFor(() => {
      expect(result.current.lab.isSuccess).toBe(true)
    })
    let answer: unknown
    await act(async () => {
      answer = await result.current.save.mutateAsync({ activityId: ACTIVITY, body: BODY })
    })
    expect(answer).toEqual({ status: 'sent', message: answerBody.message })
    await waitFor(() => {
      expect(result.current.lab.isFetching).toBe(false)
    })
    // The first read, and one more for the save: the listener's refresh and the mutation's joined.
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2)
  })

  test('a refusal comes back as the answer, with nothing queued', async () => {
    mockApi({
      'GET /api/fuel': () => makeLab(),
      [`PUT ${fuelLogUrl(ACTIVITY)}`]: () => ({
        status: 400,
        body: { error: { code: 'validation', message: 'Pick a gut score.' } },
      }),
    })
    const { result } = mount()
    await waitFor(() => {
      expect(result.current.lab.isSuccess).toBe(true)
    })
    let answer: unknown
    await act(async () => {
      answer = await result.current.save.mutateAsync({ activityId: ACTIVITY, body: BODY })
    })
    expect(answer).toEqual({ status: 'rejected', reason: 'Pick a gut score.' })
    expect(getOutbox().getState().entries).toEqual([])
  })
})
