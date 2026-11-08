import { PACES_TEMPLATES, pacesText } from '../../../shared/copy/myPaces.ts'
import { render } from '../../../shared/copy/template.ts'
import { PACE_EVENT_LABELS } from '../../../shared/domain/paceEvents.ts'
import type { EventRow } from '../../../shared/engine/myPaces.ts'
import type { Units } from '../../../shared/types.ts'
import { formatDistance } from '../../../shared/units.ts'
import { GradeBadge } from '../GradeBadge.tsx'
import { paceParts, timeText } from './format.ts'
import styles from './Paces.module.css'
import { paceRangeText } from '../zoneFormat.ts'

const T = PACES_TEMPLATES

/** The title of a card: the event, or the course the runner named, in their units. */
export function eventTitle(row: EventRow, units: Units): string {
  return row.key === 'custom' ? formatDistance(row.distanceM, units) : PACE_EVENT_LABELS[row.key]
}

/** Where the time came from: the race, critical speed, or both. */
function basisLine(row: EventRow, units: Units): string | null {
  const { race, cs } = row.basis
  if (race !== null) {
    const slots = {
      distance: { kind: 'distance' as const, m: race.distanceM },
      date: { kind: 'date' as const, iso: race.date, style: 'short' as const },
    }
    return render(
      T[cs === null ? 'paces.event.basis-race' : 'paces.event.basis-both'],
      slots,
      units,
    )
  }
  return cs === null || cs.since !== null
    ? null
    : render(T['paces.event.basis-cs'], { efforts: { kind: 'count', n: cs.efforts } }, units)
}

/**
 * One distance: the predicted time and pace, each with its range, where they came from and the
 * grade of the method. A distance the state cannot support says so. Ranges read fast to slow, the
 * way the times do, so the two lines of a card run the same way. A prediction is a sketch: the
 * range is the claim, the middle is only where it centres.
 */
export function EventCard({ row, units }: { row: EventRow; units: Units }) {
  const title = eventTitle(row, units)
  const { time, pace } = row
  return (
    <article className={styles.card} aria-label={title}>
      <div className={styles.cardHead}>
        <h3 className={styles.subheading}>{title}</h3>
        {time === null ? null : <GradeBadge grade={row.grade} />}
      </div>
      {time === null || pace === null ? (
        <p className={styles.note}>{pacesText('paces.events.none')}</p>
      ) : (
        <>
          <dl className={styles.stats}>
            <div className={styles.stat}>
              <dt>
                {row.basis.cs?.since == null ? 'Time' : pacesText('paces.event.time-at-most')}
              </dt>
              <dd className={styles.statValue}>{timeText(time.midSec)}</dd>
              <dd
                className={styles.statRange}
              >{`${timeText(time.lowSec)} to ${timeText(time.highSec)}`}</dd>
            </div>
            <div className={styles.stat}>
              <dt>Pace</dt>
              <dd>
                <span className={styles.statValue}>{paceParts(pace.midSec, units).value}</span>{' '}
                <span className={styles.statUnit}>{paceParts(pace.midSec, units).unit}</span>
              </dd>
              <dd className={styles.statRange}>
                {paceRangeText([pace.fastSec, pace.slowSec], units)}
              </dd>
            </div>
          </dl>
          {basisLine(row, units) === null ? null : (
            <p className={styles.note}>{basisLine(row, units)}</p>
          )}
          {row.singleSource ? (
            <p className={styles.note}>{pacesText('paces.event.single')}</p>
          ) : null}
          {row.climbs ? <p className={styles.note}>{pacesText('paces.event.climb')}</p> : null}
          {row.wide ? <p className={styles.note}>{pacesText('paces.event.wide')}</p> : null}
        </>
      )}
    </article>
  )
}
