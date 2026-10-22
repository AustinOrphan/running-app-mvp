import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WeekRow } from '../../../shared/types.ts'
import { minutesToHours1 } from '../../../shared/units.ts'
import { formatShortDate } from '../format.ts'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'
import styles from './WeeklyHoursChart.module.css'

export interface WeeklyHoursChartProps {
  weeks: WeekRow[]
  planned?: Array<{ weekStart: string; targetRunMin: number }>
  ariaLabel: string
}

interface Point {
  weekStart: string
  label: string
  actual: number
  planned: number | undefined
}

const BAR_PLANNED = 22
const BAR_ACTUAL = 12

/**
 * Run hours per week. Planned is an outlined, unfilled bar drawn behind a narrower solid actual
 * bar, so the difference survives colour blindness and greyscale. The same figures are in a
 * visually hidden table for screen readers.
 */
export function WeeklyHoursChart({ weeks, planned, ariaLabel }: WeeklyHoursChartProps) {
  const plannedByWeek = new Map((planned ?? []).map((p) => [p.weekStart, p.targetRunMin]))
  const hasPlanned = planned !== undefined && plannedByWeek.size > 0
  const points: Point[] = weeks.map((week) => {
    const target = plannedByWeek.get(week.weekStart)
    return {
      weekStart: week.weekStart,
      label: formatShortDate(week.weekStart),
      actual: week.runMin / 60,
      planned: target === undefined ? undefined : target / 60,
    }
  })

  const peak = Math.max(0, ...points.map((p) => Math.max(p.actual, p.planned ?? 0)))
  // An even ceiling keeps the three ticks (0, half, ceiling) on whole hours.
  const ceiling = Math.max(2, Math.ceil(peak / 2) * 2)
  const ticks = [0, ceiling / 2, ceiling]

  return (
    <figure className={styles.figure}>
      <div role="img" aria-label={ariaLabel} className={styles.chart}>
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 200 }}
        >
          <BarChart data={points} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
            <YAxis
              yAxisId="planned"
              {...axisProps}
              width={28}
              domain={[0, ceiling]}
              ticks={ticks}
            />
            <YAxis yAxisId="actual" hide domain={[0, ceiling]} />
            <Tooltip
              content={<ChartTooltip format={(value) => `${value.toFixed(1)} h`} />}
              cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
            />
            {hasPlanned ? (
              <Bar
                yAxisId="planned"
                dataKey="planned"
                name="Planned"
                fill="none"
                stroke={chartColors.planned}
                strokeWidth={1.5}
                barSize={BAR_PLANNED}
                isAnimationActive={false}
              />
            ) : null}
            <Bar
              yAxisId="actual"
              dataKey="actual"
              name="Actual"
              fill={chartColors.actual}
              barSize={BAR_ACTUAL}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
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
