import { useId } from 'react'
import type { EahCard as EahCardData } from '../../../shared/engine/types.ts'
import styles from './EahCard.module.css'

/**
 * The safety card about drinking too much, which goes wherever fuel does (design 10.6): drink to
 * thirst, never force fluids, what sodium does not do and which symptoms mean medical care. The
 * server writes the sentences from templates and fixes the variant (the stronger one for a long
 * goal or heat); this renders what it sent, as a note rather than an alert.
 */
export function EahCard({ card }: { card: EahCardData }) {
  const headingId = useId()
  return (
    <div
      role="note"
      aria-labelledby={headingId}
      className={styles.card}
      data-stronger={card.stronger ? 'true' : undefined}
    >
      <h3 id={headingId} className={styles.heading}>
        {card.heading}
      </h3>
      <ul className={styles.lines}>
        {card.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}
