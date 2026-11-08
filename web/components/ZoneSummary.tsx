import type { Boundary, ZoneSet } from '../../shared/engine/types.ts'
import type { Units } from '../../shared/types.ts'
import {
  BOUNDARY_SOURCE_LABELS,
  bpmRangeText,
  bpmText,
  paceRangeText,
  paceText,
} from './zoneFormat.ts'
import styles from './ZoneSummary.module.css'

const ZONE_ROWS: Array<{
  label: string
  pick: (zones: ZoneSet) => Boundary | null
  show: (value: number, units: Units) => string
}> = [
  { label: 'Maximum heart rate', pick: (z) => z.hrMax, show: (v) => bpmText(v) },
  { label: 'Easy heart rate limit', pick: (z) => z.lt1Hr, show: (v) => bpmText(v) },
  { label: 'Threshold heart rate', pick: (z) => z.lt2Hr, show: (v) => bpmText(v) },
  { label: 'Critical speed', pick: (z) => z.csMps, show: (v, u) => paceText(1000 / v, u) },
  { label: 'Easy pace limit', pick: (z) => z.lt1PaceSecPerKm, show: (v, u) => paceText(v, u) },
  { label: 'Threshold pace', pick: (z) => z.thresholdPaceSecPerKm, show: (v, u) => paceText(v, u) },
]

const ZONE_NAMES = [
  { key: 'z1', label: 'Zone 1' },
  { key: 'z2', label: 'Zone 2' },
  { key: 'z3', label: 'Zone 3' },
] as const

/**
 * The current zone set: each boundary with its range, the source it came from and the day, then the
 * three zones with their heart rate, pace and effort. The one rendering of the zone set: the Profile
 * and My paces both show it, so the two cannot read the zones differently.
 */
export function ZoneSummary({ set, units }: { set: ZoneSet; units: Units }) {
  return (
    <>
      <ul className={styles.boundaries}>
        {ZONE_ROWS.map((row) => {
          const boundary = row.pick(set)
          return (
            <li key={row.label} className={styles.boundary}>
              <span className={styles.boundaryName}>{row.label}</span>
              {boundary === null ? (
                <span className={styles.note}>Not estimated yet.</span>
              ) : (
                <>
                  <span className={styles.boundaryValue}>{row.show(boundary.value, units)}</span>
                  <span className={styles.note}>
                    {`Range ${row.show(boundary.band[0], units)} to ${row.show(boundary.band[1], units)}`}
                  </span>
                  <span className={styles.note}>
                    {`${BOUNDARY_SOURCE_LABELS[boundary.source]}${boundary.fromTraining === true ? ' (from training)' : ''}, as of ${boundary.asOf}`}
                  </span>
                </>
              )}
            </li>
          )
        })}
      </ul>
      <table className={styles.zoneTable}>
        <thead>
          <tr>
            <th scope="col">Zone</th>
            <th scope="col">Heart rate</th>
            <th scope="col">Pace</th>
            <th scope="col">Effort (1-10)</th>
          </tr>
        </thead>
        <tbody>
          {ZONE_NAMES.map(({ key, label }) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td>{set.hr ? bpmRangeText(set.hr[key]) : 'Not set'}</td>
              <td>{set.pace ? paceRangeText(set.pace[key], units) : 'Not set'}</td>
              <td>{`${String(set.rpe[key][0])} to ${String(set.rpe[key][1])}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
