import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import type { EngineInput } from '../../shared/engine/types.ts'
import type {
  AdjustResult,
  ArchivedPlanView,
  PlanAction,
  PlanAdjustment,
  PlanGuardView,
  PlanPreview,
  PlanRevisionView,
  PlanSession,
  PlanWeek,
  PlanWithSessions,
  RestorePlanResult,
  UndoResult,
} from '../../shared/types.ts'
import { ApiError, api, fieldErrors, invalidateNewPlan, keys } from './client.ts'

export interface GeneratePlanRequest {
  goalId: string
  baselineRunMin?: number
  startDate?: string
  strengthPreference?: 0 | 1 | 2
  /** Version-2 engine options: recovery cycle, strength sessions, TID model. */
  options?: EngineInput['options']
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
export function usePlan(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.plan],
    queryFn: () => api<PlanWithSessions | null>('GET', '/plan'),
    enabled: options.enabled ?? true,
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

/** The cache key of the preview of one action. It sits under the plan's key, beside the dry runs. */
export function planPreviewKey(action: PlanAction | null) {
  return [keys.plan, 'preview', action] as const
}

/**
 * Whether a query holds a preview or a dry run. A write that has just applied what such a query
 * showed leaves it alone: asked again, it would read "nothing to change".
 */
export function isPreviewQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === keys.plan && (queryKey[1] === 'preview' || queryKey[1] === 'adjust')
}

/**
 * What an action would do, from the code that commits it (`POST /api/plan/preview`): the diff, a
 * summary, the warnings, why it cannot be applied, and the hash the commit sends back as
 * `expectHash`. Writes nothing. Nothing is asked for without an action, and a result is not kept
 * once the sheet that asked for it is gone.
 */
export function usePlanPreview(action: PlanAction | null) {
  return useQuery({
    queryKey: planPreviewKey(action),
    queryFn: () => api<PlanPreview>('POST', '/plan/preview', action),
    enabled: action !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The newer preview a 409 `stale-preview` carries, or null for any other answer. */
export function stalePreviewOf(details: unknown): PlanPreview | null {
  if (!isRecord(details) || details['code'] !== 'stale-preview') return null
  const preview = details['preview']
  return isRecord(preview) && typeof preview['hash'] === 'string'
    ? (preview as unknown as PlanPreview)
    : null
}

/**
 * What a failed request means for the preview the runner was reading: the plan moved (`stale`, with
 * the new preview), a guard or the plan checks refuse the action (`refused`, `blocked`), the body was
 * not accepted (`invalid`, by field), the server was not reached (`offline`), or something else.
 */
export type CommitFailure =
  | { kind: 'stale'; preview: PlanPreview }
  | { kind: 'refused'; message: string; guards: PlanGuardView[] }
  | { kind: 'blocked'; message: string }
  | { kind: 'invalid'; message: string; fields: Record<string, string> }
  | { kind: 'offline' }
  | { kind: 'error'; message: string }

export function commitFailure(error: unknown): CommitFailure {
  if (!(error instanceof ApiError)) return { kind: 'error', message: 'Something went wrong.' }
  if (error.status === 0) return { kind: 'offline' }
  if (error.status === 409) {
    const preview = stalePreviewOf(error.details)
    if (preview !== null) return { kind: 'stale', preview }
    const guards = isRecord(error.details) ? error.details['guards'] : undefined
    if (Array.isArray(guards)) {
      return { kind: 'refused', message: error.message, guards: guards as PlanGuardView[] }
    }
    return { kind: 'blocked', message: error.message }
  }
  if (error.status === 422) return { kind: 'blocked', message: error.message }
  if (error.code === 'validation') {
    return { kind: 'invalid', message: error.message, fields: fieldErrors(error) }
  }
  return { kind: 'error', message: error.message }
}

/**
 * Reads the given queries again after a write to the plan. `skip` leaves out the queries it names
 * (the dry run of the edit that was just applied).
 */
function invalidatePlanReaders(
  queryClient: QueryClient,
  keyList: readonly string[],
  skip?: (queryKey: readonly unknown[]) => boolean,
): Promise<unknown> {
  return Promise.all(
    keyList.map((key) =>
      queryClient.invalidateQueries({
        queryKey: [key],
        predicate: skip === undefined ? undefined : (query) => !skip(query.queryKey),
      }),
    ),
  )
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
    // Undoing a window withdraws it, so the banner reads the windows again.
    onSuccess: () =>
      invalidatePlanReaders(queryClient, [
        keys.plan,
        keys.planRevisions,
        keys.disruptions,
        keys.brief,
        keys.state,
        keys.today,
      ]),
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

/**
 * Re-plans from the updated state; the past and completed sessions stay. `expectHash` is the hash of
 * the preview the runner read: a plan that has moved since answers 409 with a newer preview.
 */
export function useReplan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (expectHash?: string) =>
      api<PlanRevisionView>(
        'POST',
        '/plan/replan',
        expectHash === undefined ? undefined : { expectHash },
      ),
    onSuccess: () =>
      invalidatePlanReaders(
        queryClient,
        [keys.plan, keys.planRevisions, keys.reviews, keys.brief, keys.state, keys.today],
        isPreviewQuery,
      ),
  })
}

/** What a dry run of an owner edit says: the guards, the diff and the hash the commit sends back. */
export type AdjustPreview = Pick<AdjustResult, 'allowed' | 'guards' | 'diff' | 'hash'>

/** The newer preview of a stale commit, in the shape of a dry run. */
export function adjustPreviewOf(preview: PlanPreview): AdjustPreview {
  return {
    allowed: !preview.blocked,
    guards: preview.guards,
    diff: preview.diff,
    hash: preview.hash,
  }
}

/** The cache key of one dry run. It sits under the plan's key, beside the previews. */
export function adjustPreviewKey(sessionId: string, adjustment: PlanAdjustment | null) {
  return [keys.plan, 'adjust', sessionId, adjustment] as const
}

/**
 * The live dry run of an owner edit of one session (`POST /api/plan/sessions/:id/adjust` with
 * `dryRun`): the guards that would refuse or qualify it, and the diff it would write. Writes
 * nothing. Nothing is asked for without an adjustment, and a result is not kept once the control
 * that asked for it is gone.
 */
export function useAdjustPreview(sessionId: string, adjustment: PlanAdjustment | null) {
  return useQuery({
    queryKey: adjustPreviewKey(sessionId, adjustment),
    queryFn: async (): Promise<AdjustPreview> => {
      const { allowed, guards, diff, hash } = await api<AdjustResult>(
        'POST',
        `/plan/sessions/${encodeURIComponent(sessionId)}/adjust`,
        { adjustment, dryRun: true },
      )
      return { allowed, guards, diff, hash }
    },
    enabled: adjustment !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

/**
 * Applies an owner edit of one session that a dry run was made for. A 409 carries `details.guards`
 * when a guard now refuses it, or a newer preview (`stale-preview`) when the plan moved.
 */
export function useAdjustSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      adjustment,
      expectHash,
    }: {
      id: string
      adjustment: PlanAdjustment
      expectHash: string
    }) =>
      api<AdjustResult>('POST', `/plan/sessions/${encodeURIComponent(id)}/adjust`, {
        adjustment,
        expectHash,
      }),
    onSuccess: () =>
      invalidatePlanReaders(
        queryClient,
        [keys.plan, keys.planRevisions, keys.reviews, keys.brief, keys.state, keys.today],
        isPreviewQuery,
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
