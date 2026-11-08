import { useId } from 'react'
import { Link } from 'react-router-dom'
import { rateText } from '../../../shared/engine/fuelCopy.ts'
import type { FuelHistoryRow } from '../../../shared/types.ts'
import { ScrollTable } from '../ScrollTable.tsx'
import { useNarrowContainer } from '../useNarrowContainer.ts'
import { fuelText, labText } from './fuelText.ts'
import labStyles from './FuelLab.module.css'
import styles from './FuelHistory.module.css'

/**
 * Below this width of the section the five columns of the table do not fit, and the result is the
 * last one. The section's own width is read, not the window's: the side rail takes room from it.
 */
const STACKED_BELOW_REM = 40

export interface FuelHistoryProps {
  /** The latest logged runs, newest first, each with the sentence its replay gave it. */
  history: FuelHistoryRow[]
}

/**
 * What each logged run did to the ladder, newest first: the run, the rate taken against the rate
 * tried, the two scores and the replayed note. The table scrolls inside a labelled region that
 * takes focus (`ScrollTable`), so a keyboard reaches every row and a phone scrolls sideways inside
 * the box rather than the page. Where the section is under 40 rem wide the table is a list of runs instead, so the result of
 * each is on screen without scrolling. The notes are worked out again on every read, so a late weather fill can change
 * one; the line under the table says so.
 */
export function FuelHistory({ history }: FuelHistoryProps) {
  const headingId = useId()
  const [section, stacked] = useNarrowContainer<HTMLElement>(STACKED_BELOW_REM)
  return (
    <section ref={section} aria-labelledby={headingId} className={labStyles.section}>
      <h2 id={headingId} className={labStyles.heading}>
        {labText.historyHeading()}
      </h2>
      {history.length === 0 ? (
        <p className={labStyles.lead}>{labText.historyEmpty()}</p>
      ) : stacked ? (
        <>
          <ol aria-label={labText.historyLabel()} className={styles.stack}>
            {history.map(({ log, note }) => (
              <li key={log.id} className={styles.run}>
                <Link
                  to={`/activities/${encodeURIComponent(log.activityId)}`}
                  className={styles.date}
                >
                  {labText.runDate(log.step.date)}
                </Link>
                <p className={styles.line}>
                  {labText.historyLine({
                    rateGPerH: log.step.rateGPerH,
                    target: rateText(log.step.rung),
                    gut: log.gut,
                    nausea: log.nausea,
                  })}
                </p>
                <p className={styles.note}>{note}</p>
              </li>
            ))}
          </ol>
          <p className={labStyles.note}>{labText.historyNote()}</p>
        </>
      ) : (
        <>
          <ScrollTable label={labText.historyLabel()} className={styles.scroll}>
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
          </ScrollTable>
          <p className={labStyles.note}>{labText.historyNote()}</p>
        </>
      )}
    </section>
  )
}
