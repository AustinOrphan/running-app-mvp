import type { CSSProperties } from 'react'
import styles from './ScalePicker.module.css'

export interface ScalePickerProps {
  legend: string
  min: number
  max: number
  value: number | null
  onChange: (value: number | null) => void
  hint?: string
}

/**
 * A numbered scale such as RPE 1 to 10, pain 0 to 10 or a 1 to 5 check-in answer: one row of
 * equal buttons that share the width, so it never wraps (at 360 px the buttons are narrow but
 * stay on one line). Tapping the chosen number clears it.
 */
export function ScalePicker({ legend, min, max, value, onChange, hint }: ScalePickerProps) {
  const numbers = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const row = { '--steps': numbers.length } as CSSProperties
  return (
    <fieldset className={styles.fieldset}>
      <legend>{legend}</legend>
      <div className={styles.row} style={row}>
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
