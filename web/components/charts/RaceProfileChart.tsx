import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import {
  clockText,
  describeRaceProfile,
  describeRaceProfileCutoff,
  describeRaceProfileReadout,
} from '../../../shared/copy/racePlan.ts'
import { MIN_SPAN_M } from '../../../shared/domain/courseSilhouette.ts'
import { placeLabels, textWidth } from '../../../shared/domain/labelLayout.ts'
import type { ProfileStop, RaceProfile } from '../../../shared/domain/raceProfile.ts'
import type { Units } from '../../../shared/types.ts'
import { FEET_PER_METRE } from '../../../shared/units.ts'
import { yScale } from './CourseProfileChart.tsx'
import { yAxisWidth } from './StreamChart.tsx'
import { axisProps, chartColors, gridProps } from './theme.ts'
import styles from './RaceProfileChart.module.css'

export interface RaceProfileChartProps {
  /** What the race plan and the course give: the curve, the stops, the dark band, the ticks. */
  profile: RaceProfile
  units: Units
}

const M_PER_MILE = 1609.344
const MARGIN = { top: 8, right: 12, bottom: 0, left: 0 }
const FALLBACK_FONT_PX = 13
const LABEL_NAME_MAX = 14
const LABEL_ROWS = 2
const STATUS_THROTTLE_MS = 250

interface Known {
  name: string
  distanceM: number
  relM: number
  stop: ProfileStop | null
}

/** The shortened name a label shows; the whole name is in the readout and the hidden table. */
function shortName(name: string): string {
  return name.length <= LABEL_NAME_MAX ? name : `${name.slice(0, LABEL_NAME_MAX - 1)}…`
}

/** A small diamond, for a cutoff: shape before colour. */
function Diamond({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx === undefined || cy === undefined) return null
  const r = 5
  return (
    <path
      d={`M${String(cx)} ${String(cy - r)}L${String(cx + r)} ${String(cy)}L${String(cx)} ${String(cy + r)}L${String(cx - r)} ${String(cy)}Z`}
      fill="var(--surface)"
      stroke={chartColors.actual}
      strokeWidth={2}
    />
  )
}

/**
 * The goal course as the lead picture of the Race page: net height against distance, from the
 * course points the runner entered (a smooth line between known points, no finer shape), with a
 * line and a name at each point, the dark hours as a band, the cutoffs as diamonds with their time
 * of day, and an hourly tick for fuel. Each mark is drawn only when its data exists
 * (`raceProfileFor`). Names are thinned so that none covers another (`placeLabels`); the full list
 * is in a hidden table. A fixed readout row above reads the nearest known point, by pointer, touch
 * or arrow keys.
 */
