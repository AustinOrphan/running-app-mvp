import { useId, useState, type CSSProperties, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { fieldErrors } from '../api/client.ts'
import { useGoals } from '../api/goals.ts'
import {
  useGeneratePlan,
  usePlan,
  useUpdatePlanWeek,
  type GeneratePlanRequest,
  type PlanWeekPatch,
} from '../api/plan.ts'
import { useWeeks } from '../api/weeks.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Field, Input, Select, Textarea } from '../components/Field.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { useToast } from '../components/Toast.tsx'
import { formatLongDate, formatShortDate, phaseLabel } from '../components/format.ts'
import { mondayOf, todayIso } from '../../shared/dates.ts'
import { BUILD_PHASES, isCutbackIndex } from '../../shared/domain/plan.ts'
import { minutesToHours1 } from '../../shared/units.ts'
import type { Goal, Phase, PlanWeek, PlanWithWeeks } from '../../shared/types.ts'
import styles from './PlanPage.module.css'

/** Chip intensity: one hue that builds with the phase. Taper and race have no level. */
export function phaseLevel(phase: Phase): number | null {
  const position = BUILD_PHASES.indexOf(phase)
  return position === -1 ? null : position + 1
}

export function PhaseChip({ phase }: { phase: Phase }) {
  const level = phaseLevel(phase)
  const style = level === null ? undefined : ({ '--phase-level': level } as CSSProperties)
  return (
    <span
      className={level === null ? `${styles.chip} ${styles.chipDashed}` : styles.chip}
      style={style}
      data-phase={phase}
      data-dashed={level === null ? 'true' : undefined}
    >
      {phaseLabel(phase)}
    </span>
  )
}

const NBSP = ' '

/** Number and unit stay on one line in a narrow table cell. */
function hours(min: number): string {
  return `${minutesToHours1(min)}${NBSP}h`
}

/** A race week has no long run (0 minutes); show a dash rather than "0 min". */
function longRunText(min: number): string {
  return min > 0 ? `${String(min)}${NBSP}min` : '—'
}

/** Goals a plan can be built for: not finished and not dropped. */
function planGoals(goals: Goal[]): Goal[] {
  return goals.filter((g) => g.status === 'target' || g.status === 'considering')
}

const STRENGTH_OPTIONS: Array<{ value: '0' | '1' | '2'; label: string }> = [
  { value: '0', label: '0' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
]

interface GenerateFormProps {
  goals: Goal[]
  initialGoalId?: string
  onDone?: () => void
}

function GenerateForm({ goals, initialGoalId, onDone }: GenerateFormProps) {
  const toast = useToast()
  const generate = useGeneratePlan()
  const preferred =
    goals.find((g) => g.id === initialGoalId) ?? goals.find((g) => g.isActive) ?? goals[0]
  const [goalId, setGoalId] = useState(preferred?.id ?? '')
  const [baseline, setBaseline] = useState('')
  const [startDate, setStartDate] = useState(mondayOf(todayIso()))
  const [strength, setStrength] = useState<'0' | '1' | '2'>('2')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const chosen = goals.find((g) => g.id === goalId)

  function submit(event: FormEvent) {
    event.preventDefault()
    const request: GeneratePlanRequest = {
      goalId,
      strengthPreference: Number(strength) as 0 | 1 | 2,
    }
    const local: Record<string, string> = {}
    if (baseline.trim() !== '') {
      const minutes = Number(baseline)
      if (!Number.isInteger(minutes) || minutes <= 0) {
        local.baselineRunMin = 'Enter whole minutes per week, like 180.'
      } else {
        request.baselineRunMin = minutes
      }
    }
    if (startDate !== '') request.startDate = startDate
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length > 0) return

    generate.mutate(request, {
      onSuccess: () => {
        toast.show('Plan generated')
        onDone?.()
      },
      onError: (err) => {
        const fromServer = fieldErrors(err)
        setErrors(fromServer)
        if (!['goalId', 'baselineRunMin', 'startDate'].some((k) => k in fromServer)) {
          setFormError(err.message)
        }
      },
    })
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Field
        label="Goal"
        error={errors.goalId}
        hint={chosen ? `Race on ${formatLongDate(chosen.targetDate)}` : undefined}
      >
        {(a) => (
          <Select
            {...a}
            value={goalId}
            onChange={(e) => {
              setGoalId(e.target.value)
            }}
          >
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Weekly run minutes"
        error={errors.baselineRunMin}
        hint="Leave blank to use the median of the last four weeks with a run."
      >
        {(a) => (
          <Input
            {...a}
            type="number"
            inputMode="numeric"
            min={1}
            value={baseline}
            onChange={(e) => {
              setBaseline(e.target.value)
            }}
          />
        )}
      </Field>
      <Field label="Plan start (Monday)" error={errors.startDate}>
        {(a) => (
          <Input
            {...a}
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value)
            }}
          />
        )}
      </Field>
      <Segmented<'0' | '1' | '2'>
        label="Strength sessions per week"
        options={STRENGTH_OPTIONS}
        value={strength}
        onChange={setStrength}
      />
      {formError !== null ? (
        <p role="alert" className={styles.error}>
          {formError}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" loading={generate.isPending}>
          Generate plan
        </Button>
      </div>
    </form>
  )
}

/** Whole non-negative number from a text field, or null when it is not one. */
function parseWhole(text: string, max: number): number | null {
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null
}

const WEEK_FIELDS = [
  'targetRunMin',
  'longRunMin',
  'day2Min',
  'runDays',
  'strengthSessions',
  'focus',
  'overrideNote',
] as const

function EditWeekSheet({ week, onClose }: { week: PlanWeek; onClose: () => void }) {
  const formId = useId()
  const toast = useToast()
  const update = useUpdatePlanWeek()
  const label = formatShortDate(week.weekStart)
  const [target, setTarget] = useState(String(week.targetRunMin))
  const [longRun, setLongRun] = useState(String(week.longRunMin))
  const [day2, setDay2] = useState(week.day2Min === null ? '' : String(week.day2Min))
  const [runDays, setRunDays] = useState(String(week.runDays))
  const [strength, setStrength] = useState(String(week.strengthSessions))
  const [focus, setFocus] = useState(week.focus ?? '')
  const [note, setNote] = useState(week.overrideNote ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  function send(patch: PlanWeekPatch) {
    update.mutate(
      { weekStart: week.weekStart, patch },
      {
        onSuccess: () => {
          toast.show(`Week of ${label} saved`)
          onClose()
        },
        onError: (err) => {
          const fromServer = fieldErrors(err)
          setErrors(fromServer)
          if (!WEEK_FIELDS.some((k) => k in fromServer)) {
            setFormError(`Week not saved. ${err.message}`)
          }
        },
      },
    )
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const local: Record<string, string> = {}
    const targetMin = parseWhole(target, 10_000)
    const longRunMin = parseWhole(longRun, 1000)
    const day2Min = day2.trim() === '' ? null : parseWhole(day2, 1000)
    const runDayCount = parseWhole(runDays, 7)
    const strengthCount = parseWhole(strength, 7)
    if (targetMin === null) local.targetRunMin = 'Enter whole minutes, like 270.'
    if (longRunMin === null) local.longRunMin = 'Enter whole minutes, like 90.'
    if (day2.trim() !== '' && day2Min === null)
      local.day2Min = 'Enter whole minutes, or leave blank.'
    if (runDayCount === null) local.runDays = 'Enter a number from 0 to 7.'
    if (strengthCount === null) local.strengthSessions = 'Enter a number from 0 to 7.'

    const trimmedNote = note.trim()
    const targetChanged = targetMin !== week.targetRunMin
    const needsNote =
      targetMin !== null &&
      targetMin !== week.baselineRunMin &&
      (targetChanged || week.targetSource === 'override')
    if (needsNote && trimmedNote === '') local.overrideNote = 'Add a note explaining the change'
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length > 0 || targetMin === null) return
    if (longRunMin === null || runDayCount === null || strengthCount === null) return

    const patch: PlanWeekPatch = {}
    const noteChanged = trimmedNote !== (week.overrideNote ?? '')
    // The server accepts a note on its own only for an override; a note on a review-sourced target
    // turns that target into an override, so the target goes with it.
    const pinsTarget = week.targetSource !== 'override' && trimmedNote !== ''
    if (targetChanged || (targetMin !== week.baselineRunMin && noteChanged && pinsTarget)) {
      patch.targetRunMin = targetMin
    }
    if (targetMin !== week.baselineRunMin && (targetChanged || noteChanged)) {
      patch.overrideNote = trimmedNote
    }
    if (longRunMin !== week.longRunMin) patch.longRunMin = longRunMin
    if (day2Min !== week.day2Min) patch.day2Min = day2Min
    if (runDayCount !== week.runDays) patch.runDays = runDayCount
    if (strengthCount !== week.strengthSessions) patch.strengthSessions = strengthCount
    if (focus.trim() !== (week.focus ?? '')) patch.focus = focus.trim()

    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    send(patch)
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Edit week of ${label}`}
      footer={
        <div className={styles.footer}>
          <Button
            variant="secondary"
            disabled={week.targetRunMin === week.baselineRunMin}
            onClick={() => {
              send({ targetRunMin: week.baselineRunMin })
            }}
          >
            Reset to baseline
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={update.isPending}>
            Save week
          </Button>
        </div>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.baseline}>
          Generated baseline: {minutesToHours1(week.baselineRunMin)} h ({week.baselineRunMin} min)
        </p>
        <Field label="Target (minutes)" error={errors.targetRunMin}>
          {(a) => (
            <Input
              {...a}
              type="number"
              inputMode="numeric"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Long run (minutes)" error={errors.longRunMin}>
          {(a) => (
            <Input
              {...a}
              type="number"
              inputMode="numeric"
              value={longRun}
              onChange={(e) => {
                setLongRun(e.target.value)
              }}
            />
          )}
        </Field>
        <Field
          label="Day 2 (minutes)"
          error={errors.day2Min}
          hint="Leave blank for no second long day."
        >
          {(a) => (
            <Input
              {...a}
              type="number"
              inputMode="numeric"
              value={day2}
              onChange={(e) => {
                setDay2(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Run days" error={errors.runDays}>
          {(a) => (
            <Input
              {...a}
              type="number"
              inputMode="numeric"
              value={runDays}
              onChange={(e) => {
                setRunDays(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Strength sessions" error={errors.strengthSessions}>
          {(a) => (
            <Input
              {...a}
              type="number"
              inputMode="numeric"
              value={strength}
              onChange={(e) => {
                setStrength(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Focus" error={errors.focus}>
          {(a) => (
            <Input
              {...a}
              value={focus}
              onChange={(e) => {
                setFocus(e.target.value)
              }}
            />
          )}
        </Field>
        <Field
          label="Override note"
          error={errors.overrideNote}
          hint="Required when the target differs from the baseline."
        >
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
    </Sheet>
  )
}

/** The target for a week, with how it got there: struck baseline and the note, or "from review". */
function TargetCell({ week }: { week: PlanWeek }) {
  const noteId = useId()
  const [showNote, setShowNote] = useState(false)
  const edited = week.targetSource === 'override'

  return (
    <>
      {edited ? <s className={styles.baselineValue}>{hours(week.baselineRunMin)}</s> : null}{' '}
      <span className={styles.targetValue}>{hours(week.targetRunMin)}</span>
      {edited ? (
        <>
          {' '}
          <button
            type="button"
            className={styles.edited}
            aria-describedby={showNote ? noteId : undefined}
            onFocus={() => {
              setShowNote(true)
            }}
            onBlur={() => {
              setShowNote(false)
            }}
            onMouseEnter={() => {
              setShowNote(true)
            }}
            onMouseLeave={() => {
              setShowNote(false)
            }}
            onClick={() => {
              setShowNote(true)
            }}
          >
            edited
          </button>
          {showNote && week.overrideNote !== null ? (
            <span id={noteId} role="note" className={styles.noteText}>
              {week.overrideNote}
            </span>
          ) : null}
        </>
      ) : null}
      {week.targetSource === 'review' ? <span className={styles.source}>from review</span> : null}
    </>
  )
}

function PlanTable({ plan }: { plan: PlanWithWeeks }) {
  const [editing, setEditing] = useState<PlanWeek | null>(null)
  const currentMonday = mondayOf(todayIso())
  const first = plan.weeks[0]?.weekStart ?? plan.startDate
  const last = plan.weeks[plan.weeks.length - 1]?.weekStart ?? first
  const to = currentMonday < first ? first : currentMonday > last ? last : currentMonday
  const weeks = useWeeks({ from: first, to })
  const actual = new Map((weeks.data ?? []).map((w) => [w.weekStart, w.runMin]))

  return (
    <>
      {weeks.isError ? (
        <p role="alert" className={styles.error}>
          Actual hours did not load. Reload the page to try again.
        </p>
      ) : null}
      <table className={styles.table}>
        <caption className="visually-hidden">Weekly plan, target and actual run hours</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Phase</th>
            <th scope="col">Target</th>
            <th scope="col">Actual</th>
            <th scope="col">Long run</th>
            <th scope="col">Day 2</th>
            <th scope="col">Run days</th>
            <th scope="col">Strength</th>
            <th scope="col">Focus</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.weeks.map((week) => {
            const cutback = isCutbackIndex(week.index, week.phase)
            const race = week.phase === 'race'
            const isCurrent = week.weekStart === currentMonday
            const runMin = week.weekStart <= currentMonday ? actual.get(week.weekStart) : undefined
            const short = formatShortDate(week.weekStart)
            return (
              <tr
                key={week.weekStart}
                data-week={week.weekStart}
                data-cutback={cutback ? 'true' : undefined}
                data-race={race ? 'true' : undefined}
                data-taper={week.phase === 'taper' ? 'true' : undefined}
                aria-current={isCurrent ? 'date' : undefined}
                className={styles.row}
              >
                <td className={styles.week}>{short}</td>
                <td className={styles.phase}>
                  <PhaseChip phase={week.phase} />
                  {cutback ? <span className={styles.cutback}>cutback</span> : null}
                </td>
                <td className={styles.target} data-cell="target">
                  <TargetCell week={week} />
                </td>
                <td className={styles.actual} data-cell="actual">
                  {runMin === undefined ? '' : hours(runMin)}
                </td>
                <td className={styles.summary}>
                  Long run {longRunText(week.longRunMin)}, {week.runDays} run days, strength{' '}
                  {week.strengthSessions}
                </td>
                <td className={styles.number} data-cell="long-run">
                  {longRunText(week.longRunMin)}
                </td>
                <td className={styles.number} data-cell="day2">
                  {week.day2Min === null ? '—' : `${String(week.day2Min)}${NBSP}min`}
                </td>
                <td className={styles.number} data-cell="run-days">
                  {week.runDays}
                </td>
                <td className={styles.number} data-cell="strength">
                  {week.strengthSessions}
                </td>
                <td className={styles.focus}>{week.focus}</td>
                <td className={styles.edit}>
                  <Button
                    variant="quiet"
                    aria-label={`Edit week of ${short}`}
                    onClick={() => {
                      setEditing(week)
                    }}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {editing !== null ? (
        <EditWeekSheet
          key={editing.weekStart}
          week={editing}
          onClose={() => {
            setEditing(null)
          }}
        />
      ) : null}
    </>
  )
}

/** Weekly targets from the start date to race week; every week stays editable. */
export function PlanPage() {
  const plan = usePlan()
  const goals = useGoals()
  const [regenerating, setRegenerating] = useState(false)

  if (plan.isError || goals.isError) {
    return (
      <>
        <PageHeader title="Plan" />
        <p role="alert" className={styles.error}>
          The plan did not load. The server did not respond; reload the page to try again.
        </p>
      </>
    )
  }
  if (plan.isPending || goals.isPending) {
    return (
      <>
        <PageHeader title="Plan" />
        <Skeleton lines={5} />
      </>
    )
  }

  const eligible = planGoals(goals.data)

  if (plan.data === null) {
    return (
      <>
        <PageHeader title="Plan" />
        {eligible.length === 0 ? (
          <EmptyState
            title="No plan yet. Choose a goal race, then generate weekly targets."
            body="A plan needs a goal race with a distance."
            action={
              <Link to="/goals" className={styles.linkButton}>
                Add goal
              </Link>
            }
          />
        ) : (
          <>
            <EmptyState title="No plan yet. Choose a goal race, then generate weekly targets." />
            <GenerateForm goals={eligible} />
          </>
        )}
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Plan"
        context={`${plan.data.name}. Race week of ${formatShortDate(plan.data.raceWeekStart)}.`}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              setRegenerating(true)
            }}
          >
            Regenerate plan
          </Button>
        }
      />
      <PlanTable plan={plan.data} />
      {regenerating ? (
        <Sheet
          open
          title="Regenerate plan"
          onClose={() => {
            setRegenerating(false)
          }}
        >
          <p className={styles.explain}>
            Regenerating archives this plan and builds a new one. Edited weeks are not carried over.
            Reviews are kept.
          </p>
          {eligible.length === 0 ? (
            <p className={styles.explain}>
              No goal is open for planning. <Link to="/goals">Add a goal</Link> first.
            </p>
          ) : (
            <GenerateForm
              goals={eligible}
              initialGoalId={plan.data.goalId}
              onDone={() => {
                setRegenerating(false)
              }}
            />
          )}
        </Sheet>
      ) : null}
    </>
  )
}
