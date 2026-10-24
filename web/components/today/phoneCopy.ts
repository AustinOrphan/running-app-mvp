// What Today knows about whether it shows the phone's own copy of the server's answer, and which day
// that answer is for (ADR 0012). The offline note, the check-in row, the Done button and the two
// lines that need a live server (the brief and the watch) all read these, so they agree.
import { isoDateInZone } from '../../../shared/dates.ts'
import type { TodayView } from '../../../shared/types.ts'
import { useOnline } from '../useOnline.ts'

/**
 * Whether Today shows the phone's copy and not the server's live answer: the browser says it has no
 * connection, or the service worker answered from its cache because the server did not
 * (`servedFromCache`, the common case on a phone with one bar of signal: the browser believes it is
 * online). One predicate, so the note, the day rules below and every line that needs the server
 * ask the same question.
 */
export function isPhoneCopy(online: boolean, view: TodayView | undefined): boolean {
  return !online || view?.servedFromCache === true
}

/** `isPhoneCopy` for a component: reads the browser's connection itself. */
export function usePhoneCopy(view: TodayView | undefined): boolean {
  return isPhoneCopy(useOnline(), view)
}

/**
 * The server's calendar day now, in the zone the payload carries (the phone's clock, the server's
 * zone); null for a zone the browser does not know.
 */
export function serverToday(view: TodayView, now: Date = new Date()): string | null {
  try {
    return isoDateInZone(now, view.tz)
  } catch {
    return null
  }
}

/** The day a payload is for, against the server's today. */
export type DayState = 'today' | 'ahead' | 'past'

/**
 * Which day a payload is for: `today`, `ahead` (a preview of a day that has not come) or `past`
 * (a copy of a day that is over).
 *
 * A live answer is the server's own word: it is a preview when `coach.preview` says so. A copy
 * kept on the phone was composed some hours ago, so its flag is old: a preview counts as one only
 * while its date is later than the server's today by the phone's clock, and a preview of the day
 * that has since arrived is that day's Today (it has no readiness read yet, but the check-in row
 * is there to answer). A copy dated before today is of a day that is over.
 */
export function dayState(view: TodayView, phoneCopy: boolean, now: Date = new Date()): DayState {
  const today = phoneCopy ? serverToday(view, now) : null
  if (today === null) return view.coach.preview ? 'ahead' : 'today'
  if (view.date < today) return 'past'
  return view.date > today && view.coach.preview ? 'ahead' : 'today'
}
