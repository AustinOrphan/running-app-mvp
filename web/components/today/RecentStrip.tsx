import { addDays } from '../../../shared/dates.ts'
import type { ActivityListItem, Units } from '../../../shared/types.ts'
import { formatDistance } from '../../../shared/units.ts'
import { formatShortDate, plural } from '../format.ts'
import styles from './today.module.css'

const STRIP_DAYS = 28

interface DayRun {
  date: string
  minutes: number
}

/** Run minutes per day for the `days` days ending on `today`; flagged duplicates do not count. */
function runMinutesPerDay(activities: ActivityListItem[], today: string, days: number): DayRun[] {
  const minutes = new Map<string, number>()
  const first = addDays(today, 1 - days)
  for (const a of activities) {
    if (a.type !== 'run' || a.date < first || a.date > today) continue
    if (a.duplicateStatus === 'possible' || a.duplicateStatus === 'confirmed') continue
    minutes.set(a.date, (minutes.get(a.date) ?? 0) + a.durationSec / 60)
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(first, i)
    return { date, minutes: Math.round(minutes.get(date) ?? 0) }
  })
}

/** Run minutes for each of the last 28 days as a bar strip, with a table for screen readers. */
export function RecentStrip({
  activities,
  today,
  units,
}: {
  activities: ActivityListItem[]
  today: string
  units: Units
}) {
  const strip = runMinutesPerDay(activities, today, STRIP_DAYS)
  const stripRuns = activities.filter(
    (a) =>
      a.type === 'run' &&
      a.date > addDays(today, -STRIP_DAYS) &&
      a.date <= today &&
      a.duplicateStatus !== 'possible' &&
      a.duplicateStatus !== 'confirmed',
  )
  if (stripRuns.length === 0) return null
  const stripDistanceM = stripRuns.reduce((sum, a) => sum + (a.distanceM ?? 0), 0)
  const stripPeak = Math.max(1, ...strip.map((d) => d.minutes))

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Last 28 days</h2>
      <div className={styles.strip} aria-hidden="true">
        {strip.map((day) => (
          <span
            key={day.date}
            className={day.minutes > 0 ? styles.bar : styles.barEmpty}
            style={{ height: `${String(Math.max(4, (day.minutes / stripPeak) * 100))}%` }}
          />
        ))}
      </div>
      <p className={styles.caption}>
        {`${String(stripRuns.length)} ${plural(stripRuns.length, 'run', 'runs')}, ${formatDistance(stripDistanceM, units)} in the last 28 days`}
      </p>
      <table className="visually-hidden">
        <caption>Run minutes per day, last 28 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Run minutes</th>
          </tr>
        </thead>
        <tbody>
          {strip.map((day) => (
            <tr key={day.date}>
              <th scope="row">{formatShortDate(day.date)}</th>
              <td>{String(day.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
