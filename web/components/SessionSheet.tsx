import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type {
  ExecutionAssessment,
  ResolvedTargets,
  SessionFlag,
  Step,
  ZoneKey,
} from '../../shared/engine/types.ts'
import { estimateAboutText, estimateText } from '../../shared/copy/distanceEstimate.ts'
import { formatQuantity } from '../../shared/copy/quantity.ts'
import { sessionStatusLabel } from '../../shared/copy/sessionStatus.ts'
import { addDays } from '../../shared/dates.ts'
import { hasSubjectivePart } from '../../shared/engine/execution.ts'
import { resolveTargets } from '../../shared/engine/targets.ts'
import { formatDistance } from '../../shared/units.ts'
import { stepName } from '../../shared/workouts/plan.ts'
import type { ActivityListItem, PlanSession, PlanSessionView, Units } from '../../shared/types.ts'
import { useActivities } from '../api/activities.ts'
import { useLinkPlanSession, useSessionWorkout } from '../api/plan.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from './Button.tsx'
import { Field, Select } from './Field.tsx'
import { FuelSessionSection } from './fuel/FuelSessionSection.tsx'
import { SessionStrengthSection } from './strength/SessionStrengthSection.tsx'
import { Sheet } from './Sheet.tsx'
import { useToast } from './Toast.tsx'
import { WhyDrawer } from './WhyDrawer.tsx'
import { WristSection } from './WristStatus.tsx'
import { AdjustSection } from './disruption/AdjustSection.tsx'
import { SessionTargets } from './today/SessionTargets.tsx'
import { unratedEffortNote } from './engineText.ts'
import {
  formatClimb,
  formatLongDate,
  formatShortDate,
  formatWeekday,
  sessionKindLabel,
} from './format.ts'
import styles from './SessionSheet.module.css'

export interface SessionSheetProps {
  session: PlanSessionView
  onClose: () => void
}

const ZONE_LABELS: Record<ZoneKey, string> = {
  z1: 'Zone 1',
  z2: 'Zone 2',
  z3: 'Zone 3',
  'race-pace': 'Race pace',
  strides: 'Strides',
  strength: 'Strength',
  rest: 'Rest',
}

const FLAG_LABELS: Record<SessionFlag, string> = {
  'spike-warn': 'Bigger than the recent longest run',
  'override-required': 'Needs your confirmation before it changes',
  heat: 'Hot conditions expected',
  night: 'May run in the dark',
  'fuel-practice': 'Practise race-day fuelling',
  'b2b-day1': 'Back-to-back, day 1',
  'b2b-day2': 'Back-to-back, day 2',
  downhill: 'Downhill emphasis',
  'run-walk': 'Run-walk intervals',
  'post-race': 'After the race: easy running only',
  'injury-return': 'Return-to-running step',
  'rest-window': 'Rest window',
}

const COMPLETION_LABELS: Record<ExecutionAssessment['completion'], string> = {
  completed: 'Completed as planned',
  partial: 'Shorter than planned',
  extended: 'Longer than planned',
  modified: 'A different kind of session than planned',
}

const INTENSITY_LABELS: Record<ExecutionAssessment['intensity'], string> = {
  below: 'Below the target zone',
  on: 'In the target zone',
  above: 'Above the target zone',
  unknown: 'Intensity not assessed',
}

const EFFORT_LABELS: Record<'-2' | '-1' | '0' | '1' | '2', string> = {
  '-2': 'Much easier than expected',
  '-1': 'Easier than expected',
  '0': 'As expected',
  '1': 'Harder than expected',
  '2': 'Much harder than expected',
}

const ASSESSMENT_FLAG_LABELS: Record<ExecutionAssessment['flags'][number], string> = {
  pain: 'Pain reported',
  'focal-bone-pain': 'Point tenderness on a bone reported',
  heat: 'Hot conditions',
  'hr-unqualified': 'Heart rate not reliable enough to use',
  spike: 'Bigger than the recent longest run',
}

