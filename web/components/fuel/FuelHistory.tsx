import { useId } from 'react'
import { Link } from 'react-router-dom'
import { rateText } from '../../../shared/engine/fuelCopy.ts'
import type { FuelHistoryRow } from '../../../shared/types.ts'
import { fuelText, labText } from './fuelText.ts'
import labStyles from './FuelLab.module.css'
import styles from './FuelHistory.module.css'

export interface FuelHistoryProps {
  /** The latest logged runs, newest first, each with the sentence its replay gave it. */
  history: FuelHistoryRow[]
}

/**
 * What each logged run did to the ladder, newest first: the run, the rate taken against the rate
 * tried, the two scores and the replayed note. The table scrolls inside a labelled region that
 * takes focus, so a keyboard reaches every row and a phone scrolls sideways inside the box rather
 * than the page. The notes are worked out again on every read, so a late weather fill can change
 * one; the line under the table says so.
 */
export function FuelHistory({ history }: FuelHistoryProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={labStyles.section}>
      <h2 id={headingId} className={labStyles.heading}>
        {labText.historyHeading()}
      </h2>
      {history.length === 0 ? (
        <p className={labStyles.lead}>{labText.historyEmpty()}</p>
      ) : (
        <>
          <div
            role="region"
            aria-label={labText.historyLabel()}
            tabIndex={0}
            className={styles.scroll}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{labText.colRun()}</th>
                  <th scope="col">{labText.colRate()}</th>
                  <th scope="col">{labText.colTarget()}</th>
                  <th scope="col">{fuelText.gutLegend()}</th>
                  <th scope="col">{fuelText.nauseaTerm()}</th>
                  <th scope="col">{labText.colResult()}</th>
                </tr>
              </thead>
              <tbody>
                {history.map(({ log, note }) => (
                  <tr key={log.id}>
                    <th scope="row">
                      <Link to={`/activities/${encodeURIComponent(log.activityId)}`}>
                        {labText.runDate(log.step.date)}
                      </Link>
                    </th>
                    <td>
                      {log.step.rateGPerH === null
                        ? labText.notRecorded()
                        : labText.rateCell(log.step.rateGPerH)}
                    </td>
                    <td>{rateText(log.step.rung)}</td>
                    <td>
                      {log.gut === null ? labText.notRecorded() : fuelText.scoreValue(log.gut)}
                    </td>
                    <td>
                      {log.nausea === null
                        ? labText.notAnswered()
                        : fuelText.scoreValue(log.nausea)}
                    </td>
                    <td className={styles.result}>{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={labStyles.note}>{labText.historyNote()}</p>
        </>
      )}
    </section>
  )
}
