import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { Button } from './Button.tsx'
import styles from './ErrorState.module.css'
import { Illustration, type ArtKey } from './illustrations/Illustration.tsx'
import { useOnline } from './useOnline.ts'

export interface ErrorStateProps {
  /** What did not load, as a noun phrase from a template: "Goals", "The profile". */
  subject: string
  /** The query's `refetch`; the button runs it. */
  onRetry: () => unknown
  /**
   * True while the retry runs. The button stays in place and focusable but busy (`aria-busy`,
   * `aria-disabled`, clicks ignored), so focus stays on it; never the `disabled` attribute.
   */
  retrying?: boolean
  /**
   * The drawing, shown only while the Illustrations switch is on: `load` (the default) draws the
   * page with the retry arrow, and offline the connection drawing replaces it. `false` draws none,
   * for an error inside a panel or a sheet.
   */
  art?: ArtKey | false
}

/**
 * A failed load: one sentence naming what happened, one muted line, one button that tries again.
 * Offline, the sentence says so. Same shape as `EmptyState`. A page draws this
 * only while its query has no data (`useLoadView` is `failed` or `retrying`); one that holds data
 * keeps it when a background refetch fails. Keep it mounted through the retry, with `retrying` set.
 */
export function ErrorState({ subject, onRetry, retrying = false, art = 'load' }: ErrorStateProps) {
  const online = useOnline()
  const slots = { subject: subject }
  return (
    <div className={styles.error}>
      <Illustration art={art === false ? undefined : online ? art : 'offline'} />
      {/* The sentence is the alert, and it is remounted for each attempt: while a retry runs it is plain
          text, so a second failure appears as a new alert and is announced again. The button below
          stays mounted, so focus stays on it. */}
      <p
        key={retrying ? 'retrying' : 'failed'}
        role={retrying ? undefined : 'alert'}
        className={styles.title}
      >
        {render(TEMPLATES[online ? 'error.load' : 'error.load-offline'], slots, 'km')}
      </p>
      <p className={styles.body}>
        {render(TEMPLATES[online ? 'error.load-hint' : 'error.load-offline-hint'], {}, 'km')}
      </p>
      <div className={styles.action}>
        <Button
          variant="primary"
          busy={retrying}
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
