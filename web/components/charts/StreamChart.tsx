import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ActivityStreamData, Units } from '../../../shared/types.ts'
import { formatDuration } from '../../../shared/units.ts'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'
import styles from './StreamChart.module.css'

export type StreamData = ActivityStreamData & { sampleSec: number }
export type StreamChannel = 'pace' | 'hr' | 'alt'

export interface StreamChartProps {
  stream: StreamData
  channel: StreamChannel
  /** Display units; defaults to miles, the app's default. */
  units?: Units
}

export interface SeriesPoint {
  /** Kilometres or miles, or minutes when the stream has no distance. */
  x: number
  /** Seconds per unit for pace, bpm for heart rate, feet or metres for elevation; null is a gap. */
  y: number | null
}

const M_PER_MILE = 1609.344
const M_PER_FOOT = 0.3048
/** Pace is read over this much running, so 10-second buckets do not make it jitter. */
const PACE_WINDOW_SEC = 60
/** Below this speed the runner is treated as standing still and pace is a gap. */
const MIN_SPEED_MS = 0.5
const MAX_PACE_MIN_PER_UNIT = 30
const MAX_TABLE_ROWS = 10

const NAMES: Record<StreamChannel, string> = {
  pace: 'Pace',
  hr: 'Heart rate',
  alt: 'Elevation',
}

function metresPerUnit(units: Units): number {
  return units === 'mi' ? M_PER_MILE : 1000
}

/** Empty buckets serialize as null even though the type says number. */
function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Distance when at least one bucket has it, otherwise time; every chart on a page shares the choice. */
export function streamXAxis(stream: StreamData): 'distance' | 'time' {
  const hasDistance = stream.d?.some((v) => (num(v) ?? 0) > 0) ?? false
  return hasDistance ? 'distance' : 'time'
}

/** Pace at bucket `i`, from the running done in the preceding window. */
function paceAt(stream: StreamData, i: number, units: Units): number | null {
  const d = stream.d
  if (d === null) return null
  const endSec = (k: number): number | null => {
    if (k < 0) return 0
    const start = num(stream.t[k])
    return start === null ? null : start + stream.sampleSec
  }
  const distanceAt = (k: number): number | null => (k < 0 ? 0 : num(d[k]))
  const back = Math.max(1, Math.round(PACE_WINDOW_SEC / stream.sampleSec))
  const from = Math.max(i - back, -1)
  const t1 = endSec(i)
  const t0 = endSec(from)
  const d1 = distanceAt(i)
  const d0 = distanceAt(from)
  if (t1 === null || t0 === null || d1 === null || d0 === null) return null
  const metres = d1 - d0
  const seconds = t1 - t0
  if (seconds <= 0 || metres / seconds < MIN_SPEED_MS) return null
  const pace = seconds / (metres / metresPerUnit(units))
  return pace > MAX_PACE_MIN_PER_UNIT * 60 ? null : pace
}

/** The points of one channel against the shared x-axis. Points without an x position are dropped. */
export function buildSeries(
  stream: StreamData,
  channel: StreamChannel,
  units: Units,
): SeriesPoint[] {
  const source = channel === 'pace' ? stream.d : stream[channel]
  if (source === null) return []
  const axis = streamXAxis(stream)
  const points: SeriesPoint[] = []
  for (let i = 0; i < stream.t.length; i++) {
    let x: number | null
    if (axis === 'distance') {
      const metres = num(stream.d?.[i])
      x = metres === null ? null : metres / metresPerUnit(units)
    } else {
      const sec = num(stream.t[i])
      x = sec === null ? null : sec / 60
    }
    if (x === null) continue
    let y: number | null
    if (channel === 'pace') y = paceAt(stream, i, units)
    else {
      const raw = num(source[i])
      y = raw === null ? null : channel === 'alt' && units === 'mi' ? raw / M_PER_FOOT : raw
    }
    points.push({ x, y })
  }
  return points
}

function valuesOf(points: SeriesPoint[]): number[] {
  return points.flatMap((p) => (p.y === null ? [] : [p.y]))
}

