import type { Query } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useOnline } from '../components/useOnline.ts'

/**
 * The reads the service worker keeps (ADR 0012) can come back as the phone's copy
 * (`servedFromCache`) while the browser says it is online: the `online` event can arrive before a
 * request can get out, and the worker then answers that request from the copy again. One ask on
 * reconnect is not enough, so the read repeats every `COPY_RETRY_MS` until the server answers.
 */
const COPY_RETRY_MS = 2_000

/** `refetchInterval` for such a read: a repeat while the answer is the copy and the browser is online. */
export function copyRetryInterval<T extends { servedFromCache?: true }>(
  query: Query<T, Error, T, readonly unknown[]>,
): number | false {
  return query.state.data?.servedFromCache === true && navigator.onLine !== false
    ? COPY_RETRY_MS
    : false
}

/**
 * Asks again when the browser says it is back and the answer is the phone's copy. A page that
 * opened on the copy never saw the browser go offline, so the library does not read the return of
 * the connection as a reconnect.
 */
export function useAskAgainOnReconnect(
  data: { servedFromCache?: true } | undefined,
  refetch: () => unknown,
): void {
  const online = useOnline()
  const servedFromCache = data?.servedFromCache === true
  useEffect(() => {
    if (online && servedFromCache) void refetch()
  }, [online, servedFromCache, refetch])
}
