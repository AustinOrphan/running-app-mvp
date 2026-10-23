import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ScoredPrediction } from '../../../shared/engine/backtest.ts'
import { formatDuration } from '../../../shared/units.ts'
import styles from './PredictionTrackChart.module.css'
import { yAxisWidth } from './StreamChart.tsx'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'

export interface PredictionTrackChartProps {
  /** The weekly predictions held against the result, oldest first. */
  points: readonly ScoredPrediction[]
  /** The official finish time, drawn as a dashed line. */
  resultSec: number
  /** The accessible name of the chart. */
  name: string
  /** The word the dashed line carries. */
  resultLabel: string
  /** Names the horizontal axis, under the chart and in the tooltip. */
  axisLabel: string
}

interface Row {
  weeksBefore: number
  predictedSec: number
  range: [number, number]
}

/** Seconds between gridlines, smallest first; the first one that gives at most four gaps is used. */
const STEPS_SEC = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14_400]
/** Used when even the largest step leaves more gaps than that: a very long and very wide range. */
const WIDEST_STEP_SEC = 28_800
const MAX_GAPS = 4

/** Round bounds around every shown time, and the ticks between them. */
export function timeScale(times: readonly number[]): { domain: [number, number]; ticks: number[] } {
  const min = Math.min(...times)
  const max = Math.max(...times)
  const step =
    STEPS_SEC.find((s) => Math.ceil(max / s) - Math.floor(min / s) <= MAX_GAPS) ?? WIDEST_STEP_SEC
  const low = Math.floor(min / step) * step
  const high = Math.max(Math.ceil(max / step) * step, low + step)
  const ticks: number[] = []
  for (let tick = low; tick <= high; tick += step) ticks.push(tick)
  return { domain: [low, high], ticks }
}

/**
 * The weekly predictions of one race: a shaded band for each week's range, the predicted time as a
 * line, and the result as a dashed line across it. The same figures are in the table beside it, so
 * the chart is a picture of them, named for assistive technology.
 */
export function PredictionTrackChart({
  points,
  resultSec,
  name,
  resultLabel,
  axisLabel,
}: PredictionTrackChartProps) {
  if (points.length === 0) return null
  const rows: Row[] = points.map((p) => ({
    weeksBefore: p.weeksBefore,
    predictedSec: p.predictedSec,
    range: [p.lowSec, p.highSec],
  }))
  const { domain, ticks } = timeScale([
    resultSec,
    ...points.flatMap((p) => [p.lowSec, p.predictedSec, p.highSec]),
  ])
  const yWidth = yAxisWidth(ticks.map(formatDuration))

  return (
    <figure className={styles.figure}>
      <div role="img" aria-label={name} className={styles.chart}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 192 }}
        >
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            {/* The race is on the right: the weeks before it count down along the axis. */}
            <XAxis
              {...axisProps}
              type="number"
              dataKey="weeksBefore"
              reversed
              domain={[0, 'dataMax']}
              allowDecimals={false}
            />
            <YAxis
              {...axisProps}
              width={yWidth}
              domain={domain}
              ticks={ticks}
              allowDataOverflow
              tickFormatter={(value: number) => formatDuration(value)}
            />
            <Tooltip
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  payload={props.payload?.filter((entry) => entry.dataKey === 'predictedSec')}
                  label={`${axisLabel}: ${String(props.label)}`}
                  format={(value) => formatDuration(value)}
                />
              )}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
            <Area
              dataKey="range"
              name="Range"
              type="monotone"
              stroke="none"
              fill={chartColors.range}
              isAnimationActive={false}
            />
            <Line
              dataKey="predictedSec"
              name="Predicted"
              type="monotone"
              stroke={chartColors.predicted}
              strokeWidth={2}
              dot={{ r: 3, fill: chartColors.predicted, strokeWidth: 0 }}
              isAnimationActive={false}
            />
            <ReferenceLine
              y={resultSec}
              stroke={chartColors.result}
              strokeWidth={2}
              strokeDasharray="6 4"
              label={{
                value: resultLabel,
                position: 'insideTopRight',
                fill: 'var(--text)',
                fontSize: 13,
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className={styles.caption}>{axisLabel}</figcaption>
    </figure>
  )
}
