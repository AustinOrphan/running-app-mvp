import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import {
  ACTIVATE_ARCHIVED_TEXT,
  activateBuildLabel,
  activateFollowsText,
} from '../../shared/copy/goals.ts'
import { Button } from './Button.tsx'
import styles from './ActivateConfirm.module.css'

interface ActivateConfirmProps {
  /** The goal the plan follows now. */
  currentGoal: string
  /** The goal being made active. */
  nextGoal: string
  /** The request that builds the plan is running. */
  loading: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The inline question of "Make active" while a plan follows another goal: what the new plan does
 * to the current one, and two buttons. Focus moves to the text on open, so a screen reader reads
 * it first; Cancel and Escape close it, and the caller puts focus back on the button that opened
 * it. While the plan is being built neither closes it.
 */
export function ActivateConfirm({
  currentGoal,
  nextGoal,
  loading,
  onConfirm,
  onCancel,
}: ActivateConfirmProps) {
  const textId = useId()
  const text = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    text.current?.focus()
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || loading) return
    event.stopPropagation()
    onCancel()
  }

  return (
    <div className={styles.confirm} role="group" aria-labelledby={textId} onKeyDown={onKeyDown}>
      <p ref={text} id={textId} tabIndex={-1} className={styles.text}>
        {activateFollowsText(currentGoal, nextGoal)} {ACTIVATE_ARCHIVED_TEXT}
      </p>
      <div className={styles.buttons}>
        <Button variant="primary" loading={loading} onClick={onConfirm}>
          {activateBuildLabel(nextGoal)}
        </Button>
        <Button variant="quiet" disabled={loading} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
