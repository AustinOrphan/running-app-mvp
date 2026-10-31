import {
  Fragment,
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type FormEvent,
  type SyntheticEvent,
} from 'react'
import { Link } from 'react-router-dom'
import { fieldErrors } from '../api/client.ts'
import { ruleTarget, type WhyTarget } from '../api/explain.ts'
import { useDisruptions } from '../api/disruptions.ts'
import { useGoals } from '../api/goals.ts'
import {
  useGeneratePlan,
  useMarkRevisionsSeen,
  usePlan,
  usePlanRevisions,
  useUpdatePlanWeek,
  type GeneratePlanRequest,
  type PlanWeekPatch,
} from '../api/plan.ts'
import { useSettings } from '../api/settings.ts'
import { useToday } from '../api/today.ts'
import { useWeeks } from '../api/weeks.ts'
import { useWristStatus, weekZipHref } from '../api/wrist.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Field, Input, Select, Textarea } from '../components/Field.tsx'
import { LoadField } from '../components/LoadField.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { SessionSheet, sessionSummary } from '../components/SessionSheet.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { useToast } from '../components/Toast.tsx'
import { WhyDrawer } from '../components/WhyDrawer.tsx'
import { WristChip } from '../components/WristStatus.tsx'
import { WristStrip, weekHasRuns } from '../components/WristStrip.tsx'
import { DisruptionBanners } from '../components/disruption/DisruptionBanner.tsx'
import { LoadSettingSheet, NotFullSheet, ReplanSheet } from '../components/lazySheets.tsx'
import {
  formatLongDate,
  formatShortDate,
  formatWeekday,
  weekPhaseLabel,
} from '../components/format.ts'
import { RevisionDiff } from '../components/revisions/RevisionDiff.tsx'
import { estimateAboutText } from '../../shared/copy/distanceEstimate.ts'
import {
  CYCLE_CHOICES,
  cycleChoiceLabel,
  cycleFieldLabel,
  cycleHintLines,
  type CycleChoice,
} from '../../shared/copy/pageCopy.ts'
import {
  loadChangeLabel,
  loadPanelText,
  loadPanelTitle,
  loadTradeoff,
} from '../../shared/copy/load.ts'
import { overshootNote, plannedBaselineLine } from '../../shared/copy/overshoot.ts'
import { newMarker } from '../../shared/copy/revisionView.ts'
import { sessionStatusLabel } from '../../shared/copy/sessionStatus.ts'
import { fileRefusalSentence, weekLinkLabel } from '../../shared/copy/workouts.ts'
import { distanceClassOf } from '../../shared/engine/goal.ts'
import { mondayOf, todayIso } from '../../shared/dates.ts'
import { BUILD_PHASES, isCutbackIndex } from '../../shared/domain/plan.ts'
import { shownTargetMin } from '../../shared/domain/plannedWeek.ts'
import { minutesToHours1 } from '../../shared/units.ts'
import { groupWarnings, localiseEngineText } from '../components/engineText.ts'
import type { LoadPosition } from '../../shared/engine/loadSetting.ts'
import type { EngineWarning, LoadAppetite, RecoveryCycle } from '../../shared/engine/types.ts'
import type {
  DisruptionView,
  Goal,
  PlanPhase,
  PlanSessionView,
  PlanWeek,
  PlanWeekView,
  PlanWithSessions,
  Units,
  WristItem,
} from '../../shared/types.ts'
import styles from './PlanPage.module.css'

/** Chip intensity: one hue that builds with the phase. Taper and race have no level. */
export function phaseLevel(phase: PlanPhase): number | null {
  if (phase === 'base') return 1
  if (phase === 'build') return 3
  const position = BUILD_PHASES.indexOf(phase)
  return position === -1 ? null : position + 1
}

