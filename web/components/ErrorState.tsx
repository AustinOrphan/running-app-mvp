import { loadErrorText } from '../../shared/copy/loadError.ts'
import { Button } from './Button.tsx'
import styles from './ErrorState.module.css'
import { useOnline } from './useOnline.ts'

export interface ErrorStateProps {
  /** What did not load, as the start of a sentence: "Activities", "The activity". */
  what: string
  /** The query's `refetch`: the one button runs it. */
  onRetry: () => void
  /** True while the retry runs; the button waits instead of taking a second tap. */
  retrying?: boolean
}

/**
 * A read that failed: one sentence naming what did not load, one muted line, one button. Beside
 * `EmptyState` and in the same voice, with no illustration. The line says so when the device is
 * offline. A page that still holds data from an earlier read keeps showing it and does not use this.
 */
export function ErrorState({ what, onRetry, retrying = false }: ErrorStateProps) {
  const text = loadErrorText(what, useOnline())
  return (
    <div role="alert" className={styles.error}>
      <p className={styles.title}>{text.title}</p>
      <p className={styles.body}>{text.body}</p>
      <div className={styles.action}>
        <Button busy={retrying} onClick={onRetry}>
          {text.retry}
        </Button>
      </div>
    </div>
  )
}
