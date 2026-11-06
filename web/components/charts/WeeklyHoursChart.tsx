import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts'
import type { WeekRow } from '../../../shared/types.ts'
import { minutesToHours1 } from '../../../shared/units.ts'
import { formatShortDate } from '../format.ts'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'
import styles from './WeeklyHoursChart.module.css'

/** What a week's bars say beyond their height; the compact chart draws each as a shape. */
export interface WeekMark {
  /** The week of today: its outline takes the accent and a triangle sits under its bars. */
  current?: boolean
  /** The race week: a flag stands on its outline. */
  race?: boolean
  /** A week after the race: the outline is dashed and both bars are faint. */
  muted?: boolean
}

export interface WeeklyHoursChartProps {
  /** One entry per week drawn. The chart reads only the week and the minutes run. */
  weeks: Array<Pick<WeekRow, 'weekStart' | 'runMin'>>
  planned?: Array<{ weekStart: string; targetRunMin: number }>
  ariaLabel: string
  /**
   * The bars alone, for a season of 30 to 40 weeks: no axes, grid, tooltip, caption or table, and
   * one band per week across the whole width of the box (no margin, no axis), so a page can lay
   * its own columns over the bands with the same count. The page names each week itself, as the
   * hidden table does for the full chart.
   */
  compact?: boolean
  /** Width of the outlined planned bar in px. */
  plannedBarSize?: number
  /** Width of the solid actual bar in px. */
  actualBarSize?: number
  /** Marks by `weekStart`; only the compact chart draws them. */
  marks?: Readonly<Record<string, WeekMark>>
}

interface Point {
  weekStart: string
  label: string
  actual: number
  planned: number | undefined
  mark: WeekMark
}

const BAR_PLANNED = 22
const BAR_ACTUAL = 12
const COMPACT_BAR_PLANNED = 8
const COMPACT_BAR_ACTUAL = 4

/** Room above the tallest week in the compact chart, for the flag over a tall race week. */
const COMPACT_HEADROOM = 1.15
/** Space under the baseline for the current week's triangle (px). */
const COMPACT_MARGIN = { top: 4, right: 0, bottom: 9, left: 0 }
/** A week that was run shows at least this much of a solid bar (px). */
const MIN_ACTUAL_PX = 2

const PLANNED_STROKE = 1.5
const MUTED_OPACITY = 0.55

/** The flag of the race week: a pole from the bar's top and a pennant, 12 px tall. */
function RaceFlag({ x, y }: { x: number; y: number }) {
  return (
    <path
      data-mark="race"
      d={`M${String(x)} ${String(y)}V${String(y - 12)}L${String(x + 6)} ${String(y - 9)}L${String(x)} ${String(y - 6)}`}
      fill={chartColors.race}
      stroke={chartColors.race}
      strokeWidth={1.25}
      strokeLinejoin="round"
      aria-hidden="true"
    />
  )
}

/** The triangle under the current week's bars, pointing up at them. */
function CurrentTriangle({ x, baseline }: { x: number; baseline: number }) {
  return (
    <path
      data-mark="current"
      d={`M${String(x)} ${String(baseline + 3)}L${String(x + 3.5)} ${String(baseline + 8)}H${String(x - 3.5)}Z`}
      fill="var(--accent)"
      aria-hidden="true"
    />
  )
}

/** The outlined bar of the compact chart, with the week's marks. */
function PlannedShape({ x, y, width, height, payload }: BarShapeProps) {
  const { mark } = payload as Point
  const outlined = height > 0
  return (
    <g>
      {outlined ? (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="none"
          stroke={mark.current === true ? 'var(--accent)' : chartColors.planned}
          strokeWidth={PLANNED_STROKE}
          strokeDasharray={mark.muted === true ? '2 2' : undefined}
          opacity={mark.muted === true ? MUTED_OPACITY : undefined}
        />
      ) : null}
      {mark.race === true ? <RaceFlag x={x + width / 2} y={y} /> : null}
      {mark.current === true ? <CurrentTriangle x={x + width / 2} baseline={y + height} /> : null}
    </g>
  )
}

/** The solid bar of the compact chart; a week that was run never rounds down to nothing. */
function ActualShape({ x, y, width, height, payload }: BarShapeProps) {
  const point = payload as Point
  if (point.actual <= 0) return null
  const shown = Math.max(height, MIN_ACTUAL_PX)
  return (
    <rect
      x={x}
      y={y + height - shown}
      width={width}
      height={shown}
      fill={chartColors.actual}
      opacity={point.mark.muted === true ? MUTED_OPACITY : undefined}
    />
  )
}

