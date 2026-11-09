import { useId } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts'
import { recordsStart, trendsText } from '../../../shared/copy/trends.ts'
import type { IntensityWeek } from '../../../shared/domain/trendsLoad.ts'
import { formatShortDate } from '../format.ts'
import styles from './LoadCharts.module.css'
import { monthStep, monthTicks, tickLabel } from './monthTicks.ts'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'

export interface IntensityChartProps {
  /** The weeks drawn, oldest first, the last of them the current week when it is in range. */
  weeks: readonly IntensityWeek[]
  /** The week the plot starts at when the range reached past the first record, or null. */
  cutBefore?: string | null
  /** The accessible name of the chart and the caption of its hidden table. */
  ariaLabel: string
}

type Part = 'below' | 'between' | 'above' | 'none'

interface Point {
  weekStart: string
  label: string
  /** Hours in each part. */
  below: number
  between: number
  above: number
  none: number
  week: IntensityWeek
}

const AXIS_WIDTH = 36
const RIGHT_ROOM = 12

/**
 * The three zones are one hue in three steps of strength, light to full; the fourth part is a
 * neutral hatch. Strength and place (bottom to top) carry the order, so the key does not rest on
 * hue alone.
 */
const FILL_OPACITY: Record<Exclude<Part, 'none'>, number> = {
  below: 0.35,
  between: 0.65,
  above: 1,
}

const LEGEND: Array<{ part: Part; label: ReturnType<typeof legendLabel> }> = [
  { part: 'below', label: legendLabel('trends.intensity.legend-1') },
  { part: 'between', label: legendLabel('trends.intensity.legend-2') },
  { part: 'above', label: legendLabel('trends.intensity.legend-3') },
  { part: 'none', label: legendLabel('trends.intensity.legend-none') },
]

function legendLabel(id: Parameters<typeof trendsText>[0]): string {
  return trendsText(id)
}

/** One stacked segment; the current week is outlined, as the other weekly bars are. */
function segmentShape(part: Part, hatch: string) {
  return function Segment({ x, y, width, height, payload }: BarShapeProps) {
    if (!(height > 0)) return null
    const current = (payload as Point).week.current
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={part === 'none' ? `url(#${hatch})` : chartColors.run}
        fillOpacity={part === 'none' ? 1 : FILL_OPACITY[part]}
        stroke={current ? 'var(--accent)' : 'none'}
        strokeWidth={current ? 1.5 : 0}
      />
    )
  }
}

const minutesText = (sec: number): string => `${String(Math.round(sec / 60))} min`

/**
 * Run time per week split by heart-rate zone, with the time that has no usable heart rate as a
 * fourth, neutral part. Stacked bars only: no line, no comparison with the plan. The figures are in
 * a visually hidden table.
 */
export function IntensityChart({ weeks, cutBefore = null, ariaLabel }: IntensityChartProps) {
  const hatch = `hatch-${useId().replace(/:/g, '')}`
  const points: Point[] = weeks.map((week) => ({
    weekStart: week.weekStart,
    label: formatShortDate(week.weekStart),
    below: week.belowSec / 3600,
    between: week.betweenSec / 3600,
    above: week.aboveSec / 3600,
    none: week.noHrSec / 3600,
    week,
  }))
  const peak = Math.max(0, ...points.map((p) => p.below + p.between + p.above + p.none))
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
            margin={{ top: 8, right: RIGHT_ROOM, bottom: 0, left: 0 }}
          >
            <defs>
              <pattern id={hatch} width="4" height="4" patternUnits="userSpaceOnUse">
                <rect width="4" height="4" fill="transparent" />
                <path
                  d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2"
                  stroke="var(--chart-planned)"
                  strokeWidth="1.5"
                />
              </pattern>
            </defs>
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
                      { name: 'Zone 1', value: minutesText(week.belowSec) },
                      { name: 'Zone 2', value: minutesText(week.betweenSec) },
                      { name: 'Zone 3', value: minutesText(week.aboveSec) },
                      { name: 'No usable heart rate', value: minutesText(week.noHrSec) },
                      { name: 'Runs', value: String(week.runs) },
                    ]}
                  />
                )
              }}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
            <Bar
              dataKey="below"
              stackId="week"
              shape={segmentShape('below', hatch)}
              isAnimationActive={false}
            />
            <Bar
              dataKey="between"
              stackId="week"
              shape={segmentShape('between', hatch)}
              isAnimationActive={false}
            />
            <Bar
              dataKey="above"
              stackId="week"
              shape={segmentShape('above', hatch)}
              isAnimationActive={false}
            />
            <Bar
              dataKey="none"
              stackId="week"
              shape={segmentShape('none', hatch)}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className={styles.legend} aria-label="Key">
        {LEGEND.map(({ part, label }) => (
          <li key={part} className={styles.legendItem}>
            <span
              className={`${styles.swatch} ${part === 'none' ? styles.neutral : ''}`}
              style={
                part === 'none'
                  ? undefined
                  : { background: chartColors.run, opacity: FILL_OPACITY[part] }
              }
              aria-hidden="true"
            />
            {label}
          </li>
        ))}
      </ul>
      {cutBefore === null ? null : <p className={styles.start}>{recordsStart(cutBefore)}</p>}
      {/* The wrapper holds the width of the table; a bare absolute table would widen the page. */}
      <div className="visually-hidden">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">Runs</th>
              <th scope="col">Runs with usable heart rate</th>
              <th scope="col">Zone 1 (min)</th>
              <th scope="col">Zone 2 (min)</th>
              <th scope="col">Zone 3 (min)</th>
              <th scope="col">No usable heart rate (min)</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.weekStart}>
                <th scope="row">{formatShortDate(week.weekStart)}</th>
                <td>{String(week.runs)}</td>
                <td>{String(week.usableRuns)}</td>
                <td>{String(Math.round(week.belowSec / 60))}</td>
                <td>{String(Math.round(week.betweenSec / 60))}</td>
                <td>{String(Math.round(week.aboveSec / 60))}</td>
                <td>{String(Math.round(week.noHrSec / 60))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
