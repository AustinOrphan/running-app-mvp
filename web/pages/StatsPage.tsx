import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { Units } from '../../shared/types.ts'
import { formatDistance, formatDuration, formatPace, minutesToHours1 } from '../../shared/units.ts'
import { useSettings } from '../api/settings.ts'
import { useStats } from '../api/stats.ts'
import { useWeeks } from '../api/weeks.ts'
import { MonthlyHoursChart, WeeklyHoursChart } from '../components/charts/lazyCharts.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { formatShortDate } from '../components/format.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import styles from './StatsPage.module.css'

const HISTORY_WEEKS = 26
const CHART_WEEKS = 12
const CHART_MONTHS = 12
const NO_VALUE = '–'

// The distances `fastestEfforts` ranks, in its order; used to name the ones without a run.
const EFFORT_LABELS = ['1 mi', '5K', '10K', 'Half', 'Marathon', '50K']

const monthFormat = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "2026-02" -> "Feb 2026" */
function monthLabel(month: string): string {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`))
}

/** "2026-01-10" -> "10 Jan 2026" */
function dateWithYear(date: string): string {
  return `${formatShortDate(date)} ${date.slice(0, 4)}`
}

function distanceOrDash(distanceM: number, units: Units): string {
  return distanceM > 0 ? formatDistance(distanceM, units) : NO_VALUE
}

export function StatsPage() {
  const today = todayIso()
  const thisWeek = mondayOf(today)
  const stats = useStats()
  const weeks = useWeeks({ from: addDays(thisWeek, -7 * (HISTORY_WEEKS - 1)), to: thisWeek })
  const settings = useSettings()

  if (stats.isError || weeks.isError || settings.isError) {
    return (
      <>
        <PageHeader title="Stats" />
        <p role="alert">Stats did not load. Reload the page to try again.</p>
      </>
    )
  }
  if (stats.data === undefined || weeks.data === undefined || settings.data === undefined) {
    return (
      <>
        <PageHeader title="Stats" />
        <Skeleton lines={5} />
      </>
    )
  }

  const units = settings.data.units
  const { monthly, yearly, efforts, longest } = stats.data

  if (monthly.length === 0 && efforts.length === 0) {
    return (
      <>
        <PageHeader title="Stats" />
        <EmptyState
          title="No runs yet. Stats appear after the first run."
          body="Log a run or import a file and the totals show up here."
        />
      </>
    )
  }

  const missing = EFFORT_LABELS.filter((label) => !efforts.some((e) => e.label === label))
  const recentMonths = monthly.slice(-CHART_MONTHS)
  const monthPoints = recentMonths.map((m) => ({
    label: monthLabel(m.month),
    hours: m.runMin / 60,
  }))
  const weekRows = weeks.data
  const history = [...weekRows].reverse()

  return (
    <>
      <PageHeader
        title="Stats"
        context="Totals and longest runs use runs only; races count toward fastest efforts; flagged duplicates are left out"
      />

      {weekRows.some((w) => w.runMin > 0) ? (
        <section className={styles.section}>
          <h2 className={styles.heading}>Last 12 weeks</h2>
          <WeeklyHoursChart
            weeks={weekRows.slice(-CHART_WEEKS)}
            ariaLabel="Run hours per week, last 12 weeks"
          />
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.heading}>Monthly totals</h2>
        <MonthlyHoursChart points={monthPoints} ariaLabel="Run hours per month" />
        <div
          className={styles.tableWrap}
          tabIndex={0}
          role="region"
          aria-label="Monthly totals table"
        >
          <table className={styles.table}>
            <caption className="visually-hidden">Monthly totals</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Run hours</th>
                <th scope="col">Runs</th>
                <th scope="col">Distance</th>
                <th scope="col">Longest run</th>
              </tr>
            </thead>
            <tbody>
              {[...monthly].reverse().map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthLabel(m.month)}</th>
                  <td>{minutesToHours1(m.runMin)}</td>
                  <td>{String(m.runs)}</td>
                  <td>{distanceOrDash(m.runM, units)}</td>
                  <td>{`${String(m.longestRunMin)} min`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Yearly totals</h2>
        <div
          className={styles.tableWrap}
          tabIndex={0}
          role="region"
          aria-label="Yearly totals table"
        >
          <table className={styles.table}>
            <caption className="visually-hidden">Yearly totals</caption>
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col">Run hours</th>
                <th scope="col">Runs</th>
                <th scope="col">Distance</th>
              </tr>
            </thead>
            <tbody>
              {[...yearly].reverse().map((y) => (
                <tr key={y.year}>
                  <th scope="row">{y.year}</th>
                  <td>{minutesToHours1(y.runMin)}</td>
                  <td>{String(y.runs)}</td>
                  <td>{distanceOrDash(y.runM, units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Longest runs</h2>
        <div
          className={styles.tableWrap}
          tabIndex={0}
          role="region"
          aria-label="Longest runs table"
        >
          <table className={styles.table}>
            <caption className="visually-hidden">Longest runs</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Time</th>
                <th scope="col">Distance</th>
                <th scope="col">Pace</th>
              </tr>
            </thead>
            <tbody>
              {longest.map((run) => (
                <tr key={run.id}>
                  <th scope="row">{dateWithYear(run.date)}</th>
                  <td>{formatDuration(run.durationSec)}</td>
                  <td>
                    {run.distanceM === null ? NO_VALUE : formatDistance(run.distanceM, units)}
                  </td>
                  <td>
                    {run.distanceM === null
                      ? NO_VALUE
                      : formatPace(run.durationSec, run.distanceM, units)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Fastest efforts</h2>
        {efforts.length > 0 ? (
          <div
            className={styles.tableWrap}
            tabIndex={0}
            role="region"
            aria-label="Fastest efforts table"
          >
            <table className={styles.table}>
              <caption className="visually-hidden">Fastest efforts</caption>
              <thead>
                <tr>
                  <th scope="col">Distance</th>
                  <th scope="col">Time</th>
                  <th scope="col">Pace</th>
                  <th scope="col">Run distance</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {efforts.map((effort) => (
                  <tr key={effort.label}>
                    <th scope="row">{effort.label}</th>
                    <td>{formatDuration(effort.durationSec)}</td>
                    <td>{formatPace(effort.durationSec, effort.distanceM, units)}</td>
                    <td>{formatDistance(effort.distanceM, units)}</td>
                    <td>{dateWithYear(effort.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {missing.length > 0 ? (
          <p className={styles.note}>{`No qualifying run yet for ${missing.join(', ')}.`}</p>
        ) : null}
        <p className={styles.note}>
          A run counts for a distance when it is within 0.5% under to 2% over it.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>Weekly history</h2>
        <div
          className={styles.tableWrap}
          tabIndex={0}
          role="region"
          aria-label="Weekly history table"
        >
          <table className={styles.table}>
            <caption className="visually-hidden">Weekly history, last 26 weeks</caption>
            <thead>
              <tr>
                <th scope="col">Week of</th>
                <th scope="col">Run hours</th>
                <th scope="col">Runs</th>
                <th scope="col">Run days</th>
                <th scope="col">Long-run share</th>
              </tr>
            </thead>
            <tbody>
              {history.map((week) => (
                <tr key={week.weekStart}>
                  <th scope="row">{formatShortDate(week.weekStart)}</th>
                  <td>{minutesToHours1(week.runMin)}</td>
                  <td>{String(week.runSessions)}</td>
                  <td>{String(week.runDays)}</td>
                  <td>
                    {week.longRunShare === null
                      ? NO_VALUE
                      : `${String(Math.round(week.longRunShare * 100))}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
