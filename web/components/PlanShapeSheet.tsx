import { useState } from 'react'
import {
  planShapeCancelLabel,
  planShapeCurrentNote,
  planShapeRows,
  planShapeSaveLabel,
  planShapeSavedToast,
  planShapeSheetNote,
  planShapeSheetTitle,
  type PlanShapeRow,
} from '../../shared/copy/method.ts'
import { offlineLine, stalePreviewLine } from '../../shared/copy/windowView.ts'
import type { GoalModel, PresetId } from '../../shared/engine/types.ts'
import type { PersistentHold } from '../../shared/engine/holds.ts'
import { commitFailure, useChangeMethod } from '../api/plan.ts'
import { useProfile } from '../api/profile.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from './Button.tsx'
import { PlanShapeField } from './PlanShapeField.tsx'
import { Sheet } from './Sheet.tsx'
import { useToast } from './Toast.tsx'
import styles from './PlanShapeSheet.module.css'

export interface PlanShapeSheetProps {
  /** The shape the plan asks for now (`PlanWithSessions.method.requested`). */
  current: PresetId
  /** The class of the plan's goal, which decides the shapes that are offered; null when it has no distance. */
  distanceClass: GoalModel['distanceClass'] | null
  /** The persistent hold the server reports, which reads any other shape as the plan's own. */
  held: PersistentHold | null
  /** Called when the sheet closes: Cancel, Escape, or Save after the shape was changed. */
  onClose: () => void
}

/**
 * Changes the shape of the plan [rules P1 to P4]: the Generate form's choice of a shape, and "Save",
 * which sends it in one request. The server draws the weeks after the current one again with the
 * shape as one revision that can be undone, and the current week stays as it was drawn, so Save
 * stays off while the choice is the shape the plan asks for, and nothing is sent for it. The shape
 * the plan asks for now is marked on its row. The toast after Save is the summary sentence of the
 * revision.
 */
export function PlanShapeSheet({ current, distanceClass, held, onClose }: PlanShapeSheetProps) {
  const toast = useToast()
  const settings = useSettings()
  const profile = useProfile()
  const change = useChangeMethod()
  const [chosen, setChosen] = useState<PresetId>(current)
  const [failure, setFailure] = useState<string | null>(null)
  const units = settings.data?.units ?? 'km'
  const rows: PlanShapeRow[] = planShapeRows(distanceClass, profile.data?.availability ?? null).map(
    (row) =>
      row.value === current ? { ...row, notes: [planShapeCurrentNote(), ...row.notes] } : row,
  )

  function save() {
    if (chosen === current) return
    setFailure(null)
    change.mutate(chosen, {
      onSuccess: ({ revision }) => {
        // the revision's own summary states what the plan does now, a shape read as the plan's own
        // and its reason included; a plan that already held the shape wrote no revision
        toast.show(revision?.summary ?? planShapeSavedToast())
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
      busy={change.isPending}
      title={planShapeSheetTitle()}
      footer={
        <>
          <Button variant="quiet" disabled={change.isPending} onClick={onClose}>
            {planShapeCancelLabel()}
          </Button>
          <Button
            variant="primary"
            disabled={chosen === current}
            loading={change.isPending}
            onClick={save}
          >
            {planShapeSaveLabel()}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        {planShapeSheetNote().map((line) => (
          <p key={line} className={styles.text}>
            {line}
          </p>
        ))}
        <PlanShapeField rows={rows} value={chosen} onChange={setChosen} held={held} />
        {failure !== null ? (
          <p role="alert" className={styles.errorText}>
            {failure}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
