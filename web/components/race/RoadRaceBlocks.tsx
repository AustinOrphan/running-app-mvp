import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { describeRoadRacePlan, type RoadFluidText } from '../../../shared/copy/racePlanRoad.ts'
import type { RoadRacePlan } from '../../../shared/engine/racePlanRoad.ts'
import type { Units } from '../../../shared/types.ts'
import { rulesRef } from '../../api/explain.ts'
import { ExplainButton } from '../ExplainButton.tsx'
import { EahCard } from '../fuel/EahCard.tsx'
import { DisclaimerNote } from '../today/DisclaimerNote.tsx'
import { RaceFuelBlock, RaceWeekBlock } from './RaceBlocks.tsx'
import styles from './Race.module.css'

/**
 * The fluid lines of a road race the fuel ladder gives no rate for (a half under 2 hours): the fact
 * that the ladder counts longer runs, the drink-to-thirst line, the link to the Fuel lab and the
 * safety card. It states no rate and holds no nausea disclosure. The words are
 * `describeRoadRacePlan`'s and `describeRoadRaceSummary`'s, so this lays them out and writes none.
 */
export function RoadFluidBlock({ text, stronger }: { text: RoadFluidText; stronger: boolean }) {
  return (
    <>
      {text.short.map((line) => (
        <p key={line} className={styles.note}>
          {line}
        </p>
      ))}
      <p className={styles.note}>{text.fluid}</p>
      <Link to="/fuel" className={styles.link}>
        {text.labLink}
      </Link>
      <EahCard card={{ stronger, heading: text.eah.heading, lines: text.eah.lines }} />
    </>
  )
}

/**
 * The road race plan (rule H15, ADR 0023) of a 10 km, half marathon or marathon goal, as the
 * sections of the Race page: the expected time, the average pace, the first half, heat, fuel and
 * fluid, race week and what the plan leaves out. A block shows only when the plan holds it (the
 * pace and first half are null off a road course and the fuel and race week below their
 * thresholds), so this decides nothing: it renders the one `describeRoadRacePlan` object.
 */
export function RoadRaceBlocks({ plan, units }: { plan: RoadRacePlan; units: Units }) {
  const text = useMemo(() => describeRoadRacePlan(plan, units), [plan, units])
  const { expected, pace, firstHalf, heat, fuel, fluid, raceWeek, notIn } = text
  const fuelHeading = fuel?.heading ?? fluid?.heading ?? null
  // The fluid block already says that the ladder gives no rate; the list does not say it twice.
  const notices = text.notices.filter((notice) => !(fluid?.short ?? []).includes(notice.text))
  return (
    <>
      <section className={styles.section} aria-labelledby="road-expected">
        <h2 id="road-expected" className={styles.heading}>
          {expected.heading}
        </h2>
        <p className={`${styles.figure} figure-type`}>{expected.figure}</p>
        <p className={styles.text}>{expected.source}</p>
        {expected.clock === null ? null : <p className={styles.text}>{expected.clock}</p>}
        {expected.goal === null ? null : <p className={styles.text}>{expected.goal}</p>}
        {notices.length === 0 ? null : (
          <div className={styles.firm}>
            <h3 className={styles.subheading}>{text.firmHeading}</h3>
            <ul className={styles.firmList}>
              {notices.map((notice) => (
                <li key={notice.text}>
                  <span>{notice.text}</span>
                  {notice.link === null || notice.to === null ? null : (
                    <>
                      {' '}
                      <Link className={styles.firmLink} to={`/${notice.to}`}>
                        {notice.link}
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <details className={styles.nausea}>
          <summary className={styles.summary}>{text.aboutRanges}</summary>
          {[...expected.notes, text.sketch].map((note) => (
            <p key={note} className={styles.note}>
              {note}
            </p>
          ))}
        </details>
        <div>
          <ExplainButton
            subject="the expected time"
            rules={plan.expected.rules}
            explain={rulesRef(plan.expected.rules)}
          />
        </div>
      </section>

      {pace === null || plan.pace === null ? null : (
        <section className={styles.section} aria-labelledby="road-pace">
          <h2 id="road-pace" className={styles.heading}>
            {pace.heading}
          </h2>
          <p className={styles.text}>{pace.range}</p>
          <p className={styles.text}>{pace.finding}</p>
          {pace.notes.map((note) => (
            <p key={note} className={styles.note}>
              {note}
            </p>
          ))}
          <div>
            <ExplainButton
              subject="the average pace"
              rules={plan.pace.rules}
              explain={rulesRef(plan.pace.rules)}
            />
          </div>
        </section>
      )}

      {firstHalf === null || plan.firstHalf === null ? null : (
        <section className={styles.section} aria-labelledby="road-first-half">
          <h2 id="road-first-half" className={styles.heading}>
            {firstHalf.heading}
          </h2>
          <p className={styles.text}>{firstHalf.population}</p>
          <p className={styles.text}>{firstHalf.figure}</p>
          {firstHalf.notes.map((note) => (
            <p key={note} className={styles.note}>
              {note}
            </p>
          ))}
          <div>
            <ExplainButton
              subject="the first-half finding"
              rules={plan.firstHalf.rules}
              explain={rulesRef(plan.firstHalf.rules)}
            />
          </div>
        </section>
      )}

      {heat.length === 0 ? null : (
        <section className={styles.section} aria-labelledby="road-heat">
          <h2 id="road-heat" className={styles.heading}>
            {text.heatHeading}
          </h2>
          {heat.map((line) => (
            <p key={line} className={styles.text}>
              {line}
            </p>
          ))}
          <div>
            <ExplainButton
              subject="the heat line"
              rules={plan.heat.rules}
              explain={rulesRef(plan.heat.rules)}
            />
          </div>
        </section>
      )}

      {fuelHeading === null ? null : (
        <section className={styles.section} aria-labelledby="road-fuel">
          <h2 id="road-fuel" className={styles.heading}>
            {fuelHeading}
          </h2>
          {fuel !== null && plan.fuel !== null ? (
            <RaceFuelBlock
              text={fuel}
              stronger={plan.eahStronger}
              full
              floor={plan.fuel.basis === 'floor'}
            />
          ) : fluid === null ? null : (
            <RoadFluidBlock text={fluid} stronger={plan.eahStronger} />
          )}
          <div>
            <ExplainButton
              subject="the race fuel"
              rules={[...(plan.fuel?.rules ?? []), ...(plan.fluid?.rules ?? [])]}
              explain={rulesRef([...(plan.fuel?.rules ?? []), ...(plan.fluid?.rules ?? [])])}
            />
          </div>
        </section>
      )}

      {raceWeek === null || plan.raceWeek === null ? null : (
        <section className={styles.section} aria-labelledby="road-week">
          <h2 id="road-week" className={styles.heading}>
            {raceWeek.heading}
          </h2>
          <RaceWeekBlock week={raceWeek} full />
          {raceWeek.extra === null ? null : <p className={styles.note}>{raceWeek.extra}</p>}
          <div>
            <ExplainButton
              subject="the race week"
              rules={plan.raceWeek.rules}
              explain={rulesRef(plan.raceWeek.rules)}
            />
          </div>
        </section>
      )}

      <section className={styles.section} aria-labelledby="road-not-in">
        <h2 id="road-not-in" className={styles.heading}>
          {notIn.heading}
        </h2>
        <ul className={styles.list}>
          {notIn.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <DisclaimerNote />
    </>
  )
}
