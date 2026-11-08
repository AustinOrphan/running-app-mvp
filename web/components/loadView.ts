import { useState } from 'react'

/** What a page draws for one read: its skeleton, the failed-load state, the same while it retries, or its data. */
export type LoadView = 'loading' | 'failed' | 'retrying' | 'ready'

/** The part of a query result the decision reads. */
export interface LoadQuery {
  data: unknown
  isError: boolean
  isFetching: boolean
}

/**
 * The view for a query, given whether a first load of it has already failed. Data wins: a page that
 * holds data keeps it when a background refetch fails. Without data, a failed read is `failed`; the
 * retry of that read is `retrying` (the query is back to `pending` then, so `isError` alone would
 * unmount the failed-load state and drop focus); any other wait is `loading`.
 */
export function loadViewOf(query: LoadQuery, failedBefore: boolean): LoadView {
  if (query.data !== undefined) return 'ready'
  if (query.isError) return 'failed'
  return failedBefore && query.isFetching ? 'retrying' : 'loading'
}

/**
 * `loadViewOf` for a component: remembers that the first load failed, until data arrives. Call it on
 * every render, before any early return.
 */
export function useLoadView(query: LoadQuery): LoadView {
  const [failed, setFailed] = useState(false)
  // Derived state, set while rendering as React allows: it follows the query at once, with no extra paint.
  if (query.data !== undefined) {
    if (failed) setFailed(false)
  } else if (query.isError && !failed) {
    setFailed(true)
  }
  return loadViewOf(query, failed || query.isError)
}

/** A query a page waits on: what `loadViewOf` reads, and the call that reads it again. */
export interface RetryableQuery extends LoadQuery {
  refetch: () => unknown
}

/**
 * Several reads that one page needs, as one `LoadQuery`: it has data only when every read has,
 * failed when any has, and is fetching while any is. `retry` reads again only the reads that failed,
 * so a page does not fetch what it already holds. A read that holds data counts as failed never.
 */
export function combineQueries(queries: readonly RetryableQuery[]): LoadQuery & {
  retry: () => Promise<unknown>
} {
  // A read that holds data has not failed, whatever its background refetch did: data wins.
  const failed = (query: RetryableQuery) => query.isError && query.data === undefined
  return {
    data: queries.every((query) => query.data !== undefined) ? true : undefined,
    isError: queries.some(failed),
    isFetching: queries.some((query) => query.isFetching),
    retry: () => Promise.all(queries.filter(failed).map((query) => query.refetch())),
  }
}
