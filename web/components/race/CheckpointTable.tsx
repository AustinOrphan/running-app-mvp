import type { ReactNode } from 'react'
import { describeRacePoints } from '../../../shared/copy/racePlan.ts'
import type { RacePlan } from '../../../shared/engine/racePlan.ts'
import type { Units } from '../../../shared/types.ts'
import { rulesRef } from '../../api/explain.ts'
import { Button } from '../Button.tsx'
import { ExplainButton } from '../ExplainButton.tsx'
import styles from './Race.module.css'

export interface CheckpointTableProps {
  plan: RacePlan
  units: Units
  onEdit: () => void
  /** More controls beside Edit: the course import. */
  actions?: ReactNode
}

/**
 * The runner's checkpoint table with its arrival ranges (rule H14, ADR 0018), or the line that says
 * the plan works without it. A self-supported race calls the rows course points and shows no grams
 * to carry. The cutoff and the arrival range of a row are two facts in two lines; nothing here sets
 * one against the other. The words are `describeRacePoints`'s; this lays them out.
 */
export function CheckpointTable({ plan, units, onEdit, actions }: CheckpointTableProps) {
  const text = describeRacePoints(plan, units)
  return (
    <section className={styles.section} aria-labelledby="race-points">
      <h2 id="race-points" className={styles.heading}>
        {text.heading}
      </h2>
      {text.rows.length === 0 ? (
        <p className={styles.text}>{text.empty}</p>
      ) : (
        <>
          {text.notices.map((notice) => (
            <p key={notice} className={styles.note}>
              {notice}
            </p>
          ))}
          <ol className={styles.parts} aria-label={text.list}>
            {text.rows.map((row, index) => (
              <li key={`${String(index)}-${row.name}`}>
                <article className={styles.part} aria-label={row.name}>
                  <h3 className={styles.subheading}>{row.name}</h3>
                  <p className={styles.partWindow}>{row.distance}</p>
                  <p className={styles.text}>{row.arrival}</p>
                  {row.tags.length === 0 ? null : (
                    <ul className={styles.tags} aria-label={`${row.name}: tags`}>
                      {row.tags.map((tag) => (
                        <li key={tag} className={styles.tag}>
                          {tag}
                        </li>
                      ))}
                    </ul>
                  )}
                  {row.cutoff.map((line) => (
                    <p key={line} className={styles.text}>
                      {line}
                    </p>
                  ))}
                  <p className={styles.note}>{row.segment}</p>
                  {row.climb === null ? null : <p className={styles.note}>{row.climb}</p>}
                  {row.descent === null ? null : <p className={styles.note}>{row.descent}</p>}
                  {row.carry === null ? null : <p className={styles.note}>{row.carry}</p>}
                </article>
              </li>
            ))}
          </ol>
          {text.notes.map((note) => (
            <p key={note} className={styles.note}>
              {note}
            </p>
          ))}
        </>
      )}
      <div className={styles.actions}>
        <Button onClick={onEdit}>{text.edit}</Button>
        {actions}
        {plan.splits === null ? null : (
          <ExplainButton
            subject="the arrival times"
            rules={plan.splits.rules}
            explain={rulesRef(plan.splits.rules)}
          />
        )}
      </div>
    </section>
  )
}
