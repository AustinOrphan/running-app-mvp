import type { CSSProperties } from 'react'
import styles from './ScalePicker.module.css'

export interface ScalePickerProps {
  legend: string
  min: number
  max: number
  value: number | null
  onChange: (value: number | null) => void
  hint?: string
  /**
   * Keeps every button at least 44 px wide and tall: a scale with too many steps for one row is
   * set in two balanced rows (1 to 10 as 5 and 5, 0 to 10 as 6 and 5). Without it the buttons share
   * one row, however narrow.
   */
  touch?: boolean
}

/** The columns of a touch scale: one row up to six steps, else two rows that differ by one at most. */
export function touchColumns(steps: number): number {
  return steps <= 6 ? steps : Math.ceil(steps / 2)
}

/**
 * A numbered scale such as RPE 1 to 10, pain 0 to 10 or a 1 to 5 check-in answer: one row of
 * equal buttons that share the width, so it never wraps (at 360 px the buttons are narrow but
 * stay on one line). With `touch` every button is at least 44 px square and a long scale is set in
 * two balanced rows (`touchColumns`). Tapping the chosen number clears it.
 */
export function ScalePicker({ legend, min, max, value, onChange, hint, touch }: ScalePickerProps) {
  const numbers = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const row = {
    '--steps': numbers.length,
    ...(touch === true ? { '--cols': touchColumns(numbers.length) } : {}),
  } as CSSProperties
  return (
    <fieldset className={styles.fieldset}>
      <legend>{legend}</legend>
      <div className={styles.row} style={row} data-touch={touch === true ? 'true' : undefined}>
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
