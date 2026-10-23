import { useId } from 'react'
import { daysBetween } from '../../shared/dates.ts'
import { wristPlain, wristSendLabel } from '../../shared/copy/publish.ts'
import { useSetPublishing, useWristStatus } from '../api/wrist.ts'
import styles from './WristSettings.module.css'

/**
 * The switch that turns sending to the watch on, on the intervals.icu card of the Integrations
 * page, and the tick for intervals.icu's own Garmin upload. "Turn it on under Integrations" and
 * "Sending to your watch is off" send the runner here. Sending is off until the runner turns it on.
 * Both choices are the server's to keep, so the boxes show what it reports, not what was clicked;
 * offline, or while the status cannot be read, they are left out.
 */
export function WristSettings() {
  const headingId = useId()
  const helpId = useId()
  const { status } = useWristStatus()
  const save = useSetPublishing()
  if (status === undefined) return null
  const { enabled, garminLinked } = status.settings
  const days = daysBetween(status.from, status.to) + 1

  return (
    <fieldset className={styles.settings} aria-labelledby={headingId} aria-busy={save.isPending}>
      <legend id={headingId} className={styles.heading}>
        {wristPlain('publish.settings.heading')}
      </legend>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            save.mutate({ enabled: event.target.checked, garminLinked })
          }}
        />
        {wristSendLabel(days)}
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={garminLinked}
          aria-describedby={helpId}
          onChange={(event) => {
            save.mutate({ enabled, garminLinked: event.target.checked })
          }}
        />
        {wristPlain('publish.settings.garmin')}
      </label>
      <p id={helpId} className={styles.note}>
        {wristPlain('publish.settings.garmin-help')}
      </p>
      {save.isError ? (
        <p role="alert" className={styles.error}>
          {save.error.message}
        </p>
      ) : null}
    </fieldset>
  )
}
