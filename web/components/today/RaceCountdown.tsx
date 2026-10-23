import { raceEstimateSlots } from '../../../shared/copy/today.ts'
import { renderFact } from '../../../shared/copy/templates.ts'
import type { TodayRace, Units } from '../../../shared/types.ts'
import { formatLongDate, plural } from '../format.ts'
import { ExplainButton } from '../ExplainButton.tsx'
import styles from './RaceCountdown.module.css'

/**
 * Days to the goal race, its name and date, and the finish estimate with its range. When the
 * range has to be wide (an ultra, rule L4) the page says so and why. The estimate is a sketch:
 * the range is part of the answer, never an afterthought.
 */
export function RaceCountdown({ race, units }: { race: TodayRace; units: Units }) {
  const { daysToRace, prediction, range } = race
  return (
    <section aria-label="Race" className={styles.race}>
      <div className={styles.figure}>
        <p className={styles.line}>
          {daysToRace === 0 ? (
            <span className={styles.number}>Race day</span>
          ) : (
            <>
              <span className={styles.number}>{String(daysToRace)}</span>
              {` ${plural(daysToRace, 'day', 'days')} to the race`}
            </>
          )}
        </p>
        <p className={styles.caption}>
          {`${race.name}, ${formatLongDate(race.targetDate)}${race.dateProvisional ? ', date provisional' : ''}`}
        </p>
      </div>
      {prediction === null ? null : (
        <p className={styles.estimate}>
          {renderFact(
            { template: 'today.race.estimate', slots: raceEstimateSlots(prediction) },
            units,
          )}
        </p>
      )}
      {range?.wide !== true || race.distanceM === null ? null : (
        <div className={styles.wide}>
          <p className={styles.estimate}>
            {renderFact(
              {
                template: 'today.race.wide',
                slots: { distance: { kind: 'distance', m: race.distanceM }, grade: range.grade },
              },
              units,
            )}
          </p>
          <ExplainButton subject="the finish estimate" rules={range.rules} />
        </div>
      )}
    </section>
  )
}
