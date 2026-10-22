import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Screening } from '../../shared/types.ts'
import { api, keys } from './client.ts'

export interface ScreeningInput {
  /** Defaults to today on the server. */
  date?: string
  answers: Screening['answers']
}

/** The REDs screens, newest first. */
export function useScreenings() {
  return useQuery({
    queryKey: [keys.screenings],
    queryFn: () => api<Screening[]>('GET', '/screenings'),
  })
}

/** Two or more flags hold progression, so the plan and today refresh with the screens. */
export function useSaveScreening() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ScreeningInput) => api<Screening>('POST', '/screenings', input),
    onSuccess: () =>
      Promise.all(
        [keys.screenings, keys.today, keys.plan].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  })
}
