import { useId, useState, type FormEvent } from 'react'
import { fieldErrors } from '../api/client.ts'
import {
  useActivateGoal,
  useCreateGoal,
  useDeleteGoal,
  useGoals,
  useUpdateGoal,
  type GoalInput,
} from '../api/goals.ts'
import { useSettings } from '../api/settings.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Field, Input, Select, Textarea } from '../components/Field.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { useToast } from '../components/Toast.tsx'
import { formatLongDate } from '../components/format.ts'
import { formatDistance, kmToM, milesToM, mToKm, mToMiles } from '../../shared/units.ts'
import type { Goal, GoalPriority, GoalStatus, Units } from '../../shared/types.ts'
import styles from './GoalsPage.module.css'

interface Preset {
  label: string
  distanceM: number
}

/** Round to whole metres; "Half" is 21 097.5 m, kept inside the half-marathon class (<= 21 100 m). */
const PRESETS: readonly Preset[] = [
  { label: '5K', distanceM: 5000 },
  { label: '10K', distanceM: 10_000 },
  { label: 'Half', distanceM: 21_098 },
  { label: 'Marathon', distanceM: 42_195 },
  { label: '50K', distanceM: 50_000 },
  { label: '50 mi', distanceM: 80_467 },
  { label: '100K', distanceM: 100_000 },
  { label: '100 mi', distanceM: 160_934 },
]

const STATUS_LABELS: Record<GoalStatus, string> = {
  target: 'Target',
  considering: 'Considering',
  done: 'Done',
  dropped: 'Dropped',
}

const PRIORITY_OPTIONS: Array<{ value: GoalPriority; label: string }> = [
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
]

/** Field paths the server reports, mapped to the form field that shows them. */
const FORM_FIELDS = [
  'name',
  'priority',
  'status',
  'targetDate',
  'distanceM',
  'location',
  'successCriteria',
  'notes',
  'url',
] as const

function presetFor(distanceM: number | null): Preset | undefined {
  return distanceM === null ? undefined : PRESETS.find((p) => p.distanceM === distanceM)
}

function distanceText(distanceM: number | null, units: Units): string {
  if (distanceM === null || presetFor(distanceM)) return ''
  const value = units === 'mi' ? mToMiles(distanceM) : mToKm(distanceM)
  return String(Number(value.toFixed(2)))
}