const NBSP = ' '

/**
 * Duration, distance and the like for a one-line summary; rest days have none. The distance is the
 * estimate the server worked out, worded as one; a session with none keeps the plan's own distance.
 */
export function sessionSummary(session: PlanSessionView, units: Units | undefined): string {
  const parts: string[] = []
  if (session.durationMin > 0) parts.push(`${String(session.durationMin)}${NBSP}min`)
  if (units !== undefined) {
    // `?? null`: a Today answer the phone kept from before the estimate existed has no field.
    const estimate = session.distanceEstimate ?? null
    if (estimate !== null) {
      parts.push(estimateAboutText(estimate.distanceM, units))
    } else if (session.distanceM !== null) {
      parts.push(formatDistance(session.distanceM, units))
    }
  }
  return parts.join(', ')
}

function minutesText(sec: number): string {
  const min = sec / 60
  return `${String(Number.isInteger(min) ? min : Math.round(min * 10) / 10)} min`
}

/** One engine step: "Warm up 15 min, Zone 1", "3 x Fast 8 min, Zone 3". The name is the workout's. */
function stepText(step: Step, session: PlanSession): string {
  const label = stepName(step, session)
  const amount =
    step.durationSec !== null
      ? minutesText(step.durationSec)
      : step.distanceM !== null
        ? `${String(step.distanceM)} m`
        : ''
  const zone = ZONE_LABELS[step.zone]
  if (step.reps > 1) return `${String(step.reps)} x ${label} ${amount}, ${zone}`
  return `${label} ${amount}, ${zone}`
}

