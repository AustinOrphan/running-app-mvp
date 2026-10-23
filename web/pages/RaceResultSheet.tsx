import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useActivities } from '../api/activities.ts'
import { ApiError, fieldErrors } from '../api/client.ts'
import { useRemoveResult, useSaveResult, type RaceResultInput } from '../api/predictions.ts'
import { Button } from '../components/Button.tsx'
import { Field, Input, Select, Textarea } from '../components/Field.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { useToast } from '../components/Toast.tsx'
import { formatShortDate, formatWeekday } from '../components/format.ts'
import {
  blankToNull,
  distanceInputText,
  parseDistance,
  parseTime,
} from '../components/goalFormat.ts'
import { render } from '../../shared/copy/template.ts'
import {
  TRACK_RECORD_TEMPLATES,
  activityHintText,
  activityLoadErrorText,
  distanceInvalidText,
  removedToast,
  resultButtonLabel,
  resultNotSavedText,
  resultRefusal,
  savedToast,
  sheetFieldProblem,
} from '../../shared/copy/trackRecord.ts'
import { addDays, isIsoDate, todayIso } from '../../shared/dates.ts'
import type { RaceOutcome } from '../../shared/engine/backtest.ts'
import { RESULT_ACTIVITY_WINDOW_DAYS } from '../../shared/limits.ts'
import type { ActivityListItem, Goal, TrackRecordRace, Units } from '../../shared/types.ts'
import { formatDistance, formatDuration } from '../../shared/units.ts'
import styles from './GoalsPage.module.css'

const T = TRACK_RECORD_TEMPLATES

const OUTCOME_OPTIONS: Array<{ value: RaceOutcome; label: string }> = [
  { value: 'finished', label: 'Finished' },
  { value: 'did-not-finish', label: 'Did not finish' },
]

/** The fields of the form that a server message can be shown under. */
const RESULT_FIELDS = ['timeSec', 'date', 'distanceM', 'activityId', 'note'] as const

/** "Sun 9 May, 3:52:10, 42.20 km, race": enough to tell the runs of a race weekend apart. */
function activityLabel(activity: ActivityListItem, units: Units): string {
  const parts = [
    `${formatWeekday(activity.date)} ${formatShortDate(activity.date)}`,
    formatDuration(activity.durationSec),
  ]
  if (activity.distanceM !== null) parts.push(formatDistance(activity.distanceM, units))
  parts.push(activity.type)
  return parts.join(', ')
}

/** A run or a race the app still shows: a confirmed duplicate is hidden everywhere. */
function canBeLinked(activity: ActivityListItem): boolean {
  return (
    (activity.type === 'run' || activity.type === 'race') &&
    !(activity.duplicateOfId !== null && activity.duplicateStatus === 'confirmed')
  )
}

interface DistanceState {
  text: string
  /** The exact metres behind `text` while the runner has not typed over it; null once they have. */
  metres: number | null
}

function distanceState(metres: number | null, units: Units): DistanceState {
  return { text: metres === null ? '' : distanceInputText(metres, units), metres }
}

export interface RaceResultSheetProps {
  goal: Goal
  /** The recorded result, when it is being edited; null when the first one is being recorded. */
  result: TrackRecordRace | null
  units: Units
  onClose: () => void
}

/**
 * Records, edits or removes the result of a goal race (design 11.6): the outcome, the official
 * time, the day, the distance, the activity that ran it and a note. The save replaces the whole
 * result, so the sheet starts from the stored one. Linking an activity retypes it to a race, which
 * the sheet says before it is saved.
 */
