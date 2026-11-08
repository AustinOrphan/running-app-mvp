import { useId } from 'react'
import { gradeLegend } from '../../../shared/copy/grades.ts'
import { climbWeightsLine, PACES_TEMPLATES, pacesText } from '../../../shared/copy/myPaces.ts'
import { render } from '../../../shared/copy/template.ts'
import type { EventRow } from '../../../shared/engine/myPaces.ts'
import type { Grade } from '../../../shared/engine/types.ts'
import type { Units } from '../../../shared/types.ts'
import type { CustomCourse as Course } from '../../api/paces.ts'
import { CustomCourse } from './CustomCourse.tsx'
import { EventCard } from './EventCard.tsx'
import { HowMade } from './HowMade.tsx'
import styles from './Paces.module.css'

export interface EventsSectionProps {
  events: readonly EventRow[]
  units: Units
  course: Course | null
  onCourse: (course: Course | null) => void
  /** The row of the course the runner named; null until it answers. */
  custom: EventRow | null
  /** The request for the course failed; the rest of the page stands. */
  customFailed: boolean
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
export function EventsSection({
  events,
  units,
  course,
  onCourse,
  custom,
  customFailed,
  busy,
}: EventsSectionProps) {
  const headingId = useId()
  const customId = useId()
  const rows = custom === null ? events : [...events, custom]
  const trainingSince = rows.find((row) => row.basis.cs?.since != null)?.basis.cs?.since ?? null
  const rules = [...new Set(['C9', 'L1', 'L6', ...rows.flatMap((row) => row.rules)])]
  return (
    <section id="events" className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {pacesText('paces.events.heading')}
      </h2>
      <p className={styles.note}>{pacesText('paces.events.context')}</p>
      {trainingSince === null ? null : (
        <p className={styles.note}>
          {render(
            PACES_TEMPLATES['paces.events.training'],
            { date: { kind: 'date', iso: trainingSince, style: 'short' } },
            units,
          )}{' '}
          <a href="#test">{pacesText('paces.test.heading')}</a>
        </p>
      )}
      <ul className={styles.cards} aria-label={pacesText('paces.events.heading')}>
        {events.map((row) => (
          <li key={row.key}>
            <EventCard row={row} units={units} />
          </li>
        ))}
      </ul>
      <p className={styles.note}>{pacesText('paces.events.no-weather')}</p>
      {gradesShown(rows).length === 0 ? null : (
        <p className={styles.note}>{gradeLegend(gradesShown(rows))}</p>
      )}

      <h3 id={customId} className={styles.subheading}>
        {pacesText('paces.custom.heading')}
      </h3>
      <CustomCourse units={units} course={course} onCourse={onCourse} />
      <div className={styles.result} aria-live="polite" aria-busy={busy}>
        {customFailed ? (
          <p role="alert" className={styles.note}>
            {pacesText('paces.custom.load-error')}
          </p>
        ) : custom === null ? null : (
          <EventCard row={custom} units={units} />
        )}
      </div>

      <HowMade
        lines={[
          pacesText('paces.events.how-time'),
          pacesText('paces.events.how-range'),
          pacesText('paces.events.how-climb'),
          ...(rows.some((row) => row.ownClimb !== null)
            ? [pacesText('paces.events.how-climb-own'), climbWeightsLine(units)]
            : []),
          pacesText('paces.events.how-grade'),
        ]}
        subject="the predicted times"
        rules={rules}
      />
    </section>
  )
}
