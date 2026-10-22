import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, daysBetween, mondayOf, todayIso } from '../../shared/dates.ts'
import { remainingPlan } from '../../shared/domain/adaptation.ts'
import type {
  Activity,
  Checkin,
  PlanSession,
  PlanSessionStatus,
  TodayView,
  Units,
  WeekRow,
} from '../../shared/types.ts'
import { formatDistance, formatDuration, formatPace, minutesToHours1 } from '../../shared/units.ts'
import { useActivities, useSaveFeedback } from '../api/activities.ts'
import { useSaveCheckin } from '../api/checkins.ts'
import { ApiError } from '../api/client.ts'
import { useGoals } from '../api/goals.ts'
import { usePlan } from '../api/plan.ts'
import { useReviews } from '../api/reviews.ts'
import { useSettings } from '../api/settings.ts'
import { useToday } from '../api/today.ts'
import { useWeeks } from '../api/weeks.ts'
import { Button } from '../components/Button.tsx'
import buttonStyles from '../components/Button.module.css'
import { WeeklyHoursChart } from '../components/charts/WeeklyHoursChart.tsx'
import { EmptyState } from '../components/EmptyState.tsx'
import { Input } from '../components/Field.tsx'
import { FeedbackFields, type FeedbackValues } from '../components/FeelPicker.tsx'
import {
  formatLongDate,
  formatShortDate,
  formatWeekday,
  weekPhaseLabel,
} from '../components/format.ts'
import { Meter } from '../components/Meter.tsx'
import { PageHeader } from '../components/PageHeader.tsx'
import { ScalePicker } from '../components/ScalePicker.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { useToast } from '../components/Toast.tsx'
import { WhyDrawer } from '../components/WhyDrawer.tsx'
import { TYPE_LABELS } from './ActivityForm.tsx'
import styles from './DashboardPage.module.css'

const STRIP_DAYS = 28
const CHART_WEEKS = 12
const ACTIVITY_DAYS = 90
const FEEDBACK_DAYS = 7

interface DayRun {
  date: string
  minutes: number
}

/** Run minutes per day for the `days` days ending on `today`; flagged duplicates do not count. */
function runMinutesPerDay(activities: Activity[], today: string, days: number): DayRun[] {
  const minutes = new Map<string, number>()
  const first = addDays(today, 1 - days)
  for (const a of activities) {
    if (a.type !== 'run' || a.date < first || a.date > today) continue
    if (a.duplicateStatus === 'possible' || a.duplicateStatus === 'confirmed') continue
    minutes.set(a.date, (minutes.get(a.date) ?? 0) + a.durationSec / 60)
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(first, i)
    return { date, minutes: Math.round(minutes.get(date) ?? 0) }
  })
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/** Runs and races from the last week that have neither an RPE nor a feel, newest first. */
function unratedRecent(activities: Activity[], today: string): Activity[] {
  const first = addDays(today, 1 - FEEDBACK_DAYS)
  return activities.filter(
    (a) =>
      (a.type === 'run' || a.type === 'race') &&
      a.date >= first &&
      a.date <= today &&
      a.rpe === null &&
      a.feel === null &&
      a.duplicateStatus !== 'possible' &&
      a.duplicateStatus !== 'confirmed',
  )
}

/** "Run Tue 17 Mar, 30:00, 5.00 km" for one unrated run. */
function activityLine(activity: Activity, units: Units): { type: string; rest: string } {
  const figures = [
    formatDuration(activity.durationSec),
    ...(activity.distanceM === null ? [] : [formatDistance(activity.distanceM, units)]),
  ].join(', ')
  return {
    type: TYPE_LABELS[activity.type],
    rest: ` ${formatWeekday(activity.date)} ${formatShortDate(activity.date)}, ${figures}`,
  }
}

