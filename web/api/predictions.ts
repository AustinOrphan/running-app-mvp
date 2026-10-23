import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RaceOutcome } from '../../shared/engine/backtest.ts'
import type { PredictionView, RaceResultView, TrackRecordView } from '../../shared/types.ts'
import { invalidateActivityData } from './activities.ts'
import { api, keys, qs } from './client.ts'

/** The latest prediction for a goal, with its range, method and the log of earlier ones. */
export function usePredictions(goalId: string | undefined) {
  return useQuery({
    queryKey: [keys.predictions, goalId],
    queryFn: () => api<PredictionView>('GET', `/predictions${qs({ goalId })}`),
    enabled: goalId !== undefined,
  })
}

/**
 * Every goal race with a recorded result, its weekly predictions scored against it, and the summary
 * across races (`GET /api/predictions/record`). The key sits under `keys.predictions`, so every
 * invalidation of the predictions reads the record again.
 */
export function useTrackRecord() {
  return useQuery({
    queryKey: [keys.predictions, 'record'],
    queryFn: () => api<TrackRecordView>('GET', '/predictions/record'),
  })
}

/** The whole result of a race, sent in full each time (`PUT /api/goals/:id/result`). */
export interface RaceResultInput {
  outcome: RaceOutcome
  /** Official finish time in seconds; null for a did-not-finish. */
  timeSec: number | null
  /** Race day, `YYYY-MM-DD`. */
  date: string
  /** Metres raced; null lets the server use the linked activity's, then the goal's. */
  distanceM: number | null
  gainM: number | null
  activityId: string | null
  note: string | null
}

/**
 * Records or replaces the result of a goal. Linking an activity retypes it to a race, which moves
 * the anchors, zones and watch targets the plan reads, so the activity data goes stale too.
 */
export function useSaveResult() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ goalId, input }: { goalId: string; input: RaceResultInput }) =>
      api<RaceResultView>('PUT', `/goals/${encodeURIComponent(goalId)}/result`, input),
    onSuccess: () => invalidateActivityData(queryClient),
  })
}

/** Removes the result of a goal; the weekly predictions stay logged and are no longer compared. */
export function useRemoveResult() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (goalId: string) =>
      api<void>('DELETE', `/goals/${encodeURIComponent(goalId)}/result`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [keys.predictions] }),
  })
}