export function RaceResultSheet({ goal, result, units, onClose }: RaceResultSheetProps) {
  const formId = useId()
  const confirmId = useId()
  const toast = useToast()
  const save = useSaveResult()
  const remove = useRemoveResult()
  const today = todayIso()

  const [outcome, setOutcome] = useState<RaceOutcome>(result?.outcome ?? 'finished')
  const [time, setTime] = useState(
    result?.resultSec == null ? '' : formatDuration(result.resultSec),
  )
  const [date, setDate] = useState(
    result?.date ?? (goal.targetDate <= today ? goal.targetDate : today),
  )
  const [distance, setDistance] = useState(
    distanceState(result?.distanceM ?? goal.distanceM, units),
  )
  const [activityId, setActivityId] = useState(result?.activityId ?? '')
  // The activity picked from the list, kept so its label stays when the list is read again.
  const [picked, setPicked] = useState<ActivityListItem | null>(null)
  const [note, setNote] = useState(result?.note ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const form = useRef<HTMLFormElement>(null)
  const removeButton = useRef<HTMLButtonElement>(null)
  const confirmText = useRef<HTMLParagraphElement>(null)
  const returnFocus = useRef(false)

  // The runs near the race day, read through the paged list.
  const dateIsReal = isIsoDate(date)
  const nearby = useActivities(
    dateIsReal
      ? {
          from: addDays(date, -RESULT_ACTIVITY_WINDOW_DAYS),
          to: addDays(date, RESULT_ACTIVITY_WINDOW_DAYS),
        }
      : {},
    { enabled: dateIsReal },
  )
  const candidates = (nearby.data ?? []).filter(canBeLinked)
  const listed = candidates.some((activity) => activity.id === activityId)
  const chosen = candidates.find((activity) => activity.id === activityId) ?? picked

  // After a refused save, focus goes to the first field that needs attention.
  useEffect(() => {
    if (attempt > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [attempt])

  // The question replaces the Remove button: focus moves to its text, and back to the button on Cancel.
  useEffect(() => {
    if (confirmingRemove) confirmText.current?.focus()
    else if (returnFocus.current) {
      returnFocus.current = false
      removeButton.current?.focus()
    }
  }, [confirmingRemove])

  function chooseActivity(id: string) {
    setActivityId(id)
    setErrors((current) => {
      const next = { ...current }
      delete next.activityId
      return next
    })
    const activity = candidates.find((candidate) => candidate.id === id)
    setPicked(activity ?? null)
    if (activity === undefined) return
    // Choosing a run fills in what it records; every field can still be changed.
    setDate(activity.date)
    setTime(formatDuration(activity.durationSec))
    if (activity.distanceM !== null) setDistance(distanceState(activity.distanceM, units))
  }

  function refuse(local: Record<string, string>) {
    setErrors(local)
    setFormError(null)
    setAttempt((count) => count + 1)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const local: Record<string, string> = {}
    if (!dateIsReal) local.date = sheetFieldProblem('date-missing', units)
    let timeSec: number | null = null
    if (outcome === 'finished') {
      if (time.trim() === '') local.timeSec = resultRefusal('time-required')
      else {
        timeSec = parseTime(time)
        if (timeSec === null) local.timeSec = sheetFieldProblem('time-invalid', units)
      }
    }
    let distanceM: number | null = null
    if (distance.text.trim() !== '') {
      distanceM = distance.metres ?? parseDistance(distance.text, units)
      if (distanceM === null) local.distanceM = distanceInvalidText(units)
    }
    if (Object.keys(local).length > 0) {
      refuse(local)
      return
    }

    // The result is replaced whole, so the climb that is not on the form goes back as it was: the
    // stored one when editing, the goal's course when recording.
    const input: RaceResultInput = {
      outcome,
      timeSec,
      date,
      distanceM,
      gainM: result === null ? goal.gainM : result.gainM,
      activityId: activityId === '' ? null : activityId,
      note: blankToNull(note),
    }
    setErrors({})
    setFormError(null)
    save.mutate(
      { goalId: goal.id, input },
      {
        onSuccess: (saved) => {
          toast.show(savedToast(saved, units))
          onClose()
        },
        onError: (err) => {
          // The 409 names no field; the only conflict is an activity that is another race's result.
          const fromServer = fieldErrors(err)
          if (err instanceof ApiError && err.status === 409) fromServer.activityId = err.message
          setErrors(fromServer)
          setFormError(
            RESULT_FIELDS.some((field) => field in fromServer)
              ? null
              : resultNotSavedText(err.message, units),
          )
          setAttempt((count) => count + 1)
        },
      },
    )
  }

  function removeResult() {
    remove.mutate(goal.id, {
      onSuccess: () => {
        toast.show(removedToast(units))
        onClose()
      },
    })
  }

  function cancelRemove() {
    returnFocus.current = true
    setConfirmingRemove(false)
    remove.reset()
  }

  function onConfirmKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || remove.isPending) return
    event.stopPropagation()
    cancelRemove()
  }

  const activityHint =
    activityId !== ''
      ? render(T['track-record.sheet.link-notice'], {}, units)
      : activityHintText(RESULT_ACTIVITY_WINDOW_DAYS, units)
  const activityMessage = nearby.isError ? activityLoadErrorText(units) : activityHint

  return (
    <Sheet
      open
      onClose={onClose}
      title={resultButtonLabel(result !== null, units)}
      footer={
        <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
          {render(T['track-record.save-result'], {}, units)}
        </Button>
      }
    >
      <form id={formId} ref={form} className={styles.form} onSubmit={submit} noValidate>
        <Segmented<RaceOutcome>
          label="Outcome"
          options={OUTCOME_OPTIONS}
          value={outcome}
          onChange={setOutcome}
        />
        {outcome === 'finished' ? (
          <Field
            label="Finish time (h:mm:ss)"
            hint={render(T['track-record.sheet.time-hint'], {}, units)}
            error={errors.timeSec}
          >
            {(a) => (
              <Input
                {...a}
                inputMode="numeric"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value)
                }}
              />
            )}
          </Field>
        ) : null}
        <Field label="Race date" error={errors.date}>
          {(a) => (
            <Input
              {...a}
              type="date"
              max={today}
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label={`Distance (${units})`} error={errors.distanceM}>
          {(a) => (
            <Input
              {...a}
              inputMode="decimal"
              value={distance.text}
              onChange={(e) => {
                setDistance({ text: e.target.value, metres: null })
              }}
            />
          )}
        </Field>
        <Field label="Activity" hint={activityMessage} error={errors.activityId}>
          {(a) => (
            <Select
              {...a}
              value={activityId}
              onChange={(e) => {
                chooseActivity(e.target.value)
              }}
            >
              <option value="">Not linked</option>
              {candidates.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activityLabel(activity, units)}
                </option>
              ))}
              {activityId !== '' && !listed ? (
                <option value={activityId}>
                  {chosen === null ? 'Linked activity' : activityLabel(chosen, units)}
                </option>
              ) : null}
            </Select>
          )}
        </Field>
        <Field label="Notes" error={errors.note}>
          {(a) => (
            <Textarea
              {...a}
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
              }}
            />
          )}
        </Field>
        {formError !== null ? (
          <p role="alert" className={styles.error}>
            {formError}
          </p>
        ) : null}
      </form>
      {result !== null ? (
        confirmingRemove ? (
          <div
            className={styles.confirm}
            role="group"
            aria-labelledby={confirmId}
            onKeyDown={onConfirmKeyDown}
          >
            <p id={confirmId} ref={confirmText} tabIndex={-1} className={styles.confirmText}>
              {render(T['track-record.sheet.remove-confirm'], {}, units)}
            </p>
            <Button variant="secondary" loading={remove.isPending} onClick={removeResult}>
              {render(T['track-record.remove-result'], {}, units)}
            </Button>
            <Button variant="quiet" disabled={remove.isPending} onClick={cancelRemove}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className={styles.actions}>
            <Button
              ref={removeButton}
              variant="secondary"
              onClick={() => {
                setConfirmingRemove(true)
              }}
            >
              {render(T['track-record.remove-result'], {}, units)}
            </Button>
          </div>
        )
      ) : null}
      {remove.error !== null ? (
        <p role="alert" className={styles.error}>
          {remove.error.message}
        </p>
      ) : null}
    </Sheet>
  )
}
