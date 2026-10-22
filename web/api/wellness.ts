import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WellnessDay, WellnessInput } from '../../shared/types.ts'
import { api, keys, qs } from './client.ts'

/** The fields of one day that the owner may enter by hand; omitted fields stay as they are. */
export type WellnessSaveInput = Partial<Omit<WellnessInput, 'date'>> & { notes?: string | null }

/** Wellness days from `from` to `to` (inclusive), oldest first. */
export function useWellness(params: { from: string; to: string }) {
  return useQuery({
    queryKey: [keys.wellness, params],
    queryFn: () => api<WellnessDay[]>('GET', `/wellness${qs(params)}`),
  })
}

export function useSaveWellness() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ date, input }: { date: string; input: WellnessSaveInput }) =>
      api<WellnessDay>('PUT', `/wellness/${encodeURIComponent(date)}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [keys.wellness] }),
  })
}
