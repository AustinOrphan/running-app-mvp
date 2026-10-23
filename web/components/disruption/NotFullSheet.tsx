import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { windowRuleFact } from '../../../shared/copy/revision.ts'
import { renderFact } from '../../../shared/copy/templates.ts'
import {
  offlineLine,
  raceDayLine,
  runningTimeLine,
  stalePreviewLine,
} from '../../../shared/copy/windowView.ts'
import type { DisruptionResult, PlanPreview } from '../../../shared/types.ts'
import { useCreateDisruption, useDisruptions, usePreviewDisruption } from '../../api/disruptions.ts'
import { commitFailure, useMarkRevisionsSeen, usePlan } from '../../api/plan.ts'
import { useSettings } from '../../api/settings.ts'
import { useToday } from '../../api/today.ts'
import { Button } from '../Button.tsx'
import { Field, Input } from '../Field.tsx'
import { ScalePicker } from '../ScalePicker.tsx'
import { Segmented } from '../Segmented.tsx'
import { Sheet } from '../Sheet.tsx'
import { Skeleton } from '../Skeleton.tsx'
import { RevisionDiff } from '../revisions/RevisionDiff.tsx'
import { PreviewPanel } from './PreviewPanel.tsx'
import { newWarnings, windowCovers } from './previewFigures.ts'
import {
  EMPTY_DRAFT,
  REASON_CHOICES,
  RUN_CAP_CHOICES,
  dateBounds,
  datesOf,
  draftErrors,
  inputOf,
  isIllness,
  modeOf,
  windowSentences,
  type WindowDraft,
} from './windowDraft.ts'
import styles from './disruption.module.css'

export interface NotFullSheetProps {
  /** Called when the sheet closes: Cancel, Close, Escape, or Done after the window was added. */
  onClose: () => void
  /**
   * The server's local day (`TodayView.date`), which the dates of the sheet start from and are
   * bounded by. Omitted, the sheet reads it from `GET /api/today`; the device clock is never used.
   */
  today?: string
}

type Step = 'reason' | 'when' | 'review' | 'done'

const STEP_NUMBER: Record<Exclude<Step, 'done'>, number> = { reason: 1, when: 2, review: 3 }

const NIGGLE_BONE_NOTICE =
  'Pain at one spot on a bone pauses progression until a clinician has seen it. The check-in is where to record it.'
const BELOW_NECK_NOTICE =
  'With a fever, chest symptoms or aches all over, see a clinician before running again.'

/** The fields a server refusal can name, in the order the form shows them. */
const FIELD_ORDER = ['startDate', 'endDate', 'mode', 'maxRunMin', 'area', 'pain', 'gaitChange']

/**
 * "Not 100%": the runner tells the plan what is going on, in three steps. The reason (ill above the
 * neck, ill below it, a niggle, short on time, travelling); the first and last day, which may start
 * in the past, and for a reason that allows it whether running stops or is capped; then the preview
 * of what would change, built by the server from the code that commits it. "Apply to my plan"
 * sends the hash of that preview, so a plan that moved answers with a newer preview instead of an
 * unseen change. A window is information the plan uses, never a failure; minutes rested are not
 * added back.
 *
 * It is one component with two props, so Plan, Today and a check-in prompt open the same sheet. It
 * reads the server's day, the plan, the runner's other windows and the units itself. A bottom sheet
 * below 900 px; focus moves to the heading of each step, and back to whatever opened the sheet when
 * it closes.
 */
