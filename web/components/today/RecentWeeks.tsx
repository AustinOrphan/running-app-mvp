import type { PlanWeek, WeekRow } from '../../../shared/types.ts'
import { WeeklyHoursChart } from '../charts/WeeklyHoursChart.tsx'
import styles from './today.module.css'

/** Run hours for the last 12 weeks against the plan's targets. */
export function RecentWeeks({ weeks, planWeeks }: { weeks: WeekRow[]; planWeeks: PlanWeek[] }) {
  if (!weeks.some((w) => w.runMin > 0)) return null
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Last 12 weeks</h2>
      <WeeklyHoursChart
        weeks={weeks}
        planned={planWeeks.map((w) => ({
          weekStart: w.weekStart,
          targetRunMin: w.targetRunMin,
        }))}
        ariaLabel="Run hours per week, last 12 weeks"
      />
    </section>
  )
}
