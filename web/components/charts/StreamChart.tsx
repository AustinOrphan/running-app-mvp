import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
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
  HOW_TO_READ,
  howToRead,
  PINNED,
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
  overCeiling,
  plannedPaceBand,
  streamXAxis,
  xTicks,
  type AlignedRow,
  type OverPoint,
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
  /** The planned pace to draw as a band, `[slow, fast]` seconds per km (`runChartContext`). */
  plannedPaceSecPerKm?: readonly [number, number] | null
  /** The easy heart-rate ceiling in bpm; heart rate above it is hatched (`runChartContext`). */
  easyCeilingBpm?: number | null
}

const MAX_TABLE_ROWS = 10
/** The announcement of a moving pointer is made at most this often. */
const ANNOUNCE_THROTTLE_MS = 250
/** A press this long on a touch screen pins the reading. */
const LONG_PRESS_MS = 500
/** A finger that moves this far before the press is long is scrubbing, not pressing. */
const PRESS_SLOP_PX = 10
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
function lonelyDot(drawn: SeriesPoint[]) {
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

function valuesOf(points: SeriesPoint[]): number[] {
  return points.flatMap((p) => (p.y === null ? [] : [p.y]))
}

/**
 * Round bounds and three ticks (the plots are small, visual design 12); pace ignores the slowest
 * and fastest 5% so a stop does not flatten the chart. `extra` are figures the plot draws that the
 * stream may not reach (the planned band, the ceiling): the bounds take them in.
 */
export function yScale(
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
  // the middle tick is a round figure: a pace span is a whole number of 30 s
  if (channel === 'pace' && ((high - low) / step) % 2 === 1) high += step
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

/** The figure and unit of one readout cell; a dash for a channel with no value at the cursor. */
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

/** The first cell of the readout: where on the run the cursor is. */
function positionParts(
  row: AlignedRow,
  axis: 'distance' | 'time',
  units: Units,
): { figure: string; unit: string } {
  return axis === 'distance'
    ? { figure: row.x.toFixed(2), unit: units }
    : { figure: formatDuration(row.x * 60), unit: '' }
}

/** The sentence the polite status region says for a row. */
function announcement(
  row: AlignedRow,
  channels: StreamChannel[],
  axis: 'distance' | 'time',
  units: Units,
): string {
  const where = positionParts(row, axis, units)
  const parts = [
    `${axis === 'distance' ? 'Distance' : 'Time'} ${where.figure}${where.unit === '' ? '' : ` ${where.unit}`}`,
    ...channels.map((channel) => {
      const v = readoutParts(channel, row[channel], units)
      return `${NAMES[channel]} ${v.figure}${v.unit === '' ? '' : ` ${v.unit}`}`
    }),
  ]
  return parts.join(', ')
}

interface PlotProps {
  channel: StreamChannel
  stream: StreamData
  units: Units
  axis: 'distance' | 'time'
  xMax: number
  yWidth: number
  last: boolean
  band: { fast: number; slow: number } | null
  ceiling: number | null
  patternId: string
}

/**
 * One channel's plot with its own hidden table. It takes nothing that changes with the cursor and
 * is memoised, so moving the cursor draws no plot again: the crosshair is the panel's own overlay.
 */
const Plot = memo(function Plot({
  channel,
  stream,
  units,
  axis,
  xMax,
  yWidth,
  last,
  band,
  ceiling,
  patternId,
}: PlotProps) {
  const model = useMemo(() => {
    const points = buildSeries(stream, channel, units)
    const values = valuesOf(points)
    const useBand = channel === 'pace' ? band : null
    const useCeiling = channel === 'hr' ? ceiling : null
    const drawn: OverPoint[] = overCeiling(drawablePoints(points, stream.sampleSec), useCeiling)
    const extra = [
      ...(useBand === null ? [] : [useBand.fast, useBand.slow]),
      ...(useCeiling === null ? [] : [useCeiling]),
    ]
    return {
      points,
      drawn,
      useBand,
      useCeiling,
      anyOver: drawn.some((p) => p.over !== null && p.over[1] > p.over[0]),
      label: describe(channel, units, values),
      rows: sampleRows(points),
      ...yScale(values, channel, extra),
    }
  }, [stream, channel, units, band, ceiling])
  const { drawn, useBand, useCeiling, anyOver, label, rows, domain, ticks } = model
  const bottom = channel === 'pace' ? domain[1] : domain[0]
  const xFormat = (x: number): string =>
    axis === 'distance' ? x.toFixed(2) : String(Math.round(x))
  const yFormat = (y: number): string =>
    channel === 'pace' ? formatDuration(y) : String(Math.round(y))
  const unitCaption = channel === 'pace' ? `/${units}` : channel === 'hr' ? 'bpm' : altUnit(units)
  const xLabels = useMemo(() => xTicks(xMax, axis), [xMax, axis])
  const note =
    useBand !== null
      ? PLANNED_PACE_LABEL
      : useCeiling !== null
        ? easyCeilingLabel(useCeiling)
        : null

  // The bottom label sits above its gridline, inside the plot, instead of half below it.
  const renderYTick = (props: {
    x?: number | string
    y?: number | string
    payload?: { value: number | string }
  }) => {
    const value = Number(props.payload?.value)
    if (props.x === undefined || props.y === undefined || !Number.isFinite(value)) return <g />
    return (
      <text
        x={props.x}
        y={props.y}
        dy={value === bottom ? -3 : 4}
        textAnchor="end"
        style={axisProps.tick.style}
      >
        {yFormat(value)}
      </text>
    )
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
              ticks={xLabels}
              interval={0}
              minTickGap={0}
              hide={!last}
              height={X_AXIS_HEIGHT}
              tickFormatter={(x: number) =>
                axis === 'distance' ? String(Number(x.toFixed(2))) : String(Math.round(x))
              }
            />
            <YAxis
              {...axisProps}
              width={yWidth}
              reversed={channel === 'pace'}
              domain={domain}
              ticks={ticks}
              interval={0}
              minTickGap={0}
              allowDataOverflow
              tick={renderYTick}
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
              />
            )}
            {useCeiling === null ? null : (
              <ReferenceLine
                y={useCeiling}
                stroke="var(--text-muted)"
                strokeWidth={1}
                strokeDasharray="4 3"
                ifOverflow="hidden"
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
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <span className={styles.plotName} style={{ left: yWidth }} aria-hidden="true">
        {`${NAMES[channel]}, ${unitCaption}`}
      </span>
      {note === null ? null : (
        <span className={styles.plotNote} style={{ right: MARGIN_RIGHT }} aria-hidden="true">
          {note}
        </span>
      )}
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
})

/**
 * Pace, heart rate and elevation stacked on one distance axis (time when the stream has no
 * distance), with one crosshair and one readout row above them. A pointer, a finger or the arrow
 * keys move the cursor. Nothing here is React state: the crosshair, the readout and the run map's
 * dot (through `cursor`) are written to the DOM directly, so a moving pointer renders no plot and
 * no parent. Only the polite status line is throttled. A press of half a second on a touch screen
 * pins the reading; a tap elsewhere or Escape releases it. Gaps stay gaps; each channel also has a
 * hidden table. Renders nothing when no channel has values.
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
  const shownChannels = useMemo(
    () =>
      channels.filter((channel) => buildSeries(stream, channel, units).some((p) => p.y !== null)),
    [channels, stream, units],
  )
  const axis = streamXAxis(stream)
  const xMax = Math.max(rows.at(-1)?.x ?? 0, Number.EPSILON)
  // keyed on the figures: the caller may hand over a fresh array with the same pace on every render
  const slowPace = plannedPaceSecPerKm?.[0]
  const fastPace = plannedPaceSecPerKm?.[1]
  const band = useMemo(
    () =>
      plannedPaceBand(
        slowPace !== undefined && fastPace !== undefined ? [slowPace, fastPace] : null,
        units,
      ),
    [slowPace, fastPace, units],
  )
  const ceiling =
    easyCeilingBpm !== null && Number.isFinite(easyCeilingBpm) && easyCeilingBpm > 0
      ? easyCeilingBpm
      : null
  // One width for every plot, so the plots share an x axis to the pixel.
  const yWidth = useMemo(
    () =>
      Math.max(
        ...shownChannels.map((channel) => {
          const extra =
            channel === 'pace' && band !== null
              ? [band.fast, band.slow]
              : channel === 'hr' && ceiling !== null
                ? [ceiling]
                : []
          const { ticks } = yScale(valuesOf(buildSeries(stream, channel, units)), channel, extra)
          return yAxisWidth(
            ticks.map((tick) =>
              channel === 'pace' ? formatDuration(tick) : String(Math.round(tick)),
            ),
          )
        }),
      ),
    [shownChannels, stream, units, band, ceiling],
  )
  const hatchId = `hatch-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`

  const plotsRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const readoutRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const indexRef = useRef<number | null>(null)
  const pinnedRef = useRef(false)
  const pressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(
    null,
  )
  const announced = useRef({
    at: 0,
    text: '',
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  })

  /** The polite status line: leading and trailing at most every 250 ms; `now` skips the wait. */
  const announce = (text: string, now: boolean) => {
    const state = announced.current
    state.text = text
    const write = () => {
      state.timer = undefined
      state.at = Date.now()
      if (statusRef.current !== null) statusRef.current.textContent = state.text
    }
    const wait = ANNOUNCE_THROTTLE_MS - (Date.now() - state.at)
    if (now || text === '' || wait <= 0) {
      clearTimeout(state.timer)
      write()
    } else state.timer ??= setTimeout(write, wait)
  }

  /** Moves the cursor to a row (or removes it): the crosshair, the readout and the map's dot. */
  const paint = (index: number | null, now: boolean) => {
    const row = index === null ? null : (rows[index] ?? null)
    indexRef.current = row === null ? null : index
    const line = lineRef.current
    if (line !== null) {
      line.hidden = row === null
      if (row !== null) line.style.left = `${String((row.x / xMax) * 100)}%`
    }
    const readout = readoutRef.current
    if (readout !== null) {
      readout.dataset.pinned = pinnedRef.current && row !== null ? 'true' : 'false'
      readout.querySelector<HTMLElement>('[data-hint]')?.toggleAttribute('hidden', row !== null)
      readout.querySelector<HTMLElement>('[data-cells]')?.toggleAttribute('hidden', row === null)
      if (row !== null) {
        const write = (cell: string, figure: string, unit: string) => {
          const box = readout.querySelector(`[data-cell="${cell}"]`)
          const f = box?.querySelector('[data-f]')
          const u = box?.querySelector('[data-u]')
          if (f) f.textContent = figure
          if (u) u.textContent = unit
        }
        const where = positionParts(row, axis, units)
        write('x', where.figure, where.unit)
        for (const channel of shownChannels) {
          const v = readoutParts(channel, row[channel], units)
          write(channel, v.figure, v.unit)
        }
      }
    }
    cursor?.set(row === null || axis !== 'distance' ? null : row.x * metresPerUnit(units))
    const said = row === null ? '' : announcement(row, shownChannels, axis, units)
    announce(pinnedRef.current && said !== '' ? `${PINNED} ${said}` : said, now)
  }

  useEffect(
    () => () => {
      cursor?.set(null)
      clearTimeout(announced.current.timer)
      clearTimeout(pressRef.current?.timer)
    },
    [cursor],
  )

  if (shownChannels.length === 0 || rows.length === 0) return null

  const indexAt = (clientX: number): number | null => {
    const box = plotsRef.current?.getBoundingClientRect()
    if (box === undefined) return null
    const width = box.width - yWidth - MARGIN_RIGHT
    if (!(width > 0)) return null
    const fraction = Math.min(1, Math.max(0, (clientX - box.left - yWidth) / width))
    const found = nearestRowIndex(rows, fraction * xMax)
    return found < 0 ? null : found
  }
  const release = () => {
    pinnedRef.current = false
    if (readoutRef.current !== null) readoutRef.current.dataset.pinned = 'false'
  }
  const endPress = () => {
    clearTimeout(pressRef.current?.timer)
    pressRef.current = null
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    endPress()
    release()
    const next = indexAt(event.clientX)
    if (next !== null) paint(next, true)
    if (event.pointerType === 'mouse') return
    pressRef.current = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        pressRef.current = null
        if (indexRef.current === null) return
        pinnedRef.current = true
        paint(indexRef.current, true)
      }, LONG_PRESS_MS),
    }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    if (
      press !== null &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS_SLOP_PX
    ) {
      endPress()
    }
    if (pinnedRef.current) return
    const next = indexAt(event.clientX)
    if (next !== null) paint(next, false)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return
    const index = indexRef.current
    const last = rows.length - 1
    const step = Math.max(1, Math.round(rows.length / 100)) * (event.shiftKey ? 10 : 1)
    let next: number | null
    if (event.key === 'ArrowRight') next = Math.min(last, (index ?? -step) + step)
    else if (event.key === 'ArrowLeft') next = Math.max(0, (index ?? last + step) - step)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    else if (event.key === 'Escape') {
      if (index === null && !pinnedRef.current) return
      next = null
    } else return
    event.preventDefault()
    if (next === null) release()
    paint(next, true)
  }

  const xName = axis === 'distance' ? `distance in ${units}` : 'time in minutes'
  const notes = [
    shownChannels.includes('pace') ? FASTER_IS_HIGHER : null,
    band !== null && shownChannels.includes('pace') ? PLANNED_PACE_NOTE : null,
    ceiling !== null && shownChannels.includes('hr') ? easyCeilingNote(ceiling) : null,
  ].filter((note): note is string => note !== null)
  const cells: Array<{ key: string; hidden?: boolean }> = [
    { key: 'x' },
    ...shownChannels.map((channel) => ({ key: channel })),
  ]

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
          if (!pinnedRef.current) paint(null, true)
        }}
      >
        {/* The visible readout is written to directly on every move; the status line beside it is
            what a screen reader hears, and only that is throttled. */}
        <div ref={readoutRef} className={styles.readout} data-pinned="false" aria-hidden="true">
          <span className={styles.hint} data-hint>
            {STREAM_HINT}
          </span>
          <span className={styles.cells} data-cells hidden>
            {cells.map((cell) => (
              <span key={cell.key} className={styles.item} data-cell={cell.key}>
                <span className={styles.value} data-f />
                <span className={styles.unit} data-u />
              </span>
            ))}
          </span>
        </div>
        <div
          ref={statusRef}
          role="status"
          aria-label="Value at the cursor"
          className="visually-hidden"
        />
        <div
          ref={plotsRef}
          className={styles.plots}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onPointerLeave={(event) => {
            endPress()
            // a finger lifting leaves the reading where it was; a mouse leaving takes it away
            if (
              event.pointerType !== 'touch' &&
              event.pointerType !== 'pen' &&
              !pinnedRef.current
            ) {
              paint(null, true)
            }
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
              band={band}
              ceiling={ceiling}
              patternId={`${hatchId}-${channel}`}
            />
          ))}
          <div
            className={styles.crossWrap}
            style={{ left: yWidth, right: MARGIN_RIGHT }}
            aria-hidden="true"
          >
            <div ref={lineRef} className={styles.cross} hidden />
          </div>
        </div>
      </div>
      <figcaption className={styles.caption}>
        {notes.length === 0 ? null : <p className={styles.notes}>{notes.join(' ')}</p>}
        <details className={styles.how}>
          <summary>{HOW_TO_READ}</summary>
          <p>{howToRead(xName)}</p>
        </details>
      </figcaption>
    </figure>
  )
}
