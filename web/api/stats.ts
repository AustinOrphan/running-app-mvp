import { useQuery } from '@tanstack/react-query'
import type { StatsView } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/**
 * Totals, fastest efforts and longest runs over the whole history. The server computes them once
 * per data version, so the page makes no request for the activities themselves.
 */
export function useStats() {
  return useQuery({
    queryKey: [keys.stats],
    queryFn: () => api<StatsView>('GET', '/stats'),
  })
}
