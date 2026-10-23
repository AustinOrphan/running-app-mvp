import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test, vi, type MockInstance } from 'vitest'
import type { ActivityListPage } from '../../shared/types.ts'
import { useLogin, useLogout, useMe, useSetup } from '../../web/api/auth.ts'
import {
  ACTIVITY_FOLLOW_MAX_PAGES,
  useActivities,
  joinPages,
  useActivityPages,
  useCreateActivity,
  useDeleteActivity,
  useResolveDuplicate,
  useUpdateActivity,
} from '../../web/api/activities.ts'
import { createQueryClient, invalidateNewPlan, keys } from '../../web/api/client.ts'
import {
  useActivateGoal,
  useCreateGoal,
  useDeleteGoal,
  useGoals,
  useUpdateGoal,
} from '../../web/api/goals.ts'
import { useImportFile, useImports } from '../../web/api/imports.ts'
import {
  useGeneratePlan,
  useLinkPlanSession,
  usePlan,
  usePlanRevisions,
  useUpdatePlanWeek,
} from '../../web/api/plan.ts'
import { useReviews, useSaveReview } from '../../web/api/reviews.ts'
import { useSettings, useUpdateSettings } from '../../web/api/settings.ts'
import { useProfile, useUpdateProfile } from '../../web/api/profile.ts'
import { useAthleteState } from '../../web/api/state.ts'
import { useStats } from '../../web/api/stats.ts'
import { useToday } from '../../web/api/today.ts'
import { useWeeks } from '../../web/api/weeks.ts'
import {
  useAcceptZoneProposal,
  useDeclineZoneProposal,
  useZoneProposals,
  useZones,
} from '../../web/api/zones.ts'
import { activityPage, activityRoute, mockApi, type MockRoutes } from './helpers.tsx'
import { makeActivity } from '../factories.ts'

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

