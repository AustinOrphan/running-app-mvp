import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { fieldErrors } from '../api/client.ts'
import {
  replacePlanRequired,
  useActivateGoal,
  useCreateGoal,
  useDeleteGoal,
  useGoals,
  useUpdateGoal,
  type GoalInput,
} from '../api/goals.ts'
import { useArchivedPlans, usePlan, useRestorePlan } from '../api/plan.ts'
import { usePredictions } from '../api/predictions.ts'
import { useSettings } from '../api/settings.ts'
import { ActivateConfirm } from '../components/ActivateConfirm.tsx'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { localiseEngineText } from '../components/engineText.ts'
import { ExplainButton } from '../components/ExplainButton.tsx'
import { Field, Input, Select, Textarea } from '../components/Field.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { useToast } from '../components/Toast.tsx'
import { formatLongDate } from '../components/format.ts'
import {
  RESTORE_BUTTON_LABEL,
  RESTORE_DONE_TEXT,
  RESTORE_NOT_UPDATED_TEXT,
  activateBuiltText,
  restoreNoteText,
} from '../../shared/copy/goals.ts'
import { todayIso } from '../../shared/dates.ts'
import {
  formatDistance,
  formatDuration,
  kmToM,
  milesToM,
  mToKm,
  mToMiles,
} from '../../shared/units.ts'
import type {
  ActivateRequiresPlan,
  ArchivedPlanView,
  Goal,
  GoalPriority,
  GoalStatus,
  GoalSurface,
  GoalType,
  SupportLevel,
  Units,
} from '../../shared/types.ts'
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

const SURFACE_LABELS: Record<GoalSurface, string> = {
  road: 'Road',
  trail: 'Trail',
  track: 'Track',
  mixed: 'Mixed',
}

const GOAL_TYPE_OPTIONS: Array<{ value: GoalType; label: string }> = [
  { value: 'finish', label: 'Finish' },
  { value: 'time', label: 'Time' },
]

const SUPPORT_OPTIONS: Array<{ value: SupportLevel; label: string }> = [
  { value: 'aided', label: 'Aided' },
  { value: 'self', label: 'Self-supported' },
]

/** Races longer than this are ultras, and default to a finish goal [rules D1, D2]. */
const ULTRA_THRESHOLD_M = 42_200

const FEASIBILITY_LABELS = {
  comfortable: 'Comfortable',
  tight: 'Tight',
  'not-reachable': 'Not reachable within default limits',
} as const

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
  'gainM',
  'lossM',
  'surface',
  'goalType',
  'targetTimeSec',
  'startTime',
  'raceLat',
  'raceLng',
  'supportLevel',
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

function defaultGoalType(distanceM: number | null): GoalType {
  return distanceM !== null && distanceM > ULTRA_THRESHOLD_M ? 'finish' : 'time'
}

/** Whole metres from text; blank is null, anything else that is not a whole number is undefined. */
function parseMetres(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  return /^\d{1,5}$/.test(trimmed) ? Number(trimmed) : undefined
}

/** Seconds from `h:mm:ss` or `m:ss`; null when the text is not a time. */
function parseTime(text: string): number | null {
  const match = /^(?:(\d{1,3}):)?([0-5]?\d):([0-5]\d)$/.exec(text.trim())
  if (!match) return null
  const seconds = (Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])
  return seconds > 0 ? seconds : null
}

