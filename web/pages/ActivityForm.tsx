import { useId, useState, type FormEvent } from 'react'
import { todayIso } from '../../shared/dates.ts'
import type { Activity, ActivityType, Units } from '../../shared/types.ts'
import { formatDuration, kmToM, mToKm, mToMiles, milesToM } from '../../shared/units.ts'
import {
  useCreateActivity,
  useDeleteActivity,
  useUpdateActivity,
  type ActivityInput,
} from '../api/activities.ts'
import { ApiError, fieldErrors } from '../api/client.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from '../components/Button.tsx'
import { Field, Input, Textarea } from '../components/Field.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { useToast } from '../components/Toast.tsx'
import styles from './ActivityForm.module.css'

export interface ActivityFormProps {
  open: boolean
  onClose: () => void
  activity?: Activity
}

export const TYPE_LABELS: Record<ActivityType, string> = {
  run: 'Run',
  race: 'Race',
  strength: 'Strength',
  cross: 'Cross',
}

const TYPE_OPTIONS = (Object.keys(TYPE_LABELS) as ActivityType[]).map((value) => ({
  value,
  label: TYPE_LABELS[value],
}))

const MAX_DURATION_SEC = 48 * 3600
const M_PER_FOOT = 0.3048
const DURATION_HINT = 'Enter minutes like 45, or 0:45:00'

/**
 * A bare number is minutes; `m:ss` and `h:mm:ss` are read as written. Seconds, and minutes
 * after an hour, must be below 60. Null for anything else, zero, or more than 48 hours.
 */
export function parseDurationInput(text: string): number | null {
  const value = text.trim()
  let seconds: number
  if (/^\d+([.,]\d+)?$/.test(value)) {
    seconds = Math.round(Number(value.replace(',', '.')) * 60)
  } else {
    const parts = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(value)
    if (!parts) return null
    const [, first = '', second = '', third] = parts
    if (third === undefined) {
      if (Number(second) >= 60) return null
      seconds = Number(first) * 60 + Number(second)
    } else {
      if (Number(second) >= 60 || Number(third) >= 60) return null
      seconds = Number(first) * 3600 + Number(second) * 60 + Number(third)
    }
  }
  return seconds >= 1 && seconds <= MAX_DURATION_SEC ? seconds : null
}

/** A positive decimal (point or comma) in the display unit, as whole metres. */
export function parseDistanceInput(text: string, units: Units): number | null {
  const value = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(value)) return null
  const metres = Math.round(units === 'mi' ? milesToM(Number(value)) : kmToM(Number(value)))
  return metres > 0 ? metres : null
}

/** Whole feet or metres, as typed in the elevation field. */
function parseElevationInput(text: string, units: Units): number | null {
  const value = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(value)) return null
  return Math.round(units === 'mi' ? Number(value) * M_PER_FOOT : Number(value))
}

function parseHeartRate(text: string): number | null {
  const value = text.trim()
  if (!/^\d+$/.test(value)) return null
  const bpm = Number(value)
  return bpm >= 30 && bpm <= 250 ? bpm : null
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(2)))
}

function distanceText(distanceM: number | null | undefined, units: Units): string {
  if (distanceM == null) return ''
  return trimNumber(units === 'mi' ? mToMiles(distanceM) : mToKm(distanceM))
}

function elevationText(elevationGainM: number | null | undefined, units: Units): string {
  if (elevationGainM == null) return ''
  return String(units === 'mi' ? Math.round(elevationGainM / M_PER_FOOT) : elevationGainM)
}

/** The request body that recreates an activity; empty fields are left out. */
export function activityToInput(activity: Activity): ActivityInput {
  const input: ActivityInput = {
    date: activity.date,
    type: activity.type,
    durationSec: activity.durationSec,
  }
  if (activity.startTime !== null) input.startTime = activity.startTime
  if (activity.distanceM !== null) input.distanceM = activity.distanceM
  if (activity.rpe !== null) input.rpe = activity.rpe
  if (activity.avgHr !== null) input.avgHr = activity.avgHr
  if (activity.maxHr !== null) input.maxHr = activity.maxHr
  if (activity.elevationGainM !== null) input.elevationGainM = activity.elevationGainM
  if (activity.notes !== null) input.notes = activity.notes
  return input
}

const SERVER_FIELDS: Record<string, string> = {
  date: 'date',
  startTime: 'startTime',
  durationSec: 'duration',
  distanceM: 'distance',
  rpe: 'rpe',
  avgHr: 'avgHr',
  maxHr: 'maxHr',
  elevationGainM: 'elevation',
  notes: 'notes',
}

