import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { addDays, mondayOf, todayIso, weekStartsBetween } from '../../shared/dates.ts'
import { toV1Phase } from '../../shared/domain/plan.ts'
import {
  nextMinutesFor,
  suggestAction,
  type SuggestInput,
  type Suggestion,
} from '../../shared/domain/review.ts'
import type {
  ActivityListItem,
  DataStatus,
  PlanRevision,
  PlanSession,
  PlanSessionStatus,
  PlanWeek,
  PlanWithSessions,
  ReviewSignals,
  ReviewView,
  SavedReview,
  SuggestedAction,
  Symptoms,
  WeekRow,
  WeeklyReview,
} from '../../shared/types.ts'
import { minutesToHours1 } from '../../shared/units.ts'
import { ApiError, fieldErrors } from '../api/client.ts'
import { useActivities } from '../api/activities.ts'
import { usePlan } from '../api/plan.ts'
import { useReviews, useSaveReview, type ReviewPatch } from '../api/reviews.ts'
import { useSettings } from '../api/settings.ts'
import { useWeeks } from '../api/weeks.ts'
import { useAcceptZoneProposal, useDeclineZoneProposal, useZoneProposals } from '../api/zones.ts'
import { Button } from '../components/Button.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { ExplainButton } from '../components/ExplainButton.tsx'
import { Field, Input, Textarea } from '../components/Field.tsx'
import { Meter } from '../components/Meter.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { useToast } from '../components/Toast.tsx'
import { formatShortDate, formatWeekday, weekPhaseLabel } from '../components/format.ts'
import { localiseEngineText } from '../components/engineText.ts'
import { describeChange } from '../components/planChanges.ts'
import { PROPOSAL_LABELS, proposalValueText } from '../components/zoneFormat.ts'
import styles from './ReviewPage.module.css'

/** The picker covers this many finished weeks plus the current one. */
const WEEKS_BACK = 12

type Decision = 'progress' | 'hold' | 'repeat' | 'reduce'

const DECISION_OPTIONS: Array<{ value: Decision; label: string }> = [
  { value: 'progress', label: 'Progress' },
  { value: 'hold', label: 'Hold' },
  { value: 'repeat', label: 'Repeat' },
  { value: 'reduce', label: 'Reduce' },
]

/** The re-plan that followed a save, as the page shows it. */
interface ReplanOutcome {
  revision: PlanRevision | null
  error: string | null
}

const SESSION_STATUS_LABELS: Record<PlanSessionStatus, string> = {
  planned: 'Planned',
  completed: 'Completed',
  partial: 'Partly done',
  skipped: 'Skipped',
  downgraded: 'Eased',
  moved: 'Moved',
}

const DATA_OPTIONS: Array<{ value: DataStatus; label: string }> = [
  { value: 'complete', label: 'Data complete' },
  { value: 'missing', label: 'Missing data' },
]

const SYMPTOM_OPTIONS: Array<{ value: Symptoms | ''; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'mild', label: 'Mild' },
  { value: 'persistent', label: 'Persistent' },
]

const FATIGUE_OPTIONS = Array.from({ length: 10 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}))

const ACTION_NAMES: Record<SuggestedAction, string> = {
  upcoming: 'Upcoming',
  in_progress: 'In progress',
  await_data: 'Waiting for data',
  review_duplicates: 'Review duplicates',
  reduce: 'Reduce',
  repeat: 'Repeat',
  needs_recovery_review: 'Needs fatigue and symptoms',
  hold: 'Hold',
  progress: 'Progress',
}

/** Fields that show their own inline error message. */
const MARKED_FIELDS = new Set(['finalNextMin', 'notes'])

