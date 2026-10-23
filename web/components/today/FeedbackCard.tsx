import { useId, useState } from 'react'
import { addDays } from '../../../shared/dates.ts'
import type { Activity, Units } from '../../../shared/types.ts'
import { formatDistance, formatDuration } from '../../../shared/units.ts'
import { useSaveFeedback } from '../../api/activities.ts'
import { ApiError } from '../../api/client.ts'
import { TYPE_LABELS } from '../../pages/ActivityForm.tsx'
import { Button } from '../Button.tsx'
import { FeedbackFields, type FeedbackValues } from '../FeelPicker.tsx'
import { formatShortDate, formatWeekday } from '../format.ts'
import styles from './today.module.css'

const FEEDBACK_DAYS = 7

/** Runs and races from the last week that have neither an RPE nor a feel, newest first. */
function unratedRecent(activities: Activity[], today: string): Activity[] {
  const first = addDays(today, 1 - FEEDBACK_DAYS)
  return activities.filter(
    (a) =>
      (a.type === 'run' || a.type === 'race') &&
      a.date >= first &&
      a.date <= today &&
      a.rpe === null &&
      a.feel === null &&
      a.duplicateStatus !== 'possible' &&
      a.duplicateStatus !== 'confirmed',
  )
}

/** "Run Tue 17 Mar, 30:00, 5.00 km" for one unrated run. */
function activityLine(activity: Activity, units: Units): { type: string; rest: string } {
  const figures = [
    formatDuration(activity.durationSec),
    ...(activity.distanceM === null ? [] : [formatDistance(activity.distanceM, units)]),
  ].join(', ')
  return {
    type: TYPE_LABELS[activity.type],
    rest: ` ${formatWeekday(activity.date)} ${formatShortDate(activity.date)}, ${figures}`,
  }
}

function FeedbackItem({
  activity,
  units,
  onSaved,
}: {
  activity: Activity
  units: Units
  onSaved: () => void
}) {
  const save = useSaveFeedback(activity.id)
  // Starts from the saved pain so a save that only sets RPE or feel does not clear it.
  const [value, setValue] = useState<FeedbackValues>({ rpe: null, feel: null, pain: activity.pain })
  const touched = value.rpe !== null || value.feel !== null || value.pain !== activity.pain
  const line = activityLine(activity, units)

  return (
    <li className={styles.feedbackItem}>
      <p className={styles.feedbackTitle}>
        <span className={styles.feedbackType}>{line.type}</span>
        {line.rest}
      </p>
      <FeedbackFields value={value} onChange={setValue} />
      <div className={styles.feedbackActions}>
        <Button
          variant="primary"
          disabled={!touched}
          loading={save.isPending}
          onClick={() => {
            // The saved run drops out of the card, which unmounts this item before a mutate-level
            // onSuccess could fire. The promise settles anyway, and the page owns the toast.
            save.mutateAsync(value).then(onSaved, () => {
              // The error shows in the card; there is nothing more to do here.
            })
          }}
        >
          Save
        </Button>
      </div>
      {save.isError ? (
        <p role="alert" className={styles.feedbackError}>
          {`Feedback not saved. ${save.error instanceof ApiError ? save.error.message : 'Something went wrong.'} Try again.`}
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
  activity: Activity
  units: Units
  onRate: () => void
}) {
  const line = activityLine(activity, units)
  return (
    <li className={styles.feedbackQueued}>
      <p className={styles.feedbackQueuedText}>
        <span className={styles.feedbackType}>{line.type}</span>
        {line.rest}
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
 * that opens the same form in place. `activities` is every recent activity; the card picks the
 * unrated runs itself.
 */
export function FeedbackCard({
  activities,
  today,
  units,
  onSaved,
}: {
  activities: Activity[]
  today: string
  units: Units
  onSaved: () => void
}) {
  const headingId = useId()
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const unrated = unratedRecent(activities, today)
  if (unrated.length === 0) return null
  const newestFirst = [...unrated].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
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
          <FeedbackItem key={newest.id} activity={newest} units={units} onSaved={onSaved} />
        )}
        {older.map((activity) =>
          opened.has(activity.id) ? (
            <FeedbackItem key={activity.id} activity={activity} units={units} onSaved={onSaved} />
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