/** Metres from text typed in the user's units; null when it is not a positive number. */
function parseDistance(text: string, units: Units): number | null {
  const value = Number(text.trim().replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(units === 'mi' ? milesToM(value) : kmToM(value))
}

function blankToNull(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

interface GoalFormProps {
  goal: Goal | null
  units: Units
  onClose: () => void
}

function GoalSheet({ goal, units, onClose }: GoalFormProps) {
  const formId = useId()
  const toast = useToast()
  const create = useCreateGoal()
  const update = useUpdateGoal()
  const mutation = goal ? update : create

  const [name, setName] = useState(goal?.name ?? '')
  const [priority, setPriority] = useState<GoalPriority>(goal?.priority ?? 'A')
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? 'target')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [provisional, setProvisional] = useState(goal?.dateProvisional ?? false)
  const [presetM, setPresetM] = useState<number | null>(
    presetFor(goal?.distanceM ?? null)?.distanceM ?? null,
  )
  const [custom, setCustom] = useState(distanceText(goal?.distanceM ?? null, units))
  const [location, setLocation] = useState(goal?.location ?? '')
  const [criteria, setCriteria] = useState(goal?.successCriteria ?? '')
  const [notes, setNotes] = useState(goal?.notes ?? '')
  const [url, setUrl] = useState(goal?.url ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const local: Record<string, string> = {}
    if (name.trim() === '') local.name = 'Enter a name, like "Spring half".'
    if (targetDate === '') local.targetDate = 'Pick the race date, even a rough one.'
    let distanceM: number | null = presetM
    if (presetM === null && custom.trim() !== '') {
      distanceM = parseDistance(custom, units)
      if (distanceM === null) local.distanceM = `Enter a distance in ${units}, like 13.1.`
    }
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length > 0) return

    const input: GoalInput = {
      name: name.trim(),
      priority,
      status,
      targetDate,
      dateProvisional: provisional,
      distanceM,
      location: blankToNull(location),
      successCriteria: blankToNull(criteria),
      notes: blankToNull(notes),
      url: blankToNull(url),
    }
    const onSuccess = () => {
      toast.show('Goal saved')
      onClose()
    }
    const onError = (err: Error) => {
      const fromServer = fieldErrors(err)
      setErrors(fromServer)
      if (!FORM_FIELDS.some((field) => field in fromServer)) {
        setFormError(`Goal not saved. ${err.message}`)
      }
    }
    if (goal) update.mutate({ id: goal.id, input }, { onSuccess, onError })
    else create.mutate(input, { onSuccess, onError })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={goal ? 'Edit goal' : 'Add goal'}
      footer={
        <Button type="submit" form={formId} variant="primary" loading={mutation.isPending}>
          Save goal
        </Button>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <Field label="Name" error={errors.name}>
          {(a) => (
            <Input
              {...a}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
              }}
            />
          )}
        </Field>
        <Segmented<GoalPriority>
          label="Priority"
          options={PRIORITY_OPTIONS}
          value={priority}
          onChange={setPriority}
        />
        <Field label="Status" error={errors.status}>
          {(a) => (
            <Select
              {...a}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as GoalStatus)
              }}
            >
              {(Object.keys(STATUS_LABELS) as GoalStatus[]).map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Race date" error={errors.targetDate}>
          {(a) => (
            <Input
              {...a}
              type="date"
              value={targetDate}
              onChange={(e) => {
                setTargetDate(e.target.value)
              }}
            />
          )}
        </Field>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={provisional}
            onChange={(e) => {
              setProvisional(e.target.checked)
            }}
          />
          Date is provisional
        </label>
        <div className={styles.distance} role="group" aria-label="Distance presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={styles.preset}
              aria-pressed={presetM === preset.distanceM}
              onClick={() => {
                setPresetM(presetM === preset.distanceM ? null : preset.distanceM)
                setCustom('')
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <Field label={`Distance (${units})`} error={errors.distanceM}>
          {(a) => (
            <Input
              {...a}
              inputMode="decimal"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value)
                setPresetM(null)
              }}
            />
          )}
        </Field>
        <Field label="Location" error={errors.location}>
          {(a) => (
            <Input
              {...a}
              value={location}
              onChange={(e) => {
                setLocation(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Success criteria" error={errors.successCriteria}>
          {(a) => (
            <Textarea
              {...a}
              value={criteria}
              onChange={(e) => {
                setCriteria(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Notes" error={errors.notes}>
          {(a) => (
            <Textarea
              {...a}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Link" error={errors.url}>
          {(a) => (
            <Input
              {...a}
              inputMode="url"
              autoCapitalize="none"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
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
    </Sheet>
  )
}

interface GoalRowProps {
  goal: Goal
  units: Units
  onEdit: () => void
}

function GoalRow({ goal, units, onEdit }: GoalRowProps) {
  const nameId = useId()
  const activate = useActivateGoal()
  const remove = useDeleteGoal()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const preset = presetFor(goal.distanceM)
  const error = activate.error ?? remove.error

  const details = [
    `${formatLongDate(goal.targetDate)}${goal.dateProvisional ? ' (provisional)' : ''}`,
    goal.distanceM === null ? null : (preset?.label ?? formatDistance(goal.distanceM, units)),
    goal.location,
  ].filter((part): part is string => part !== null && part !== '')

  return (
    <article className={styles.goal} aria-labelledby={nameId}>
      <div className={styles.head}>
        <h2 id={nameId} className={styles.name}>
          {goal.name}
        </h2>
        <span className={styles.priority}>Priority {goal.priority}</span>
        {goal.isActive ? <span className={styles.badge}>Active goal</span> : null}
      </div>
      <p className={styles.meta}>
        {STATUS_LABELS[goal.status]}. {details.join(', ')}
      </p>
      {goal.successCriteria !== null && goal.successCriteria !== '' ? (
        <p className={styles.note}>{goal.successCriteria}</p>
      ) : null}
      {goal.url !== null && goal.url !== '' ? (
        <p className={styles.note}>
          <a href={goal.url} rel="noopener noreferrer" target="_blank">
            {goal.url}
          </a>
        </p>
      ) : null}
      {confirming ? (
        <div className={styles.confirm}>
          <p className={styles.confirmText}>Delete {goal.name}?</p>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => {
              remove.mutate(goal.id, {
                onSuccess: () => {
                  toast.show('Goal deleted')
                },
              })
            }}
          >
            Delete goal
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setConfirming(false)
              remove.reset()
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          {goal.isActive ? null : (
            <Button
              variant="secondary"
              aria-describedby={nameId}
              loading={activate.isPending}
              onClick={() => {
                activate.mutate(goal.id)
              }}
            >
              Make active
            </Button>
          )}
          <Button variant="quiet" aria-label={`Edit ${goal.name}`} onClick={onEdit}>
            Edit
          </Button>
          <Button
            variant="quiet"
            aria-label={`Delete ${goal.name}`}
            onClick={() => {
              setConfirming(true)
            }}
          >
            Delete
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className={styles.error}>
          {error.message}
        </p>
      ) : null}
    </article>
  )
}

/** The registry of goal races; one is active and drives the plan. */
export function GoalsPage() {
  const goals = useGoals()
  const settings = useSettings()
  const units: Units = settings.data?.units ?? 'mi'
  const [editing, setEditing] = useState<Goal | 'new' | null>(null)

  function openNew() {
    setEditing('new')
  }

  let body
  if (goals.isError) {
    body = (
      <p role="alert" className={styles.error}>
        Goals did not load. The server did not respond; reload the page to try again.
      </p>
    )
  } else if (goals.isPending) {
    body = <Skeleton lines={4} />
  } else if (goals.data.length === 0) {
    body = (
      <EmptyState
        title="No goals yet."
        body="Add the race you are training for. One goal at a time drives the plan."
        action={
          <Button variant="primary" onClick={openNew}>
            Add goal
          </Button>
        }
      />
    )
  } else {
    body = (
      <div className={styles.list}>
        {goals.data.map((goal) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            units={units}
            onEdit={() => {
              setEditing(goal)
            }}
          />
        ))}
      </div>
    )
  }

  const hasGoals = goals.data !== undefined && goals.data.length > 0
  return (
    <>
      <PageHeader
        title="Goals"
        context="Races you are training for"
        actions={
          hasGoals ? (
            <Button variant="primary" onClick={openNew}>
              Add goal
            </Button>
          ) : undefined
        }
      />
      {body}
      {editing !== null ? (
        <GoalSheet
          key={editing === 'new' ? 'new' : editing.id}
          goal={editing === 'new' ? null : editing}
          units={units}
          onClose={() => {
            setEditing(null)
          }}
        />
      ) : null}
    </>
  )
}
