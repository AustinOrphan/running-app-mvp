import { useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { useActivities } from '../api/activities.ts'
import { useGoals } from '../api/goals.ts'
import { usePlan } from '../api/plan.ts'
import { useReviews } from '../api/reviews.ts'
import { useSettings } from '../api/settings.ts'
import { useToday } from '../api/today.ts'
import { useWeeks } from '../api/weeks.ts'
import buttonStyles from '../components/Button.module.css'
import { formatShortDate, weekPhaseLabel } from '../components/format.ts'
import { PageHeader } from '../components/PageHeader.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { CheckinCard } from '../components/today/CheckinCard.tsx'
import { DataHealth } from '../components/today/DataHealth.tsx'
import { DisclaimerNote } from '../components/today/DisclaimerNote.tsx'
import { FeedbackCard } from '../components/today/FeedbackCard.tsx'
import { HealthNotes } from '../components/today/HealthNotes.tsx'
import { HeatSection } from '../components/today/HeatSection.tsx'
import { PlanNotice } from '../components/today/PlanNotice.tsx'
import { RaceFigures } from '../components/today/RaceFigures.tsx'
import { RecentStrip } from '../components/today/RecentStrip.tsx'
import { RecentWeeks } from '../components/today/RecentWeeks.tsx'
import { SessionsSection } from '../components/today/SessionsSection.tsx'
import { TodaySlot } from '../components/today/TodaySlot.tsx'
import { WeekHero } from '../components/today/WeekHero.tsx'
import { useToast } from '../components/Toast.tsx'
import { WhyDrawer } from '../components/WhyDrawer.tsx'

const CHART_WEEKS = 12
const ACTIVITY_DAYS = 90

/** Today: fetches the page's data and lays out the sections in `components/today/`. */
export function DashboardPage() {
  const today = todayIso()
  const thisWeek = mondayOf(today)
  const weekRange = { from: addDays(thisWeek, -7 * (CHART_WEEKS - 1)), to: thisWeek }

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
  const currentRow = weeks.data.find((w) => w.weekStart === thisWeek)
  const planWeeks = plan.data?.weeks ?? []
  const planIndex = planWeeks.findIndex((w) => w.weekStart === thisWeek)
  const planWeek = planIndex >= 0 ? planWeeks[planIndex] : undefined
  // The plan belongs to one goal; "Make active" on another goal must not change its countdown.
  const goal =
    plan.data === null
      ? goals.data.find((g) => g.isActive)
      : goals.data.find((g) => g.id === plan.data?.goalId)

  const context =
    planWeek === undefined
      ? `Week of ${formatShortDate(thisWeek)}`
      : `Week of ${formatShortDate(thisWeek)}, ${weekPhaseLabel(planWeek)}`

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
      <TodaySlot name="disruption" />

      <WeekHero
        currentRow={currentRow}
        planWeek={planWeek}
        planIndex={planIndex}
        planWeekCount={planWeeks.length}
      />

      {todayView.data === undefined ? null : (
        <>
          <SessionsSection today={todayView.data} units={units} onWhy={setWhyRules} />
          <HeatSection heat={todayView.data.heat} onWhy={setWhyRules} />
          <CheckinCard
            key={todayView.data.date}
            date={todayView.data.date}
            checkin={todayView.data.checkin}
            boneActive={todayView.data.readiness.redFlags.some(
              (flag) => flag.code === 'focal-bone-pain',
            )}
            onSaved={(message) => {
              toast.show(message)
            }}
          />
        </>
      )}

      <TodaySlot name="brief" />
      <TodaySlot name="fuelPrompt" />

      <FeedbackCard
        activities={activities.data}
        today={today}
        units={units}
        onSaved={() => {
          toast.show('Feedback saved')
        }}
      />

      <RaceFigures
        today={today}
        weekStart={thisWeek}
        goal={goal}
        planWeek={planWeek}
        currentRow={currentRow}
      />
      <PlanNotice
        hasPlan={plan.data !== null}
        weekInPlan={planWeek !== undefined}
        hasGoal={goal !== undefined}
      />
      <DataHealth
        activities={activities.data}
        weeks={weeks.data}
        reviews={reviews.data}
        planWeeks={planWeeks}
        thisWeek={thisWeek}
      />
      <RecentStrip activities={activities.data} today={today} units={units} />
      <RecentWeeks weeks={weeks.data} planWeeks={planWeeks} />
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
