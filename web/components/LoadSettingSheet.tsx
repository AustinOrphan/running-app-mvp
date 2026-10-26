import { useState } from 'react'
import {
  loadApplyLabel,
  loadCancelLabel,
  loadSavedToast,
  loadSheetNote,
  loadSheetTitle,
} from '../../shared/copy/load.ts'
import { offlineLine, stalePreviewLine } from '../../shared/copy/windowView.ts'
import type { LoadAppetite } from '../../shared/engine/types.ts'
import { commitFailure, useChangeLoadSetting } from '../api/plan.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from './Button.tsx'
import { LoadField } from './LoadField.tsx'
import { Sheet } from './Sheet.tsx'
import { useToast } from './Toast.tsx'
import styles from './LoadSettingSheet.module.css'

export interface LoadSettingSheetProps {
  /** The position the plan is set to now (`PlanWithSessions.load.requested`). */
  current: LoadAppetite
  /** Called when the sheet closes: Cancel, Escape, or Apply after the setting was changed. */
  onClose: () => void
}

/**
 * Changes the load setting of the plan: the Generate form's choice of a position, and "Apply",
 * which sends it in one request. The server draws the weeks ahead again with the position as one
 * revision that can be undone, so Apply stays off while the choice is the position the plan is set
 * to, and nothing is sent for it. The toast after Apply is the summary sentence of that revision.
 */
export function LoadSettingSheet({ current, onClose }: LoadSettingSheetProps) {
  const toast = useToast()
  const settings = useSettings()
  const change = useChangeLoadSetting()
  const [chosen, setChosen] = useState<LoadAppetite>(current)
  const [failure, setFailure] = useState<string | null>(null)
  const units = settings.data?.units ?? 'km'

  function apply() {
    if (chosen === current) return
    setFailure(null)
    change.mutate(chosen, {
      onSuccess: ({ revision }) => {
        // the revision's own summary states what the plan does now, a held position and its reason
        // included; a plan that already held the position wrote no revision
        toast.show(revision?.summary ?? loadSavedToast())
        onClose()
      },
      onError: (error) => {
        const outcome = commitFailure(error)
        setFailure(
          outcome.kind === 'offline'
            ? offlineLine(units)
            : outcome.kind === 'stale'
              ? stalePreviewLine(units)
              : outcome.message,
        )
      },
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={loadSheetTitle()}
      footer={
        <>
          <Button variant="quiet" disabled={change.isPending} onClick={onClose}>
            {loadCancelLabel()}
          </Button>
          <Button
            variant="primary"
            disabled={chosen === current}
            loading={change.isPending}
            onClick={apply}
          >
            {loadApplyLabel()}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p className={styles.text}>{loadSheetNote()}</p>
        <LoadField value={chosen} onChange={setChosen} />
        {failure !== null ? (
          <p role="alert" className={styles.errorText}>
            {failure}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