export function NotFullSheet({ onClose, today: given }: NotFullSheetProps) {
  const settings = useSettings()
  const todayView = useToday()
  const plan = usePlan()
  const windows = useDisruptions({ includeAll: true })
  const previewWindow = usePreviewDisruption()
  const create = useCreateDisruption()
  const markSeen = useMarkRevisionsSeen()
  const radioName = useId()

  const [step, setStep] = useState<Step>('reason')
  const [draft, setDraft] = useState<WindowDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<PlanPreview | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState<DisruptionResult | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRun = useRef(true)
  /** The field to focus once a refusal has been drawn, so the runner lands on what to fix. */
  const focusField = useRef<string | null>(null)

  // Focus follows the step: the heading of the new step, so a screen reader starts at its top. A
  // refusal that names a field sends focus to that field instead (the effect below).
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (focusField.current === null) heading.current?.focus()
  }, [step])
  useEffect(() => {
    if (focusField.current === null) return
    document.querySelector<HTMLElement>(`[data-field="${focusField.current}"]`)?.focus()
    focusField.current = null
  }, [errors])

  const units = settings.data?.units ?? 'km'
  const today = given ?? todayView.data?.date
  const raceDate =
    todayView.data?.coach.race?.targetDate ??
    plan.data?.sessions.find((session) => session.kind === 'race')?.date ??
    null
  const input = today === undefined ? null : inputOf(draft, today)

  function change(patch: Partial<WindowDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors({})
    setFailure(null)
  }

  /** The error of a field of the form, or nothing. */
  function problems(): Record<string, string> {
    if (input === null || today === undefined) return {}
    return draftErrors(input, { today, raceDate, units })
  }

  function showFieldErrors(found: Record<string, string>) {
    focusField.current = FIELD_ORDER.find((field) => field in found) ?? null
    setErrors(found)
    setStep('when')
  }

  function fail(error: unknown) {
    const outcome = commitFailure(error)
    if (outcome.kind === 'stale') {
      setPreview(outcome.preview)
      setNotice(stalePreviewLine(units))
    } else if (outcome.kind === 'invalid' && Object.keys(outcome.fields).length > 0) {
      showFieldErrors(outcome.fields)
    } else if (outcome.kind === 'offline') {
      setFailure(offlineLine(units))
    } else {
      setFailure(outcome.message)
    }
  }

  function showPreview() {
    if (input === null) return
    const found = problems()
    if (Object.keys(found).length > 0) {
      showFieldErrors(found)
      return
    }
    setErrors({})
    setFailure(null)
    previewWindow.mutate(
      { type: 'disruption-create', ...input },
      {
        onSuccess: (made) => {
          setPreview(made)
          setNotice(null)
          setStep('review')
        },
        onError: fail,
      },
    )
  }

  function apply() {
    if (input === null || preview === null || preview.blocked) return
    setFailure(null)
    create.mutate(
      { ...input, expectHash: preview.hash },
      {
        onSuccess: (result) => {
          setDone(result)
          setStep('done')
          // The runner is looking at it, so it is not "New" later.
          markSeen([result.revision.id])
        },
        onError: fail,
      },
    )
  }

  function back() {
    setFailure(null)
    setNotice(null)
    setStep(step === 'review' ? 'when' : 'reason')
  }

  const busy = previewWindow.isPending || create.isPending
  let body: ReactNode
  let footer: ReactNode

  if (today === undefined) {
    body = todayView.isError ? (
      <p role="alert" className={styles.errorText}>
        {"The server's date could not be loaded. Close this and try again."}
      </p>
    ) : (
      <Skeleton lines={3} />
    )
    footer = (
      <Button variant="quiet" onClick={onClose}>
        Cancel
      </Button>
    )
  } else if (step === 'done' && done !== null) {
    body = (
      <>
        <div role="status">
          <h3 ref={heading} tabIndex={-1} className={styles.stepHeading}>
            Window added
          </h3>
        </div>
        <RevisionDiff revision={done.revision} units={units} isNew={false} />
      </>
    )
    footer = (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    )
  } else if (step === 'review' && preview !== null && input !== null) {
    body = (
      <>
        <StepHeading step={step} heading={heading} title="What would change" />
        <PreviewPanel
          preview={preview}
          units={units}
          notice={notice}
          lead={windowSentences(input, windows.data ?? [], units)}
          facts={preview.runMin === null ? [] : [runningTimeLine(preview.runMin, units)]}
          notes={raceDate !== null && windowCovers(input, raceDate) ? [raceDayLine(units)] : []}
          warnings={newWarnings(preview.warnings, plan.data?.warnings ?? [])}
        />
        {failure !== null ? (
          <p role="alert" className={styles.errorText}>
            {failure}
          </p>
        ) : null}
      </>
    )
    footer = (
      <>
        <Button variant="quiet" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="secondary" disabled={busy} onClick={back}>
          Back
        </Button>
        <Button
          variant="primary"
          disabled={preview.blocked}
          loading={create.isPending}
          onClick={apply}
        >
          Apply to my plan
        </Button>
      </>
    )
  } else if (step === 'when' && draft.reason !== null) {
    const { from, until } = datesOf(draft, today)
    const bounds = dateBounds(from, today, raceDate)
    const mode = modeOf(draft)
    const reason = draft.reason
    const rule = windowRuleFact(reason)
    body = (
      <>
        <StepHeading step={step} heading={heading} title="When" />
        <div className={styles.fields}>
          <Field label="From" hint="You can start this in the past." error={errors['startDate']}>
            {(a) => (
              <Input
                {...a}
                data-field="startDate"
                type="date"
                value={from}
                min={bounds.startMin}
                onChange={(event) => {
                  const next = event.target.value
                  change({
                    startDate: next,
                    endDate: draft.endDate !== '' && draft.endDate < next ? next : draft.endDate,
                  })
                }}
              />
            )}
          </Field>
          <Field
            label="Until"
            hint="The last day it affects training. You can change it later."
            error={errors['endDate']}
          >
            {(a) => (
              <Input
                {...a}
                data-field="endDate"
                type="date"
                value={until}
                min={bounds.endMin}
                max={bounds.endMax}
                onChange={(event) => {
                  change({ endDate: event.target.value })
                }}
              />
            )}
          </Field>
          {rule !== null ? (
            <p role="note" className={styles.rule}>
              {renderFact(rule, units)}
            </p>
          ) : null}
          {reason === 'illness-below-neck' ? (
            <p role="note" className={styles.rule}>
              {BELOW_NECK_NOTICE}
            </p>
          ) : null}
          {reason === 'niggle' ? (
            <>
              <Field label="Where is it?" error={errors['area']}>
                {(a) => (
                  <Input
                    {...a}
                    data-field="area"
                    value={draft.area}
                    maxLength={80}
                    onChange={(event) => {
                      change({ area: event.target.value })
                    }}
                  />
                )}
              </Field>
              <ScalePicker
                legend="Pain (0 to 10)"
                min={0}
                max={10}
                value={draft.pain}
                onChange={(pain) => {
                  change({ pain })
                }}
                hint={errors['pain'] ?? '0 is none, 10 is the worst.'}
              />
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={draft.gaitChange}
                  onChange={(event) => {
                    change({ gaitChange: event.target.checked })
                  }}
                />
                It changes how I walk or run
              </label>
              <p role="note" className={styles.rule}>
                {NIGGLE_BONE_NOTICE} <Link to="/">{"Open today's check-in"}</Link>
              </p>
            </>
          ) : null}
          {!isIllness(reason) ? (
            <>
              <Segmented<'rest' | 'limited'>
                label="Running during this time"
                hint="Short easy runs keep each day's run to the length you choose."
                options={[
                  { value: 'rest', label: 'No running' },
                  { value: 'limited', label: 'Short easy runs' },
                ]}
                value={mode}
                onChange={(next) => {
                  change({ mode: next })
                }}
              />
              {mode === 'limited' ? (
                <>
                  <Segmented<string>
                    label="Longest run"
                    hint={errors['maxRunMin'] ?? 'The longest run on any day of the window.'}
                    options={RUN_CAP_CHOICES.map((min) => ({
                      value: String(min),
                      label: `${String(min)} min`,
                    }))}
                    value={String(draft.maxRunMin)}
                    onChange={(next) => {
                      change({ maxRunMin: Number(next) })
                    }}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </div>
        {failure !== null ? (
          <p role="alert" className={styles.errorText}>
            {failure}
          </p>
        ) : null}
      </>
    )
    footer = (
      <>
        <Button variant="quiet" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="secondary" disabled={busy} onClick={back}>
          Back
        </Button>
        <Button variant="primary" loading={previewWindow.isPending} onClick={showPreview}>
          Next
        </Button>
      </>
    )
  } else {
    body = (
      <>
        <StepHeading step="reason" heading={heading} title="What is going on" />
        <p className={styles.text}>
          Tell the plan what is going on. Minutes you rest are not added back later.
        </p>
        <fieldset className={styles.choices} aria-label="What is going on">
          {REASON_CHOICES.map((choice) => (
            <label key={choice.value} className={styles.choice}>
              <input
                type="radio"
                name={radioName}
                value={choice.value}
                checked={draft.reason === choice.value}
                onChange={() => {
                  change({
                    reason: choice.value,
                    mode: null,
                    ...(choice.value === 'niggle'
                      ? {}
                      : { area: '', pain: null, gaitChange: false }),
                  })
                }}
              />
              <span className={styles.choiceText}>
                <span className={styles.choiceLabel}>{choice.label}</span>
                {choice.hint !== undefined ? (
                  <span className={styles.choiceHint}>{choice.hint}</span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
      </>
    )
    footer = (
      <>
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={draft.reason === null}
          onClick={() => {
            setStep('when')
          }}
        >
          Next
        </Button>
      </>
    )
  }

  return (
    <Sheet open onClose={onClose} title="Not 100%" footer={footer}>
      <div className={styles.body}>{body}</div>
    </Sheet>
  )
}

/** "Step 2 of 3" and the heading that takes focus when the step opens. */
function StepHeading({
  step,
  heading,
  title,
}: {
  step: Exclude<Step, 'done'>
  heading: RefObject<HTMLHeadingElement>
  title: string
}) {
  return (
    <>
      <p className={styles.stepCount}>{`Step ${String(STEP_NUMBER[step])} of 3`}</p>
      <h3 ref={heading} tabIndex={-1} className={styles.stepHeading}>
        {title}
      </h3>
    </>
  )
}
