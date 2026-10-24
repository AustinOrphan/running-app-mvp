import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { isoDateInZone } from '../../../shared/dates.ts'
import type { TodayView, Units } from '../../../shared/types.ts'
import { useOnline } from '../useOnline.ts'
import styles from './OfflineNote.module.css'

/**
 * The hour of an instant in a zone, "06:12". The zone is the server's (`TodayView.tz`), the one
 * whose day Today follows; a zone the browser does not know reads in the phone's own.
 */
export function clockTimeIn(iso: string, tz: string): string {
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

/** Whether the viewed day is the server's today, for the copy on the screen. */
function isTodaysCopy(view: TodayView): boolean {
  try {
    return view.date === isoDateInZone(new Date(), view.tz)
  } catch {
    return true
  }
}

/**
 * Says so when Today shows the phone's saved copy: the browser has no connection, or the service
 * worker answered from its cache because the server did not (`servedFromCache`). It names when the
 * copy was saved or, when the copy is of an earlier day, which day, and that today's is not loaded.
 * The note goes away by itself when a fresh answer arrives.
 */
export function OfflineNote({ view, units }: { view: TodayView; units: Units }) {
  const online = useOnline()
  if (online && view.servedFromCache !== true) return null
  const text = isTodaysCopy(view)
    ? render(
        TEMPLATES['today.offline.saved'],
        { time: clockTimeIn(view.coach.generatedAt, view.tz) },
        units,
      )
    : render(
        TEMPLATES['today.offline.older'],
        { date: { kind: 'date', iso: view.date, style: 'weekday' } },
        units,
      )
  return (
    <p role="status" className={styles.note}>
      {text}
    </p>
  )
}
