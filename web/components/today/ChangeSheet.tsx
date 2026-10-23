import { Link } from 'react-router-dom'
import { todayIso } from '../../../shared/dates.ts'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { ChangeLine, Units } from '../../../shared/types.ts'
import buttonStyles from '../Button.module.css'
import { localiseEngineText } from '../engineText.ts'
import { formatLongDate } from '../format.ts'
import { Sheet } from '../Sheet.tsx'
import styles from './ChangeSheet.module.css'

const REASON_TEMPLATES = {
  weekly: 'today.change.weekly',
  break: 'today.change.break',
  review: 'today.change.review',
} as const

/**
 * The change line's sheet: what kind of update it was, the day it ran and the summary whole, with
 * a link to the plan, where the list of every update lives. The line reports a weekly, break or
 * review update only, so the reasons here are those three.
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
        <p className={styles.head}>
          {kind === null ? null : <strong>{kind}</strong>}{' '}
          <span className={styles.muted}>
            {formatLongDate(todayIso(new Date(change.createdAt)))}
          </span>
        </p>
        <p className={styles.summary}>{localiseEngineText(change.summary, units)}</p>
      </div>
    </Sheet>
  )
}
