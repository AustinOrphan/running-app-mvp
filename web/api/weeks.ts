import { useQuery } from '@tanstack/react-query'
import type { WeekRow } from '../../shared/types.ts'
import { api, keys, qs } from './client.ts'

/** Weekly totals from `from` to `to` (at most 260 weeks), oldest first. */
export function useWeeks(params: { from: string; to: string }) {
  return useQuery({
    queryKey: [keys.weeks, params],
    queryFn: () => api<WeekRow[]>('GET', `/weeks${qs(params)}`),
  })
}
