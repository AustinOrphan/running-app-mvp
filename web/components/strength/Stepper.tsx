import { useId } from 'react'
import styles from './Stepper.module.css'

export interface StepperProps {
  /** The accessible name of the group and of the field: "Back squat, set 2, load". */
  label: string
  /** The value as typed. */
  value: string
  /** `decimal` for a load, `numeric` for a count: the keyboard a phone shows. */
  inputMode: 'decimal' | 'numeric'
  lowerLabel: string
  raiseLabel: string
  /** A press in that direction would change nothing (an end of the equipment, or a count of one). */
  lowerEnds?: boolean
  raiseEnds?: boolean
  /** The unit shown after the field and read as its description: "lb". */
  unit?: string
  /** The field holds something the save cannot read. */
  invalid?: boolean
  onType: (text: string) => void
  onLower: () => void
  onRaise: () => void
}

/**
 * Two 44 px buttons around a text field (design 9.1, 11.7). A press moves the value one step; the
 * value can also be typed, so a keyboard works. A press at an end keeps the focus where it is: the
 * button says it is at the end (`aria-disabled`) and does nothing, instead of dropping focus to the
 * page as a disabled button would.
 */
export function Stepper({
  label,
  value,
  inputMode,
  lowerLabel,
  raiseLabel,
  lowerEnds = false,
  raiseEnds = false,
  unit,
  invalid = false,
  onType,
  onLower,
  onRaise,
}: StepperProps) {
  const unitId = useId()
  return (
    <div role="group" aria-label={label} className={styles.stepper}>
      <button
        type="button"
        className={styles.button}
        aria-label={lowerLabel}
        aria-disabled={lowerEnds ? true : undefined}
        onClick={() => {
          if (!lowerEnds) onLower()
        }}
      >
        <span aria-hidden="true">{'−'}</span>
      </button>
      <input
        type="text"
        className={styles.field}
        inputMode={inputMode}
        autoComplete="off"
        aria-label={label}
        aria-describedby={unit === undefined ? undefined : unitId}
        aria-invalid={invalid ? true : undefined}
        value={value}
        onChange={(event) => {
          onType(event.target.value)
        }}
      />
      <button
        type="button"
        className={styles.button}
        aria-label={raiseLabel}
        aria-disabled={raiseEnds ? true : undefined}
        onClick={() => {
          if (!raiseEnds) onRaise()
        }}
      >
        <span aria-hidden="true">+</span>
      </button>
      {unit === undefined ? null : (
        <span id={unitId} className={styles.unit}>
          {unit}
        </span>
      )}
    </div>
  )
}
