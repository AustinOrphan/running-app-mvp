import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { scaleScores, scaleWord } from './fuelText.ts'
import styles from './SymptomScale.module.css'

export interface SymptomScaleProps {
  legend: string
  /** One line of help under the scale. */
  hint?: string
  value: number | null
  onChange: (value: number) => void
  /** What is wrong with the answer; read out with the group and shown under it. */
  error?: string
}

/**
 * A 0-to-4 scale with its words (None to Very severe) as one radio group: one tab stop, arrow keys
 * move and choose. The scale and its words are the same for gut and nausea. Nothing is chosen
 * until the runner chooses, so an unanswered scale is never read as "None".
 */
export function SymptomScale({ legend, hint, value, onChange, error }: SymptomScaleProps) {
  const id = useId()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const scores = scaleScores()
  const tabStop = value !== null && scores.includes(value) ? value : (scores[0] ?? 0)
  const described = [
    hint === undefined ? null : `${id}-hint`,
    error === undefined ? null : `${id}-error`,
  ]
    .filter((part): part is string => part !== null)
    .join(' ')

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % scores.length
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + scores.length) % scores.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = scores.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const score = scores[next]
    if (score === undefined) return
    onChange(score)
    buttons.current[next]?.focus()
  }

  return (
    <fieldset className={styles.fieldset}>
      <legend id={`${id}-legend`}>{legend}</legend>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-legend`}
        aria-describedby={described === '' ? undefined : described}
        aria-invalid={error === undefined ? undefined : true}
        className={styles.row}
        style={{ '--steps': scores.length } as CSSProperties}
      >
        {scores.map((score, index) => (
          <button
            key={score}
            ref={(element) => {
              buttons.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={value === score}
            tabIndex={score === tabStop ? 0 : -1}
            className={styles.option}
            onClick={() => {
              onChange(score)
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index)
            }}
          >
            <span className={styles.score}>{score}</span>{' '}
            <span className={styles.word}>{scaleWord(score)}</span>
          </button>
        ))}
      </div>
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </fieldset>
  )
}
