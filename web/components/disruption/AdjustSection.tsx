import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { adjustText } from '../../../shared/copy/revision.ts'
import { offlineLine, stalePreviewLine } from '../../../shared/copy/windowView.ts'
import { isIsoDate } from '../../../shared/dates.ts'
import { isToRun } from '../../../shared/domain/sessionStatus.ts'
import { RUN_KINDS } from '../../../shared/engine/adjust.ts'
import type {
  AdjustResult,
  PlanAdjustment,
  PlanGuardView,
  PlanSession,
} from '../../../shared/types.ts'
import { ApiError } from '../../api/client.ts'
import {
  adjustPreviewKey,
  adjustPreviewOf,
  commitFailure,
  useAdjustPreview,
  useAdjustSession,
  useMarkRevisionsSeen,
  usePlan,
} from '../../api/plan.ts'
import { useSettings } from '../../api/settings.ts'
import { Button } from '../Button.tsx'
import { Field, Input, Select } from '../Field.tsx'
import { useToast } from '../Toast.tsx'
import { formatShortDate, formatWeekday } from '../format.ts'
import { PlanDiffView } from '../revisions/PlanDiffView.tsx'
import { RevisionDiff } from '../revisions/RevisionDiff.tsx'
// The section, heading, muted and inline classes of the session sheet it sits in.
import sheetStyles from '../SessionSheet.module.css'
import styles from './disruption.module.css'

export interface AdjustSectionProps {
  session: PlanSession
}

const NBSP = ' '

/** The longest session a shorten can name: a full day of minutes (the route's limit). */
const MAX_SESSION_MIN = 24 * 60

/** The kinds that hold no running: a shorten does not apply to them. */
function isShortenable(session: PlanSession): boolean {
  return RUN_KINDS.has(session.kind) && session.durationMin > 0
}

/**
 * Change one session: move it to another day of its week, swap it with another session of the
 * week, shorten it, skip it or restore it. Each change is asked of the server as a dry run while
 * the runner chooses (`POST /api/plan/sessions/:id/adjust` with `dryRun`), so the section shows
 * the guard that would refuse it, in the guard's words with its rule, and the one alternative that
 * would work as a button, and the rows the change would write. "Apply change" commits that dry run
 * with its hash: a plan that moved in between answers with a newer one. What was applied is shown
 * as the revision it wrote, with its undo. Nothing is added back to another day.
 */
