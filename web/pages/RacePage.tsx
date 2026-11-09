import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  daysToGoText,
  describeRaceCard,
  describeRaceProfileHeading,
  describeRacePlan,
  raceCopyNoteText,
  raceEmptyText,
  raceTitleText,
} from '../../shared/copy/racePlan.ts'
import type { RacePlan } from '../../shared/engine/racePlan.ts'
import { raceProfileFor } from '../../shared/domain/raceProfile.ts'
import type { CourseSilhouettePoint, Units } from '../../shared/types.ts'
import { rulesRef } from '../api/explain.ts'
import { useRacePlan } from '../api/race.ts'
import { useSettings } from '../api/settings.ts'
import { RaceProfileChart } from '../components/charts/lazyCharts.tsx'
import { ErrorState } from '../components/ErrorState.tsx'
import { ExplainButton } from '../components/ExplainButton.tsx'
import { useLoadView } from '../components/loadView.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { useOnline } from '../components/useOnline.ts'
import { Segmented } from '../components/Segmented.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { CheckpointSheet } from '../components/race/CheckpointSheet.tsx'
import { CheckpointTable } from '../components/race/CheckpointTable.tsx'
import { CourseImportButton } from '../components/race/CourseImportButton.tsx'
import type { CourseImport } from '../components/race/courseImport.ts'
import { RaceFuelBlock, RaceWeekBlock } from '../components/race/RaceBlocks.tsx'
import { RaceCard } from '../components/race/RaceCard.tsx'
import cardStyles from '../components/race/Race.module.css'
import { DisclaimerNote } from '../components/today/DisclaimerNote.tsx'
import { usePhoneCopy } from '../components/today/phoneCopy.ts'
import { formatLongDate } from '../components/format.ts'
import styles from './RacePage.module.css'

