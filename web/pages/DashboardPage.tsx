import { Link } from 'react-router-dom'
import { addDays, daysBetween, mondayOf, todayIso } from '../../shared/dates.ts'
import { remainingPlan } from '../../shared/domain/adaptation.ts'
import type { Activity, WeekRow } from '../../shared/types.ts'
import { formatDistance, minutesToHours1 } from '../../shared/units.ts'
import { useActivities } from '../api/activities.ts'
import { useGoals } from '../api/goals.ts'
import { usePlan } from '../api/plan.ts'
import { useReviews } from '../api/reviews.ts'
import { useSettings } from '../api/settings.ts'
import { useWeeks } from '../api/weeks.ts'
import buttonStyles from '../components/Button.module.css'
import { WeeklyHoursChart } from '../components/charts/WeeklyHoursChart.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { formatLongDate, formatShortDate, phaseLabel } from '../components/format.ts'
import { Meter } from '../components/Meter.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import styles from './DashboardPage.module.css'

const STRIP_DAYS = 28
const CHART_WEEKS = 12
const ACTIVITY_DAYS = 90

interface DayRun {
  date: string
  minutes: number
}

/** Run minutes per day for the `days` days ending on `today`; flagged duplicates do not count. */
function runMinutesPerDay(activities: Activity[], today: string, days: number): DayRun[] {
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

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

export function DashboardPage() {
  const today = todayIso()
  const thisWeek = mondayOf(today)
  const firstChartWeek = addDays(thisWeek, -7 * (CHART_WEEKS - 1))
  const weekRange = { from: firstChartWeek, to: thisWeek }

  const goals = useGoals()
  const plan = usePlan()
  const weeks = useWeeks(weekRange)
  const reviews = useReviews(weekRange)
  const activities = useActivities({ from: addDays(today, 1 - ACTIVITY_DAYS) })
  const settings = useSettings()

  const queries = [goals, plan, weeks, reviews, activities, settings]
  const logActivity = (
    <Link to="/activities?new=1" className={`${buttonStyles.button} ${buttonStyles.primary}`}>
      Log activity
    </Link>
  )

  if (queries.some((q) => q.isError)) {
    return (
      <>
        <PageHeader title="Today" actions={logActivity} />
        <p role="alert">
          Today did not load. The server did not respond; reload the page to try again.
        </p>
      </>
    )
  }
  if (
    goals.data === undefined ||
    plan.data === undefined ||
    weeks.data === undefined ||
    reviews.data === undefined ||
    activities.data === undefined ||
    settings.data === undefined
  ) {
    return (
      <>
        <PageHeader title="Today" actions={logActivity} />
        <Skeleton lines={5} />
      </>
    )
  }

  const units = settings.data.units
  const weekRows: WeekRow[] = weeks.data
  const currentRow = weekRows.find((w) => w.weekStart === thisWeek)
  const runMin = currentRow?.runMin ?? 0
  const runSessions = currentRow?.runSessions ?? 0

  const planWeeks = plan.data?.weeks ?? []
  const planIndex = planWeeks.findIndex((w) => w.weekStart === thisWeek)
  const planWeek = planIndex >= 0 ? planWeeks[planIndex] : undefined
  const planWeekStarts = new Set(planWeeks.map((w) => w.weekStart))

  const goal = goals.data.find((g) => g.isActive)
  const daysToRace = goal ? daysBetween(today, goal.targetDate) : null
  const showRace = goal !== undefined && daysToRace !== null && daysToRace >= 0
  const perDay =
    planWeek === undefined
      ? null
      : remainingPlan({
          today,
          weekStart: thisWeek,
          targetRunMin: planWeek.targetRunMin,
          runMinSoFar: runMin,
        })

  const context =
    planWeek === undefined
      ? `Week of ${formatShortDate(thisWeek)}`
      : `Week of ${formatShortDate(thisWeek)}, ${phaseLabel(planWeek.phase)}`

  const strip = runMinutesPerDay(activities.data, today, STRIP_DAYS)
  const stripRuns = activities.data.filter(
    (a) =>
      a.type === 'run' &&
      a.date > addDays(today, -STRIP_DAYS) &&
      a.date <= today &&
      a.duplicateStatus !== 'possible' &&
      a.duplicateStatus !== 'confirmed',
  )
  const stripDistanceM = stripRuns.reduce((sum, a) => sum + (a.distanceM ?? 0), 0)
  const stripPeak = Math.max(1, ...strip.map((d) => d.minutes))

  const possibleDuplicates = activities.data.filter((a) => a.duplicateStatus === 'possible').length
  const reviewByWeek = new Map(reviews.data.map((r) => [r.weekStart, r]))
  const pastUnconfirmed = weekRows.filter(
    (w) =>
      w.weekStart < thisWeek &&
      planWeekStarts.has(w.weekStart) &&
      reviewByWeek.get(w.weekStart)?.dataStatus !== 'complete',
  ).length
  const lastWeek = addDays(thisWeek, -7)
  const lastWeekHasData =
    planWeekStarts.has(lastWeek) ||
    (weekRows.find((w) => w.weekStart === lastWeek)?.runSessions ?? 0) > 0
  const lastWeekReady = lastWeekHasData && (reviewByWeek.get(lastWeek)?.reviewedAt ?? null) === null
  const hasFlags = possibleDuplicates > 0 || pastUnconfirmed > 0 || lastWeekReady

  return (
    <>
      <PageHeader title="Today" context={context} actions={logActivity} />

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
            <Meter valueMin={runMin} targetMin={planWeek.targetRunMin} label="Run time this week" />
            <p className={styles.muted}>
              {`${phaseLabel(planWeek.phase)}, week ${String(planIndex + 1)} of ${String(planWeeks.length)}`}
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

      {showRace || perDay !== null ? (
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
      ) : null}

      {plan.data === null ? (
        <section className={styles.section}>
          <EmptyState
            title="No plan yet. Choose a goal race, then generate weekly targets."
            action={
              <Link
                to={goal ? '/plan' : '/goals'}
                className={`${buttonStyles.button} ${buttonStyles.secondary}`}
              >
                {goal ? 'Generate a plan' : 'Choose a goal'}
              </Link>
            }
          />
        </section>
      ) : planWeek === undefined ? (
        <p className={styles.muted}>This week is outside the plan.</p>
      ) : null}

      {hasFlags ? (
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
      ) : null}

      {stripRuns.length > 0 ? (
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
      ) : null}

      {weekRows.some((w) => w.runMin > 0) ? (
        <section className={styles.section}>
          <h2 className={styles.heading}>Last 12 weeks</h2>
          <WeeklyHoursChart
            weeks={weekRows}
            planned={planWeeks.map((w) => ({
              weekStart: w.weekStart,
              targetRunMin: w.targetRunMin,
            }))}
            ariaLabel="Run hours per week, last 12 weeks"
          />
        </section>
      ) : null}
    </>
  )
}
