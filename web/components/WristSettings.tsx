import { useEffect, useId, useRef, useState } from 'react'
import { daysBetween, todayIso } from '../../shared/dates.ts'
import { wristLastSend, wristPlain, wristSendLabel } from '../../shared/copy/publish.ts'
import {
  isRemoveFailed,
  useDisconnectIntervals,
  useSendAgain,
  useSetPublishing,
  useWristStatus,
} from '../api/wrist.ts'
import { Button } from './Button.tsx'
import { clockTime } from './WristStatus.tsx'
import styles from './WristSettings.module.css'

/** "Last send to intervals.icu: 13 Jan at 11:00.", or that nothing has been sent yet. */
function lastSendLine(lastRunAt: string | null): string {
  const at = lastRunAt === null ? new Date(Number.NaN) : new Date(lastRunAt)
  if (lastRunAt === null || Number.isNaN(at.getTime())) {
    return wristPlain('publish.settings.never-sent')
  }
  return wristLastSend(todayIso(at), clockTime(lastRunAt))
}

/**
 * The settings of sending to the watch, on the intervals.icu card of the Integrations page: the
 * switch that turns it on (off until the runner does), the tick for intervals.icu's own Garmin
 * upload, the last send with "Send now", and the offer to take the sessions already sent out of
 * intervals.icu when sending is turned off. "Turn it on under Integrations" and "Sending to your
 * watch is off" send the runner here.
 *
 * Both choices are the server's to keep, so the boxes show what it reports, not what was clicked;
 * offline, or while the status cannot be read, the section is left out.
 *
 * Focus stays where the runner put it. A focused control that becomes disabled drops focus to the
 * page, so a box that is saving is `aria-disabled` and its handler ignores the change, and a
 * button that is working is `busy`. The offer opens with focus on its box and gives focus back to
 * the "Send" box when it closes.
 */
export function WristSettings() {
  const headingId = useId()
  const helpId = useId()
  const offerId = useId()
  const { status } = useWristStatus()
  const save = useSetPublishing()
  const send = useSendAgain()
  // The offer that comes with turning sending off; its box starts unticked.
  const [offer, setOffer] = useState<{ removeSent: boolean } | null>(null)
  const sendBox = useRef<HTMLInputElement>(null)
  if (status === undefined) return null
  const { enabled, garminLinked, lastRunAt, running } = status.settings
  const days = daysBetween(status.from, status.to) + 1
  // Only a session intervals.icu is known to hold is worth an offer to remove.
  const holdsSent = status.items.some((i) => i.status === 'sent' || i.status === 'on-watch')

  function closeOffer() {
    setOffer(null)
    sendBox.current?.focus()
  }

  function onSendChange(checked: boolean) {
    if (save.isPending) return
    if (checked) {
      save.mutate({ enabled: true, garminLinked })
    } else if (holdsSent) {
      save.reset()
      setOffer({ removeSent: false })
    } else {
      save.mutate({ enabled: false, garminLinked })
    }
  }

  return (
    <fieldset className={styles.settings} aria-labelledby={headingId} aria-busy={save.isPending}>
      <legend id={headingId} className={styles.heading}>
        {wristPlain('publish.settings.heading')}
      </legend>
      <label className={styles.check}>
        <input
          ref={sendBox}
          type="checkbox"
          checked={enabled}
          aria-disabled={save.isPending ? true : undefined}
          onChange={(event) => {
            onSendChange(event.target.checked)
          }}
        />
        {wristSendLabel(days)}
      </label>
      {enabled && offer !== null ? (
        <div role="group" aria-labelledby={offerId} className={styles.offer}>
          <p id={offerId} className={styles.note}>
            {wristPlain('publish.settings.off-offer')}
          </p>
          <label className={styles.check}>
            {/* The offer opens on the runner's own action, so focus goes to its first control. */}
            <input
              type="checkbox"
              autoFocus
              checked={offer.removeSent}
              onChange={(event) => {
                setOffer({ removeSent: event.target.checked })
              }}
            />
            {wristPlain('publish.settings.remove-sent')}
          </label>
          <div className={styles.actions}>
            <Button
              variant="primary"
              busy={save.isPending}
              onClick={() => {
                save.mutate(
                  { enabled: false, garminLinked, removeSent: offer.removeSent },
                  { onSuccess: closeOffer },
                )
              }}
            >
              {wristPlain('publish.settings.turn-off')}
            </Button>
            <Button
              variant="quiet"
              disabled={save.isPending}
              onClick={() => {
                save.reset()
                closeOffer()
              }}
            >
              {wristPlain('publish.settings.keep')}
            </Button>
          </div>
        </div>
      ) : null}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={garminLinked}
          aria-describedby={helpId}
          aria-disabled={save.isPending ? true : undefined}
          onChange={(event) => {
            if (save.isPending) return
            save.mutate({ enabled, garminLinked: event.target.checked })
          }}
        />
        {wristPlain('publish.settings.garmin')}
      </label>
      <p id={helpId} className={styles.note}>
        {wristPlain('publish.settings.garmin-help')}
      </p>
      {enabled ? (
        <div className={styles.actions}>
          <p className={styles.note}>
            {running ? wristPlain('publish.settings.sending-now') : lastSendLine(lastRunAt)}
          </p>
          <Button
            variant="secondary"
            busy={send.isPending || running}
            onClick={() => {
              send.mutate({})
            }}
          >
            {wristPlain('publish.settings.send-now')}
          </Button>
        </div>
      ) : null}
      <p className={styles.note}>{wristPlain('publish.settings.dormant')}</p>
      {save.isError ? (
        <p role="alert" className={styles.error}>
          {save.error.message}
        </p>
      ) : null}
      {send.isError ? (
        <p role="alert" className={styles.error}>
          {send.error.message}
        </p>
      ) : null}
    </fieldset>
  )
}

