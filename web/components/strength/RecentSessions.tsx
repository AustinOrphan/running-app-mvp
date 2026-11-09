import { useEffect, useId, useRef, useState } from 'react'
import { countPhrase, formatQuantity } from '../../../shared/copy/quantity.ts'
import type { StrengthLog, Units, WeightUnit } from '../../../shared/types.ts'
import { useDeleteStrengthLog } from '../../api/strength.ts'
import { Button } from '../Button.tsx'
import { ConfirmSheet } from '../ConfirmSheet.tsx'
import { TrashGlyph } from '../Glyphs.tsx'
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
  // The sheet gives focus back to the row's own Delete after "Keep". After the sets are gone with
  // their row there is no such button, so the section's heading takes it once the sheet has closed
  // (an effect runs after the sheet's own cleanup).
  const focusHeading = useRef(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (focusHeading.current) {
      focusHeading.current = false
      headingRef.current?.focus()
    }
  })

  const asked = logs.find((log) => log.id === confirming) ?? null

  function confirmDelete(log: StrengthLog): void {
    remove.mutateAsync(log.id).then(
      () => {
        focusHeading.current = true
        setConfirming(null)
        toast.show(words.say('strength.page.deleted'))
      },
      () => {
        // the failure shows in the sheet, and the sets stay
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
                    aria-label={words.say('strength.page.delete-for', { date })}
                    onClick={() => {
                      remove.reset()
                      setConfirming(log.id)
                    }}
                  >
                    <TrashGlyph />
                    {words.say('strength.page.delete')}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmSheet
        open={asked !== null}
        title={
          asked === null
            ? ''
            : words.say('strength.page.delete-for', { date: words.day(asked.date, 'weekday') })
        }
        confirmLabel={words.say('strength.page.delete-confirm')}
        keepLabel={words.say('strength.page.delete-keep')}
        pending={remove.isPending}
        error={remove.isError ? words.say('strength.page.delete-error') : null}
        onConfirm={() => {
          if (asked !== null) confirmDelete(asked)
        }}
        onClose={() => {
          remove.reset()
          setConfirming(null)
        }}
      >
        {words.say('strength.page.delete-ask')}
      </ConfirmSheet>
    </section>
  )
}
