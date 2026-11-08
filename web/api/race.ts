import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RaceCheckpointRow, RaceCheckpointsView, RacePlanView } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/**
 * The race plan of the runner's current goal (rule H14, ADR 0018), or why there is none. The
 * server derives it on every read from the goal, the prediction, the fuel ladder and the cached
 * race climate, so the answer is never stale on the server; the page asks again on every visit
 * (`staleTime: 0`) because a fuel log, a goal edit or a profile save elsewhere changes it and none
 * of those writes know this key. It is one of the reads the service worker keeps (ADR 0012,
 * addendum): with no signal the answer is the phone's copy, marked `servedFromCache` with `savedAt`.
 */
export function useRacePlan(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.race, 'plan'],
    queryFn: () => api<RacePlanView>('GET', '/race/plan'),
    staleTime: 0,
    enabled: options.enabled ?? true,
  })
}

/**
 * The runner's own course points for the goal race, in metres, nearest the start first. Private:
 * the answer is not one of the reads the service worker keeps (ADR 0012; the race plan carries the
 * rows), and the editor asks again each time it opens.
 */
export function useRaceCheckpoints(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [keys.race, 'checkpoints'],
    queryFn: () => api<RaceCheckpointsView>('GET', '/race/checkpoints'),
    staleTime: 0,
    enabled: options.enabled ?? true,
  })
}

/**
 * Replaces the whole table. The plan, the table and Today are read again afterwards: the arrival
 * times follow the rows, and the race-week card reads the same plan.
 */
export function useSaveRaceCheckpoints() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (checkpoints: RaceCheckpointRow[]) =>
      api<RaceCheckpointsView>('PUT', '/race/checkpoints', { checkpoints }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: [keys.race] }),
        queryClient.invalidateQueries({ queryKey: [keys.today] }),
      ]),
  })
}
