import { useQuery } from '@tanstack/react-query'
import type { ResearchParams } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/**
 * The parameter registry for the why drawer. The papers and topics themselves are bundled into
 * the web build (`import.meta.glob` over `research/papers/*.json` and `research/topics/*.md`).
 */
export function useResearchParams() {
  return useQuery({
    queryKey: [keys.researchParams],
    queryFn: () => api<ResearchParams>('GET', '/research/params'),
    // The registry changes only with a release.
    staleTime: Infinity,
  })
}
