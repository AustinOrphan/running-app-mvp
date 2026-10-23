import { lazy, Suspense, useEffect } from 'react'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { usePlan } from '../../api/plan.ts'
import { useWeeks } from '../../api/weeks.ts'
import styles from './RecentWeeks.module.css'

const CHART_WEEKS = 12

/** The chart and the charting library behind it load as their own chunk, not with the page. */
const loadChart = () => import('../charts/WeeklyHoursChart.tsx')
const WeeklyHoursChart = lazy(() =>
  loadChart().then((module) => ({ default: module.WeeklyHoursChart })),
)

/**
 * Run hours for the last 12 weeks against the plan's targets. It reads the weeks and the plan
 * itself, so the page mounts it only once it is near the viewport (`History`), and it asks for the
 * chart chunk in the same moment, so the code arrives while the figures do. The chart's place is
 * held at its height until the chunk is in.
 */
export function RecentWeeks({ today }: { today: string }) {
  useEffect(() => {
    void loadChart()
  }, [])
  const thisWeek = mondayOf(today)
  const weeks = useWeeks({ from: addDays(thisWeek, -7 * (CHART_WEEKS - 1)), to: thisWeek })
  const plan = usePlan()
  if (weeks.data === undefined || !weeks.data.some((w) => w.runMin > 0)) return null
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{`Last ${String(CHART_WEEKS)} weeks`}</h2>
      <Suspense fallback={<div className={`skeleton ${styles.placeholder}`} aria-hidden="true" />}>
        <WeeklyHoursChart
          weeks={weeks.data}
          planned={(plan.data?.weeks ?? []).map((w) => ({
            weekStart: w.weekStart,
            targetRunMin: w.targetRunMin,
          }))}
          ariaLabel={`Run hours per week, last ${String(CHART_WEEKS)} weeks`}
        />
      </Suspense>
    </section>
  )
}
