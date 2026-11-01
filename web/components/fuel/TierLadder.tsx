import { useId } from 'react'
import { gradeLegend } from '../../../shared/copy/grades.ts'
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
 * state is words, so the colour of a rung never carries it. A line under the intro says what the
 * grades on the page mean, since a touch screen shows no hover text. A rung above the floor says
 * "Low certainty" only when its grade does not already say it (A or B); a C or D badge is the
 * statement.
 */
export function TierLadder({ ladder }: TierLadderProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={labStyles.section}>
      <h2 id={headingId} className={labStyles.heading}>
        {labText.ladderHeading()}
      </h2>
      <p className={labStyles.lead}>{labText.ladderIntro()}</p>
      <p className={styles.legend}>{gradeLegend(ladder.rungs.map((rung) => rung.grade))}</p>
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
              {rung.lowCertainty && (rung.grade === 'A' || rung.grade === 'B') ? (
                <span className={styles.certainty}>{labText.lowCertainty()}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
