import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AthleteProfile } from '../../shared/types.ts'
import { api, keys } from './client.ts'

export function useProfile() {
  return useQuery({
    queryKey: [keys.profile],
    queryFn: () => api<AthleteProfile>('GET', '/profile'),
  })
}

/**
 * Saves the fields given and keeps the others as stored (the route merges, so a field that is left
 * out is not written back): the Profile page sends all of them, a prompt that changes one sends that
 * one. The saved profile goes straight into the cache. Trends read again too: the intensity bands
 * are cut at the zone limits, which come from the profile. Zones, the plan, today's advice and the zone
 * proposals are all computed from the profile, so they refetch.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (profile: Partial<AthleteProfile>) =>
      api<AthleteProfile>('PUT', '/profile', profile),
    onSuccess: (saved) => {
      const before = queryClient.getQueryData<AthleteProfile>([keys.profile])
      queryClient.setQueryData([keys.profile], saved)
      // Every cached answer carries a day, and the zone decides which day it is (D10, ADR 0022):
      // a save that moves the zone reads everything again, the session user included.
      if (before !== undefined && before.timezone !== saved.timezone) {
        return queryClient.invalidateQueries()
      }
      return Promise.all(
        [keys.zones, keys.plan, keys.today, keys.zoneProposals, keys.paces, keys.trends].map(
          (key) => queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
    },
  })
}
