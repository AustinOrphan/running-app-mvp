import { useId, useRef, useState, type KeyboardEvent } from 'react'
import fieldStyles from './Field.module.css'
import styles from './Segmented.module.css'

export interface SegmentedProps<T extends string> {
  label: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  /** One line of help under the control; with it, the label is shown above like a field's. */
  hint?: string
  /**
   * What the arrow keys do. `select` (the default) moves and selects, as a radio group does.
   * `focus` only moves focus, and Space or Enter selects: for a choice that is saved the moment it
   * is made, where selecting on the way past would save an answer nobody gave.
   */
  arrows?: 'select' | 'focus'
  /** Smaller type and tighter padding, so five short words fit a 360 px row without scrolling. */
  dense?: boolean
}

/**
 * A radio group drawn as joined buttons: one tab stop, arrow keys move (and, by default, select).
 * Without a hint the label is only read out; with one, the label and the hint are visible, as for
 * a field. A `value` that matches no option leaves the group with nothing chosen.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
  arrows = 'select',
  dense = false,
}: SegmentedProps<T>) {
  const id = useId()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const [focused, setFocused] = useState<number | null>(null)
  const selected = options.findIndex((o) => o.value === value)
  const tabStop = arrows === 'focus' && focused !== null ? focused : selected === -1 ? 0 : selected

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % options.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + options.length) % options.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = options.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const option = options[next]
    if (!option) return
    if (arrows === 'select') onChange(option.value)
    else setFocused(next)
    buttons.current[next]?.focus()
  }

  const labelled = hint !== undefined
  const group = (
    <div
      role="radiogroup"
      aria-label={labelled ? undefined : label}
      aria-labelledby={labelled ? `${id}-label` : undefined}
      aria-describedby={labelled ? `${id}-hint` : undefined}
      className={`${styles.group} ${dense ? styles.dense : ''}`}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            buttons.current[index] = el
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={index === tabStop ? 0 : -1}
          className={styles.option}
          onClick={() => {
            onChange(option.value)
          }}
          onKeyDown={(event) => {
            onKeyDown(event, index)
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
  if (!labelled) return group
  return (
    <div className={fieldStyles.field}>
      <span id={`${id}-label`} className={fieldStyles.label}>
        {label}
      </span>
      {group}
      <p id={`${id}-hint`} className={fieldStyles.hint}>
        {hint}
      </p>
    </div>
  )
}
