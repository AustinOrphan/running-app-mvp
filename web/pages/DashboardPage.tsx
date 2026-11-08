import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { showWeekAdvisory } from '../../shared/domain/weekStrip.ts'
import { isOpen } from '../../shared/domain/windowDay.ts'
import type { ReadinessVerdict, TodayCoach } from '../../shared/types.ts'
import { useSettings } from '../api/settings.ts'
import { checkinUrl } from '../api/checkins.ts'
import { useServerToday } from '../api/today.ts'
import buttonStyles from '../components/Button.module.css'
import { ErrorState } from '../components/ErrorState.tsx'
import { combineQueries, useLoadView } from '../components/loadView.ts'
import { briefLeads } from '../components/BriefLine.tsx'
import { formatWeekdayDate } from '../components/format.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { CheckRunsButton, CheckRunsNote } from '../components/today/CheckRuns.tsx'
import { useCheckRuns, type CheckRuns as CheckRunsState } from '../components/today/checkRuns.ts'
import { CheckinRow } from '../components/today/CheckinRow.tsx'
import { DataHealth } from '../components/today/DataHealth.tsx'
import { DisclaimerNote } from '../components/today/DisclaimerNote.tsx'
import { ActivityNotices } from '../components/today/ActivityNotices.tsx'
import { FeedbackCard } from '../components/today/FeedbackCard.tsx'
import { HealthNotes } from '../components/today/HealthNotes.tsx'
import { History } from '../components/today/History.tsx'
import { isRunLike } from '../components/today/RunRating.tsx'
import { MondayBrief } from '../components/today/MondayBrief.tsx'
import { OfflineNote } from '../components/today/OfflineNote.tsx'
import { dayState, usePhoneCopy } from '../components/today/phoneCopy.ts'
import { PlanNotice } from '../components/today/PlanNotice.tsx'
import { RaceCountdown } from '../components/today/RaceCountdown.tsx'
import { ReadinessRead } from '../components/today/ReadinessRead.tsx'
import { NoSession, SessionHero } from '../components/today/SessionHero.tsx'
import { TodaySkeleton } from '../components/today/TodaySkeleton.tsx'
import { TodaySlot } from '../components/today/TodaySlot.tsx'
import { WeekStrip } from '../components/today/WeekStrip.tsx'
import { useToast } from '../components/Toast.tsx'
import { useMediaQuery } from '../components/useMediaQuery.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { useOutboxState } from '../pwa/outbox.ts'
import styles from './DashboardPage.module.css'

/**
 * Whether the runner has a plan, read from what the payload carries: a session today or next, a
 * session in the week, or a target for the week. A plan whose sessions all lie in the past reads
 * as none, which is the right prompt after a finished plan too.
 */
function hasPlan(coach: TodayCoach): boolean {
  const strip = coach.weekStrip
  return (
    coach.hero !== null ||
    coach.next !== null ||
    (strip?.targetRunMin ?? null) !== null ||
    (strip?.days.some((day) => day.sessions.length > 0) ?? false)
  )
}

/**
 * The verdict while a check-in waits on the phone and the server has no signal yet. "One tap below
 * adds the first" would promise a control that has just been used, so the verdict says where the
 * answer is instead.
 */
const SAVED_ON_PHONE: ReadinessVerdict = {
  code: 'no-signals',
  template: 'today.checkin.verdict-queued',
  slots: {},
}

/** Two columns from the width at which the side rail replaces the tab bar (spec 7.6). */
const TWO_COLUMNS = '(min-width: 900px)'

function TodayHeader({ context, checkRuns }: { context?: string; checkRuns?: CheckRunsState }) {
  return (
    <>
      <PageHeader
        title="Today"
        context={context}
        inlineActions
        actions={
          <>
            {checkRuns === undefined ? null : <CheckRunsButton state={checkRuns} />}
            <Link
              to="/activities?new=1"
              className={`${buttonStyles.button} ${buttonStyles.quiet} ${styles.log}`}
            >
              Log activity
            </Link>
          </>
        }
      />
      {checkRuns === undefined ? null : <CheckRunsNote state={checkRuns} />}
    </>
  )
}