function PlanBody({
  plan,
  course: courseShape,
  units,
}: {
  plan: RacePlan
  course: CourseSilhouettePoint[] | null | undefined
  units: Units
}) {
  const text = useMemo(() => describeRacePlan(plan, units), [plan, units])
  const { expected, effort, climbing, heat, raceWeek, dark } = text
  const [editing, setEditing] = useState(false)
  // A course read from a file: the editor opens on the rows proposed from it.
  const [course, setCourse] = useState<CourseImport | null>(null)
  // The card is a view of the same page, kept in the address (`?view=card`) so a reload, and the
  // phone's copy of the page, open on it.
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'card' ? 'card' : 'plan'
  const profileHeading = useMemo(() => describeRaceProfileHeading(units), [units])
  const card = useMemo(() => describeRaceCard(plan, units), [plan, units])
  const profile = useMemo(() => raceProfileFor(plan, courseShape), [plan, courseShape])
  return (
    <div className={styles.page}>
      <div className={styles.views}>
        <Segmented
          label={card.viewLabel}
          options={[
            { value: 'plan', label: card.viewPlan },
            { value: 'card', label: card.viewCard },
          ]}
          value={view}
          onChange={(next) => {
            setParams(next === 'card' ? { view: 'card' } : {}, { replace: true })
          }}
        />
      </div>
      {view === 'card' ? <RaceCard plan={plan} units={units} /> : null}
      {view === 'card' ? null : (
        <>
          {profile === null ? null : (
            <section className={cardStyles.section} aria-labelledby="race-profile">
              <h2 id="race-profile" className={cardStyles.heading}>
                {profileHeading}
              </h2>
              <RaceProfileChart profile={profile} units={units} />
            </section>
          )}
          <section className={cardStyles.section} aria-labelledby="race-expected">
            <h2 id="race-expected" className={cardStyles.heading}>
              {expected.heading}
            </h2>
            <p className={`${cardStyles.figure} figure-type`}>{expected.figure}</p>
            <p className={cardStyles.text}>{expected.source}</p>
            {expected.clock === null ? null : <p className={cardStyles.text}>{expected.clock}</p>}
            {text.notices.length === 0 ? null : (
              <div className={cardStyles.firm}>
                <h3 className={cardStyles.subheading}>{text.firmHeading}</h3>
                <ul className={cardStyles.firmList}>
                  {text.notices.map((notice) => (
                    <li key={notice.to + notice.link}>
                      <span>{notice.text}</span>{' '}
                      <Link className={cardStyles.firmLink} to={`/${notice.to}`}>
                        {notice.link}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <details className={cardStyles.nausea}>
              <summary className={cardStyles.summary}>{text.aboutRanges}</summary>
              {[...expected.notes, text.sketch].map((note) => (
                <p key={note} className={cardStyles.note}>
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
                    {part.clock === null ? null : (
                      <p className={cardStyles.partWindow}>{part.clock}</p>
                    )}
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

          <CheckpointTable
            plan={plan}
            units={units}
            onEdit={() => {
              setEditing(true)
            }}
            actions={
              <CourseImportButton
                units={units}
                goalDistanceM={plan.distanceM}
                onRead={(read) => {
                  setCourse(read)
                  setEditing(true)
                }}
              />
            }
          />
          {editing ? (
            <CheckpointSheet
              plan={plan}
              units={units}
              course={course ?? undefined}
              onClose={() => {
                setEditing(false)
                setCourse(null)
              }}
            />
          ) : null}

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

          {text.rehearsal === null || plan.rehearsal === null ? null : (
            <section className={cardStyles.section} aria-labelledby="race-rehearsal">
              <h2 id="race-rehearsal" className={cardStyles.heading}>
                {text.rehearsal.heading}
              </h2>
              {text.rehearsal.lines.map((line) => (
                <p key={line} className={cardStyles.text}>
                  {line}
                </p>
              ))}
              <div>
                <ExplainButton
                  subject="the rehearsal count"
                  rules={plan.rehearsal.rules}
                  explain={rulesRef(plan.rehearsal.rules)}
                />
              </div>
            </section>
          )}

          <DisclaimerNote />
        </>
      )}
    </div>
  )
}

/**
 * The race plan (`/race`, reached from More and from the race-week card): the expected time as a
 * range, one effort for the whole race in three parts, climbing, fuel and fluid, heat, race week
 * and the hours outside daylight, for the goal race of an ultra. Everything comes from one read of
 * `GET /api/race/plan`; the words are templates over its facts (`describeRacePlan`), so this page
 * works nothing out. The read is one the service worker keeps (ADR 0012, addendum), so with no
 * signal the page shows the phone's copy and says when it was saved.
 */
export function RacePage() {
  const race = useRacePlan()
  const raceView = useLoadView(race)
  const settings = useSettings()
  const units = settings.data?.units ?? (settings.isError ? 'km' : undefined)
  const view = race.data
  const plan = view?.plan ?? null
  const phoneCopy = usePhoneCopy(view)
  const online = useOnline()
  const servedFromCache = view?.servedFromCache === true
  const { refetch } = race
  // A page that opened on the phone's copy never saw the browser go offline, so the library does not
  // read the return of the connection as a reconnect: ask again when the browser says it is back.
  useEffect(() => {
    if (online && servedFromCache) void refetch()
  }, [online, servedFromCache, refetch])
  // A saved copy cannot know how many days are left, so it names the race and the date alone.
  const context =
    plan === null
      ? undefined
      : phoneCopy
        ? `${plan.name}, ${formatLongDate(plan.date)}.`
        : `${plan.name}, ${formatLongDate(plan.date)}. ${daysToGoText(plan.daysToRace, units ?? 'km')}.`

  return (
    <>
      <PageHeader title={raceTitleText(units ?? 'km')} context={context} />
      {/* Always on the page and empty while the answer is the server's, so a note that appears is
          announced (the same region as Today's). */}
      <div aria-live="polite" aria-atomic="true" className={styles.copyNote}>
        {phoneCopy && view !== undefined ? (
          <p className={cardStyles.note}>
            {raceCopyNoteText(view.savedAt, new Date(), units ?? 'km')}
          </p>
        ) : null}
      </div>
      {raceView === 'failed' || raceView === 'retrying' ? (
        <ErrorState
          subject="The race plan"
          onRetry={() => race.refetch()}
          retrying={raceView === 'retrying'}
        />
      ) : view === undefined || units === undefined ? (
        <Skeleton lines={6} />
      ) : plan === null ? (
        <p className={cardStyles.text}>{raceEmptyText(view.reason ?? 'no-goal', units)}</p>
      ) : (
        <PlanBody plan={plan} course={view.course} units={units} />
      )}
    </>
  )
}
