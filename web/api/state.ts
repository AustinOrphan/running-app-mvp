import { useQuery } from '@tanstack/react-query'
import type { StateView } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/**
 * The server's cached picture of the athlete (ADR 0009). It is always asked again when a screen
 * mounts: the server answers 304 while nothing has changed, so that costs one small request and
 * the screen never shows numbers from before the last run, sync or edit.
 */
export function useAthleteState() {
  return useQuery({
    queryKey: [keys.state],
    queryFn: () => api<StateView>('GET', '/state'),
    staleTime: 0,
  })
}
