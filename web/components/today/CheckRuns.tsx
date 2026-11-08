import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { Button } from '../Button.tsx'
import styles from './CheckRuns.module.css'
import type { CheckRuns as CheckRunsState } from './checkRuns.ts'

/**
 * The quiet "Check for new runs" control of Today's header: an icon button on a phone (its name is
 * still the words), the words beside the icon from 900 px. While a check runs the button keeps
 * focus and says it is busy (`busy`, not `disabled`), the icon turns unless the runner asked for
 * less motion, and a live region says so for a screen reader. Nothing shows without a connected
 * pull service, and the button is off without a connection.
 */
export function CheckRunsButton({ state }: { state: CheckRunsState }) {
  if (!state.available) return null
  const checking = state.phase === 'checking'
  return (
    <>
      <Button variant="quiet" busy={checking} disabled={!state.online} onClick={state.check}>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={checking ? `${styles.icon} ${styles.spin}` : styles.icon}
        >
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v5h-5" />
        </svg>
        <span className={styles.label}>{render(TEMPLATES['today.check.label'], {}, 'km')}</span>
      </Button>
      <span role="status" className="visually-hidden">
        {checking ? render(TEMPLATES['today.check.busy'], {}, 'km') : ''}
      </span>
    </>
  )
}

/** Why the last check failed or is slow, under the header; nothing when all is well. */
export function CheckRunsNote({ state }: { state: CheckRunsState }) {
  if (state.problem === null) return null
  return (
    <p role="alert" className={styles.note}>
      {state.problem}
    </p>
  )
}
