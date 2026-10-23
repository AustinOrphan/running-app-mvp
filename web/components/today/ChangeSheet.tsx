import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { todayIso } from '../../../shared/dates.ts'
import { reasonLabel } from '../../../shared/copy/revisionView.ts'
import type { ChangeLine, Units } from '../../../shared/types.ts'
import { useMarkRevisionsSeen, usePlanRevisions } from '../../api/plan.ts'
import buttonStyles from '../Button.module.css'
import { localiseEngineText } from '../engineText.ts'
import { formatLongDate } from '../format.ts'
import { RevisionDiff } from '../revisions/RevisionDiff.tsx'
import { Sheet } from '../Sheet.tsx'
import styles from './ChangeSheet.module.css'

/**
 * The change line's sheet: the update through the one set of diff and undo components the Plan page
 * uses, with a link to the plan, where the list of every update lives. The list is asked for when
 * the sheet opens, and opening stamps the update as seen; the "New" marker stays until the sheet
 * closes. Until the update arrives (or if it cannot be shown) the sheet gives what the line already
 * knows: what kind of update it was (worded by the same `reasonLabel` the diff header uses), the
 * day it ran and the summary whole.
 */
export function ChangeSheet({
  open,
  change,
  units,
  onClose,
}: {
  open: boolean
  change: ChangeLine
  units: Units
  onClose: () => void
}) {
  const revisions = usePlanRevisions({ enabled: open })
  const markSeen = useMarkRevisionsSeen()
  const revision = revisions.data?.find((item) => item.id === change.id)
  // The update that was unseen when the sheet opened keeps its marker until the sheet closes.
  const [freshId, setFreshId] = useState<string | null>(null)
  if (!open && freshId !== null) setFreshId(null)
  if (open && revision !== undefined && revision.seenAt === null && freshId !== revision.id) {
    setFreshId(revision.id)
  }

  useEffect(() => {
    if (open && revision !== undefined && revision.seenAt === null) markSeen([revision.id])
  }, [open, revision, markSeen])

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="What changed"
      footer={
        <Link
          to="/plan"
          className={`${buttonStyles.button} ${buttonStyles.secondary} ${styles.link}`}
        >
          Open the plan
        </Link>
      }
    >
      <div className={styles.body}>
        {revision === undefined ? (
          <>
            <p className={styles.head}>
              <strong>{reasonLabel(change.reason, units)}</strong>{' '}
              <span className={styles.muted}>
                {formatLongDate(todayIso(new Date(change.createdAt)))}
              </span>
            </p>
            <p className={styles.summary}>{localiseEngineText(change.summary, units)}</p>
          </>
        ) : (
          <RevisionDiff revision={revision} units={units} isNew={freshId === revision.id} />
        )}
      </div>
    </Sheet>
  )
}
