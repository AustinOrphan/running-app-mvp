import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import type { EngineInput, SessionKind } from '../../shared/engine/types.ts'
import type {
  ArchivedPlanView,
  PlanPreview,
  PlanRevisionView,
  PlanSession,
  PlanWeek,
  PlanWithSessions,
  RestorePlanResult,
  SessionWorkoutView,
  UndoResult,
} from '../../shared/types.ts'
import { api, invalidateNewPlan, keys } from './client.ts'

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

/**
 * Every revision of the active plan, newest first: the "What changed" list. A surface that shows it
 * only on request (Today's change sheet) asks for it once it is open.
 */
export function usePlanRevisions(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.planRevisions],
    queryFn: () => api<PlanRevisionView[]>('GET', '/plan/revisions'),
    enabled: options.enabled ?? true,
  })
}

/**
 * What undoing a revision would do, from the code that commits it: the diff it restores, the guards
 * and the reasons it would be refused. Writes nothing; the hash goes back with the commit.
 */
export function usePreviewUndo() {
  return useMutation({
    mutationFn: (revisionId: string) =>
      api<PlanPreview>('POST', '/plan/preview', { type: 'undo', revisionId }),
  })
}

/**
 * Undoes a revision the preview was made for. A 409 carries `reasons` or a newer preview
 * (`stale-preview`); a 422 carries the checklist the restored plan fails. A success changes the plan
 * and the revision list, and the brief, the athlete state and Today read both.
 */
export function useUndoRevision() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, expectHash }: { id: string; expectHash: string }) =>
      api<UndoResult>('POST', `/plan/revisions/${encodeURIComponent(id)}/undo`, { expectHash }),
    onSuccess: () =>
      Promise.all(
        [keys.plan, keys.planRevisions, keys.brief, keys.state, keys.today].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  })
}

/**
 * Stamps revisions as seen (the one marker Today, the Plan page and the brief share). Returns a
 * function that sends each id once for the life of the component and refreshes what shows the
 * marker; the answer is 204 and idempotent, so a lost request is repaired by the next open.
 */
export function useMarkRevisionsSeen(): (ids: readonly string[]) => void {
  const queryClient = useQueryClient()
  const sent = useRef(new Set<string>())
  const mutation = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(
        ids.map((id) => api<undefined>('POST', `/plan/revisions/${encodeURIComponent(id)}/seen`)),
      ),
    onSuccess: () =>
      Promise.all(
        [keys.planRevisions, keys.brief, keys.today].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
    // Nothing is shown for a failure: the marker stays, and the next open sends the ids again.
    onError: (_error, ids) => {
      for (const id of ids) sent.current.delete(id)
    },
  })
  const { mutate } = mutation
  return useCallback(
    (ids: readonly string[]) => {
      const fresh = ids.filter((id) => !sent.current.has(id))
      if (fresh.length === 0) return
      for (const id of fresh) sent.current.add(id)
      mutate(fresh)
    },
    [mutate],
  )
}

/** The plans a newer one replaced (up to five), with whether each can be restored. */
export function useArchivedPlans() {
  return useQuery({
    queryKey: [keys.planArchived],
    queryFn: () => api<ArchivedPlanView[]>('GET', '/plan/archived'),
  })
}

/** Brings an archived plan back as the active plan, and its goal as the active goal. */
export function useRestorePlan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<RestorePlanResult>('POST', `/plan/archived/${encodeURIComponent(id)}/restore`),
    onSuccess: () => invalidateNewPlan(queryClient),
  })
}

/** Re-plans from the updated state; the past and completed sessions stay. */
export function useReplan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<PlanRevisionView>('POST', '/plan/replan'),
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

/**
 * What the session sheet shows of a session's workout: the targets as the resolver gives them
 * today (current zones, the day's heat), whether readiness eased the day for the watch, and
 * whether the workout file can be made. The key sits under the plan's, so every change to the plan
 * reads it again.
 */
export function useSessionWorkout(sessionId: string) {
  return useQuery({
    queryKey: [keys.plan, 'workout', sessionId],
    queryFn: () =>
      api<SessionWorkoutView>('GET', `/plan/sessions/${encodeURIComponent(sessionId)}/workout`),
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
      // The plan it replaces is archived, so the list of archived plans changes too.
      void queryClient.invalidateQueries({ queryKey: [keys.planArchived] })
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
        [keys.plan, keys.planRevisions, keys.reviews, keys.today].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  })
}
