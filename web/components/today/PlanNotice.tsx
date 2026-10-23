import { Link } from 'react-router-dom'
import buttonStyles from '../Button.module.css'
import { EmptyState } from '../EmptyState.tsx'
import styles from './PlanNotice.module.css'

/** What to do when there is no plan, or a note that this week is outside the one there is. */
export function PlanNotice({
  hasPlan,
  weekInPlan,
  hasGoal,
}: {
  hasPlan: boolean
  weekInPlan: boolean
  hasGoal: boolean
}) {
  if (!hasPlan) {
    return (
      <section className={styles.section}>
        <EmptyState
          title="No plan yet. Choose a goal race, then generate weekly targets."
          action={
            <Link
              to={hasGoal ? '/plan' : '/goals'}
              className={`${buttonStyles.button} ${buttonStyles.secondary}`}
            >
              {hasGoal ? 'Generate a plan' : 'Choose a goal'}
            </Link>
          }
        />
      </section>
    )
  }
  return weekInPlan ? null : <p className={styles.muted}>This week is outside the plan.</p>
}
