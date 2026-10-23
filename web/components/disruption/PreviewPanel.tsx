import { useId } from 'react'
import type { EngineWarning } from '../../../shared/engine/types.ts'
import type { PlanPreview, Units } from '../../../shared/types.ts'
import { groupWarnings } from '../engineText.ts'
import { PlanDiffView } from '../revisions/PlanDiffView.tsx'
import styles from './disruption.module.css'

export interface PreviewPanelProps {
  preview: PlanPreview
  units: Units
  /** Sentences that say what the action does in words, before the figures. */
  lead?: readonly string[]
  /** Sentences with figures: the running time the action changes. */
  facts?: readonly string[]
  /** Other things worth knowing, such as a window over race day. */
  notes?: readonly string[]
  /** Warnings the plan after the action carries that the plan now does not. */
  warnings?: readonly EngineWarning[]
  /** Said first and announced: the preview was replaced by a newer one. */
  notice?: string | null
}

/**
 * What an action on the plan would change, for any preview the server makes: the words of the
 * action, the figures, what is worth knowing, why it cannot be applied when it cannot, and the rows
 * of the diff through the shared `PlanDiffView`. It shows what the commit will write and decides
 * nothing: a refusal is the server's, shown with its reason.
 */
export function PreviewPanel({
  preview,
  units,
  lead = [],
  facts = [],
  notes = [],
  warnings = [],
  notice = null,
}: PreviewPanelProps) {
  const headingId = useId()
  const worth = [...notes, ...groupWarnings(warnings, units).map((group) => group.summary)]
  return (
    <div className={styles.preview}>
      {notice !== null ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      {lead.length > 0 ? <p className={styles.text}>{lead.join(' ')}</p> : null}
      {facts.map((fact) => (
        <p key={fact} className={styles.text}>
          {fact}
        </p>
      ))}
      {preview.blocked ? (
        <div className={styles.blocked}>
          <p className={styles.text}>This cannot be applied right now.</p>
          <ul className={styles.plainList} aria-label="Why this cannot be applied">
            {preview.reasons.map((reason, index) => (
              <li key={`${reason.code}-${String(index)}`}>{reason.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {worth.length > 0 ? (
        <div>
          <p id={headingId} className={styles.subheading}>
            Worth knowing
          </p>
          <ul className={styles.plainList} aria-labelledby={headingId}>
            {worth.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <PlanDiffView diff={preview.diff} units={units} />
    </div>
  )
}
