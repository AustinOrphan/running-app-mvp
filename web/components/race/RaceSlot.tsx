import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { describeRaceSummary } from '../../../shared/copy/racePlan.ts'
import type { RacePlanSummary } from '../../../shared/engine/racePlan.ts'
import type { Units } from '../../../shared/types.ts'
import styles from './Race.module.css'

/**
 * The race-week card of Today (slot `race`, week group, below the fold and unbudgeted): the days to
 * go, the carbohydrate line from two days before, and a link to the plan. On the race day it adds
 * the effort sentence. The words are `describeRaceSummary`'s, cut from the same plan as the page,
 * so a copy of Today kept offline shows the card without a request.
 */
export function RaceSlot({ summary, units }: { summary: RacePlanSummary; units: Units }) {
  const text = useMemo(() => describeRaceSummary(summary, units), [summary, units])
  return (
    <section className={styles.card} aria-label={text.heading}>
      <h2 className={styles.cardTitle}>{text.daysToGo}</h2>
      {summary.daysToRace === 0 ? <p className={styles.text}>{text.instruction}</p> : null}
      {text.carb === null ? null : <p className={styles.text}>{text.carb}</p>}
      <Link to="/race" className={styles.link}>
        {text.open}
      </Link>
    </section>
  )
}
