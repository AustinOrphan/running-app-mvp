import { useState } from 'react'
import { wristLineSentence } from '../../shared/copy/publish.ts'
import { workoutLinkLabel } from '../../shared/copy/workouts.ts'
import { sessionFileHref, useWristStatus } from '../api/wrist.ts'
import { itemSentence } from './WristStatus.tsx'
import styles from './WristLine.module.css'

/**
 * Today's one line about the run on the watch, for the `watch` slot (24 px at 360 px): "On your
 * watch.", "Sent to intervals.icu.", "The watch has the easy version of this run." or "Not on the
 * watch yet: <short reason>." with the workout file one tap away. It reads the same status as the
 * Plan page through the same hook and keeps no state of its own about the watch, so it is mounted
 * with a session id and nothing else.
 *
 * It says nothing while sending is off, for a run the app took off the watch, offline and while the
 * status is unknown: a stale "On your watch" would be false. `role="status"` is set only when the
 * state differs from the one the page loaded with, so a screen reader hears a change and not the
 * page.
 */
export function WristLine({ sessionId }: { sessionId: string }) {
  const { status } = useWristStatus()
  const item =
    status?.settings.enabled === true
      ? status.items.find((i) => i.sessionId === sessionId)
      : undefined
  const sentence = item === undefined ? null : wristLineSentence(item)
  const state =
    item === undefined || sentence === null
      ? null
      : `${item.status}|${item.variant}|${item.failCode ?? ''}|${item.deviceMessage ?? ''}`

  // The state the page first showed. Setting it while rendering (not in an effect) is React's way
  // to keep a value from an earlier render: it runs once, when the first state arrives.
  const [loadedWith, setLoadedWith] = useState<string | null>(null)
  if (loadedWith === null && state !== null) setLoadedWith(state)
  const changed = loadedWith !== null && state !== null && state !== loadedWith

  if (item === undefined || sentence === null) return null
  const notYet = item.status !== 'on-watch' && item.status !== 'sent'
  return (
    <p className={styles.line} role={changed ? 'status' : undefined} title={itemSentence(item)}>
      <span className={styles.text}>{sentence}</span>
      {notYet ? (
        <a href={sessionFileHref(sessionId)} download className={styles.link}>
          {workoutLinkLabel('workout.link.file')}
        </a>
      ) : null}
    </p>
  )
}
