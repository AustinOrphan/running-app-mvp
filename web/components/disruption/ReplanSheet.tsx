import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { offlineLine, stalePreviewLine } from '../../../shared/copy/windowView.ts'
import type { PlanRevisionView } from '../../../shared/types.ts'
import { ApiError } from '../../api/client.ts'
import {
  commitFailure,
  planPreviewKey,
  useMarkRevisionsSeen,
  usePlan,
  usePlanPreview,
  useReplan,
} from '../../api/plan.ts'
import { useSettings } from '../../api/settings.ts'
import { Button } from '../Button.tsx'
import { Sheet } from '../Sheet.tsx'
import { Skeleton } from '../Skeleton.tsx'
import { RevisionDiff } from '../revisions/RevisionDiff.tsx'
import { PreviewPanel } from './PreviewPanel.tsx'
import { newWarnings } from './previewFigures.ts'
import styles from './disruption.module.css'

export interface ReplanSheetProps {
  /** Called when the sheet closes: Cancel, Close, Escape, or Done after the plan was updated. */
  onClose: () => void
}

const REPLAN = { type: 'replan' } as const

/**
 * "Update plan from latest data": the server says what a re-plan would change before anything is
 * written, and "Apply to my plan" commits that preview with its hash. A plan that moved in between
 * answers with a newer preview, which replaces the one on screen; one the plan checks refuse says
 * why and cannot be applied. A re-plan that would change nothing offers only "Done".
 */
export function ReplanSheet({ onClose }: ReplanSheetProps) {
  const queryClient = useQueryClient()
  const settings = useSettings()
  const plan = usePlan()
  const preview = usePlanPreview(REPLAN)
  const replan = useReplan()
  const markSeen = useMarkRevisionsSeen()
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState<PlanRevisionView | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const units = settings.data?.units ?? 'km'

  // Applying removes the button that was focused: the result's heading takes focus, so a screen
  // reader starts at what was done and the keyboard stays inside the dialog.
  useEffect(() => {
    if (done !== null) heading.current?.focus()
  }, [done])

  function apply() {
    if (preview.data === undefined || preview.data.blocked) return
    setFailure(null)
    replan.mutate(preview.data.hash, {
      onSuccess: (revision) => {
        setDone(revision)
        // A revision the request wrote is seen at write; only one still unseen is stamped.
        if (revision.seenAt === null) markSeen([revision.id])
      },
      onError: (error) => {
        const outcome = commitFailure(error)
        if (outcome.kind === 'stale') {
          queryClient.setQueryData(planPreviewKey(REPLAN), outcome.preview)
          setNotice(stalePreviewLine(units))
        } else if (outcome.kind === 'offline') {
          setFailure(offlineLine(units))
        } else {
          setFailure(outcome.message)
        }
      },
    })
  }

  let body
  let footer
  if (done !== null) {
    body = (
      <>
        <div role="status">
          <h3 ref={heading} tabIndex={-1} className={styles.stepHeading}>
            Plan updated
          </h3>
        </div>
        <RevisionDiff revision={done} units={units} isNew={false} />
      </>
    )
    footer = (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    )
  } else if (preview.data !== undefined) {
    const made = preview.data
    const nothing = made.diff.empty && !made.blocked
    body = (
      <>
        <PreviewPanel
          preview={made}
          units={units}
          notice={notice}
          lead={nothing ? [] : [made.summary]}
          warnings={newWarnings(made.warnings, plan.data?.warnings ?? [])}
        />
        {failure !== null ? (
          <p role="alert" className={styles.errorText}>
            {failure}
          </p>
        ) : null}
      </>
    )
    footer = nothing ? (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    ) : (
      <>
        <Button variant="quiet" disabled={replan.isPending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={made.blocked}
          loading={replan.isPending}
          onClick={apply}
        >
          Apply to my plan
        </Button>
      </>
    )
  } else if (preview.isError) {
    const offline = preview.error instanceof ApiError && preview.error.status === 0
    body = (
      <p role="alert" className={styles.errorText}>
        {offline
          ? offlineLine(units)
          : 'The preview could not be loaded. Close this and try again.'}
      </p>
    )
    footer = (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    )
  } else {
    body = (
      <div role="status">
        <p className={styles.text}>Checking what would change.</p>
        <Skeleton lines={3} />
      </div>
    )
    footer = (
      <Button variant="quiet" onClick={onClose}>
        Cancel
      </Button>
    )
  }

  return (
    <Sheet open onClose={onClose} title="Update plan from latest data" footer={footer}>
      <div className={styles.body}>{body}</div>
    </Sheet>
  )
}
