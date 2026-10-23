import { useId } from 'react'
import type { EahCard as EahCardData } from '../../../shared/engine/types.ts'
import styles from './EahCard.module.css'

export interface EahCardProps {
  card: EahCardData
  /** The heading level; a card inside a disclosure takes `h3`, a section of its own `h2`. */
  headingLevel?: 'h2' | 'h3'
}

/**
 * The safety card about drinking too much, which goes wherever fuel does (design 10.6): drink to
 * thirst, never force fluids, what sodium does not do and which symptoms mean medical care. The
 * server writes the sentences from templates and fixes the variant (the stronger one for a long
 * goal or heat); this renders what it sent, as a note rather than an alert.
 */
export function EahCard({ card, headingLevel = 'h3' }: EahCardProps) {
  const headingId = useId()
  const Heading = headingLevel
  return (
    <div
      role="note"
      aria-labelledby={headingId}
      className={styles.card}
      data-stronger={card.stronger ? 'true' : undefined}
    >
      <Heading id={headingId} className={styles.heading}>
        {card.heading}
      </Heading>
      <ul className={styles.lines}>
        {card.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}
