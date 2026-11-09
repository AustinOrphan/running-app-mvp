import type { ReactNode } from 'react'
import {
  climbAria,
  climbCaption,
  climbCoverageLine,
  intensityAria,
  intensityCaption,
  intensityCoverageLine,
  recordsStart,
  spanText,
  trendsText,
} from '../../../shared/copy/trends.ts'
import { addDays, mondayOf, weekStartsBetween } from '../../../shared/dates.ts'
import { cropToFirstRecord } from '../../../shared/domain/trends.ts'
import {
  climbCoverage,
  climbWeeks,
  intensityCoverage,
  intensityWeeks,
  type TrendsLoadView,
} from '../../../shared/domain/trendsLoad.ts'
import type { Units } from '../../../shared/types.ts'
import { useTrendsLoad } from '../../api/trends.ts'
import { ClimbChart, IntensityChart } from '../charts/lazyCharts.tsx'
import { EmptyState } from '../EmptyState.tsx'
import { ErrorState } from '../ErrorState.tsx'
import { useLoadView } from '../loadView.ts'
import styles from './RunPanels.module.css'

const text = trendsText

export interface LoadPanelsProps {
  /** Months of the range the page shows, for the names of the charts. */
  months: number
  /** Weeks of that range: the panels draw the weeks of the last `weekCount` weeks. */
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

/** The method under a chart, closed until asked for: where the records start and how the figures are counted. */
function How({ cutBefore, children }: { cutBefore: string | null; children: ReactNode }) {
  return (
    <details className={styles.how}>
      <summary>{text('trends.load.how')}</summary>
      {cutBefore === null ? null : <p className={styles.caption}>{recordsStart(cutBefore)}</p>}
      {children}
    </details>
  )
}

interface PanelProps {
  view: TrendsLoadView
  weekStarts: string[]
  currentWeek: string
  /** The Monday of the first run in the history read; the plot starts there when the range reaches past it. */
  firstRecord: string | null
  months: number
  units: Units
}

/** The gain recorded on the runs of each week, with the 4-week mean (rule A12). */
function ClimbPanel({ view, weekStarts, currentWeek, firstRecord, months, units }: PanelProps) {
  const all = climbWeeks(view.runs, weekStarts, currentWeek)
  const { weeks, cutBefore } = cropToFirstRecord(all, firstRecord)
  const coverage = climbCoverage(weeks)
  if (coverage.runs === 0) {
    return <EmptyState title={text('trends.run.empty')} body={text('trends.run.empty-body')} />
  }
  if (coverage.covered === 0) {
    return (
      <>
        <EmptyState title={text('trends.climb.empty')} body={text('trends.climb.empty-body')} />
        <p className={styles.caption}>{climbCoverageLine(coverage.covered, coverage.runs)}</p>
      </>
    )
  }
  const latest = [...weeks].reverse().find((week) => !week.current && week.ascentM !== null)
  return (
    <>
      <p className={styles.caption}>{climbCaption(units)}</p>
      <ClimbChart
        weeks={weeks}
        units={units}
        ariaLabel={climbAria(spanText(months, cutBefore), latest?.ascentM ?? null, units)}
      />
      <p className={styles.caption}>{climbCoverageLine(coverage.covered, coverage.runs)}</p>
      <How cutBefore={cutBefore}>
        <p className={styles.caption}>{text('trends.climb.line')}</p>
      </How>
    </>
  )
}

/** The run time of each week in the three heart-rate zones as they stand today, and the time with no usable heart rate (rule A12). */
function IntensityPanel({ view, weekStarts, currentWeek, firstRecord, months }: PanelProps) {
  const all = intensityWeeks(view.runs, weekStarts, currentWeek)
  const { weeks, cutBefore } = cropToFirstRecord(all, firstRecord)
  const coverage = intensityCoverage(weeks)
  if (coverage.runs === 0) {
    return <EmptyState title={text('trends.run.empty')} body={text('trends.run.empty-body')} />
  }
  if (view.zones === null) {
    return (
      <EmptyState
        title={text('trends.intensity.no-zones')}
        body={text('trends.intensity.no-zones-body')}
      />
    )
  }
  const latestWeek = [...weeks].reverse().find((week) => !week.current && week.runs > 0)
  const minutes = (sec: number) => Math.round(sec / 60)
  return (
    <>
      <p className={styles.caption}>{intensityCaption(view.zones.lt1Hr, view.zones.lt2Hr)}</p>
      <IntensityChart
        weeks={weeks}
        ariaLabel={intensityAria(
          spanText(months, cutBefore),
          latestWeek === undefined
            ? null
            : {
                z1: minutes(latestWeek.belowSec),
                z2: minutes(latestWeek.betweenSec),
                z3: minutes(latestWeek.aboveSec),
                none: minutes(latestWeek.noHrSec),
              },
        )}
      />
      <p className={styles.caption}>{intensityCoverageLine(coverage.covered, coverage.runs)}</p>
      <How cutBefore={cutBefore}>
        <p className={styles.caption}>{text('trends.intensity.neutral')}</p>
      </How>
    </>
  )
}

/**
 * The two load panels of Trends, beside the weekly running: climbing per week and run time per week
 * by heart-rate zone (rule A12, ADR 0019). Both read `GET /api/trends/load` and sum its rows by week
 * here, so the range switch asks the server for nothing more and a failure is told once.
 */
export function LoadPanels({ months, weekCount, units }: LoadPanelsProps) {
  const load = useTrendsLoad()
  const loadView = useLoadView(load)
  const view = load.data

  if (loadView === 'failed' || loadView === 'retrying') {
    return (
      <Section id="trends-load-heading" heading={text('trends.load.heading')}>
        <ErrorState
          subject={text('trends.load.subject')}
          onRetry={load.refetch}
          retrying={loadView === 'retrying'}
          art={false}
        />
      </Section>
    )
  }

  const body = (show: (view: TrendsLoadView) => ReactNode): ReactNode =>
    view === undefined ? (
      <div className={`skeleton ${styles.pending}`} aria-busy="true" aria-label="Loading" />
    ) : (
      show(view)
    )

  const currentWeek = view === undefined ? '' : mondayOf(view.asOf)
  const weekStarts =
    view === undefined
      ? []
      : weekStartsBetween(addDays(currentWeek, -7 * (weekCount - 1)), currentWeek)
  const firstRun = view?.runs[0]
  const firstRecord = firstRun === undefined ? null : mondayOf(firstRun.date)

  return (
    <>
      <Section id="trends-climb-heading" heading={text('trends.climb.heading')}>
        {body((data) => (
          <ClimbPanel
            view={data}
            weekStarts={weekStarts}
            currentWeek={currentWeek}
            firstRecord={firstRecord}
            months={months}
            units={units}
          />
        ))}
      </Section>
      <Section id="trends-intensity-heading" heading={text('trends.intensity.heading')}>
        {body((data) => (
          <IntensityPanel
            view={data}
            weekStarts={weekStarts}
            currentWeek={currentWeek}
            firstRecord={firstRecord}
            months={months}
            units={units}
          />
        ))}
      </Section>
    </>
  )
}
