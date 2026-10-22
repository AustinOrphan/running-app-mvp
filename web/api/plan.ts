import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PlanWeek, PlanWithWeeks } from '../../shared/types.ts'
import { api, keys } from './client.ts'

export interface GeneratePlanRequest {
  goalId: string
  baselineRunMin?: number
  startDate?: string
  strengthPreference?: 0 | 1 | 2
}

export interface PlanWeekPatch {
  targetRunMin?: number
  longRunMin?: number
  day2Min?: number | null
  runDays?: number
  strengthSessions?: number
  focus?: string
  overrideNote?: string | null
}

/** The active plan, or null before one is generated. */
export function usePlan() {
  return useQuery({
    queryKey: [keys.plan],
    queryFn: () => api<PlanWithWeeks | null>('GET', '/plan'),
  })
}

/** Plan targets feed the review suggestions, so reviews refresh with the plan. */
export function useGeneratePlan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: GeneratePlanRequest) =>
      api<PlanWithWeeks>('POST', '/plan/generate', request),
    onSuccess: () => {
      // Generating makes the plan's goal the active goal, so goals refresh too. That refetch is
      // not awaited: once the plan arrives the page swaps the form out, and the caller's success
      // callback (the toast) only runs if this promise settles before that unmount.
      void queryClient.invalidateQueries({ queryKey: [keys.goals] })
      return Promise.all(
        [keys.plan, keys.reviews].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      )
    },
  })
}

export function useUpdatePlanWeek() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ weekStart, patch }: { weekStart: string; patch: PlanWeekPatch }) =>
      api<PlanWeek>('PUT', `/plan/weeks/${encodeURIComponent(weekStart)}`, patch),
    onSuccess: () =>
      Promise.all(
        [keys.plan, keys.reviews].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      ),
  })
}