export function RaceProfileChart({ profile, units }: RaceProfileChartProps) {
  const perUnit = units === 'mi' ? M_PER_MILE : 1000
  const height = (m: number) => (units === 'mi' ? m * FEET_PER_METRE : m)
  const { totalM, points, stops, dark, fuelTicks } = profile

  const text = useMemo(() => {
    const levels = points.map((p) => p.relM)
    return describeRaceProfile(
      {
        lowM: Math.min(...levels),
        highM: Math.max(...levels),
        totalM,
        hasDark: dark.length > 0,
        hasFuel: fuelTicks.length > 0,
        hasCutoff: stops.some((s) => s.cutoffSec !== null),
      },
      units,
    )
  }, [points, totalM, dark, fuelTicks, stops, units])

  const known: Known[] = useMemo(
    () =>
      points.map((point, index) => {
        const last = index === points.length - 1
        const stop =
          index === 0 || last ? null : (stops.find((s) => s.distanceM === point.distanceM) ?? null)
        const name = index === 0 ? text.start : last ? text.finish : (stop?.name ?? String(index))
        return { name, distanceM: point.distanceM, relM: point.relM, stop }
      }),
    [points, stops, text],
  )

  const data = useMemo(
    () => points.map((p) => ({ x: p.distanceM / perUnit, y: height(p.relM) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, perUnit, units],
  )
  const { domain, ticks } = useMemo(() => {
    const levels = points.map((p) => p.relM)
    const low = Math.min(...levels)
    const high = Math.max(...levels)
    const span = Math.max(high - low, MIN_SPAN_M)
    const mid = (low + high) / 2
    return yScale(height(mid - span / 2), height(mid + span / 2))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, units])
  const yWidth = yAxisWidth(ticks.map((t) => String(t)))
  const totalX = totalM / perUnit
  const tickLength = (domain[1] - domain[0]) * 0.05

  // The plot's width, measured by the container, and the label font, read from the strip.
  const [width, setWidth] = useState(640)
  const stripRef = useRef<HTMLDivElement>(null)
  const [fontPx, setFontPx] = useState(FALLBACK_FONT_PX)
  useEffect(() => {
    const el = stripRef.current
    if (el === null) return
    const size = parseFloat(getComputedStyle(el).fontSize)
    if (Number.isFinite(size) && size > 0) setFontPx(size)
  }, [width])
  const plotWidth = Math.max(0, width - yWidth - MARGIN.left - MARGIN.right)

  const labels = useMemo(() => {
    const specs = stops.map((stop) => {
      const clock = stop.cutoffClock === null ? null : clockText(stop.cutoffClock)
      const name = shortName(stop.name)
      return {
        stop,
        name,
        clock,
        x: (stop.distanceM / totalM) * plotWidth,
        width: Math.max(textWidth(name, fontPx), clock === null ? 0 : textWidth(clock, fontPx)),
      }
    })
    const placed = placeLabels(specs, plotWidth, { rows: LABEL_ROWS, gap: 6 })
    return placed.map((p) => ({ ...p, ...specs[p.index]! }))
  }, [stops, totalM, plotWidth, fontPx])
  const lineH = Math.ceil(fontPx * 1.25)
  const withClock = labels.some((l) => l.clock !== null)
  const rowH = lineH * (withClock ? 2 : 1) + 2
  const rowsUsed = labels.reduce((n, l) => Math.max(n, l.row + 1), 0)

  // The reading: the nearest known point, by pointer or arrow key.
  const [active, setActive] = useState<number | null>(null)
  const readout = useMemo(() => {
    if (active === null) return null
    const k = known[active]!
    const next = known[active + 1]
    return describeRaceProfileReadout(
      {
        name: k.name,
        distanceM: k.distanceM,
        relM: k.relM,
        cutoff: k.stop,
        next:
          next === undefined
            ? null
            : {
                name: active + 1 === known.length - 1 ? null : next.name,
                toGoM: next.distanceM - k.distanceM,
              },
      },
      units,
    )
  }, [active, known, units])
  // What a screen reader hears is throttled; the visible row is not.
  const [status, setStatus] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus(readout ?? '')
    }, STATUS_THROTTLE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [readout])

  const groupRef = useRef<HTMLDivElement>(null)
  const nearest = (clientX: number): number | null => {
    const box = groupRef.current?.getBoundingClientRect()
    if (box === undefined || plotWidth <= 0) return null
    const m = ((clientX - box.left - yWidth - MARGIN.left) / plotWidth) * totalM
    let best = 0
    known.forEach((k, i) => {
      if (Math.abs(k.distanceM - m) < Math.abs(known[best]!.distanceM - m)) best = i
    })
    return best
  }
  const onPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const next = nearest(event.clientX)
    if (next !== null) setActive(next)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return
    const last = known.length - 1
    if (event.key === 'ArrowRight') setActive(Math.min(last, (active ?? -1) + 1))
    else if (event.key === 'ArrowLeft') setActive(Math.max(0, (active ?? last + 1) - 1))
    else if (event.key === 'Home') setActive(0)
    else if (event.key === 'End') setActive(last)
    else if (event.key === 'Escape') setActive(null)
    else return
    event.preventDefault()
  }
  const activePoint = active === null ? null : known[active]!

  return (
    <figure className={styles.figure}>
      <div className={styles.readout} aria-hidden="true">
        {readout === null ? <span className={styles.hint}>{text.hint}</span> : readout}
      </div>
      <div role="status" className="visually-hidden">
        {status}
      </div>
      <div
        ref={groupRef}
        role="group"
        aria-label={text.readoutName}
        aria-keyshortcuts="ArrowLeft ArrowRight"
        tabIndex={0}
        className={styles.group}
        onKeyDown={onKeyDown}
        onPointerDown={onPointer}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse' || event.buttons > 0) onPointer(event)
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setActive(null)
        }}
        onBlur={() => {
          setActive(null)
        }}
      >
        <div
          ref={stripRef}
          className={styles.strip}
          style={{ height: rowsUsed * rowH, marginLeft: yWidth + MARGIN.left }}
          aria-hidden="true"
        >
          {labels.map((label) => (
            <span
              key={label.stop.distanceM}
              className={styles.label}
              style={{ left: label.left, top: label.row * rowH, lineHeight: `${String(lineH)}px` }}
            >
              {label.name}
              {label.clock === null ? null : <span className={styles.clock}>{label.clock}</span>}
            </span>
          ))}
        </div>
        <div role="img" aria-label={text.label} className={styles.chart}>
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 640, height: 224 }}
            onResize={(w) => {
              setWidth(w)
            }}
          >
            <ComposedChart data={data} margin={MARGIN}>
              <CartesianGrid {...gridProps} />
              <XAxis
                {...axisProps}
                type="number"
                dataKey="x"
                domain={[0, totalX]}
                tickCount={6}
                allowDecimals={false}
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
              {dark.map((band) => (
                <ReferenceArea
                  key={`${String(band.fromM)}-${String(band.toM)}`}
                  x1={band.fromM / perUnit}
                  x2={band.toM / perUnit}
                  y1={domain[0]}
                  y2={domain[1]}
                  fill="var(--text-muted)"
                  fillOpacity={band.firm ? 0.2 : 0.09}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  strokeOpacity={band.firm ? 1 : 0.5}
                />
              ))}
              <Area
                dataKey="y"
                type="monotone"
                stroke={chartColors.actual}
                strokeWidth={2}
                fill="var(--accent-soft)"
                baseValue={domain[0]}
                isAnimationActive={false}
              />
              {stops.map((stop) => (
                <ReferenceLine
                  key={`stop-${String(stop.distanceM)}`}
                  x={stop.distanceM / perUnit}
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
              ))}
              {fuelTicks.map((m) => (
                <ReferenceLine
                  key={`fuel-${String(m)}`}
                  segment={[
                    { x: m / perUnit, y: domain[0] },
                    { x: m / perUnit, y: domain[0] + tickLength },
                  ]}
                  stroke="var(--text-muted)"
                  strokeWidth={1.5}
                />
              ))}
              {known.flatMap((k) =>
                k.stop !== null && k.stop.cutoffSec !== null
                  ? [
                      <ReferenceDot
                        key={`cutoff-${String(k.distanceM)}`}
                        x={k.distanceM / perUnit}
                        y={height(k.relM)}
                        shape={<Diamond />}
                      />,
                    ]
                  : [],
              )}
              {activePoint === null ? null : (
                <ReferenceLine
                  x={activePoint.distanceM / perUnit}
                  stroke="var(--text)"
                  strokeWidth={1}
                />
              )}
              {activePoint === null ? null : (
                <ReferenceDot
                  x={activePoint.distanceM / perUnit}
                  y={height(activePoint.relM)}
                  r={4}
                  fill={chartColors.actual}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <figcaption className={styles.caption}>
        {text.caption.map((line) => (
          <span key={line} className={styles.line}>
            {line}
          </span>
        ))}
      </figcaption>
      <div className="visually-hidden">
        <table>
          <caption>{text.tableStops}</caption>
          <thead>
            <tr>
              <th scope="col">{text.colName}</th>
              <th scope="col">{text.colDistance}</th>
              <th scope="col">{text.colHeight}</th>
              <th scope="col">{text.colCutoff}</th>
            </tr>
          </thead>
          <tbody>
            {known.map((k) => (
              <tr key={k.distanceM}>
                <th scope="row">{k.name}</th>
                <td>{(k.distanceM / perUnit).toFixed(1)}</td>
                <td>{String(Math.round(height(k.relM)))}</td>
                <td>{k.stop === null ? '' : (describeRaceProfileCutoff(k.stop, units) ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {dark.length === 0 ? null : (
          <table>
            <caption>{text.tableDark}</caption>
            <thead>
              <tr>
                <th scope="col">{text.colFrom}</th>
                <th scope="col">{text.colTo}</th>
                <th scope="col">{text.colDark}</th>
              </tr>
            </thead>
            <tbody>
              {dark.map((band) => (
                <tr key={band.fromM}>
                  <th scope="row">{(band.fromM / perUnit).toFixed(1)}</th>
                  <td>{(band.toM / perUnit).toFixed(1)}</td>
                  <td>{band.firm ? text.darkFirm : text.darkPossible}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {fuelTicks.length === 0 ? null : (
          <table>
            <caption>{text.tableFuel}</caption>
            <thead>
              <tr>
                <th scope="col">{text.colHour}</th>
                <th scope="col">{text.colDistance}</th>
              </tr>
            </thead>
            <tbody>
              {fuelTicks.map((m, index) => (
                <tr key={m}>
                  <th scope="row">{String(index + 1)}</th>
                  <td>{(m / perUnit).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </figure>
  )
}
