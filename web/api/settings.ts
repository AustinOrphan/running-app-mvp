import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Units, UserSettings, WeightUnit } from '../../shared/types.ts'
import { api, keys } from './client.ts'

export interface SettingsPatch {
  units?: Units
  /** The unit strength loads are shown in (strength design 5.2); saved by the same route as `units`. */
  weightUnit?: WeightUnit
  displayName?: string | null
}

export function useSettings() {
  return useQuery({
    queryKey: [keys.settings],
    queryFn: () => api<UserSettings>('GET', '/settings'),
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api<UserSettings>('PUT', '/settings', patch),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: [keys.settings] }),
        queryClient.invalidateQueries({ queryKey: [keys.me] }),
      ]),
  })
}
