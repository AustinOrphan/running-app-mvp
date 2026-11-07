import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { recordsStart } from '../../../shared/copy/trends.ts'
import { cropToFirstRecord } from '../../../shared/domain/trends.ts'
import type { TrendWeek } from '../../../shared/types.ts'
import { formatShortDate } from '../format.ts'
import { monthStep, monthTicks, tickLabel } from './monthTicks.ts'
import styles from './RecoveryChart.module.css'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'

export interface RecoveryChartProps {
  /** One entry per week drawn, oldest first. */
  weeks: readonly TrendWeek[]
  /** The first week with a night in the whole history; weeks before it are not drawn. */
  firstRecord?: string | null
  /** The unit of the readings, for the tooltip and the table: `ms`, `bpm` or `h`. */
  unit: string
  /** Decimals a mean shows in the tooltip and the table. */
  decimals: number
  /** Draws the runner's recent range as a shaded band where a week has one. */
  band: boolean
  /** The accessible name of the chart and the caption of its hidden table. */
  ariaLabel: string
}

interface Point {
  weekStart: string
  label: string
  mean: number | null
  range: [number, number] | null
  week: TrendWeek
}

/** Width of the value axis (px). */
const AXIS_WIDTH = 32
/** Share of the span added above and below the readings, so a line never sits on the frame. */
const PAD = 0.15

/** Three ticks and the domain around every reading drawn, on whole numbers where the span allows. */
export function recoveryScale(values: readonly number[]): {
  domain: [number, number]
  ticks: number[]
} {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  const low = Math.floor(min - span * PAD)
  const high = Math.ceil(max + span * PAD)
  const mid = Math.round((low + high) / 2)
  return { domain: [low, high], ticks: [low, mid, high] }
}

/**
 * A weekly reading as a line with a marker for each week, over the runner's recent range as a
 * shaded band. A week without enough nights has no marker and the line breaks there. Nothing marks
 * a week for sitting inside or outside the band (rule T1). The figures are in a visually hidden
 * table: week, mean, nights, low and high.
 */
export function RecoveryChart({
  weeks: allWeeks,
  firstRecord = null,
  unit,
  decimals,
  band,
  ariaLabel,
}: RecoveryChartProps) {
  // Weeks before the first night with a reading are not drawn; the caption says where they start.
  const { weeks, cutBefore } = cropToFirstRecord(allWeeks, firstRecord)
  const points: Point[] = weeks.map((week) => ({
    weekStart: week.weekStart,
    label: formatShortDate(week.weekStart),
    mean: week.mean,
    range: band && week.low !== null && week.high !== null ? [week.low, week.high] : null,
    week,
  }))
  const drawn = points.flatMap((p) => [...(p.mean === null ? [] : [p.mean]), ...(p.range ?? [])])
  const { domain, ticks } = recoveryScale(drawn.length > 0 ? drawn : [0, 1])
  const months = monthTicks(
    weeks.map((w) => w.weekStart),
    monthStep(weeks.length),
  )
  const show = (value: number | null) => (value === null ? '' : value.toFixed(decimals))

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
                          point.mean === null ? 'Too few nights' : `${show(point.mean)} ${unit}`,
                      },
                      { name: 'Nights', value: String(point.week.nights) },
                    ]}
                  />
                )
              }}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
            {band ? (
              <Area
                dataKey="range"
                name="Recent range"
                type="linear"
                stroke="none"
                fill={chartColors.range}
                connectNulls={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ) : null}
            <Line
              dataKey="mean"
              name="Weekly mean"
              type="linear"
              stroke="var(--text)"
              strokeWidth={2}
              dot={{ r: weeks.length > 60 ? 2 : 3, fill: 'var(--text)', strokeWidth: 0 }}
              activeDot={{ r: 4, fill: 'var(--text)', strokeWidth: 0 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {cutBefore === null ? null : <p className={styles.start}>{recordsStart(cutBefore)}</p>}
      {/* The wrapper holds the width of the table; a bare absolute table would widen the page. */}
      <div className="visually-hidden">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">{`Mean (${unit})`}</th>
              <th scope="col">Nights</th>
              <th scope="col">{`Low (${unit})`}</th>
              <th scope="col">{`High (${unit})`}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.weekStart}>
                <th scope="row">{point.label}</th>
                <td>{show(point.mean)}</td>
                <td>{String(point.week.nights)}</td>
                <td>{band ? show(point.week.low) : ''}</td>
                <td>{band ? show(point.week.high) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
