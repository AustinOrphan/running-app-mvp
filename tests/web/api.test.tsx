import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { useLogin, useLogout, useMe, useSetup } from '../../web/api/auth.ts'
import {
  useActivities,
  useCreateActivity,
  useDeleteActivity,
  useResolveDuplicate,
  useUpdateActivity,
} from '../../web/api/activities.ts'
import { keys } from '../../web/api/client.ts'
import {
  useActivateGoal,
  useCreateGoal,
  useDeleteGoal,
  useGoals,
  useUpdateGoal,
} from '../../web/api/goals.ts'
import { useImportFile, useImports } from '../../web/api/imports.ts'
import { useGeneratePlan, usePlan, useUpdatePlanWeek } from '../../web/api/plan.ts'
import { useReviews, useSaveReview } from '../../web/api/reviews.ts'
import { useSettings, useUpdateSettings } from '../../web/api/settings.ts'
import { useWeeks } from '../../web/api/weeks.ts'
import { mockApi, type MockRoutes } from './helpers.tsx'

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } },
  })
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, wrapper }
}

const user = { id: 'u1', email: 'runner@example.com', displayName: null, units: 'mi' as const }
const activityInput = { date: '2026-03-03', type: 'run' as const, durationSec: 2700 }
const goalInput = {
  name: 'Spring half',
  priority: 'A' as const,
  status: 'target' as const,
  targetDate: '2026-05-10',
  dateProvisional: false,
}

/** Routes that answer every contract path with a harmless body. */
function allRoutes(overrides: MockRoutes = {}): MockRoutes {
  return {
    'GET /api/auth/me': () => user,
    'GET /api/setup': () => ({ needsSetup: false }),
    'POST /api/auth/login': () => user,
    'POST /api/setup': () => ({ status: 201, body: user }),
    'POST /api/auth/logout': () => ({ status: 204, body: undefined }),
    'GET /api/settings': () => user,
    'PUT /api/settings': () => user,
    'GET /api/activities': () => [],
    'POST /api/activities': () => ({ status: 201, body: {} }),
    'PUT /api/activities/a1': () => ({}),
    'DELETE /api/activities/a1': () => ({ status: 204, body: undefined }),
    'POST /api/activities/a1/duplicate': () => ({}),
    'GET /api/imports': () => [],
    'POST /api/imports/smashrun': () => ({ status: 201, body: {} }),
    'POST /api/imports/csv': () => ({ status: 201, body: {} }),
    'GET /api/goals': () => [],
    'POST /api/goals': () => ({ status: 201, body: {} }),
    'PUT /api/goals/g1': () => ({}),
    'DELETE /api/goals/g1': () => ({ status: 204, body: undefined }),
    'POST /api/goals/g1/activate': () => ({}),
    'GET /api/plan': () => null,
    'POST /api/plan/generate': () => ({ status: 201, body: {} }),
    'PUT /api/plan/weeks/2026-03-02': () => ({}),
    'GET /api/reviews': () => [],
    'PUT /api/reviews/2026-03-02': () => ({}),
    'GET /api/weeks': () => [],
    ...overrides,
  }
}

