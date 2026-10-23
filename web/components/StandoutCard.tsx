import { useId } from 'react'
import { renderStandouts } from '../../shared/copy/standoutRender.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import type { Units } from '../../shared/types.ts'
import { useStandout } from '../api/activities.ts'
import { ExplainButton } from './ExplainButton.tsx'
import { Skeleton } from './Skeleton.tsx'
import styles from './StandoutCard.module.css'

export interface StandoutCardProps {
  activityId: string
  units: Units
}

/**
 * "What stood out" on a run: up to three neutral facts from the runner's own numbers, each with a
 * Why, or a plain line when nothing was unusual. The facts are chosen on the server and stored as
 * template ids and slots; the sentences are rendered here in the runner's units.
 */
export function StandoutCard({ activityId, units }: StandoutCardProps) {
  const headingId = useId()
  const standout = useStandout(activityId)
  const text = (id: 'standout.heading' | 'standout.empty' | 'standout.error') =>
    render(TEMPLATES[id], {}, units)

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {text('standout.heading')}
      </h2>
      {standout.isError ? (
        <p className={styles.muted}>{text('standout.error')}</p>
      ) : standout.data === undefined ? (
        <Skeleton lines={2} />
      ) : standout.data.items.length === 0 ? (
        <p className={styles.muted}>{text('standout.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {renderStandouts(standout.data, units).map((item) => (
            <li key={item.id} className={styles.item}>
              <p className={styles.sentence}>{item.text}</p>
              <ExplainButton subject={item.subject} rules={item.rules} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
