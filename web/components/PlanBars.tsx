import {
  BAR_MEASURE_LABEL,
  BARS_CAPTION,
  BARS_OVERSHOOT_CAPTION,
  barFigure,
  barPairName,
  type BarMeasure,
} from '../../shared/copy/runCharts.ts'
import { planBarGeometry } from '../../shared/domain/planBars.ts'
import type { Activity, PlanSession, Units } from '../../shared/types.ts'
import styles from './PlanBars.module.css'

interface Pair {
  measure: BarMeasure
  planned: number
  ran: number
}

/** The measures the session planned and the run has: time always, distance where both state it. */
function pairsOf(
  session: Pick<PlanSession, 'durationMin' | 'distanceM'>,
  activity: Pick<Activity, 'type' | 'durationSec' | 'distanceM'>,
): Pair[] {
  const pairs: Pair[] = [
    { measure: 'time', planned: session.durationMin * 60, ran: activity.durationSec },
  ]
  const isRun = activity.type === 'run' || activity.type === 'race'
  if (isRun && (session.distanceM ?? 0) > 0 && (activity.distanceM ?? 0) > 0) {
    pairs.push({
      measure: 'distance',
      planned: session.distanceM ?? 0,
      ran: activity.distanceM ?? 0,
    })
  }
  return pairs.filter((pair) => planBarGeometry(pair.planned, pair.ran) !== null)
}

const pct = (fraction: number): string => `${String(fraction * 100)}%`

/**
 * What the session planned and what the run was, two horizontal bars per measure: the plan as an
 * outline, the run as a solid bar, and what went past the plan hatched. No tick, check mark,
 * percentage or "met": a target is a sketch. Each pair has an accessible name and the figures are
 * also in a hidden table. Renders nothing when there is nothing to set side by side.
 */
export function PlanBars({
  session,
  activity,
  units,
}: {
  session: Pick<PlanSession, 'durationMin' | 'distanceM'>
  activity: Pick<Activity, 'type' | 'durationSec' | 'distanceM'>
  units: Units
}) {
  const pairs = pairsOf(session, activity)
  if (pairs.length === 0) return null
  const anyOvershoot = pairs.some(
    (pair) => planBarGeometry(pair.planned, pair.ran)?.overshoot != null,
  )
  return (
    <figure className={styles.bars}>
      {pairs.map((pair) => {
        const geometry = planBarGeometry(pair.planned, pair.ran)
        if (geometry === null) return null
        return (
          <div
            key={pair.measure}
            role="img"
            aria-label={barPairName(pair.measure, pair.planned, pair.ran, units)}
            className={styles.pair}
          >
            <span className={styles.measure} aria-hidden="true">
              {BAR_MEASURE_LABEL[pair.measure]}
            </span>
            <div className={styles.row} aria-hidden="true">
              <span className={styles.name}>Planned</span>
              <span className={styles.track}>
                <span className={styles.outline} style={{ width: pct(geometry.planned) }} />
              </span>
              <span className={styles.value}>{barFigure(pair.measure, pair.planned, units)}</span>
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
              <span className={styles.value}>{barFigure(pair.measure, pair.ran, units)}</span>
            </div>
          </div>
        )
      })}
      <figcaption className={styles.caption}>
        {anyOvershoot ? `${BARS_CAPTION} ${BARS_OVERSHOOT_CAPTION}` : BARS_CAPTION}
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
            {pairs.map((pair) => (
              <tr key={pair.measure}>
                <th scope="row">{BAR_MEASURE_LABEL[pair.measure]}</th>
                <td>{barFigure(pair.measure, pair.planned, units)}</td>
                <td>{barFigure(pair.measure, pair.ran, units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
