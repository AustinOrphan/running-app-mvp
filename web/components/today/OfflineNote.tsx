import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { isoDateInZone } from '../../../shared/dates.ts'
import type { TodayView, Units } from '../../../shared/types.ts'
import { serverToday, usePhoneCopy } from './phoneCopy.ts'
import styles from './OfflineNote.module.css'

/**
 * The hour of an instant in a zone, "06:12". The zone is the server's (`TodayView.tz`), the one
 * whose day Today follows; a zone the browser does not know reads in the phone's own.
 */
function clockTimeIn(iso: string, tz: string): string {
  const format = (timeZone: string | undefined) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso))
  try {
    return format(tz)
  } catch (error) {
    if (error instanceof RangeError) return format(undefined)
    throw error
  }
}

/** The server's calendar day of an instant, or null for a zone the browser does not know. */
function dayIn(iso: string, tz: string): string | null {
  try {
    return isoDateInZone(new Date(iso), tz)
  } catch {
    return null
  }
}

/**
 * What the note says. A copy of a day that is over names the day it was saved and that today's is
 * not loaded. Any other copy names the time it was saved, with the day too when that is not the day
 * on screen (a preview that was made the evening before: "saved at 21:50" alone would read as this
 * morning).
 */
function noteText(view: TodayView, units: Units): string {
  const generatedAt = view.coach.generatedAt
  const savedDay = dayIn(generatedAt, view.tz)
  const today = serverToday(view)
  if (today !== null && view.date < today) {
    return render(
      TEMPLATES['today.offline.older'],
      { date: { kind: 'date', iso: savedDay ?? view.date, style: 'weekday' } },
      units,
    )
  }
  const time = clockTimeIn(generatedAt, view.tz)
  if (savedDay !== null && savedDay !== view.date) {
    return render(
      TEMPLATES['today.offline.saved-earlier'],
      { date: { kind: 'date', iso: savedDay, style: 'weekday' }, time },
      units,
    )
  }
  return render(TEMPLATES['today.offline.saved'], { time }, units)
}

/**
 * Says so when Today shows the phone's saved copy (`usePhoneCopy`): the browser has no connection,
 * or the service worker answered from its cache because the server did not. The note goes away by
 * itself when a fresh answer arrives.
 *
 * It sits in a polite live region that is always on the page and empty while the answer is the
 * server's: a screen reader announces text that is added to a region it already knows, and often
 * stays silent about a region that is created with its text. The empty region has no height.
 *
 * The note is one or two lines (the sentence that names a day wraps at 360 px) and belongs to no
 * slot, so the page places it under the session, where it cannot move Done: above it, the note
 * would take 38 to 60 px that the fold's limits (`slots.ts`) do not count.
 */
export function OfflineNote({ view, units }: { view: TodayView; units: Units }) {
  const phoneCopy = usePhoneCopy(view)
  return (
    <div aria-live="polite" aria-atomic="true" className={styles.region}>
      {phoneCopy ? <p className={styles.note}>{noteText(view, units)}</p> : null}
    </div>
  )
}
