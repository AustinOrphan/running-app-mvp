import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { Button } from './Button.tsx'
import styles from './ErrorState.module.css'
import { useOnline } from './useOnline.ts'

export interface ErrorStateProps {
  /** What did not load, as a noun phrase from a template: "Goals", "The profile". */
  subject: string
  /** The query's `refetch`; the button runs it. */
  onRetry: () => unknown
  /** True while the retry runs. */
  retrying?: boolean
}

/**
 * A failed load: one sentence naming what happened, one muted line, one button that tries again.
 * Offline, the sentence says so. Same shape as `EmptyState`; no illustration. A page that holds a
 * cached payload keeps showing it and does not render this.
 */
export function ErrorState({ subject, onRetry, retrying = false }: ErrorStateProps) {
  const online = useOnline()
  const slots = { subject: subject }
  return (
    <div className={styles.error} role="alert">
      <p className={styles.title}>
        {render(TEMPLATES[online ? 'error.load' : 'error.load-offline'], slots, 'km')}
      </p>
      <p className={styles.body}>
        {render(TEMPLATES[online ? 'error.load-hint' : 'error.load-offline-hint'], {}, 'km')}
      </p>
      <div className={styles.action}>
        <Button
          variant="primary"
          loading={retrying}
          onClick={() => {
            void onRetry()
          }}
        >
          {render(TEMPLATES['error.retry'], {}, 'km')}
        </Button>
      </div>
    </div>
  )
}
