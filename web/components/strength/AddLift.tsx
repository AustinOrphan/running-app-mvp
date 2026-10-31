import { useRef, useState } from 'react'
import type { ExerciseId } from '../../../shared/domain/strengthLibrary.ts'
import type { EquipmentConfig, WorkoutLift } from '../../../shared/types.ts'
import type { DayRead } from '../../api/strength.ts'
import { Button } from '../Button.tsx'
import { LiftReadNotes } from './LiftReadNotes.tsx'
import { addChoices, type Block } from './strengthForm.ts'
import type { StrengthWords } from './strengthText.ts'
import { useLiftRead } from './useLiftRead.ts'
import styles from './StrengthSheet.module.css'

export interface AddLiftProps {
  blocks: readonly Block[]
  /** The saved equipment, which the list reads; null until the page view has loaded (or offline). */
  equipment: readonly EquipmentConfig[] | null
  /** The exercises left out in the setup: not offered. */
  avoid: readonly string[]
  /** The barbell may be an implement in this session (not in a ramp-in or return week). */
  barbell: boolean
  /** Another set fits in the log. */
  canAdd: boolean
  /** What to ask the server to read the lift in; null where the sheet cannot ask. */
  read: DayRead | null
  words: StrengthWords
  /** The lift the rules gave, to put after the others. */
  onAdd: (lift: WorkoutLift) => void
}

/**
 * The choices under "Add a lift": a choice is read from the server, which gives its sets and load
 * as the rules do for a lift in this session (a first session when it has never been logged,
 * design 10.3). The control closes this panel when the lift is added.
 */
function AddChoices({
  choices,
  read,
  words,
  onAdd,
}: {
  choices: readonly ExerciseId[]
  read: DayRead | null
  words: StrengthWords
  onAdd: (lift: WorkoutLift) => void
}) {
  const lift = useLiftRead(read, onAdd)
  return (
    <div className={styles.swap}>
      {choices.length === 0 ? (
        <p className={styles.muted}>{words.say('strength.sheet.add-none')}</p>
      ) : (
        <div
          role="group"
          aria-label={words.say('strength.sheet.add-choices')}
          aria-busy={lift.reading ? true : undefined}
          className={styles.choices}
        >
          {choices.map((id) => (
            <button
              key={id}
              type="button"
              className={styles.choice}
              onClick={() => {
                if (!lift.reading) lift.choose(id)
              }}
            >
              {words.name(id)}
            </button>
          ))}
        </div>
      )}
      <LiftReadNotes read={lift} words={words} />
      <p className={styles.muted}>{words.say('strength.sheet.add-note')}</p>
    </div>
  )
}

/**
 * "Add a lift" (design 9.1): after the last lift, the catalogue's feasible exercises that are not
 * in the workout. The lift of the exercise chosen is logged after the others.
 */
export function AddLift({
  blocks,
  equipment,
  avoid,
  barbell,
  canAdd,
  read,
  words,
  onAdd,
}: AddLiftProps) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const choices = equipment === null ? [] : addChoices(blocks, equipment, barbell, avoid)

  return (
    <section className={styles.addLift}>
      <div>
        <Button
          ref={button}
          variant="quiet"
          aria-expanded={open}
          disabled={equipment === null || read === null || !canAdd}
          onClick={() => {
            setOpen((now) => !now)
          }}
        >
          {words.say('strength.sheet.add-lift')}
        </Button>
      </div>
      {open ? (
        <AddChoices
          choices={choices}
          read={read}
          words={words}
          onAdd={(lift) => {
            onAdd(lift)
            setOpen(false)
            // the choice that was pressed leaves with the panel, so focus goes back to the button
            button.current?.focus()
          }}
        />
      ) : null}
    </section>
  )
}
