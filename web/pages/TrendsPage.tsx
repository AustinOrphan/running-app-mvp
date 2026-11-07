import { useState } from 'react'
import { Link } from 'react-router-dom'
import { render } from '../../shared/copy/template.ts'
import { TRENDS_TEMPLATES, trendsText } from '../../shared/copy/trends.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { Units, WeekRow } from '../../shared/types.ts'
import { useSettings } from '../api/settings.ts'
import { useWeeks } from '../api/weeks.ts'
import { TrendsRunChart } from '../components/charts/lazyCharts.tsx'
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

/** Months of running over a range the runner picks, drawn as descriptive pictures (rule T1). */
export function TrendsPage() {
  const online = useOnline()
  const [range, setRange] = useState<RangeKey>(savedRange)
  const thisWeek = mondayOf(todayIso())
  const weeks = useWeeks({ from: addDays(thisWeek, -7 * (MAX_WEEKS - 1)), to: thisWeek })
  const settings = useSettings()

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
    </>
  )
}
