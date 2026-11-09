import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import {
  easyCeilingLabel,
  easyCeilingNote,
  FASTER_IS_HIGHER,
  PLANNED_PACE_LABEL,
  PLANNED_PACE_NOTE,
  STREAM_HINT,
  STREAM_PANEL_NAME,
} from '../../../shared/copy/runCharts.ts'
import type { Units } from '../../../shared/types.ts'
import { formatDuration, NO_VALUE } from '../../../shared/units.ts'
import {
  alignSeries,
  buildSeries,
  drawablePoints,
  metresPerUnit,
  nearestRowIndex,
  plannedPaceBand,
  streamXAxis,
  type AlignedRow,
  type SeriesPoint,
  type StreamChannel,
  type StreamData,
} from './streamSeries.ts'
import type { DistanceCursor } from '../map/distanceCursor.ts'
import { axisProps, chartColors, gridProps } from './theme.ts'
import styles from './StreamChart.module.css'

export interface StreamChartProps {
  stream: StreamData
  /** The channels to stack, top to bottom; defaults to pace, heart rate and elevation. */
  channels?: StreamChannel[]
  /** Display units; defaults to miles, the app's default. */
  units?: Units
  /**
   * Told the distance in metres under the cursor (pointer, finger or arrow keys), and null when it
   * goes; the run map moves its dot to it. Only a panel against distance reports: one against time
   * has no place.
   */
  cursor?: DistanceCursor
  /** The planned pace of the session this run filled, `[slow, fast]` seconds per km; drawn as a band. */
  plannedPaceSecPerKm?: readonly [number, number] | null
  /** The runner's easy heart-rate ceiling in bpm (the Z1 ceiling); heart rate above it is hatched. */
  easyCeilingBpm?: number | null
}

const MAX_TABLE_ROWS = 10
/** The readout and its announcement follow a moving pointer at most this often. */
const READOUT_THROTTLE_MS = 250
/** Plot margin right (visual design 12); the left is the y axis width. */
const MARGIN_RIGHT = 12
const X_AXIS_HEIGHT = 24
const ALL_CHANNELS: StreamChannel[] = ['pace', 'hr', 'alt']

const NAMES: Record<StreamChannel, string> = {
  pace: 'Pace',
  hr: 'Heart rate',
  alt: 'Elevation',
}

/** A value with a gap on both sides draws no line, so it gets a dot of its own. */
function lonelyDot(drawn: DrawnPoint[]) {
  return (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props
    const i = index ?? -1
    const alone = drawn[i - 1]?.y == null && drawn[i + 1]?.y == null
    return alone && cx !== undefined && cy !== undefined ? (
      <circle key={i} cx={cx} cy={cy} r={2.5} fill={chartColors.actual} />
    ) : (
      <g key={i} />
    )
  }
}

interface DrawnPoint extends SeriesPoint {
  /** The stretch of heart rate above the ceiling, `[ceiling, y]`; null where there is none. */
  over: [number, number] | null
}

function valuesOf(points: SeriesPoint[]): number[] {
  return points.flatMap((p) => (p.y === null ? [] : [p.y]))
}

/**
 * Round bounds and three ticks (the plots are small, visual design 12); pace ignores the slowest
 * and fastest 5% so a stop does not flatten the chart. `extra` are figures the plot draws that the
 * stream may not reach (the planned band, the ceiling): the bounds take them in.
 */
function yScale(
  values: number[],
  channel: StreamChannel,
  extra: number[],
): { domain: [number, number]; ticks: number[] } {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const lo = Math.min(channel === 'pace' ? at(0.05) : (sorted[0] ?? 0), ...extra)
  const hi = Math.max(channel === 'pace' ? at(0.95) : (sorted.at(-1) ?? 0), ...extra)
  const step = channel === 'pace' ? 15 : 10
  let low = Math.floor(lo / step) * step
  let high = Math.ceil(hi / step) * step
  if (high === low) high = low + step
  if (channel !== 'pace' && low < 0 && lo >= 0) low = 0
  return { domain: [low, high], ticks: [low, (low + high) / 2, high] }
}

