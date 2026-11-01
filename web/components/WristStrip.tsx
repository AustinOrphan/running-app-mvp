import { Link } from 'react-router-dom'
import { daysBetween, mondayOf, todayIso } from '../../shared/dates.ts'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import { wristCounts, wristPlain, wristStripSentence } from '../../shared/copy/publish.ts'
import { fileRefusalSentence, workoutLinkLabel } from '../../shared/copy/workouts.ts'
import type { PlanSession } from '../../shared/types.ts'
import { publishable } from '../../shared/workouts/labels.ts'
import { useSendAgain, useWristStatus, weekZipHref } from '../api/wrist.ts'
import { Button } from './Button.tsx'
import styles from './WristStrip.module.css'

/** Whether a week has a run a workout file can be made for. */
export function weekHasRuns(sessions: readonly PlanSession[], weekStart: string): boolean {
  return sessions.some((s) => s.weekStart === weekStart && publishable(s.kind) && isToRun(s.status))
}

/**
 * The strip at the top of the Plan page: how the next 14 days of runs stand on their way to the
 * watch, "Send again" when some are stuck, and this week's workout files as a zip. The counts come
 * from the server; offline, or while the status cannot be read, only the download stays. With
 * sending off, the strip says so and points to the files and to Integrations.
 */
export function WristStrip({ sessions }: { sessions: readonly PlanSession[] }) {
  const { status } = useWristStatus()
  const send = useSendAgain()
  const weekStart = mondayOf(todayIso())

  const off = status !== undefined && !status.settings.enabled
  const counts = status?.settings.enabled === true ? wristCounts(status.items) : null
  const stuck = counts !== null && counts.waiting + counts.notDelivered > 0
  // what the server says, or nothing when it cannot be asked
  const summary =
    status === undefined
      ? null
      : counts === null
        ? wristPlain('publish.strip.off')
        : wristStripSentence(counts, daysBetween(status.from, status.to) + 1)

  return (
    <section
      className={styles.strip}
      aria-label={wristPlain('publish.strip.heading')}
      data-state={status === undefined ? 'unknown' : off ? 'off' : 'on'}
    >
      {summary === null ? null : <p className={styles.summary}>{summary}</p>}
      <div className={styles.actions}>
        {stuck ? (
          <Button
            variant="secondary"
            loading={send.isPending}
            onClick={() => {
              send.mutate({})
            }}
          >
            {wristPlain('publish.action.send-again')}
          </Button>
        ) : null}
        {weekHasRuns(sessions, weekStart) ? (
          <a href={weekZipHref(weekStart)} download className={styles.link}>
            {workoutLinkLabel('workout.link.week')}
          </a>
        ) : (
          <span className={styles.note}>{fileRefusalSentence('empty')}</span>
        )}
        {off ? (
          <Link to="/integrations" className={styles.link}>
            {wristPlain('publish.action.integrations')}
          </Link>
        ) : null}
      </div>
      {send.isError ? (
        <p role="alert" className={styles.error}>
          {send.error.message}
        </p>
      ) : null}
    </section>
  )
}
