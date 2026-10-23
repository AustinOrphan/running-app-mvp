import { useState } from 'react'
import { removeInsteadLabel } from '../../../shared/copy/windowView.ts'
import type { PlanRevisionView, Units } from '../../../shared/types.ts'
import { useDisruptions } from '../../api/disruptions.ts'
import { Button } from '../Button.tsx'
import { WindowActionSheet } from '../lazySheets.tsx'

/**
 * The window a revision can no longer be undone for, when the undo is refused because the plan
 * changed since: a revision that wrote a window, refused for `edited-since`. Null for every other
 * revision.
 */
export function windowToRemoveInstead(revision: PlanRevisionView): string | null {
  if (revision.reason !== 'disruption' || revision.disruptionId === null) return null
  const refused = revision.undo.reasons.some((reason) => reason.code === 'edited-since')
  return refused ? revision.disruptionId : null
}

/**
 * "Remove this rest window instead": what a runner can still do when an undo of a window is
 * refused because later edits touch it. A removal is a revision of its own with its own undo and is
 * never blocked by later edits; it opens the same preview-then-apply sheet as the banner. Shown only
 * while the window is still in force.
 */
export function RemoveWindowInstead({ windowId, units }: { windowId: string; units: Units }) {
  const windows = useDisruptions()
  const [open, setOpen] = useState(false)
  const inForce = windows.data?.some((window) => window.id === windowId) === true
  return (
    <>
      {inForce && !open ? (
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true)
          }}
        >
          {removeInsteadLabel(units)}
        </Button>
      ) : null}
      {open ? (
        <WindowActionSheet
          kind="remove"
          windowId={windowId}
          onClose={() => {
            setOpen(false)
          }}
        />
      ) : null}
    </>
  )
}
