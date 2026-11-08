import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TRENDS_TEMPLATES } from '../../../shared/copy/trends.ts'
import { render } from '../../../shared/copy/template.ts'
import type { FixedSpeedPoint } from '../../../shared/domain/trendsRuns.ts'
import { formatShortDate } from '../format.ts'
import { dayNumber, dayTickLabel, rangeTicks } from './dayTicks.ts'
import styles from './EfficiencyChart.module.css'
import { axisProps, ChartTooltip, gridProps } from './theme.ts'

export interface EfficiencyChartProps {
  /** One point per window, oldest first; a gap has no heart rate. */
  points: readonly FixedSpeedPoint[]
  /** First and last day of the range, `YYYY-MM-DD`: the x axis spans them whatever the windows are. */
  from: string
  to: string
  /** The accessible name of the chart and the caption of its hidden table. */
  ariaLabel: string
}

interface Row {
  day: number
  end: string
  label: string
  bpm: number | null
  point: FixedSpeedPoint
}

/** Width of the value axis (px). */
const AXIS_WIDTH = 36
/**
 * The value axis spans at least this share of the median heart rate, so an ordinary month-to-month
 * variation reads as a flat line and not as a slope. A page default, not an engine number; no study
 * in the corpus gives the noise of this index.
 */
const MIN_SPAN_SHARE = 0.1

/** Three ticks and a domain at least `MIN_SPAN_SHARE` of the median wide, centred on the readings. */
export function bpmScale(values: readonly number[]): { domain: [number, number]; ticks: number[] } {
  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  const median = sorted[Math.floor(sorted.length / 2)]!
  const span = Math.max(max - min, median * MIN_SPAN_SHARE)
  const centre = (min + max) / 2
  const low = Math.floor(centre - span / 2)
  const high = Math.ceil(centre + span / 2)
  return { domain: [low, high], ticks: [low, Math.round((low + high) / 2), high] }
}

/** The words of a window with no point, for the tooltip and the table. */
export function gapText(point: FixedSpeedPoint): string {
  if (point.gap === null) return ''
  const id = point.gap === 'few-runs' ? 'trends.hr.gap-runs' : 'trends.hr.gap-pace'
  return render(TRENDS_TEMPLATES[id], {}, 'km')
}

/**
 * The heart rate the runner's own line gives at one speed, one neutral point per window. A window
 * with too few runs, or one that did not run the speed, has no marker and the line breaks there.
 * No band, no aim and no colour for a direction (rule T1, A11). The figures are in a visually
 * hidden table: window end, heart rate, the runs fitted and the runs that qualified.
 */
export function EfficiencyChart({ points, from, to, ariaLabel }: EfficiencyChartProps) {
  const rows: Row[] = points.map((point) => ({
    day: dayNumber(point.end),
    end: point.end,
    label: formatShortDate(point.end),
    bpm: point.bpm,
    point,
  }))
  const drawn = rows.flatMap((row) => (row.bpm === null ? [] : [row.bpm]))
  const { domain, ticks } = bpmScale(drawn.length > 0 ? drawn : [0, 1])
  const xTicks = rangeTicks(from, to)

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
            data={rows}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          >
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
            <YAxis {...axisProps} width={AXIS_WIDTH} domain={domain} ticks={ticks} />
            <Tooltip
              filterNull={false}
              content={(props) => {
                const row = (props.payload?.[0] as { payload?: Row } | undefined)?.payload
                if (row === undefined) return null
                return (
                  <ChartTooltip
                    active={props.active}
                    label={`Window ending ${row.label}`}
                    payload={[
                      {
                        name: 'Heart rate',
                        value: row.bpm === null ? gapText(row.point) : `${String(row.bpm)} bpm`,
                      },
                      { name: 'Runs', value: String(row.point.qualifying) },
                    ]}
                  />
                )
              }}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
            <Line
              dataKey="bpm"
              name="Heart rate"
              type="linear"
              stroke="var(--text)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--text)', strokeWidth: 0 }}
              activeDot={{ r: 4, fill: 'var(--text)', strokeWidth: 0 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* The wrapper holds the width of the table; a bare absolute table would widen the page. */}
      <div className="visually-hidden">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Window ending</th>
              <th scope="col">Heart rate (bpm)</th>
              <th scope="col">Runs fitted</th>
              <th scope="col">Runs in the window</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.end}>
                <th scope="row">{row.label}</th>
                <td>{row.bpm === null ? gapText(row.point) : String(row.bpm)}</td>
                <td>{row.point.fitted === null ? '' : String(row.point.fitted)}</td>
                <td>{String(row.point.qualifying)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