function isDecision(value: string | null | undefined): value is Decision {
  return DECISION_OPTIONS.some((option) => option.value === value)
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A week is finished once its Sunday is before today. */
function isFinished(weekStart: string, today: string): boolean {
  return addDays(weekStart, 6) < today
}

function emptyReview(weekStart: string): WeeklyReview {
  const now = ''
  return {
    id: '',
    userId: '',
    weekStart,
    dataStatus: 'unconfirmed',
    fatigue: null,
    symptoms: null,
    recoveryConstrained: false,
    suggestedAction: null,
    suggestedReason: null,
    suggestedNextMin: null,
    finalDecision: null,
    finalNextMin: null,
    notes: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function emptyWeek(weekStart: string): WeekRow {
  return {
    weekStart,
    runMin: 0,
    runM: 0,
    runSessions: 0,
    runDays: 0,
    strengthSessions: 0,
    crossMin: 0,
    raceMin: 0,
    longestRunMin: 0,
    longRunShare: null,
    avg4wRunMin: 0,
    streak3Plus: 0,
  }
}

/**
 * The review opens on the last finished week: the Monday before this week's Monday, whatever the
 * weekday and whether or not it was reviewed already. Earlier weeks are one tap away in the picker.
 */
function defaultWeek(today: string): string {
  return addDays(mondayOf(today), -7)
}

/** The subtitle for a week that has no plan week: why there are no suggestions. */
function outsidePlanContext(plan: PlanWithSessions | null, weekStart: string): string {
  const first = plan?.weeks[0]?.weekStart
  if (plan === null || first === undefined) {
    return 'No plan yet. Suggestions appear once a plan exists.'
  }
  return weekStart < first
    ? "Before the plan starts. Suggestions begin with the plan's first week."
    : 'After the plan ends. There are no suggestions for this week.'
}

export function ReviewPage() {
  const today = todayIso()
  const thisWeek = mondayOf(today)
  const from = addDays(thisWeek, -7 * WEEKS_BACK)
  const reviews = useReviews({ from, to: thisWeek })
  const weeks = useWeeks({ from, to: thisWeek })
  const plan = usePlan()
  const activities = useActivities({ from, to: addDays(thisWeek, 6) })

  if (reviews.isError || weeks.isError || plan.isError || activities.isError) {
    return (
      <>
        <PageHeader title="Review" />
        <p role="alert">
          The review did not load. Check the connection and reload the page to try again.
        </p>
      </>
    )
  }
  if (reviews.isPending || weeks.isPending || plan.isPending || activities.isPending) {
    return (
      <>
        <PageHeader title="Review" />
        <Skeleton lines={5} />
      </>
    )
  }

  return (
    <ReviewBody
      today={today}
      from={from}
      thisWeek={thisWeek}
      reviews={reviews.data}
      weeks={weeks.data}
      plan={plan.data}
      activities={activities.data}
    />
  )
}

interface ReviewBodyProps {
  today: string
  from: string
  thisWeek: string
  reviews: WeeklyReview[]
  weeks: WeekRow[]
  plan: PlanWithSessions | null
  activities: ActivityListItem[]
}

function ReviewBody({ today, from, thisWeek, reviews, weeks, plan, activities }: ReviewBodyProps) {
  const pickerWeeks = weekStartsBetween(from, thisWeek)
  const reviewByWeek = new Map(reviews.map((review) => [review.weekStart, review]))
  // Chosen once: saving a review must not move the page to another week.
  const [selected, setSelected] = useState(() => defaultWeek(today))

  const reviewed = reviews
    .filter((review) => review.reviewedAt !== null)
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))

  const nothingToReview =
    plan === null &&
    reviewed.length === 0 &&
    weeks.every((week) => week.runSessions === 0 && week.runMin === 0)
  if (nothingToReview) {
    return (
      <>
        <PageHeader title="Review" />
        <EmptyState
          title="Nothing to review. Last week is closed."
          body="No plan yet. Choose a goal race, then generate weekly targets."
          action={<Link to="/plan">Go to the plan</Link>}
        />
      </>
    )
  }

  const index = pickerWeeks.indexOf(selected)
  const planWeek = plan?.weeks.find((week) => week.weekStart === selected) ?? null
  const nextPlanWeek = plan?.weeks.find((week) => week.weekStart === addDays(selected, 7)) ?? null
  const review: ReviewView = reviewByWeek.get(selected) ?? emptyReview(selected)
  const sessions = (plan?.sessions ?? [])
    .filter((session) => session.weekStart === selected)
    .sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1))
  const row = weeks.find((week) => week.weekStart === selected) ?? emptyWeek(selected)
  const hasPossibleDuplicates = activities.some(
    (activity) => activity.duplicateStatus === 'possible' && mondayOf(activity.date) === selected,
  )

  function go(step: number) {
    const target = pickerWeeks[index + step]
    if (target !== undefined) setSelected(target)
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Review"
        context={planWeek ? weekPhaseLabel(planWeek) : outsidePlanContext(plan, selected)}
      />

      <div className={styles.picker}>
        <Button
          onClick={() => {
            go(-1)
          }}
          disabled={index <= 0}
        >
          Previous week
        </Button>
        <p className={styles.weekLabel} aria-live="polite">
          {`Week of ${formatShortDate(selected)}`}
        </p>
        <Button
          onClick={() => {
            go(1)
          }}
          disabled={index === -1 || index >= pickerWeeks.length - 1}
        >
          Next week
        </Button>
      </div>

      <WeekReview
        key={selected}
        today={today}
        weekStart={selected}
        review={review}
        row={row}
        planWeek={planWeek}
        nextPlanWeek={nextPlanWeek}
        hasPossibleDuplicates={hasPossibleDuplicates}
        isV2={plan !== null && plan.generatorVersion >= 2}
        sessions={sessions}
      />

      <ZoneProposals />

      <section className={styles.section}>
        <h2>Reviewed weeks</h2>
        {reviewed.length === 0 ? (
          <p className={styles.muted}>No reviewed weeks yet.</p>
        ) : (
          <ul className={styles.history}>
            {reviewed.map((item) => (
              <li key={item.weekStart} className={styles.historyRow}>
                <span className={styles.historyWeek}>{formatShortDate(item.weekStart)}</span>
                <span>
                  {item.finalDecision === null ? 'No decision' : capitalise(item.finalDecision)}
                </span>
                {item.finalNextMin !== null ? (
                  <span
                    className={styles.muted}
                  >{`${String(item.finalNextMin)} min next week`}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

interface WeekReviewProps {
  today: string
  weekStart: string
  review: ReviewView
  row: WeekRow
  planWeek: PlanWeek | null
  nextPlanWeek: PlanWeek | null
  hasPossibleDuplicates: boolean
  /** Version-2 plans use the server's weekly decision; version-1 plans suggest live from the form. */
  isV2: boolean
  sessions: PlanSession[]
}

function WeekReview({
  today,
  weekStart,
  review,
  row,
  planWeek,
  nextPlanWeek,
  hasPossibleDuplicates,
  isV2,
  sessions,
}: WeekReviewProps) {
  const finished = isFinished(weekStart, today)
  const toast = useToast()
  const save = useSaveReview()
  const units = useSettings().data?.units ?? 'mi'
  const headingId = useId()
  const noteId = useId()
  const changedId = useId()

  const [dataStatus, setDataStatus] = useState<DataStatus>(review.dataStatus)
  const [fatigue, setFatigue] = useState(review.fatigue === null ? '' : String(review.fatigue))
  const [symptoms, setSymptoms] = useState<Symptoms | ''>(review.symptoms ?? '')
  const [recoveryConstrained, setRecoveryConstrained] = useState(review.recoveryConstrained)
  // null: follow the suggestion until the runner chooses.
  const [decision, setDecision] = useState<string | null>(review.finalDecision)
  const [nextMin, setNextMin] = useState<string | null>(
    review.finalNextMin === null ? null : String(review.finalNextMin),
  )
  const [notes, setNotes] = useState(review.notes ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [replanned, setReplanned] = useState<ReplanOutcome | null>(null)

  const suggestInput: SuggestInput | null = planWeek
    ? {
        today,
        weekStart,
        phase: toV1Phase(planWeek.phase),
        targetRunMin: planWeek.targetRunMin,
        baselineRunMin: planWeek.baselineRunMin,
        plannedRunDays: planWeek.runDays,
        nextBaselineMin: nextPlanWeek?.baselineRunMin ?? null,
        week: row,
        review: {
          dataStatus,
          fatigue: fatigue === '' ? null : Number(fatigue),
          symptoms: symptoms === '' ? null : symptoms,
          recoveryConstrained,
        },
        hasPossibleDuplicates,
      }
    : null
  let suggestion: Suggestion | null = null
  if (isV2) {
    if (planWeek && review.suggestedAction !== null) {
      suggestion = {
        action: review.suggestedAction,
        reason: review.suggestedReason ?? '',
        suggestedNextMin: review.suggestedNextMin,
      }
    }
  } else if (suggestInput) {
    suggestion = suggestAction(suggestInput)
  }
  const decisionOptions = isV2
    ? DECISION_OPTIONS.filter((option) => option.value !== 'repeat')
    : DECISION_OPTIONS

  const changedRules = [...new Set(replanned?.revision?.changes.flatMap((c) => c.rules) ?? [])]

  const suggestedDecision = suggestion && isDecision(suggestion.action) ? suggestion.action : ''
  const suggestedMin = suggestion?.suggestedNextMin ?? null
  const shownDecision = decision ?? suggestedDecision
  // The prefill follows the decision shown, which may differ from the suggested action.
  let decisionMin: number | null = null
  if (isV2) {
    decisionMin = shownDecision === suggestion?.action ? suggestion.suggestedNextMin : null
  } else if (suggestInput && isDecision(shownDecision)) {
    decisionMin = nextMinutesFor(shownDecision, suggestInput)
  }
  const shownNextMin = nextMin ?? (decisionMin === null ? '' : String(decisionMin))

  function chooseDecision(value: string) {
    setDecision(value)
    // A new decision brings its own minutes; typing in the field overrides them again.
    setNextMin(null)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setErrors({})
    setFailure(null)
    setReplanned(null)

    const patch: ReviewPatch = {
      dataStatus,
      fatigue: fatigue === '' ? null : Number(fatigue),
      symptoms: symptoms === '' ? null : symptoms,
      recoveryConstrained,
      notes: notes.trim() === '' ? null : notes,
    }
    if (finished) {
      const text = shownNextMin.trim()
      if (text !== '' && !/^\d{1,6}$/.test(text)) {
        setErrors({ finalNextMin: 'Enter whole minutes, like 330.' })
        return
      }
      patch.finalDecision = shownDecision === '' ? null : shownDecision
      patch.finalNextMin = text === '' ? null : Number(text)
    }

    try {
      const saved: SavedReview = await save.mutateAsync({ weekStart, patch })
      if (isV2 && (saved.revision != null || saved.replanError !== undefined)) {
        setReplanned({ revision: saved.revision ?? null, error: saved.replanError ?? null })
      }
      toast.show(`Week of ${formatShortDate(weekStart)} saved`)
    } catch (err) {
      const issues = fieldErrors(err)
      setErrors(issues)
      // Only these fields show an inline error; any other issue is stated in the alert.
      const unmarked = Object.entries(issues)
        .filter(([path]) => !MARKED_FIELDS.has(path))
        .map(([, message]) => message)
      setFailure(
        unmarked.length > 0
          ? `Review not saved. ${unmarked.join(' ')}`
          : Object.keys(issues).length > 0
            ? 'Review not saved. Fix the marked fields and try again.'
            : `Review not saved. ${
                err instanceof ApiError ? err.message : 'The server did not respond.'
              } Your entries are still in the form; try again.`,
      )
    }
  }

  return (
    <form
      className={styles.review}
      onSubmit={(event) => {
        void onSubmit(event)
      }}
      noValidate
    >
      <section className={styles.section}>
        <WeekSummary row={row} planWeek={planWeek} />
      </section>

      <section className={styles.section}>
        <Group label="Data status">
          <Segmented<DataStatus>
            label="Data status"
            options={DATA_OPTIONS}
            value={dataStatus}
            onChange={setDataStatus}
          />
        </Group>
        <Group label="Fatigue (1-10)">
          <Segmented
            label="Fatigue (1-10)"
            options={FATIGUE_OPTIONS}
            value={fatigue}
            onChange={setFatigue}
          />
        </Group>
        <Group label="Symptoms">
          <Segmented<Symptoms | ''>
            label="Symptoms"
            options={SYMPTOM_OPTIONS}
            value={symptoms}
            onChange={setSymptoms}
          />
        </Group>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={recoveryConstrained}
            onChange={(event) => {
              setRecoveryConstrained(event.target.checked)
            }}
          />
          Recovery is constrained
        </label>
      </section>

      {sessions.length > 0 ? <SessionSummaries sessions={sessions} /> : null}

      <section className={styles.section}>
        {suggestion ? (
          <section aria-labelledby={headingId} className={styles.suggestion}>
            <h2 id={headingId}>Suggested action</h2>
            <p className={styles.actionName}>{ACTION_NAMES[suggestion.action]}</p>
            <p>{suggestion.reason}</p>
            {suggestedMin !== null ? (
              <p className={styles.nextMin}>
                {`Suggested next week: ${String(suggestedMin)} min (${minutesToHours1(suggestedMin)} h)`}
              </p>
            ) : null}
            {isV2 ? (
              <>
                {review.signals !== undefined && review.signals.length > 0 ? (
                  <ul className={styles.signals} aria-label="Signals">
                    {review.signals.map((signal) => (
                      <li key={signal.code}>{localiseEngineText(signal.detail, units)}</li>
                    ))}
                  </ul>
                ) : null}
                <p className={styles.muted}>The suggestion updates when the review is saved.</p>
                <div>
                  <ExplainButton
                    subject="weekly decision"
                    rules={decisionRules(review.signals ?? [])}
                  />
                </div>
              </>
            ) : null}
          </section>
        ) : isV2 && planWeek ? (
          <p className={styles.muted}>The weekly decision is not ready yet.</p>
        ) : (
          <p className={styles.muted}>There is no plan for this week.</p>
        )}
        {hasPossibleDuplicates ? (
          <p>
            <Link to="/activities?duplicates=1">Review possible duplicates</Link>
          </p>
        ) : null}
      </section>

      <section className={styles.section}>
        <fieldset
          className={styles.decision}
          disabled={!finished}
          aria-describedby={finished ? undefined : noteId}
        >
          <Group label="Final decision">
            <Segmented<Decision | ''>
              label="Final decision"
              options={decisionOptions}
              value={finished && isDecision(shownDecision) ? shownDecision : ''}
              onChange={chooseDecision}
            />
          </Group>
          <Field label="Next week minutes" error={errors['finalNextMin']}>
            {(a) => (
              <Input
                {...a}
                type="text"
                inputMode="numeric"
                disabled={!finished}
                value={finished ? shownNextMin : ''}
                onChange={(event) => {
                  setNextMin(event.target.value)
                }}
              />
            )}
          </Field>
        </fieldset>
        {finished ? null : (
          <p id={noteId} className={styles.muted}>
            Final decision becomes available once the week is finished.
          </p>
        )}
        <Field label="Notes" error={errors['notes']}>
          {(a) => (
            <Textarea
              {...a}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value)
              }}
            />
          )}
        </Field>
        {failure !== null ? <p role="alert">{failure}</p> : null}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save review
          </Button>
        </div>
      </section>

      {replanned !== null ? (
        <section aria-labelledby={changedId} className={`${styles.section} ${styles.suggestion}`}>
          <h2 id={changedId}>What changed</h2>
          {replanned.revision !== null ? (
            <>
              <p>{replanned.revision.summary}</p>
              {replanned.revision.changes.length > 0 ? (
                <ul className={styles.signals}>
                  {replanned.revision.changes.map((change, index) => (
                    <li key={`${change.weekStart}-${change.field}-${String(index)}`}>
                      Week of {formatShortDate(change.weekStart)}:{' '}
                      {describeChange(change, units).text}
                    </li>
                  ))}
                </ul>
              ) : null}
              {changedRules.length > 0 ? (
                <div>
                  <ExplainButton subject="plan update" rules={changedRules} />
                </div>
              ) : null}
            </>
          ) : (
            <p>
              The review is saved. The plan was not re-planned: {replanned.error ?? 'try again.'}
            </p>
          )}
        </section>
      ) : null}
    </form>
  )
}

/** The rules behind a weekly decision: those its signals cite, else the decision rule itself. */
function decisionRules(signals: ReviewSignals): string[] {
  const rules = [...new Set(signals.flatMap((signal) => signal.rules))]
  return rules.length > 0 ? rules : ['J5']
}

function SessionSummaries({ sessions }: { sessions: PlanSession[] }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId}>Planned sessions</h2>
      <ul className={styles.sessions}>
        {sessions.map((session) => (
          <li key={session.id} className={styles.session}>
            <div className={styles.sessionHead}>
              <span className={styles.sessionDay}>{formatWeekday(session.date)}</span>
              <span className={styles.sessionTitle}>{session.title}</span>
              <span className={styles.muted}>{`${String(session.durationMin)} min`}</span>
              <span className={styles.sessionStatus}>{SESSION_STATUS_LABELS[session.status]}</span>
            </div>
            {/* The engine's lines already cover completion, intensity, effort and conditions. */}
            {session.execution?.lines.map((line, i) => (
              <p key={i} className={styles.sessionLine}>
                {line}
              </p>
            ))}
            {session.execution ? (
              <div>
                <ExplainButton subject={session.title} rules={session.rules} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Proposed zone changes. Zones change only when the runner accepts; the section stays mounted so the toast shows. */
function ZoneProposals() {
  const headingId = useId()
  const proposals = useZoneProposals()
  const settings = useSettings()
  const accept = useAcceptZoneProposal()
  const decline = useDeclineZoneProposal()
  const toast = useToast()
  const [failure, setFailure] = useState<string | null>(null)
  const units = settings.data?.units ?? 'mi'
  const busy = accept.isPending || decline.isPending

  async function decide(id: string, kind: 'accept' | 'decline') {
    setFailure(null)
    try {
      if (kind === 'accept') {
        await accept.mutateAsync(id)
        toast.show('Zones updated')
      } else {
        await decline.mutateAsync(id)
        toast.show('Proposal declined. Zones are unchanged.')
      }
    } catch (err) {
      setFailure(
        `Zone change not saved. ${err instanceof ApiError ? err.message : 'The server did not respond.'}`,
      )
    }
  }

  if (proposals.isError) return <p className={styles.muted}>Zone proposals did not load.</p>
  const list = proposals.data ?? []
  if (list.length === 0) return null

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId}>Zone proposals</h2>
      <p className={styles.muted}>
        Zones change only when you accept. Declining leaves them as they are.
      </p>
      <ul className={styles.proposals}>
        {list.map((proposal) => {
          const label = PROPOSAL_LABELS[proposal.boundary]
          return (
            <li key={proposal.id} className={styles.proposal}>
              <span className={styles.sessionTitle}>{label}</span>
              <span className={styles.nextMin}>
                {`${proposalValueText(proposal.boundary, proposal.from, units)} to ${proposalValueText(proposal.boundary, proposal.to, units)}`}
              </span>
              <p className={styles.sessionLine}>{proposal.reason}</p>
              <p className={styles.sessionLine}>
                {`Based on ${String(proposal.observations)} ${proposal.observations === 1 ? 'session' : 'sessions'}.`}
              </p>
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  disabled={busy}
                  aria-label={`Accept ${label} change`}
                  onClick={() => {
                    void decide(proposal.id, 'accept')
                  }}
                >
                  Accept
                </Button>
                <Button
                  disabled={busy}
                  aria-label={`Decline ${label} change`}
                  onClick={() => {
                    void decide(proposal.id, 'decline')
                  }}
                >
                  Decline
                </Button>
                <ExplainButton subject={`${label} change`} rules={proposal.rules} />
              </div>
            </li>
          )
        })}
      </ul>
      {failure !== null ? <p role="alert">{failure}</p> : null}
    </section>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.controlGroup}>
      <span className={styles.groupLabel} aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  )
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`
}

function WeekSummary({ row, planWeek }: { row: WeekRow; planWeek: PlanWeek | null }) {
  return (
    <div className={styles.summary}>
      {planWeek ? (
        <Meter valueMin={row.runMin} targetMin={planWeek.targetRunMin} label="Run time" />
      ) : (
        <p className={styles.runTime}>{`${minutesToHours1(row.runMin)} h run time`}</p>
      )}
      <ul className={styles.facts}>
        <li>
          {planWeek
            ? `${String(row.runDays)} of ${plural(planWeek.runDays, 'run day', 'run days')}`
            : plural(row.runDays, 'run day', 'run days')}
        </li>
        <li>
          {row.longRunShare === null
            ? 'No longest run to compare'
            : `Longest run is ${String(Math.round(row.longRunShare * 100))}% of the week`}
        </li>
        <li>
          {planWeek
            ? `${String(row.strengthSessions)} of ${plural(
                planWeek.strengthSessions,
                'strength session',
                'strength sessions',
              )}`
            : plural(row.strengthSessions, 'strength session', 'strength sessions')}
        </li>
      </ul>
    </div>
  )
}
