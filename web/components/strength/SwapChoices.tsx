import type { ExerciseId } from '../../../shared/domain/strengthLibrary.ts'
import type { WorkoutLift } from '../../../shared/types.ts'
import type { DayRead } from '../../api/strength.ts'
import { LiftReadNotes } from './LiftReadNotes.tsx'
import type { StrengthWords } from './strengthText.ts'
import { useLiftRead } from './useLiftRead.ts'
import styles from './StrengthSheet.module.css'

export interface SwapChoicesProps {
  /** The exercise shown now, and the one the workout held (the choice that goes back to it). */
  shownId: string
  originalId: string
  /** The exercises the lift can be swapped for (`swapChoices`); empty when none fits. */
  choices: readonly ExerciseId[]
  /** What the server is asked to read the lift in. */
  read: DayRead | null
  words: StrengthWords
  /** Back to the lift the workout held, which needs no read. */
  onOriginal: () => void
  /** The lift the rules gave for the exercise chosen. */
  onLift: (lift: WorkoutLift) => void
}

/**
 * The choices under "Swap" (design 7.3): the exercises of the slot the saved equipment makes. A
 * choice is read from the server, which gives its sets and its load for this session (a first
 * session when it has never been logged, design 10.3); while it is read the lift stays as it was.
 * The control closes this panel when a lift is in place.
 */
export function SwapChoices({
  shownId,
  originalId,
  choices,
  read,
  words,
  onOriginal,
  onLift,
}: SwapChoicesProps) {
  const lift = useLiftRead(read, onLift)
  const exercise = words.name(shownId)
  return (
    <div className={styles.swap}>
      {choices.length === 0 ? (
        <p className={styles.muted}>{words.say('strength.sheet.swap-none')}</p>
      ) : (
        <div
          role="group"
          aria-label={words.say('strength.sheet.swap-choices', { exercise })}
          aria-busy={lift.reading ? true : undefined}
          className={styles.choices}
        >
          {choices.map((id) => (
            <button
              key={id}
              type="button"
              className={styles.choice}
              onClick={() => {
                if (id === originalId) onOriginal()
                else if (!lift.reading) lift.choose(id)
              }}
            >
              {id === originalId && shownId !== originalId
                ? words.say('strength.sheet.swap-original', { exercise: words.name(id) })
                : words.name(id)}
            </button>
          ))}
        </div>
      )}
      <LiftReadNotes read={lift} words={words} />
      <p className={styles.muted}>{words.say('strength.sheet.swap-note')}</p>
    </div>
  )
}