/**
 * Disconnect on the intervals.icu card. While sending is on, intervals.icu holds sessions the app
 * sent, so Disconnect first asks whether to take them out too ("Also remove the sessions already
 * sent", unticked). The removal needs the key, so when it fails the server keeps the connection
 * (409 `remove-failed`) and says so; the way out is "Disconnect without removing them". With
 * sending off there is nothing to ask and Disconnect acts at once.
 *
 * The choice takes the place of the Disconnect button, so focus moves to its first control when it
 * opens and back to the button when it is declined, and the buttons that work are `busy` and keep
 * focus.
 */
export function DisconnectIntervals({ onDisconnected }: { onDisconnected: () => void }) {
  const offerId = useId()
  const { status } = useWristStatus()
  const disconnect = useDisconnectIntervals()
  const [choosing, setChoosing] = useState(false)
  const [removeSent, setRemoveSent] = useState(false)
  const disconnectButton = useRef<HTMLButtonElement>(null)
  // Set when the choice is declined, so the button that comes back takes focus (not on first show).
  const declined = useRef(false)
  useEffect(() => {
    if (!choosing && declined.current) {
      declined.current = false
      disconnectButton.current?.focus()
    }
  }, [choosing])
  // Only a status that says sending is off lets Disconnect act at once: when the status cannot be
  // read, sessions may be on intervals.icu, so the choice is offered.
  const mayHoldSent = status?.settings.enabled !== false

  // "Disconnect without removing them" appears once a removal has failed and stays for the rest of
  // the choice: a new attempt clears the error, and the button would otherwise unmount under the
  // focus of the runner who pressed it.
  const [removalFailed, setRemovalFailed] = useState(false)

  function run(remove: boolean) {
    disconnect.mutate(
      { removeSent: remove },
      {
        onSuccess: onDisconnected,
        onError: (error) => {
          if (isRemoveFailed(error)) setRemovalFailed(true)
        },
      },
    )
  }
  const label = wristPlain('publish.disconnect.button')
  const failure = disconnect.isError ? (
    <p role="alert" className={styles.error}>
      {isRemoveFailed(disconnect.error)
        ? disconnect.error.message
        : wristPlain('publish.disconnect.failed')}
    </p>
  ) : null

  if (!choosing) {
    return (
      <>
        <Button
          ref={disconnectButton}
          variant="quiet"
          busy={disconnect.isPending}
          onClick={() => {
            if (mayHoldSent) setChoosing(true)
            else run(false)
          }}
        >
          {label}
        </Button>
        {failure}
      </>
    )
  }
  return (
    <div role="group" aria-labelledby={offerId} className={styles.offer}>
      <p id={offerId} className={styles.note}>
        {wristPlain('publish.disconnect.offer')}
      </p>
      <label className={styles.check}>
        <input
          type="checkbox"
          autoFocus
          checked={removeSent}
          onChange={(event) => {
            setRemoveSent(event.target.checked)
          }}
        />
        {wristPlain('publish.settings.remove-sent')}
      </label>
      {failure}
      <div className={styles.actions}>
        <Button
          variant="primary"
          busy={disconnect.isPending}
          onClick={() => {
            run(removeSent)
          }}
        >
          {label}
        </Button>
        {removalFailed ? (
          <Button
            variant="secondary"
            busy={disconnect.isPending}
            onClick={() => {
              run(false)
            }}
          >
            {wristPlain('publish.disconnect.without')}
          </Button>
        ) : null}
        <Button
          variant="quiet"
          disabled={disconnect.isPending}
          onClick={() => {
            disconnect.reset()
            setRemovalFailed(false)
            declined.current = true
            setChoosing(false)
          }}
        >
          {wristPlain('publish.disconnect.cancel')}
        </Button>
      </div>
    </div>
  )
}
