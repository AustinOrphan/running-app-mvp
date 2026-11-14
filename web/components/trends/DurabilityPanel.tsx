import { Link } from 'react-router-dom'
import {
  durabilityCaption,
  durabilityDescriptionLine,
  durabilityEmptyBody,
  durabilityHrLeftLine,
  durabilityHrReason,
  durabilityHrUncheckedLine,
  durabilityLeftOutLine,
  durabilityPartHourLine,
  trendsText,
} from '../../../shared/copy/trends.ts'
import { addDays } from '../../../shared/dates.ts'
import {
  DURABILITY_PART_HOUR_MIN,
  type DurabilityFuel,
  type DurabilityHour,
  type DurabilityRun,
  type TrendsDurabilityView,
} from '../../../shared/domain/durabilityByHour.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { formatDuration, formatPace } from '../../../shared/units.ts'
import type { Units } from '../../../shared/types.ts'
import { useTrendsDurability } from '../../api/trends.ts'
import { EmptyPreview, EmptyState } from '../EmptyState.tsx'
import { ErrorState } from '../ErrorState.tsx'
import { useLoadView } from '../loadView.ts'
import { ScrollTable } from '../ScrollTable.tsx'
import styles from './DurabilityPanel.module.css'

const text = trendsText

export interface DurabilityPanelProps {
  /** Weeks of the range the page shows: the panel lists the runs of the last `weekCount` weeks. */
  weekCount: number
  units: Units
}

const GROUPS: Array<{
  fuel: DurabilityFuel
  heading: 'trends.durability.fuel-logged' | 'trends.durability.fuel-none'
}> = [
  { fuel: 'logged', heading: 'trends.durability.fuel-logged' },
  { fuel: 'none', heading: 'trends.durability.fuel-none' },
]

interface CellProps {
  hour: DurabilityHour | undefined
  hrShown: boolean
  units: Units
}

/** A dash that a screen reader names: the dash is hidden and the words are read instead. */
function Gap({ words }: { words: string }) {
  return (
    <>
      <span aria-hidden="true">{'–'}</span>
      <span className="visually-hidden">{words}</span>
    </>
  )
}

/**
 * One hour of one run: the pace, then the heart rate; a dash where the hour has no figure. An hour
 * the run did not have is an empty cell, never a dash.
 */
function Cell({ hour, hrShown, units }: CellProps) {
  if (hour === undefined) return <td className={styles.cell} />
  const { paceSecPerKm: pace, hrBpm: hr } = hour
  return (
    <td className={styles.cell}>
      <span className={styles.figure}>
        {pace === null ? (
          <Gap words={text('trends.durability.no-pace')} />
        ) : (
          formatPace(pace, 1000, units)
        )}
      </span>
      {hour.partial ? <span className={styles.length}>{`${String(hour.minutes)} min`}</span> : null}
      {hrShown ? (
        <span className={styles.figure}>
          {hr === null ? <Gap words={text('trends.durability.no-hr')} /> : `${String(hr)} bpm`}
        </span>
      ) : null}
    </td>
  )
}

interface GroupProps {
  heading: string
  runs: readonly DurabilityRun[]
  hours: number
  units: Units
}

/** The runs of one fuel-log group, one row each, the hours across. */
function Group({ heading, runs, hours, units }: GroupProps) {
  return (
    <div className={styles.group}>
      <h3 className={styles.subheading}>{heading}</h3>
      <ScrollTable label={`${heading}: ${text('trends.durability.table')}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{text('trends.durability.col-run')}</th>
              {Array.from({ length: hours }, (_, i) => (
                <th key={i} scope="col">{`Hour ${String(i + 1)}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.activityId}>
                <th scope="row">
                  <Link
                    className={styles.date}
                    to={`/activities/${encodeURIComponent(run.activityId)}`}
                  >
                    {run.date}
                  </Link>
                  <span className={styles.length}>
                    {formatDuration(run.durationSec)}
                    {run.type === 'race' ? ', race' : ''}
                  </span>
                  {run.hrGap === null ? null : (
                    <span className={styles.length}>{durabilityHrReason(run.hrGap)}</span>
                  )}
                </th>
                {Array.from({ length: hours }, (_, i) => (
                  <Cell key={i} hour={run.hours[i]} hrShown={run.hrGap === null} units={units} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
    </div>
  )
}

function body(view: TrendsDurabilityView, from: string, units: Units) {
  const runs = view.runs.filter((run) => run.date >= from)
  const limit = P.a7.driftInferenceLimitMin.value
  // Only the runs of the range shown are counted, as the rows are.
  const left = view.leftOut.filter((run) => run.date >= from)
  const noStream = left.filter((run) => run.reason === 'no-stream').length
  const noGrade = left.length - noStream
  if (runs.length === 0) {
    return (
      <>
        <EmptyState
          title={text('trends.durability.empty')}
          body={durabilityEmptyBody(limit)}
          preview={<EmptyPreview columns={['Run', 'Hour 1', 'Hour 2', 'Hour 3']} />}
        />
        {left.length > 0 ? (
          <p className={styles.caption}>{durabilityLeftOutLine(noStream, noGrade)}</p>
        ) : null}
      </>
    )
  }
  const hours = Math.max(...runs.map((run) => run.hours.length))
  const unchecked = runs.filter((run) => run.hrGap === 'not-checked').length
  const failed = runs.filter((run) => run.hrGap !== null).length - unchecked
  return (
    <>
      <p className={styles.caption}>{durabilityCaption(limit)}</p>
      {GROUPS.map(({ fuel, heading }) => {
        const group = runs.filter((run) => run.fuel === fuel)
        return group.length === 0 ? null : (
          <Group key={fuel} heading={text(heading)} runs={group} hours={hours} units={units} />
        )
      })}
      <p className={styles.caption}>{text('trends.durability.pace')}</p>
      <p className={styles.caption}>{durabilityPartHourLine(DURABILITY_PART_HOUR_MIN)}</p>
      {failed > 0 ? <p className={styles.caption}>{durabilityHrLeftLine(failed)}</p> : null}
      {unchecked > 0 ? (
        <p className={styles.caption}>{durabilityHrUncheckedLine(unchecked)}</p>
      ) : null}
      {left.length > 0 ? (
        <p className={styles.caption}>{durabilityLeftOutLine(noStream, noGrade)}</p>
      ) : null}
    </>
  )
}

/**
 * The long runs hour by hour (rule T1, DR1): each run or race of 180 minutes or more as a row, in
 * the group of runs with a fuel log or of runs with none, pace and heart rate for each hour. A
 * description only: no change figure, no line, no verdict. Reads `GET /api/trends/durability`.
 */
export function DurabilityPanel({ weekCount, units }: DurabilityPanelProps) {
  const query = useTrendsDurability()
  const loadView = useLoadView(query)
  const view = query.data
  const heading = text('trends.durability.heading')
  const from = view === undefined ? '' : addDays(view.asOf, -(weekCount * 7) + 1)

  return (
    <section className={styles.section} aria-labelledby="trends-durability-heading">
      <h2 id="trends-durability-heading" className={styles.heading}>
        {heading}
      </h2>
      {loadView === 'failed' || loadView === 'retrying' ? (
        <ErrorState subject={heading} onRetry={query.refetch} retrying={loadView === 'retrying'} />
      ) : view === undefined ? (
        <div className={`skeleton ${styles.pending}`} aria-busy="true" aria-label="Loading" />
      ) : (
        <>
          {body(view, from, units)}
          <p className={styles.caption}>
            {durabilityDescriptionLine(P.a7.driftInferenceLimitMin.value)}
          </p>
        </>
      )}
    </section>
  )
}
