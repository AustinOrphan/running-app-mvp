import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { ACTIVITY_DATA_KEYS, invalidateActivityData } from '../../web/api/activities.ts'
import { invalidatePlanReaders, keys } from '../../web/api/client.ts'
import {
  strengthLogUrl,
  useDeleteStrengthLift,
  useDeleteStrengthLog,
  useExerciseHistory,
  useSaveStrengthLift,
  useSaveStrengthSettings,
  useStrengthUnits,
  useStrengthView,
  useStrengthWorkouts,
} from '../../web/api/strength.ts'
import { useSettings, useUpdateSettings } from '../../web/api/settings.ts'
import { useToday } from '../../web/api/today.ts'
import { OUTBOX_ROUTES } from '../../web/pwa/outbox.ts'
import { mockApi } from './helpers.tsx'
import { DAY, makeView, makeWorkout, SETTINGS, STRENGTH_SETTINGS } from './strength-fixtures.ts'

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    queryClient,
    wrap: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  }
}

describe('the strength reads', () => {
  test('the view is one read of GET /api/strength', async () => {
    const { calls } = mockApi({ 'GET /api/strength': () => makeView() })
    const { wrap } = wrapper()
    const { result } = renderHook(() => useStrengthView(), { wrapper: wrap })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.settings.level).toBe('some')
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET /api/strength'])
  })

  test('the view reads nothing while it is disabled', async () => {
    const { calls } = mockApi({})
    const { wrap } = wrapper()
    renderHook(() => useStrengthView({ enabled: false }), { wrapper: wrap })
    await act(async () => {
      await Promise.resolve()
    })
    expect(calls).toEqual([])
  })

  test('the workouts of a span are read with its two ends', async () => {
    const { calls } = mockApi({ 'GET /api/strength/workouts': () => [makeWorkout()] })
    const { wrap } = wrapper()
    const { result } = renderHook(() => useStrengthWorkouts(DAY, '2026-03-25'), { wrapper: wrap })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toHaveLength(1)
    expect(calls[0]?.url).toBe(`/api/strength/workouts?from=${DAY}&to=2026-03-25`)
  })

  test('the history of an exercise is read by its id, and not before there is one', async () => {
    const { calls } = mockApi({
      'GET /api/strength/exercises/back-squat': () => ({
        exerciseId: 'back-squat',
        anchor: null,
        summary: null,
        sessions: [],
      }),
    })
    const { wrap } = wrapper()
    const idle = renderHook(() => useExerciseHistory(undefined), { wrapper: wrap })
    expect(idle.result.current.fetchStatus).toBe('idle')
    const { result } = renderHook(() => useExerciseHistory('back-squat'), { wrapper: wrap })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(calls.map((call) => call.url)).toEqual(['/api/strength/exercises/back-squat'])
  })
})

describe('the units of a load', () => {
  test('are not known until the settings arrive, then are the runner own', async () => {
    mockApi({ 'GET /api/settings': () => ({ ...SETTINGS, units: 'km', weightUnit: 'kg' }) })
    const { wrap } = wrapper()
    const { result } = renderHook(() => useStrengthUnits(), { wrapper: wrap })
    expect(result.current.data).toBeUndefined()
    await waitFor(() => {
      expect(result.current.data).toEqual({ weightUnit: 'kg', units: 'km' })
    })
  })

  test('read as pounds from a kept answer that predates the weight unit', async () => {
    mockApi({
      'GET /api/settings': () => ({ email: 'runner@example.com', displayName: null, units: 'mi' }),
    })
    const { wrap } = wrapper()
    const { result } = renderHook(() => useStrengthUnits(), { wrapper: wrap })
    await waitFor(() => {
      expect(result.current.data).toEqual({ weightUnit: 'lb', units: 'mi' })
    })
  })

  test('say so when the settings cannot be read, and never guess a unit', async () => {
    mockApi({
      'GET /api/settings': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Down.' } },
      }),
    })
    const { wrap } = wrapper()
    const { result } = renderHook(() => useStrengthUnits(), { wrapper: wrap })
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect(result.current.data).toBeUndefined()
  })
})

