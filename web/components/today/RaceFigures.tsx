import { daysBetween } from '../../../shared/dates.ts'
import { remainingPlan } from '../../../shared/domain/adaptation.ts'
import type { Goal, PlanWeek, WeekRow } from '../../../shared/types.ts'
import { formatLongDate, plural } from '../format.ts'
import styles from './today.module.css'

/** Days to the race and the advisory minutes a day left in the week. */
export function RaceFigures({
  today,
  weekStart,
  goal,
  planWeek,
  currentRow,
}: {
  today: string
  weekStart: string
  goal: Goal | undefined
  planWeek: PlanWeek | undefined
  currentRow: WeekRow | undefined
}) {
  const daysToRace = goal ? daysBetween(today, goal.targetDate) : null
  const showRace = goal !== undefined && daysToRace !== null && daysToRace >= 0
  const perDay =
    planWeek === undefined
      ? null
      : remainingPlan({
          today,
          weekStart,
          targetRunMin: planWeek.targetRunMin,
          runMinSoFar: currentRow?.runMin ?? 0,
        })
  if (!showRace && perDay === null) return null

  return (
    <section aria-label="Race and week ahead" className={styles.figures}>
      {goal && daysToRace !== null && showRace ? (
        <div className={styles.figure}>
          <p className={styles.figureLine}>
            {daysToRace === 0 ? (
              <span className={styles.figureNumber}>Race day</span>
            ) : (
              <>
                <span className={styles.figureNumber}>{String(daysToRace)}</span>
                {` ${plural(daysToRace, 'day', 'days')} to the race`}
              </>
            )}
          </p>
          <p className={styles.caption}>
            {`${goal.name}, ${formatLongDate(goal.targetDate)}${goal.dateProvisional ? ', date provisional' : ''}`}
          </p>
        </div>
      ) : null}
      {perDay !== null && perDay.perDayMin !== null ? (
        <div className={styles.figure}>
          {perDay.remainingMin === 0 ? (
            <p className={styles.figureLine}>Nothing left to plan this week</p>
          ) : (
            <p className={styles.figureLine}>
              <span className={styles.figureNumber}>{String(perDay.perDayMin)}</span>
              {' min a day left, through Sunday'}
            </p>
          )}
          <p className={styles.caption}>advisory</p>
        </div>
      ) : null}
    </section>
  )
}
