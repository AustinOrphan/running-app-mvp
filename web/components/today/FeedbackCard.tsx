import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ActivityListItem, Units } from '../../../shared/types.ts'
import { formatDistance, formatDuration } from '../../../shared/units.ts'
import {
  useQueuedRating,
  useSaveRating,
  WriteRefused,
  type Landed,
} from '../../api/activityOutbox.ts'
import { ApiError } from '../../api/client.ts'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { TYPE_LABELS } from '../../pages/ActivityForm.tsx'
import { Button } from '../Button.tsx'
import { FeedbackFields, feedbackPatch, showHeatMark, type FeedbackValues } from '../FeelPicker.tsx'
import { formatShortDate, formatWeekday } from '../format.ts'
import styles from './FeedbackCard.module.css'

/** "Run Tue 17 Mar, 30:00, 5.00 km" for one unrated run. */
function activityLine(activity: ActivityListItem, units: Units): { type: string; rest: string } {
  const figures = [
    formatDuration(activity.durationSec),
    ...(activity.distanceM === null ? [] : [formatDistance(activity.distanceM, units)]),
  ].join(', ')
  return {
    type: TYPE_LABELS[activity.type],
    rest: ` ${formatWeekday(activity.date)} ${formatShortDate(activity.date)}, ${figures}`,
  }
}

/** The run's line, linked to its page, where the rating can also be read in full. */
function RunLink({ id, line }: { id: string; line: { type: string; rest: string } }) {
  return (
    <Link to={`/activities/${encodeURIComponent(id)}`} className={styles.runLink}>
      <span className={styles.feedbackType}>{line.type}</span>
      {line.rest}
    </Link>
  )
}

function FeedbackItem({
  activity,
  units,
  onSaved,
  heatDays,
}: {
  activity: ActivityListItem
  units: Units
  onSaved: (landed: Landed, heatOnly: boolean) => void
  heatDays: boolean
}) {
  const save = useSaveRating(activity.id)
  const queued = useQueuedRating(activity.id)
  // Starts from the saved pain and heat mark so a save that only sets RPE or feel does not clear them.
  const [value, setValue] = useState<FeedbackValues>({
    rpe: null,
    feel: null,
    pain: activity.pain,
    heatExposure: activity.heatExposure,
  })
  const touched =
    value.rpe !== null ||
    value.feel !== null ||
    value.pain !== activity.pain ||
    value.heatExposure !== activity.heatExposure
  const line = activityLine(activity, units)
  const waiting = useRef<HTMLParagraphElement>(null)
  // The Save button held focus and is gone once the rating waits; focus goes to the line that says so.
  const pickers = useRef<HTMLDivElement>(null)
  // Set by the runner's own Save, so a rating that was already waiting when the page opened does
  // not take focus.
  const saved = useRef(false)
  useEffect(() => {
    if (queued) {
      pickers.current?.setAttribute('inert', '')
      if (saved.current) {
        saved.current = false
        waiting.current?.focus()
      }
    } else pickers.current?.removeAttribute('inert')
  }, [queued])

  return (
    <li className={styles.feedbackItem}>
      <p className={styles.feedbackTitle}>
        <RunLink id={activity.id} line={line} />
      </p>
      {/* Waiting on the phone, the pickers stay in view but cannot be changed (there is no Save). */}
      <div ref={pickers}>
        <FeedbackFields
          value={value}
          onChange={setValue}
          showHeat={showHeatMark(activity, heatDays)}
          units={units}
        />
      </div>
      {queued ? (
        <p ref={waiting} tabIndex={-1} role="status" className={styles.caption}>
          {render(TEMPLATES['today.rate.waiting'], {}, units)}
        </p>
      ) : (
        <div className={styles.feedbackActions}>
          <Button
            variant="primary"
            disabled={!touched}
            loading={save.isPending}
            onClick={() => {
              // The saved run drops out of the card, which unmounts this item before a mutate-level
              // onSuccess could fire. The promise settles anyway, and the page owns the toast.
              saved.current = true
              const heatOnly =
                value.rpe === null && value.feel === null && value.pain === activity.pain
              save.mutateAsync(feedbackPatch(value, null)).then(
                (landed) => {
                  if (landed === 'sent') saved.current = false
                  onSaved(landed, heatOnly)
                },
                () => {
                  saved.current = false
                  // The error shows in the card; there is nothing more to do here.
                },
              )
            }}
          >
            Save
          </Button>
        </div>
      )}
      {save.isError ? (
        <p role="alert" className={styles.feedbackError}>
          {`Feedback not saved. ${
            save.error instanceof ApiError || save.error instanceof WriteRefused
              ? save.error.message
              : 'Something went wrong.'
          } Try again.`}
        </p>
      ) : null}
    </li>
  )
}

/** An older unrated run: one line with a Rate button that opens its form. */
function FeedbackQueued({
  activity,
  units,
  onRate,
}: {
  activity: ActivityListItem
  units: Units
  onRate: () => void
}) {
  const line = activityLine(activity, units)
  return (
    <li className={styles.feedbackQueued}>
      <p className={styles.feedbackQueuedText}>
        <RunLink id={activity.id} line={line} />
      </p>
      <Button
        variant="secondary"
        aria-label={`Rate ${line.type.toLowerCase()}${line.rest}`}
        onClick={onRate}
      >
        Rate
      </Button>
    </li>
  )
}

/**
 * The most recent unrated run of the last week in full; the others as a list with a Rate button
 * that opens the same form in place. `unrated` is the list the server sends with the payload
 * (`TodayView.unrated`): runs and races without an effort rating or a feel.
 */
export function FeedbackCard({
  unrated,
  units,
  onSaved,
  exclude = null,
  heatDays = false,
}: {
  unrated: ActivityListItem[]
  units: Units
  onSaved: (landed: Landed, heatOnly: boolean) => void
  /** Today says what counts as a heat day (`TodayHeat.heatDays`): the Heat mark is offered on runs. */
  heatDays?: boolean
  /** A run the hero already asks about, left out so it is not asked twice. */
  exclude?: string | null
}) {
  const headingId = useId()
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const rows = exclude === null ? unrated : unrated.filter((activity) => activity.id !== exclude)
  if (rows.length === 0) return null
  const newestFirst = [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const [newest, ...older] = newestFirst
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        How did it go?
      </h2>
      <p className={styles.caption}>
        Recent runs without a rating. A rating of effort or feel is what lets the plan adjust. Rate
        any or all of it.
      </p>
      <ul className={styles.feedbackList}>
        {newest === undefined ? null : (
          <FeedbackItem
            key={newest.id}
            activity={newest}
            units={units}
            onSaved={onSaved}
            heatDays={heatDays}
          />
        )}
        {older.map((activity) =>
          opened.has(activity.id) ? (
            <FeedbackItem
              key={activity.id}
              activity={activity}
              units={units}
              onSaved={onSaved}
              heatDays={heatDays}
            />
          ) : (
            <FeedbackQueued
              key={activity.id}
              activity={activity}
              units={units}
              onRate={() => {
                setOpened(new Set([...opened, activity.id]))
              }}
            />
          ),
        )}
      </ul>
    </section>
  )
}
