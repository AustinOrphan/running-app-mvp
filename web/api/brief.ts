import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import type { BriefListItem, BriefView } from '../../shared/types.ts'
import { api, keys, qs } from './client.ts'

/**
 * The Monday brief of one week (`GET /api/brief`), or null when there is none: no active plan
 * (this week), a week before the first brief, or a week not yet begun. Without a week it is the
 * server's current one, which the server builds when it finds none. The key sits under `brief`, so
 * every write to the plan that invalidates the brief reads it again.
 */
export function useBrief(weekStart?: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.brief, 'view', weekStart ?? 'current'],
    queryFn: async () =>
      (await api<{ brief: BriefView | null }>('GET', `/brief${qs({ weekStart })}`)).brief,
    enabled: options.enabled ?? true,
  })
}

/**
 * The newest briefs, slim (`GET /api/briefs`), for Today's brief line. It runs only while `enabled`:
 * Today asks for it once the line is near the viewport, so the first screen keeps to its two
 * requests.
 */
export function useBriefs(limit: number, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.brief, 'list', limit],
    queryFn: async () =>
      (await api<{ briefs: BriefListItem[] }>('GET', `/briefs${qs({ limit })}`)).briefs,
    enabled: options.enabled ?? true,
  })
}

/**
 * Stamps the revisions of a brief as seen (`POST /api/briefs/:weekStart/seen`), the one marker the
 * brief page, Today's line and the Plan page share. Returns a function that sends each week once
 * for the life of the component and refreshes what shows the marker; the answer is 204 and
 * idempotent, so a lost request is repaired by the next open.
 */
export function useMarkBriefSeen(): (weekStart: string) => void {
  const queryClient = useQueryClient()
  const sent = useRef(new Set<string>())
  const mutation = useMutation({
    mutationFn: (weekStart: string) =>
      api<undefined>('POST', `/briefs/${encodeURIComponent(weekStart)}/seen`),
    onSuccess: () =>
      Promise.all(
        [keys.brief, keys.planRevisions, keys.today].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
    // Nothing is shown for a failure: the marker stays, and the next open sends the week again.
    onError: (_error, weekStart) => {
      sent.current.delete(weekStart)
    },
  })
  const { mutate } = mutation
  return useCallback(
    (weekStart: string) => {
      if (sent.current.has(weekStart)) return
      sent.current.add(weekStart)
      mutate(weekStart)
    },
    [mutate],
  )
}
