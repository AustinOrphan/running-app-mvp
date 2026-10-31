import { Button } from '../Button.tsx'
import type { LiftRead } from './useLiftRead.ts'
import type { StrengthWords } from './strengthText.ts'
import styles from './StrengthSheet.module.css'

/**
 * What the sheet says while a lift is read for "Swap" or "Add a lift", and when it cannot be: that
 * the rules are working it out, that no connection or server answer came (with a way to ask again),
 * or that the saved equipment cannot make the exercise. One line at most.
 */
export function LiftReadNotes({ read, words }: { read: LiftRead; words: StrengthWords }) {
  if (read.chosen === null) return null
  const exercise = words.name(read.chosen)
  if (read.reading) {
    return (
      <p role="status" className={styles.muted}>
        {words.say('strength.sheet.lift-reading', { exercise })}
      </p>
    )
  }
  if (read.failed) {
    return (
      <div className={styles.usual}>
        <p role="alert" className={styles.alert}>
          {words.say('strength.sheet.lift-error')}
        </p>
        <Button variant="quiet" onClick={read.retry}>
          {words.say('strength.sheet.try-again')}
        </Button>
      </div>
    )
  }
  if (read.unavailable) {
    return (
      <p role="alert" className={styles.alert}>
        {words.say('strength.sheet.lift-unavailable', { exercise })}
      </p>
    )
  }
  return null
}
