import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Checkin } from '../../shared/types.ts'
import { getOutbox, type SaveResult } from '../pwa/outbox.ts'
import { api, keys } from './client.ts'

/** The fields the owner enters; omitted fields stay as they are. */
export type CheckinInput = Partial<Omit<Checkin, 'date'>>

/** The URL of one day's check-in: the key of its entry in the outbox. */
export function checkinUrl(date: string): string {
  return `/api/checkins/${encodeURIComponent(date)}`
}

/** The check-in of one day, or null when none was entered. */
export function useCheckin(date: string) {
  return useQuery({
    queryKey: [keys.checkins, date],
    queryFn: () => api<Checkin | null>('GET', `/checkins/${encodeURIComponent(date)}`),
  })
}

/**
 * Saves a check-in through the outbox: the write is kept on this phone first, then sent. With no
 * connection it stays queued and goes out later, so the answer is `queued` and not an error. The
 * result also says when the server refused the write. A check-in feeds today's readiness advice
 * and the weekly decision, so they are read again once the server has it.
 */
export function useSaveCheckin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ date, input }: { date: string; input: CheckinInput }): Promise<SaveResult> =>
      getOutbox().save(checkinUrl(date), input),
    onSuccess: (result) => {
      if (result.status !== 'sent') return undefined
      return Promise.all(
        [keys.checkins, keys.today, keys.wellness].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
    },
  })
}
