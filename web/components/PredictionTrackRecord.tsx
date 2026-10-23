import { useId } from 'react'
import { useTrackRecord } from '../api/predictions.ts'
import {
  TRACK_RECORD_TEMPLATES,
  differenceCell,
  headlineSentences,
  inRangeCell,
  predictedCell,
  rangeCell,
  summarySentences,
  trackRecordLead,
  trackRecordLoadError,
  unscoredSentence,
} from '../../shared/copy/trackRecord.ts'
import { render } from '../../shared/copy/template.ts'
import type { TrackRecordRace, TrackRecordView, Units } from '../../shared/types.ts'
import { formatDistance, formatDuration } from '../../shared/units.ts'
import { PredictionTrackChart } from './charts/PredictionTrackChart.tsx'
import { formatLongDate } from './format.ts'
import styles from './PredictionTrackRecord.module.css'

const T = TRACK_RECORD_TEMPLATES

/** One race: when it was, the last prediction against the result, the chart and the weekly table. */
function RaceRecord({ race, units }: { race: TrackRecordRace; units: Units }) {
  const captionId = useId()
  const headline = race.headline === null ? null : headlineSentences(race.headline, units)
  const unscored = unscoredSentence(race, units)
  const resultSec = race.outcome === 'finished' ? race.resultSec : null
  const facts = [
    formatLongDate(race.date),
    formatDistance(race.distanceM, units),
    resultSec === null
      ? null
      : `${render(T['track-record.chart.result-line'], {}, units)} ${formatDuration(resultSec)}`,
  ].filter((part): part is string => part !== null)

  return (
    <li className={styles.race}>
      <h3 className={styles.raceName}>{race.goalName}</h3>
      <p className={styles.facts}>{facts.join(' · ')}</p>
      {headline !== null ? <p className={styles.headline}>{headline.join(' ')}</p> : null}
      {resultSec !== null && race.points.length > 0 ? (
        <>
          <PredictionTrackChart
            points={race.points}
            resultSec={resultSec}
            name={render(T['track-record.chart.name'], { race: race.goalName }, units)}
            resultLabel={render(T['track-record.chart.result-line'], {}, units)}
            axisLabel={render(T['track-record.table.weeks-before'], {}, units)}
          />
          <div className={styles.tableWrap} role="region" aria-labelledby={captionId} tabIndex={0}>
            <table className={styles.table}>
              <caption id={captionId} className={styles.caption}>
                {render(T['track-record.table.caption'], { race: race.goalName }, units)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{render(T['track-record.table.weeks-before'], {}, units)}</th>
                  <th scope="col">{render(T['track-record.table.predicted'], {}, units)}</th>
                  <th scope="col">{render(T['track-record.table.range'], {}, units)}</th>
                  <th scope="col">{render(T['track-record.table.difference'], {}, units)}</th>
                  <th scope="col">{render(T['track-record.table.in-range'], {}, units)}</th>
                </tr>
              </thead>
              <tbody>
                {race.points.map((point) => (
                  <tr key={point.weekStart}>
                    <th scope="row">{String(point.weeksBefore)}</th>
                    <td>{predictedCell(point, units)}</td>
                    <td>{rangeCell(point, units)}</td>
                    <td>{differenceCell(point, units)}</td>
                    <td>{inRangeCell(point, units)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {unscored !== null ? <p className={styles.unscored}>{unscored}</p> : null}
    </li>
  )
}

function Loaded({ view, units }: { view: TrackRecordView; units: Units }) {
  return (
    <>
      <p className={styles.lead}>{trackRecordLead(units).join(' ')}</p>
      <p className={styles.summary}>{summarySentences(view.summary, units).join(' ')}</p>
      {view.races.length > 0 ? (
        <ol className={styles.races}>
          {view.races.map((race) => (
            <RaceRecord key={race.goalId} race={race} units={units} />
          ))}
        </ol>
      ) : null}
    </>
  )
}

/**
 * The prediction track record (rule L7): what the weekly predictions said about each recorded race
 * and what happened, newest race first, with a summary across races once there are enough. It
 * describes the predictions, not the runner, so a difference has a direction and no verdict. The
 * chart is imported statically: the section is part of the Goals page, not a lazy chunk.
 */
export function PredictionTrackRecord({ units }: { units: Units }) {
  const headingId = useId()
  const record = useTrackRecord()
  if (record.isPending) return null
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {render(T['track-record.heading'], {}, units)}
      </h2>
      {record.isError ? (
        <p role="alert" className={styles.error}>
          {trackRecordLoadError(units)}
        </p>
      ) : (
        <Loaded view={record.data} units={units} />
      )}
    </section>
  )
}
