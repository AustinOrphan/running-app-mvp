import { useId } from 'react'
import { Link } from 'react-router-dom'
import { briefText, renderBriefLine } from '../../../shared/copy/briefRender.ts'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { BriefListItem, Units } from '../../../shared/types.ts'
import { useBrief } from '../../api/brief.ts'
import buttonStyles from '../Button.module.css'
import { UndoControl } from '../revisions/UndoControl.tsx'
import styles from './MondayBrief.module.css'

export interface MondayBriefProps {
  /** The brief of the current week, unopened and with changes (`briefLeads`). */
  item: BriefListItem
  /** Last week's review is due: its link stands beside the brief. */
  reviewDue: boolean
  units: Units
}

/**
 * Monday on Today. A plan that the weekly update changed at night should not wait under the week
 * strip to be found, so while the brief is unopened and it changed sessions, this card stands
 * directly under the session hero: one sentence (how many sessions changed and the next key session), the link
 * that opens the brief, and the undo of the update. Undo is the revision's own control: it asks
 * the server what undoing would change and applies it only on a second tap. A review that is due
 * gets its link beside the card. Opening the brief marks it seen and the line goes back to its
 * place under the week.
 */
export function MondayBrief({ item, reviewDue, units }: MondayBriefProps) {
  const titleId = useId()
  // The revision (with its undo state) comes with the full brief; the card stands without it.
  const brief = useBrief(item.weekStart)
  const revision = brief.data?.revision ?? null
  const sentence = renderBriefLine({ changeCount: item.changeCount, nextKey: item.nextKey }, units)

  return (
    <div className={styles.group}>
      <section aria-labelledby={titleId} className={styles.card}>
        <h2 id={titleId} className={styles.title}>
          {render(TEMPLATES['today.monday.title'], {}, units)}
        </h2>
        <p className={styles.sentence}>{sentence}</p>
        <div className={styles.actions}>
          <Link
            to="/brief"
            className={`${buttonStyles.button} ${buttonStyles.primary} ${styles.open}`}
          >
            {briefText('brief.open', units)}
          </Link>
          {revision?.undo.available === true ? (
            <UndoControl revision={revision} units={units} />
          ) : null}
        </div>
      </section>
      {reviewDue ? (
        <Link to="/review" className={styles.review}>
          <span className={styles.reviewTitle}>
            {render(TEMPLATES['today.monday.review'], {}, units)}
          </span>
          <span className={styles.reviewNote}>
            {render(TEMPLATES['today.monday.review-note'], {}, units)}
          </span>
        </Link>
      ) : null}
    </div>
  )
}
