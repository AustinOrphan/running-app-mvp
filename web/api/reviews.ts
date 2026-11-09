import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DataStatus, ReviewView, SavedReview, Symptoms } from '../../shared/types.ts'
import { api, invalidatePlanReaders, keys, qs } from './client.ts'

export interface ReviewPatch {
  dataStatus?: DataStatus
  fatigue?: number | null
  symptoms?: Symptoms | null
  recoveryConstrained?: boolean
  finalDecision?: string | null
  finalNextMin?: number | null
  notes?: string | null
}

/**
 * One review per week from `from` to `to` (Mondays, inclusive); unsaved weeks are synthetic. A
 * version-2 plan adds the signals behind each weekly decision.
 */
export function useReviews(params: { from: string; to: string }) {
  return useQuery({
    queryKey: [keys.reviews, params],
    queryFn: () => api<ReviewView[]>('GET', `/reviews${qs(params)}`),
  })
}

/**
 * Not now, to the offer to raise the plan to match recent weeks (rule E7): the server remembers it
 * for the finished week, so the offer stays away on every device. Nothing in the plan changes.
 */
export function useDeclineRaise() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (weekStart: string) =>
      api<undefined>('PUT', `/reviews/${encodeURIComponent(weekStart)}/raise`, {
        answer: 'declined',
      }),
    onSuccess: () => invalidatePlanReaders(queryClient),
  })
}

/**
 * A final decision can write next week's target, and a decided review of a version-2 plan
 * re-plans, so the readers of the plan (`invalidatePlanReaders`: the plan, its revisions, the
 * reviews, the brief, Today) refresh with the reviews.
 */
export function useSaveReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ weekStart, patch }: { weekStart: string; patch: ReviewPatch }) =>
      api<SavedReview>('PUT', `/reviews/${encodeURIComponent(weekStart)}`, patch),
    onSuccess: () => invalidatePlanReaders(queryClient),
  })
}
