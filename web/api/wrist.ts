import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WristSettings, WristStatus } from '../../shared/types.ts'
import { useOnline } from '../components/useOnline.ts'
import { api, keys, qs } from './client.ts'

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
 * Garmin upload. A 409 says what is missing (a connection, a reconnect) in its message.
 */
export function useSetPublishing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { enabled: boolean; garminLinked: boolean }) =>
      api<WristSettings>('PUT', '/wrist/intervals', input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [keys.wrist] }),
  })
}
