import { useId } from 'react'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import {
  wristChipLabel,
  wristItemSentence,
  wristPlain,
  wristWarningSentence,
} from '../../shared/copy/publish.ts'
import { fileRefusalSentence, workoutLinkLabel } from '../../shared/copy/workouts.ts'
import type {
  PlanSession,
  SessionWorkoutView,
  WorkoutFileRefusal,
  WristItem,
} from '../../shared/types.ts'
import { publishable } from '../../shared/workouts/labels.ts'
import { sessionFileHref, useSendAgain, useWristStatus } from '../api/wrist.ts'
import { Button } from './Button.tsx'
import styles from './WristStatus.module.css'

const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** "14:20": the clock time of an instant where the runner is. */
export function clockTime(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : clock.format(at)
}

/** The sentence behind an item, with the time of its retry when one is due. */
export function itemSentence(item: WristItem): string {
  const retry = item.retryAt === null ? '' : clockTime(item.retryAt)
  return wristItemSentence(item, retry === '' ? null : retry)
}

/**
 * Why the workout file of a session is not offered, or null when it is. A session that is not a
 * run or is already settled is known from the plan; a rest advice is known to the server only.
 */
export function fileRefusal(
  session: Pick<PlanSession, 'kind' | 'status'>,
  workout: SessionWorkoutView | undefined,
): Exclude<WorkoutFileRefusal, 'empty'> | null {
  if (!publishable(session.kind)) return 'not-a-run'
  if (!isToRun(session.status)) return 'settled'
  return workout?.file.available === false ? workout.file.reason : null
}

/**
 * The state of one session as a chip: a word, with its sentence as the title. The word carries the
 * meaning; the look only repeats it. A status with no chip (the app took the run off the watch on
 * purpose) renders nothing.
 */
export function WristChip({ item }: { item: WristItem }) {
  const label = wristChipLabel(item.status)
  if (label === null) return null
  return (
    <span className={styles.chip} data-status={item.status} title={itemSentence(item)}>
      {label}
    </span>
  )
}

/** The download link of one session's workout file: the route itself, saved by the browser. */
export function FileLink({ sessionId, className }: { sessionId: string; className?: string }) {
  return (
    <a href={sessionFileHref(sessionId)} download className={className ?? styles.link}>
      {workoutLinkLabel('workout.link.file')}
    </a>
  )
}

/** A status that "Send again" can move: the app has not sent it, is waiting to, or it did not arrive. */
export function canSendAgain(item: Pick<WristItem, 'status'>): boolean {
  return item.status === 'not-sent' || item.status === 'waiting' || item.status === 'not-delivered'
}

/**
 * The "On your watch" section of the session sheet: where the run stands on its way to intervals.icu
 * and the watch, what to do when it is stuck, and the workout file. Only runs have one. Offline, or
 * while the status cannot be read, the status lines are left out and the download stays. With
 * sending off the section is the download alone: the Plan strip says sending is off and links to
 * Integrations.
 */
export function WristSection(props: {
  session: PlanSession
  workout: SessionWorkoutView | undefined
}) {
  // a strength day, a rest day, a race: no workout, so nothing to ask the server either
  return publishable(props.session.kind) ? <RunWristSection {...props} /> : null
}

function RunWristSection({
  session,
  workout,
}: {
  session: PlanSession
  workout: SessionWorkoutView | undefined
}) {
  const headingId = useId()
  const { status } = useWristStatus()
  const send = useSendAgain()

  const refusal = fileRefusal(session, workout)
  const heading = (
    <h3 id={headingId} className={styles.heading}>
      {wristPlain('publish.sheet.heading')}
    </h3>
  )
  if (refusal !== null) {
    return (
      <section className={styles.section} aria-labelledby={headingId}>
        {heading}
        <p className={styles.note}>{fileRefusalSentence(refusal)}</p>
      </section>
    )
  }

  const item =
    status?.settings.enabled === true
      ? status.items.find((i) => i.sessionId === session.id)
      : undefined
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      {heading}
      {item !== undefined ? (
        <div className={styles.state}>
          <p className={styles.stateLine}>
            <WristChip item={item} /> <span>{itemSentence(item)}</span>
          </p>
          {item.warnings.map((code) => {
            const sentence = wristWarningSentence(code)
            return sentence === null ? null : (
              <p key={code} className={styles.note}>
                {sentence}
              </p>
            )
          })}
        </div>
      ) : null}
      {workout?.eased === true ? <p>{wristPlain('publish.sheet.eased')}</p> : null}
      <div className={styles.actions}>
        {item !== undefined && canSendAgain(item) ? (
          <Button
            variant="secondary"
            loading={send.isPending}
            onClick={() => {
              send.mutate({ sessionId: session.id })
            }}
          >
            {wristPlain('publish.action.send-again')}
          </Button>
        ) : null}
        <FileLink sessionId={session.id} />
      </div>
      {send.isError ? (
        <p role="alert" className={styles.error}>
          {send.error.message}
        </p>
      ) : null}
    </section>
  )
}
