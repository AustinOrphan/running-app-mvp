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
import { recordsStart } from '../../../shared/copy/trends.ts'
import { cropToFirstRecord } from '../../../shared/domain/trends.ts'
import type { Units, WeekRow } from '../../../shared/types.ts'
import { formatDistance, minutesToHours1 } from '../../../shared/units.ts'
import { formatShortDate } from '../format.ts'
import { monthStep, monthTicks, tickLabel } from './monthTicks.ts'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'
import styles from './TrendsRunChart.module.css'
import { RaceFlag } from './WeeklyHoursChart.tsx'

export type TrendsRunMetric = 'time' | 'distance'

export interface TrendsRunChartProps {
  /** The weeks drawn, oldest first, the last of them the current week when it is in range. */
  weeks: readonly WeekRow[]
  /** The first week with a record in the whole history; weeks before it are not drawn. */
  firstRecord?: string | null
  metric: TrendsRunMetric
  units: Units
  /** The Monday of today's week: its bar is outlined and has no point on the line. */
  currentWeek: string
  /** The accessible name of the chart and the caption of its hidden table. */
  ariaLabel: string
}

interface Point {
  weekStart: string
  label: string
  value: number
  /** The mean of that week and the three before it, in hours; null for the current week. */
  mean: number | null
  week: WeekRow
  current: boolean
  race: boolean
}

/**
 * Width of the value axis (px); the strength squares leave the same room on the left. The ticks are
 * bare numbers (up to four digits fit); the unit is in the caption above the chart.
 */
const AXIS_WIDTH = 36
/** Room on the right for the last month's label, which is centred on its week (px). */
const RIGHT_ROOM = 12
/** Room above the tallest week for the flag of a race week (px). */
const FLAG_ROOM = 16
const MAX_SQUARES = 4

function ValueBar({ x, y, width, height, payload }: BarShapeProps) {
  const point = payload as Point
  if (!(height > 0)) return null
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={point.current ? 'var(--accent-soft)' : chartColors.run}
        stroke={point.current ? 'var(--accent)' : 'none'}
        strokeWidth={point.current ? 2 : 0}
      />
      {point.race ? <RaceFlag x={x + width / 2} y={y} /> : null}
    </g>
  )
}

/**
 * Run time or distance per week over months. Bars are the weeks (the current one outlined), a flag
 * stands on a race week, and for time a line follows the mean of each week and the three before it,
 * through complete weeks only. Under the bars a row of small squares gives the strength sessions of
 * each week, in the same columns. The figures are in a visually hidden table.
 */
export function TrendsRunChart({
  weeks: allWeeks,
  firstRecord = null,
  metric,
  units,
  currentWeek,
  ariaLabel,
}: TrendsRunChartProps) {
  // Weeks before the first record are not drawn as zero; the caption says where the records start.
  const { weeks, cutBefore } = cropToFirstRecord(allWeeks, firstRecord)
  const perUnitM = units === 'mi' ? 1609.344 : 1000
  const points: Point[] = weeks.map((week) => {
    const current = week.weekStart === currentWeek
    return {
      weekStart: week.weekStart,
      label: formatShortDate(week.weekStart),
      value: metric === 'time' ? week.runMin / 60 : week.runM / perUnitM,
      mean: current ? null : week.avg4wRunMin / 60,
      week,
      current,
      race: week.raceMin > 0,
    }
  })
  const peak = Math.max(0, ...points.map((p) => Math.max(p.value, p.mean ?? 0)))
  // An even ceiling keeps the three ticks (0, half, ceiling) on whole numbers.
  const ceiling = Math.max(2, Math.ceil(peak / 2) * 2)
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
            margin={{ top: FLAG_ROOM, right: RIGHT_ROOM, bottom: 0, left: 0 }}
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
                return (
                  <ChartTooltip
                    active={props.active}
                    label={`Week of ${point.label}`}
                    payload={[
                      {
                        name: 'Run time',
                        value: `${minutesToHours1(point.week.runMin)} h`,
                      },
                      ...(metric === 'distance'
                        ? [{ name: 'Distance', value: formatDistance(point.week.runM, units) }]
                        : []),
                      { name: 'Runs', value: String(point.week.runSessions) },
                      { name: 'Strength sessions', value: String(point.week.strengthSessions) },
                    ]}
                  />
                )
              }}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
            <Bar
              dataKey="value"
              name="Run"
              fill={chartColors.run}
              shape={ValueBar}
              isAnimationActive={false}
            />
            {metric === 'time' ? (
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
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div
        className={styles.squares}
        style={{
          gridTemplateColumns: `repeat(${String(Math.max(1, weeks.length))}, minmax(0, 1fr))`,
          marginLeft: `${String(AXIS_WIDTH)}px`,
          marginRight: `${String(RIGHT_ROOM)}px`,
        }}
        aria-hidden="true"
        data-testid="strength-squares"
      >
        {weeks.map((week) => (
          <span
            key={week.weekStart}
            className={styles.column}
            data-strength={week.strengthSessions}
          >
            {Array.from({ length: Math.min(week.strengthSessions, MAX_SQUARES) }, (_, i) => (
              <span key={i} className={styles.square} />
            ))}
          </span>
        ))}
      </div>
      {cutBefore === null ? null : <p className={styles.start}>{recordsStart(cutBefore)}</p>}
      {/* The wrapper holds the width of the seven-column table; a bare absolute table would widen the page. */}
      <div className="visually-hidden">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">Run hours</th>
              <th scope="col">Distance</th>
              <th scope="col">Runs</th>
              <th scope="col">Strength sessions</th>
              <th scope="col">Mean of 4 weeks (hours)</th>
              <th scope="col">Race week</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.weekStart}>
                <th scope="row">{point.label}</th>
                <td>{minutesToHours1(point.week.runMin)}</td>
                <td>{formatDistance(point.week.runM, units)}</td>
                <td>{String(point.week.runSessions)}</td>
                <td>{String(point.week.strengthSessions)}</td>
                <td>{point.mean === null ? '–' : point.mean.toFixed(1)}</td>
                <td>{point.race ? 'Yes' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
