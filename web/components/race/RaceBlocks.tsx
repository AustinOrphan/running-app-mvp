import { Link } from 'react-router-dom'
import type { RaceFuelText, RaceWeekText } from '../../../shared/copy/racePlan.ts'
import { EahCard } from '../fuel/EahCard.tsx'
import styles from './Race.module.css'

export interface RaceFuelBlockProps {
  text: RaceFuelText
  /** The stronger safety card (over `n7.eahStrongerAlertHours` hours, or heat). */
  stronger: boolean
  /** The whole block with the totals and the carry line (the page), or the race-day lines only. */
  full: boolean
  /** Whether the rate is the floor, so the block points to the Fuel lab. */
  floor: boolean
}

/**
 * The fuel and fluid lines of the race plan: the rate and why, the low-certainty and several-kinds
 * lines, the few-hours label and the hot-race label, the totals on the page, thirst-led fluid, the
 * nausea plan in a disclosure, and the safety card. The words are `describeRaceFuel`'s, shared
 * with the Today block and the race-day sheet, so this lays them out and writes none.
 */
export function RaceFuelBlock({ text, stronger, full, floor }: RaceFuelBlockProps) {
  return (
    <>
      <p className={styles.text}>{text.rate}</p>
      <p className={styles.note}>{text.basis}</p>
      {text.certainty === null ? null : <p className={styles.note}>{text.certainty}</p>}
      {text.multiCarb === null ? null : <p className={styles.note}>{text.multiCarb}</p>}
      {text.fewHours === null ? null : <p className={styles.note}>{text.fewHours}</p>}
      {text.hot === null ? null : <p className={styles.note}>{text.hot}</p>}
      {full ? <p className={styles.text}>{text.total}</p> : null}
      {full && text.carry !== null ? <p className={styles.note}>{text.carry}</p> : null}
      {text.aid === null ? null : <p className={styles.note}>{text.aid}</p>}
      <p className={styles.note}>{text.fluid}</p>
      {floor ? (
        <Link to="/fuel" className={styles.link}>
          {text.labLink}
        </Link>
      ) : null}
      <details className={styles.nausea} open={text.nausea.open}>
        <summary className={styles.summary}>{text.nausea.heading}</summary>
        <ul className={styles.plan}>
          {text.nausea.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <EahCard card={{ stronger, heading: text.eah.heading, lines: text.eah.lines }} />
    </>
  )
}

/** The race-week lines (rule K6): the carbohydrate range and the grams, the days, the evidence. */
export function RaceWeekBlock({ week, full }: { week: RaceWeekText; full: boolean }) {
  return (
    <>
      <p className={styles.text}>{week.carb}</p>
      <p className={styles.text}>{week.carbMass}</p>
      {full ? (
        <>
          <p className={styles.note}>{week.days}</p>
          <p className={styles.note}>{week.evidence}</p>
          <p className={styles.note}>{week.shake}</p>
          {week.heat.map((line) => (
            <p key={line} className={styles.note}>
              {line}
            </p>
          ))}
          <p className={styles.note}>{week.fluid}</p>
        </>
      ) : null}
    </>
  )
}
