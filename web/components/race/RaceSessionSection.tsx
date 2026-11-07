import { useQuery } from '@tanstack/react-query'
import { useId, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { describeRaceSummary, raceOpenText, raceTitleText } from '../../../shared/copy/racePlan.ts'
import type { PlanSession, TodayView, Units } from '../../../shared/types.ts'
import { keys } from '../../api/client.ts'
import { RaceFuelBlock } from './RaceBlocks.tsx'
import styles from './Race.module.css'

/**
 * The race-day block of the session sheet (rule H14): for the race session of an ultra goal, the
 * effort sentence, the fuel and fluid lines, the safety card and a link to the plan. The lines are
 * the `race` slot of the Today payload the page already holds (read without asking again, so the
 * block shows from a copy of Today kept offline), and they appear only on the race day itself,
 * when the payload's race is this session's day. Opened from another page or day, the block is the
 * link alone.
 */
export function RaceSessionSection({ session, units }: { session: PlanSession; units: Units }) {
  const headingId = useId()
  const today = useQuery<TodayView>({ queryKey: [keys.today], enabled: false }).data
  const summary = today?.coach.slots.race ?? null
  const onRaceDay = summary !== null && summary.daysToRace === 0 && summary.date === session.date
  const text = useMemo(
    () => (onRaceDay ? describeRaceSummary(summary, units) : null),
    [onRaceDay, summary, units],
  )
  return (
    <section aria-labelledby={headingId} className={styles.sheetBlock}>
      <h3 id={headingId} className={styles.subheading}>
        {text === null ? raceTitleText(units) : text.daysToGo}
      </h3>
      {text === null || summary === null ? null : (
        <>
          <p className={styles.text}>{text.instruction}</p>
          <RaceFuelBlock
            text={text.fuel}
            stronger={summary.eahStronger}
            full={false}
            floor={summary.fuel.basis === 'floor'}
          />
        </>
      )}
      <Link to="/race" className={styles.link}>
        {text === null ? raceOpenText(units) : text.open}
      </Link>
    </section>
  )
}
