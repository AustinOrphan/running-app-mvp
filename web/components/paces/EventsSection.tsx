import { useId } from 'react'
import { gradeLegend } from '../../../shared/copy/grades.ts'
import { pacesText } from '../../../shared/copy/myPaces.ts'
import type { EventRow } from '../../../shared/engine/myPaces.ts'
import type { Grade } from '../../../shared/engine/types.ts'
import type { MyPacesView, Units } from '../../../shared/types.ts'
import type { CustomCourse as Course } from '../../api/paces.ts'
import { CustomCourse } from './CustomCourse.tsx'
import { EventCard } from './EventCard.tsx'
import { HowMade } from './HowMade.tsx'
import styles from './Paces.module.css'

export interface EventsSectionProps {
  view: MyPacesView
  units: Units
  course: Course | null
  onCourse: (course: Course | null) => void
  /** The answer for a new course is on its way; the previous one stays on screen. */
  busy: boolean
}

/** The grades of the cards that carry a time, for the one legend under them. */
function gradesShown(rows: readonly EventRow[]): Grade[] {
  return rows.flatMap((row) => (row.time === null ? [] : [row.grade]))
}

/**
 * What the runner can run now (rule C9): the five standard distances and one of their own, each a
 * range with its basis and the grade of its method, and no goal needed. One legend under the cards
 * says what the grades mean; one disclosure traces the figures to their rules.
 */
export function EventsSection({ view, units, course, onCourse, busy }: EventsSectionProps) {
  const headingId = useId()
  const customId = useId()
  const rows = view.custom === null ? view.events : [...view.events, view.custom]
  const rules = [...new Set(['C9', 'L1', 'L6', ...rows.flatMap((row) => row.rules)])]
  return (
    <section id="events" className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {pacesText('paces.events.heading')}
      </h2>
      <p className={styles.note}>{pacesText('paces.events.context')}</p>
      <ul className={styles.cards} aria-label={pacesText('paces.events.heading')}>
        {view.events.map((row) => (
          <li key={row.key}>
            <EventCard row={row} units={units} />
          </li>
        ))}
      </ul>
      <p className={styles.note}>{pacesText('paces.events.no-weather')}</p>

      <h3 id={customId} className={styles.subheading}>
        {pacesText('paces.custom.heading')}
      </h3>
      <CustomCourse units={units} course={course} onCourse={onCourse} />
      <div className={styles.result} aria-live="polite" aria-busy={busy}>
        {view.custom === null ? null : <EventCard row={view.custom} units={units} />}
      </div>

      {gradesShown(rows).length === 0 ? null : (
        <p className={styles.note}>{gradeLegend(gradesShown(rows))}</p>
      )}
      <HowMade
        lines={[
          pacesText('paces.events.how-time'),
          pacesText('paces.events.how-range'),
          pacesText('paces.events.how-climb'),
          pacesText('paces.events.how-grade'),
        ]}
        subject="the predicted times"
        rules={rules}
      />
    </section>
  )
}
