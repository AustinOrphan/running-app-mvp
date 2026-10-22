import type { Feel } from '../../shared/types.ts'
import styles from './FeelPicker.module.css'
import { ScalePicker } from './ScalePicker.tsx'

export interface FeelPickerProps {
  value: Feel | null
  onChange: (value: Feel | null) => void
}

const FEEL_OPTIONS: Array<{ value: Feel; label: string }> = [
  { value: -2, label: 'Much easier' },
  { value: -1, label: 'Easier' },
  { value: 0, label: 'As expected' },
  { value: 1, label: 'Harder' },
  { value: 2, label: 'Much harder' },
]

/** How the activity felt against what was expected. Tapping the chosen chip again clears it. */
export function FeelPicker({ value, onChange }: FeelPickerProps) {
  return (
    <fieldset className={styles.fieldset}>
      <legend>How it felt</legend>
      <div className={styles.feelChips}>
        {FEEL_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={styles.chip}
            aria-pressed={value === option.value}
            onClick={() => {
              onChange(value === option.value ? null : option.value)
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className={styles.hint}>Against what you expected. Tap again to clear.</p>
    </fieldset>
  )
}

/** The numbered scale, under its older name; see `ScalePicker`. */
export {
  ScalePicker as ScaleChips,
  type ScalePickerProps as ScaleChipsProps,
} from './ScalePicker.tsx'

export interface FeedbackValues {
  rpe: number | null
  feel: Feel | null
  pain: number | null
}

export interface FeedbackFieldsProps {
  value: FeedbackValues
  onChange: (value: FeedbackValues) => void
}

/** RPE, feel and pain together: the fields of the "How did it go?" card and the detail page. */
export function FeedbackFields({ value, onChange }: FeedbackFieldsProps) {
  return (
    <div className={styles.fields}>
      <ScalePicker
        legend="RPE"
        min={1}
        max={10}
        value={value.rpe}
        onChange={(rpe) => {
          onChange({ ...value, rpe })
        }}
        hint="1 is very easy, 10 is all out."
      />
      <FeelPicker
        value={value.feel}
        onChange={(feel) => {
          onChange({ ...value, feel })
        }}
      />
      <ScalePicker
        legend="Pain"
        min={0}
        max={10}
        value={value.pain}
        onChange={(pain) => {
          onChange({ ...value, pain })
        }}
        hint="0 is none, 10 is the worst."
      />
    </div>
  )
}
