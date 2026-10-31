import { useState } from 'react'
import type { StrengthLog, StrengthWorkout } from '../../../shared/types.ts'
import { useStrengthUnits } from '../../api/strength.ts'
import { Sheet } from '../Sheet.tsx'
import { Skeleton } from '../Skeleton.tsx'
import { StrengthForm, type StrengthSaved } from './StrengthForm.tsx'
import { strengthWords } from './strengthText.ts'
import styles from './StrengthSheet.module.css'

export type { StrengthSaved } from './StrengthForm.tsx'

export interface StrengthSheetProps {
  /**
   * The workout the sheet opens filled from: Today's `coach.slots.strength`, or a workout of the
   * Strength page. A sheet already open keeps the one it was opened with (ADR 0014).
   */
  workout: StrengthWorkout
  /** The day the session is logged on (YYYY-MM-DD, the server's day). */
  date: string
  /**
   * The planned session the log links to. Left out, the workout's own; null for a log that stands
   * for no planned session (an off-plan day, a past session), which the server then matches itself.
   */
  sessionId?: string | null
  /** An owned strength activity that has no log yet (an import): the sets attach to it. */
  activityId?: string | null
  /**
   * A saved log to edit (the Strength page's recent sessions): the sheet opens with its sets, minutes,
   * effort, pain and note, and saves over it under its own id, so the log is replaced and not
   * doubled. `workout` is then `workoutOfLog(log, ...)`, which the sheet keeps as it keeps any
   * workout it was opened with; the quiet buttons, "Why" and "Swap" speak of a plan the log was not
   * made from and are left out, and "Save without sets" never applies.
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

/**
 * The strength logging sheet (design 9.1): a bottom sheet on a phone and a panel from 900 px, with
 * the primary button pinned above the safe area. It opens filled with the workout's suggestion, so a
 * session logged as suggested is three taps: open, "As suggested", Save. The sheet is lazy
 * (`lazySheets.tsx`): mount it through that file, and only while it is open.
 *
 * It shows no load before it knows the runner's weight unit, which the worker keeps offline, so the
 * sheet opens with no connection (ADR 0012).
 */
export function StrengthSheet({
  workout: given,
  date,
  sessionId,
  activityId,
  log,
  usualLoads,
  onClose,
  onSaved,
}: StrengthSheetProps) {
  // The workout the sheet was opened with is the one it keeps (ADR 0014): a read of Today that
  // lands while it is open changes the loads the rules suggest, and the sets entered, the draft and
  // the snapshot the log stores must stay those of what the runner was shown.
  const [workout] = useState(given)
  const units = useStrengthUnits()
  const title = strengthWords('km', 'lb').heading(workout.template, workout.variant)
  return (
    <Sheet open onClose={onClose} title={title}>
      {units.isError ? (
        <p role="alert" className={styles.alert}>
          {strengthWords('km', 'lb').say('strength.sheet.settings-error')}
        </p>
      ) : units.data === undefined ? (
        <Skeleton lines={5} />
      ) : (
        <StrengthForm
          workout={workout}
          date={date}
          sessionId={sessionId === undefined ? workout.sessionId : sessionId}
          activityId={activityId ?? log?.activityId ?? null}
          {...(log === undefined ? {} : { log })}
          usualLoads={usualLoads === true}
          weightUnit={units.data.weightUnit}
          units={units.data.units}
          onSaved={onSaved}
        />
      )}
    </Sheet>
  )
}