/** Room for the widest tick label plus the tick margin, so a label such as "1180" is never clipped. */
export function yAxisWidth(labels: string[]): number {
  return 16 + 8 * Math.max(3, ...labels.map((label) => label.length))
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

function withThousands(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** The figure of one readout cell and its unit, or a dash for a channel with no value at the cursor. */
function readoutParts(
  channel: StreamChannel,
  value: number | null,
  units: Units,
): { figure: string; unit: string } {
  if (value === null) return { figure: NO_VALUE, unit: '' }
  if (channel === 'pace') return { figure: formatDuration(value), unit: `/${units}` }
  if (channel === 'hr') return { figure: String(Math.round(value)), unit: 'bpm' }
  return { figure: withThousands(value), unit: altUnit(units) }
}

interface PlotProps {
  channel: StreamChannel
  stream: StreamData
  units: Units
  axis: 'distance' | 'time'
  xMax: number
  yWidth: number
  last: boolean
  /** The x of the cursor, or null when there is none. */
  cursorX: number | null
  band: { fast: number; slow: number } | null
  ceiling: number | null
  hatchId: string
}

/** One channel's plot with its own hidden table; the panel owns the cursor and the readout. */
function Plot({
  channel,
  stream,
  units,
  axis,
  xMax,
  yWidth,
  last,
  cursorX,
  band,
  ceiling,
  hatchId,
}: PlotProps) {
  const points = buildSeries(stream, channel, units)
  const values = valuesOf(points)
  const patternId = `${hatchId}-${channel}`
  const useBand = channel === 'pace' ? band : null
  const useCeiling = channel === 'hr' ? ceiling : null
  const drawn: DrawnPoint[] = drawablePoints(points, stream.sampleSec).map((p) => ({
    ...p,
    over: useCeiling !== null && p.y !== null && p.y > useCeiling ? [useCeiling, p.y] : null,
  }))
  const anyOver = drawn.some((p) => p.over !== null)
  const extra = [
    ...(useBand === null ? [] : [useBand.fast, useBand.slow]),
    ...(useCeiling === null ? [] : [useCeiling]),
  ]
  const { domain, ticks } = yScale(values, channel, extra)
  const label = describe(channel, units, values)
  const xFormat = (x: number): string =>
    axis === 'distance' ? x.toFixed(2) : String(Math.round(x))
  const yFormat = (y: number): string =>
    channel === 'pace' ? formatDuration(y) : String(Math.round(y))
  const rows = sampleRows(points)
  const unitCaption = channel === 'pace' ? `/${units}` : channel === 'hr' ? 'bpm' : altUnit(units)
  const labelStyle = {
    fill: 'var(--text-muted)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-xs)',
  }

  return (
    <div className={styles.plot}>
      <div
        role="img"
        aria-label={label}
        data-last={last ? 'true' : undefined}
        className={styles.chart}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 96 }}
        >
          <ComposedChart data={drawn} margin={{ top: 16, right: MARGIN_RIGHT, bottom: 0, left: 0 }}>
            <defs>
              <pattern
                id={patternId}
                width="5"
                height="5"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="5" stroke={chartColors.actual} strokeWidth="1.5" />
              </pattern>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis
              {...axisProps}
              type="number"
              dataKey="x"
              domain={[0, xMax]}
              tickCount={5}
              hide={!last}
              height={X_AXIS_HEIGHT}
              tickFormatter={(x: number) =>
                axis === 'distance' ? x.toFixed(1) : String(Math.round(x))
              }
            />
            <YAxis
              {...axisProps}
              width={yWidth}
              reversed={channel === 'pace'}
              domain={domain}
              ticks={ticks}
              allowDataOverflow
              tickFormatter={yFormat}
            />
            {useBand === null ? null : (
              <ReferenceArea
                y1={useBand.fast}
                y2={useBand.slow}
                fill="var(--accent-soft)"
                stroke="var(--chart-planned)"
                strokeWidth={1}
                strokeDasharray="4 3"
                ifOverflow="hidden"
                label={{
                  value: PLANNED_PACE_LABEL,
                  position: 'insideTopRight',
                  style: labelStyle,
                }}
              />
            )}
            {useCeiling === null ? null : (
              <ReferenceLine
                y={useCeiling}
                stroke="var(--text-muted)"
                strokeWidth={1}
                strokeDasharray="4 3"
                ifOverflow="hidden"
                label={{
                  value: easyCeilingLabel(useCeiling),
                  position: 'insideTopRight',
                  style: labelStyle,
                }}
              />
            )}
            {channel === 'alt' ? (
              <Area
                dataKey="y"
                name={NAMES[channel]}
                type="monotone"
                stroke={chartColors.actual}
                strokeWidth={2}
                fill="var(--accent-soft)"
                dot={lonelyDot(drawn)}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={false}
              />
            ) : (
              <Line
                dataKey="y"
                name={NAMES[channel]}
                type="monotone"
                stroke={chartColors.actual}
                strokeWidth={2}
                dot={lonelyDot(drawn)}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={false}
              />
            )}
            {anyOver ? (
              <Area
                dataKey="over"
                type="monotone"
                stroke="none"
                fill={`url(#${patternId})`}
                connectNulls={false}
                isAnimationActive={false}
                activeDot={false}
                legendType="none"
              />
            ) : null}
            {cursorX === null ? null : (
              <ReferenceLine x={cursorX} stroke="var(--border-strong)" strokeWidth={1} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <span className={styles.plotName} style={{ left: yWidth }} aria-hidden="true">
        {`${NAMES[channel]}, ${unitCaption}`}
      </span>
      {/* The wrapper clips the table: `overflow` does not apply to a table, and a hidden table as wide
          as its no-wrap caption pushed the page 15 px sideways at 360 px. */}
      <div className="visually-hidden">
        <table>
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
      </div>
    </div>
  )
}

/** The fixed readout row: the values at the cursor, in the runner's units; a hint when there is none. */
function Readout({
  row,
  channels,
  axis,
  units,
}: {
  row: AlignedRow | null
  channels: StreamChannel[]
  axis: 'distance' | 'time'
  units: Units
}) {
  return (
    <div className={styles.readout} role="status" aria-label="Value at the cursor">
      {row === null ? (
        <span className={styles.hint} aria-hidden="true">
          {STREAM_HINT}
        </span>
      ) : (
        <>
          <span className={styles.item}>
            <span className="visually-hidden">{axis === 'distance' ? 'Distance ' : 'Time '}</span>
            <span className={styles.value}>
              {axis === 'distance' ? row.x.toFixed(2) : formatDuration(row.x * 60)}
            </span>
            {axis === 'distance' ? (
              <>
                {' '}
                <span className={styles.unit}>{units}</span>
              </>
            ) : null}
          </span>
          {channels.map((channel) => {
            const parts = readoutParts(channel, row[channel], units)
            return (
              <span key={channel} className={styles.item}>
                <span className="visually-hidden">{`${NAMES[channel]} `}</span>
                <span className={styles.value}>{parts.figure}</span>
                {parts.unit === '' ? null : (
                  <>
                    {' '}
                    <span className={styles.unit}>{parts.unit}</span>
                  </>
                )}
              </span>
            )
          })}
        </>
      )}
    </div>
  )
}

/**
 * Pace, heart rate and elevation stacked on one distance axis (time when the stream has no
 * distance), with one cursor and one readout row above them. A pointer, a finger or the arrow
 * keys move the cursor; the run map's dot follows it through `cursor`, which is outside React so
 * the map does not render. Gaps stay gaps. Each channel also has a hidden table. Renders nothing
 * when no channel has values.
 */
export function StreamChart({
  stream,
  channels = ALL_CHANNELS,
  units = 'mi',
  cursor,
  plannedPaceSecPerKm = null,
  easyCeilingBpm = null,
}: StreamChartProps) {
  const rows = useMemo(() => alignSeries(stream, units), [stream, units])
  const shownChannels = channels.filter((channel) =>
    buildSeries(stream, channel, units).some((p) => p.y !== null),
  )
  const [index, setIndex] = useState<number | null>(null)
  const [shown, setShown] = useState<number | null>(null)
  const plotsRef = useRef<HTMLDivElement>(null)
  const lastShown = useRef(0)
  const pending = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hatchId = `hatch-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  const axis = streamXAxis(stream)

  // The readout of a pointer follows at most every 250 ms (a leading update, then a trailing one);
  // keys and leaving update it at once.
  const move = (next: number | null, immediate: boolean) => {
    setIndex(next)
    const now = Date.now()
    if (immediate || next === null || now - lastShown.current >= READOUT_THROTTLE_MS) {
      clearTimeout(timer.current)
      timer.current = undefined
      lastShown.current = now
      setShown(next)
      return
    }
    pending.current = next
    timer.current ??= setTimeout(
      () => {
        timer.current = undefined
        lastShown.current = Date.now()
        setShown(pending.current)
      },
      READOUT_THROTTLE_MS - (now - lastShown.current),
    )
  }

  const cursorRow = index === null ? null : (rows[index] ?? null)
  const cursorMetres =
    cursorRow === null || axis !== 'distance' ? null : cursorRow.x * metresPerUnit(units)
  useEffect(() => {
    cursor?.set(cursorMetres)
  }, [cursor, cursorMetres])
  useEffect(
    () => () => {
      cursor?.set(null)
      clearTimeout(timer.current)
    },
    [cursor],
  )

  if (shownChannels.length === 0 || rows.length === 0) return null

  const xMax = Math.max(rows.at(-1)?.x ?? 0, Number.EPSILON)
  const band = plannedPaceBand(plannedPaceSecPerKm, units)
  const ceiling =
    easyCeilingBpm !== null && Number.isFinite(easyCeilingBpm) && easyCeilingBpm > 0
      ? easyCeilingBpm
      : null
  // One width for every plot, so the plots share an x axis to the pixel.
  const yWidth = Math.max(
    ...shownChannels.map((channel) => {
      const values = valuesOf(buildSeries(stream, channel, units))
      const extra =
        channel === 'pace' && band !== null
          ? [band.fast, band.slow]
          : channel === 'hr' && ceiling !== null
            ? [ceiling]
            : []
      const { ticks } = yScale(values, channel, extra)
      return yAxisWidth(
        ticks.map((tick) => (channel === 'pace' ? formatDuration(tick) : String(Math.round(tick)))),
      )
    }),
  )

  const indexAt = (clientX: number): number | null => {
    const box = plotsRef.current?.getBoundingClientRect()
    if (box === undefined) return null
    const width = box.width - yWidth - MARGIN_RIGHT
    if (!(width > 0)) return null
    const fraction = Math.min(1, Math.max(0, (clientX - box.left - yWidth) / width))
    const found = nearestRowIndex(rows, fraction * xMax)
    return found < 0 ? null : found
  }
  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    const next = indexAt(event.clientX)
    if (next !== null) move(next, false)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = rows.length - 1
    const step = Math.max(1, Math.round(rows.length / 100)) * (event.shiftKey ? 10 : 1)
    let next: number | null
    if (event.key === 'ArrowRight') next = Math.min(last, (index ?? -step) + step)
    else if (event.key === 'ArrowLeft') next = Math.max(0, (index ?? last + step) - step)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    else if (event.key === 'Escape') next = null
    else return
    event.preventDefault()
    move(next, true)
  }

  const xName = axis === 'distance' ? `distance in ${units}` : 'time in minutes'
  const notes = [
    shownChannels.includes('pace') ? FASTER_IS_HIGHER : null,
    band !== null && shownChannels.includes('pace') ? PLANNED_PACE_NOTE : null,
    ceiling !== null && shownChannels.includes('hr') ? easyCeilingNote(ceiling) : null,
  ].filter((note): note is string => note !== null)

  return (
    <figure className={styles.figure}>
      <div
        role="group"
        aria-label={STREAM_PANEL_NAME}
        aria-keyshortcuts="ArrowLeft ArrowRight"
        tabIndex={0}
        className={styles.panel}
        onKeyDown={onKeyDown}
        onBlur={() => {
          move(null, true)
        }}
      >
        <Readout
          row={shown === null ? null : (rows[shown] ?? null)}
          channels={shownChannels}
          axis={axis}
          units={units}
        />
        <div
          ref={plotsRef}
          className={styles.plots}
          onPointerDown={onPointer}
          onPointerMove={onPointer}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') move(null, true)
          }}
        >
          {shownChannels.map((channel, i) => (
            <Plot
              key={channel}
              channel={channel}
              stream={stream}
              units={units}
              axis={axis}
              xMax={xMax}
              yWidth={yWidth}
              last={i === shownChannels.length - 1}
              cursorX={cursorRow === null ? null : cursorRow.x}
              band={band}
              ceiling={ceiling}
              hatchId={hatchId}
            />
          ))}
        </div>
      </div>
      <figcaption className={styles.caption}>
        <span>{`Against ${xName}.`}</span>
        {notes.map((note) => (
          <span key={note}>{` ${note}`}</span>
        ))}
      </figcaption>
    </figure>
  )
}