describe('request shapes', () => {
  test('every hook sends the contract method, URL, query string and JSON body', async () => {
    const { calls } = mockApi(allRoutes())
    const { wrapper } = setup()

    const { result } = renderHook(
      () => ({
        activities: useActivities({ from: '2026-03-01', to: '2026-03-31', type: 'run' }),
        everything: useActivities({}),
        weeks: useWeeks({ from: '2026-01-05', to: '2026-03-02' }),
        reviews: useReviews({ from: '2026-02-23', to: '2026-03-02' }),
        plan: usePlan(),
        goals: useGoals(),
        imports: useImports(),
        settings: useSettings(),
        createActivity: useCreateActivity(),
        updateActivity: useUpdateActivity(),
        deleteActivity: useDeleteActivity(),
        resolve: useResolveDuplicate(),
        createGoal: useCreateGoal(),
        updateGoal: useUpdateGoal(),
        deleteGoal: useDeleteGoal(),
        activate: useActivateGoal(),
        generate: useGeneratePlan(),
        week: useUpdatePlanWeek(),
        review: useSaveReview(),
        importFile: useImportFile(),
        updateSettings: useUpdateSettings(),
      }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.activities.isSuccess).toBe(true)
      expect(result.current.weeks.isSuccess).toBe(true)
      expect(result.current.reviews.isSuccess).toBe(true)
      expect(result.current.plan.isSuccess).toBe(true)
      expect(result.current.goals.isSuccess).toBe(true)
      expect(result.current.imports.isSuccess).toBe(true)
      expect(result.current.settings.isSuccess).toBe(true)
    })

    const urls = calls.map((c) => `${c.method} ${c.url}`)
    expect(urls).toContain('GET /api/activities?from=2026-03-01&to=2026-03-31&type=run')
    expect(urls).toContain('GET /api/activities')
    expect(urls).toContain('GET /api/weeks?from=2026-01-05&to=2026-03-02')
    expect(urls).toContain('GET /api/reviews?from=2026-02-23&to=2026-03-02')
    expect(urls).toContain('GET /api/plan')
    expect(urls).toContain('GET /api/goals')
    expect(urls).toContain('GET /api/imports')
    expect(urls).toContain('GET /api/settings')

    const sent = async (run: () => Promise<unknown>) => {
      const before = calls.length
      await act(run)
      return calls.slice(before).find((c) => c.method !== 'GET')
    }

    expect(await sent(() => result.current.createActivity.mutateAsync(activityInput))).toEqual({
      method: 'POST',
      url: '/api/activities',
      body: activityInput,
    })
    expect(
      await sent(() =>
        result.current.updateActivity.mutateAsync({ id: 'a1', input: activityInput }),
      ),
    ).toEqual({ method: 'PUT', url: '/api/activities/a1', body: activityInput })
    expect(await sent(() => result.current.deleteActivity.mutateAsync('a1'))).toEqual({
      method: 'DELETE',
      url: '/api/activities/a1',
      body: undefined,
    })
    expect(
      await sent(() => result.current.resolve.mutateAsync({ id: 'a1', status: 'confirmed' })),
    ).toEqual({
      method: 'POST',
      url: '/api/activities/a1/duplicate',
      body: { status: 'confirmed' },
    })
    expect(await sent(() => result.current.createGoal.mutateAsync(goalInput))).toEqual({
      method: 'POST',
      url: '/api/goals',
      body: goalInput,
    })
    expect(
      await sent(() => result.current.updateGoal.mutateAsync({ id: 'g1', input: goalInput })),
    ).toEqual({ method: 'PUT', url: '/api/goals/g1', body: goalInput })
    expect(await sent(() => result.current.deleteGoal.mutateAsync('g1'))).toEqual({
      method: 'DELETE',
      url: '/api/goals/g1',
      body: undefined,
    })
    expect(await sent(() => result.current.activate.mutateAsync('g1'))).toEqual({
      method: 'POST',
      url: '/api/goals/g1/activate',
      body: undefined,
    })
    expect(
      await sent(() =>
        result.current.generate.mutateAsync({ goalId: 'g1', strengthPreference: 1 }),
      ),
    ).toEqual({
      method: 'POST',
      url: '/api/plan/generate',
      body: { goalId: 'g1', strengthPreference: 1 },
    })
    expect(
      await sent(() =>
        result.current.week.mutateAsync({ weekStart: '2026-03-02', patch: { targetRunMin: 300 } }),
      ),
    ).toEqual({ method: 'PUT', url: '/api/plan/weeks/2026-03-02', body: { targetRunMin: 300 } })
    expect(
      await sent(() =>
        result.current.review.mutateAsync({ weekStart: '2026-03-02', patch: { fatigue: 4 } }),
      ),
    ).toEqual({ method: 'PUT', url: '/api/reviews/2026-03-02', body: { fatigue: 4 } })
    expect(
      await sent(() =>
        result.current.importFile.mutateAsync({
          kind: 'smashrun',
          fileName: 'a.csv',
          text: 'x',
          distanceUnit: 'mi',
        }),
      ),
    ).toEqual({
      method: 'POST',
      url: '/api/imports/smashrun',
      body: { fileName: 'a.csv', text: 'x', distanceUnit: 'mi' },
    })
    expect(
      await sent(() =>
        result.current.importFile.mutateAsync({ kind: 'csv', fileName: 'b.csv', text: 'y' }),
      ),
    ).toEqual({
      method: 'POST',
      url: '/api/imports/csv',
      body: { fileName: 'b.csv', text: 'y' },
    })
    expect(await sent(() => result.current.updateSettings.mutateAsync({ units: 'km' }))).toEqual({
      method: 'PUT',
      url: '/api/settings',
      body: { units: 'km' },
    })
  })

  test('query keys are [keys.<resource>, params]', async () => {
    mockApi(allRoutes())
    const { queryClient, wrapper } = setup()
    const params = { from: '2026-03-01', to: '2026-03-31' }
    const { result } = renderHook(() => useActivities(params), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(queryClient.getQueryData([keys.activities, params])).toEqual([])
  })
})

