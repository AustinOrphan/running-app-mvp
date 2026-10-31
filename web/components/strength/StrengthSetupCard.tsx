import { useId } from 'react'
import { Link } from 'react-router-dom'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { Units } from '../../../shared/types.ts'
import styles from './StrengthSetupCard.module.css'

/**
 * "Set up strength" on Today (design 6.1): the first time a strength session falls within a week
 * while the setup is not saved, one line on what is missing and a link to the Strength page, where
 * the setup's five parts open as sheets. Nothing is asked here and nothing is saved here. The slot
 * mount (`slotMounts.tsx`) shows it from the Today payload, kept offline too, and hides it once the
 * setup is saved or no strength session is within the week.
 */
export function StrengthSetupCard({ units }: { units: Units }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {render(TEMPLATES['strength.page.setup-heading'], {}, units)}
      </h2>
      <p className={styles.lead}>{render(TEMPLATES['strength.page.today-offer'], {}, units)}</p>
      <Link to="/strength" className={styles.link}>
        {render(TEMPLATES['strength.page.today-link'], {}, units)}
      </Link>
    </section>
  )
}
