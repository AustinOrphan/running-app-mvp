import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Checkin } from '../../shared/types.ts'
import { getOutbox, refreshAfterSend, type SaveResult } from '../pwa/outbox.ts'

/** The fields the owner enters; omitted fields stay as they are. */
export type CheckinInput = Partial<Omit<Checkin, 'date'>>

/** The URL of one day's check-in: the key of its entry in the outbox. */
export function checkinUrl(date: string): string {
  return `/api/checkins/${encodeURIComponent(date)}`
}

/**
 * Saves a check-in through the outbox: the write is kept on this phone first, then sent. With no
 * connection it stays queued and goes out later, so the answer is `queued` and not an error. The
 * result also says when the server refused the write. A check-in feeds today's readiness advice
 * and the weekly decision, so they are read again once the server has the write: by the outbox
 * listener in `useOutboxReplay` as the write goes out, and here, joining that read, so the answer
 * comes back with the fresh data in place (`refreshAfterSend`).
 */
export function useSaveCheckin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ date, input }: { date: string; input: CheckinInput }): Promise<SaveResult> =>
      getOutbox().save(checkinUrl(date), input),
    onSuccess: (result, { date }) =>
      result.status === 'sent'
        ? refreshAfterSend(queryClient, checkinUrl(date), { cancelRefetch: false })
        : undefined,
  })
}
