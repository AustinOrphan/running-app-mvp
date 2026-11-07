import { useQuery } from '@tanstack/react-query'
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
