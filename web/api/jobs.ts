import { useQuery } from '@tanstack/react-query'
import type { JobsView } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/**
 * The latest run of each scheduled job and whether this week's plan update has run. Today's health
 * note reads it; the server writes the runs, so there is nothing to invalidate from the page.
 */
export function useJobs() {
  return useQuery({
    queryKey: [keys.jobs],
    queryFn: () => api<JobsView>('GET', '/jobs'),
  })
}
