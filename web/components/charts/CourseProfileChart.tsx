import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { RaceCourseProfileText } from '../../../shared/copy/racePlan.ts'
import type { Units } from '../../../shared/types.ts'
import { FEET_PER_METRE } from '../../../shared/units.ts'
import { yAxisWidth } from './StreamChart.tsx'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'
import styles from './CourseProfileChart.module.css'

export interface CourseProfileChartProps {
  /** The course thinned for a chart, in metres, in distance order. */
  profile: ReadonlyArray<{ distanceM: number; altM: number | null }>
  /** The checkpoints to mark, in metres from the start. */
  marks: ReadonlyArray<{ name: string; distanceM: number }>
  units: Units
  /** The chart's words; the caller makes them with `describeRaceCourseProfile`. */
  text: RaceCourseProfileText
}

const MAX_TABLE_ROWS = 10
const STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

interface Point {
  /** Kilometres or miles from the start. */
  x: number
  /** Metres or feet. */
  y: number
}

const M_PER_MILE = 1609.344

/** Bounds rounded outward to a whole step, with the bottom, middle and top as the ticks. */
export function yScale(low: number, high: number): { domain: [number, number]; ticks: number[] } {
  const step = STEPS.find((s) => s >= (high - low) / 4) ?? STEPS[STEPS.length - 1]!
  const bottom = Math.floor(low / step) * step
  let top = Math.ceil(high / step) * step
  if (top === bottom) top = bottom + step
  return { domain: [bottom, top], ticks: [bottom, Math.round((bottom + top) / 2), top] }
}

/** The altitude at a distance, read between the two nearest points; the ends clamp. */
function altitudeAt(points: readonly Point[], x: number): number {
  const first = points[0]!
  const last = points[points.length - 1]!
  if (x <= first.x) return first.y
  if (x >= last.x) return last.y
  const high = points.findIndex((p) => p.x >= x)
  const a = points[high - 1]!
  const b = points[high]!
  return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
}

function sample<T>(items: readonly T[]): T[] {
  if (items.length <= MAX_TABLE_ROWS) return [...items]
  return Array.from(
    { length: MAX_TABLE_ROWS },
    (_unused, k) => items[Math.round((k * (items.length - 1)) / (MAX_TABLE_ROWS - 1))]!,
  )
}

/**
 * The course's elevation against distance, in the charts' theme, with a dot at each checkpoint. The
 * figures are also in two visually hidden tables, the profile in up to ten steps and the checkpoints
 * with their distance and elevation. Renders nothing when the file holds no elevation.
 */
export function CourseProfileChart({ profile, marks, units, text }: CourseProfileChartProps) {
  const perUnit = units === 'mi' ? M_PER_MILE : 1000
  const height = (m: number) => (units === 'mi' ? m * FEET_PER_METRE : m)
  const points: Point[] = profile.flatMap((p) =>
    p.altM === null ? [] : [{ x: p.distanceM / perUnit, y: height(p.altM) }],
  )
  if (points.length < 2) return null

  const ys = points.map((p) => p.y)
  const { domain, ticks } = yScale(Math.min(...ys), Math.max(...ys))
  const yWidth = yAxisWidth(ticks.map((t) => String(t)))
  const dots = marks
    .map((m) => ({ name: m.name, x: m.distanceM / perUnit }))
    .filter((m) => m.x > 0 && m.x < points[points.length - 1]!.x)
    .map((m) => ({ ...m, y: altitudeAt(points, m.x) }))
    .sort((a, b) => a.x - b.x)

  return (
    <figure className={styles.figure}>
      <div role="img" aria-label={text.label} className={styles.chart}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 176 }}
        >
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis
              {...axisProps}
              type="number"
              dataKey="x"
              domain={[0, 'dataMax']}
              tickCount={6}
              tickFormatter={(x: number) => String(Math.round(x))}
            />
            <YAxis
              {...axisProps}
              width={yWidth}
              domain={domain}
              ticks={ticks}
              allowDataOverflow
              tickFormatter={(y: number) => String(y)}
            />
            <Tooltip
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  payload={props.payload}
                  label={`${Number(props.label).toFixed(1)} ${text.distanceUnit}`}
                  format={(value) => `${String(Math.round(value))} ${text.elevationUnit}`}
                />
              )}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
            <Area
              dataKey="y"
              name={text.colElevation}
              type="monotone"
              stroke={chartColors.actual}
              strokeWidth={2}
              fill="var(--accent-soft)"
              isAnimationActive={false}
            />
            {dots.map((dot) => (
              <ReferenceDot
                key={`${dot.name}-${String(dot.x)}`}
                x={dot.x}
                y={dot.y}
                r={4}
                fill="var(--surface)"
                stroke={chartColors.actual}
                strokeWidth={2}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className={styles.caption}>{text.caption}</figcaption>
      <div className="visually-hidden">
        <table>
          <caption>{text.tableProfile}</caption>
          <thead>
            <tr>
              <th scope="col">{text.colDistance}</th>
              <th scope="col">{text.colElevation}</th>
            </tr>
          </thead>
          <tbody>
            {sample(points).map((p, index) => (
              <tr key={index}>
                <th scope="row">{p.x.toFixed(1)}</th>
                <td>{String(Math.round(p.y))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {dots.length === 0 ? null : (
          <table>
            <caption>{text.tablePoints}</caption>
            <thead>
              <tr>
                <th scope="col">{text.colName}</th>
                <th scope="col">{text.colDistance}</th>
                <th scope="col">{text.colElevation}</th>
              </tr>
            </thead>
            <tbody>
              {dots.map((dot, index) => (
                <tr key={index}>
                  <th scope="row">{dot.name}</th>
                  <td>{dot.x.toFixed(1)}</td>
                  <td>{String(Math.round(dot.y))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </figure>
  )
}