function activityLabel(activity: ActivityListItem, units: Units | undefined): string {
  const parts = [
    `${formatWeekday(activity.date)} ${formatShortDate(activity.date)}`,
    `${String(Math.round(activity.durationSec / 60))}${NBSP}min`,
  ]
  if (activity.distanceM !== null && units !== undefined) {
    parts.push(formatDistance(activity.distanceM, units))
  }
  parts.push(activity.type)
  return parts.join(', ')
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * The targets stored with the session, for when the resolved ones cannot be read (the workout
 * request failed). They are older than the zones when a zone change was accepted after the plan was
 * written, so they stand in only then. They go through the resolver with no zones and the same rows
 * as the hero and the resolved sheet (`SessionTargets`), so the words, the order and the rounding
 * are the hero's and only the figures can be older. The day's heat is not known here: the plan-time
 * heat note is shown beside the targets.
 */
export function StoredTargets({
  session,
  units,
}: {
  session: Pick<PlanSession, 'kind' | 'target'>
  units: Units
}) {
  const targets = resolveTargets(session, null, { hot: false })
  return <SessionTargets targets={targets} units={units} day="other" />
}

/**
 * The targets of the session as the resolver gives them today (current zones, the day's heat): the
 * same rows, in the same order and words, as Today's hero, plus the notes that explain a figure.
 * The sheet opens for a session on any day, so a note does not say "today".
 */
export function SheetTargets({ targets, units }: { targets: ResolvedTargets; units: Units }) {
  return (
    <>
      <SessionTargets targets={targets} units={units} day="other" />
      {targets.hotNote !== null ? <p className={styles.note}>{targets.hotNote}</p> : null}
      {targets.zonesNote !== null ? <p className={styles.note}>{targets.zonesNote}</p> : null}
    </>
  )
}

function Assessment({
  execution,
  activityId,
  units,
}: {
  execution: ExecutionAssessment
  activityId: string | null
  units: Units | undefined
}) {
  const { effort, conditions } = execution
  const effortText =
    effort.score === null
      ? 'Effort not assessed'
      : `${EFFORT_LABELS[String(effort.score) as keyof typeof EFFORT_LABELS]}, ${effort.confidence} confidence`
  const conditionParts: string[] = []
  if (conditions.wbgtC !== null) {
    // A WBGT reads in °C in either unit system (`formatQuantity`), so the units cannot change it.
    const wbgt = formatQuantity({ kind: 'temp', c: Math.round(conditions.wbgtC) }, units ?? 'km')
    conditionParts.push(`WBGT ${wbgt}`)
  }
  return (
    <section className={styles.section} aria-labelledby="assessment-title">
      <h3 id="assessment-title" className={styles.heading}>
        How it went against the plan
      </h3>
      <ul className={styles.plain}>
        <li>{COMPLETION_LABELS[execution.completion]}</li>
        <li>{INTENSITY_LABELS[execution.intensity]}</li>
        <li>{effortText}</li>
        {conditionParts.length > 0 ? <li>{conditionParts.join(', ')}</li> : null}
        {conditions.heatAdjusted ? <li>Adjusted for heat</li> : null}
        {conditions.gradeAdjusted ? <li>Adjusted for grade</li> : null}
        {execution.flags.map((flag) => (
          <li key={flag}>{ASSESSMENT_FLAG_LABELS[flag]}</li>
        ))}
      </ul>
      {execution.lines.length > 0 ? (
        <div className={styles.lines}>
          {execution.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
      {/* The rating controls are on the activity page. */}
      {!hasSubjectivePart(effort.parts) ? (
        <p className={styles.note} role="note">
          {unratedEffortNote(effort.score, execution.completion)}
          {activityId !== null ? (
            <>
              {' '}
              <Link to={`/activities/${encodeURIComponent(activityId)}`}>
                Open the activity to rate it.
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  )
}

function LinkSection({ session, units }: { session: PlanSession; units: Units | undefined }) {
  const toast = useToast()
  const link = useLinkPlanSession()
  const [choice, setChoice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const nearby = useActivities({ from: addDays(session.date, -7), to: addDays(session.date, 7) })
  const linked = nearby.data?.find((a) => a.id === session.activityId)
  const candidates = (nearby.data ?? []).filter(
    (a) =>
      a.id !== session.activityId &&
      !(a.duplicateOfId !== null && a.duplicateStatus === 'confirmed'),
  )

  function send(activityId: string | null) {
    setError(null)
    link.mutate(
      { id: session.id, activityId },
      {
        onSuccess: () => {
          setChoice('')
          toast.show(activityId === null ? 'Activity unlinked' : 'Activity linked')
        },
        onError: (err) => {
          setError(err.message)
        },
      },
    )
  }

  return (
    <section className={styles.section} aria-labelledby="link-title">
      <h3 id="link-title" className={styles.heading}>
        Linked activity
      </h3>
      {session.activityId !== null ? (
        <p className={styles.linked}>
          <Link to={`/activities/${encodeURIComponent(session.activityId)}`}>
            {linked !== undefined ? activityLabel(linked, units) : 'Open the linked activity'}
          </Link>
          <span className={styles.muted}>
            {session.linkSource === 'owner' ? ' Linked by you.' : ' Linked automatically.'}
          </span>{' '}
          <Button
            variant="quiet"
            loading={link.isPending}
            onClick={() => {
              send(null)
            }}
          >
            Unlink
          </Button>
        </p>
      ) : (
        <p className={styles.muted}>No activity is linked to this session yet.</p>
      )}
      {nearby.isError ? (
        <p role="alert" className={styles.error}>
          Nearby activities did not load.
        </p>
      ) : (
        <div className={styles.inline}>
          <Field
            label={session.activityId === null ? 'Link an activity' : 'Link a different activity'}
          >
            {(a) => (
              <Select
                {...a}
                value={choice}
                onChange={(e) => {
                  setChoice(e.target.value)
                }}
              >
                <option value="">Choose an activity</option>
                {candidates.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activityLabel(activity, units)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            variant="secondary"
            disabled={choice === ''}
            loading={link.isPending}
            onClick={() => {
              send(choice)
            }}
          >
            Link
          </Button>
        </div>
      )}
      {error !== null ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </section>
  )
}

/**
 * Prescription, steps, why drawer, the workout of a strength session, linked activity, execution
 * assessment, link, and the changes a runner can make: move, swap, shorten, skip (`AdjustSection`). The sheet is one exported
 * component: Plan, Today's hero and the week strip open it with a session and `onClose`.
 */
export function SessionSheet({ session, onClose }: SessionSheetProps) {
  const settings = useSettings()
  const units = settings.data?.units
  const workout = useSessionWorkout(session.id)
  const [whyOpen, setWhyOpen] = useState(false)
  const original = session.original
  const estimate = session.distanceEstimate ?? null

  return (
    <>
      <Sheet open onClose={onClose} title={session.title}>
        <div className={styles.body}>
          <p className={styles.context}>
            {formatLongDate(session.date)}. {sessionKindLabel(session.kind)}.{' '}
            <span data-status={session.status}>{sessionStatusLabel(session.status)}</span>
          </p>
          {original !== null ? (
            <p className={styles.muted}>
              First planned: {original.title ?? session.title},{' '}
              {String(original.durationMin ?? session.durationMin)} min
              {original.date !== undefined && original.date !== session.date
                ? `, on ${formatLongDate(original.date)}`
                : ''}
              .
            </p>
          ) : null}

          <section className={styles.section} aria-labelledby="prescription-title">
            <h3 id="prescription-title" className={styles.heading}>
              Prescription
            </h3>
            <dl className={styles.facts}>
              {session.durationMin > 0 ? (
                <Row label="Time">{`${String(session.durationMin)}${NBSP}min`}</Row>
              ) : null}
              {units === undefined ? null : estimate !== null ? (
                <Row label="Distance">{estimateText(estimate, units)}</Row>
              ) : session.distanceM !== null ? (
                <Row label="Distance">{formatDistance(session.distanceM, units)}</Row>
              ) : null}
              {session.gainM !== null && units !== undefined ? (
                <Row label="Climb">{formatClimb(session.gainM, units)}</Row>
              ) : null}
              <Row label="Zone">{ZONE_LABELS[session.target.zone]}</Row>
            </dl>
            {workout.data !== undefined ? (
              units !== undefined ? (
                <SheetTargets targets={workout.data.targets} units={units} />
              ) : null
            ) : workout.isError && units !== undefined ? (
              <StoredTargets session={session} units={units} />
            ) : null}
            {session.target.heatNote !== null ? (
              <p className={styles.note}>{session.target.heatNote}</p>
            ) : null}
            {session.flags.length > 0 ? (
              <ul className={styles.plain}>
                {session.flags.map((flag) => (
                  <li key={flag}>{FLAG_LABELS[flag]}</li>
                ))}
              </ul>
            ) : null}
            {session.structure.length > 0 ? (
              <>
                <h4 className={styles.subheading}>Steps</h4>
                <ul className={styles.steps}>
                  {session.structure.map((step, index) => (
                    <li key={`${step.kind}-${String(index)}`}>{stepText(step, session)}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <p>{session.purpose}</p>
            <div>
              <Button
                variant="quiet"
                aria-expanded={whyOpen}
                onClick={() => {
                  setWhyOpen(true)
                }}
              >
                Why this session
              </Button>
            </div>
          </section>

          {session.kind === 'strength' ? <SessionStrengthSection session={session} /> : null}
          <FuelSessionSection session={session} />
          <WristSection session={session} workout={workout.data} />
          {session.execution !== null ? (
            <Assessment
              execution={session.execution}
              activityId={session.activityId}
              units={units}
            />
          ) : null}
          <LinkSection session={session} units={units} />
          <AdjustSection session={session} />
        </div>
      </Sheet>
      <WhyDrawer
        explain={{ subject: 'session', id: session.id }}
        rules={session.rules}
        open={whyOpen}
        onClose={() => {
          setWhyOpen(false)
        }}
      />
    </>
  )
}
