import { useEffect, useId, useRef, useState } from 'react'
import { countPhrase, formatQuantity } from '../../../shared/copy/quantity.ts'
import type { StrengthLog, Units, WeightUnit } from '../../../shared/types.ts'
import { useDeleteStrengthLog } from '../../api/strength.ts'
import { Button } from '../Button.tsx'
import { useToast } from '../Toast.tsx'
import type { PageWords } from './strengthPageText.ts'
import styles from './StrengthSections.module.css'

export interface RecentSessionsProps {
  /** The logged sessions of the last 26 weeks, newest first, at most 30. */
  logs: readonly StrengthLog[]
  words: PageWords
  units: Units
  weightUnit: WeightUnit
  /** "Edit": the logging sheet opens on the log. */
  onEdit: (log: StrengthLog) => void
}

/**
 * The recent sessions (design 11.3, part 6): the last 30 with their sets and minutes, each with Edit
 * and Delete. Delete asks first and removes the log and its sets; the activity stays. The suggestions
 * follow the remaining logs, which the hook reads again.
 */
export function RecentSessions({ logs, words, units, weightUnit, onEdit }: RecentSessionsProps) {
  const headingId = useId()
  const toast = useToast()
  const remove = useDeleteStrengthLog()
  const [confirming, setConfirming] = useState<string | null>(null)
  // Focus has to land somewhere when the question closes: back on the row's own Delete after
  // "Keep", on the section's heading after the sets are gone with their row.
  const restore = useRef<string | null>(null)
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>())
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (restore.current !== null) {
      deleteButtons.current.get(restore.current)?.focus()
      restore.current = null
    }
  })

  function confirmDelete(log: StrengthLog): void {
    remove.mutateAsync(log.id).then(
      () => {
        setConfirming(null)
        headingRef.current?.focus()
        toast.show(words.say('strength.page.deleted'))
      },
      () => {
        // the failure shows under the question, and the sets stay
      },
    )
  }

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 ref={headingRef} tabIndex={-1} id={headingId} className={styles.heading}>
        {words.say('strength.page.recent-heading')}
      </h2>
      {logs.length === 0 ? (
        <p className={styles.lead}>{words.say('strength.page.recent-empty')}</p>
      ) : (
        <ul className={styles.list}>
          {logs.map((log) => {
            const date = words.day(log.date, 'weekday')
            return (
              <li key={log.id} className={styles.item}>
                <span className={styles.rowName}>{formatQuantity(date, units, weightUnit)}</span>
                <span className={styles.rowText}>
                  {words.heading(log.prescribed.template, log.prescribed.variant)}
                </span>
                <span className={styles.note}>
                  {words.say('strength.page.recent-detail', {
                    sets: countPhrase(log.sets.length, 'set'),
                    minutes: words.minutes(log.durationMin),
                  })}
                </span>
                {confirming === log.id ? (
                  <div role="group" aria-label={words.say('strength.page.delete-for', { date })}>
                    <p className={styles.lead}>{words.say('strength.page.delete-ask')}</p>
                    {remove.isError ? (
                      <p role="alert" className={styles.error}>
                        {words.say('strength.page.delete-error')}
                      </p>
                    ) : null}
                    <div className={styles.actions}>
                      <Button
                        variant="danger"
                        loading={remove.isPending}
                        onClick={() => {
                          confirmDelete(log)
                        }}
                      >
                        {words.say('strength.page.delete-confirm')}
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() => {
                          remove.reset()
                          restore.current = log.id
                          setConfirming(null)
                        }}
                      >
                        {words.say('strength.page.delete-keep')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.flush}>
                    <Button
                      variant="quiet"
                      aria-label={words.say('strength.page.edit-for', { date })}
                      onClick={() => {
                        onEdit(log)
                      }}
                    >
                      {words.say('strength.page.edit')}
                    </Button>
                    <Button
                      variant="quiet"
                      ref={(node) => {
                        if (node === null) deleteButtons.current.delete(log.id)
                        else deleteButtons.current.set(log.id, node)
                      }}
                      aria-label={words.say('strength.page.delete-for', { date })}
                      onClick={() => {
                        remove.reset()
                        setConfirming(log.id)
                      }}
                    >
                      {words.say('strength.page.delete')}
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
