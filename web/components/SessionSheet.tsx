import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type {
  ExecutionAssessment,
  SessionFlag,
  SessionTarget,
  Step,
  ZoneKey,
} from '../../shared/engine/types.ts'
import { addDays, isIsoDate } from '../../shared/dates.ts'
import { hasSubjectivePart } from '../../shared/engine/execution.ts'
import { formatDistance, formatPace } from '../../shared/units.ts'
import type { Activity, PlanSession, PlanSessionStatus, Units } from '../../shared/types.ts'
import { useActivities } from '../api/activities.ts'
import { useLinkPlanSession, useUpdatePlanSession } from '../api/plan.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from './Button.tsx'
import { Field, Input, Select } from './Field.tsx'
import { Sheet } from './Sheet.tsx'
import { useToast } from './Toast.tsx'
import { WhyDrawer } from './WhyDrawer.tsx'
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
  session: PlanSession
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

const STEP_LABELS: Record<Step['kind'], string> = {
  warmup: 'Warm-up',
  work: 'work',
  recover: 'recover',
  cooldown: 'Cool-down',
  steady: 'Steady',
}

const STATUS_LABELS: Record<PlanSessionStatus, string> = {
  planned: 'Planned',
  completed: 'Completed',
  partial: 'Partly completed',
  skipped: 'Skipped',
  downgraded: 'Eased',
  moved: 'Moved',
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

export function sessionStatusLabel(status: PlanSessionStatus): string {
  return STATUS_LABELS[status]
}

/** Duration, distance and the like for a one-line summary; rest days have none. */
export function sessionSummary(session: PlanSession, units: Units | undefined): string {
  const parts: string[] = []
  if (session.durationMin > 0) parts.push(`${String(session.durationMin)}${NBSP}min`)
  if (session.distanceM !== null && units !== undefined) {
    parts.push(formatDistance(session.distanceM, units))
  }
  return parts.join(', ')
}

function minutesText(sec: number): string {
  const min = sec / 60
  return `${String(Number.isInteger(min) ? min : Math.round(min * 10) / 10)} min`
}

function stepText(step: Step): string {
  const label = STEP_LABELS[step.kind]
  const amount =
    step.durationSec !== null
      ? minutesText(step.durationSec)
      : step.distanceM !== null
        ? `${String(step.distanceM)} m`
        : ''
  const zone = ZONE_LABELS[step.zone]
  if (step.reps > 1) return `${String(step.reps)} x ${label} ${amount}, ${zone}`
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${amount}, ${zone}`
}

function rangeText(range: [number, number], unit: string): string {
  const [a, b] = range[0] <= range[1] ? range : [range[1], range[0]]
  return `${String(a)} to ${String(b)}${unit}`
}

function paceText(range: [number, number], units: Units): string {
  const [fast, slow] = range[0] <= range[1] ? range : [range[1], range[0]]
  const value = (secPerKm: number) => formatPace(secPerKm, 1000, units).replace(/ \/\w+$/, '')
  return `${value(fast)} to ${value(slow)} /${units}`
}

function activityLabel(activity: Activity, units: Units | undefined): string {
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

function Targets({ target, units }: { target: SessionTarget; units: Units | undefined }) {
  return (
    <dl className={styles.facts}>
      <Row label="Zone">{ZONE_LABELS[target.zone]}</Row>
      <Row label="Effort">{`${rangeText(target.rpe, '')} of 10`}</Row>
      {target.hr !== null ? <Row label="Heart rate">{rangeText(target.hr, ' bpm')}</Row> : null}
      {target.paceSecPerKm !== null && units !== undefined ? (
        <Row label="Pace">{paceText(target.paceSecPerKm, units)}</Row>
      ) : null}
    </dl>
  )
}

function Assessment({
  execution,
  activityId,
}: {
  execution: ExecutionAssessment
  activityId: string | null
}) {
  const { effort, conditions } = execution
  const effortText =
    effort.score === null
      ? 'Effort not assessed'
      : `${EFFORT_LABELS[String(effort.score) as keyof typeof EFFORT_LABELS]}, ${effort.confidence} confidence`
  const conditionParts: string[] = []
  if (conditions.wbgtC !== null)
    conditionParts.push(`WBGT ${String(Math.round(conditions.wbgtC))} °C`)
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

function ChangeSection({ session, onClose }: SessionSheetProps) {
  const formId = useId()
  const toast = useToast()
  const update = useUpdatePlanSession()
  const [date, setDate] = useState(session.date)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const done = session.status === 'completed' || session.status === 'partial'
  const unchanged = !isIsoDate(date) || date === session.date

  function move(event: FormEvent) {
    event.preventDefault()
    if (unchanged) return
    setError(null)
    update.mutate(
      { id: session.id, patch: { date } },
      {
        onSuccess: () => {
          toast.show(`Session moved to ${formatWeekday(date)} ${formatShortDate(date)}`)
          onClose()
        },
        onError: (err) => {
          setError(err.message)
        },
      },
    )
  }

  function skip(skipped: boolean) {
    setError(null)
    update.mutate(
      { id: session.id, patch: { skip: skipped } },
      {
        onSuccess: () => {
          toast.show(skipped ? 'Session skipped' : 'Session restored')
          onClose()
        },
        onError: (err) => {
          setError(err.message)
          setConfirming(false)
        },
      },
    )
  }

  return (
    <section className={styles.section} aria-labelledby={`${formId}-title`}>
      <h3 id={`${formId}-title`} className={styles.heading}>
        Change this session
      </h3>
      <form className={styles.inline} onSubmit={move} noValidate>
        <Field label="Move to">
          {(a) => (
            <Input
              {...a}
              type="date"
              value={date}
              disabled={done}
              onChange={(e) => {
                setDate(e.target.value)
              }}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="secondary"
          disabled={done || unchanged}
          loading={update.isPending}
        >
          Move session
        </Button>
      </form>
      <p className={styles.muted}>
        A move is checked against spacing and the weekly limits before it is saved.
      </p>
      {session.status === 'skipped' ? (
        <div>
          <Button
            variant="secondary"
            loading={update.isPending}
            onClick={() => {
              skip(false)
            }}
          >
            Restore session
          </Button>
        </div>
      ) : confirming ? (
        <div className={styles.inline} role="group" aria-label="Confirm skipping">
          <p>Skip this session?</p>
          <Button
            variant="secondary"
            loading={update.isPending}
            onClick={() => {
              skip(true)
            }}
          >
            Yes, skip it
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setConfirming(false)
            }}
          >
            Keep it
          </Button>
        </div>
      ) : (
        <div>
          <Button
            variant="secondary"
            disabled={done}
            onClick={() => {
              setConfirming(true)
            }}
          >
            Skip session
          </Button>
        </div>
      )}
      <p className={styles.muted}>A skipped session is not made up later.</p>
      {error !== null ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </section>
  )
}

/** Prescription, steps, why drawer, linked activity, execution assessment, link, move, skip. */
export function SessionSheet({ session, onClose }: SessionSheetProps) {
  const settings = useSettings()
  const units = settings.data?.units
  const [whyOpen, setWhyOpen] = useState(false)
  const original = session.original

  return (
    <>
      <Sheet open onClose={onClose} title={session.title}>
        <div className={styles.body}>
          <p className={styles.context}>
            {formatLongDate(session.date)}. {sessionKindLabel(session.kind)}.{' '}
            <span data-status={session.status}>{STATUS_LABELS[session.status]}</span>
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
              {session.distanceM !== null && units !== undefined ? (
                <Row label="Distance">{formatDistance(session.distanceM, units)}</Row>
              ) : null}
              {session.gainM !== null && units !== undefined ? (
                <Row label="Climb">{formatClimb(session.gainM, units)}</Row>
              ) : null}
            </dl>
            <Targets target={session.target} units={units} />
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
                    <li key={`${step.kind}-${String(index)}`}>{stepText(step)}</li>
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

          {session.execution !== null ? (
            <Assessment execution={session.execution} activityId={session.activityId} />
          ) : null}
          <LinkSection session={session} units={units} />
          <ChangeSection session={session} onClose={onClose} />
        </div>
      </Sheet>
      <WhyDrawer
        rules={session.rules}
        open={whyOpen}
        onClose={() => {
          setWhyOpen(false)
        }}
      />
    </>
  )
}
