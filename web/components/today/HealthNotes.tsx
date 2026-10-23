import type { TodayView } from '../../../shared/types.ts'
import { rulesRef } from '../../api/explain.ts'
import { WhyButton } from './WhyButton.tsx'
import styles from './today.module.css'

export function HealthNotes({
  flags,
}: {
  flags: TodayView['readiness']['redFlags']
  /** Not read: each note's button owns its drawer. DashboardPage still passes it until E2-5. */
  onWhy?: unknown
}) {
  if (flags.length === 0) return null
  return (
    <section aria-label="Health notes" className={styles.notes}>
      <ul className={styles.noteList}>
        {flags.map((flag) => (
          <li key={flag.code} className={styles.note}>
            <p className={styles.noteText}>{flag.message}</p>
            <WhyButton label="Why this note" rules={flag.rules} explain={rulesRef(flag.rules)} />
          </li>
        ))}
      </ul>
    </section>
  )
}
