import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { HEAT_MARK_OPTIONS } from '../../shared/copy/heatDays.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { Feel, HeatExposure, Units } from '../../shared/types.ts'
import type { FeedbackPatch } from '../api/activities.ts'
import { HeatSafely } from './HeatSafely.tsx'
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
      <div className={styles.feel}>
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

export interface HeatMarkPickerProps {
  value: HeatExposure | null
  onChange: (value: HeatExposure | null) => void
  units?: Units
}

/**
 * The optional mark of a heat exposure besides the weather (rule I8): none, ran in a warm
 * room, or a hot bath or sauna after an easy run. "None" is the cleared state, so a mark is
 * undone by choosing it or by tapping the chosen chip again.
 */
export function HeatMarkPicker({ value, onChange, units = 'km' }: HeatMarkPickerProps) {
  return (
    <fieldset className={styles.fieldset}>
      <legend>{render(TEMPLATES['heat.mark.legend'], {}, units)}</legend>
      <div className={styles.heatChips}>
        {HEAT_MARK_OPTIONS.map((option) => (
          <button
            key={option.value ?? 'none'}
            type="button"
            className={styles.chip}
            aria-pressed={value === option.value}
            onClick={() => {
              onChange(value === option.value ? null : option.value)
            }}
          >
            {option.value === 'warm-room'
              ? render(
                  TEMPLATES['heat.mark.warm-room'],
                  { temp: { kind: 'temp', c: P.acclim.exposureTempC.value } },
                  units,
                )
              : render(TEMPLATES[option.label as 'heat.mark.none'], {}, units)}
          </button>
        ))}
      </div>
      <p className={styles.hint}>{render(TEMPLATES['heat.mark.hint'], {}, units)}</p>
      <HeatSafely units={units} />
    </fieldset>
  )
}

export interface FeedbackValues {
  rpe: number | null
  feel: Feel | null
  pain: number | null
  heatExposure: HeatExposure | null
}

/**
 * The body of a feedback save: the effort rating goes only when the runner changed it from
 * `stored`, so a save of the feel, the pain or the heat mark never rewrites (or clears) a rating
 * it did not touch, a rating from the watch included (WR1). A card that starts empty passes null.
 */
export function feedbackPatch(value: FeedbackValues, stored: number | null): FeedbackPatch {
  const { rpe, ...rest } = value
  return rpe === stored ? rest : { ...rest, rpe }
}

export interface FeedbackFieldsProps {
  value: FeedbackValues
  onChange: (value: FeedbackValues) => void
  /** Show the Heat mark: see `showHeatMark`. */
  showHeat?: boolean
  units?: Units
}

/** RPE, feel, pain and the heat mark together: the fields of the "How did it go?" card and the detail page. */
export function FeedbackFields({
  value,
  onChange,
  showHeat = false,
  units = 'km',
}: FeedbackFieldsProps) {
  return (
    <div className={styles.fields}>
      <ScalePicker
        legend="RPE"
        min={1}
        max={10}
        touch
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
        touch
        value={value.pain}
        onChange={(pain) => {
          onChange({ ...value, pain })
        }}
        hint="0 is none, 10 is the worst."
      />
      {showHeat ? (
        <HeatMarkPicker
          value={value.heatExposure}
          units={units}
          onChange={(heatExposure) => {
            onChange({ ...value, heatExposure })
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Whether a rating offers the Heat mark: only for a run (not a race, strength or cross-training),
 * and only while Today says what counts as a heat day (`TodayHeat.heatDays`) or the run already
 * carries a mark, so a bath or sauna is never advertised outside a warm race's block.
 */
export function showHeatMark(
  run: { type: string; heatExposure: HeatExposure | null },
  heatDays: boolean,
): boolean {
  return run.type === 'run' && (heatDays || run.heatExposure !== null)
}
