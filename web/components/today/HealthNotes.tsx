import { Link } from 'react-router-dom'
import { renderFact } from '../../../shared/copy/templates.ts'
import type { HealthNote, TodayView, Units } from '../../../shared/types.ts'
import { rulesRef } from '../../api/explain.ts'
import { ExplainButton } from '../ExplainButton.tsx'
import styles from './HealthNotes.module.css'

/**
 * The red-flag notes of the readiness read, each with its rules behind a Why, then the notes that
 * registered producers add (sync paused, a weekly update that did not run), each linking to where
 * it can be put right. A note states a fact; none of them is an alarm.
 */
export function HealthNotes({
  flags,
  notes,
  units,
}: {
  flags: TodayView['readiness']['redFlags']
  notes: HealthNote[]
  units: Units
}) {
  if (flags.length === 0 && notes.length === 0) return null
  return (
    <section aria-label="Health notes" className={styles.notes}>
      <ul className={styles.noteList}>
        {flags.map((flag) => (
          <li key={flag.code} className={styles.note}>
            <p className={styles.noteText}>{flag.message}</p>
            <ExplainButton subject="this note" rules={flag.rules} explain={rulesRef(flag.rules)} />
          </li>
        ))}
        {notes.map((note) => {
          const text = renderFact(note, units)
          return (
            <li key={note.code} className={styles.note}>
              <p className={styles.noteText}>
                {note.href === null ? (
                  text
                ) : (
                  <Link to={note.href} className={styles.link}>
                    {text}
                  </Link>
                )}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