/** Round bounds and three ticks; pace ignores the slowest and fastest 5% so a stop does not flatten the chart. */
function yScale(
  values: number[],
  channel: StreamChannel,
): { domain: [number, number]; ticks: number[] } {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const lo = channel === 'pace' ? at(0.05) : (sorted[0] ?? 0)
  const hi = channel === 'pace' ? at(0.95) : (sorted.at(-1) ?? 0)
  const step = channel === 'pace' ? 15 : 10
  let low = Math.floor(lo / step) * step
  let high = Math.ceil(hi / step) * step
  if (high === low) high = low + step
  if (channel !== 'pace' && low < 0 && lo >= 0) low = 0
  return { domain: [low, high], ticks: [low, (low + high) / 2, high] }
}

function paceLabel(seconds: number, units: Units): string {
  return `${formatDuration(seconds)} /${units}`
}

function altUnit(units: Units): string {
  return units === 'mi' ? 'ft' : 'm'
}

function formatValue(channel: StreamChannel, units: Units, value: number): string {
  if (channel === 'pace') return paceLabel(value, units)
  if (channel === 'hr') return `${String(Math.round(value))} bpm`
  return `${String(Math.round(value))} ${altUnit(units)}`
}

function describe(channel: StreamChannel, units: Units, values: number[]): string {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (channel === 'pace') {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    return `Pace, average ${paceLabel(mean, units)}, fastest ${paceLabel(min, units)}`
  }
  if (channel === 'hr') {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    return `Heart rate, average ${String(Math.round(mean))} bpm, highest ${String(Math.round(max))} bpm`
  }
  return `Elevation, from ${formatValue('alt', units, min)} to ${formatValue('alt', units, max)}`
}

/** Up to ten evenly spaced points that have a value, for the screen-reader table. */
function sampleRows(points: SeriesPoint[]): Array<{ x: number; y: number }> {
  const valid = points.flatMap((p) => (p.y === null ? [] : [{ x: p.x, y: p.y }]))
  if (valid.length <= MAX_TABLE_ROWS) return valid
  return Array.from({ length: MAX_TABLE_ROWS }, (_, k) => {
    const index = Math.round((k * (valid.length - 1)) / (MAX_TABLE_ROWS - 1))
    return valid[index] ?? { x: 0, y: 0 }
  })
}

/**
 * One stream channel against distance (or time when the stream has no distance). Gaps stay gaps.
 * The figures are also in a visually hidden table. Renders nothing when the channel has no values.
 */
export function StreamChart({ stream, channel, units = 'mi' }: StreamChartProps) {
  const points = buildSeries(stream, channel, units)
  const values = valuesOf(points)
  if (values.length === 0) return null

  const axis = streamXAxis(stream)
  const { domain, ticks } = yScale(values, channel)
  const label = describe(channel, units, values)
  const xName = axis === 'distance' ? `distance in ${units}` : 'time in minutes'
  const rows = sampleRows(points)
  const xFormat = (x: number): string =>
    axis === 'distance' ? x.toFixed(2) : String(Math.round(x))
  const yFormat = (y: number): string =>
    channel === 'pace' ? formatDuration(y) : String(Math.round(y))
  const unitCaption =
    channel === 'pace' ? `per ${units}` : channel === 'hr' ? 'bpm' : altUnit(units)

  return (
    <figure className={styles.figure}>
      <div role="img" aria-label={label} className={styles.chart}>
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
              tickFormatter={(x: number) =>
                axis === 'distance' ? x.toFixed(1) : String(Math.round(x))
              }
            />
            <YAxis
              {...axisProps}
              width={40}
              reversed={channel === 'pace'}
              domain={domain}
              ticks={ticks}
              allowDataOverflow
              tickFormatter={yFormat}
            />
            <Tooltip
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  payload={props.payload}
                  label={`${xFormat(Number(props.label))} ${axis === 'distance' ? units : 'min'}`}
                  format={(value) => formatValue(channel, units, value)}
                />
              )}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
            {channel === 'alt' ? (
              <Area
                dataKey="y"
                name={NAMES[channel]}
                type="monotone"
                stroke={chartColors.actual}
                strokeWidth={2}
                fill="var(--accent-soft)"
                connectNulls={false}
                isAnimationActive={false}
              />
            ) : (
              <Line
                dataKey="y"
                name={NAMES[channel]}
                type="monotone"
                stroke={chartColors.actual}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className={styles.caption}>
        {`${NAMES[channel]}, ${unitCaption}, against ${xName}.`}
      </figcaption>
      <table className="visually-hidden">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{axis === 'distance' ? `Distance (${units})` : 'Time (min)'}</th>
            <th scope="col">{NAMES[channel]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <th scope="row">{xFormat(row.x)}</th>
              <td>{formatValue(channel, units, row.y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
