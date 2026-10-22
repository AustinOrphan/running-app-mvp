import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EngineInput, SessionKind } from '../../shared/engine/types.ts'
import type { PlanRevision, PlanSession, PlanWeek, PlanWithSessions } from '../../shared/types.ts'
import { api, keys } from './client.ts'

export interface GeneratePlanRequest {
  goalId: string
  baselineRunMin?: number
  startDate?: string
  strengthPreference?: 0 | 1 | 2
  /** Version-2 engine options: recovery cycle, strength sessions, TID model. */
  options?: EngineInput['options']
}

/** Owner edits of one session: move it, swap its kind within the week, or skip it. */
export interface PlanSessionPatch {
  date?: string
  kind?: SessionKind
  skip?: boolean
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

/**
 * The active plan, or null before one is generated. Version-2 plans carry sessions, feasibility,
 * warnings, the checklist and zones; a version-1 plan has empty sessions.
 */
export function usePlan() {
  return useQuery({
    queryKey: [keys.plan],
    queryFn: () => api<PlanWithSessions | null>('GET', '/plan'),
  })
}

/** Every revision of the active plan, newest first: the "What changed" list. */
export function usePlanRevisions() {
  return useQuery({
    queryKey: [keys.planRevisions],
    queryFn: () => api<PlanRevision[]>('GET', '/plan/revisions'),
  })
}

/** Re-plans from the updated state; the past and completed sessions stay. */
export function useReplan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<PlanRevision>('POST', '/plan/replan'),
    onSuccess: () =>
      Promise.all(
        [keys.plan, keys.planRevisions, keys.reviews, keys.today].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  })
}

/** A move that would break spacing or a limit comes back as a 409 with the reason. */
export function useUpdatePlanSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PlanSessionPatch }) =>
      api<PlanSession>('PUT', `/plan/sessions/${encodeURIComponent(id)}`, patch),
    onSuccess: () =>
      Promise.all(
        [keys.plan, keys.planRevisions, keys.today].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  })
}

/** Links, relinks (`activityId`) or unlinks (`null`) the activity that fulfils a session. */
export function useLinkPlanSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, activityId }: { id: string; activityId: string | null }) =>
      api<PlanSession>('POST', `/plan/sessions/${encodeURIComponent(id)}/link`, { activityId }),
    onSuccess: () =>
      Promise.all(
        [keys.plan, keys.today, keys.reviews, keys.activities, keys.activityDetail].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  })
}

/** Plan targets feed the review suggestions, so reviews refresh with the plan. */
export function useGeneratePlan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: GeneratePlanRequest) =>
      api<PlanWithSessions>('POST', '/plan/generate', request),
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
