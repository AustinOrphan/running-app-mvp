import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { isoDateInZone } from '../../shared/dates.ts'
import type { TodayView } from '../../shared/types.ts'
import { api, keys } from './client.ts'

/**
 * Today as one coach payload: the session of the day with its targets, the readiness read, the
 * week strip, the race countdown, the change line, the health counts and the unrated runs. The
 * server tags the answer with an ETag that follows the data version and the day, so asking again
 * is cheap while nothing has changed. A stale payload is read again when the window regains
 * focus: a phone that was locked overnight shows the new day's session, not yesterday's.
 */
export function useToday() {
  return useQuery({
    queryKey: [keys.today],
    queryFn: () => api<TodayView>('GET', '/today'),
    refetchOnWindowFocus: true,
  })
}

/** The longest delay a timer takes: browsers keep it in 32 bits. */
const MAX_TIMER_MS = 2 ** 31 - 1
/** How far ahead the end of a day is searched for; a day is at most 25 hours long. */
const SEARCH_SPAN_MS = 30 * 60 * 60 * 1000
/** The wait before asking again when the server still answers with the old day. */
const RETRY_MS = 60_000

/**
 * Milliseconds from `now` until the calendar day in `tz` is no longer `date`: 0 when it already
 * is not, `null` when it will not change within a day and a half (a `date` that lies ahead).
 * Never reads the machine's zone, so a phone in another zone waits for the server's midnight.
 * Throws a RangeError for an unknown zone, like `isoDateInZone`.
 */
function msUntilDayEnds(now: Date, tz: string, date: string): number | null {
  const changed = (at: number) => isoDateInZone(new Date(at), tz) !== date
  const from = now.getTime()
  if (changed(from)) return 0
  let high = from + SEARCH_SPAN_MS
  if (!changed(high)) return null
  let low = from
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (changed(middle)) high = middle
    else low = middle
  }
  return high - from
}

/**
 * `useToday` for a page that stays open: when the server's calendar day ends, the payload is
 * requested again, so the page shows the new day's session without a reload. The server decides
 * when a day ends (`TodayView.tz`), never the device clock's zone. The timer is set for the exact
 * end of the day; a server that still answers with the old day (its clock is a little behind) is
 * asked again every minute, which costs a 304. A day ahead (`coach.preview`) is not today and is
 * never refreshed this way.
 */
export function useServerToday() {
  const query = useToday()
  const { refetch } = query
  const date = query.data?.date
  const tz = query.data?.tz
  const preview = query.data?.coach.preview ?? false

  useEffect(() => {
    if (date === undefined || tz === undefined || preview) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      let wait: number | null
      try {
        wait = msUntilDayEnds(new Date(), tz, date)
      } catch {
        return // an unknown zone: the focus refetch of `useToday` still applies
      }
      if (wait === null) return
      if (wait === 0) {
        void refetch()
        timer = setTimeout(arm, RETRY_MS)
      } else {
        timer = setTimeout(arm, Math.min(wait, MAX_TIMER_MS))
      }
    }
    arm()
    return () => {
      clearTimeout(timer)
    }
  }, [date, tz, preview, refetch])

  return query
}