function FeedbackItem({
  activity,
  units,
  onSaved,
}: {
  activity: Activity
  units: Units
  onSaved: () => void
}) {
  const save = useSaveFeedback(activity.id)
  // Starts from the saved pain so a save that only sets RPE or feel does not clear it.
  const [value, setValue] = useState<FeedbackValues>({ rpe: null, feel: null, pain: activity.pain })
  const touched = value.rpe !== null || value.feel !== null || value.pain !== activity.pain
  const line = activityLine(activity, units)

  return (
    <li className={styles.feedbackItem}>
      <p className={styles.feedbackTitle}>
        <span className={styles.feedbackType}>{line.type}</span>
        {line.rest}
      </p>
      <FeedbackFields value={value} onChange={setValue} />
      <div className={styles.feedbackActions}>
        <Button
          variant="primary"
          disabled={!touched}
          loading={save.isPending}
          onClick={() => {
            // The saved run drops out of the card, which unmounts this item before a mutate-level
            // onSuccess could fire. The promise settles anyway, and the page owns the toast.
            save.mutateAsync(value).then(onSaved, () => {
              // The error shows in the card; there is nothing more to do here.
            })
          }}
        >
          Save
        </Button>
      </div>
      {save.isError ? (
        <p role="alert" className={styles.feedbackError}>
          {`Feedback not saved. ${save.error instanceof ApiError ? save.error.message : 'Something went wrong.'} Try again.`}
        </p>
      ) : null}
    </li>
  )
}

/** An older unrated run: one line with a Rate button that opens its form. */
function FeedbackQueued({
  activity,
  units,
  onRate,
}: {
  activity: Activity
  units: Units
  onRate: () => void
}) {
  const line = activityLine(activity, units)
  return (
    <li className={styles.feedbackQueued}>
      <p className={styles.feedbackQueuedText}>
        <span className={styles.feedbackType}>{line.type}</span>
        {line.rest}
      </p>
      <Button
        variant="secondary"
        aria-label={`Rate ${line.type.toLowerCase()}${line.rest}`}
        onClick={onRate}
      >
        Rate
      </Button>
    </li>
  )
}

/**
 * The most recent unrated run in full; the others as a list with a Rate button that opens the
 * same form in place.
 */
function FeedbackCard({
  activities,
  units,
  onSaved,
}: {
  activities: Activity[]
  units: Units
  onSaved: () => void
}) {
  const headingId = useId()
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  if (activities.length === 0) return null
  const newestFirst = [...activities].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  )
  const [newest, ...older] = newestFirst
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        How did it go?
      </h2>
      <p className={styles.caption}>Recent runs without a rating. Rate any or all of it.</p>
      <ul className={styles.feedbackList}>
        {newest === undefined ? null : (
          <FeedbackItem key={newest.id} activity={newest} units={units} onSaved={onSaved} />
        )}
        {older.map((activity) =>
          opened.has(activity.id) ? (
            <FeedbackItem key={activity.id} activity={activity} units={units} onSaved={onSaved} />
          ) : (
            <FeedbackQueued
              key={activity.id}
              activity={activity}
              units={units}
              onRate={() => {
                setOpened(new Set([...opened, activity.id]))
              }}
            />
          ),
        )}
      </ul>
    </section>
  )
}

const STATUS_LABELS: Record<PlanSessionStatus, string | null> = {
  planned: null,
  completed: 'Completed',
  partial: 'Partly done',
  skipped: 'Skipped',
  downgraded: 'Adjusted',
  moved: 'Moved',
}

const ADVICE_LINES = {
  'as-planned': null,
  'downgrade-easy': 'An easy run is the better choice today.',
  rest: 'A rest day is the better choice today.',
} as const

const FEET_PER_METRE = 3.28084

/** "9:15 to 10:28 /mi" from sec/km bounds given slow to fast. */
function formatPaceRange(range: [number, number], units: Units): string {
  const [slow, fast] = range
  const bound = (secPerKm: number) => formatPace(secPerKm, 1000, units).split(' /')[0] ?? ''
  return `${bound(fast)} to ${bound(slow)} /${units}`
}

function climbText(gainM: number | null, units: Units): string | null {
  if (gainM === null || gainM <= 0) return null
  return units === 'mi'
    ? `${String(Math.round(gainM * FEET_PER_METRE))} ft`
    : `${String(Math.round(gainM))} m`
}

