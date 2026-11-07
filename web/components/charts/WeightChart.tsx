import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { bodyWeightIn } from '../../../shared/domain/weight.ts'
import type { TrendWeightWeek, WeightUnit } from '../../../shared/types.ts'
import { formatShortDate } from '../format.ts'
import { monthStep, monthTicks, tickLabel } from './monthTicks.ts'
import styles from './WeightChart.module.css'
import { axisProps, ChartTooltip, gridProps } from './theme.ts'

export interface WeightChartProps {
  /** One entry per week drawn, oldest first. */
  weeks: readonly TrendWeightWeek[]
  /** The runner's weight unit; the series is in grams. */
  unit: WeightUnit
  /** The accessible name of the chart and the caption of its hidden table. */
  ariaLabel: string
}

interface Point {
  weekStart: string
  label: string
  mean: number | null
  weighIns: number
}

/** Width of the value axis (px). */
const AXIS_WIDTH = 36
/**
 * The value axis spans at least this share of the median weight, so an ordinary week-to-week
 * variation reads as a flat line and not as a slope. A page default, not an engine number.
 */
const MIN_SPAN_SHARE = 0.15

/** Three ticks and a domain at least `MIN_SPAN_SHARE` of the median wide, centred on the readings. */
export function weightScale(values: readonly number[]): {
  domain: [number, number]
  ticks: number[]
} {
  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  const median = sorted[Math.floor(sorted.length / 2)]!
  const span = Math.max(max - min, median * MIN_SPAN_SHARE)
  const centre = (min + max) / 2
  const low = Math.floor(centre - span / 2)
  const high = Math.ceil(centre + span / 2)
  return { domain: [low, high], ticks: [low, Math.round((low + high) / 2), high] }
}

/**
 * Weekly mean body weight as a neutral line with a marker for each week with enough weigh-ins. A
 * week without enough has no marker and the line breaks there. No goal line, no change figure and
 * no colour but the neutral ink (rule T1, ADR 0019). The figures are in a visually hidden table.
 */
export function WeightChart({ weeks, unit, ariaLabel }: WeightChartProps) {
  const points: Point[] = weeks.map((week) => ({
    weekStart: week.weekStart,
    label: formatShortDate(week.weekStart),
    mean: week.grams === null ? null : bodyWeightIn(week.grams, unit),
    weighIns: week.weighIns,
  }))
  const drawn = points.flatMap((p) => (p.mean === null ? [] : [p.mean]))
  const { domain, ticks } = weightScale(drawn.length > 0 ? drawn : [0, 1])
  const months = monthTicks(
    weeks.map((w) => w.weekStart),
    monthStep(weeks.length),
  )
  const show = (value: number | null) => (value === null ? '' : value.toFixed(1))

  return (
    <figure className={styles.figure}>
      <div role="img" aria-label={ariaLabel} className={styles.chart}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 140 }}
        >
          <ComposedChart
            accessibilityLayer
            data={points}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid {...gridProps} />
            <XAxis
              {...axisProps}
              dataKey="weekStart"
              ticks={months}
              interval={0}
              tickFormatter={tickLabel}
            />
            <YAxis {...axisProps} width={AXIS_WIDTH} domain={domain} ticks={ticks} />
            <Tooltip
              content={(props) => {
                const point = (props.payload?.[0] as { payload?: Point } | undefined)?.payload
                if (point === undefined) return null
                return (
                  <ChartTooltip
                    active={props.active}
                    label={`Week of ${point.label}`}
                    payload={[
                      {
                        name: 'Weekly mean',
                        value:
                          point.mean === null ? 'Too few weigh-ins' : `${show(point.mean)} ${unit}`,
                      },
                      { name: 'Weigh-ins', value: String(point.weighIns) },
                    ]}
                  />
                )
              }}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
            <Line
              dataKey="mean"
              name="Weekly mean"
              type="linear"
              stroke="var(--text-muted)"
              strokeWidth={2}
              dot={{ r: weeks.length > 60 ? 2 : 3, fill: 'var(--text-muted)', strokeWidth: 0 }}
              activeDot={{ r: 4, fill: 'var(--text-muted)', strokeWidth: 0 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* The wrapper holds the width of the table; a bare absolute table would widen the page. */}
      <div className="visually-hidden">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">{`Mean (${unit})`}</th>
              <th scope="col">Weigh-ins</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.weekStart}>
                <th scope="row">{point.label}</th>
                <td>{show(point.mean)}</td>
                <td>{String(point.weighIns)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
