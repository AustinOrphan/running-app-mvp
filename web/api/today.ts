import { useQuery } from '@tanstack/react-query'
import type { TodayView } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/**
 * Today as one coach payload: the session of the day with its targets, the readiness read, the
 * week strip, the race countdown, the change line, the health counts and the unrated runs. The
 * server tags the answer with an ETag that follows the data version, so asking again is cheap
 * while nothing has changed. A stale payload is read again when the window regains focus: a phone
 * that was locked overnight shows the new day's session, not yesterday's. A surface that needs
 * only the server's date, and only once a control is open, passes `enabled: false` until then.
 */
export function useToday(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.today],
    queryFn: () => api<TodayView>('GET', '/today'),
    refetchOnWindowFocus: true,
    enabled: options.enabled ?? true,
  })
}
