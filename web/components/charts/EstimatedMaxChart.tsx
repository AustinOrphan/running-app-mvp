import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import styles from './EstimatedMaxChart.module.css'
import { yAxisWidth } from './StreamChart.tsx'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'

export interface EstimatedMaxChartProps {
  /** One point per session that has an estimate, oldest first; `value` is in the runner's weight unit. */
  points: ReadonlyArray<{ label: string; value: number }>
  /** The accessible name of the chart, and the words under it. */
  name: string
  /** The runner's weight unit, for the tooltip: "lb". */
  unit: string
}

/**
 * The estimated maximum of one lift, session by session, as a line with a dot for each session.
 * Colour carries no meaning: the one line is named under the chart, and the same figures are in the
 * table beside it, so the chart is a picture of them, named for assistive technology.
 */
export function EstimatedMaxChart({ points, name, unit }: EstimatedMaxChartProps) {
  if (points.length === 0) return null
  const yWidth = yAxisWidth(points.map((point) => String(point.value)))
  return (
    <figure className={styles.figure}>
      <div role="img" aria-label={name} className={styles.chart}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 192 }}
        >
          <LineChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis {...axisProps} dataKey="label" interval="preserveStartEnd" />
            <YAxis {...axisProps} width={yWidth} domain={['auto', 'auto']} allowDecimals={false} />
            <Tooltip
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  payload={props.payload}
                  label={props.label}
                  format={(value) => String(value) + ' ' + unit}
                />
              )}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
            <Line
              dataKey="value"
              name={name}
              type="monotone"
              stroke={chartColors.strength}
              strokeWidth={2}
              dot={{ r: 3, fill: chartColors.strength, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className={styles.caption}>{name}</figcaption>
    </figure>
  )
}
