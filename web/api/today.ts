import { useQuery } from '@tanstack/react-query'
import type { TodayView } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/** Today's sessions with readiness advice, the heat note, check-in status and unrated activities. */
export function useToday() {
  return useQuery({
    queryKey: [keys.today],
    queryFn: () => api<TodayView>('GET', '/today'),
  })
}
