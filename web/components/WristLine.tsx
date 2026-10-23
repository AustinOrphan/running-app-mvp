import { useState } from 'react'
import { wristLineSentence } from '../../shared/copy/publish.ts'
import { workoutLinkLabel } from '../../shared/copy/workouts.ts'
import type { WristItem } from '../../shared/types.ts'
import { sessionFileHref } from '../api/wrist.ts'
import { itemSentence } from './WristStatus.tsx'
import styles from './WristLine.module.css'

/** What Today's line says about one session. */
export interface WristLineModel {
  sessionId: string
  /** The sentence: "On your watch.", "Not on the watch yet: waiting to send." */
  sentence: string
  /** The longer sentence behind it, as the `title`. */
  detail: string
  /** The run is not on the watch yet, so the workout file is offered. */
  offerFile: boolean
  /** The state differs from the one the page loaded with: announce it. */
  changed: boolean
}

/**
 * The state of Today's watch line for the hero's item, or null while the line has nothing to say:
 * no item (sending is off, the run is outside the next 14 days) or a run the app took off the
 * watch. The item is the page's own data (the `watch` slot of `GET /api/today`), so the line asks
 * for nothing and keeps no state of its own about the watch.
 *
 * `changed` is true only when the state differs from the one the page first showed, so a screen
 * reader hears a change and not the page.
 */
export function useWristLine(item: WristItem | undefined): WristLineModel | null {
  const sentence = item === undefined ? null : wristLineSentence(item)
  const state =
    item === undefined || sentence === null
      ? null
      : `${item.status}|${item.variant}|${item.failCode ?? ''}|${item.deviceMessage ?? ''}`

  // The state the page first showed. Setting it while rendering (not in an effect) is React's way
  // to keep a value from an earlier render: it runs once, when the first state arrives.
  const [loadedWith, setLoadedWith] = useState<string | null>(null)
  if (loadedWith === null && state !== null) setLoadedWith(state)

  if (item === undefined || item.sessionId === null || sentence === null) return null
  return {
    sessionId: item.sessionId,
    sentence,
    detail: itemSentence(item),
    offerFile: item.status !== 'on-watch' && item.status !== 'sent',
    changed: loadedWith !== null && state !== null && state !== loadedWith,
  }
}

/** The line itself: one row of 24 px, the file link beside the sentence when the run is not there. */
export function WristLineText({ line }: { line: WristLineModel }) {
  return (
    <p className={styles.line} role={line.changed ? 'status' : undefined} title={line.detail}>
      <span className={styles.text}>{line.sentence}</span>
      {line.offerFile ? (
        <a href={sessionFileHref(line.sessionId)} download className={styles.link}>
          {workoutLinkLabel('workout.link.file')}
        </a>
      ) : null}
    </p>
  )
}

/**
 * Today's one line about the run on the watch, for the `watch` slot (24 px at 360 px): "On your
 * watch.", "Sent to intervals.icu.", "The watch has the easy version of this run." or "Not on the
 * watch yet: <short reason>." with the workout file one tap away. The slot's own mount
 * (`today/slotMounts.tsx`) uses `useWristLine` directly, so the slot's frame appears only while
 * the line has something to say.
 */
export function WristLine({ item }: { item: WristItem | undefined }) {
  const line = useWristLine(item)
  return line === null ? null : <WristLineText line={line} />
}
