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
