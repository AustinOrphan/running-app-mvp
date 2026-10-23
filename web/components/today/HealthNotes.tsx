import type { TodayView } from '../../../shared/types.ts'
import { Button } from '../Button.tsx'
import styles from './today.module.css'

export function HealthNotes({
  flags,
  onWhy,
}: {
  flags: TodayView['readiness']['redFlags']
  onWhy: (rules: string[]) => void
}) {
  if (flags.length === 0) return null
  return (
    <section aria-label="Health notes" className={styles.notes}>
      <ul className={styles.noteList}>
        {flags.map((flag) => (
          <li key={flag.code} className={styles.note}>
            <p className={styles.noteText}>{flag.message}</p>
            <Button
              variant="quiet"
              onClick={() => {
                onWhy(flag.rules)
              }}
            >
              Why this note
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
