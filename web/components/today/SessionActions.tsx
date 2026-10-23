import { Button } from '../Button.tsx'
import styles from './SessionActions.module.css'

export interface SessionActionsProps {
  /** True while the session is still to be run: Done and Not today apply. */
  canAct: boolean
  /** False when no rule stands behind the session (a plain rest day). */
  canExplain: boolean
  /** Done was tapped: the hero opens the sheet that logs the run. */
  onDone: () => void
  /** Explain was tapped: the hero opens the why drawer with the rules behind the session. */
  onExplain: () => void
  /**
   * Not today was tapped: the hero opens a sheet. This component knows nothing of that sheet, so
   * the hero can mount a different one (E5's "Not 100%") without a change here.
   */
  onNotToday: () => void
}

/**
 * Done, Explain and Not today, in their final order and places. Each is a button that tells the
 * hero what was asked; the sheets and the drawer belong to the hero.
 */
export function SessionActions({
  canAct,
  canExplain,
  onDone,
  onExplain,
  onNotToday,
}: SessionActionsProps) {
  return (
    <div className={styles.actions}>
      {canAct ? (
        <Button variant="primary" className={styles.action} onClick={onDone}>
          Done
        </Button>
      ) : null}
      {canExplain ? (
        <Button className={styles.action} onClick={onExplain}>
          Explain
        </Button>
      ) : null}
      {canAct ? (
        <Button className={styles.action} onClick={onNotToday}>
          Not today
        </Button>
      ) : null}
    </div>
  )
}
