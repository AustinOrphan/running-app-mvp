import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts'
import { climbInUnit, type ClimbWeek } from '../../../shared/domain/trendsLoad.ts'
import type { Units } from '../../../shared/types.ts'
import { formatClimb } from '../../../shared/units.ts'
import { formatShortDate } from '../format.ts'
import styles from './ClimbChart.module.css'
import { monthStep, monthTicks, tickLabel } from './monthTicks.ts'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'

export interface ClimbChartProps {
  /** The weeks drawn, oldest first, the last of them the current week when it is in range. */
  weeks: readonly ClimbWeek[]
  units: Units
  /** The accessible name of the chart and the caption of its hidden table. */
  ariaLabel: string
}

interface Point {
  weekStart: string
  label: string
  /** The week's climb in the runner's unit; null for a week with no figure (a gap). */
  value: number | null
  /** The mean of that week and the three before it, in the runner's unit; null for the current week. */
  mean: number | null
  week: ClimbWeek
}

/** Width of the value axis (px); the ticks are bare numbers and the unit is in the caption. */
const AXIS_WIDTH = 52
/** Room on the right for the last month's label, which is centred on its week (px). */
const RIGHT_ROOM = 12

/**
 * The peak rounded up to a whole multiple of its leading power of ten (1234 gives 2000, 12 gives
 * 20), made even below 10, so the three ticks (0, half, ceiling) land on whole numbers.
 */
export function niceCeiling(peak: number): number {
  if (!(peak > 0)) return 10
  const step = 10 ** Math.floor(Math.log10(peak))
  const ceiling = Math.ceil(peak / step) * step
  return ceiling < 10 && ceiling % 2 === 1 ? ceiling + 1 : ceiling
}

function ValueBar({ x, y, width, height, payload }: BarShapeProps) {
  const point = payload as Point
  if (!(height > 0)) return null
  const current = point.week.current
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={current ? 'var(--accent-soft)' : chartColors.run}
      stroke={current ? 'var(--accent)' : 'none'}
      strokeWidth={current ? 2 : 0}
    />
  )
}

/**
 * Climbing per week over months. Bars are the weeks (the current one outlined), a line follows the
 * mean of each week and the three before it through complete weeks only. A week with no figure has
 * no bar. The figures are in a visually hidden table.
 */
export function ClimbChart({ weeks, units, ariaLabel }: ClimbChartProps) {
  const points: Point[] = weeks.map((week) => ({
    weekStart: week.weekStart,
    label: formatShortDate(week.weekStart),
    value: week.ascentM === null ? null : climbInUnit(week.ascentM, units),
    mean: week.meanM === null ? null : climbInUnit(week.meanM, units),
    week,
  }))
  const ceiling = niceCeiling(
    Math.max(0, ...points.map((p) => Math.max(p.value ?? 0, p.mean ?? 0))),
  )
  const ticks = monthTicks(
    weeks.map((w) => w.weekStart),
    monthStep(weeks.length),
  )

  return (
    <figure className={styles.figure}>
      <div role="img" aria-label={ariaLabel} className={styles.chart}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 224 }}
        >
          <ComposedChart
            accessibilityLayer
            data={points}
            margin={{ top: 8, right: RIGHT_ROOM, bottom: 0, left: 0 }}
          >
            <CartesianGrid {...gridProps} />
            <XAxis
              {...axisProps}
              dataKey="weekStart"
              ticks={ticks}
              interval={0}
              tickFormatter={tickLabel}
            />
            <YAxis
              {...axisProps}
              width={AXIS_WIDTH}
              domain={[0, ceiling]}
              ticks={[0, ceiling / 2, ceiling]}
            />
            <Tooltip
              content={(props) => {
                const point = (props.payload?.[0] as { payload?: Point } | undefined)?.payload
                if (point === undefined) return null
                const { week } = point
                return (
                  <ChartTooltip
                    active={props.active}
                    label={`Week of ${point.label}`}
                    payload={[
                      {
                        name: 'Climb',
                        value:
                          week.ascentM === null ? 'No elevation' : formatClimb(week.ascentM, units),
                      },
                      { name: 'Runs', value: String(week.runs) },
                      { name: 'Runs with elevation', value: String(week.measured) },
                    ]}
                  />
                )
              }}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
            <Bar
              dataKey="value"
              name="Climb"
              fill={chartColors.run}
              shape={ValueBar}
              isAnimationActive={false}
            />
            <Line
              dataKey="mean"
              name="Mean of 4 weeks"
              type="linear"
              stroke="var(--text)"
              strokeWidth={2}
              dot={false}
              activeDot={false}
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
              <th scope="col">Runs</th>
              <th scope="col">Runs with elevation</th>
              <th scope="col">Climb</th>
              <th scope="col">Mean of 4 weeks</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.weekStart}>
                <th scope="row">{formatShortDate(week.weekStart)}</th>
                <td>{String(week.runs)}</td>
                <td>{String(week.measured)}</td>
                <td>{week.ascentM === null ? '–' : formatClimb(week.ascentM, units)}</td>
                <td>{week.meanM === null ? '–' : formatClimb(week.meanM, units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
