import { useId } from 'react'
import { P } from '../../../shared/engine/params/index.ts'
import { GradeBadge } from '../GradeBadge.tsx'
import type { PageWords } from './strengthPageText.ts'
import styles from './StrengthSections.module.css'

export interface AboutCardProps {
  /** The benefit sentence of design 4.5, worded from the view's facts; null when the view has none. */
  benefit: string | null
  words: PageWords
}

/**
 * About (design 11.3, part 8; 4.5): what the programme does and does not claim, in four sentences,
 * with the grade of each kind of figure, the defaults that are defaults, and the safety line. The
 * grades are read from the Params the figures come from, so a regrade reaches the page; the page
 * states no figure for injuries and no chance of one (G5).
 */
export function AboutCard({ benefit, words }: AboutCardProps) {
  const headingId = useId()
  const grades = [
    { id: 'benefit', label: 'strength.page.grade-benefit', grade: P.f7.expectedBenefitPct.grade },
    { id: 'heavy', label: 'strength.page.grade-heavy', grade: P.flib.heavyMinPct1rm.grade },
    { id: 'defaults', label: 'strength.page.grade-defaults', grade: P.flib.heavySets.grade },
  ] as const
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {words.say('strength.page.about-heading')}
      </h2>
      {benefit === null ? null : <p className={styles.lead}>{benefit}</p>}
      <p className={styles.lead}>{words.say('strength.page.about-heavy')}</p>
      <p className={styles.lead}>{words.say('strength.page.about-thin')}</p>
      <p className={styles.lead}>{words.say('strength.page.about-claims')}</p>
      <h3 className={styles.subheading}>{words.say('strength.page.about-grades')}</h3>
      <ul className={styles.badges}>
        {grades.map(({ id, label, grade }) => (
          <li key={id} className={styles.badge}>
            <span>{words.say(label)}</span>
            <GradeBadge grade={grade} />
          </li>
        ))}
      </ul>
      <p className={styles.note}>{words.say('strength.page.about-defaults')}</p>
      <p className={styles.note}>{words.say('strength.safety')}</p>
    </section>
  )
}