function sessionFigures(
  session: PlanSession,
  units: Units,
): Array<{ label: string; value: string }> {
  const { target } = session
  const figures: Array<{ label: string; value: string | null }> = [
    { label: 'Duration', value: `${String(session.durationMin)} min` },
    {
      label: 'Distance',
      value: session.distanceM === null ? null : formatDistance(session.distanceM, units),
    },
    { label: 'Climb', value: climbText(session.gainM, units) },
    {
      label: 'Pace',
      value: target.paceSecPerKm === null ? null : formatPaceRange(target.paceSecPerKm, units),
    },
    {
      label: 'Heart rate',
      value: target.hr === null ? null : `${String(target.hr[0])} to ${String(target.hr[1])} bpm`,
    },
    { label: 'Effort (RPE)', value: `${String(target.rpe[0])} to ${String(target.rpe[1])}` },
  ]
  return figures.flatMap((f) => (f.value === null ? [] : [{ label: f.label, value: f.value }]))
}

function SessionCard({
  entry,
  units,
  onWhy,
}: {
  entry: TodayView['sessions'][number]
  units: Units
  onWhy: (rules: string[]) => void
}) {
  const { session, advice, reasons } = entry
  const titleId = useId()
  const status = STATUS_LABELS[session.status]
  const adviceLine = ADVICE_LINES[advice]
  return (
    <article aria-labelledby={titleId} className={styles.sessionCard}>
      <div className={styles.sessionHead}>
        <h3 id={titleId} className={styles.sessionTitle}>
          {session.title}
        </h3>
        {status === null ? null : <span className={styles.sessionStatus}>{status}</span>}
      </div>
      <dl className={styles.figureList}>
        {sessionFigures(session, units).map((f) => (
          <div key={f.label} className={styles.figureItem}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {session.target.heatNote === null ? null : (
        <p className={styles.caption}>{session.target.heatNote}</p>
      )}
      <p className={styles.purpose}>{session.purpose}</p>
      {adviceLine === null ? null : (
        <div className={styles.advice}>
          <p className={styles.adviceLine}>{adviceLine}</p>
          {reasons.length > 0 ? (
            <ul className={styles.reasons}>
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <div className={styles.cardActions}>
        <Button
          variant="quiet"
          onClick={() => {
            onWhy(session.rules)
          }}
        >
          Why this session
        </Button>
      </div>
    </article>
  )
}

function SessionsSection({
  today,
  units,
  onWhy,
}: {
  today: TodayView
  units: Units
  onWhy: (rules: string[]) => void
}) {
  const headingId = useId()
  const { state } = today.readiness
  const readinessLine =
    state === 'possible-fatigue'
      ? 'Recent signals point to possible fatigue.'
      : state === 'persistent-suppression'
        ? 'Recent signals have stayed low for several days.'
        : null
  if (today.sessions.length === 0 && readinessLine === null) return null
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        {"Today's session"}
      </h2>
      {readinessLine === null ? null : (
        <p className={styles.readinessLine}>
          <span>{readinessLine}</span>
          <Button
            variant="quiet"
            onClick={() => {
              // J8 defines the fatigue states; J2 makes the check-in their primary input.
              onWhy(['j-2', 'j-8'])
            }}
          >
            Why this note
          </Button>
        </p>
      )}
      <div className={styles.sessionList}>
        {today.sessions.map((entry) => (
          <SessionCard key={entry.session.id} entry={entry} units={units} onWhy={onWhy} />
        ))}
      </div>
    </section>
  )
}

function HeatSection({
  heat,
  onWhy,
}: {
  heat: TodayView['heat']
  onWhy: (rules: string[]) => void
}) {
  const headingId = useId()
  if (heat.note === null && heat.wbgtC === null) return null
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        Heat
      </h2>
      {heat.note === null ? null : <p className={styles.purpose}>{heat.note}</p>}
      <p className={styles.counts}>
        {heat.wbgtC === null ? null : <span>{`WBGT ${heat.wbgtC.toFixed(1)} °C`}</span>}
        {heat.coolerHour === null ? null : <span>{`Cooler hour: ${heat.coolerHour}`}</span>}
      </p>
      <div className={styles.cardActions}>
        <Button
          variant="quiet"
          onClick={() => {
            onWhy(['i-7', 'i-9'])
          }}
        >
          Why this heat note
        </Button>
      </div>
    </section>
  )
}

function HealthNotes({
  flags,
  onWhy,
}: {
  flags: TodayView['readiness']['redFlags']
  onWhy: (rules: string[]) => void
}) {
  if (flags.length === 0) return null
  return (
    <section aria-label="Health notes" className={styles.notes}>
      <ul className={styles.noteList}>
        {flags.map((flag) => (
          <li key={flag.code} className={styles.note}>
            <p className={styles.noteText}>{flag.message}</p>
            <Button
              variant="quiet"
              onClick={() => {
                onWhy(flag.rules)
              }}
            >
              Why this note
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface CheckinDraft {
  fatigue: number | null
  soreness: number | null
  sleepQuality: number | null
  mood: number | null
  stress: number | null
  illness: boolean
  painScore: number | null
  painArea: string
  painFocalBone: boolean
}

function draftFrom(checkin: Checkin | null): CheckinDraft {
  return {
    fatigue: checkin?.fatigue ?? null,
    soreness: checkin?.soreness ?? null,
    sleepQuality: checkin?.sleepQuality ?? null,
    mood: checkin?.mood ?? null,
    stress: checkin?.stress ?? null,
    illness: checkin?.illness ?? false,
    painScore: checkin?.painScore ?? null,
    painArea: checkin?.painArea ?? '',
    painFocalBone: checkin?.painFocalBone ?? false,
  }
}

const CHECKIN_SCALES = [
  ['fatigue', 'Fatigue'],
  ['soreness', 'Soreness'],
  ['sleepQuality', 'Sleep quality'],
  ['mood', 'Mood'],
  ['stress', 'Stress'],
] as const

function CheckinCard({
  date,
  checkin,
  onSaved,
}: {
  date: string
  checkin: Checkin | null
  onSaved: (message: string) => void
}) {
  const headingId = useId()
  const save = useSaveCheckin()
  const initial = draftFrom(checkin)
  const [draft, setDraft] = useState<CheckinDraft>(initial)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const area = draft.painArea.trim()

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        Check-in
      </h2>
      <p className={styles.caption}>
        {checkin === null
          ? 'Optional. 1 to 5, where 3 is normal. These answers come first when the plan checks readiness.'
          : 'Saved for today. Change any answer and save again.'}
      </p>
      <div className={styles.checkinFields}>
        {CHECKIN_SCALES.map(([key, legend]) => (
          <ScalePicker
            key={key}
            legend={legend}
            min={1}
            max={5}
            value={draft[key]}
            onChange={(value) => {
              setDraft({ ...draft, [key]: value })
            }}
          />
        ))}
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={draft.illness}
            onChange={(event) => {
              setDraft({ ...draft, illness: event.target.checked })
            }}
          />
          Feeling ill
        </label>
        <ScalePicker
          legend="Pain today"
          min={0}
          max={10}
          value={draft.painScore}
          onChange={(painScore) => {
            setDraft({ ...draft, painScore })
          }}
          hint="0 is none, 10 is the worst."
        />
        <div className={styles.areaField}>
          <label htmlFor={`${headingId}-area`} className={styles.areaLabel}>
            Pain area
          </label>
          <Input
            id={`${headingId}-area`}
            value={draft.painArea}
            maxLength={80}
            onChange={(event) => {
              setDraft({ ...draft, painArea: event.target.value })
            }}
          />
        </div>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={draft.painFocalBone}
            onChange={(event) => {
              setDraft({ ...draft, painFocalBone: event.target.checked })
            }}
          />
          Point tenderness on a bone
        </label>
      </div>
      <div className={styles.feedbackActions}>
        <Button
          variant="primary"
          disabled={!dirty}
          loading={save.isPending}
          onClick={() => {
            save.mutate(
              {
                date,
                input: {
                  fatigue: draft.fatigue,
                  soreness: draft.soreness,
                  sleepQuality: draft.sleepQuality,
                  mood: draft.mood,
                  stress: draft.stress,
                  illness: draft.illness,
                  painScore: draft.painScore,
                  painArea: area === '' ? null : area,
                  painFocalBone: draft.painFocalBone,
                },
              },
              {
                onSuccess: () => {
                  onSaved('Check-in saved')
                },
              },
            )
          }}
        >
          Save check-in
        </Button>
      </div>
      {save.isError ? (
        <p role="alert" className={styles.feedbackError}>
          {`Check-in not saved. ${save.error instanceof ApiError ? save.error.message : 'Something went wrong.'} Try again.`}
        </p>
      ) : null}
    </section>
  )
}

function DisclaimerNote() {
  return (
    <section aria-label="Disclaimer" className={styles.section}>
      <p className={styles.caption}>
        This plan is a sketch built from published research on groups of runners and from
        conservative defaults where research is missing. It cannot guarantee safety or performance,
        and it is not medical, nutrition or injury advice. Stop and see a qualified clinician for
        pain, illness or warning signs.
      </p>
      <p className={styles.caption}>
        <Link to="/research">How the numbers are graded</Link>
      </p>
    </section>
  )
}

export function DashboardPage() {
  const today = todayIso()
  const thisWeek = mondayOf(today)
  const firstChartWeek = addDays(thisWeek, -7 * (CHART_WEEKS - 1))
  const weekRange = { from: firstChartWeek, to: thisWeek }

  const goals = useGoals()
  const plan = usePlan()
  const weeks = useWeeks(weekRange)
  const reviews = useReviews(weekRange)
  const activities = useActivities({ from: addDays(today, 1 - ACTIVITY_DAYS) })
  const settings = useSettings()
  const todayView = useToday()
  const toast = useToast()
  // One drawer for every "why" on the page; each button sets the rules it explains.
  const [whyRules, setWhyRules] = useState<string[] | null>(null)

  const queries = [goals, plan, weeks, reviews, activities, settings]
  const logActivity = (
    <Link to="/activities?new=1" className={`${buttonStyles.button} ${buttonStyles.primary}`}>
      Log activity
    </Link>
  )

  if (queries.some((q) => q.isError)) {
    return (
      <>
        <PageHeader title="Today" actions={logActivity} />
        <p role="alert">Today did not load. Reload the page to try again.</p>
      </>
    )
  }
  if (
    goals.data === undefined ||
    plan.data === undefined ||
    weeks.data === undefined ||
    reviews.data === undefined ||
    activities.data === undefined ||
    settings.data === undefined ||
    (todayView.data === undefined && !todayView.isError)
  ) {
    return (
      <>
        <PageHeader title="Today" actions={logActivity} />
        <Skeleton lines={5} />
      </>
    )
  }

  const units = settings.data.units
  const weekRows: WeekRow[] = weeks.data
  const currentRow = weekRows.find((w) => w.weekStart === thisWeek)
  const runMin = currentRow?.runMin ?? 0
  const runSessions = currentRow?.runSessions ?? 0

  const planWeeks = plan.data?.weeks ?? []
  const planIndex = planWeeks.findIndex((w) => w.weekStart === thisWeek)
  const planWeek = planIndex >= 0 ? planWeeks[planIndex] : undefined
  const planWeekStarts = new Set(planWeeks.map((w) => w.weekStart))

  // The plan belongs to one goal; "Make active" on another goal must not change its countdown.
  const goal =
    plan.data === null
      ? goals.data.find((g) => g.isActive)
      : goals.data.find((g) => g.id === plan.data?.goalId)
  const daysToRace = goal ? daysBetween(today, goal.targetDate) : null
  const showRace = goal !== undefined && daysToRace !== null && daysToRace >= 0
  const perDay =
    planWeek === undefined
      ? null
      : remainingPlan({
          today,
          weekStart: thisWeek,
          targetRunMin: planWeek.targetRunMin,
          runMinSoFar: runMin,
        })

  const context =
    planWeek === undefined
      ? `Week of ${formatShortDate(thisWeek)}`
      : `Week of ${formatShortDate(thisWeek)}, ${weekPhaseLabel(planWeek)}`

  const strip = runMinutesPerDay(activities.data, today, STRIP_DAYS)
  const stripRuns = activities.data.filter(
    (a) =>
      a.type === 'run' &&
      a.date > addDays(today, -STRIP_DAYS) &&
      a.date <= today &&
      a.duplicateStatus !== 'possible' &&
      a.duplicateStatus !== 'confirmed',
  )
  const stripDistanceM = stripRuns.reduce((sum, a) => sum + (a.distanceM ?? 0), 0)
  const stripPeak = Math.max(1, ...strip.map((d) => d.minutes))

  const possibleDuplicates = activities.data.filter((a) => a.duplicateStatus === 'possible').length
  const reviewByWeek = new Map(reviews.data.map((r) => [r.weekStart, r]))
  const pastUnconfirmed = weekRows.filter(
    (w) =>
      w.weekStart < thisWeek &&
      planWeekStarts.has(w.weekStart) &&
      reviewByWeek.get(w.weekStart)?.dataStatus !== 'complete',
  ).length
  const lastWeek = addDays(thisWeek, -7)
  const lastWeekHasData =
    planWeekStarts.has(lastWeek) ||
    (weekRows.find((w) => w.weekStart === lastWeek)?.runSessions ?? 0) > 0
  const lastWeekReady = lastWeekHasData && (reviewByWeek.get(lastWeek)?.reviewedAt ?? null) === null
  const hasFlags = possibleDuplicates > 0 || pastUnconfirmed > 0 || lastWeekReady

  return (
    <>
      <PageHeader title="Today" context={context} actions={logActivity} />

      {todayView.data === undefined ? (
        <p role="alert">
          {"Today's session and check-in did not load. Reload the page to try again."}
        </p>
      ) : (
        <HealthNotes flags={todayView.data.readiness.redFlags} onWhy={setWhyRules} />
      )}

      <section aria-label="This week" className={styles.hero}>
        <p className={styles.heroLine}>
          <span className={styles.display}>{minutesToHours1(runMin)}</span>
          <span className={styles.heroUnit}>
            {planWeek === undefined
              ? 'h run this week'
              : `h of ${minutesToHours1(planWeek.targetRunMin)} h target`}
          </span>
        </p>
        {planWeek === undefined ? null : (
          <>
            <Meter
              valueMin={runMin}
              targetMin={planWeek.targetRunMin}
              label="Run time this week"
              hideUnderCaption
            />
            <p className={styles.muted}>
              {`${weekPhaseLabel(planWeek)}, week ${String(planIndex + 1)} of ${String(planWeeks.length)}`}
            </p>
            <p className={styles.counts}>
              <span>
                {`${String(currentRow?.runDays ?? 0)} of ${String(planWeek.runDays)} ${plural(planWeek.runDays, 'run day', 'run days')}`}
              </span>
              <span>
                {`${String(currentRow?.strengthSessions ?? 0)} of ${String(planWeek.strengthSessions)} ${plural(planWeek.strengthSessions, 'strength session', 'strength sessions')}`}
              </span>
            </p>
          </>
        )}
        {runSessions === 0 ? (
          <p className={styles.muted}>No runs this week yet. Log one when you&apos;re out.</p>
        ) : null}
      </section>

      {todayView.data === undefined ? null : (
        <>
          <SessionsSection today={todayView.data} units={units} onWhy={setWhyRules} />
          <HeatSection heat={todayView.data.heat} onWhy={setWhyRules} />
          <CheckinCard
            key={todayView.data.date}
            date={todayView.data.date}
            checkin={todayView.data.checkin}
            onSaved={(message) => {
              toast.show(message)
            }}
          />
        </>
      )}

      <FeedbackCard
        activities={unratedRecent(activities.data, today)}
        units={units}
        onSaved={() => {
          toast.show('Feedback saved')
        }}
      />

      {showRace || perDay !== null ? (
        <section aria-label="Race and week ahead" className={styles.figures}>
          {goal && daysToRace !== null && showRace ? (
            <div className={styles.figure}>
              <p className={styles.figureLine}>
                {daysToRace === 0 ? (
                  <span className={styles.figureNumber}>Race day</span>
                ) : (
                  <>
                    <span className={styles.figureNumber}>{String(daysToRace)}</span>
                    {` ${plural(daysToRace, 'day', 'days')} to the race`}
                  </>
                )}
              </p>
              <p className={styles.caption}>
                {`${goal.name}, ${formatLongDate(goal.targetDate)}${goal.dateProvisional ? ', date provisional' : ''}`}
              </p>
            </div>
          ) : null}
          {perDay !== null && perDay.perDayMin !== null ? (
            <div className={styles.figure}>
              {perDay.remainingMin === 0 ? (
                <p className={styles.figureLine}>Nothing left to plan this week</p>
              ) : (
                <p className={styles.figureLine}>
                  <span className={styles.figureNumber}>{String(perDay.perDayMin)}</span>
                  {' min a day left, through Sunday'}
                </p>
              )}
              <p className={styles.caption}>advisory</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {plan.data === null ? (
        <section className={styles.section}>
          <EmptyState
            title="No plan yet. Choose a goal race, then generate weekly targets."
            action={
              <Link
                to={goal ? '/plan' : '/goals'}
                className={`${buttonStyles.button} ${buttonStyles.secondary}`}
              >
                {goal ? 'Generate a plan' : 'Choose a goal'}
              </Link>
            }
          />
        </section>
      ) : planWeek === undefined ? (
        <p className={styles.muted}>This week is outside the plan.</p>
      ) : null}

      {hasFlags ? (
        <section aria-label="Data health" className={styles.section}>
          <ul className={styles.flags}>
            {possibleDuplicates > 0 ? (
              <li>
                <Link to="/activities?duplicates=1">
                  {`${String(possibleDuplicates)} possible ${plural(possibleDuplicates, 'duplicate', 'duplicates')} to check`}
                </Link>
              </li>
            ) : null}
            {pastUnconfirmed > 0 ? (
              <li>
                <Link to="/review">
                  {`${String(pastUnconfirmed)} past ${plural(pastUnconfirmed, 'week', 'weeks')} without confirmed data`}
                </Link>
              </li>
            ) : null}
            {lastWeekReady ? (
              <li>
                <Link to="/review">Last week is ready to review.</Link>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {stripRuns.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.heading}>Last 28 days</h2>
          <div className={styles.strip} aria-hidden="true">
            {strip.map((day) => (
              <span
                key={day.date}
                className={day.minutes > 0 ? styles.bar : styles.barEmpty}
                style={{ height: `${String(Math.max(4, (day.minutes / stripPeak) * 100))}%` }}
              />
            ))}
          </div>
          <p className={styles.caption}>
            {`${String(stripRuns.length)} ${plural(stripRuns.length, 'run', 'runs')}, ${formatDistance(stripDistanceM, units)} in the last 28 days`}
          </p>
          <table className="visually-hidden">
            <caption>Run minutes per day, last 28 days</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Run minutes</th>
              </tr>
            </thead>
            <tbody>
              {strip.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{formatShortDate(day.date)}</th>
                  <td>{String(day.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {weekRows.some((w) => w.runMin > 0) ? (
        <section className={styles.section}>
          <h2 className={styles.heading}>Last 12 weeks</h2>
          <WeeklyHoursChart
            weeks={weekRows}
            planned={planWeeks.map((w) => ({
              weekStart: w.weekStart,
              targetRunMin: w.targetRunMin,
            }))}
            ariaLabel="Run hours per week, last 12 weeks"
          />
        </section>
      ) : null}

      <DisclaimerNote />
      <WhyDrawer
        rules={whyRules ?? []}
        open={whyRules !== null}
        onClose={() => {
          setWhyRules(null)
        }}
      />
    </>
  )
}
