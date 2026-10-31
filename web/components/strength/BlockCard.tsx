import { useId } from 'react'
import { Link } from 'react-router-dom'
import { P } from '../../../shared/engine/params/index.ts'
import type { StrengthBlockView } from '../../../shared/types.ts'
import { GradeBadge } from '../GradeBadge.tsx'
import type { PageWords } from './strengthPageText.ts'
import styles from './StrengthSections.module.css'

/** The research topic that holds the strength rules (`research/topics/strength-plyometrics.md`). */
const RESEARCH_TOPIC = 'strength-plyometrics'

export interface BlockCardProps {
  /** Where the current week stands in its block; null in a week outside one. */
  block: StrengthBlockView | null
  /** The benefit sentence of design 4.5, worded from the view's facts; null when the view has none. */
  benefit: string | null
  words: PageWords
}

/**
 * This block (design 11.3, part 3): "Week 6 of 12, heavy", what follows in one line, the benefit
 * sentence with the grade of the figure it restates, and a link to the research page. The grade is
 * the Param's own, so a regrade of the figure reaches the page.
 */
export function BlockCard({ block, benefit, words }: BlockCardProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {words.say('strength.page.block-heading')}
      </h2>
      {block === null ? (
        <p className={styles.lead}>{words.say('strength.page.block-none')}</p>
      ) : (
        <>
          <p className={styles.run}>{words.position(block)}</p>
          <p className={styles.lead}>{words.follows(block)}</p>
        </>
      )}
      {benefit === null ? null : <p className={styles.lead}>{benefit}</p>}
      <div className={styles.actions}>
        <GradeBadge grade={P.f7.expectedBenefitPct.grade} />
        <Link to={'/research?topic=' + RESEARCH_TOPIC} className={styles.link}>
          {words.say('strength.page.research-link')}
        </Link>
      </div>
    </section>
  )
}