/** A coordinate kept to 0.01 degrees; null when the text is not a number in range. */
function parseCoordinate(text: string, limit: number): number | null {
  const value = Number(text.trim().replace(',', '.'))
  if (text.trim() === '' || !Number.isFinite(value) || Math.abs(value) > limit) return null
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? 0 : rounded
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
  // The stored distance, shown rounded. Untouched text keeps the stored metres: re-parsing the
  // rounded text would drift them on every save.
  const initialCustom = distanceText(goal?.distanceM ?? null, units)
  const [custom, setCustom] = useState(initialCustom)
  const [location, setLocation] = useState(goal?.location ?? '')
  const [criteria, setCriteria] = useState(goal?.successCriteria ?? '')
  const [notes, setNotes] = useState(goal?.notes ?? '')
  const [url, setUrl] = useState(goal?.url ?? '')
  const [gain, setGain] = useState(goal?.gainM == null ? '' : String(goal.gainM))
  const [loss, setLoss] = useState(goal?.lossM == null ? '' : String(goal.lossM))
  const [surface, setSurface] = useState<GoalSurface>(goal?.surface ?? 'road')
  // null: follow the distance (finish above 42.2 km, else time) until the runner chooses.
  const [goalTypeChoice, setGoalTypeChoice] = useState<GoalType | null>(
    // A time goal without a target was never chosen by the runner; it follows the distance.
    goal && !(goal.goalType === 'time' && goal.targetTimeSec === null) ? goal.goalType : null,
  )
  const [targetTime, setTargetTime] = useState(
    goal?.targetTimeSec == null ? '' : formatDuration(goal.targetTimeSec),
  )
  const [startTime, setStartTime] = useState(goal?.startTime ?? '')
  const [support, setSupport] = useState<SupportLevel>(goal?.supportLevel ?? 'aided')
  const [raceLat, setRaceLat] = useState(goal?.raceLat == null ? '' : String(goal.raceLat))
  const [raceLng, setRaceLng] = useState(goal?.raceLng == null ? '' : String(goal.raceLng))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const shownDistance =
    presetM ??
    (custom.trim() === ''
      ? null
      : goal?.distanceM != null && custom === initialCustom
        ? goal.distanceM
        : parseDistance(custom, units))
  const goalType = goalTypeChoice ?? defaultGoalType(shownDistance)

  function submit(event: FormEvent) {
    event.preventDefault()
    const local: Record<string, string> = {}
    if (name.trim() === '') local.name = 'Enter a name, like "Spring half".'
    if (targetDate === '') local.targetDate = 'Pick the race date, even a rough one.'
    let distanceM: number | null = presetM
    if (presetM === null && custom.trim() !== '') {
      distanceM =
        goal?.distanceM != null && custom === initialCustom
          ? goal.distanceM
          : parseDistance(custom, units)
      if (distanceM === null) local.distanceM = `Enter a distance in ${units}, like 13.1.`
    }
    const gainM = parseMetres(gain)
    if (gainM === undefined) local.gainM = 'Enter whole metres, like 1200.'
    const lossM = parseMetres(loss)
    if (lossM === undefined) local.lossM = 'Enter whole metres, like 1200.'
    let targetTimeSec: number | null = null
    if (goalType === 'time') {
      if (targetTime.trim() === '') {
        // The server needs a target only for a time goal the runner chose; one that follows the
        // distance stays without it and the engine plans finish-first.
        if (goalTypeChoice === 'time') {
          local.targetTimeSec = 'Enter a target time like 1:45:30, or choose a finish goal.'
        }
      } else {
        targetTimeSec = parseTime(targetTime)
        if (targetTimeSec === null) local.targetTimeSec = 'Enter a time like 1:45:30.'
      }
    }
    const lat = raceLat.trim() === '' ? null : parseCoordinate(raceLat, 90)
    if (raceLat.trim() !== '' && lat === null) local.raceLat = 'Enter a latitude like 46.81.'
    const lng = raceLng.trim() === '' ? null : parseCoordinate(raceLng, 180)
    if (raceLng.trim() !== '' && lng === null) local.raceLng = 'Enter a longitude like 8.23.'
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
      gainM: gainM ?? null,
      lossM: lossM ?? null,
      surface,
      goalType: goalType === 'time' && targetTimeSec === null ? undefined : goalType,
      targetTimeSec,
      startTime: startTime === '' ? null : startTime,
      raceLat: lat,
      raceLng: lng,
      supportLevel: support,
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
        <Segmented<GoalType>
          label="Goal type"
          options={GOAL_TYPE_OPTIONS}
          value={goalType}
          onChange={setGoalTypeChoice}
        />
        {goalType === 'time' ? (
          <Field
            label="Target time (h:mm:ss)"
            hint="A sketch to plan against, not a minimum."
            error={errors.targetTimeSec}
          >
            {(a) => (
              <Input
                {...a}
                inputMode="numeric"
                value={targetTime}
                onChange={(e) => {
                  setTargetTime(e.target.value)
                }}
              />
            )}
          </Field>
        ) : null}
        <Field label="Elevation gain (m)" error={errors.gainM}>
          {(a) => (
            <Input
              {...a}
              inputMode="numeric"
              value={gain}
              onChange={(e) => {
                setGain(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Elevation loss (m)" error={errors.lossM}>
          {(a) => (
            <Input
              {...a}
              inputMode="numeric"
              value={loss}
              onChange={(e) => {
                setLoss(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Surface" error={errors.surface}>
          {(a) => (
            <Select
              {...a}
              value={surface}
              onChange={(e) => {
                setSurface(e.target.value as GoalSurface)
              }}
            >
              {(Object.keys(SURFACE_LABELS) as GoalSurface[]).map((value) => (
                <option key={value} value={value}>
                  {SURFACE_LABELS[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Start time" error={errors.startTime}>
          {(a) => (
            <Input
              {...a}
              type="time"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value)
              }}
            />
          )}
        </Field>
        <Segmented<SupportLevel>
          label="Support"
          options={SUPPORT_OPTIONS}
          value={support}
          onChange={setSupport}
        />
        <Field
          label="Race latitude"
          hint="Optional. Race-day heat comes from this place and date. Kept to 0.01 degrees."
          error={errors.raceLat}
        >
          {(a) => (
            <Input
              {...a}
              inputMode="decimal"
              value={raceLat}
              onChange={(e) => {
                setRaceLat(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Race longitude" error={errors.raceLng}>
          {(a) => (
            <Input
              {...a}
              inputMode="decimal"
              value={raceLng}
              onChange={(e) => {
                setRaceLng(e.target.value)
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

/** Feasibility, the predicted time with its range and method, and race-day heat of the active goal. */
function GoalOutlook({ goal }: { goal: Goal }) {
  const plan = usePlan()
  const units = useSettings().data?.units
  const predictions = usePredictions(goal.id)
  if (plan.isPending || predictions.isPending) return null
  if (plan.isError || predictions.isError) {
    return <p className={styles.note}>The outlook for this goal did not load.</p>
  }

  const feasibility = plan.data?.goalId === goal.id ? plan.data.feasibility : null
  const prediction = predictions.data.prediction
  const isHeat = (text: string) => /WBGT/.test(text)
  const heatNotes = feasibility?.notes.filter((note) => note.code === 'heat-acclimation') ?? []
  const otherNotes = feasibility?.notes.filter((note) => note.code !== 'heat-acclimation') ?? []
  const heatLines = [
    ...(prediction?.conditions.filter(isHeat) ?? []),
    ...heatNotes.map((note) => note.message),
  ].map((line) => localiseEngineText(line, units))
  const conditions = (prediction?.conditions.filter((line) => !isHeat(line)) ?? []).map((line) =>
    localiseEngineText(line, units),
  )

  return (
    <div className={styles.outlook}>
      {feasibility ? (
        <section className={styles.outlookBlock} aria-label="Feasibility">
          <h3 className={styles.outlookHeading}>Feasibility</h3>
          <p className={styles.outlookValue}>{FEASIBILITY_LABELS[feasibility.label]}</p>
          <p className={styles.note}>
            {`${String(feasibility.weeksNeeded)} weeks needed, ${String(feasibility.weeksAvailable)} available.`}
          </p>
          {otherNotes.map((note, i) => (
            <p key={i} className={styles.note}>
              {localiseEngineText(note.message, units)}
            </p>
          ))}
          <ExplainButton
            subject="feasibility"
            rules={[...new Set(['D4', ...otherNotes.flatMap((note) => note.rules)])]}
          />
        </section>
      ) : null}
      <section className={styles.outlookBlock} aria-label="Prediction">
        <h3 className={styles.outlookHeading}>Predicted time</h3>
        {prediction ? (
          <>
            <p className={styles.outlookValue}>{formatDuration(prediction.predictedSec)}</p>
            <p className={styles.note}>
              {`${formatDuration(prediction.lowSec)} to ${formatDuration(prediction.highSec)}`}
            </p>
            <p className={styles.note}>{prediction.method}</p>
            {conditions.map((line) => (
              <p key={line} className={styles.note}>
                {line}
              </p>
            ))}
            <ExplainButton subject="predicted time" rules={prediction.rules} />
          </>
        ) : (
          <p className={styles.note}>
            No prediction yet. A recent race or a hard effort gives it something to start from.
          </p>
        )}
      </section>
      {heatLines.length > 0 ? (
        <section className={styles.outlookBlock} aria-label="Race-day heat">
          <h3 className={styles.outlookHeading}>Race-day heat</h3>
          {heatLines.map((line) => (
            <p key={line} className={styles.note}>
              {line}
            </p>
          ))}
          <ExplainButton
            subject="race-day heat"
            rules={[...new Set(['D6', ...heatNotes.flatMap((note) => note.rules)])]}
          />
        </section>
      ) : null}
    </div>
  )
}

interface GoalRowProps {
  goal: Goal
  units: Units
  /** The newest archived plan of this goal that can come back, when the goal's plan is gone. */
  archived: ArchivedPlanView | null
  onEdit: () => void
}

function GoalRow({ goal, units, archived, onEdit }: GoalRowProps) {
  const nameId = useId()
  const noteId = useId()
  const activate = useActivateGoal()
  const remove = useDeleteGoal()
  const restore = useRestorePlan()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  /** Set while the plan follows another goal and the runner is asked before it is replaced. */
  const [replacing, setReplacing] = useState<ActivateRequiresPlan | null>(null)
  const activateButton = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const returnFocus = useRef(false)
  const preset = presetFor(goal.distanceM)
  // The 409 that opens the question is not an error to show.
  const asksToReplace = replacePlanRequired(activate.error) !== null
  const error = (asksToReplace ? null : activate.error) ?? remove.error ?? restore.error

  // The button that opened the question is rendered again once it closes; focus goes back to it.
  useEffect(() => {
    if (replacing === null && returnFocus.current) {
      returnFocus.current = false
      activateButton.current?.focus()
    }
  }, [replacing])

  function makeActive() {
    activate.mutate(
      { id: goal.id },
      {
        onError: (failure) => {
          const needed = replacePlanRequired(failure)
          if (needed !== null) setReplacing(needed)
        },
      },
    )
  }

  function cancelReplace() {
    returnFocus.current = true
    setReplacing(null)
    activate.reset()
  }

  function buildPlan() {
    activate.mutate(
      { id: goal.id, replacePlan: true },
      {
        onSuccess: () => {
          setReplacing(null)
          toast.show(activateBuiltText(goal.name))
          // The button that opened the question is gone: the goal is active now.
          heading.current?.focus()
        },
      },
    )
  }

  function restorePlan(plan: ArchivedPlanView) {
    restore.mutate(plan.id, {
      onSuccess: (result) => {
        toast.show(result.replanned ? RESTORE_DONE_TEXT : RESTORE_NOT_UPDATED_TEXT)
        // The note and its button are gone once the plan is back; focus goes to the goal.
        heading.current?.focus()
      },
    })
  }

  const details = [
    `${formatLongDate(goal.targetDate)}${goal.dateProvisional ? ' (provisional)' : ''}`,
    goal.distanceM === null ? null : (preset?.label ?? formatDistance(goal.distanceM, units)),
    goal.location,
  ].filter((part): part is string => part !== null && part !== '')

  return (
    <article className={styles.goal} aria-labelledby={nameId}>
      <div className={styles.head}>
        <h2 id={nameId} ref={heading} tabIndex={-1} className={styles.name}>
          {goal.name}
        </h2>
        <span className={styles.priority}>Priority {goal.priority}</span>
        {goal.isActive ? <span className={styles.badge}>Active goal</span> : null}
      </div>
      <p className={styles.meta}>
        {STATUS_LABELS[goal.status]} · {details.join(', ')}
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
      {goal.isActive ? <GoalOutlook goal={goal} /> : null}
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
      ) : replacing !== null ? (
        <ActivateConfirm
          currentGoal={replacing.planGoalName}
          nextGoal={goal.name}
          loading={activate.isPending}
          onConfirm={buildPlan}
          onCancel={cancelReplace}
        />
      ) : (
        <>
          <div className={styles.actions}>
            {goal.isActive ? null : (
              <Button
                ref={activateButton}
                variant="secondary"
                aria-describedby={nameId}
                loading={activate.isPending}
                onClick={makeActive}
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
          {archived !== null ? (
            <div className={styles.restore}>
              <p id={noteId} className={styles.note}>
                {restoreNoteText(archived.goalName, todayIso(new Date(archived.archivedAt)))}
              </p>
              <Button
                variant="secondary"
                aria-describedby={noteId}
                loading={restore.isPending}
                onClick={() => {
                  restorePlan(archived)
                }}
              >
                {RESTORE_BUTTON_LABEL}
              </Button>
            </div>
          ) : null}
        </>
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
  const plan = usePlan()
  const archivedPlans = useArchivedPlans()
  const units: Units = settings.data?.units ?? 'mi'
  const [editing, setEditing] = useState<Goal | 'new' | null>(null)

  /** The newest archived plan of a goal that can come back, unless the goal has the plan now. */
  function restorableFor(goal: Goal): ArchivedPlanView | null {
    if (plan.data?.goalId === goal.id) return null
    return archivedPlans.data?.find((p) => p.goalId === goal.id && p.restorable) ?? null
  }

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
            archived={restorableFor(goal)}
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
