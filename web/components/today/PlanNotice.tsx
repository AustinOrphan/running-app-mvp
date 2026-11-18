import type { FirstAction } from '../../../shared/engine/firstAction.ts'
import type { Units } from '../../../shared/types.ts'
import { FirstActionState } from '../FirstAction.tsx'
import styles from './PlanNotice.module.css'

/** What to do when there is no plan, or a note that this week is outside the one there is. */
export function PlanNotice({
  hasPlan,
  weekInPlan,
  hasGoal,
  firstAction,
  units,
}: {
  hasPlan: boolean
  weekInPlan: boolean
  hasGoal: boolean
  /** The server's reason for the first step (`TodayCoach.firstAction`); absent reads as the goal. */
  firstAction: FirstAction | undefined
  units: Units
}) {
  if (!hasPlan) {
    return (
      <section className={styles.section}>
        <FirstActionState firstAction={firstAction} hasGoal={hasGoal} units={units} />
      </section>
    )
  }
  return weekInPlan ? null : <p className={styles.muted}>This week is outside the plan.</p>
}