export function AdjustSection({ session }: AdjustSectionProps) {
  const formId = useId()
  const toast = useToast()
  const queryClient = useQueryClient()
  const settings = useSettings()
  const adjust = useAdjustSession()
  const markSeen = useMarkRevisionsSeen()
  // The day typed into the move field; null shows the session's own day, wherever it now is.
  const [moveDraft, setMoveDraft] = useState<string | null>(null)
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapId, setSwapId] = useState('')
  const [shorten, setShorten] = useState('')
  const [pending, setPending] = useState<PlanAdjustment | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [result, setResult] = useState<AdjustResult | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const resultBox = useRef<HTMLDivElement>(null)
  const units = settings.data?.units ?? 'km'

  // What was applied takes focus: the button that applied it is gone.
  useEffect(() => {
    if (result !== null) resultBox.current?.focus()
  }, [result])

  const plan = usePlan({ enabled: swapOpen })
  const dry = useAdjustPreview(session.id, pending)

  const settled =
    session.status === 'completed' || session.status === 'partial' || session.activityId !== null
  const skipped = session.status === 'skipped'
  const partners = (plan.data?.sessions ?? [])
    .filter(
      (other) =>
        other.id !== session.id &&
        other.weekStart === session.weekStart &&
        other.kind !== 'race' &&
        other.activityId === null &&
        isToRun(other.status),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)

  function choose(adjustment: PlanAdjustment | null) {
    setPending(adjustment)
    setResult(null)
    setNotice(null)
    setFailure(null)
  }

  /** Puts the controls where a suggested adjustment would leave them, and asks about it. */
  function follow(adjustment: PlanAdjustment) {
    if (adjustment.type === 'move') setMoveDraft(adjustment.date)
    if (adjustment.type === 'swap') {
      setSwapOpen(true)
      setSwapId(adjustment.withSessionId)
    }
    if (adjustment.type === 'shorten') setShorten(String(adjustment.durationMin))
    choose(adjustment)
    // The suggestion button leaves the page; focus goes to the part that now speaks for the change.
    queueMicrotask(() => panel.current?.focus())
  }

  function apply() {
    if (pending === null || dry.data === undefined || !dry.data.allowed) return
    const sent = pending
    setFailure(null)
    adjust.mutate(
      { id: session.id, adjustment: sent, expectHash: dry.data.hash },
      {
        onSuccess: (done) => {
          setResult(done)
          setPending(null)
          setMoveDraft(null)
          setSwapId('')
          setShorten('')
          if (done.revision !== null) {
            markSeen([done.revision.id])
            toast.show(done.revision.summary)
          }
        },
        onError: (error) => {
          const outcome = commitFailure(error)
          if (outcome.kind === 'stale') {
            queryClient.setQueryData(
              adjustPreviewKey(session.id, sent),
              adjustPreviewOf(outcome.preview),
            )
            setNotice(stalePreviewLine(units))
          } else if (outcome.kind === 'refused') {
            // A guard now refuses it: ask again, so the guards on screen are the server's.
            void queryClient.invalidateQueries({ queryKey: adjustPreviewKey(session.id, sent) })
          } else if (outcome.kind === 'offline') {
            setFailure(offlineLine(units))
          } else {
            setFailure(outcome.message)
          }
        },
      },
    )
  }

  function cancel() {
    choose(null)
    setMoveDraft(null)
    setSwapId('')
    setShorten('')
    queueMicrotask(() => heading.current?.focus())
  }

  const blocking = dry.data?.guards.filter((guard) => guard.effect === 'blocks') ?? []
  const warning = dry.data?.guards.filter((guard) => guard.effect === 'warns') ?? []
  const offline = dry.error instanceof ApiError && dry.error.status === 0
  const nothing = dry.data !== undefined && dry.data.allowed && dry.data.diff.empty

  return (
    <section className={sheetStyles.section} aria-labelledby={`${formId}-title`}>
      <h3 id={`${formId}-title`} ref={heading} tabIndex={-1} className={sheetStyles.heading}>
        Change this session
      </h3>

      {result !== null ? (
        <div
          ref={resultBox}
          tabIndex={-1}
          className={styles.result}
          role="group"
          aria-label="Applied change"
        >
          <p role="status" className={styles.text}>
            {result.revision === null ? 'Nothing changed.' : 'This change is in your plan.'}
          </p>
          {result.revision !== null ? (
            <RevisionDiff revision={result.revision} units={units} isNew={false} />
          ) : null}
        </div>
      ) : null}

      {settled ? (
        <p className={sheetStyles.muted}>
          {adjustText(session.activityId !== null ? 'adjust.linked' : 'adjust.settled')}
        </p>
      ) : (
        <div className={styles.adjustControls}>
          {skipped ? null : (
            <>
              <Field label="Move to">
                {(a) => (
                  <Input
                    {...a}
                    type="date"
                    value={moveDraft ?? session.date}
                    onChange={(event) => {
                      const next = event.target.value
                      setMoveDraft(next)
                      choose(
                        isIsoDate(next) && next !== session.date
                          ? { type: 'move', date: next }
                          : null,
                      )
                    }}
                  />
                )}
              </Field>
              {swapOpen ? (
                <Field
                  label="Swap with"
                  error={plan.isError ? 'The sessions of the week did not load.' : undefined}
                >
                  {(a) => (
                    <Select
                      {...a}
                      value={swapId}
                      disabled={plan.data === undefined}
                      onChange={(event) => {
                        const next = event.target.value
                        setSwapId(next)
                        choose(next === '' ? null : { type: 'swap', withSessionId: next })
                      }}
                    >
                      <option value="">Choose a session</option>
                      {partners.map((other) => (
                        <option key={other.id} value={other.id}>
                          {`${formatWeekday(other.date)} ${formatShortDate(other.date)}, ${other.title}, ${String(other.durationMin)}${NBSP}min`}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSwapOpen(true)
                    }}
                  >
                    Swap with another session
                  </Button>
                </div>
              )}
              {isShortenable(session) ? (
                <Field label="Shorten to (minutes)" hint="Nothing is added back to another day.">
                  {(a) => (
                    <Input
                      {...a}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_SESSION_MIN}
                      value={shorten}
                      onChange={(event) => {
                        const next = event.target.value
                        setShorten(next)
                        const minutes = Number(next)
                        choose(
                          /^\d+$/.test(next) && minutes >= 1 && minutes <= MAX_SESSION_MIN
                            ? { type: 'shorten', durationMin: minutes }
                            : null,
                        )
                      }}
                    />
                  )}
                </Field>
              ) : null}
            </>
          )}
          <div className={styles.adjustButtons}>
            {skipped ? (
              <Button
                variant="secondary"
                onClick={() => {
                  choose({ type: 'restore' })
                }}
              >
                Restore session
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  choose({ type: 'skip' })
                }}
              >
                Skip session
              </Button>
            )}
          </div>
          {skipped ? null : (
            <p className={sheetStyles.muted}>A skipped session is not made up later.</p>
          )}
        </div>
      )}

      <div ref={panel} tabIndex={-1} className={styles.adjustPanel}>
        {pending !== null && dry.isPending ? (
          <p role="status" className={sheetStyles.muted}>
            Checking this change.
          </p>
        ) : null}
        {pending !== null && dry.isError ? (
          <p role="alert" className={styles.errorText}>
            {offline ? offlineLine(units) : 'This change could not be checked. Try again.'}
          </p>
        ) : null}
        {dry.data !== undefined && pending !== null ? (
          <>
            {notice !== null ? (
              <p role="status" className={styles.notice}>
                {notice}
              </p>
            ) : null}
            {blocking.length > 0 ? (
              <GuardList label="Why this cannot be done" guards={blocking} onSuggest={follow} />
            ) : null}
            {warning.length > 0 ? (
              <GuardList label="Worth knowing" guards={warning} onSuggest={follow} />
            ) : null}
            {dry.data.allowed ? (
              nothing ? (
                <p className={sheetStyles.muted}>This would not change the plan.</p>
              ) : (
                <>
                  <p className={styles.subheading}>What would change</p>
                  <PlanDiffView diff={dry.data.diff} units={units} />
                </>
              )
            ) : null}
            <div className={styles.adjustButtons}>
              <Button
                variant="primary"
                disabled={!dry.data.allowed || nothing}
                loading={adjust.isPending}
                onClick={apply}
              >
                Apply change
              </Button>
              <Button variant="quiet" disabled={adjust.isPending} onClick={cancel}>
                Cancel
              </Button>
            </div>
          </>
        ) : null}
        {failure !== null ? (
          <p role="alert" className={styles.errorText}>
            {failure}
          </p>
        ) : null}
      </div>
    </section>
  )
}

/** The guards of a dry run, each in its own words with the button of the alternative that works. */
function GuardList({
  label,
  guards,
  onSuggest,
}: {
  label: string
  guards: readonly PlanGuardView[]
  onSuggest: (adjustment: PlanAdjustment) => void
}) {
  return (
    <ul className={styles.guards} aria-label={label}>
      {guards.map((guard, index) => (
        <li key={`${guard.code}-${String(index)}`} data-guard={guard.code}>
          <span>{guard.message}</span>
          {guard.suggest !== null ? (
            <Button
              variant="secondary"
              onClick={() => {
                if (guard.suggest !== null) onSuggest(guard.suggest.adjustment)
              }}
            >
              {guard.suggest.label}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