const emptyStats = { monthly: [], yearly: [], efforts: [], longest: [] }

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
    'GET /api/activities': () => activityPage([]),
    'GET /api/stats': () => emptyStats,
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
    expect(urls).toContain(
      'GET /api/activities?from=2026-03-01&to=2026-03-31&type=run&limit=500&offset=0',
    )
    expect(urls).toContain('GET /api/activities?limit=500&offset=0')
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
    expect(await sent(() => result.current.activate.mutateAsync({ id: 'g1' }))).toEqual({
      method: 'POST',
      url: '/api/goals/g1/activate',
      body: undefined,
    })
    expect(
      await sent(() => result.current.activate.mutateAsync({ id: 'g1', replacePlan: true })),
    ).toEqual({
      method: 'POST',
      url: '/api/goals/g1/activate',
      body: { replacePlan: true },
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

describe('the activity list', () => {
  const rows = Array.from({ length: 1203 }, (_, i) =>
    makeActivity({ id: `a${String(i).padStart(4, '0')}`, date: '2026-03-02' }),
  )

  test('useActivities follows nextOffset in pages of 500 and returns every row', async () => {
    const serve = activityRoute(rows)
    const { calls } = mockApi(allRoutes({ 'GET /api/activities': serve }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useActivities({ type: 'run' }), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.map((a) => a.id)).toEqual(rows.map((a) => a.id))
    expect(calls.map((c) => c.url)).toEqual([
      '/api/activities?type=run&limit=500&offset=0',
      '/api/activities?type=run&limit=500&offset=500',
      '/api/activities?type=run&limit=500&offset=1000',
    ])
  })

  test('useActivities stops after ACTIVITY_FOLLOW_MAX_PAGES when the server keeps saying more', async () => {
    const { calls } = mockApi(
      allRoutes({
        'GET /api/activities': ({ query }) =>
          activityPage([makeActivity()], {
            offset: Number(query.get('offset')),
            nextOffset: Number(query.get('offset')) + 1,
          }),
      }),
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => useActivities(), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(calls).toHaveLength(ACTIVITY_FOLLOW_MAX_PAGES)
    expect(result.current.data).toHaveLength(ACTIVITY_FOLLOW_MAX_PAGES)
  })

  test('useActivities drops the heart-rate histogram the server leaves out', async () => {
    mockApi(allRoutes({ 'GET /api/activities': activityRoute(rows.slice(0, 2)) }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useActivities(), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.[0]).not.toHaveProperty('hrHistogram')
  })

  test('useActivityPages reads 50 at a time and joins the pages; the total is the server`s', async () => {
    const { calls } = mockApi(allRoutes({ 'GET /api/activities': activityRoute(rows) }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useActivityPages({ from: '2026-03-01' }), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toMatchObject({ total: 1203 })
    expect(result.current.data?.items).toHaveLength(50)
    expect(result.current.hasNextPage).toBe(true)

    await act(() => result.current.fetchNextPage())
    await waitFor(() => {
      expect(result.current.data?.items).toHaveLength(100)
    })
    expect(result.current.data?.items.map((a) => a.id)).toEqual(rows.slice(0, 100).map((a) => a.id))
    expect(calls.map((c) => c.url)).toEqual([
      '/api/activities?from=2026-03-01&limit=50&offset=0',
      '/api/activities?from=2026-03-01&limit=50&offset=50',
    ])
  })

  test('useActivityPages shows a row once when a write between two pages shifts the list', async () => {
    // 75 runs, newest first. After page 1 is served a sync adds a newer run, so the list is one
    // longer and the old row 49 comes back as the first row of page 2.
    const all = rows.slice(0, 75)
    const serve = activityRoute(all)
    mockApi(
      allRoutes({
        'GET /api/activities': (req) => {
          if (req.query.get('offset') === '50') all.unshift({ ...rows[200]!, id: 'added-by-sync' })
          return serve(req)
        },
      }),
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => useActivityPages(), { wrapper })
    await waitFor(() => {
      expect(result.current.data?.items).toHaveLength(50)
    })

    await act(() => result.current.fetchNextPage())
    await waitFor(() => {
      expect(result.current.data?.total).toBe(76)
    })
    const ids = result.current.data?.items.map((a) => a.id) ?? []
    expect(new Set(ids).size).toBe(ids.length)
    // The first copy wins, so every row keeps its place and none is repeated.
    expect(ids).toEqual(rows.slice(0, 75).map((a) => a.id))
    expect(result.current.hasNextPage).toBe(false)
  })

  test('joinPages keeps the first copy of a repeated id and the newest total', () => {
    const page = (ids: string[], total: number): ActivityListPage =>
      activityPage(
        ids.map((id) => ({ ...rows[0]!, id })),
        { total },
      )
    const joined = joinPages({ pages: [page(['a', 'b', 'c'], 5), page(['c', 'd', 'e'], 6)] })
    expect(joined.items.map((a) => a.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(joined.total).toBe(6)
    expect(joinPages({ pages: [] })).toEqual({ items: [], total: 0 })
  })

  test('useActivityPages has no next page after the last one', async () => {
    mockApi(allRoutes({ 'GET /api/activities': activityRoute(rows.slice(0, 30)) }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useActivityPages(), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.items).toHaveLength(30)
    expect(result.current.hasNextPage).toBe(false)
  })

  test('a write refetches the statistics along with the list', async () => {
    const { calls } = mockApi(allRoutes())
    const { wrapper } = setup()
    const { result } = renderHook(
      () => ({
        stats: useStats(),
        pages: useActivityPages(),
        create: useCreateActivity(),
      }),
      { wrapper },
    )
    await waitFor(() => {
      expect(result.current.stats.isSuccess).toBe(true)
      expect(result.current.pages.isSuccess).toBe(true)
    })
    const before = calls.length

    await act(() => result.current.create.mutateAsync(activityInput))
    await waitFor(() => {
      expect(calls.slice(before).map((c) => c.url)).toContain('/api/stats')
    })
    expect(calls.slice(before).map((c) => c.url)).toContain('/api/activities?limit=50&offset=0')
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

  test('activities refetch activities, plan, weeks and reviews', async () => {
    expect(await run((r) => r.createActivity.mutateAsync(activityInput))).toEqual([
      'activities',
      'plan',
      'reviews',
      'weeks',
    ])
    expect(await run((r) => r.deleteActivity.mutateAsync('a1'))).toEqual([
      'activities',
      'plan',
      'reviews',
      'weeks',
    ])
    expect(await run((r) => r.resolve.mutateAsync({ id: 'a1', status: 'dismissed' }))).toEqual([
      'activities',
      'plan',
      'reviews',
      'weeks',
    ])
  })

  test('imports also refetch the import list', async () => {
    expect(
      await run((r) => r.importFile.mutateAsync({ kind: 'csv', fileName: 'a.csv', text: 'x' })),
    ).toEqual(['activities', 'imports', 'plan', 'reviews', 'weeks'])
  })

  test('goals refetch goals and plan', async () => {
    expect(await run((r) => r.createGoal.mutateAsync(goalInput))).toEqual(['goals', 'plan'])
    expect(await run((r) => r.activate.mutateAsync({ id: 'g1' }))).toEqual(['goals', 'plan'])
  })

  test('building the plan for another goal refetches goals, plan and reviews like a new plan', async () => {
    expect(await run((r) => r.activate.mutateAsync({ id: 'g1', replacePlan: true }))).toEqual([
      'goals',
      'plan',
      'reviews',
    ])
  })

  test('plan generation refetches goals (it activates the goal), plan and reviews; week edits plan and reviews', async () => {
    expect(await run((r) => r.generate.mutateAsync({ goalId: 'g1' }))).toEqual([
      'goals',
      'plan',
      'reviews',
    ])
    expect(
      await run((r) => r.week.mutateAsync({ weekStart: '2026-03-02', patch: { runDays: 4 } })),
    ).toEqual(['plan', 'reviews'])
  })

  test('a review save refetches reviews and plan', async () => {
    expect(
      await run((r) => r.review.mutateAsync({ weekStart: '2026-03-02', patch: { fatigue: 3 } })),
    ).toEqual(['plan', 'reviews'])
  })

  test('a review save also refetches the plan revisions, so What changed is fresh', async () => {
    const { calls } = mockApi(
      allRoutes({
        'GET /api/plan/revisions': () => [],
        'PUT /api/reviews/2026-03-02': () => ({ revision: null }),
      }),
    )
    const { wrapper } = setup()
    const { result } = renderHook(
      () => ({ revisions: usePlanRevisions(), review: useSaveReview() }),
      { wrapper },
    )
    await waitFor(() => {
      expect(result.current.revisions.isSuccess).toBe(true)
    })
    const count = () => calls.filter((c) => c.url === '/api/plan/revisions').length
    const before = count()
    await act(() =>
      result.current.review.mutateAsync({ weekStart: '2026-03-02', patch: { fatigue: 3 } }),
    )
    await waitFor(() => {
      expect(count()).toBe(before + 1)
    })
  })

  test('settings refetch settings and me', async () => {
    expect(await run((r) => r.updateSettings.mutateAsync({ units: 'km' }))).toEqual([
      'me',
      'settings',
    ])
  })
})

describe('the plan readers', () => {
  /** The roots of the queries that were invalidated, once each, sorted. */
  const rootsOf = (invalidate: MockInstance<QueryClient['invalidateQueries']>) =>
    [...new Set(invalidate.mock.calls.map(([filter]) => (filter?.queryKey as string[])[0]))].sort()

  // What a change to the plan moves: the plan and its sessions, the revisions, the rest windows,
  // the reviews, the brief, the athlete state, Today, the watch status and the fuel targets.
  const READERS = [
    keys.brief,
    keys.disruptions,
    keys.fuel,
    keys.plan,
    keys.planRevisions,
    keys.reviews,
    keys.state,
    keys.today,
    keys.wrist,
  ]

  test('a week edit reads every reader of the plan again, the watch status and fuel included', async () => {
    mockApi(allRoutes())
    const { queryClient, wrapper } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useUpdatePlanWeek(), { wrapper })
    await act(() => result.current.mutateAsync({ weekStart: '2026-03-02', patch: { runDays: 4 } }))
    expect(rootsOf(invalidate)).toEqual(READERS)
  })

  test('a new plan also reads the goals, the archived plans and the predictions again', async () => {
    mockApi(allRoutes())
    const { queryClient, wrapper } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useGeneratePlan(), { wrapper })
    await act(() => result.current.mutateAsync({ goalId: 'g1' }))
    expect(rootsOf(invalidate)).toEqual(
      [...READERS, keys.goals, keys.planArchived, keys.predictions].sort(),
    )
  })

  test('the plan and its reviews are awaited by a new plan; the other readers are not', async () => {
    mockApi(allRoutes())
    const { queryClient, wrapper } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useGeneratePlan(), { wrapper })
    await act(() => result.current.mutateAsync({ goalId: 'g1' }))
    // The plan and the reviews are asked for whole (every query under their key), once.
    const whole = invalidate.mock.calls.filter(([filter]) => filter?.predicate === undefined)
    expect(whole.map(([filter]) => (filter?.queryKey as string[])[0]).sort()).toEqual([
      keys.plan,
      keys.reviews,
    ])
  })

  test.each([
    ['accepting', 'accept'],
    ['declining', 'decline'],
  ] as const)(
    '%s a zone proposal reads every reader of the plan again, with the zones',
    async (_, decision) => {
      mockApi(allRoutes({ [`POST /api/zones/proposals/z1/${decision}`]: () => ({}) }))
      const { queryClient, wrapper } = setup()
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      const { result } = renderHook(
        () => (decision === 'accept' ? useAcceptZoneProposal() : useDeclineZoneProposal()),
        { wrapper },
      )
      await act(() => result.current.mutateAsync('z1'))
      // The decision is written to the revision log, which the brief lists under "Since this brief".
      expect(rootsOf(invalidate)).toEqual([...READERS, keys.zones, keys.zoneProposals].sort())
    },
  )

  test('linking a run to a session reads every reader of the plan again, with the activities', async () => {
    mockApi(allRoutes({ 'POST /api/plan/sessions/s1/link': () => ({}) }))
    const { queryClient, wrapper } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useLinkPlanSession(), { wrapper })
    await act(() => result.current.mutateAsync({ id: 's1', activityId: 'a1' }))
    expect(rootsOf(invalidate)).toEqual([...READERS, keys.activities, keys.activityDetail].sort())
  })

  test('a plan that replaces the old one reads the watch status and fuel again', async () => {
    mockApi(allRoutes())
    const { queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await act(() => invalidateNewPlan(queryClient))
    expect(rootsOf(invalidate)).toEqual(expect.arrayContaining([keys.wrist, keys.fuel, keys.plan]))
  })
})

describe('Today', () => {
  const todayCalls = (calls: Array<{ method: string; url: string }>) =>
    calls.filter((c) => c.method === 'GET' && c.url === '/api/today').length

  test('is read again when the window regains focus once it is stale; the settings are not', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { calls } = mockApi(allRoutes({ 'GET /api/today': () => ({}) }))
      // The app's own defaults: 30 s of freshness and no refetch on focus unless a hook asks.
      const queryClient = createQueryClient()
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      )
      const { result } = renderHook(() => ({ today: useToday(), settings: useSettings() }), {
        wrapper,
      })
      await waitFor(() => {
        expect(result.current.today.isSuccess && result.current.settings.isSuccess).toBe(true)
      })

      vi.setSystemTime(Date.now() + 60_000)
      act(() => {
        window.dispatchEvent(new Event('visibilitychange'))
      })
      await waitFor(() => {
        expect(todayCalls(calls)).toBe(2)
      })
      expect(calls.filter((c) => c.url === '/api/settings')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the athlete state', () => {
  const stateCalls = (calls: Array<{ method: string; url: string }>) =>
    calls.filter((c) => c.method === 'GET' && c.url === '/api/state').length

  test('is read from GET /api/state under keys.state', async () => {
    const { calls } = mockApi(allRoutes({ 'GET /api/state': () => ({ version: 'v1' }) }))
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useAthleteState(), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(stateCalls(calls)).toBe(1)
    expect(queryClient.getQueryData([keys.state])).toEqual({ version: 'v1' })
  })

  test('is asked for again when a screen mounts, because the server answers 304 while nothing changed', async () => {
    const { calls } = mockApi(allRoutes({ 'GET /api/state': () => ({}) }))
    const { wrapper } = setup()
    const first = renderHook(() => useAthleteState(), { wrapper })
    await waitFor(() => {
      expect(first.result.current.isSuccess).toBe(true)
    })
    first.unmount()

    const second = renderHook(() => useAthleteState(), { wrapper })
    await waitFor(() => {
      expect(stateCalls(calls)).toBe(2)
    })
    await waitFor(() => {
      expect(second.result.current.isFetching).toBe(false)
    })
  })

  test('goes stale with the activity data, so a run or a sync is seen at once', async () => {
    const { calls } = mockApi(allRoutes({ 'GET /api/state': () => ({}) }))
    const { wrapper } = setup()
    const { result } = renderHook(
      () => ({
        state: useAthleteState(),
        create: useCreateActivity(),
        remove: useDeleteActivity(),
      }),
      { wrapper },
    )
    await waitFor(() => {
      expect(result.current.state.isSuccess).toBe(true)
    })

    const before = stateCalls(calls)
    await act(() => result.current.create.mutateAsync(activityInput))
    await waitFor(() => {
      expect(stateCalls(calls)).toBe(before + 1)
    })
    await act(() => result.current.remove.mutateAsync('a1'))
    await waitFor(() => {
      expect(stateCalls(calls)).toBe(before + 2)
    })
  })
})

describe('invalidation of engine data', () => {
  function mountEngineReaders() {
    const harness = setup()
    const rendered = renderHook(
      () => ({
        profile: useProfile(),
        zones: useZones(),
        proposals: useZoneProposals(),
        plan: usePlan(),
        revisions: usePlanRevisions(),
        today: useToday(),
        saveProfile: useUpdateProfile(),
        week: useUpdatePlanWeek(),
        accept: useAcceptZoneProposal(),
        decline: useDeclineZoneProposal(),
      }),
      { wrapper: harness.wrapper },
    )
    return rendered
  }

  const engineRoutes = (): MockRoutes =>
    allRoutes({
      'GET /api/profile': () => ({}),
      'PUT /api/profile': () => ({}),
      'GET /api/zones': () => ({}),
      'GET /api/zones/proposals': () => [],
      'POST /api/zones/proposals/z1/accept': () => ({}),
      'POST /api/zones/proposals/z1/decline': () => ({ status: 204, body: undefined }),
      'GET /api/plan/revisions': () => [],
      'GET /api/today': () => ({}),
    })

  async function refetchedBy(
    mutate: (r: ReturnType<typeof mountEngineReaders>['result']['current']) => Promise<unknown>,
  ): Promise<string[]> {
    const { calls } = mockApi(engineRoutes())
    const { result } = mountEngineReaders()
    await waitFor(() => {
      expect(result.current.profile.isSuccess).toBe(true)
      expect(result.current.zones.isSuccess).toBe(true)
      expect(result.current.proposals.isSuccess).toBe(true)
      expect(result.current.plan.isSuccess).toBe(true)
      expect(result.current.revisions.isSuccess).toBe(true)
      expect(result.current.today.isSuccess).toBe(true)
    })
    const before = calls.length
    await act(() => mutate(result.current))
    await waitFor(() => {
      expect(result.current.today.isFetching).toBe(false)
      expect(result.current.revisions.isFetching).toBe(false)
      expect(result.current.zones.isFetching).toBe(false)
    })
    return [
      ...new Set(
        calls
          .slice(before)
          .filter((c) => c.method === 'GET')
          .map((c) => c.url),
      ),
    ].sort()
  }

  test('a profile save refetches zones, the plan, today and the zone proposals', async () => {
    expect(await refetchedBy((r) => r.saveProfile.mutateAsync({} as never))).toEqual([
      '/api/plan',
      '/api/today',
      '/api/zones',
      '/api/zones/proposals',
    ])
  })

  test('a week edit refetches the plan, its revisions and today', async () => {
    expect(
      await refetchedBy((r) =>
        r.week.mutateAsync({ weekStart: '2026-03-02', patch: { runDays: 4 } }),
      ),
    ).toEqual(['/api/plan', '/api/plan/revisions', '/api/today'])
  })

  test('accepting or declining a zone proposal refetches the revisions as well', async () => {
    const expected = [
      '/api/plan',
      '/api/plan/revisions',
      '/api/today',
      '/api/zones',
      '/api/zones/proposals',
    ]
    expect(await refetchedBy((r) => r.accept.mutateAsync('z1'))).toEqual(expected)
    expect(await refetchedBy((r) => r.decline.mutateAsync('z1'))).toEqual(expected)
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
