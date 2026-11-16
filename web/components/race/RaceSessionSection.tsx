import { useQuery } from '@tanstack/react-query'
import { useId, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { describeRaceSummary, raceOpenText, raceTitleText } from '../../../shared/copy/racePlan.ts'
import { describeRoadRaceSummary } from '../../../shared/copy/racePlanRoad.ts'
import type { PlanSession, TodayView, Units } from '../../../shared/types.ts'
import { keys } from '../../api/client.ts'
import { hasRacePlan, useRacePlan } from '../../api/race.ts'
import { RaceFuelBlock } from './RaceBlocks.tsx'
import { RoadFluidBlock } from './RoadRaceBlocks.tsx'
import styles from './Race.module.css'

/**
 * The race-day block of the session sheet (rules H14 and H15): for the race session of an ultra goal,
 * the effort sentence, the fuel and fluid lines, the safety card and a link to the plan; for a road
 * race (ADR 0023), the expected range, then the fuel block or, under the ladder's two hours, the
 * fluid lines, and the link. The lines are the `race` or `roadRace` slot of the Today payload the
 * page already holds (read without asking again, so the block shows from a copy of Today kept
 * offline), and they appear only on the race day itself, when the payload's race is this session's
 * day. Opened from another page or day, the block is the link alone. It shows only when the cached
 * race plan answer holds a plan (`hasRacePlan`): none for a 5 km, and none while the cache is empty.
 */
export function RaceSessionSection({ session, units }: { session: PlanSession; units: Units }) {
  // The cached race plan answer, never a request (`enabled: false`): a goal with no plan (a 5 km)
  // or a cache that does not hold the answer yet shows nothing, not a link to an empty page.
  const plan = useRacePlan({ enabled: false }).data
  const today = useQuery<TodayView>({ queryKey: [keys.today], enabled: false }).data
  const summary = today?.coach.slots.race ?? null
  const road = today?.coach.slots.roadRace ?? null
  const onRaceDay = (race: { daysToRace: number; date: string } | null) =>
    race !== null && race.daysToRace === 0 && race.date === session.date
  if (!hasRacePlan(plan)) return null
  if (summary === null && road !== null && onRaceDay(road)) {
    return <RoadRaceDay units={units} />
  }
  return <UltraRaceDay session={session} units={units} />
}

function UltraRaceDay({ session, units }: { session: PlanSession; units: Units }) {
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

/** The race-day lines of a road race; never calls `describeRaceSummary` on a road summary. */
function RoadRaceDay({ units }: { units: Units }) {
  const headingId = useId()
  const today = useQuery<TodayView>({ queryKey: [keys.today], enabled: false }).data
  const summary = today?.coach.slots.roadRace ?? null
  const text = useMemo(
    () => (summary === null ? null : describeRoadRaceSummary(summary, units)),
    [summary, units],
  )
  if (summary === null || text === null) return null
  return (
    <section aria-labelledby={headingId} className={styles.sheetBlock}>
      <h3 id={headingId} className={styles.subheading}>
        {text.daysToGo}
      </h3>
      <p className={styles.text}>{text.expected}</p>
      {text.expectedNote === null ? null : <p className={styles.note}>{text.expectedNote}</p>}
      {text.fuel !== null ? (
        <RaceFuelBlock
          text={text.fuel}
          stronger={summary.eahStronger}
          full={false}
          floor={summary.fuel?.basis === 'floor'}
        />
      ) : text.fluid === null ? null : (
        <RoadFluidBlock text={text.fluid} stronger={summary.eahStronger} />
      )}
      <Link to="/race" className={styles.link}>
        {text.open}
      </Link>
    </section>
  )
}