/**
 * Run hours per week. Planned is an outlined, unfilled bar drawn behind a narrower solid actual
 * bar, so the difference survives colour blindness and greyscale. The same figures are in a
 * visually hidden table for screen readers. `compact` draws the bars alone, narrower, for a whole
 * season in a row.
 */
export function WeeklyHoursChart({
  weeks,
  planned,
  ariaLabel,
  compact = false,
  plannedBarSize = compact ? COMPACT_BAR_PLANNED : BAR_PLANNED,
  actualBarSize = compact ? COMPACT_BAR_ACTUAL : BAR_ACTUAL,
  marks,
}: WeeklyHoursChartProps) {
  const plannedByWeek = new Map((planned ?? []).map((p) => [p.weekStart, p.targetRunMin]))
  const hasPlanned = planned !== undefined && plannedByWeek.size > 0
  const points: Point[] = weeks.map((week) => {
    const target = plannedByWeek.get(week.weekStart)
    return {
      weekStart: week.weekStart,
      label: formatShortDate(week.weekStart),
      actual: week.runMin / 60,
      planned: target === undefined ? undefined : target / 60,
      mark: marks?.[week.weekStart] ?? {},
    }
  })

  const peak = Math.max(0, ...points.map((p) => Math.max(p.actual, p.planned ?? 0)))
  // An even ceiling keeps the three ticks (0, half, ceiling) on whole hours.
  const ceiling = compact
    ? Math.max(1, peak * COMPACT_HEADROOM)
    : Math.max(2, Math.ceil(peak / 2) * 2)
  const ticks = [0, ceiling / 2, ceiling]
  // The weeks are unique by their date; two weeks of a long plan can share a short label.
  const category = compact ? 'weekStart' : 'label'

  const chart = (
    <div
      role="img"
      aria-label={ariaLabel}
      data-compact={compact ? 'true' : undefined}
      className={styles.chart}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 640, height: compact ? 80 : 200 }}
      >
        <BarChart
          // the compact chart is a picture under the page's own buttons: no Tab stop of its own
          accessibilityLayer={!compact}
          data={points}
          margin={compact ? COMPACT_MARGIN : { top: 8, right: 0, bottom: 0, left: 0 }}
        >
          {compact ? null : <CartesianGrid {...gridProps} />}
          {/* Bars on different category axes are laid out independently, so the planned bar
                sits centred behind the actual one instead of beside it. */}
          <XAxis dataKey={category} {...axisProps} interval="preserveStartEnd" hide={compact} />
          <XAxis xAxisId="planned" dataKey={category} hide />
          <YAxis
            {...axisProps}
            width={28}
            domain={[0, ceiling]}
            ticks={compact ? undefined : ticks}
            hide={compact}
          />
          {compact ? null : (
            <Tooltip
              content={<ChartTooltip format={(value) => `${value.toFixed(1)} h`} />}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
          )}
          {hasPlanned ? (
            <Bar
              xAxisId="planned"
              dataKey="planned"
              name="Planned"
              fill="none"
              stroke={chartColors.planned}
              strokeWidth={PLANNED_STROKE}
              barSize={plannedBarSize}
              shape={compact ? PlannedShape : undefined}
              isAnimationActive={false}
            />
          ) : null}
          <Bar
            dataKey="actual"
            name="Actual"
            fill={chartColors.actual}
            barSize={actualBarSize}
            shape={compact ? ActualShape : undefined}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
  if (compact) return chart

  return (
    <figure className={styles.figure}>
      {chart}
      {hasPlanned ? (
        <figcaption className={styles.caption}>Solid is actual, outline is planned.</figcaption>
      ) : null}
      <table className="visually-hidden">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Run hours</th>
            {hasPlanned ? <th scope="col">Planned hours</th> : null}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => {
            const target = plannedByWeek.get(week.weekStart)
            return (
              <tr key={week.weekStart}>
                <th scope="row">{formatShortDate(week.weekStart)}</th>
                <td>{minutesToHours1(week.runMin)}</td>
                {hasPlanned ? (
                  <td>{target === undefined ? '–' : minutesToHours1(target)}</td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </figure>
  )
}
