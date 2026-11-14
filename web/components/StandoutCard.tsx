import { useId } from 'react'
import { renderStandouts } from '../../shared/copy/standoutRender.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import type { Units } from '../../shared/types.ts'
import { useStandout } from '../api/activities.ts'
import { ExplainButton } from './ExplainButton.tsx'
import { WarningSignsText } from './WarningSignsText.tsx'
import styles from './StandoutCard.module.css'

export interface StandoutCardProps {
  activityId: string
  units: Units
}

/**
 * "What stood out" on a run: up to three neutral facts from the runner's own numbers, each with a
 * Why. The facts are chosen on the server and stored as template ids and slots; the sentences are
 * rendered here in the runner's units.
 *
 * A run with nothing unusual gets no card, and none stands in while the facts load: a section whose
 * only words are "Nothing unusual" is a heading and a hairline the page does not need. When the
 * facts could not be loaded the card stays, with its plain line, so the gap is not silent.
 */
export function StandoutCard({ activityId, units }: StandoutCardProps) {
  const headingId = useId()
  const standout = useStandout(activityId)
  const text = (id: 'standout.heading' | 'standout.error') => render(TEMPLATES[id], {}, units)

  const { data } = standout
  const failed = standout.isError
  if (!failed && (data === undefined || data.items.length === 0)) return null
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {text('standout.heading')}
      </h2>
      {failed || data === undefined ? (
        <p className={styles.muted}>{text('standout.error')}</p>
      ) : (
        <ul className={styles.list}>
          {renderStandouts(data, units).map((item) => (
            <li key={item.id} className={styles.item}>
              <p className={styles.sentence}>
                <WarningSignsText text={item.text} />
              </p>
              <ExplainButton
                subject={item.subject}
                rules={item.rules}
                explain={{ subject: 'activity', id: activityId }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
