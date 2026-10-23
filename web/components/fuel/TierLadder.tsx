import { useId } from 'react'
import { rateText, rungStateLabel } from '../../../shared/engine/fuelCopy.ts'
import type { LadderResult } from '../../../shared/engine/types.ts'
import { GradeBadge } from '../GradeBadge.tsx'
import { labText } from './fuelText.ts'
import labStyles from './FuelLab.module.css'
import styles from './TierLadder.module.css'

export interface TierLadderProps {
  ladder: LadderResult
}

/**
 * The tier ladder, lowest rate first: each rung with the word for its state (Tolerated, Next up,
 * Repeat, Later, Opt in to open, and the two that explain why a rung is closed) and the evidence
 * grade of the figure that names it. The rung the next run tries is marked as the current step. The
 * state is words, so the colour of a rung never carries it.
 */
export function TierLadder({ ladder }: TierLadderProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={labStyles.section}>
      <h2 id={headingId} className={labStyles.heading}>
        {labText.ladderHeading()}
      </h2>
      <p className={labStyles.lead}>{labText.ladderIntro()}</p>
      <ol aria-label={labText.ladderLabel()} className={styles.rungs}>
        {ladder.rungs.map((rung) => (
          <li
            key={rung.index}
            className={styles.rung}
            data-state={rung.state}
            aria-current={rung.index === ladder.currentIndex ? 'step' : undefined}
          >
            <span className={styles.rate}>{rateText(rung)}</span>
            <span className={styles.state}>{rungStateLabel(rung.state)}</span>
            <span className={styles.meta}>
              <GradeBadge grade={rung.grade} />
              {rung.lowCertainty ? (
                <span className={styles.certainty}>{labText.lowCertainty()}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
