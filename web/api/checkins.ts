import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Checkin } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/** The fields the owner enters; omitted fields stay as they are. */
export type CheckinInput = Partial<Omit<Checkin, 'date'>>

/** The check-in of one day, or null when none was entered. */
export function useCheckin(date: string) {
  return useQuery({
    queryKey: [keys.checkins, date],
    queryFn: () => api<Checkin | null>('GET', `/checkins/${encodeURIComponent(date)}`),
  })
}

/** A check-in feeds today's readiness advice and the weekly decision. */
export function useSaveCheckin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ date, input }: { date: string; input: CheckinInput }) =>
      api<Checkin>('PUT', `/checkins/${encodeURIComponent(date)}`, input),
    onSuccess: () =>
      Promise.all(
        [keys.checkins, keys.today, keys.wellness].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  })
}
