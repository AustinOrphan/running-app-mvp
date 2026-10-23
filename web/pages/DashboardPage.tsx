import { useRef } from 'react'
import { Link } from 'react-router-dom'
import type { ReadinessVerdict, TodayCoach } from '../../shared/types.ts'
import { useSettings } from '../api/settings.ts'
import { checkinUrl } from '../api/checkins.ts'
import { useToday } from '../api/today.ts'
import buttonStyles from '../components/Button.module.css'
import { formatWeekdayDate } from '../components/format.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { ChangeLine } from '../components/today/ChangeLine.tsx'
import { CheckinRow } from '../components/today/CheckinRow.tsx'
import { DataHealth } from '../components/today/DataHealth.tsx'
import { DisclaimerNote } from '../components/today/DisclaimerNote.tsx'
import { FeedbackCard } from '../components/today/FeedbackCard.tsx'
import { HealthNotes } from '../components/today/HealthNotes.tsx'
import { History } from '../components/today/History.tsx'
import { PlanNotice } from '../components/today/PlanNotice.tsx'
import { RaceCountdown } from '../components/today/RaceCountdown.tsx'
import { ReadinessRead } from '../components/today/ReadinessRead.tsx'
import { NoSession, SessionHero } from '../components/today/SessionHero.tsx'
import { TodaySkeleton } from '../components/today/TodaySkeleton.tsx'
import { TodaySlot } from '../components/today/TodaySlot.tsx'
import { WeekStrip } from '../components/today/WeekStrip.tsx'
import { useToast } from '../components/Toast.tsx'
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

/**
 * Today: one coach payload (`GET /api/today`) and the settings render the first screen. The
 * readiness read and the session lead; the week, the update line, the race and the rest follow.
 * The history sections read their own data once they come near the viewport.
 */
export function DashboardPage() {
  const todayView = useToday()
  const settings = useSettings()
  const toast = useToast()
  const outbox = useOutboxState()
  const verdict = useRef<HTMLParagraphElement>(null)

  const header = (context?: string) => (
    <PageHeader
      title="Today"
      context={context}
      actions={
        <Link
          to="/activities?new=1"
          className={`${buttonStyles.button} ${buttonStyles.quiet} ${styles.log}`}
        >
          Log activity
        </Link>
      }
    />
  )

  if (todayView.isError || settings.isError) {
    return (
      <>
        {header()}
        <p role="alert">Today did not load. Reload the page to try again.</p>
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
  const waiting = outbox.entries.some((entry) => entry.url === checkinUrl(view.date))
  const verdictShown =
    waiting && coach.verdict?.code === 'no-signals' ? SAVED_ON_PHONE : coach.verdict

  return (
    <>
      {header(formatWeekdayDate(view.date))}
      <div className={styles.page}>
        <HealthNotes flags={view.readiness.redFlags} notes={coach.health.notes} units={units} />
        <TodaySlot name="disruption" />

        <ReadinessRead
          verdict={verdictShown}
          signals={coach.signals}
          units={units}
          verdictRef={verdict}
        >
          {coach.preview ? undefined : (
            <CheckinRow
              key={view.date}
              date={view.date}
              checkin={view.checkin}
              boneActive={view.readiness.redFlags.some((flag) => flag.code === 'focal-bone-pain')}
              units={units}
              onAnswered={() => {
                verdict.current?.focus()
              }}
            />
          )}
        </ReadinessRead>
        {coach.hero !== null ? (
          <SessionHero hero={coach.hero} heat={view.heat} next={coach.next} units={units} />
        ) : planned ? (
          <NoSession next={coach.next} units={units} />
        ) : null}
        <PlanNotice
          hasPlan={planned}
          weekInPlan={coach.weekStrip?.targetRunMin != null}
          hasGoal={coach.race !== null}
        />

        {coach.weekStrip === null ? null : <WeekStrip strip={coach.weekStrip} units={units} />}
        <TodaySlot name="brief">
          {coach.change === null ? null : <ChangeLine change={coach.change} units={units} />}
        </TodaySlot>
        <TodaySlot name="fuelPrompt" />

        <FeedbackCard
          unrated={view.unrated}
          units={units}
          onSaved={() => {
            toast.show('Feedback saved')
          }}
        />
        {coach.race === null ? null : <RaceCountdown race={coach.race} units={units} />}
        <DataHealth health={coach.health} />
        <History today={view.date} units={units} />
        <DisclaimerNote />
      </div>
    </>
  )
}
