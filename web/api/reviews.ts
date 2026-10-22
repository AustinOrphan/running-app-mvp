import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DataStatus, Symptoms, WeeklyReview } from '../../shared/types.ts'
import { api, keys, qs } from './client.ts'

export interface ReviewPatch {
  dataStatus?: DataStatus
  fatigue?: number | null
  symptoms?: Symptoms | null
  recoveryConstrained?: boolean
  finalDecision?: string | null
  finalNextMin?: number | null
  notes?: string | null
}

/** One review per week from `from` to `to` (Mondays, inclusive); unsaved weeks are synthetic. */
export function useReviews(params: { from: string; to: string }) {
  return useQuery({
    queryKey: [keys.reviews, params],
    queryFn: () => api<WeeklyReview[]>('GET', `/reviews${qs(params)}`),
  })
}

/** A final decision can write next week's target, so the plan refreshes with the reviews. */
export function useSaveReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ weekStart, patch }: { weekStart: string; patch: ReviewPatch }) =>
      api<WeeklyReview>('PUT', `/reviews/${encodeURIComponent(weekStart)}`, patch),
    onSuccess: () =>
      Promise.all(
        [keys.reviews, keys.plan].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      ),
  })
}
