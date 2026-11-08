import type { ReactNode } from 'react'
import {
  driftAria,
  driftComparableLine,
  driftFilledLine,
  driftHollowOnlyLine,
  driftHillsLine,
  driftMedianLine,
  driftNoMedianLine,
  driftSizeLine,
  hrAria,
  hrCaption,
  hrEmptyBody,
  hrEmptyPaceBody,
  hrNeedsLine,
  hrOverlapLine,
  spanText,
  trendsText,
} from '../../../shared/copy/trends.ts'
import { addDays } from '../../../shared/dates.ts'
import {
  durabilityGroup,
  fixedSpeedSeries,
  HR_WINDOW_STEP_DAYS,
  runKey,
  type TrendsRunsView,
} from '../../../shared/domain/trendsRuns.ts'
import type { Units } from '../../../shared/types.ts'
import { useTrendsRuns } from '../../api/trends.ts'
import { DurabilityChart, EfficiencyChart } from '../charts/lazyCharts.tsx'
import { EmptyState } from '../EmptyState.tsx'
import { ErrorState } from '../ErrorState.tsx'
import { useLoadView } from '../loadView.ts'
import styles from './RunPanels.module.css'

const text = trendsText

export interface RunPanelsProps {
  /** Months of the range the page shows, for the names of the charts. */
  months: number
  /** Weeks of that range: the panels draw the runs and windows of the last `weekCount` weeks. */
  weekCount: number
  units: Units
}

interface SectionProps {
  id: string
  heading: string
  children: ReactNode
}

function Section({ id, heading, children }: SectionProps) {
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        {heading}
      </h2>
      {children}
    </section>
  )
}

interface PanelProps {
  view: TrendsRunsView
  from: string
  months: number
  units: Units
}

/** Heart-rate drift of each flat long run in the range, with the median of the A7 group (rule T1). */
function DriftPanel({ view, from, months, units }: PanelProps) {
  const runs = view.longRuns.filter((run) => run.date >= from)
  if (runs.length === 0) {
    return <EmptyState title={text('trends.drift.empty')} body={text('trends.drift.empty-body')} />
  }
  const group = durabilityGroup(runs)
  // A dot is filled only once its group makes a median: with fewer runs nothing is read from them.
  const median = group?.medianPct ?? null
  const inGroup = new Set(median === null ? [] : group?.runs.map(runKey))
  const latest = runs[runs.length - 1]!
  return (
    <>
      <p className={styles.caption}>{text('trends.drift.caption')}</p>
      <DurabilityChart
        runs={runs}
        inGroup={inGroup}
        median={median}
        units={units}
        from={from}
        to={view.asOf}
        ariaLabel={driftAria(spanText(months, null), {
          count: runs.length,
          pct: latest.decouplingPct,
          date: latest.date,
        })}
      />
      <p className={styles.figure}>
        {group !== null && group.medianPct !== null
          ? driftMedianLine(group.medianPct, group.runs.length, group.medianMin)
          : driftNoMedianLine(group?.runs.length ?? 0, units)}
      </p>
      <p className={styles.caption}>
        {median === null ? driftHollowOnlyLine() : driftFilledLine()} {driftComparableLine(units)}
      </p>
      <p className={styles.caption}>{driftSizeLine()}</p>
    </>
  )
}

/** The heart rate of the runner's own line at one pace, a point per window (rule A11). */
function SpeedPanel({ view, from, months, units }: PanelProps) {
  const windows = view.hrWindows.filter((window) => window.end >= from)
  const series = fixedSpeedSeries(windows)
  const drawn = series.points.filter((point) => point.bpm !== null)
  const latestBpm = drawn.at(-1)?.bpm ?? null
  if (series.referenceMps !== null && drawn.length === 0) {
    // Some window has a line, but none ran the reference pace: say that, not the run count.
    return (
      <EmptyState
        title={text('trends.hr.empty-pace')}
        body={hrEmptyPaceBody(series.referenceMps, units)}
      />
    )
  }
  if (series.referenceMps === null) {
    const have = view.hrWindows.at(-1)?.qualifying ?? 0
    return <EmptyState title={text('trends.hr.empty')} body={hrEmptyBody(have)} />
  }
  return (
    <>
      <p className={styles.caption}>{hrCaption(series.referenceMps, units)}</p>
      <EfficiencyChart
        points={series.points}
        from={from}
        to={view.asOf}
        ariaLabel={hrAria(spanText(months, null), { mps: series.referenceMps, latestBpm }, units)}
      />
      <p className={styles.caption}>{text('trends.hr.reference')}</p>
      <p className={styles.caption}>{text('trends.hr.heat')}</p>
      <p className={styles.caption}>{hrOverlapLine(HR_WINDOW_STEP_DAYS / 7)}</p>
      <p className={styles.caption}>{hrNeedsLine(series.referenceMps, units)}</p>
      <p className={styles.caption}>{text('trends.hr.moves')}</p>
    </>
  )
}

/**
 * The two run panels of Trends, under the weekly running: heart-rate drift on long runs and the
 * heart rate the runner's line gives at one speed (rules T1, A7 and A11, ADR 0019). Both read
 * `GET /api/trends/runs`, so a failure is told once and each panel keeps its heading.
 */
export function RunPanels({ months, weekCount, units }: RunPanelsProps) {
  const runs = useTrendsRuns()
  const loadView = useLoadView(runs)
  const view = runs.data
  const from = view === undefined ? '' : addDays(view.asOf, -(weekCount * 7) + 1)

  // Without data the two panels fail together, so one section tells it once and keeps the retry
  // button mounted; the rest of the page is not touched.
  if (loadView === 'failed' || loadView === 'retrying') {
    return (
      <Section id="trends-runs-heading" heading={text('trends.runs.heading')}>
        <ErrorState
          subject={text('trends.runs.subject')}
          onRetry={runs.refetch}
          retrying={loadView === 'retrying'}
        />
      </Section>
    )
  }

  const body = (show: (view: TrendsRunsView) => ReactNode): ReactNode =>
    view === undefined ? (
      <div className={`skeleton ${styles.pending}`} aria-busy="true" aria-label="Loading" />
    ) : (
      show(view)
    )

  return (
    <>
      <Section id="trends-drift-heading" heading={text('trends.drift.heading')}>
        {body((data) => (
          <DriftPanel view={data} from={from} months={months} units={units} />
        ))}
        {view === undefined ? null : <p className={styles.caption}>{driftHillsLine(units)}</p>}
      </Section>
      <Section id="trends-hr-heading" heading={text('trends.hr.heading')}>
        {body((data) => (
          <SpeedPanel view={data} from={from} months={months} units={units} />
        ))}
      </Section>
    </>
  )
}
