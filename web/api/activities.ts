import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Activity, ActivityDetail, ActivityType, Feel } from '../../shared/types.ts'
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
  feel?: Feel | null
  pain?: number | null
}

/** Partial update of the three feedback fields; `null` clears one. */
export interface FeedbackPatch {
  rpe?: number | null
  feel?: Feel | null
  pain?: number | null
}

export interface ActivityParams {
  from?: string
  to?: string
  type?: ActivityType
}

/**
 * Activities feed the week rows, the review suggestions and the detail page, and the server links,
 * assesses and re-evaluates plan sessions on every change (so the plan, today's advice and the
 * predictions move too): all go stale together.
 */
export function invalidateActivityData(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    [
      keys.activities,
      keys.activityDetail,
      keys.weeks,
      keys.reviews,
      keys.today,
      keys.plan,
      keys.predictions,
    ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
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

/** One activity with its stream and laps; `id` may be undefined while the route resolves. */
export function useActivityDetail(id: string | undefined) {
  return useQuery({
    queryKey: [keys.activityDetail, id],
    queryFn: () => api<ActivityDetail>('GET', `/activities/${encodeURIComponent(id ?? '')}/detail`),
    enabled: id !== undefined && id !== '',
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

/** RPE, feel and pain for one activity (`PATCH /activities/:id/feedback`). */
export function useSaveFeedback(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: FeedbackPatch) =>
      api<Activity>('PATCH', `/activities/${encodeURIComponent(id)}/feedback`, patch),
    onSuccess: () => invalidateActivityData(queryClient),
  })
}
