import { Link } from 'react-router-dom'
import type { TodayHealth } from '../../../shared/types.ts'
import { plural } from '../format.ts'
import styles from './DataHealth.module.css'

/**
 * Links to possible duplicates, past weeks without confirmed data and a review that is due. The
 * counts come from the server (`coach.health`), which also holds the producers' notes.
 */
export function DataHealth({ health }: { health: TodayHealth }) {
  const { possibleDuplicates, pastUnconfirmedWeeks, lastWeekReady } = health
  if (possibleDuplicates === 0 && pastUnconfirmedWeeks === 0 && !lastWeekReady) return null

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
        {pastUnconfirmedWeeks > 0 ? (
          <li>
            <Link to="/review">
              {`${String(pastUnconfirmedWeeks)} past ${plural(pastUnconfirmedWeeks, 'week', 'weeks')} without confirmed data`}
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
