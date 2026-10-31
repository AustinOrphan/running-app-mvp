import { useId, useState } from 'react'
import type { ExerciseId } from '../../../shared/domain/strengthLibrary.ts'
import type {
  EquipmentConfig,
  PinnedSlot,
  StrengthWorkout,
  WeightUnit,
} from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import { ExplainButton } from '../ExplainButton.tsx'
import { ScalePicker } from '../ScalePicker.tsx'
import { Stepper } from './Stepper.tsx'
import {
  COUNT_STEP,
  REPS_LEFT_MAX,
  barbellOf,
  commonRir,
  parseCount,
  rowLoadG,
  stepRowCount,
  stepRowLoad,
  swapChoices,
  swappedLift,
  withAddedSet,
  withAllRir,
  withLift,
  withRir,
  withUsualLoad,
  withoutSet,
  type Block,
  type SetRow,
} from './strengthForm.ts'
import { loadMeaningLine, measureOf, type StrengthWords } from './strengthText.ts'
import { usualLoadOf } from './workoutRows.ts'
import styles from './StrengthSheet.module.css'

/** The slots a runner can pin an exercise in (design 6.2): the lifts of a session. */
const PINNABLE: ReadonlySet<string> = new Set<PinnedSlot>(['knee', 'hip', 'calf'])

export interface LiftSectionProps {
  block: Block
  workout: StrengthWorkout
  words: StrengthWords
  weightUnit: WeightUnit
  /** A save was tried: the fields it could not read are marked. */
  attempted: boolean
  /** The saved equipment, which "Swap" reads; null until the page view has loaded (or offline). */
  equipment: readonly EquipmentConfig[] | null
  /** The exercises left out in the setup: "Swap" does not offer them, so none can be pinned. */
  avoid: readonly string[]
  /** The exercise the runner always uses in this lift's slot, if any. */
  pinned: string | undefined
  /** "Same as last time" has a session of this lift to copy. */
  hasLast: boolean
  /** A saved log is being edited: "Why", "Swap", "Always use this" and the usual load speak of a plan it was not made from. */
  editing: boolean
  /** Another set fits in the log. */
  canAdd: boolean
  onChange: (update: (block: Block) => Block) => void
  onSameAsLast: () => void
  /** Saves the choice as the lift of the slot; true when the server has it. */
  onPin: (exerciseId: string, slot: PinnedSlot) => Promise<boolean>
}

/**
 * One exercise of the sheet (design 9.1): its name and suggestion, "Why" and "Swap", the reps-left
 * value for all its sets, and a row for each set with a load stepper (for a lift that has a load), a
 * count stepper and the reps-left scale.
 */
