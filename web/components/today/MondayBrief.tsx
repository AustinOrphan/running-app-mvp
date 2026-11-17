import { useEffect, useId, useRef } from 'react'
import { Link } from 'react-router-dom'
import { briefText, renderBriefLine } from '../../../shared/copy/briefRender.ts'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { BriefListItem, Units } from '../../../shared/types.ts'
import { useAcknowledgeBrief, useBrief } from '../../api/brief.ts'
import { Button } from '../Button.tsx'
import buttonStyles from '../Button.module.css'
import { focusMain, isFocusLost } from '../focusMain.ts'
import { useOnline } from '../useOnline.ts'
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
 * place under the week; so does "Got it", the same write for a runner who has read the card. It
 * is a write that is not queued (it is no outbox route), so it is not offered while the browser
 * is offline. The card takes the focused button with it, so focus moves to the quiet line's link
 * (the main landmark when the line is not drawn).
 */
export function MondayBrief({ item, reviewDue, units }: MondayBriefProps) {
  const titleId = useId()
  // The revision (with its undo state) comes with the full brief; the card stands without it.
  const brief = useBrief(item.weekStart)
  const revision = brief.data?.revision ?? null
  const online = useOnline()
  const { acknowledge, pending, failed } = useAcknowledgeBrief()
  const acknowledged = useRef(false)
  useEffect(() => {
    if (failed) acknowledged.current = false
  }, [failed])
  useEffect(
    () => () => {
      if (!acknowledged.current) return
      const line = document.querySelector<HTMLElement>('[data-slot="brief"] a')
      if (line !== null) line.focus({ preventScroll: true })
      else if (isFocusLost()) focusMain()
    },
    [],
  )
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
          {online ? (
            <Button
              variant="secondary"
              busy={pending}
              className={styles.open}
              onClick={() => {
                acknowledged.current = true
                acknowledge(item.weekStart)
              }}
            >
              {render(TEMPLATES['today.monday.got-it'], {}, units)}
            </Button>
          ) : null}
        </div>
        {failed ? (
          <p role="alert" className={styles.sentence}>
            {render(TEMPLATES['today.monday.got-it-failed'], {}, units)}
          </p>
        ) : null}
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
