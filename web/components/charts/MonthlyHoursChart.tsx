import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import styles from './MonthlyHoursChart.module.css'
import { axisProps, chartColors, ChartTooltip, gridProps } from './theme.ts'

export interface MonthlyHoursChartProps {
  /** One bar per month, oldest first: the axis label and the run hours. */
  points: Array<{ label: string; hours: number }>
  ariaLabel: string
}

/** Run hours per month as bars. The figures are in the table under it on the Stats page. */
export function MonthlyHoursChart({ points, ariaLabel }: MonthlyHoursChartProps) {
  const ceiling = Math.max(2, Math.ceil(Math.max(0, ...points.map((p) => p.hours)) / 2) * 2)
  return (
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
            {...axisProps}
            width={28}
            domain={[0, ceiling]}
            ticks={[0, ceiling / 2, ceiling]}
          />
          <Tooltip
            content={<ChartTooltip format={(value) => `${value.toFixed(1)} h`} />}
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, fill: 'none' }}
          />
          <Bar
            dataKey="hours"
            name="Run hours"
            fill={chartColors.run}
            barSize={16}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
