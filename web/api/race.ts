import { useQuery } from '@tanstack/react-query'
import type { RacePlanView } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/**
 * The race plan of the runner's current goal (rule H14, ADR 0018), or why there is none. The
 * server derives it on every read from the goal, the prediction, the fuel ladder and the cached
 * race climate, so the answer is never stale on the server; the page asks again on every visit
 * (`staleTime: 0`) because a fuel log, a goal edit or a profile save elsewhere changes it and none
 * of those writes know this key. It is not one of the reads the service worker keeps (ADR 0012):
 * offline the page says it needs a connection, and Today's race card still shows from the cached
 * Today payload.
 */
export function useRacePlan(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.race, 'plan'],
    queryFn: () => api<RacePlanView>('GET', '/race/plan'),
    staleTime: 0,
    enabled: options.enabled ?? true,
  })
}
