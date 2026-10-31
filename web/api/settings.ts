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

/**
 * Saves a change to the runner's settings. The settings and the session are read again; and when
 * the patch carries the weight unit, so are the strength readers and Today: the server builds every
 * prescribed load on the grid of the runner's unit (half a pound, a quarter of a kilogram), so a
 * workout read before the change is made of loads the other unit's grid would not give, and a
 * stepper or a suggestion in the logging sheet would start from them.
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api<UserSettings>('PUT', '/settings', patch),
    onSuccess: (_saved, patch) =>
      Promise.all(
        [
          keys.settings,
          keys.me,
          ...(patch.weightUnit === undefined ? [] : [keys.strength, keys.today]),
        ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      ),
  })
}