/** The header with the "Check for new runs" control, which reads the connected services. */
function HeaderWithCheck({ context }: { context?: string }) {
  const checkRuns = useCheckRuns()
  return <TodayHeader context={context} checkRuns={checkRuns} />
}

/**
 * Today: one coach payload (`GET /api/today`) and the settings render the first screen. The
 * readiness read and the session lead; the week, the update line, the race and the rest follow.
 * The history sections read their own data once they come near the viewport.
 *
 * The sections sit in two groups that stack on a phone in the order below and stand side by side
 * from 900 px: the session group (slot, readiness, hero) on the left and the week group on the
 * right. The groups stay in one order in the DOM at every width and nothing is placed with CSS
 * `order`, so tab order follows the picture: the whole session group first, then the week.
 */
export function DashboardPage() {
  const todayView = useServerToday()
  const twoColumns = useMediaQuery(TWO_COLUMNS)
  const settings = useSettings()
  const toast = useToast()
  const outbox = useOutboxState()
  const phoneCopy = usePhoneCopy(todayView.data)
  const verdict = useRef<HTMLParagraphElement>(null)
  const loads = combineQueries([todayView, settings])
  const loadView = useLoadView(loads)

  // The check control asks the server for the connected services, so it joins the header only once
  // the first screen is on the page: the payload and the settings are the first screen's reads.
  const header = (context?: string, live = false) =>
    live ? <HeaderWithCheck context={context} /> : <TodayHeader context={context} />

  // A read that fails after one that worked (the midnight refetch with the connection down) keeps
  // the last payload on the page, and so does the phone's saved copy: the error replaces the page
  // only when there is nothing to show, and the same state stays through a retry.
  if (loadView === 'failed' || loadView === 'retrying') {
    return (
      <>
        {header()}
        <ErrorState subject="Today" onRetry={loads.retry} retrying={loadView === 'retrying'} />
      </>
    )
  }
  if (todayView.data === undefined || settings.data === undefined) {
    return (
      <>
        {header()}
        <TodaySkeleton />
      </>
    )
  }

  const view = todayView.data
  const { coach } = view
  const units = settings.data.units
  const planned = hasPlan(coach)
  // Which day the payload is for: a day ahead has no check-in yet, and a copy of a day that is
  // over is read-only (an answer would be filed under that day, and Done would log against it).
  const day = dayState(view, phoneCopy)
  const waiting = outbox.entries.some((entry) => entry.url === checkinUrl(view.date))
  // The hero asks about the run logged against today's session, so the card below leaves it out.
  const heroAsksRating =
    day !== 'past' &&
    coach.hero !== null &&
    coach.hero.advice !== 'rest' &&
    coach.hero.session.kind !== 'rest' &&
    coach.hero.linkedRun !== null &&
    isRunLike(coach.hero.linkedRun)
  // An unopened brief with changes stands under the session hero. The brief is the server's, which the
  // phone's copy of an earlier day may no longer match, so the copy keeps the quiet line (none).
  const leadingBrief =
    !phoneCopy && day === 'today' && briefLeads(coach.slots.brief) ? coach.slots.brief : null
  const verdictShown =
    waiting && coach.verdict?.code === 'no-signals' ? SAVED_ON_PHONE : coach.verdict

  // A rest day: nothing to run, so on a desktop the week and its meter move up under the "Next:"
  // line (the left column), and the check-in and the rest stand in the right column as an aside. A
  // phone keeps one column in the order of the session first.
  // Read from the planned day, not from today's advice: a check-in can turn the advice to rest, and
  // the layout must not swap under the runner (the check-in row would remount and lose its focus).
  const restDay = coach.hero === null ? planned : coach.hero.session.kind === 'rest'
  const weekStrip =
    coach.weekStrip === null ? null : (
      <WeekStrip
        strip={coach.weekStrip}
        units={units}
        advisory={showWeekAdvisory({
          windowOpen: coach.disruptions.some(isOpen),
          heroKind: coach.hero?.session.kind ?? null,
          verdictCode: coach.verdict?.code ?? null,
        })}
      />
    )
  const sessionBlock =
    coach.hero !== null ? (
      <SessionHero
        hero={coach.hero}
        heat={view.heat}
        next={coach.next}
        units={units}
        readOnly={day === 'past'}
      />
    ) : planned ? (
      <NoSession next={coach.next} units={units} />
    ) : null
  // Under the session and over the readiness read: the session leads, and a plan that changed
  // overnight is read before the check-in.
  const briefBlock =
    leadingBrief === null ? null : (
      <MondayBrief item={leadingBrief} reviewDue={coach.health.lastWeekReady} units={units} />
    )
  // Under the session, not over it: the note has no height budget, and above Done it would push
  // Done past the fold (ADR 0012).
  const offlineBlock = <OfflineNote view={view} units={units} />
  const readinessBlock = (
    <ReadinessRead
      verdict={verdictShown}
      signals={coach.signals}
      units={units}
      verdictRef={verdict}
    >
      {day !== 'today' ? undefined : (
        <CheckinRow
          key={view.date}
          date={view.date}
          checkin={view.checkin}
          boneActive={view.readiness.redFlags.some((flag) => flag.code === 'focal-bone-pain')}
          windowOpen={coach.disruptions.some(isOpen)}
          units={units}
          onAnswered={() => {
            verdict.current?.focus()
          }}
        />
      )}
    </ReadinessRead>
  )
  const planNotice = (
    <PlanNotice
      hasPlan={planned}
      weekInPlan={coach.weekStrip?.targetRunMin != null}
      hasGoal={coach.race !== null}
    />
  )
  const feedbackBlock = (
    <FeedbackCard
      unrated={view.unrated}
      units={units}
      exclude={heroAsksRating ? (coach.hero?.linkedRun?.id ?? null) : null}
      onSaved={(landed) => {
        toast.show(
          landed === 'queued'
            ? render(TEMPLATES['today.rate.queued'], {}, units)
            : 'Feedback saved',
        )
      }}
    />
  )
  const raceBlock = coach.race === null ? null : <RaceCountdown race={coach.race} units={units} />
  const healthBlock = <DataHealth health={coach.health} reviewShownAbove={leadingBrief !== null} />
  const restColumns = twoColumns && restDay

  return (
    <>
      {header(formatWeekdayDate(view.date), true)}
      <div className={styles.page}>
        <HealthNotes flags={view.readiness.redFlags} notes={coach.health.notes} units={units} />
        <div
          className={styles.columns}
          data-layout={twoColumns ? 'two' : 'one'}
          data-day={restColumns ? 'rest' : undefined}
        >
          {restColumns ? (
            <>
              <div className={styles.column}>
                <TodaySlot name="disruption" />
                {sessionBlock}
                <ActivityNotices />
                {weekStrip}
                {briefBlock}
                {offlineBlock}
                <TodaySlot name="brief" />
              </div>
              <div className={styles.column}>
                {readinessBlock}
                {planNotice}
                <TodaySlot name="race" />
                <TodaySlot name="fuelPrompt" />
                {feedbackBlock}
                {raceBlock}
                {healthBlock}
              </div>
            </>
          ) : (
            <>
              <div className={styles.column}>
                <TodaySlot name="disruption" />
                {sessionBlock}
                <ActivityNotices />
                {briefBlock}
                {offlineBlock}
                {readinessBlock}
                {planNotice}
              </div>
              <div className={styles.column}>
                {weekStrip}
                <TodaySlot name="brief" />
                <TodaySlot name="race" />
                <TodaySlot name="fuelPrompt" />
                {feedbackBlock}
                {raceBlock}
                {healthBlock}
              </div>
            </>
          )}
        </div>
        <History today={view.date} units={units} />
        <DisclaimerNote />
      </div>
    </>
  )
}
