import styles from './ChartTooltip.module.css'

export interface ChartTooltipEntry {
  name?: string | number
  value?: unknown
  color?: string
}

export interface ChartTooltipProps {
  active?: boolean
  payload?: readonly ChartTooltipEntry[]
  label?: string | number
  /** Formats one value for display; defaults to the value as text. */
  format?: (value: number, name: string) => string
}

function display(entry: ChartTooltipEntry, format: ChartTooltipProps['format']): string {
  const name = entry.name === undefined ? '' : String(entry.name)
  if (typeof entry.value === 'number') {
    return format ? format(entry.value, name) : String(entry.value)
  }
  return typeof entry.value === 'string' ? entry.value : ''
}

/** Tooltip body for recharts: raised surface, serif figures, one row per series. */
export function ChartTooltip({ active, payload, label, format }: ChartTooltipProps) {
  if (active !== true || !payload || payload.length === 0) return null
  return (
    <div className={styles.tooltip}>
      {label !== undefined ? <p className={styles.label}>{label}</p> : null}
      {payload.map((entry, index) => (
        <p key={`${String(entry.name)}-${String(index)}`} className={styles.row}>
          <span
            className={styles.swatch}
            style={entry.color !== undefined ? { background: entry.color } : undefined}
            aria-hidden="true"
          />
          <span className={styles.name}>{entry.name}</span>
          <span className={styles.value}>{display(entry, format)}</span>
        </p>
      ))}
    </div>
  )
}
