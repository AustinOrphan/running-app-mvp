import { useState } from 'react'
import type { StrengthLog, StrengthWorkout } from '../../../shared/types.ts'
import { useStrengthUnits, useStrengthWorkoutFor, type DayRead } from '../../api/strength.ts'
import { Button } from '../Button.tsx'
import { Sheet } from '../Sheet.tsx'
import { Skeleton } from '../Skeleton.tsx'
import { StrengthForm, type StrengthSaved } from './StrengthForm.tsx'
import type { WorkoutStart } from './strengthForm.ts'
import { strengthWords } from './strengthText.ts'
import styles from './StrengthSheet.module.css'

export type { StrengthSaved } from './StrengthForm.tsx'
export type { WorkoutStart } from './strengthForm.ts'

interface StrengthSheetBase {
  /** The day the session is logged on (YYYY-MM-DD, the server's day). */
  date: string
  /**
   * The planned session the log links to. Left out, the workout's own when the sheet is opened on
   * one (`workout`) and none when it reads the workout itself (`read`); null for a log that stands
   * for no planned session (an off-plan day, a past session), which the server then matches itself.
   */
  sessionId?: string | null
  /** An owned strength activity that has no log yet (an import): the sets attach to it. */
  activityId?: string | null
  /**
   * A saved log to edit (the Strength page's recent sessions): the sheet opens with its sets, minutes,
   * effort, pain and note, and saves over it under its own id, so the log is replaced and not
   * doubled. `workout` is then `workoutOfLog(log, ...)`, which the sheet keeps as it keeps any
   * workout it was opened with; the quiet buttons, "Why", "Swap" and "Add a lift" speak of a plan
   * the log was not made from and are left out, and "Save without sets" never applies.
   */
  log?: StrengthLog
  /**
   * Open with the usual load of a lighter day in every set that has one, as the lift's "Use the
   * usual load" does (the Today hero's switch). A draft kept on the device wins over it.
   */
  usualLoads?: boolean
  onClose: () => void
  /** The log was saved, or kept on this phone, or saved without sets. The caller closes the sheet. */
  onSaved: (saved: StrengthSaved) => void
}

export type StrengthSheetProps = StrengthSheetBase &
  (
    | {
        /**
         * The workout the sheet opens filled from: Today's `coach.slots.strength`, or a workout of the
         * Strength page. A sheet already open keeps the one it was opened with (ADR 0014).
         */
        workout: StrengthWorkout
        /**
         * Where `workout` came from when its session is not the one the log is made for (design 9.1):
         * the next planned session, which a log with no planned session starts from, or the
         * maintenance session of the week. The sheet's header says so.
         */
        start?: WorkoutStart | null
        read?: undefined
      }
    | {
        /**
         * The sheet reads its workout from the server (`GET /api/strength/workout`): the planned
         * session of the day, else the next planned one, else the maintenance session of its week
         * (design 9.1). It opens at once, shows that it is reading, and keeps the first answer.
         */
        read: DayRead
        workout?: undefined
        start?: undefined
      }
  )

/** What the sheet keeps once it knows the workout: the workout, and where it came from. */
interface Kept {
  workout: StrengthWorkout
  start: WorkoutStart | null
}

/**
 * The strength logging sheet (design 9.1): a bottom sheet on a phone and a panel from 900 px, with
 * the primary button pinned above the safe area. It opens filled with the workout's suggestion, so a
 * session logged as suggested is three taps: open, "As suggested", Save. The sheet is lazy
 * (`lazySheets.tsx`): mount it through that file, and only while it is open.
 *
 * It shows no load before it knows the runner's weight unit, which the worker keeps offline, so the
 * sheet opens with no connection (ADR 0012). A planned session's workout is given (Today's payload
 * is kept offline too); a log with no planned session reads its workout, which needs a connection.
 */
export function StrengthSheet(props: StrengthSheetProps) {
  const { date, sessionId, activityId, log, usualLoads, onClose, onSaved } = props
  const units = useStrengthUnits()
  const day = useStrengthWorkoutFor({
    ...(props.read ?? { date }),
    enabled: props.read !== undefined,
  })
  // The workout the sheet was opened with is the one it keeps (ADR 0014): a read of Today that
  // lands while it is open changes the loads the rules suggest, and the sets entered, the draft and
  // the snapshot the log stores must stay those of what the runner was shown. The same holds for
  // the first answer of a workout the sheet reads itself.
  const [kept, setKept] = useState<Kept | null>(
    props.workout === undefined ? null : { workout: props.workout, start: props.start ?? null },
  )
  const answer = day.data
  if (kept === null && answer !== undefined) {
    // kept from the render the answer arrived in, so the form below never sees a later one
    setKept({
      workout: answer.workout,
      start: answer.source === 'planned' ? null : answer.source,
    })
  }

  const words = strengthWords('km', 'lb')
  const title =
    kept === null
      ? words.say('strength.sheet.title-plain')
      : words.heading(kept.workout.template, kept.workout.variant)
  return (
    <Sheet open onClose={onClose} title={title}>
      {units.isError ? (
        <p role="alert" className={styles.alert}>
          {words.say('strength.sheet.settings-error')}
        </p>
      ) : kept === null ? (
        day.isError ? (
          <div className={styles.usual}>
            <p role="alert" className={styles.alert}>
              {words.say('strength.sheet.workout-error')}
            </p>
            <Button
              variant="quiet"
              onClick={() => {
                void day.refetch()
              }}
            >
              {words.say('strength.sheet.try-again')}
            </Button>
          </div>
        ) : (
          <>
            <p role="status" className={styles.muted}>
              {words.say('strength.sheet.workout-reading')}
            </p>
            <Skeleton lines={5} />
          </>
        )
      ) : units.data === undefined ? (
        <Skeleton lines={5} />
      ) : (
        <StrengthForm
          workout={kept.workout}
          date={date}
          sessionId={
            sessionId === undefined
              ? props.read === undefined
                ? kept.workout.sessionId
                : null
              : sessionId
          }
          activityId={activityId ?? log?.activityId ?? null}
          {...(log === undefined ? {} : { log })}
          usualLoads={usualLoads === true}
          start={kept.start}
          weightUnit={units.data.weightUnit}
          units={units.data.units}
          onSaved={onSaved}
        />
      )}
    </Sheet>
  )
}
