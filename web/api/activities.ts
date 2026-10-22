import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Activity, ActivityType } from '../../shared/types.ts'
import { api, keys, qs } from './client.ts'

export interface ActivityInput {
  date: string
  startTime?: string | null
  type: ActivityType
  durationSec: number
  distanceM?: number | null
  rpe?: number | null
  avgHr?: number | null
  maxHr?: number | null
  elevationGainM?: number | null
  notes?: string | null
}

export interface ActivityParams {
  from?: string
  to?: string
  type?: ActivityType
}

/** Activities feed the week rows and the review suggestions, so all three go stale together. */
export function invalidateActivityData(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    [keys.activities, keys.weeks, keys.reviews].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  )
}

export function useActivities(params: ActivityParams = {}) {
  return useQuery({
    queryKey: [keys.activities, params],
    queryFn: () =>
      api<Activity[]>(
        'GET',
        `/activities${qs({ from: params.from, to: params.to, type: params.type })}`,
      ),
  })
}

export function useCreateActivity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ActivityInput) => api<Activity>('POST', '/activities', input),
    onSuccess: () => invalidateActivityData(queryClient),
  })
}

export function useUpdateActivity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ActivityInput }) =>
      api<Activity>('PUT', `/activities/${encodeURIComponent(id)}`, input),
    onSuccess: () => invalidateActivityData(queryClient),
  })
}

export function useDeleteActivity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>('DELETE', `/activities/${encodeURIComponent(id)}`),
    onSuccess: () => invalidateActivityData(queryClient),
  })
}

export function useResolveDuplicate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'confirmed' | 'dismissed' }) =>
      api<Activity>('POST', `/activities/${encodeURIComponent(id)}/duplicate`, { status }),
    onSuccess: () => invalidateActivityData(queryClient),
  })
}
