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
import { formatAirTemperature } from '../../../shared/copy/quantity.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { Units } from '../../../shared/types.ts'
import { runKey, type TrendLongRun } from '../../../shared/domain/trendsRuns.ts'
import { formatShortDate } from '../format.ts'
import { dayNumber, dayTickLabel, rangeTicks } from './dayTicks.ts'
import styles from './DurabilityChart.module.css'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'

export interface DurabilityChartProps {
  /** The runs drawn, oldest first; a hilly run is drawn as a diamond. */
  runs: readonly TrendLongRun[]
  /** The `runKey` of the runs the median is read from; they are drawn filled, the others hollow. */
  inGroup: ReadonlySet<string>
  /** The median of that group, or null when there is none; drawn as one neutral line. */
  median: number | null
  /** First and last day of the range, `YYYY-MM-DD`: the x axis spans them whatever the runs are. */
  from: string
  to: string
  /** The runner's units: the air temperature is worded in them. */
  units: Units
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
  hilly: boolean
}

/** Width of the value axis (px). */
const AXIS_WIDTH = 40
/** Radius of the dot of a run at the length where it stops growing (px). */
const MAX_RADIUS = 8

/**
 * Radius of the dot of a run: its area is proportional to its length up to the drift inference
 * limit of rule A7 (180 min), where it stops growing, so a longer run is not drawn larger.
 */
export function dotRadius(min: number): number {
  const cap = P.a7.driftInferenceLimitMin.value
  return MAX_RADIUS * Math.sqrt(Math.min(Math.max(min, 0), cap) / cap)
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

/**
 * One run: a diamond for a hilly run whose heart rate passed the checks (grade-adjusted drift, never
 * in the median), a filled dot when the median is read from the run, a ring when it is not. The
 * three differ in shape, not only in tone.
 */
function Dot({ cx, cy, payload }: DotProps) {
  if (cx === undefined || cy === undefined || payload === undefined) return null
  const r = dotRadius(payload.min)
  if (payload.hilly) {
    // The same area as the dot of that length: a diamond of area 2h^2 equals pi r^2.
    const h = r * Math.sqrt(Math.PI / 2)
    return (
      <polygon
        points={`${String(cx)},${String(cy - h)} ${String(cx + h)},${String(cy)} ${String(cx)},${String(cy + h)} ${String(cx - h)},${String(cy)}`}
        fill={chartColors.run}
        fillOpacity={0.85}
        stroke={chartColors.run}
        strokeWidth={1}
      />
    )
  }
  // The whole disc is the hit target, ring or not: a transparent fill takes the pointer, `none` would not.
  return payload.filled ? (
    <circle cx={cx} cy={cy} r={r} fill={chartColors.run} fillOpacity={0.85} />
  ) : (
    <circle
      cx={cx}
      cy={cy}
      r={r - 0.75}
      fill="transparent"
      stroke={chartColors.run}
      strokeWidth={1.5}
      pointerEvents="all"
    />
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
  units,
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
    filled: !run.hilly && inGroup.has(runKey(run)),
    hilly: run.hilly,
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
              interval={0}
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
                        value:
                          point.tempC === null
                            ? 'Not recorded'
                            : formatAirTemperature(point.tempC, units),
                      },
                      { name: 'Terrain', value: point.hilly ? 'Hilly, grade-adjusted' : 'Flat' },
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
              <th scope="col">Air temperature</th>
              <th scope="col">Terrain</th>
              <th scope="col">In the median</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={`${point.date}-${String(point.min)}-${String(point.pct)}`}>
                <th scope="row">{point.label}</th>
                <td>{String(point.pct)}</td>
                <td>{String(Math.round(point.min))}</td>
                <td>{point.tempC === null ? '' : formatAirTemperature(point.tempC, units)}</td>
                <td>{point.hilly ? 'Hilly, grade-adjusted' : 'Flat'}</td>
                <td>{point.filled ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
