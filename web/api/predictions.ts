import { useQuery } from '@tanstack/react-query'
import type { PredictionView } from '../../shared/types.ts'
import { api, keys, qs } from './client.ts'

/** The latest prediction for a goal, with its range, method and the log of earlier ones. */
export function usePredictions(goalId: string | undefined) {
  return useQuery({
    queryKey: [keys.predictions, goalId],
    queryFn: () => api<PredictionView>('GET', `/predictions${qs({ goalId })}`),
    enabled: goalId !== undefined,
  })
}
