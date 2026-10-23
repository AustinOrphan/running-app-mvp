import type { PlanWeek, WeekRow } from '../../../shared/types.ts'
import { minutesToHours1 } from '../../../shared/units.ts'
import { plural, weekPhaseLabel } from '../format.ts'
import { Meter } from '../Meter.tsx'
import styles from './today.module.css'

/** This week's run hours against the plan's target; the plan fields are absent outside the plan. */
export function WeekHero({
  currentRow,
  planWeek,
  planIndex,
  planWeekCount,
}: {
  currentRow: WeekRow | undefined
  planWeek: PlanWeek | undefined
  /** Zero-based position of `planWeek` in the plan. */
  planIndex: number
  planWeekCount: number
}) {
  const runMin = currentRow?.runMin ?? 0
  const runSessions = currentRow?.runSessions ?? 0
  return (
    <section aria-label="This week" className={styles.hero}>
      <p className={styles.heroLine}>
        <span className={styles.display}>{minutesToHours1(runMin)}</span>
        <span className={styles.heroUnit}>
          {planWeek === undefined
            ? 'h run this week'
            : `h of ${minutesToHours1(planWeek.targetRunMin)} h target`}
        </span>
      </p>
      {planWeek === undefined ? null : (
        <>
          <Meter
            valueMin={runMin}
            targetMin={planWeek.targetRunMin}
            label="Run time this week"
            hideUnderCaption
          />
          <p className={styles.muted}>
            {`${weekPhaseLabel(planWeek)}, week ${String(planIndex + 1)} of ${String(planWeekCount)}`}
          </p>
          <p className={styles.counts}>
            <span>
              {`${String(currentRow?.runDays ?? 0)} of ${String(planWeek.runDays)} ${plural(planWeek.runDays, 'run day', 'run days')}`}
            </span>
            <span>
              {`${String(currentRow?.strengthSessions ?? 0)} of ${String(planWeek.strengthSessions)} ${plural(planWeek.strengthSessions, 'strength session', 'strength sessions')}`}
            </span>
          </p>
        </>
      )}
      {runSessions === 0 ? (
        <p className={styles.muted}>No runs this week yet. Log one when you&apos;re out.</p>
      ) : null}
    </section>
  )
}
