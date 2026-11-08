import { useQuery } from '@tanstack/react-query'
import type { TrendsRunsView } from '../../shared/domain/trendsRuns.ts'
import type { TrendsView } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/**
 * The weekly recovery readings of the last 24 months with the runner's recent range. The server
 * computes them once per data version. Running weeks come from `useWeeks`.
 */
export function useTrends() {
  return useQuery({
    queryKey: [keys.trends],
    queryFn: () => api<TrendsView>('GET', '/trends'),
  })
}

/**
 * The flat long runs with a drift reading and the heart-rate line of eight-week windows, for the
 * two run panels. The server computes them once per data version, so a run added or removed
 * reads again through `ACTIVITY_DATA_KEYS`; the key sits under `keys.trends` for the same reason.
 */
export function useTrendsRuns() {
  return useQuery({
    queryKey: [keys.trends, 'runs'],
    queryFn: () => api<TrendsRunsView>('GET', '/trends/runs'),
  })
}