describe('the strength writes', () => {
  test('a settings write sends the body and reads the strength readers and Today again', async () => {
    const { calls } = mockApi({
      'GET /api/strength': () => makeView(),
      'GET /api/today': () => ({}),
      'PUT /api/strength/settings': ({ body }) => ({
        ...STRENGTH_SETTINGS,
        ...(body as object),
      }),
    })
    const { wrap } = wrapper()
    // both are on screen, so both are read again after the write
    const view = renderHook(() => ({ strength: useStrengthView(), today: useToday() }), {
      wrapper: wrap,
    })
    await waitFor(() => {
      expect(view.result.current.strength.isSuccess).toBe(true)
      expect(view.result.current.today.isSuccess).toBe(true)
    })
    const { result } = renderHook(() => useSaveStrengthSettings(), { wrapper: wrap })
    await act(async () => {
      await result.current.mutateAsync({ pinned: { knee: 'leg-press' } })
    })
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      pinned: { knee: 'leg-press' },
    })
    await waitFor(() => {
      expect(calls.filter((call) => call.url === '/api/strength')).toHaveLength(2)
    })
    expect(calls.filter((call) => call.url === '/api/today')).toHaveLength(2)
  })

  test('a change of the weight unit reads the strength readers and Today again; no other setting does', async () => {
    const { calls } = mockApi({
      'GET /api/settings': () => SETTINGS,
      'GET /api/auth/me': () => ({ id: 'u1', ...SETTINGS }),
      'GET /api/strength': () => makeView(),
      'GET /api/today': () => ({}),
      'PUT /api/settings': ({ body }) => ({ ...SETTINGS, ...(body as object) }),
    })
    const { wrap } = wrapper()
    // the grid of every prescribed load is the unit's, so what was read in the other unit is stale
    const view = renderHook(
      () => ({ strength: useStrengthView(), today: useToday(), settings: useSettings() }),
      { wrapper: wrap },
    )
    await waitFor(() => {
      expect(view.result.current.strength.isSuccess).toBe(true)
      expect(view.result.current.today.isSuccess).toBe(true)
      expect(view.result.current.settings.isSuccess).toBe(true)
    })
    const reads = (url: string) => calls.filter((call) => call.url === url).length
    const { result } = renderHook(() => useUpdateSettings(), { wrapper: wrap })

    await act(async () => {
      await result.current.mutateAsync({ displayName: 'Sam' })
    })
    expect(reads('/api/settings')).toBeGreaterThan(1)
    expect(reads('/api/strength')).toBe(1)
    expect(reads('/api/today')).toBe(1)

    await act(async () => {
      await result.current.mutateAsync({ weightUnit: 'kg' })
    })
    // the write resolves once they have been read again
    expect(reads('/api/strength')).toBe(2)
    expect(reads('/api/today')).toBe(2)
    expect(calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([
      { displayName: 'Sam' },
      { weightUnit: 'kg' },
    ])
  })

  test('a starting point is put and removed by exercise', async () => {
    const { calls } = mockApi({
      'PUT /api/strength/lifts/back-squat': ({ body }) => ({
        exerciseId: 'back-squat',
        reps: 1,
        rir: null,
        asOf: DAY,
        ...(body as object),
      }),
      'DELETE /api/strength/lifts/back-squat': () => undefined,
    })
    const { wrap } = wrapper()
    const save = renderHook(() => useSaveStrengthLift(), { wrapper: wrap })
    await act(async () => {
      await save.result.current.mutateAsync({
        exerciseId: 'back-squat',
        body: { kind: 'max', loadG: 100000 },
      })
    })
    const remove = renderHook(() => useDeleteStrengthLift(), { wrapper: wrap })
    await act(async () => {
      await remove.result.current.mutateAsync('back-squat')
    })
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PUT /api/strength/lifts/back-squat',
      'DELETE /api/strength/lifts/back-squat',
    ])
    expect(calls[0]?.body).toEqual({ kind: 'max', loadG: 100000 })
  })

  /** The roots of the queries a call marks stale, once each, sorted. */
  async function staleAfter(
    roots: readonly string[],
    run: (queryClient: QueryClient) => Promise<unknown>,
  ): Promise<string[]> {
    const { queryClient } = wrapper()
    const stale = new Set<string>()
    for (const key of roots) queryClient.setQueryData([key, 'seed'], {})
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'invalidate') {
        stale.add(String((event.query.queryKey as readonly unknown[])[0]))
      }
    })
    await run(queryClient)
    return [...stale].sort()
  }

  test('removing a log reads the strength readers, Today and every reader of activity data again', async () => {
    mockApi({ 'DELETE /api/strength/logs/log-0001': () => undefined })
    const { wrap, queryClient } = wrapper()
    const stale = new Set<string>()
    for (const key of ACTIVITY_DATA_KEYS) queryClient.setQueryData([key, 'seed'], {})
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'invalidate') {
        stale.add(String((event.query.queryKey as readonly unknown[])[0]))
      }
    })
    const { result } = renderHook(() => useDeleteStrengthLog(), { wrapper: wrap })
    await act(async () => {
      await result.current.mutateAsync('log-0001')
    })
    expect([...stale].sort()).toEqual([...ACTIVITY_DATA_KEYS].sort())
    expect(stale).toContain(keys.strength)
  })

  test('a write to activity data reads the strength readers again: a deleted activity takes its log', async () => {
    const stale = await staleAfter([keys.strength, keys.today, keys.activities], (queryClient) =>
      invalidateActivityData(queryClient),
    )
    expect(stale).toEqual([keys.activities, keys.strength, keys.today].sort())
  })

  test('a write to the plan reads the strength readers again: the workouts follow the stored plan', async () => {
    const stale = await staleAfter([keys.strength, keys.today, keys.plan], (queryClient) =>
      invalidatePlanReaders(queryClient),
    )
    expect(stale).toEqual([keys.plan, keys.strength, keys.today].sort())
  })
})

describe('the outbox route of a strength log', () => {
  const route = OUTBOX_ROUTES.find((candidate) => candidate.label === 'strength log')

  test('matches the URL the hook saves to', () => {
    expect(route?.matches(strengthLogUrl('3f2b7c1e-8d4a-4f6b-9a31-5c0e2d7b6a10'))).toBe(true)
  })

  test('refreshes what activity data moves, the strength readers among them and listed once', () => {
    expect(route?.combine).toBe('replace')
    expect(route?.invalidates).toEqual([...ACTIVITY_DATA_KEYS])
    expect(route?.invalidates.filter((key) => key === keys.strength)).toHaveLength(1)
    expect(route?.invalidates).toEqual(
      expect.arrayContaining([keys.strength, keys.today, keys.activities, keys.plan, keys.weeks]),
    )
  })
})
