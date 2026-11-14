import { useQuery } from '@tanstack/react-query'
import type { PlanInputsView } from '../../shared/domain/planInputs.ts'
import { api, keys } from './client.ts'

/**
 * The counts of the data the plan reads for the runner (rule T2): derived on the server from the
 * same snapshot the engine reads, stored nowhere. A write to activity data invalidates the key
 * (`ACTIVITY_DATA_KEYS`); the other writes that change it (wellness, the profile) are caught by
 * `staleTime: 0`, which reads it again whenever the page opens. It is not one of the reads the
 * service worker keeps (ADR 0012), so offline the page says it needs a connection.
 */
export function usePlanInputs(enabled = true) {
  return useQuery({
    enabled,
    queryKey: [keys.planInputs],
    queryFn: () => api<PlanInputsView>('GET', '/plan-inputs'),
    staleTime: 0,
  })
}
