import { useId, useState, type FormEvent } from 'react'
import { isIsoDate } from '../../shared/dates.ts'
import type { PlanSession } from '../../shared/types.ts'
import { useUpdatePlanSession } from '../api/plan.ts'
import { Button } from './Button.tsx'
import { Field, Input } from './Field.tsx'
import { useToast } from './Toast.tsx'
import { formatShortDate, formatWeekday } from './format.ts'
// Shares the session sheet's section, heading, inline, muted and error classes.
import styles from './SessionSheet.module.css'

export interface SessionChangesProps {
  session: PlanSession
  onClose: () => void
}

/** Move a session to another day, or skip or restore it. */
export function SessionChanges({ session, onClose }: SessionChangesProps) {
  const formId = useId()
  const toast = useToast()
  const update = useUpdatePlanSession()
  const [date, setDate] = useState(session.date)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const done = session.status === 'completed' || session.status === 'partial'
  const unchanged = !isIsoDate(date) || date === session.date

  function move(event: FormEvent) {
    event.preventDefault()
    if (unchanged) return
    setError(null)
    update.mutate(
      { id: session.id, patch: { date } },
      {
        onSuccess: () => {
          toast.show(`Session moved to ${formatWeekday(date)} ${formatShortDate(date)}`)
          onClose()
        },
        onError: (err) => {
          setError(err.message)
        },
      },
    )
  }

  function skip(skipped: boolean) {
    setError(null)
    update.mutate(
      { id: session.id, patch: { skip: skipped } },
      {
        onSuccess: () => {
          toast.show(skipped ? 'Session skipped' : 'Session restored')
          onClose()
        },
        onError: (err) => {
          setError(err.message)
          setConfirming(false)
        },
      },
    )
  }

  return (
    <section className={styles.section} aria-labelledby={`${formId}-title`}>
      <h3 id={`${formId}-title`} className={styles.heading}>
        Change this session
      </h3>
      <form className={styles.inline} onSubmit={move} noValidate>
        <Field label="Move to">
          {(a) => (
            <Input
              {...a}
              type="date"
              value={date}
              disabled={done}
              onChange={(e) => {
                setDate(e.target.value)
              }}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="secondary"
          disabled={done || unchanged}
          loading={update.isPending}
        >
          Move session
        </Button>
      </form>
      <p className={styles.muted}>
        A move is checked against spacing and the weekly limits before it is saved.
      </p>
      {session.status === 'skipped' ? (
        <div>
          <Button
            variant="secondary"
            loading={update.isPending}
            onClick={() => {
              skip(false)
            }}
          >
            Restore session
          </Button>
        </div>
      ) : confirming ? (
        <div className={styles.inline} role="group" aria-label="Confirm skipping">
          <p>Skip this session?</p>
          <Button
            variant="secondary"
            loading={update.isPending}
            onClick={() => {
              skip(true)
            }}
          >
            Yes, skip it
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setConfirming(false)
            }}
          >
            Keep it
          </Button>
        </div>
      ) : (
        <div>
          <Button
            variant="secondary"
            disabled={done}
            onClick={() => {
              setConfirming(true)
            }}
          >
            Skip session
          </Button>
        </div>
      )}
      <p className={styles.muted}>A skipped session is not made up later.</p>
      {error !== null ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </section>
  )
}
