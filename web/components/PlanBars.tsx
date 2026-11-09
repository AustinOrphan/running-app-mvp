import {
  BARS_CAPTION,
  BARS_OVERSHOOT_CAPTION,
  barFigure,
  barPairName,
} from '../../shared/copy/runCharts.ts'
import { planBarGeometry } from '../../shared/domain/planBars.ts'
import type { Activity, PlanSession, Units } from '../../shared/types.ts'
import styles from './PlanBars.module.css'

type PlannedSession = Pick<PlanSession, 'durationMin'>
type RanActivity = Pick<Activity, 'durationSec'>

const pct = (fraction: number): string => `${String(fraction * 100)}%`

/** Whether the bars have something to draw: the planned minutes and the run's time are both positive. */
export function hasPlanBars(session: PlannedSession, activity: RanActivity): boolean {
  return planBarGeometry(session.durationMin * 60, activity.durationSec) !== null
}

/**
 * What the session planned and what the run was, as two horizontal bars of time: the plan as an
 * outline, the run as a solid bar, and what went past the plan hatched. No tick, check mark,
 * percentage or "met": a target is a sketch. Time only, because a planned distance is derived from
 * the minutes and is never set against the distance run. The pair has an accessible name and its
 * figures are in a hidden table. Renders nothing when there is nothing to set side by side.
 */
export function PlanBars({
  session,
  activity,
  units,
}: {
  session: PlannedSession
  activity: RanActivity
  units: Units
}) {
  const plannedSec = session.durationMin * 60
  const geometry = planBarGeometry(plannedSec, activity.durationSec)
  if (geometry === null) return null
  return (
    <figure className={styles.bars}>
      <div
        role="img"
        aria-label={barPairName(plannedSec, activity.durationSec, units)}
        className={styles.pair}
      >
        <span className={styles.measure} aria-hidden="true">
          Time
        </span>
        <div className={styles.row} aria-hidden="true">
          <span className={styles.name}>Planned</span>
          <span className={styles.track}>
            <span className={styles.outline} style={{ width: pct(geometry.planned) }} />
          </span>
          <span className={styles.value}>{barFigure(plannedSec, units)}</span>
        </div>
        <div className={styles.row} aria-hidden="true">
          <span className={styles.name}>Ran</span>
          <span className={styles.track}>
            <span className={styles.solid} style={{ width: pct(geometry.ran) }} />
            {geometry.overshoot === null ? null : (
              <span
                className={styles.over}
                data-overshoot="true"
                style={{
                  left: pct(geometry.overshoot.from),
                  width: pct(geometry.overshoot.to - geometry.overshoot.from),
                }}
              />
            )}
          </span>
          <span className={styles.value}>{barFigure(activity.durationSec, units)}</span>
        </div>
      </div>
      <figcaption className={styles.caption}>
        {geometry.overshoot === null ? BARS_CAPTION : `${BARS_CAPTION} ${BARS_OVERSHOOT_CAPTION}`}
      </figcaption>
      <div className="visually-hidden">
        <table>
          <caption>Planned and ran</caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">Planned</th>
              <th scope="col">Ran</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Time</th>
              <td>{barFigure(plannedSec, units)}</td>
              <td>{barFigure(activity.durationSec, units)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </figure>
  )
}
