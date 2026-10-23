import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  DisruptionChange,
  DisruptionInput,
  DisruptionResult,
  DisruptionView,
  PlanAction,
  PlanPreview,
} from '../../shared/types.ts'
import { api, keys, qs } from './client.ts'
import { isPreviewQuery } from './plan.ts'

/** The actions on a rest window that can be previewed before they are committed. */
export type DisruptionPreviewAction = Extract<
  PlanAction,
  { type: 'disruption-create' | 'disruption-update' | 'disruption-remove' }
>

/**
 * The runner's windows: those not over on `date` (today when omitted), or every window ever
 * reported with `includeAll`. Each carries the phase of the date and what the engine says about it.
 */
export function useDisruptions(options: { includeAll?: boolean; date?: string } = {}) {
  return useQuery({
    queryKey: [keys.disruptions, options.includeAll === true, options.date ?? null],
    queryFn: () =>
      api<DisruptionView[]>(
        'GET',
        `/plan/disruptions${qs({ include: options.includeAll ? 'all' : undefined, date: options.date })}`,
      ),
  })
}

/**
 * What an action on a window would do, from the code that commits it: the diff, a summary, any
 * warning and `hash`, which the commit sends back as `expectHash`. Writes nothing.
 */
export function usePreviewDisruption() {
  return useMutation({
    mutationFn: (action: DisruptionPreviewAction) =>
      api<PlanPreview>('POST', '/plan/preview', action),
  })
}

/**
 * Everything a window changes: the windows, the plan and its sessions, the revision list, the
 * reviews, Today, the brief and the state.
 */
function invalidateAfterWindow(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    [
      keys.disruptions,
      keys.plan,
      keys.planRevisions,
      keys.reviews,
      keys.today,
      keys.brief,
      keys.state,
    ].map((key) =>
      // The preview of the action just applied is not asked again: it would read "nothing to change".
      queryClient.invalidateQueries({
        queryKey: [key],
        predicate: (query) => !isPreviewQuery(query.queryKey),
      }),
    ),
  )
}

/** Opens a window. A 409 `stale-preview` carries the new preview in `details.preview`. */
export function useCreateDisruption() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: DisruptionInput & { expectHash?: string }) =>
      api<DisruptionResult>('POST', '/plan/disruptions', request),
    onSuccess: () => invalidateAfterWindow(queryClient),
  })
}

/** Extends or shortens a window ("Extend", "I am better"), or changes the cap of a limited one. */
export function useUpdateDisruption() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...change }: DisruptionChange & { id: string; expectHash?: string }) =>
      api<DisruptionResult>('PATCH', `/plan/disruptions/${encodeURIComponent(id)}`, change),
    onSuccess: () => invalidateAfterWindow(queryClient),
  })
}

/** Removes a window as a revision of its own, which can be undone. */
export function useRemoveDisruption() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, expectHash }: { id: string; expectHash?: string }) =>
      api<DisruptionResult>(
        'DELETE',
        `/plan/disruptions/${encodeURIComponent(id)}${qs({ expectHash })}`,
      ),
    onSuccess: () => invalidateAfterWindow(queryClient),
  })
}
