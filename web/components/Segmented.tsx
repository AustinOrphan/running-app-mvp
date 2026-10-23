import { useId, useRef, type KeyboardEvent } from 'react'
import fieldStyles from './Field.module.css'
import styles from './Segmented.module.css'

export interface SegmentedProps<T extends string> {
  label: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  /** One line of help under the control; with it, the label is shown above like a field's. */
  hint?: string
}

/**
 * A radio group drawn as joined buttons: one tab stop, arrow keys move and select. Without a hint
 * the label is only read out; with one, the label and the hint are visible, as for a field.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
}: SegmentedProps<T>) {
  const id = useId()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const selected = options.findIndex((o) => o.value === value)
  const tabStop = selected === -1 ? 0 : selected

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
    onChange(option.value)
    buttons.current[next]?.focus()
  }

  const labelled = hint !== undefined
  const group = (
    <div
      role="radiogroup"
      aria-label={labelled ? undefined : label}
      aria-labelledby={labelled ? `${id}-label` : undefined}
      aria-describedby={labelled ? `${id}-hint` : undefined}
      className={styles.group}
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
