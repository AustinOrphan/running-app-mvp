import { useId } from 'react'
import {
  planShapeFieldLabel,
  planShapeGradeLine,
  planShapeHeldLine,
  type PlanShapeRow,
} from '../../shared/copy/method.ts'
import type { PersistentHold } from '../../shared/engine/holds.ts'
import type { PresetId } from '../../shared/engine/types.ts'
import fieldStyles from './Field.module.css'
import styles from './PlanShapeField.module.css'

/**
 * The choice of a plan shape [rules P1 to P4]: the plan's own shape, three run days a week and a
 * longer base, as a radio group with one line of help under each and the notes the page can state
 * from what it already has (the days open, a goal the shape is not for, a persistent hold). A shape
 * that is not for the goal stays in the list, disabled, with its reason. Every shape is a choice and
 * not a better plan, and the one line that says so sits under the group.
 *
 * Each row is one label around its radio, so a tap anywhere on it chooses; the radio is named by the
 * shape's own name and described by the help and the notes.
 */
export function PlanShapeField({
  rows,
  value,
  onChange,
  held,
}: {
  rows: readonly PlanShapeRow[]
  value: PresetId
  onChange: (value: PresetId) => void
  /** The persistent hold the server reports, which reads any other shape as the plan's own. */
  held: PersistentHold | null
}) {
  const id = useId()
  const lines = [
    ...(held !== null && value !== 'default' ? [planShapeHeldLine(held)] : []),
    planShapeGradeLine(),
  ]
  return (
    <fieldset
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      aria-describedby={lines.map((_, index) => `${id}-line-${String(index)}`).join(' ')}
      className={styles.group}
    >
      <legend id={`${id}-label`} className={fieldStyles.label}>
        {planShapeFieldLabel()}
      </legend>
      {rows.map((row) => (
        <label
          key={row.value}
          className={styles.row}
          data-checked={row.value === value ? 'true' : undefined}
          data-disabled={row.disabled ? 'true' : undefined}
        >
          <input
            type="radio"
            name={`${id}-shape`}
            value={row.value}
            checked={row.value === value}
            disabled={row.disabled}
            aria-labelledby={`${id}-${row.value}-name`}
            aria-describedby={[
              `${id}-${row.value}-help`,
              ...row.notes.map((_, index) => `${id}-${row.value}-note-${String(index)}`),
            ].join(' ')}
            className={styles.input}
            onChange={() => {
              onChange(row.value)
            }}
          />
          <span className={styles.body}>
            <span id={`${id}-${row.value}-name`} className={styles.name}>
              {row.label}
            </span>
            <span id={`${id}-${row.value}-help`} className={styles.text}>
              {row.help}
            </span>
            {row.notes.map((note, index) => (
              <span
                key={note}
                id={`${id}-${row.value}-note-${String(index)}`}
                className={styles.text}
              >
                {note}
              </span>
            ))}
          </span>
        </label>
      ))}
      {lines.map((line, index) => (
        <p key={line} id={`${id}-line-${String(index)}`} className={fieldStyles.hint}>
          {line}
        </p>
      ))}
    </fieldset>
  )
}