describe('invalidation', () => {
  function mountReaders() {
    const harness = setup()
    const rendered = renderHook(
      () => ({
        activities: useActivities({}),
        weeks: useWeeks({ from: '2026-01-05', to: '2026-03-02' }),
        reviews: useReviews({ from: '2026-02-23', to: '2026-03-02' }),
        plan: usePlan(),
        goals: useGoals(),
        imports: useImports(),
        settings: useSettings(),
        me: useMe(),
        createActivity: useCreateActivity(),
        deleteActivity: useDeleteActivity(),
        resolve: useResolveDuplicate(),
        importFile: useImportFile(),
        createGoal: useCreateGoal(),
        activate: useActivateGoal(),
        generate: useGeneratePlan(),
        week: useUpdatePlanWeek(),
        review: useSaveReview(),
        updateSettings: useUpdateSettings(),
      }),
      { wrapper: harness.wrapper },
    )
    return { ...harness, ...rendered }
  }

  async function settle(result: { current: ReturnType<typeof mountReaders>['result']['current'] }) {
    await waitFor(() => {
      expect(result.current.activities.isSuccess).toBe(true)
      expect(result.current.weeks.isSuccess).toBe(true)
      expect(result.current.reviews.isSuccess).toBe(true)
      expect(result.current.plan.isSuccess).toBe(true)
      expect(result.current.goals.isSuccess).toBe(true)
      expect(result.current.imports.isSuccess).toBe(true)
      expect(result.current.settings.isSuccess).toBe(true)
      expect(result.current.me.isSuccess).toBe(true)
    })
  }

  /** GET counts per resource root since `from`. */
  function refetched(calls: Array<{ method: string; url: string }>, from: number): string[] {
    const roots = new Set<string>()
    for (const call of calls.slice(from)) {
      if (call.method !== 'GET') continue
      const match = /^\/api\/([a-z/]+)/.exec(call.url)
      const root = match?.[1]
      if (root !== undefined) roots.add(root === 'auth/me' ? 'me' : root)
    }
    return [...roots].sort()
  }

  async function run(
    mutate: (r: ReturnType<typeof mountReaders>['result']['current']) => Promise<unknown>,
  ): Promise<string[]> {
    const { calls } = mockApi(allRoutes())
    const { result } = mountReaders()
    await settle(result)
    const before = calls.length
    await act(() => mutate(result.current))
    await waitFor(() => {
      expect(result.current.activities.isFetching).toBe(false)
    })
    return refetched(calls, before)
  }

  test('activities refetch activities, weeks and reviews', async () => {
    expect(await run((r) => r.createActivity.mutateAsync(activityInput))).toEqual([
      'activities',
      'reviews',
      'weeks',
    ])
    expect(await run((r) => r.deleteActivity.mutateAsync('a1'))).toEqual([
      'activities',
      'reviews',
      'weeks',
    ])
    expect(await run((r) => r.resolve.mutateAsync({ id: 'a1', status: 'dismissed' }))).toEqual([
      'activities',
      'reviews',
      'weeks',
    ])
  })

  test('imports also refetch the import list', async () => {
    expect(
      await run((r) => r.importFile.mutateAsync({ kind: 'csv', fileName: 'a.csv', text: 'x' })),
    ).toEqual(['activities', 'imports', 'reviews', 'weeks'])
  })

  test('goals refetch goals and plan', async () => {
    expect(await run((r) => r.createGoal.mutateAsync(goalInput))).toEqual(['goals', 'plan'])
    expect(await run((r) => r.activate.mutateAsync('g1'))).toEqual(['goals', 'plan'])
  })

  test('plan generation and week edits refetch plan and reviews', async () => {
    expect(await run((r) => r.generate.mutateAsync({ goalId: 'g1' }))).toEqual(['plan', 'reviews'])
    expect(
      await run((r) => r.week.mutateAsync({ weekStart: '2026-03-02', patch: { runDays: 4 } })),
    ).toEqual(['plan', 'reviews'])
  })

  test('a review save refetches reviews and plan', async () => {
    expect(
      await run((r) => r.review.mutateAsync({ weekStart: '2026-03-02', patch: { fatigue: 3 } })),
    ).toEqual(['plan', 'reviews'])
  })

  test('settings refetch settings and me', async () => {
    expect(await run((r) => r.updateSettings.mutateAsync({ units: 'km' }))).toEqual([
      'me',
      'settings',
    ])
  })
})

