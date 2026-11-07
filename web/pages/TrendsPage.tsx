import { useState } from 'react'
import { Link } from 'react-router-dom'
import { render } from '../../shared/copy/template.ts'
import {
  bandBuilding,
  bandCaption,
  nightsCaption,
  recoveryAria,
  TRENDS_TEMPLATES,
  trendsText,
} from '../../shared/copy/trends.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { MIN_NIGHTS_PER_MEAN } from '../../shared/domain/trends.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { TrendsView, TrendWeek, Units, WeekRow } from '../../shared/types.ts'
import { useSettings } from '../api/settings.ts'
import { useTrends } from '../api/trends.ts'
import { useWeeks } from '../api/weeks.ts'
import { RecoveryChart, TrendsRunChart } from '../components/charts/lazyCharts.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { useOnline } from '../components/useOnline.ts'
import styles from './TrendsPage.module.css'

/** Weeks the page can show: 24 months, the span `GET /api/trends` answers. */
const MAX_WEEKS = 104

type RangeKey = '6' | '12' | '24'
const RANGES: Array<{ value: RangeKey; label: string; months: number; weeks: number }> = [
  { value: '6', label: '6 months', months: 6, weeks: 26 },
  { value: '12', label: '12 months', months: 12, weeks: 52 },
  { value: '24', label: '24 months', months: 24, weeks: 104 },
]
const RANGE_STORAGE_KEY = 'trends-range'
const DEFAULT_RANGE: RangeKey = '12'

/** The range last chosen on this device, a per-viewer convenience; 12 months without one. */
function savedRange(): RangeKey {
  try {
    const stored = localStorage.getItem(RANGE_STORAGE_KEY)
    return stored === '6' || stored === '12' || stored === '24' ? stored : DEFAULT_RANGE
  } catch {
    return DEFAULT_RANGE
  }
}

function saveRange(range: RangeKey): void {
  try {
    localStorage.setItem(RANGE_STORAGE_KEY, range)
  } catch {
    // Private windows and blocked site data throw; the page works without the memory.
  }
}

const text = trendsText

interface RunningProps {
  weeks: readonly WeekRow[]
  units: Units
  currentWeek: string
  months: number
}

/** Running per week: the bars, the 4-week line, race flags and strength squares. */
function RunningSection({ weeks, units, currentWeek, months }: RunningProps) {
  const [metric, setMetric] = useState<'time' | 'distance'>('time')
  const hasRuns = weeks.some((week) => week.runMin > 0)
  const latestComplete = [...weeks].reverse().find((week) => week.weekStart !== currentWeek)
  const count = { kind: 'count' as const, n: months }
  const ariaLabel =
    latestComplete === undefined
      ? render(TRENDS_TEMPLATES['trends.run.aria-none'], { months: count }, units)
      : metric === 'time'
        ? render(
            TRENDS_TEMPLATES['trends.run.aria-time'],
            { months: count, time: { kind: 'minutes', min: latestComplete.runMin } },
            units,
          )
        : render(
            TRENDS_TEMPLATES['trends.run.aria-distance'],
            { months: count, distance: { kind: 'distance', m: latestComplete.runM } },
            units,
          )

  return (
    <section className={styles.section} aria-labelledby="trends-run-heading">
      <h2 id="trends-run-heading" className={styles.heading}>
        {text('trends.run.heading')}
      </h2>
      {hasRuns ? (
        <>
          <Segmented<'time' | 'distance'>
            label="Show"
            dense
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'time', label: 'Time' },
              { value: 'distance', label: 'Distance' },
            ]}
          />
          <p className={styles.caption}>
            {text(metric === 'time' ? 'trends.run.caption-time' : 'trends.run.caption-distance')}
          </p>
          <TrendsRunChart
            weeks={weeks}
            metric={metric}
            units={units}
            currentWeek={currentWeek}
            ariaLabel={ariaLabel}
          />
          <p className={styles.caption}>{text('trends.run.this-week')}</p>
          <p className={styles.caption}>
            {text('trends.run.marks')}{' '}
            <Link to="/strength">{text('trends.run.strength-link')}</Link>.
          </p>
        </>
      ) : (
        <EmptyState title={text('trends.run.empty')} body={text('trends.run.empty-body')} />
      )}
    </section>
  )
}

type Recovery = TrendsView['recovery']

interface PanelProps {
  heading: string
  caption: string
  /** How the band is built, or null for a series with no band. */
  bandLine: string | null
  none: string
  weeks: readonly TrendWeek[]
  unit: string
  decimals: number
  months: number
  /** What the chart is, for its accessible name. */
  name: string
}