export function PhaseChip({ phase, flags }: { phase: PlanPhase; flags?: readonly string[] }) {
  const level = phaseLevel(phase)
  const style = level === null ? undefined : ({ '--phase-level': level } as CSSProperties)
  return (
    <span
      className={level === null ? `${styles.chip} ${styles.chipDashed}` : styles.chip}
      style={style}
      data-phase={phase}
      data-dashed={level === null ? 'true' : undefined}
    >
      {weekPhaseLabel({ phase, flags })}
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

const CYCLE_OPTIONS: Array<{ value: CycleChoice; label: string }> = CYCLE_CHOICES.map((choice) => ({
  value: choice,
  label: cycleChoiceLabel(choice),
}))

const POLARIZED_OPTIONS: Array<{ value: 'off' | 'on'; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
]

interface GenerateFormProps {
  goals: Goal[]
  initialGoalId?: string
  /** The load position to start from: the one the plan being replaced was set to. */
  initialLoad?: LoadAppetite | undefined
  /** The recovery cycle to start from: the one the plan being replaced holds, when it holds one. */
  initialCycle?: RecoveryCycle | null | undefined
  onDone?: () => void
}

function GenerateForm({
  goals,
  initialGoalId,
  initialLoad,
  initialCycle,
  onDone,
}: GenerateFormProps) {
  const toast = useToast()
  const generate = useGeneratePlan()
  const preferred =
    goals.find((g) => g.id === initialGoalId) ?? goals.find((g) => g.isActive) ?? goals[0]
  const [goalId, setGoalId] = useState(preferred?.id ?? '')
  // Only a cycle the runner picked is sent; `auto` leaves the option out so the plan decides it.
  const [cycle, setCycle] = useState<CycleChoice>(initialCycle ?? 'auto')
  const [strength, setStrength] = useState<'0' | '1' | '2'>('2')
  const [load, setLoad] = useState<LoadAppetite>(initialLoad ?? 'steady')
  const [polarized, setPolarized] = useState<'off' | 'on'>('off')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const chosen = goals.find((g) => g.id === goalId)
  // The polarized model is offered for 5 to 10 km goals only.
  const shortGoal =
    chosen?.distanceM != null && ['5k', '10k'].includes(distanceClassOf(chosen.distanceM))

  function submit(event: FormEvent) {
    event.preventDefault()
    const request: GeneratePlanRequest = {
      goalId,
      options: {
        ...(cycle === 'auto' ? {} : { recoveryCycle: cycle }),
        strengthSessions: Number(strength) as 0 | 1 | 2,
        loadAppetite: load,
        ...(shortGoal && polarized === 'on' ? { tidModel: 'polarized' as const } : {}),
      },
    }
    setErrors({})
    setFormError(null)

    generate.mutate(request, {
      onSuccess: () => {
        toast.show('Plan generated')
        onDone?.()
      },
      onError: (err) => {
        const fromServer = fieldErrors(err)
        setErrors(fromServer)
        if (!('goalId' in fromServer)) {
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
      <Segmented<CycleChoice>
        label={cycleFieldLabel()}
        hint={cycleHintLines(cycle)}
        options={CYCLE_OPTIONS}
        value={cycle}
        onChange={setCycle}
      />
      <Segmented<'0' | '1' | '2'>
        label="Strength sessions a week"
        hint="Two during the strength block, then one to maintain; never on a key run day."
        options={STRENGTH_OPTIONS}
        value={strength}
        onChange={setStrength}
      />
      <LoadField value={load} onChange={setLoad} />
      {shortGoal ? (
        <Segmented<'off' | 'on'>
          label="Polarized specific phase"
          hint="For 5 to 10 km goals: harder hard days and easier easy days in the final weeks. Off unless wanted."
          options={POLARIZED_OPTIONS}
          value={polarized}
          onChange={setPolarized}
        />
      ) : null}
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
  // A week run past its plan is edited at the planned figure: the stored target is the minutes run.
  const shownTarget = shownTargetMin(week)
  // The figure the week is reset to, as the sheet words it: the planned minutes of such a week.
  const baselineShown = week.overshoot ? week.plannedRunMin : week.baselineRunMin
  const [target, setTarget] = useState(String(shownTarget))
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
    const targetChanged = targetMin !== shownTarget
    const needsNote =
      targetMin !== null &&
      targetMin !== baselineShown &&
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
    if (targetChanged || (targetMin !== baselineShown && noteChanged && pinsTarget)) {
      patch.targetRunMin = targetMin
    }
    if (targetMin !== baselineShown && (targetChanged || noteChanged)) {
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
          {week.overshoot
            ? plannedBaselineLine(week.plannedRunMin)
            : `Generated baseline: ${minutesToHours1(week.baselineRunMin)} h (${String(week.baselineRunMin)} min)`}
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

/**
 * The target for a week, with how it got there: struck baseline and the note, or "from review".
 * Under it, the distance of the week's runs as the server estimated it, when it could. A week run
 * past its plan shows the planned figure; the stored target is the minutes run, and a struck
 * baseline would be that figure again.
 */
function TargetCell({ week, units }: { week: PlanWeekView; units: Units | undefined }) {
  const noteId = useId()
  const [showNote, setShowNote] = useState(false)
  const edited = week.targetSource === 'override'
  const estimateM = week.distanceEstimateM ?? null

  return (
    <>
      {edited && !week.overshoot ? (
        <s className={styles.baselineValue}>{hours(week.baselineRunMin)}</s>
      ) : null}{' '}
      <span className={styles.targetValue}>{hours(shownTargetMin(week))}</span>
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
      {estimateM !== null && units !== undefined ? (
        <span className={styles.source}>{estimateAboutText(estimateM, units)}</span>
      ) : null}
    </>
  )
}

/** Beside the minutes run of a week run past its plan: how far they lie over the planned figure. */
function OvershootNote({ ranMin, plannedMin }: { ranMin: number; plannedMin: number }) {
  const note = overshootNote(ranMin, plannedMin)
  return note === null ? null : (
    <span className={styles.source} data-note="overshoot">
      {note}
    </span>
  )
}

const FEASIBILITY_LABELS = {
  comfortable: 'Comfortable',
  tight: 'Tight',
  'not-reachable': 'Not reachable within default limits',
} as const

const SEVERITY_LABELS: Record<EngineWarning['severity'], string> = {
  info: 'Note',
  warn: 'Caution',
  hold: 'Held back',
}

/** A short "Why" control that opens the shared drawer for the given rule ids. */
function WhyButton({
  rules,
  label,
  onOpen,
}: {
  rules: string[]
  label: string
  onOpen: (why: WhyTarget) => void
}) {
  if (rules.length === 0) return null
  return (
    <Button
      variant="quiet"
      aria-label={label}
      onClick={() => {
        onOpen(ruleTarget(rules))
      }}
    >
      Why
    </Button>
  )
}

/**
 * The revision list. Every revision is the shared `RevisionDiff`. A revision the scheduler wrote
 * and the runner has not opened is marked "New" on the summary of the closed panel; opening the
 * panel stamps those revisions as seen, and they keep their marker until the panel is closed so
 * the runner can find them.
 */
function WhatChanged({
  revisions,
  units,
  onWhy,
}: {
  revisions: ReturnType<typeof usePlanRevisions>
  units: Units
  onWhy: (why: WhyTarget) => void
}) {
  const markSeen = useMarkRevisionsSeen()
  const [open, setOpen] = useState(false)
  // The revisions that were unseen when the panel opened, which keep their marker until it closes.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const data = revisions.data

  useEffect(() => {
    if (!open || data === undefined) return
    markSeen(data.filter((revision) => revision.seenAt === null).map((revision) => revision.id))
  }, [open, data, markSeen])

  function onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const opened = event.currentTarget.open
    setOpen(opened)
    setFresh(
      new Set(
        opened && data !== undefined
          ? data.filter((revision) => revision.seenAt === null).map((revision) => revision.id)
          : [],
      ),
    )
  }

  const waiting = !open && data?.some((revision) => revision.seenAt === null) === true
  let body
  if (revisions.isError) {
    body = (
      <p role="alert" className={styles.error}>
        The list of changes did not load.
      </p>
    )
  } else if (data === undefined) {
    body = <Skeleton lines={2} />
  } else if (data.length === 0) {
    body = <p className={styles.muted}>No changes yet. Updates to the plan are listed here.</p>
  } else {
    body = (
      <ol className={styles.revisions}>
        {data.map((revision) => (
          <li key={revision.id}>
            <RevisionDiff
              revision={revision}
              units={units}
              onWhy={(rules) => {
                onWhy(ruleTarget(rules))
              }}
              isNew={fresh.has(revision.id) || (open && revision.seenAt === null)}
            />
          </li>
        ))}
      </ol>
    )
  }
  return (
    <section aria-labelledby="changed-title" className={styles.panel}>
      <details onToggle={onToggle}>
        <summary>
          <span id="changed-title">What changed</span>
          {waiting ? <span className={styles.newMarker}>{newMarker(units)}</span> : null}
        </summary>
        {body}
      </details>
    </section>
  )
}

/**
 * The load setting in effect, from the plan payload. A position that applies as chosen leads with
 * its name and hint. One that does not apply (held at steady, or read as Standard because of age)
 * leads with the choice and the reason in one line, then the hint of the position in effect, so a
 * runner who has just chosen it reads at once that it is not in use. The trade-off of the choice
 * (the effect of a faster step on a return is not known) comes last. The Why drawer states facts
 * of the plan; the trade-off belongs here and on the Generate form, where the position is chosen
 * and read.
 */
function LoadPanel({ load }: { load: LoadPosition }) {
  const text = loadPanelText(load)
  const [changing, setChanging] = useState(false)
  return (
    <section aria-labelledby="load-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 id="load-title" className={styles.panelTitle}>
          {loadPanelTitle()}
        </h2>
        <Button
          variant="secondary"
          aria-describedby="load-title"
          onClick={() => {
            setChanging(true)
          }}
        >
          {loadChangeLabel()}
        </Button>
      </div>
      {text.lead === null ? (
        <p className={styles.setting}>
          <strong>{text.name}</strong> <span className={styles.muted}>{text.hint.join(' ')}</span>
        </p>
      ) : (
        <>
          <p className={styles.setting}>
            <strong>{text.lead.choice}</strong>
            {text.lead.rest}
          </p>
          <p className={styles.muted}>{text.hint.join(' ')}</p>
        </>
      )}
      <p className={styles.muted}>{loadTradeoff()}</p>
      {changing ? (
        <LoadSettingSheet
          current={load.requested}
          onClose={() => {
            setChanging(false)
          }}
        />
      ) : null}
    </section>
  )
}

/** Version-2 plans: feasibility, the load setting, warnings, the plan checks and the revision list. */
function PlanOverview({
  plan,
  onWhy,
}: {
  plan: PlanWithSessions
  onWhy: (why: WhyTarget) => void
}) {
  const revisions = usePlanRevisions()
  const units = useSettings().data?.units ?? 'mi'
  const passed = plan.checklist.filter((item) => item.ok).length
  const feasibility = plan.feasibility

  return (
    <div className={styles.overview}>
      {feasibility !== null ? (
        <section aria-labelledby="feasibility-title" className={styles.panel}>
          <h2 id="feasibility-title" className={styles.panelTitle}>
            Feasibility
          </h2>
          <p className={styles.feasibility}>
            <strong data-feasibility={feasibility.label}>
              {FEASIBILITY_LABELS[feasibility.label]}
            </strong>{' '}
            <span className={styles.muted}>
              {feasibility.weeksNeeded} weeks needed, {feasibility.weeksAvailable} available.
            </span>
          </p>
          {feasibility.notes.length > 0 ? (
            <ul className={styles.items}>
              {feasibility.notes.map((note, index) => (
                <li key={`${note.code}-${String(index)}`}>
                  <span>{localiseEngineText(note.message, units)}</span>
                  <WhyButton rules={note.rules} label="Why this note" onOpen={onWhy} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {plan.load !== null ? <LoadPanel load={plan.load} /> : null}
      {plan.warnings.length > 0 ? (
        <section aria-labelledby="warnings-title" className={styles.panel}>
          <h2 id="warnings-title" className={styles.panelTitle}>
            Warnings
          </h2>
          <ul className={styles.items}>
            {groupWarnings(plan.warnings, units).map((group) => (
              <li key={group.code}>
                <span className={styles.warningText}>
                  <span>
                    <strong>{SEVERITY_LABELS[group.severity]}</strong> {group.summary}
                  </span>
                  {group.details.length > 1 ? (
                    <details className={styles.warningDetails}>
                      <summary>Show each one</summary>
                      <ul>
                        {group.details.map((detail, index) => (
                          <li key={`${String(index)}-${detail}`}>{detail}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </span>
                <WhyButton rules={group.rules} label="Why this warning" onOpen={onWhy} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {plan.checklist.length > 0 ? (
        <section aria-labelledby="checks-title" className={styles.panel}>
          <details>
            <summary id="checks-title">Plan checks</summary>
            <p className={styles.muted}>
              {passed} of {plan.checklist.length} checks pass
            </p>
            <ul className={styles.items}>
              {plan.checklist.map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>{item.ok ? 'Passed' : 'Not met'}</strong>{' '}
                    {localiseEngineText(item.detail, units)}
                  </span>
                  <WhyButton rules={item.rules} label="Why this check" onOpen={onWhy} />
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
      <WhatChanged revisions={revisions} units={units} onWhy={onWhy} />
    </div>
  )
}

/**
 * What a session card says under its title: its length, its status, and "Rest window" for a day a
 * window holds. A held day is planned rest, so the status adds nothing there; a session the window
 * back-dated to skipped says both.
 */
function sessionMeta(session: PlanSessionView, units: Units | undefined): string {
  const held = session.flags.includes('rest-window')
  const parts = [sessionSummary(session, units)]
  if (!(held && session.status === 'planned')) parts.push(sessionStatusLabel(session.status))
  if (held) parts.push('Rest window')
  return parts.filter((part) => part !== '').join(', ')
}

/** One card per day with sessions; each session opens the session sheet. */
function DayCards({
  week,
  sessions,
  units,
  wrist,
  onOpen,
}: {
  week: PlanWeek
  sessions: PlanSessionView[]
  units: Units | undefined
  /** The state of each run in the next 14 days on its way to the watch, by session id. */
  wrist: ReadonlyMap<string, WristItem>
  onOpen: (id: string) => void
}) {
  const byDate = new Map<string, PlanSessionView[]>()
  for (const session of sessions) {
    byDate.set(session.date, [...(byDate.get(session.date) ?? []), session])
  }
  const dates = [...byDate.keys()].sort()
  return (
    <ul className={styles.days} aria-label={`Days of week of ${formatShortDate(week.weekStart)}`}>
      {dates.map((date) => (
        <li key={date} className={styles.day}>
          <p className={styles.dayName}>
            {formatWeekday(date)} {formatShortDate(date)}
          </p>
          {(byDate.get(date) ?? [])
            .sort((a, b) => a.order - b.order)
            .map((session) => (
              <button
                key={session.id}
                type="button"
                className={styles.sessionButton}
                data-status={session.status}
                onClick={() => {
                  onOpen(session.id)
                }}
              >
                <span className={styles.sessionTitle}>{session.title}</span>
                <span className={styles.sessionMeta}>{sessionMeta(session, units)}</span>
                {wrist.has(session.id) ? <WristChip item={wrist.get(session.id)!} /> : null}
              </button>
            ))}
        </li>
      ))}
    </ul>
  )
}

/** Mounted only for plans with sessions, so version-1 plans never ask for settings or the watch. */
function DaysRow({
  week,
  sessions,
  onOpen,
}: {
  week: PlanWeek
  sessions: PlanSessionView[]
  onOpen: (id: string) => void
}) {
  const settings = useSettings()
  // The chips of the next 14 days; nothing while sending is off, offline or unread.
  const { status } = useWristStatus()
  const wrist = new Map<string, WristItem>(
    status?.settings.enabled === true
      ? status.items.flatMap((item): Array<[string, WristItem]> =>
          item.sessionId === null ? [] : [[item.sessionId, item]],
        )
      : [],
  )
  return (
    <tr className={styles.daysRow} data-days-for={week.weekStart}>
      <td colSpan={10}>
        <DayCards
          week={week}
          sessions={sessions}
          units={settings.data?.units}
          wrist={wrist}
          onOpen={onOpen}
        />
        {weekHasRuns(sessions, week.weekStart) ? (
          <a href={weekZipHref(week.weekStart)} download className={styles.weekFiles}>
            {weekLinkLabel(week.weekStart)}
          </a>
        ) : (
          <p className={styles.weekFiles}>{fileRefusalSentence('empty')}</p>
        )}
      </td>
    </tr>
  )
}

function PlanTable({
  plan,
  sessions,
  onOpenSession,
}: {
  plan: PlanWithSessions
  sessions: PlanSessionView[]
  onOpenSession: (id: string) => void
}) {
  const units = useSettings().data?.units
  const [editing, setEditing] = useState<PlanWeek | null>(null)
  const currentMonday = mondayOf(todayIso())
  const isV2 = plan.generatorVersion >= 2
  const first = plan.weeks[0]?.weekStart ?? plan.startDate
  const last = plan.weeks[plan.weeks.length - 1]?.weekStart ?? first
  const to = currentMonday < first ? first : currentMonday > last ? last : currentMonday
  const weeks = useWeeks({ from: first, to })
  const actual = new Map((weeks.data ?? []).map((w) => [w.weekStart, w.runMin]))
  // The current week opens to its days at first; other weeks open on request.
  const [open, setOpen] = useState<Set<string>>(() => new Set([currentMonday]))
  const sessionsByWeek = new Map<string, PlanSessionView[]>()
  for (const session of sessions) {
    sessionsByWeek.set(session.weekStart, [
      ...(sessionsByWeek.get(session.weekStart) ?? []),
      session,
    ])
  }

  function toggle(weekStart: string) {
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(weekStart)) next.add(weekStart)
      return next
    })
  }

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
            // A version-2 week carries the engine's own recovery flag (its cycle is 3:1 or 2:1 and
            // ladder weeks are exempt); a version-1 week has none, so its index decides.
            const cutback = isV2
              ? week.flags.includes('recovery')
              : isCutbackIndex(week.index, week.phase)
            const race = week.phase === 'race' && !week.flags.includes('post-race')
            const isCurrent = week.weekStart === currentMonday
            const runMin = week.weekStart <= currentMonday ? actual.get(week.weekStart) : undefined
            const short = formatShortDate(week.weekStart)
            const weekSessions = sessionsByWeek.get(week.weekStart) ?? []
            const expanded = weekSessions.length > 0 && open.has(week.weekStart)
            return (
              <Fragment key={week.weekStart}>
                <tr
                  data-week={week.weekStart}
                  data-cutback={cutback ? 'true' : undefined}
                  data-race={race ? 'true' : undefined}
                  data-taper={week.phase === 'taper' ? 'true' : undefined}
                  aria-current={isCurrent ? 'date' : undefined}
                  className={styles.row}
                >
                  <td className={styles.week}>{short}</td>
                  <td className={styles.phase}>
                    <PhaseChip phase={week.phase} flags={week.flags} />
                    {cutback ? <span className={styles.cutback}>cutback</span> : null}
                    {week.flags.includes('disrupted') ? (
                      <span className={styles.windowChip}>Rest window</span>
                    ) : null}
                    {week.flags.includes('disruption-return') ? (
                      <span className={styles.windowChip}>Return week</span>
                    ) : null}
                  </td>
                  <td className={styles.target} data-cell="target">
                    <TargetCell week={week} units={units} />
                  </td>
                  <td className={styles.actual} data-cell="actual">
                    {runMin === undefined ? '' : hours(runMin)}
                    {week.overshoot && runMin !== undefined ? (
                      <OvershootNote ranMin={runMin} plannedMin={week.plannedRunMin} />
                    ) : null}
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
                    {weekSessions.length > 0 ? (
                      <Button
                        variant="quiet"
                        aria-label={`Days for week of ${short}`}
                        aria-expanded={expanded}
                        onClick={() => {
                          toggle(week.weekStart)
                        }}
                      >
                        Days
                      </Button>
                    ) : null}
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
                {expanded ? (
                  <DaysRow week={week} sessions={weekSessions} onOpen={onOpenSession} />
                ) : null}
              </Fragment>
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

/**
 * The windows that are not over, as banners above the plan. Nothing renders until there is one;
 * the server's day is asked for only then. After that the banners stay mounted even when the list
 * empties, because removing a window empties it and its sheet has to stay to show the undo.
 */
function PlanWindows() {
  const windows = useDisruptions()
  const [engaged, setEngaged] = useState(false)
  const live = (windows.data ?? []).filter((window) => window.phase !== 'done')
  if (live.length > 0 && !engaged) setEngaged(true)
  if (live.length === 0 && !engaged) return null
  return <PlanBanners windows={live} />
}

function PlanBanners({ windows }: { windows: DisruptionView[] }) {
  const today = useToday()
  const settings = useSettings()
  if (today.data === undefined) return null
  return (
    <DisruptionBanners
      windows={windows}
      today={today.data.date}
      units={settings.data?.units ?? 'km'}
    />
  )
}

/** Weekly targets from the start date to race week; every week stays editable. */
export function PlanPage() {
  const plan = usePlan()
  const goals = useGoals()
  const [regenerating, setRegenerating] = useState(false)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  const [why, setWhy] = useState<WhyTarget | null>(null)
  const [notFull, setNotFull] = useState(false)
  const [updating, setUpdating] = useState(false)

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

  // Version-1 plans carry no sessions; their weekly review logic is unchanged.
  const hasSessions = plan.data.generatorVersion >= 2
  const sessions = hasSessions ? plan.data.sessions : []
  const openSession = sessions.find((s) => s.id === openSessionId)

  return (
    <>
      <PageHeader
        title="Plan"
        context={`${plan.data.name}. Race week of ${formatShortDate(plan.data.raceWeekStart)}.`}
        actions={
          <>
            {hasSessions ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNotFull(true)
                  }}
                >
                  Not 100%
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setUpdating(true)
                  }}
                >
                  Update plan from latest data
                </Button>
              </>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                setRegenerating(true)
              }}
            >
              Regenerate plan
            </Button>
          </>
        }
      />
      {hasSessions ? <PlanWindows /> : null}
      {hasSessions ? <WristStrip sessions={sessions} /> : null}
      {hasSessions ? <PlanOverview plan={plan.data} onWhy={setWhy} /> : null}
      <PlanTable plan={plan.data} sessions={sessions} onOpenSession={setOpenSessionId} />
      {openSession !== undefined ? (
        <SessionSheet
          key={openSession.id}
          session={openSession}
          onClose={() => {
            setOpenSessionId(null)
          }}
        />
      ) : null}
      <WhyDrawer
        explain={why?.explain}
        rules={why?.rules ?? []}
        open={why !== null}
        onClose={() => {
          setWhy(null)
        }}
      />
      {notFull ? (
        <NotFullSheet
          onClose={() => {
            setNotFull(false)
          }}
        />
      ) : null}
      {updating ? (
        <ReplanSheet
          onClose={() => {
            setUpdating(false)
          }}
        />
      ) : null}
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
              initialLoad={plan.data.load?.requested}
              initialCycle={plan.data.recoveryCycle}
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
