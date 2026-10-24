import { restPromptWords } from '../../../shared/copy/windowView.ts'
import type { Units } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import styles from './disruption.module.css'

export interface RestWindowPromptProps {
  units: Units
  /** "Set one up": the caller opens the "Not 100%" sheet. */
  onSetUp: () => void
  /** "Not now": the caller stops offering for the rest of the visit. */
  onLater: () => void
}

/**
 * Today's offer after a check-in that reports illness or pain, when no window is in effect: one
 * question and two answers, in the form and the 64 px of the banner it stands in for. Asking
 * creates nothing; the window is made only in the sheet "Set one up" opens, after its preview.
 */
export function RestWindowPrompt({ units, onSetUp, onLater }: RestWindowPromptProps) {
  const words = restPromptWords(units)
  return (
    <section aria-label="Rest window offer" className={`${styles.banner} ${styles.compact}`}>
      <p className={styles.bannerLine}>{words.ask}</p>
      <div className={styles.bannerActions}>
        <Button variant="quiet" className={styles.compactAction} onClick={onSetUp}>
          {words.yes}
        </Button>
        <Button variant="quiet" className={styles.compactAction} onClick={onLater}>
          {words.later}
        </Button>
      </div>
    </section>
  )
}