describe('auth hooks', () => {
  test('useMe is null on 401', async () => {
    mockApi({
      'GET /api/auth/me': () => ({
        status: 401,
        body: { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
      }),
    })
    const { wrapper } = setup()
    const { result } = renderHook(() => useMe(), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toBeNull()
  })

  test('login and setup put the user in the me cache', async () => {
    const { calls } = mockApi(allRoutes())
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => ({ login: useLogin(), setup: useSetup() }), { wrapper })

    await act(() =>
      result.current.login.mutateAsync({
        email: 'runner@example.com',
        password: 'a-long-password',
      }),
    )
    expect(queryClient.getQueryData([keys.me])).toEqual(user)
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'runner@example.com', password: 'a-long-password' },
    })

    queryClient.removeQueries({ queryKey: [keys.me] })
    await act(() =>
      result.current.setup.mutateAsync({
        email: 'runner@example.com',
        password: 'a-long-password',
        displayName: 'Sample',
      }),
    )
    expect(queryClient.getQueryData([keys.me])).toEqual(user)
    expect(queryClient.getQueryData([keys.setup])).toEqual({ needsSetup: false })
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      url: '/api/setup',
      body: { email: 'runner@example.com', password: 'a-long-password', displayName: 'Sample' },
    })
  })

  test('useLogout clears the cache and leaves no signed-in user', async () => {
    const { calls } = mockApi(allRoutes())
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData([keys.activities, {}], [{ id: 'a1' }])
    queryClient.setQueryData([keys.me], user)
    const { result } = renderHook(() => useLogout(), { wrapper })
    await act(() => result.current.mutateAsync())
    expect(calls.at(-1)?.url).toBe('/api/auth/logout')
    expect(queryClient.getQueryData([keys.activities, {}])).toBeUndefined()
    expect(queryClient.getQueryData([keys.me])).toBeNull()
  })
})
