// The charts, loaded when a page that draws one opens instead of with the app. They share the
// `charts` chunk (recharts and d3, about 390 kB), which left in the entry's static graph is
// downloaded, parsed and run on every first load, the sign-in page included. A page imports a chart
// from here, never from the chart's own file; the files in this folder are unchanged, and
// `tests/web/lazyChartImports.test.ts` fails on a static import that would put the chunk back.
// `streamSeries.ts` holds what a page needs to know before it asks for a stream chart.
//
// While the code loads the chart's place is held at its height. When the code cannot be loaded at
// all (offline with no copy kept, or a release replaced the file) a short notice takes the place
// instead of the page going down with the chart.
import { lazy, Suspense, type ComponentType } from 'react'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import styles from './lazyCharts.module.css'

function Unavailable() {
  return (
    <p role="alert" className={styles.unavailable}>
      {render(TEMPLATES['charts.unavailable'], {}, 'km')}
    </p>
  )
}

/** A chart that loads on first use; `place` names the class that holds its height meanwhile. */
function lazyChart<P extends object>(
  load: () => Promise<ComponentType<P>>,
  place: 'weekly' | 'monthly' | 'stream' | 'track' | 'estimate',
): ComponentType<P> {
  const Loaded = lazy(async () => {
    try {
      return { default: await load() }
    } catch {
      return { default: Unavailable as ComponentType<P> }
    }
  }) as unknown as ComponentType<P>
  return function LazyChart(props: P) {
    return (
      <Suspense fallback={<div className={`skeleton ${styles[place]}`} aria-hidden="true" />}>
        <Loaded {...props} />
      </Suspense>
    )
  }
}

const loadWeeklyHoursChart = () =>
  import('./WeeklyHoursChart.tsx').then((module) => module.WeeklyHoursChart)

export const WeeklyHoursChart = lazyChart(loadWeeklyHoursChart, 'weekly')
export const MonthlyHoursChart = lazyChart(
  () => import('./MonthlyHoursChart.tsx').then((module) => module.MonthlyHoursChart),
  'monthly',
)
export const StreamChart = lazyChart(
  () => import('./StreamChart.tsx').then((module) => module.StreamChart),
  'stream',
)
export const PredictionTrackChart = lazyChart(
  () => import('./PredictionTrackChart.tsx').then((module) => module.PredictionTrackChart),
  'track',
)
export const EstimatedMaxChart = lazyChart(
  () => import('./EstimatedMaxChart.tsx').then((module) => module.EstimatedMaxChart),
  'estimate',
)

/**
 * Asks for the weekly chart's code before the chart renders, for a screen that reads the weeks it
 * draws first: the code arrives while the figures do. A failure is left to the chart itself.
 */
export function warmWeeklyHoursChart(): void {
  loadWeeklyHoursChart().catch(() => {})
}
