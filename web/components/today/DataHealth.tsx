import { Link } from 'react-router-dom'
import { addDays } from '../../../shared/dates.ts'
import type { Activity, PlanWeek, ReviewView, WeekRow } from '../../../shared/types.ts'
import { plural } from '../format.ts'
import styles from './today.module.css'

/** Links to possible duplicates, past weeks without confirmed data and a review that is due. */
export function DataHealth({
  activities,
  weeks,
  reviews,
  planWeeks,
  thisWeek,
}: {
  activities: Activity[]
  weeks: WeekRow[]
  reviews: ReviewView[]
  planWeeks: PlanWeek[]
  /** Monday of the current week. */
  thisWeek: string
}) {
  const planWeekStarts = new Set(planWeeks.map((w) => w.weekStart))
  const possibleDuplicates = activities.filter((a) => a.duplicateStatus === 'possible').length
  const reviewByWeek = new Map(reviews.map((r) => [r.weekStart, r]))
  const pastUnconfirmed = weeks.filter(
    (w) =>
      w.weekStart < thisWeek &&
      planWeekStarts.has(w.weekStart) &&
      reviewByWeek.get(w.weekStart)?.dataStatus !== 'complete',
  ).length
  const lastWeek = addDays(thisWeek, -7)
  const lastWeekHasData =
    planWeekStarts.has(lastWeek) ||
    (weeks.find((w) => w.weekStart === lastWeek)?.runSessions ?? 0) > 0
  const lastWeekReady = lastWeekHasData && (reviewByWeek.get(lastWeek)?.reviewedAt ?? null) === null
  if (possibleDuplicates === 0 && pastUnconfirmed === 0 && !lastWeekReady) return null

  return (
    <section aria-label="Data health" className={styles.section}>
      <ul className={styles.flags}>
        {possibleDuplicates > 0 ? (
          <li>
            <Link to="/activities?duplicates=1">
              {`${String(possibleDuplicates)} possible ${plural(possibleDuplicates, 'duplicate', 'duplicates')} to check`}
            </Link>
          </li>
        ) : null}
        {pastUnconfirmed > 0 ? (
          <li>
            <Link to="/review">
              {`${String(pastUnconfirmed)} past ${plural(pastUnconfirmed, 'week', 'weeks')} without confirmed data`}
            </Link>
          </li>
        ) : null}
        {lastWeekReady ? (
          <li>
            <Link to="/review">Last week is ready to review.</Link>
          </li>
        ) : null}
      </ul>
    </section>
  )
}
