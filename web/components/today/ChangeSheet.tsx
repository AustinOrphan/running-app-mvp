import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { todayIso } from '../../../shared/dates.ts'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { ChangeLine, Units } from '../../../shared/types.ts'
import { useMarkRevisionsSeen, usePlanRevisions } from '../../api/plan.ts'
import buttonStyles from '../Button.module.css'
import { localiseEngineText } from '../engineText.ts'
import { formatLongDate } from '../format.ts'
import { RevisionDiff } from '../revisions/RevisionDiff.tsx'
import { Sheet } from '../Sheet.tsx'
import styles from './ChangeSheet.module.css'

const REASON_TEMPLATES = {
  weekly: 'today.change.weekly',
  break: 'today.change.break',
  review: 'today.change.review',
} as const

/**
 * The change line's sheet: the update through the one set of diff and undo components the Plan page
 * uses, with a link to the plan, where the list of every update lives. The list is asked for when
 * the sheet opens, and opening stamps the update as seen; the "New" marker stays until the sheet
 * closes. Until the update arrives (or if it cannot be shown) the sheet gives what the line already
 * knows: what kind of update it was, the day it ran and the summary whole. The line reports a
 * weekly, break or review update only, so the reasons here are those three.
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

  const reason = change.reason
  const kind =
    reason === 'weekly' || reason === 'break' || reason === 'review'
      ? render(TEMPLATES[REASON_TEMPLATES[reason]], {}, units)
      : null
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
              {kind === null ? null : <strong>{kind}</strong>}{' '}
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