/** One recovery reading: its caption, the range line, the chart, or a line saying none exist. */
function RecoveryPanel({
  heading,
  caption,
  bandLine,
  none,
  weeks,
  unit,
  decimals,
  months,
  name,
}: PanelProps) {
  const latest = [...weeks].reverse().find((week) => week.mean !== null)?.mean ?? null
  return (
    <div className={styles.panel}>
      <h3 className={styles.subheading}>{heading}</h3>
      {weeks.length === 0 ? (
        <p className={styles.caption}>{none}</p>
      ) : (
        <>
          <p className={styles.caption}>{caption}</p>
          {bandLine !== null ? <p className={styles.caption}>{bandLine}</p> : null}
          <RecoveryChart
            weeks={weeks}
            unit={unit}
            decimals={decimals}
            band={bandLine !== null}
            ariaLabel={recoveryAria(
              name,
              months,
              latest === null ? null : `${latest.toFixed(decimals)} ${unit}`,
            )}
          />
        </>
      )}
    </div>
  )
}

/** The words under a heart-rate-variability or resting-heart-rate panel about its band. */
function bandLineOf(
  weeks: readonly TrendWeek[],
  signal: 'hrv' | 'resting-hr',
  cyclic: boolean,
): string | null {
  const last = weeks.at(-1)
  if (last === undefined) return null
  return last.low !== null ? bandCaption(signal, cyclic) : bandBuilding(last.readings ?? 0)
}

interface RecoverySectionProps {
  recovery: Recovery
  months: number
  weekCount: number
}

/** The three recovery readings against the runner's recent range (rule T1): no verdicts. */
function RecoverySection({ recovery, months, weekCount }: RecoverySectionProps) {
  const hrv = recovery.hrv.slice(-weekCount)
  const restingHr = recovery.restingHr.slice(-weekCount)
  const sleep = recovery.sleep.slice(-weekCount)
  return (
    <>
      <RecoveryPanel
        heading={text('trends.hrv.heading')}
        caption={nightsCaption('trends.hrv.caption', MIN_NIGHTS_PER_MEAN)}
        bandLine={bandLineOf(hrv, 'hrv', recovery.cycleBaseline)}
        none={text('trends.hrv.none')}
        weeks={hrv}
        unit="ms"
        decimals={0}
        months={months}
        name="Overnight HRV in ms"
      />
      <RecoveryPanel
        heading={text('trends.rhr.heading')}
        caption={nightsCaption('trends.rhr.caption', MIN_NIGHTS_PER_MEAN)}
        bandLine={bandLineOf(restingHr, 'resting-hr', false)}
        none={text('trends.rhr.none')}
        weeks={restingHr}
        unit="bpm"
        decimals={0}
        months={months}
        name="Resting heart rate in bpm"
      />
      <RecoveryPanel
        heading={text('trends.sleep.heading')}
        caption={nightsCaption('trends.sleep.caption', P.j5.sleepMinNights.value)}
        bandLine={null}
        none={text('trends.sleep.none')}
        weeks={sleep}
        unit="h"
        decimals={1}
        months={months}
        name="Sleep in hours"
      />
      <p className={styles.caption}>{text('trends.recovery.note')}</p>
    </>
  )
}

/** Months of running over a range the runner picks, drawn as descriptive pictures (rule T1). */
export function TrendsPage() {
  const online = useOnline()
  const [range, setRange] = useState<RangeKey>(savedRange)
  const thisWeek = mondayOf(todayIso())
  const weeks = useWeeks({ from: addDays(thisWeek, -7 * (MAX_WEEKS - 1)), to: thisWeek })
  const settings = useSettings()
  const trends = useTrends()

  const title = text('trends.title')
  if (weeks.isError || settings.isError) {
    return (
      <>
        <PageHeader title={title} />
        {online ? (
          <p role="alert">{text('trends.error')}</p>
        ) : (
          <p role="status">{text('trends.offline')}</p>
        )}
      </>
    )
  }
  if (weeks.data === undefined || settings.data === undefined) {
    return (
      <>
        <PageHeader title={title} />
        <div className={`skeleton ${styles.pending}`} aria-busy="true" aria-label="Loading" />
      </>
    )
  }

  const chosen = RANGES.find((r) => r.value === range) ?? RANGES[1]!
  const shown = weeks.data.slice(-chosen.weeks)

  return (
    <>
      <PageHeader title={title} context={text('trends.context')} />
      <Segmented<RangeKey>
        label="Range"
        dense
        value={range}
        onChange={(next) => {
          setRange(next)
          saveRange(next)
        }}
        options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
      />
      <RunningSection
        weeks={shown}
        units={settings.data.units}
        currentWeek={thisWeek}
        months={chosen.months}
      />
      <section className={styles.section} aria-labelledby="trends-recovery-heading">
        <h2 id="trends-recovery-heading" className={styles.heading}>
          {text('trends.recovery.heading')}
        </h2>
        {trends.isError ? (
          online ? (
            <p role="alert">{text('trends.recovery.error')}</p>
          ) : (
            <p role="status">{text('trends.offline')}</p>
          )
        ) : trends.data === undefined ? (
          <div className={`skeleton ${styles.pending}`} aria-busy="true" aria-label="Loading" />
        ) : (
          <RecoverySection
            recovery={trends.data.recovery}
            months={chosen.months}
            weekCount={chosen.weeks}
          />
        )}
      </section>
    </>
  )
}
