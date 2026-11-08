import type { CSSProperties } from 'react'
import styles from './ScalePicker.module.css'

export interface ScalePickerProps {
  legend: string
  min: number
  max: number
  value: number | null
  onChange: (value: number | null) => void
  hint?: string
  /** Every scale is a touch scale now; the prop is accepted so a caller that still passes it compiles. */
  touch?: boolean
}

/** The columns of a touch scale: one row up to six steps, else two rows that differ by one at most. */
export function touchColumns(steps: number): number {
  return steps <= 6 ? steps : Math.ceil(steps / 2)
}

/**
 * A numbered scale such as RPE 1 to 10, pain 0 to 10 or a 1 to 5 check-in answer. Every button is
 * at least 44 px wide and tall and all share one width: up to six steps sit in one row, a longer
 * scale in two balanced rows (`touchColumns`: 1 to 10 as 5 and 5, 0 to 10 as 6 and 5 with the short
 * row centred). Tapping the chosen number clears it.
 */
export function ScalePicker({ legend, min, max, value, onChange, hint }: ScalePickerProps) {
  const numbers = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const row = { '--cols': touchColumns(numbers.length) } as CSSProperties
  return (
    <fieldset className={styles.fieldset}>
      <legend>{legend}</legend>
      <div className={styles.row} style={row} data-touch="true">
        {numbers.map((n) => (
          <button
            key={n}
            type="button"
            className={styles.button}
            aria-label={`${legend} ${String(n)}`}
            aria-pressed={value === n}
            onClick={() => {
              onChange(value === n ? null : n)
            }}
          >
            {n}
          </button>
        ))}
      </div>
      {hint !== undefined ? <p className={styles.hint}>{hint}</p> : null}
    </fieldset>
  )
}
