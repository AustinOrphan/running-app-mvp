import { useMemo } from 'react'
import {
  daysToGoText,
  describeRacePlan,
  raceEmptyText,
  raceOfflineText,
  raceTitleText,
} from '../../shared/copy/racePlan.ts'
import type { RacePlan } from '../../shared/engine/racePlan.ts'
import type { Units } from '../../shared/types.ts'
import { rulesRef } from '../api/explain.ts'
import { useRacePlan } from '../api/race.ts'
import { useSettings } from '../api/settings.ts'
import { ExplainButton } from '../components/ExplainButton.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { RaceFuelBlock, RaceWeekBlock } from '../components/race/RaceBlocks.tsx'
import cardStyles from '../components/race/Race.module.css'
import { DisclaimerNote } from '../components/today/DisclaimerNote.tsx'
import { formatLongDate } from '../components/format.ts'
import styles from './RacePage.module.css'

function PlanBody({ plan, units }: { plan: RacePlan; units: Units }) {
  const text = useMemo(() => describeRacePlan(plan, units), [plan, units])
  const { expected, effort, climbing, heat, raceWeek, dark } = text
  return (
    <div className={styles.page}>
      <section className={cardStyles.section} aria-labelledby="race-expected">
        <h2 id="race-expected" className={cardStyles.heading}>
          {expected.heading}
        </h2>
        <p className={cardStyles.headline}>{expected.headline}</p>
        {expected.clock === null ? null : <p className={cardStyles.text}>{expected.clock}</p>}
        {expected.notes.map((note) => (
          <p key={note} className={cardStyles.note}>
            {note}
          </p>
        ))}
        {text.notices.map((notice) => (
          <p key={notice} className={cardStyles.note}>
            {notice}
          </p>
        ))}
        <p className={cardStyles.note}>{text.sketch}</p>
        <div>
          <ExplainButton
            subject="the expected time"
            rules={plan.expected.rules}
            explain={rulesRef(plan.expected.rules)}
          />
        </div>
      </section>

      <section className={cardStyles.section} aria-labelledby="race-effort">
        <h2 id="race-effort" className={cardStyles.heading}>
          {effort.heading}
        </h2>
        <p className={cardStyles.text}>{effort.instruction}</p>
        <p className={cardStyles.note}>{effort.study}</p>
        <p className={cardStyles.note}>{effort.readingAid}</p>
        <ol className={cardStyles.parts} aria-label={effort.heading}>
          {text.parts.map((part) => (
            <li key={part.label}>
              <article className={cardStyles.part} aria-label={part.label}>
                <h3 className={cardStyles.subheading}>{part.label}</h3>
                <p className={cardStyles.partWindow}>{part.window}</p>
                {part.clock === null ? null : <p className={cardStyles.partWindow}>{part.clock}</p>}
                <p className={cardStyles.text}>{part.instruction}</p>
                {part.heat.map((line) => (
                  <p key={line} className={cardStyles.note}>
                    {line}
                  </p>
                ))}
                {part.dark === null ? null : <p className={cardStyles.note}>{part.dark}</p>}
                <p className={cardStyles.note}>{part.fuel}</p>
                {part.late.map((line) => (
                  <p key={line} className={cardStyles.note}>
                    {line}
                  </p>
                ))}
              </article>
            </li>
          ))}
        </ol>
        <div>
          <ExplainButton
            subject="the race effort"
            rules={plan.effort.rules}
            explain={rulesRef(plan.effort.rules)}
          />
        </div>
      </section>

      {climbing === null || plan.climbing === null ? null : (
        <section className={cardStyles.section} aria-labelledby="race-climbing">
          <h2 id="race-climbing" className={cardStyles.heading}>
            {climbing.heading}
          </h2>
          {climbing.lines.map((line) => (
            <p key={line} className={cardStyles.text}>
              {line}
            </p>
          ))}
          <div>
            <ExplainButton
              subject="the climbing advice"
              rules={plan.climbing.rules}
              explain={rulesRef(plan.climbing.rules)}
            />
          </div>
        </section>
      )}

      <section className={cardStyles.section} aria-labelledby="race-fuel">
        <h2 id="race-fuel" className={cardStyles.heading}>
          {text.fuel.heading}
        </h2>
        <RaceFuelBlock
          text={text.fuel}
          stronger={plan.eahStronger}
          full
          floor={plan.fuel.basis === 'floor'}
        />
        <div>
          <ExplainButton
            subject="the race fuel"
            rules={[...plan.fuel.rules, ...plan.fluid.rules]}
            explain={rulesRef([...plan.fuel.rules, ...plan.fluid.rules])}
          />
        </div>
      </section>

      {heat.length === 0 ? null : (
        <section className={cardStyles.section} aria-labelledby="race-heat">
          <h2 id="race-heat" className={cardStyles.heading}>
            {text.heatHeading}
          </h2>
          {heat.map((line) => (
            <p key={line} className={cardStyles.text}>
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

      {raceWeek === null || plan.raceWeek === null ? null : (
        <section className={cardStyles.section} aria-labelledby="race-week">
          <h2 id="race-week" className={cardStyles.heading}>
            {raceWeek.heading}
          </h2>
          <RaceWeekBlock week={raceWeek} full />
          <div>
            <ExplainButton
              subject="the race week"
              rules={plan.raceWeek.rules}
              explain={rulesRef(plan.raceWeek.rules)}
            />
          </div>
        </section>
      )}

      {dark === null || plan.dark === null ? null : (
        <section className={cardStyles.section} aria-labelledby="race-dark">
          <h2 id="race-dark" className={cardStyles.heading}>
            {dark.heading}
          </h2>
          {dark.lines.map((line) => (
            <p key={line} className={cardStyles.text}>
              {line}
            </p>
          ))}
          <div>
            <ExplainButton
              subject="the dark hours"
              rules={plan.dark.rules}
              explain={rulesRef(plan.dark.rules)}
            />
          </div>
        </section>
      )}

      <DisclaimerNote />
    </div>
  )
}

/**
 * The race plan (`/race`, reached from More and from the race-week card): the expected time as a
 * range, one effort for the whole race in three parts, climbing, fuel and fluid, heat, race week
 * and the hours outside daylight, for the goal race of an ultra. Everything comes from one read of
 * `GET /api/race/plan`; the words are templates over its facts (`describeRacePlan`), so this page
 * works nothing out. It needs a connection; Today's race card shows from the cached Today.
 */
export function RacePage() {
  const race = useRacePlan()
  const settings = useSettings()
  const units = settings.data?.units ?? (settings.isError ? 'km' : undefined)
  const view = race.data
  const plan = view?.plan ?? null
  const context =
    plan === null
      ? undefined
      : `${plan.name}, ${formatLongDate(plan.date)}. ${daysToGoText(plan.daysToRace, units ?? 'km')}.`

  return (
    <>
      <PageHeader title={raceTitleText(units ?? 'km')} context={context} />
      {race.isError ? (
        <p role="alert" className={cardStyles.error}>
          {raceOfflineText(units ?? 'km')}
        </p>
      ) : view === undefined || units === undefined ? (
        <Skeleton lines={6} />
      ) : plan === null ? (
        <p className={cardStyles.text}>{raceEmptyText(view.reason ?? 'no-goal', units)}</p>
      ) : (
        <PlanBody plan={plan} units={units} />
      )}
    </>
  )
}
