import { useQuery } from '@tanstack/react-query'
import type { TrendsLoadView } from '../../shared/domain/trendsLoad.ts'
import type { TrendsDurabilityView } from '../../shared/domain/durabilityByHour.ts'
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
 * The runs of the last 104 weeks with their elevation gain and their seconds in each heart-rate
 * zone, for the climbing and intensity panels. The server computes them once per data version, so
 * a run added or removed reads again through `ACTIVITY_DATA_KEYS`; the key sits under `keys.trends`
 * for the same reason.
 */
export function useTrendsLoad() {
  return useQuery({
    queryKey: [keys.trends, 'load'],
    queryFn: () => api<TrendsLoadView>('GET', '/trends/load'),
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

/**
 * The runs of 180 minutes or more with their pace and heart rate by the hour, for the long-run
 * panel (rule T1, DR1). The server computes them once per data version, so a run or stream added or
 * removed reads again through `ACTIVITY_DATA_KEYS`, and a fuel log saved, queued and sent, or
 * skipped reads again through `keys.trends` (`invalidateAfterLog`, the `fuel log` entry of
 * `OUTBOX_ROUTES`); the key sits under `keys.trends` for that reason.
 */
export function useTrendsDurability() {
  return useQuery({
    queryKey: [keys.trends, 'durability'],
    queryFn: () => api<TrendsDurabilityView>('GET', '/trends/durability'),
  })
}
