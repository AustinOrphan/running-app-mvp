/**
 * One place for chart styling. Every value is a CSS variable reference, so charts follow the light
 * theme, the dark theme and the manual override with no JavaScript (visual design section 7).
 */
export const chartColors = {
  run: 'var(--chart-1)',
  strength: 'var(--chart-2)',
  cross: 'var(--chart-3)',
  race: 'var(--chart-4)',
  planned: 'var(--chart-planned)',
  actual: 'var(--chart-actual)',
  grid: 'var(--chart-grid)',
  /** The prediction track record: the predicted time, its range, and the result it is held against. */
  predicted: 'var(--chart-actual)',
  range: 'var(--accent-soft)',
  result: 'var(--chart-2)',
} as const

const tickStyle = {
  fill: 'var(--text-muted)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-xs)',
  fontVariantNumeric: 'lining-nums tabular-nums',
}

/** Spread onto `XAxis` and `YAxis`: no axis or tick lines, small muted figures. */
export const axisProps = {
  axisLine: false,
  tickLine: false,
  tickMargin: 8,
  tick: { style: tickStyle },
} as const

/** Spread onto `CartesianGrid`: horizontal 1px solid lines only. */
export const gridProps = {
  vertical: false,
  stroke: chartColors.grid,
  strokeWidth: 1,
} as const

export { ChartTooltip } from './ChartTooltip.tsx'
