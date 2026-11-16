import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { isoDateInZone, todayIso } from '../../shared/dates.ts'
import type { SessionUser, TodayView } from '../../shared/types.ts'
import { api, keys } from './client.ts'
import { copyRetryInterval, useAskAgainOnReconnect } from './copyRetry.ts'

/**
 * Today as one coach payload: the session of the day with its targets, the readiness read, the
 * week strip, the race countdown, the health counts and the unrated runs. The
 * server tags the answer with an ETag that follows the data version and the day, so asking again
 * is cheap while nothing has changed. A stale payload is read again when the window regains
 * focus: a phone that was locked overnight shows the new day's session, not yesterday's. A surface
 * that needs only the server's date, and only once a control is open, passes `enabled: false`
 * until then. While the answer is the phone's copy and the browser is online, it is asked again
 * until the server answers (`copyRetry.ts`).
 */
export function useToday(options: { enabled?: boolean } = {}) {
  const queryKey = [keys.today]
  const enabled = options.enabled ?? true
  const query = useQuery({
    queryKey,
    queryFn: () => api<TodayView>('GET', '/today'),
    refetchOnWindowFocus: true,
    refetchInterval: copyRetryInterval,
    enabled,
  })
  useAskAgainOnReconnect({ queryKey, data: query.data, refetch: query.refetch, enabled })
  return query
}

/** The longest delay a timer takes: browsers keep it in 32 bits. */
const MAX_TIMER_MS = 2 ** 31 - 1
/** How far ahead the end of a day is searched for; a day is at most 25 hours long. */
const SEARCH_SPAN_MS = 30 * 60 * 60 * 1000
/** The wait before asking again when the server still answers with the old day. */
const RETRY_MS = 60_000

/**
 * Milliseconds from `now` until the calendar day in `tz` is no longer `date`: 0 when the day in
 * `tz` is already later than `date` (the payload is from an earlier day), and `null` when `date`
 * is later than the day in `tz` (the device's clock runs behind the server's, so waiting does not
 * end it). Never reads the machine's zone, so a phone in another zone waits for the server's
 * midnight. Throws a RangeError for an unknown zone, like `isoDateInZone`.
 */
function msUntilDayEnds(now: Date, tz: string, date: string): number | null {
  const from = now.getTime()
  const today = isoDateInZone(now, tz)
  // ISO dates order as text.
  if (today > date) return 0
  if (today < date) return null
  // A day is at most 25 hours long, so it has ended by the end of the search span.
  let high = from + SEARCH_SPAN_MS
  let low = from
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (isoDateInZone(new Date(middle), tz) !== date) high = middle
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
 * never refreshed this way, and neither is a payload dated after the device's own day in the
 * server's zone (a device clock that runs behind): no timer is set, and the next focus refetch
 * reads it again.
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

/**
 * The zone the runner's days follow, read without a request: the session user's `tz`, then the zone
 * of a cached Today payload (a `me` payload cached before the field existed), then null, which the
 * callers read as the device's own day. Never the device zone by name, so a phone in another zone
 * than the server shows the server's day (D10, ADR 0022).
 */
export function useRunnerZone(): string | null {
  // Observers that never fetch: the session user is read once by the app shell, and a page asking
  // for a day must not add a request (nor an unmocked one to a test).
  const me = useQuery<SessionUser | null>({ queryKey: [keys.me], enabled: false })
  const today = useQuery<TodayView>({ queryKey: [keys.today], enabled: false })
  return me.data?.tz ?? today.data?.tz ?? null
}

/**
 * The server's own zone, which the Profile picker's "Not set" entry names, from the session user
 * (`SessionUser.serverTz`). Null until it loads, and for a payload cached before the field existed.
 */
export function useServerZone(): string | null {
  const me = useQuery<SessionUser | null>({ queryKey: [keys.me], enabled: false })
  return me.data?.serverTz ?? null
}

/**
 * The day of `now` in `tz`. The one read of the device's day under `web/`: used while no zone is
 * known, or when this device's ICU rejects the zone (the scanner in `noProcessZone.test.ts` allows
 * this file one call).
 */
function dayIn(now: Date, tz: string | null): string {
  if (tz !== null) {
    try {
      return isoDateInZone(now, tz)
    } catch {
      // fall through to the device's day
    }
  }
  return todayIso(now)
}

/**
 * The calendar day of an instant (a revision's time, a link's creation) in the runner's zone: the
 * day the runner lived it, whichever zone the device is in. Falls back to the device's day only
 * while no zone is known.
 */
export function useRunnerDayOf(): (at: Date) => string {
  const tz = useRunnerZone()
  return useCallback((at: Date) => dayIn(at, tz), [tz])
}

/**
 * Today as the runner's day, `YYYY-MM-DD`: the page that reads it shows the same day as Today does,
 * on any device. The component renders again when the runner's day ends, so a page left open past
 * midnight moves on without a reload. Falls back to the device's day only while no zone is known.
 */
export function useRunnerToday(): string {
  const tz = useRunnerZone()
  const [, setTick] = useState(0)
  const today = dayIn(new Date(), tz)
  useEffect(() => {
    if (tz === null) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      let wait: number | null
      try {
        wait = msUntilDayEnds(new Date(), tz, today)
      } catch {
        return
      }
      // Null: the day in `tz` is earlier than `today`, which cannot happen for a day just read.
      if (wait === null) return
      timer = setTimeout(
        () => {
          setTick((n) => n + 1)
          // A timer that fires early leaves the day unchanged: arm again for what is left. When
          // the day has moved, the render above runs this effect again with the new day.
          if (dayIn(new Date(), tz) === today) arm()
        },
        Math.max(Math.min(wait, MAX_TIMER_MS), 1),
      )
    }
    arm()
    // A device that slept through midnight has no timer to wake it: look again on return.
    const recheck = () => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1)
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [tz, today])
  return today
}
