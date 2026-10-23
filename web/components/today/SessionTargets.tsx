import type { ResolvedTargets } from '../../../shared/engine/types.ts'
import type { Units } from '../../../shared/types.ts'
import styles from './SessionTargets.module.css'
import { targetRows, type TargetDay, type TargetRow } from './targetText.ts'

/**
 * The rows of a session's targets as a term list: the figure the day is run by first, the others
 * after it, and a note beside a figure that the day qualifies (hot weather). The weekly brief's
 * key session words the same rows (`targetRows`) and shows them through this list.
 */
export function TargetList({ rows }: { rows: TargetRow[] }) {
  if (rows.length === 0) return null
  return (
    <dl className={styles.targets}>
      {rows.map((row, index) => (
        <div key={row.key} className={styles.row} data-lead={index === 0 ? 'true' : undefined}>
          <dt className={styles.term}>{row.term}</dt>
          <dd className={styles.value}>{row.value}</dd>
          {row.note === null ? null : <dd className={styles.note}>{row.note}</dd>}
        </div>
      ))}
    </dl>
  )
}

/**
 * The targets of the session as a term list (`TargetList`). A target is a sketch, so nothing here
 * is a limit to be met. `day` is `today` for Today's hero, which is the default, and `other` for a
 * session read on any day (the session sheet): its notes do not say "today".
 */
export function SessionTargets({
  targets,
  units,
  day = 'today',
}: {
  targets: ResolvedTargets
  units: Units
  day?: TargetDay
}) {
  return <TargetList rows={targetRows(targets, units, day)} />
}
