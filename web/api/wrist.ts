import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CalendarTokenIssued, WristSettings, WristStatus } from '../../shared/types.ts'
import { useOnline } from '../components/useOnline.ts'
import { api, ApiError, keys, qs } from './client.ts'

/** Where the workout file of one session is served. A link, not a request: the browser saves it. */
export function sessionFileHref(sessionId: string): string {
  return `/api/plan/sessions/${encodeURIComponent(sessionId)}/workout.fit`
}

/** Where the zip of one week's workout files is served. */
export function weekZipHref(weekStart: string): string {
  return `/api/plan/weeks/${encodeURIComponent(weekStart)}/workouts.zip`
}

export interface WristRange {
  from: string
  to: string
}

/** How often the status is read again while a send is in progress. */
const RUNNING_POLL_MS = 5_000

export interface WristStatusState {
  /**
   * What the server reports, or undefined while it is loading, when it could not be read, and
   * while the browser is offline. A status the page cannot check is not shown: an old "On your
   * watch" would be false, so every surface renders nothing for it.
   */
  status: WristStatus | undefined
  isPending: boolean
}

/**
 * The status of the sessions on their way to the watch: the next 14 days by default, which one
 * request serves to the Plan page, the session sheet and Today's line. The server does not cache
 * it and the service worker must not either. It is read again when the window regains focus and,
 * while a send is running, every few seconds.
 */
export function useWristStatus(range?: WristRange): WristStatusState {
  const online = useOnline()
  const query = useQuery({
    queryKey: [keys.wrist, 'status', range?.from ?? 'default', range?.to ?? 'default'],
    queryFn: () =>
      api<WristStatus>('GET', `/wrist/status${qs({ from: range?.from, to: range?.to })}`),
    enabled: online,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (q.state.data?.settings.running === true ? RUNNING_POLL_MS : false),
  })
  // A failed read keeps the data of the read before it; neither is shown.
  const usable = online && !query.isError
  return { status: usable ? query.data : undefined, isPending: query.isPending }
}

/** "Send again": clears the back-off of one session (or of all) and starts a send. */
export function useSendAgain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { sessionId?: string } = {}) =>
      api<WristSettings>('POST', '/wrist/publish', input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [keys.wrist] }),
  })
}

/**
 * Turns sending to the watch on or off, and records whether the runner ticked intervals.icu's
 * Garmin upload. A 409 says what is missing (a connection, a reconnect) in its message. Turning
 * sending off with `removeSent` first takes the sessions already sent out of intervals.icu; when
 * that fails the answer is a 409 `remove-failed` and sending stays on.
 */
export function useSetPublishing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { enabled: boolean; garminLinked: boolean; removeSent?: boolean }) =>
      api<WristSettings>('PUT', '/wrist/intervals', input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [keys.wrist] }),
  })
}

/** Whether an error is the 409 of a removal from intervals.icu that did not go through. */
export function isRemoveFailed(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    (error.details as { code?: unknown } | undefined)?.code === 'remove-failed'
  )
}

/**
 * Disconnects intervals.icu. With `removeSent` the sessions already sent are taken out of
 * intervals.icu first, which needs the key, so a failed removal keeps the connection (see
 * `isRemoveFailed`). Imported activities stay either way.
 */
export function useDisconnectIntervals() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { removeSent: boolean }) =>
      api<void>(
        'DELETE',
        `/integrations/intervals${qs({ removeSent: input.removeSent ? 'true' : undefined })}`,
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: [keys.integrations] }),
        queryClient.invalidateQueries({ queryKey: [keys.wrist] }),
      ]),
  })
}

/**
 * Makes the private calendar link, or replaces it, which ends the old one at once. The token is in
 * the answer once and nowhere else, so the mutation is dropped from the cache the moment it
 * settles (`gcTime: 0`): the dialog that shows the link is the only holder.
 */
export function useCreateCalendarLink() {
  const queryClient = useQueryClient()
  return useMutation({
    gcTime: 0,
    mutationFn: () => api<CalendarTokenIssued>('POST', '/wrist/calendar/token'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [keys.wrist] }),
  })
}

/** Turns the calendar link off: the address stops working at once. */
export function useRevokeCalendarLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('DELETE', '/wrist/calendar/token'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [keys.wrist] }),
  })
}
