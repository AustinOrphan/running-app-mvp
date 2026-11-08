import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { runKey, type TrendLongRun } from '../../../shared/domain/trendsRuns.ts'
import { formatShortDate } from '../format.ts'
import { dayNumber, dayTickLabel, rangeTicks } from './dayTicks.ts'
import styles from './DurabilityChart.module.css'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'

export interface DurabilityChartProps {
  /** The runs drawn, oldest first. */
  runs: readonly TrendLongRun[]
  /** The `runKey` of the runs the median is read from; they are drawn filled, the others hollow. */
  inGroup: ReadonlySet<string>
  /** The median of that group, or null when there is none; drawn as one neutral line. */
  median: number | null
  /** First and last day of the range, `YYYY-MM-DD`: the x axis spans them whatever the runs are. */
  from: string
  to: string
  /** The accessible name of the chart and the caption of its hidden table. */
  ariaLabel: string
}

interface Point {
  day: number
  date: string
  label: string
  pct: number
  min: number
  tempC: number | null
  filled: boolean
}

/** Width of the value axis (px). */
const AXIS_WIDTH = 40
/** Radius of the smallest and the largest dot (px); the area follows the run's length. */
const MIN_RADIUS = 3.5
const MAX_RADIUS = 8
/** Lengths (minutes) the dot sizes span; a longer or shorter run takes the end size. */
const SIZE_FROM_MIN = 40
const SIZE_TO_MIN = 180

/** Radius of the dot of a run: the area, not the radius, grows with its length. */
export function dotRadius(min: number): number {
  const t = Math.min(1, Math.max(0, (min - SIZE_FROM_MIN) / (SIZE_TO_MIN - SIZE_FROM_MIN)))
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(t)
}

/**
 * Whole-percent ticks around every figure drawn, with zero always inside the axis: the drift is
 * measured from zero (no change between the halves), so the grid shows where zero is. The ticks
 * are plain grid lines; none is an aim.
 */
export function driftScale(values: readonly number[]): {
  domain: [number, number]
  ticks: number[]
} {
  const low = Math.min(0, Math.floor(Math.min(...values)) - 1)
  const high = Math.max(0, Math.ceil(Math.max(...values)) + 1)
  const step = Math.max(1, Math.ceil((high - low) / 4))
  const first = Math.ceil(low / step) * step
  const ticks: number[] = []
  for (let tick = first; tick <= high; tick += step) ticks.push(tick)
  return { domain: [low, high], ticks }
}

interface DotProps {
  cx?: number
  cy?: number
  payload?: Point
}

/** One run: a filled dot when the median is read from it, a ring when it is not. */
function Dot({ cx, cy, payload }: DotProps) {
  if (cx === undefined || cy === undefined || payload === undefined) return null
  const r = dotRadius(payload.min)
  return payload.filled ? (
    <circle cx={cx} cy={cy} r={r} fill={chartColors.run} fillOpacity={0.85} />
  ) : (
    <circle cx={cx} cy={cy} r={r - 0.75} fill="none" stroke={chartColors.run} strokeWidth={1.5} />
  )
}

/**
 * The stored drift of each flat long run as a dot: date across, drift up, the dot's area by the
 * run's length. Filled dots are the runs the median is read from, rings are the others, so the
 * difference is a shape and not only a tone. One neutral line marks that median. There is no band,
 * no aim and no colour for a value (rule T1). The figures are in a visually hidden table.
 */
export function DurabilityChart({
  runs,
  inGroup,
  median,
  from,
  to,
  ariaLabel,
}: DurabilityChartProps) {
  const points: Point[] = runs.map((run) => ({
    day: dayNumber(run.date),
    date: run.date,
    label: formatShortDate(run.date),
    pct: run.decouplingPct,
    min: run.durationSec / 60,
    tempC: run.tempC,
    filled: inGroup.has(runKey(run)),
  }))
  const { domain, ticks } = driftScale([
    ...points.map((p) => p.pct),
    ...(median === null ? [] : [median]),
  ])
  const xTicks = rangeTicks(from, to)
  const lengthText = (min: number) => `${String(Math.round(min))} min`

  return (
    <figure className={styles.figure}>
      <div role="img" aria-label={ariaLabel} className={styles.chart}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 176 }}
        >
          <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis
              {...axisProps}
              type="number"
              dataKey="day"
              domain={[dayNumber(from), dayNumber(to)]}
              ticks={xTicks}
              interval={0}
              tickFormatter={dayTickLabel}
              allowDataOverflow
            />
            <YAxis
              {...axisProps}
              type="number"
              dataKey="pct"
              width={AXIS_WIDTH}
              domain={domain}
              ticks={ticks}
              tickFormatter={(value: number) => `${String(value)}%`}
            />
            <Tooltip
              content={(props) => {
                const point = (props.payload?.[0] as { payload?: Point } | undefined)?.payload
                if (point === undefined) return null
                return (
                  <ChartTooltip
                    active={props.active}
                    label={point.label}
                    payload={[
                      { name: 'Drift', value: `${String(point.pct)}%` },
                      { name: 'Length', value: lengthText(point.min) },
                      {
                        name: 'Air',
                        value: point.tempC === null ? 'Not recorded' : `${String(point.tempC)} °C`,
                      },
                      { name: 'In the median', value: point.filled ? 'Yes' : 'No' },
                    ]}
                  />
                )
              }}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, strokeDasharray: '3 3' }}
            />
            {median === null ? null : (
              <ReferenceLine
                y={median}
                stroke="var(--text-muted)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                ifOverflow="visible"
              />
            )}
            <Scatter
              data={points}
              shape={(props: DotProps) => <Dot {...props} />}
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {/* The wrapper holds the width of the table; a bare absolute table would widen the page. */}
      <div className="visually-hidden">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Run on</th>
              <th scope="col">Drift (%)</th>
              <th scope="col">Length (min)</th>
              <th scope="col">Air (°C)</th>
              <th scope="col">In the median</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={`${point.date}-${String(point.min)}-${String(point.pct)}`}>
                <th scope="row">{point.label}</th>
                <td>{String(point.pct)}</td>
                <td>{String(Math.round(point.min))}</td>
                <td>{point.tempC === null ? '' : String(point.tempC)}</td>
                <td>{point.filled ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
