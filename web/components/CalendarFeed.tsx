import { useId, useRef, useState } from 'react'
import { todayIso } from '../../shared/dates.ts'
import {
  calendarOnSentence,
  calendarWindowSentence,
  wristPlain,
} from '../../shared/copy/publish.ts'
import type { CalendarTokenIssued } from '../../shared/types.ts'
import { CALENDAR_DAYS, PUBLISH_HORIZON_DAYS } from '../../shared/workouts/horizon.ts'
import { useCreateCalendarLink, useRevokeCalendarLink, useWristStatus } from '../api/wrist.ts'
import { Button } from './Button.tsx'
import { Sheet } from './Sheet.tsx'
import { useToast } from './Toast.tsx'
import styles from './CalendarFeed.module.css'

/** The address of the feed as a calendar app opens it: the same host and path, `webcal` scheme. */
function webcalHref(path: string): string {
  return `webcal://${window.location.host}${path}`
}

/** "The calendar link works. It was made on 13 Jan." (the day where the runner is). */
function stateLine(enabled: boolean, madeAt: string | null): string {
  if (!enabled) return wristPlain('publish.calendar.off')
  const at = madeAt === null ? new Date(Number.NaN) : new Date(madeAt)
  return Number.isNaN(at.getTime())
    ? wristPlain('publish.calendar.on-plain')
    : calendarOnSentence(todayIso(at))
}

/**
 * The "Calendar link" section of the Integrations page: a private address that shows the next 28
 * days in any calendar app. It is not a provider (nothing to connect, sync or disconnect), so it
 * sits beside the provider cards with its own two actions, make a link and turn it off.
 *
 * The server keeps only the hash of the token, so the address is shown once, in a dialog, when it
 * is made. This component is its only holder: the token sits in state while the dialog is open
 * and goes with it on close (nothing is written to storage, and the mutation that fetched it is
 * dropped from the query cache). Offline, or while the status cannot be read, the section is left
 * out, but a token already issued is still shown: the dialog does not depend on the status.
 *
 * The two buttons stay focusable while their request runs (`busy`, not `disabled`): a focused
 * button that becomes disabled drops focus to the page, and the dialog would then give focus back
 * to the page and not to the button that opened it.
 */
export function CalendarFeed({ className }: { className?: string }) {
  const headingId = useId()
  const toast = useToast()
  const { status } = useWristStatus()
  const create = useCreateCalendarLink()
  const revoke = useRevokeCalendarLink()
  const [link, setLink] = useState<CalendarTokenIssued | null>(null)
  const createButton = useRef<HTMLButtonElement>(null)
  const turnOffButton = useRef<HTMLButtonElement>(null)
  const address = link === null ? '' : `${window.location.origin}${link.path}`

  function onCreate() {
    // The button stays focusable while busy (see above), so a second press is ignored here.
    if (create.isPending || revoke.isPending) return
    revoke.reset()
    create.mutate(undefined, {
      onSuccess: (issued) => {
        setLink(issued)
        // The mutation's own copy of the answer is dropped; the dialog holds the only one.
        create.reset()
      },
    })
  }

  function onTurnOff() {
    if (create.isPending || revoke.isPending) return
    create.reset()
    revoke.mutate(undefined, {
      onSuccess: () => {
        toast.show(wristPlain('publish.calendar.turned-off'))
        // The button that was pressed goes with the link. Focus moves to the one that makes a new
        // link, unless the runner has moved on to something else meanwhile.
        const here = document.activeElement
        if (here === null || here === document.body || here === turnOffButton.current) {
          createButton.current?.focus()
        }
      },
    })
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(address)
      toast.show(wristPlain('publish.calendar.copied'))
    } catch {
      toast.show(wristPlain('publish.calendar.copy-failed'))
    }
  }

  const section =
    status === undefined ? null : (
      <section className={className} aria-labelledby={headingId}>
        <h2 id={headingId} className={styles.heading}>
          {wristPlain('publish.calendar.heading')}
        </h2>
        <p className={styles.state}>
          {stateLine(status.calendar.enabled, status.calendar.tokenCreatedAt)}
        </p>
        <p className={styles.note}>
          {wristPlain('publish.calendar.privacy')}{' '}
          {calendarWindowSentence(CALENDAR_DAYS, PUBLISH_HORIZON_DAYS)}
        </p>
        <p className={styles.note}>{wristPlain('publish.calendar.proxy')}</p>
        {status.calendar.enabled ? (
          <p className={styles.note}>{wristPlain('publish.calendar.not-shown')}</p>
        ) : null}
        <div className={styles.actions}>
          <Button
            ref={createButton}
            variant={status.calendar.enabled ? 'secondary' : 'primary'}
            busy={create.isPending || revoke.isPending}
            onClick={onCreate}
          >
            {wristPlain(
              status.calendar.enabled ? 'publish.calendar.replace' : 'publish.calendar.create',
            )}
          </Button>
          {status.calendar.enabled ? (
            <Button
              ref={turnOffButton}
              variant="quiet"
              busy={revoke.isPending || create.isPending}
              onClick={onTurnOff}
            >
              {wristPlain('publish.calendar.turn-off')}
            </Button>
          ) : null}
        </div>
        {create.isError ? (
          <p role="alert" className={styles.error}>
            {wristPlain('publish.calendar.create-failed')}
          </p>
        ) : null}
        {revoke.isError ? (
          <p role="alert" className={styles.error}>
            {wristPlain('publish.calendar.turn-off-failed')}
          </p>
        ) : null}
      </section>
    )

  return (
    <>
      {section}
      <Sheet
        open={link !== null}
        title={wristPlain('publish.calendar.dialog')}
        onClose={() => {
          setLink(null)
        }}
      >
        {link === null ? null : (
          <div className={styles.shown}>
            <p className={styles.note}>{wristPlain('publish.calendar.shown-once')}</p>
            <input
              type="text"
              readOnly
              className={styles.address}
              aria-label={wristPlain('publish.calendar.address')}
              value={address}
              onFocus={(event) => {
                event.currentTarget.select()
              }}
            />
            <div className={styles.actions}>
              <Button
                variant="primary"
                onClick={() => {
                  void onCopy()
                }}
              >
                {wristPlain('publish.calendar.copy')}
              </Button>
              <a href={webcalHref(link.path)} className={styles.link}>
                {wristPlain('publish.calendar.open')}
              </a>
            </div>
          </div>
        )}
      </Sheet>
    </>
  )
}
