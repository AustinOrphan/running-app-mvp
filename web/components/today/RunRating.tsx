import { useEffect, useId, useRef, useState } from 'react'
import { render } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import type { Activity, Units } from '../../../shared/types.ts'
import {
  ratingUrl,
  useActivityNotices,
  useQueuedRating,
  useSaveRating,
  WriteRefused,
  type Landed,
} from '../../api/activityOutbox.ts'
import { ApiError } from '../../api/client.ts'
import { Button } from '../Button.tsx'
import { FeedbackFields, type FeedbackValues } from '../FeelPicker.tsx'
import { useToast } from '../Toast.tsx'
import styles from './RunRating.module.css'

/** The activities the rating ask is for: runs and races, as the server's list of unrated runs is. */
export function isRunLike(activity: Pick<Activity, 'type'>): boolean {
  return activity.type === 'run' || activity.type === 'race'
}

/** A run counts as unrated on Today while it has neither an effort rating nor a feel. */
export function isUnrated(run: Pick<Activity, 'rpe' | 'feel'>): boolean {
  return run.rpe === null && run.feel === null
}

/**
 * The rating ask for the run logged against today's session: effort, feel and pain, saved through
 * the same write as the "How did it go?" card, through the outbox: with no connection it is kept on
 * the phone and the block says so until it goes up. It shows only while the run has no rating. A
 * save keeps the block on the page as a line that says so (and takes focus, since the form it
 * replaces held it), because the fresh read of Today would otherwise remove the block under the
 * runner. A rating the server refused when it was sent later brings the form back.
 */
export function RunRating({ run, units }: { run: Activity; units: Units }) {
  const headingId = useId()
  const save = useSaveRating(run.id)
  const queued = useQueuedRating(run.id)
  const { notices } = useActivityNotices()
  const refused = notices.some((notice) => notice.url === ratingUrl(run.id))
  const toast = useToast()
  // Starts from the saved pain so a save that only sets RPE or feel does not clear it.
  const [value, setValue] = useState<FeedbackValues>({ rpe: null, feel: null, pain: run.pain })
  const [saved, setSaved] = useState<Landed | null>(null)
  const done = useRef<HTMLParagraphElement>(null)
  const touched = value.rpe !== null || value.feel !== null || value.pain !== run.pain

  useEffect(() => {
    if (saved !== null) done.current?.focus()
  }, [saved])

  if ((saved !== null && !refused) || queued) {
    return (
      <p ref={done} tabIndex={-1} role="status" className={styles.saved}>
        {render(TEMPLATES[queued ? 'today.rate.queued' : 'today.rate.saved'], {}, units)}
      </p>
    )
  }
  if (!isUnrated(run)) return null

  return (
    <section aria-labelledby={headingId} className={styles.rating}>
      <h3 id={headingId} className={styles.heading}>
        {render(TEMPLATES['today.rate.heading'], {}, units)}
      </h3>
      <p className={styles.caption}>{render(TEMPLATES['today.rate.caption'], {}, units)}</p>
      <FeedbackFields value={value} onChange={setValue} />
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={!touched}
          loading={save.isPending}
          onClick={() => {
            save.mutate(value, {
              onSuccess: (landed) => {
                setSaved(landed)
                toast.show(
                  landed === 'queued'
                    ? render(TEMPLATES['today.rate.queued'], {}, units)
                    : 'Feedback saved',
                )
              },
            })
          }}
        >
          {render(TEMPLATES['today.rate.save'], {}, units)}
        </Button>
      </div>
      {save.isError ? (
        <p role="alert" className={styles.error}>
          {render(
            TEMPLATES['today.rate.not-saved'],
            {
              reason:
                save.error instanceof ApiError || save.error instanceof WriteRefused
                  ? save.error.message
                  : 'Something went wrong.',
            },
            units,
          )}
        </p>
      ) : null}
    </section>
  )
}