export function LiftSection({
  block,
  workout,
  words,
  weightUnit,
  attempted,
  equipment,
  avoid,
  pinned,
  hasLast,
  editing,
  canAdd,
  onChange,
  onSameAsLast,
  onPin,
}: LiftSectionProps) {
  const headingId = useId()
  const meaningId = useId()
  const [swapOpen, setSwapOpen] = useState(false)
  const [pinFailed, setPinFailed] = useState(false)
  const { shown, rows } = block
  const exercise = words.name(shown.exerciseId)
  const measure = measureOf(shown.exerciseId)
  const measureWord = words.measure(measure)
  // a lift with loads in its sets shows the field, whatever the equipment says (a log of a swapped
  // lift that was kept on the phone has its loads and not its steps)
  const loaded = shown.steps !== null || rows.some((row) => row.load !== '')
  const meaning = loaded ? loadMeaningLine(words, shown.exerciseId, shown.implement) : null
  const swapped = shown !== block.original
  const reason = words.reason(shown)
  const usualLoadG = usualLoadOf(shown)
  // a saved log being edited was not made on a lighter day of the plan that is read now
  const lighterDay = !editing && shown.change === 'lighter-day' && usualLoadG !== null
  const choices = equipment === null ? [] : swapChoices(block, equipment, barbellOf(workout), avoid)
  const pinnable = !editing && swapped && PINNABLE.has(shown.slot)
  const reachedBy = (index: number, update: (row: SetRow) => SetRow) => {
    onChange((current) => ({
      ...current,
      rows: current.rows.map((row, at) => (at === index ? update(row) : row)),
    }))
  }

  function swapTo(id: ExerciseId): void {
    if (equipment === null) return
    const lift =
      id === block.original.exerciseId
        ? block.original
        : swappedLift(workout, id, equipment, weightUnit)
    if (lift === null) return
    onChange((current) => withLift(current, lift, weightUnit))
    setSwapOpen(false)
    setPinFailed(false)
  }

  function pin(): void {
    if (!PINNABLE.has(shown.slot)) return
    void onPin(shown.exerciseId, shown.slot as PinnedSlot).then((saved) => {
      setPinFailed(!saved)
    })
  }

  return (
    <section aria-labelledby={headingId} className={styles.lift}>
      <div className={styles.liftHead}>
        <h3 id={headingId} className={styles.liftName}>
          {exercise}
        </h3>
        <div className={styles.liftTools}>
          {/* A swapped lift has no explanation yet: the server reads the figures of a lift in the
              session's place (E14-10), and the drawer would explain another suggestion. A saved
              log being edited was not made from the plan the drawer would explain. */}
          {block.kind === 'lift' && !swapped && !editing ? (
            <ExplainButton
              subject={exercise}
              rules={[shown.basis.rule]}
              explain={{ subject: 'strength', id: workout.sessionId, exercise: shown.exerciseId }}
            />
          ) : null}
          {block.kind === 'lift' && !editing ? (
            <Button
              variant="quiet"
              aria-label={words.say('strength.sheet.swap-for', { exercise })}
              aria-expanded={swapOpen}
              disabled={equipment === null}
              onClick={() => {
                setSwapOpen((open) => !open)
              }}
            >
              {words.say('strength.sheet.swap')}
            </Button>
          ) : null}
          {hasLast ? (
            <Button
              variant="quiet"
              aria-label={words.say('strength.sheet.same-as-last-for', { exercise })}
              onClick={onSameAsLast}
            >
              {words.say('strength.sheet.same-as-last')}
            </Button>
          ) : null}
        </div>
      </div>

      <p className={styles.suggestion}>{words.suggestion(shown)}</p>
      {reason === null ? null : <p className={styles.muted}>{reason}</p>}
      {/* what the load means is fixed by the equipment and shown beside the field (design 5.2) */}
      {meaning === null ? null : (
        <p id={meaningId} className={styles.muted}>
          {meaning}
        </p>
      )}

      {lighterDay ? (
        <div className={styles.usual}>
          <p className={styles.muted}>
            {words.say('strength.sheet.usual-load', {
              load: { kind: 'load', g: usualLoadG ?? 0 },
            })}
          </p>
          <Button
            variant="quiet"
            aria-label={words.say('strength.sheet.use-usual-for', { exercise })}
            onClick={() => {
              onChange((current) => withUsualLoad(current, weightUnit))
            }}
          >
            {words.say('strength.use-usual')}
          </Button>
        </div>
      ) : null}

      {swapOpen ? (
        <div className={styles.swap}>
          {choices.length === 0 ? (
            <p className={styles.muted}>{words.say('strength.sheet.swap-none')}</p>
          ) : (
            <div
              role="group"
              aria-label={words.say('strength.sheet.swap-choices', { exercise })}
              className={styles.choices}
            >
              {choices.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={styles.choice}
                  onClick={() => {
                    swapTo(id)
                  }}
                >
                  {id === block.original.exerciseId && swapped
                    ? words.say('strength.sheet.swap-original', { exercise: words.name(id) })
                    : words.name(id)}
                </button>
              ))}
            </div>
          )}
          <p className={styles.muted}>{words.say('strength.sheet.swap-note')}</p>
        </div>
      ) : null}

      {pinnable ? (
        <div className={styles.usual}>
          {pinned === shown.exerciseId ? (
            <p className={styles.muted} role="status">
              {words.say('strength.sheet.pinned')}
            </p>
          ) : (
            <Button
              variant="quiet"
              aria-label={words.say('strength.sheet.always-use-for', { exercise })}
              onClick={pin}
            >
              {words.say('strength.sheet.always-use')}
            </Button>
          )}
          {pinFailed ? (
            <p className={styles.alert} role="alert">
              {words.say('strength.sheet.not-pinned')}
            </p>
          ) : null}
        </div>
      ) : null}

      {shown.rir !== null && rows.length > 0 ? (
        <div className={styles.allSets}>
          <span className={styles.repsLeftLabel} aria-hidden="true">
            {words.say('strength.sheet.all-sets')}
          </span>
          <div className={styles.repsLeft}>
            <ScalePicker
              legend={words.say('strength.sheet.all-sets-for', { exercise })}
              min={0}
              max={REPS_LEFT_MAX}
              value={commonRir(rows)}
              touch
              onChange={(rir) => {
                onChange((current) => withAllRir(current, rir))
              }}
            />
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className={styles.muted}>{words.say('strength.sheet.no-sets-lift')}</p>
      ) : (
        <ol className={styles.sets}>
          {rows.map((row, index) => {
            const number = index + 1
            const loadName = words.stepperGroup(
              shown.exerciseId,
              number,
              words.say('strength.measure.load'),
            )
            const countName = words.stepperGroup(shown.exerciseId, number, measureWord)
            const repsLeftName = words.stepperGroup(
              shown.exerciseId,
              number,
              words.say('strength.measure.reps-left'),
            )
            const amount = { kind: 'count', n: COUNT_STEP[measure] } as const
            return (
              <li key={index} className={styles.set}>
                <div className={styles.setHead}>
                  <span className={styles.setTitle}>
                    {words.say('strength.sheet.set-title', { set: words.count(number) })}
                  </span>
                  <Button
                    variant="quiet"
                    aria-label={words.say('strength.sheet.remove-for', {
                      exercise,
                      set: words.count(number),
                    })}
                    onClick={() => {
                      onChange((current) => withoutSet(current, index))
                    }}
                  >
                    {words.say('strength.sheet.remove')}
                  </Button>
                </div>
                <div className={styles.steppers}>
                  {loaded ? (
                    <Stepper
                      label={loadName}
                      value={row.load}
                      inputMode="decimal"
                      unit={weightUnit}
                      describedBy={meaning === null ? undefined : meaningId}
                      lowerLabel={words.say('strength.sheet.lower-load')}
                      raiseLabel={words.say('strength.sheet.raise-load')}
                      lowerEnds={stepRowLoad(row, shown, -1, weightUnit) === row}
                      raiseEnds={stepRowLoad(row, shown, 1, weightUnit) === row}
                      invalid={rowLoadG(row, weightUnit) === 'invalid'}
                      onType={(text) => {
                        reachedBy(index, (current) => ({
                          ...current,
                          load: text,
                          exactG: undefined,
                        }))
                      }}
                      onLower={() => {
                        reachedBy(index, (current) => stepRowLoad(current, shown, -1, weightUnit))
                      }}
                      onRaise={() => {
                        reachedBy(index, (current) => stepRowLoad(current, shown, 1, weightUnit))
                      }}
                    />
                  ) : null}
                  <Stepper
                    label={countName}
                    value={row.count}
                    inputMode="numeric"
                    lowerLabel={words.say('strength.sheet.lower-count', {
                      measure: measureWord,
                      amount,
                    })}
                    raiseLabel={words.say('strength.sheet.raise-count', {
                      measure: measureWord,
                      amount,
                    })}
                    lowerEnds={stepRowCount(row, measure, -1) === row}
                    raiseEnds={stepRowCount(row, measure, 1) === row}
                    invalid={
                      parseCount(row.count) === null && (attempted || row.count.trim() !== '')
                    }
                    onType={(text) => {
                      reachedBy(index, (current) => ({ ...current, count: text }))
                    }}
                    onLower={() => {
                      reachedBy(index, (current) => stepRowCount(current, measure, -1))
                    }}
                    onRaise={() => {
                      reachedBy(index, (current) => stepRowCount(current, measure, 1))
                    }}
                  />
                </div>
                {shown.rir === null ? null : (
                  <div className={styles.allSets}>
                    <span className={styles.repsLeftLabel} aria-hidden="true">
                      {words.say('strength.label.reps-left')}
                    </span>
                    <div className={styles.repsLeft}>
                      <ScalePicker
                        legend={repsLeftName}
                        min={0}
                        max={REPS_LEFT_MAX}
                        value={row.rir}
                        touch
                        onChange={(rir) => {
                          reachedBy(index, (current) => withRir(current, rir))
                        }}
                      />
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <div>
        <Button
          variant="quiet"
          disabled={!canAdd}
          aria-label={words.say('strength.sheet.add-set-for', { exercise })}
          onClick={() => {
            onChange((current) => withAddedSet(current, weightUnit))
          }}
        >
          {words.say('strength.sheet.add-set')}
        </Button>
      </div>
    </section>
  )
}
