import { useId } from 'react'
import type { PlanSession, PlanSessionStatus, TodayView, Units } from '../../../shared/types.ts'
import { formatDistance, formatPace } from '../../../shared/units.ts'
import { formatClimb } from '../format.ts'
import { TodaySlot } from './TodaySlot.tsx'
import { WhyButton } from './WhyButton.tsx'
import styles from './today.module.css'

const STATUS_LABELS: Record<PlanSessionStatus, string | null> = {
  planned: null,
  completed: 'Completed',
  partial: 'Partly done',
  skipped: 'Skipped',
  downgraded: 'Adjusted',
  moved: 'Moved',
  adjusted: 'Shortened',
}

const ADVICE_LINES = {
  'as-planned': null,
  'downgrade-easy': 'An easy run is the better choice today.',
  rest: 'A rest day is the better choice today.',
} as const

/** "9:15 to 10:28 /mi" from sec/km bounds given slow to fast. */
function formatPaceRange(range: [number, number], units: Units): string {
  const [slow, fast] = range
  const bound = (secPerKm: number) => formatPace(secPerKm, 1000, units).split(' /')[0] ?? ''
  return `${bound(fast)} to ${bound(slow)} /${units}`
}

function climbText(gainM: number | null, units: Units): string | null {
  if (gainM === null || gainM <= 0) return null
  return formatClimb(gainM, units)
}

function sessionFigures(
  session: PlanSession,
  units: Units,
): Array<{ label: string; value: string }> {
  const { target } = session
  const figures: Array<{ label: string; value: string | null }> = [
    { label: 'Duration', value: `${String(session.durationMin)} min` },
    {
      label: 'Distance',
      value: session.distanceM === null ? null : formatDistance(session.distanceM, units),
    },
    { label: 'Climb', value: climbText(session.gainM, units) },
    {
      label: 'Pace',
      value: target.paceSecPerKm === null ? null : formatPaceRange(target.paceSecPerKm, units),
    },
    {
      label: 'Heart rate',
      value: target.hr === null ? null : `${String(target.hr[0])} to ${String(target.hr[1])} bpm`,
    },
    { label: 'Effort (RPE)', value: `${String(target.rpe[0])} to ${String(target.rpe[1])}` },
  ]
  return figures.flatMap((f) => (f.value === null ? [] : [{ label: f.label, value: f.value }]))
}

function SessionCard({ entry, units }: { entry: TodayView['sessions'][number]; units: Units }) {
  const { session, advice, reasons } = entry
  const titleId = useId()
  const status = STATUS_LABELS[session.status]
  const adviceLine = ADVICE_LINES[advice]
  return (
    <article aria-labelledby={titleId} className={styles.sessionCard}>
      <div className={styles.sessionHead}>
        <h3 id={titleId} className={styles.sessionTitle}>
          {session.title}
        </h3>
        {status === null ? null : <span className={styles.sessionStatus}>{status}</span>}
      </div>
      <dl className={styles.figureList}>
        {sessionFigures(session, units).map((f) => (
          <div key={f.label} className={styles.figureItem}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      <TodaySlot name="fuel" />
      {session.target.heatNote === null ? null : (
        <p className={styles.caption}>{session.target.heatNote}</p>
      )}
      <p className={styles.purpose}>{session.purpose}</p>
      {adviceLine === null ? null : (
        <div className={styles.advice}>
          <p className={styles.adviceLine}>{adviceLine}</p>
          {reasons.length > 0 ? (
            <ul className={styles.reasons}>
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <div className={styles.cardActions}>
        <WhyButton
          label="Why this session"
          rules={session.rules}
          explain={{ subject: 'session', id: session.id }}
        />
      </div>
      <TodaySlot name="watch" />
    </article>
  )
}

/** J8 defines the fatigue states; J2 makes the check-in their primary input. */
const FATIGUE_RULES = ['J2', 'J8']

export function SessionsSection({
  today,
  units,
}: {
  today: TodayView
  units: Units
  /** Not read: each button owns its drawer. DashboardPage still passes it until E2-5. */
  onWhy?: unknown
}) {
  const headingId = useId()
  const { state } = today.readiness
  const readinessLine =
    state === 'possible-fatigue'
      ? 'Recent signals point to possible fatigue.'
      : state === 'persistent-suppression'
        ? 'Recent signals have stayed low for several days.'
        : null
  if (today.sessions.length === 0 && readinessLine === null) return null
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {"Today's session"}
      </h2>
      {readinessLine === null ? null : (
        <p className={styles.readinessLine}>
          <span>{readinessLine}</span>
          <WhyButton
            label="Why this note"
            rules={FATIGUE_RULES}
            explain={{ subject: 'readiness' }}
          />
        </p>
      )}
      <div className={styles.sessionList}>
        {today.sessions.map((entry) => (
          <SessionCard key={entry.session.id} entry={entry} units={units} />
        ))}
      </div>
    </section>
  )
}
