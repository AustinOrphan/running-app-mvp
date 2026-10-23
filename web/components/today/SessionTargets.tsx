import type { ResolvedTargets } from '../../../shared/engine/types.ts'
import type { Units } from '../../../shared/types.ts'
import styles from './SessionTargets.module.css'
import { targetRows } from './targetText.ts'

/**
 * The targets of the session as a term list: the figure the day is run by first, the others
 * after it, and a note beside a figure that the day qualifies (hot weather). A target is a
 * sketch, so nothing here is a limit to be met.
 */
export function SessionTargets({ targets, units }: { targets: ResolvedTargets; units: Units }) {
  const rows = targetRows(targets, units)
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