type Errors = Partial<Record<string, string>>

/** The add and edit sheet. Closed, it renders nothing, so every opening starts from fresh state. */
export function ActivityForm(props: ActivityFormProps) {
  if (!props.open) return null
  return <ActivityFormSheet {...props} />
}

function ActivityFormSheet({ onClose, activity }: ActivityFormProps) {
  const formId = useId()
  const settings = useSettings()
  const units: Units = settings.data?.units ?? 'mi'
  const toast = useToast()
  const create = useCreateActivity()
  const update = useUpdateActivity()
  const remove = useDeleteActivity()

  const initial = {
    distance: distanceText(activity?.distanceM, units),
    elevation: elevationText(activity?.elevationGainM, units),
  }
  const [date, setDate] = useState(activity?.date ?? todayIso())
  const [type, setType] = useState<ActivityType>(activity?.type ?? 'run')
  const [duration, setDuration] = useState(activity ? formatDuration(activity.durationSec) : '')
  const [distance, setDistance] = useState(initial.distance)
  const [startTime, setStartTime] = useState(activity?.startTime ?? '')
  const [rpe, setRpe] = useState<number | null>(activity?.rpe ?? null)
  const [avgHr, setAvgHr] = useState(activity?.avgHr?.toString() ?? '')
  const [maxHr, setMaxHr] = useState(activity?.maxHr?.toString() ?? '')
  const [elevation, setElevation] = useState(initial.elevation)
  const [notes, setNotes] = useState(activity?.notes ?? '')
  const [showMore, setShowMore] = useState(
    activity !== undefined &&
      (activity.startTime !== null ||
        activity.rpe !== null ||
        activity.avgHr !== null ||
        activity.maxHr !== null ||
        activity.elevationGainM !== null ||
        activity.notes !== null),
  )
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const saving = create.isPending || update.isPending
  const hasDistance = type !== 'strength'
  const distanceUnitLabel = units === 'mi' ? 'mi' : 'km'
  const elevationUnitLabel = units === 'mi' ? 'ft' : 'm'

  /** Reads the fields; either the request body or a message per bad field. */
  function build(): { input: ActivityInput } | { errors: Errors } {
    const found: Errors = {}
    const durationSec = parseDurationInput(duration)
    if (durationSec === null) found.duration = DURATION_HINT
    if (date === '') found.date = 'Choose a date'

    let distanceM: number | null = null
    if (hasDistance && distance.trim() !== '') {
      // Re-deriving from the rounded display text would nudge an untouched value.
      distanceM =
        distance === initial.distance && activity?.distanceM != null
          ? activity.distanceM
          : parseDistanceInput(distance, units)
      if (distanceM === null) found.distance = 'Enter a distance like 5 or 5.2'
    }

    let avgHrValue: number | null = null
    if (avgHr.trim() !== '') {
      avgHrValue = parseHeartRate(avgHr)
      if (avgHrValue === null) found.avgHr = 'Enter beats per minute like 150'
    }
    let maxHrValue: number | null = null
    if (maxHr.trim() !== '') {
      maxHrValue = parseHeartRate(maxHr)
      if (maxHrValue === null) found.maxHr = 'Enter beats per minute like 175'
    }

    let elevationGainM: number | null = null
    if (elevation.trim() !== '') {
      elevationGainM =
        elevation === initial.elevation && activity?.elevationGainM != null
          ? activity.elevationGainM
          : parseElevationInput(elevation, units)
      if (elevationGainM === null) found.elevation = 'Enter a number like 120'
    }

    if (Object.keys(found).length > 0 || durationSec === null) return { errors: found }

    const input: ActivityInput = { date, type, durationSec }
    if (startTime !== '') input.startTime = startTime
    if (distanceM !== null) input.distanceM = distanceM
    if (rpe !== null) input.rpe = rpe
    if (avgHrValue !== null) input.avgHr = avgHrValue
    if (maxHrValue !== null) input.maxHr = maxHrValue
    if (elevationGainM !== null) input.elevationGainM = elevationGainM
    if (notes.trim() !== '') input.notes = notes.trim()
    return { input }
  }

  function revealHiddenErrors(found: Errors) {
    if (found.avgHr || found.maxHr || found.elevation || found.startTime || found.notes) {
      setShowMore(true)
    }
  }

  async function submit() {
    const built = build()
    if ('errors' in built) {
      setErrors(built.errors)
      setFormError(null)
      revealHiddenErrors(built.errors)
      return
    }
    setErrors({})
    setFormError(null)
    try {
      if (activity) await update.mutateAsync({ id: activity.id, input: built.input })
      else await create.mutateAsync(built.input)
    } catch (err) {
      const mapped: Errors = {}
      for (const [path, message] of Object.entries(fieldErrors(err))) {
        const field = SERVER_FIELDS[path]
        if (field !== undefined) mapped[field] = message
      }
      setErrors(mapped)
      revealHiddenErrors(mapped)
      const reason = err instanceof ApiError ? err.message : 'Something went wrong.'
      setFormError(`Activity not saved. ${reason} Your entries are still in the form; try again.`)
      return
    }
    toast.show(`${TYPE_LABELS[built.input.type]} saved`)
    onClose()
  }

  async function deleteActivity(target: Activity) {
    try {
      await remove.mutateAsync(target.id)
    } catch (err) {
      setConfirmingDelete(false)
      const reason = err instanceof ApiError ? err.message : 'Something went wrong.'
      setFormError(`Activity not deleted. ${reason} Try again.`)
      return
    }
    // An imported row comes back through a re-import; only a manual row can be re-posted as it was.
    toast.show(
      'Activity deleted',
      target.source === 'manual'
        ? {
            action: {
              label: 'Undo',
              onClick: () => {
                create.mutate(activityToInput(target))
              },
            },
          }
        : undefined,
    )
    onClose()
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void submit()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={activity ? 'Edit activity' : 'Log activity'}
      footer={
        <Button type="submit" form={formId} variant="primary" loading={saving}>
          Save
        </Button>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className={styles.form}>
        <Field label="Date" error={errors.date}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
              }}
            />
          )}
        </Field>

        <Segmented label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} />

        <Field label="Duration" hint="Minutes like 45, or 0:45:00" error={errors.duration}>
          {(control) => (
            <Input
              {...control}
              type="text"
              inputMode="text"
              autoComplete="off"
              value={duration}
              onChange={(e) => {
                setDuration(e.target.value)
              }}
            />
          )}
        </Field>

        {hasDistance ? (
          <Field label={`Distance (${distanceUnitLabel})`} error={errors.distance}>
            {(control) => (
              <Input
                {...control}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={distance}
                onChange={(e) => {
                  setDistance(e.target.value)
                }}
              />
            )}
          </Field>
        ) : null}

        <Button
          variant="quiet"
          className={styles.more}
          aria-expanded={showMore}
          onClick={() => {
            setShowMore((v) => !v)
          }}
        >
          More details
        </Button>

        {showMore ? (
          <div className={styles.details}>
            <Field label="Start time" error={errors.startTime}>
              {(control) => (
                <Input
                  {...control}
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value)
                  }}
                />
              )}
            </Field>

            <fieldset className={styles.rpe}>
              <legend>RPE</legend>
              <div className={styles.chips}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={styles.chip}
                    aria-pressed={rpe === n}
                    onClick={() => {
                      setRpe(rpe === n ? null : n)
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className={styles.hint}>1 is very easy, 10 is all out. Tap again to clear.</p>
            </fieldset>

            <div className={styles.pair}>
              <Field label="Average HR" error={errors.avgHr}>
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={avgHr}
                    onChange={(e) => {
                      setAvgHr(e.target.value)
                    }}
                  />
                )}
              </Field>
              <Field label="Max HR" error={errors.maxHr}>
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={maxHr}
                    onChange={(e) => {
                      setMaxHr(e.target.value)
                    }}
                  />
                )}
              </Field>
            </div>

            <Field label={`Elevation gain (${elevationUnitLabel})`} error={errors.elevation}>
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={elevation}
                  onChange={(e) => {
                    setElevation(e.target.value)
                  }}
                />
              )}
            </Field>

            <Field label="Notes" error={errors.notes}>
              {(control) => (
                <Textarea
                  {...control}
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value)
                  }}
                />
              )}
            </Field>
          </div>
        ) : null}

        {formError !== null ? (
          <p role="alert" className={styles.formError}>
            {formError}
          </p>
        ) : null}

        {activity ? (
          <div className={styles.danger}>
            {confirmingDelete ? (
              <>
                <p>Delete this activity?</p>
                <div className={styles.dangerActions}>
                  <Button
                    variant="danger"
                    loading={remove.isPending}
                    onClick={() => {
                      void deleteActivity(activity)
                    }}
                  >
                    Delete activity
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setConfirmingDelete(false)
                    }}
                  >
                    Keep
                  </Button>
                </div>
              </>
            ) : (
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmingDelete(true)
                }}
              >
                Delete
              </Button>
            )}
          </div>
        ) : null}
      </form>
    </Sheet>
  )
}
