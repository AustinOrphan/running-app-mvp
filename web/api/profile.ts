import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AthleteProfile } from '../../shared/types.ts'
import { api, keys } from './client.ts'

export function useProfile() {
  return useQuery({
    queryKey: [keys.profile],
    queryFn: () => api<AthleteProfile>('GET', '/profile'),
  })
}

/** Replaces the profile; the saved profile goes straight into the cache. */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (profile: AthleteProfile) => api<AthleteProfile>('PUT', '/profile', profile),
    onSuccess: (saved) => {
      queryClient.setQueryData([keys.profile], saved)
    },
  })
}
