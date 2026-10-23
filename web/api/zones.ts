import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ZoneSet } from '../../shared/engine/types.ts'
import type { ZoneProposalView } from '../../shared/types.ts'
import { api, invalidatePlanReaders, keys } from './client.ts'

/** The current zone set with the source of each boundary. */
export function useZones() {
  return useQuery({
    queryKey: [keys.zones],
    queryFn: () => api<ZoneSet>('GET', '/zones'),
  })
}

/** Proposed zone updates; zones never change until the owner accepts one. */
export function useZoneProposals() {
  return useQuery({
    queryKey: [keys.zoneProposals],
    queryFn: () => api<ZoneProposalView[]>('GET', '/zones/proposals'),
  })
}

function useDecideProposal(decision: 'accept' | 'decline') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<ZoneSet | undefined>('POST', `/zones/proposals/${encodeURIComponent(id)}/${decision}`),
    // Accepting changes the zone set, and future sessions follow the zone set. Both answers are
    // written to the revision log, which the plan page lists as "What changed" and the weekly brief
    // lists as "Since this brief", so the readers of the plan are read again as well.
    onSuccess: () =>
      invalidatePlanReaders(queryClient, undefined, [keys.zones, keys.zoneProposals]),
  })
}

/** Resolves to the new zone set. */
export function useAcceptZoneProposal() {
  return useDecideProposal('accept')
}

export function useDeclineZoneProposal() {
  return useDecideProposal('decline')
}
