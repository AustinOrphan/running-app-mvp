import { Link } from 'react-router-dom'
import buttonStyles from '../Button.module.css'
import { Button } from '../Button.tsx'
import styles from './SessionActions.module.css'

export interface SessionActionsProps {
  /** True while the session is still to be run: Done and Not today apply. */
  canAct: boolean
  /** False when no rule stands behind the session (a plain rest day). */
  canExplain: boolean
  onExplain: () => void
  onNotToday: () => void
}

/**
 * Done, Explain and Not today, in their final order and places. Done opens the log form and Not
 * today the session's sheet until the one-tap Done sheet and the Not today sheet replace them
 * (E2-6). Explain opens the why drawer with the rules behind the session.
 */
export function SessionActions({ canAct, canExplain, onExplain, onNotToday }: SessionActionsProps) {
  return (
    <div className={styles.actions}>
      {canAct ? (
        <Link
          to="/activities?new=1"
          className={`${buttonStyles.button} ${buttonStyles.primary} ${styles.action}`}
        >
          Done
        </Link>
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
