import { useQueryClient, type Query, type QueryKey } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useOnline } from '../components/useOnline.ts'

/**
 * The reads the service worker keeps (ADR 0012) can come back as the phone's copy
 * (`servedFromCache`) while the browser says it is online: the `online` event can arrive before a
 * request can get out, and the worker then answers that request from the copy again. One ask on
 * reconnect is not enough, so the read repeats until the server answers. The wait starts at
 * `COPY_RETRY_MS` and doubles with each answer that is still the copy, up to `COPY_RETRY_MAX_MS`: a
 * server that is down or asleep is not asked every two seconds for as long as the page is open. A
 * server answer or the `online` event starts the wait again from the first step.
 */
export const COPY_RETRY_MS = 2_000
export const COPY_RETRY_MAX_MS = 60_000

type Copyable = { servedFromCache?: true }

/** The answers in a row that were still the copy, counted once for each answer the query received. */
const streaks = new WeakMap<object, { answers: number; copies: number }>()

/** The wait before asking again after `copies` answers in a row that were the copy. */
export function copyRetryDelay(copies: number): number {
  return Math.min(COPY_RETRY_MS * 2 ** Math.max(copies - 1, 0), COPY_RETRY_MAX_MS)
}

/**
 * `refetchInterval` for such a read: a repeat while the answer is the copy and the browser is
 * online, with the growing wait above. It reads the same state however often the library asks.
 */
export function copyRetryInterval<T extends Copyable>(
  query: Query<T, Error, T, readonly unknown[]>,
): number | false {
  const { data, dataUpdateCount } = query.state
  if (data?.servedFromCache !== true) {
    streaks.delete(query)
    return false
  }
  let streak = streaks.get(query)
  if (streak === undefined) {
    streak = { answers: dataUpdateCount, copies: 1 }
    streaks.set(query, streak)
  } else if (streak.answers !== dataUpdateCount) {
    streak.answers = dataUpdateCount
    streak.copies += 1
  }
  return navigator.onLine !== false ? copyRetryDelay(streak.copies) : false
}

/**
 * Asks again when the browser says it is back and the answer is the phone's copy. A page that
 * opened on the copy never saw the browser go offline, so the library does not read the return of
 * the connection as a reconnect. A disabled read asks nothing, and the ask does not cancel a
 * request that another mounted observer of the same read has under way.
 */
export function useAskAgainOnReconnect(options: {
  queryKey: QueryKey
  data: Copyable | undefined
  refetch: (options: { cancelRefetch: boolean }) => unknown
  enabled?: boolean
}): void {
  const { queryKey, data, refetch, enabled = true } = options
  const queryClient = useQueryClient()
  const online = useOnline()
  const servedFromCache = data?.servedFromCache === true
  const key = JSON.stringify(queryKey)
  useEffect(() => {
    if (!enabled || !online || !servedFromCache) return
    const query = queryClient.getQueryCache().find({ queryKey: JSON.parse(key) as QueryKey })
    const streak = query === undefined ? undefined : streaks.get(query)
    if (streak !== undefined) streak.copies = 0
    void refetch({ cancelRefetch: false })
  }, [enabled, online, servedFromCache, key, queryClient, refetch])
}
