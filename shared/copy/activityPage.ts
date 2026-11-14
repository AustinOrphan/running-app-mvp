// The sentences of the activity page that no engine writes (UX critique of 2026-11-01, batch 2):
// the heading and the context line of the "Against the plan" block, and the two lines for a
// run that fills no planned session. The assessment lines under them are the engine's own
// (`shared/copy/execution.ts`, written by the server from the stored facts); only these frame them.
//
// A run's figures here read in the runner's units, which is why they are not `execution.*`
// templates: those are built by `shared/engine/execution.ts`, stored as facts and written in
// kilometres (their words state minutes, percentages and counts only), and a test requires the
// engine to reach every one of them.
//
// The context line states figures and what they are set against and grades nothing: "Planned"
// and "Ran" are two facts side by side, and the share and the effort come from the assessment.
import type { Activity, Units } from '../types.ts'
import { render, tpl, type Template } from './template.ts'

export const ACTIVITY_PAGE_TEMPLATES = {
  // Under "How did it go?" when the stored effort rating came from the watch (WR1).
  'activity-page.rpe-from-watch': tpl(
    'The effort rating is from your watch. A rating you give here replaces it.',
  ),
  'activity-page.against-heading': tpl('Against the plan', {}, { shape: 'label' }),

  // The labels of the paces in the summary. The pace the page leads with is the elapsed one, from
  // `durationSec`; a moving time that differs adds a moving pace beside it, and then the first
  // says which it is. Without a moving pace there is only one, and it is "Pace".
  'activity-page.pace': tpl('Pace', {}, { shape: 'label' }),
  'activity-page.elapsed-pace': tpl('Elapsed pace', {}, { shape: 'label' }),
  'activity-page.moving-pace': tpl('Moving pace', {}, { shape: 'label' }),

  // The line over a run's assessment: the session it filled and what the run was. A run with a
  // distance names it; a run without one, and an activity that is not a run, name the time only.
  'activity-page.planned-ran': tpl(
    'Planned: {session}, {planned}. Ran: {actual}, {distance}.',
    { session: 'text', planned: 'minutes', actual: 'duration', distance: 'distance' },
    { fallback: 'This run filled a planned session.' },
  ),
  'activity-page.planned-ran-no-distance': tpl(
    'Planned: {session}, {planned}. Ran: {actual}.',
    { session: 'text', planned: 'minutes', actual: 'duration' },
    { fallback: 'This run filled a planned session.' },
  ),
  'activity-page.planned-did': tpl(
    'Planned: {session}, {planned}. Did: {actual}.',
    { session: 'text', planned: 'minutes', actual: 'duration' },
    { fallback: 'This activity filled a planned session.' },
  ),

  // No session is linked to the activity. Both lines are about the current plan, the only one the
  // page reads: a session of an archived plan (after a goal switch or a new plan) is not looked for,
  // so the lines do not say that nothing was planned. When a session of the current plan stands on
  // the day, the line says the activity is not that session's, and not that nothing was planned.
  'activity-page.no-session-planned': tpl(
    'No session of the current plan was planned for this day.',
  ),
  'activity-page.not-linked': tpl('This activity is not linked to a session of the current plan.'),
  'activity-page.no-plan': tpl('There is no current plan to set this activity against.'),

  // The plan could not be read, so the block cannot say what it is set against. It says that, as
  // "What stood out" does for its own failed load, and states nothing about the plan.
  'activity-page.plan-not-loaded': tpl(
    'The plan could not be loaded, so this activity is not set against it. Reload the page to try again.',
  ),
} satisfies Record<string, Template>

const T = ACTIVITY_PAGE_TEMPLATES

/** The session of a plan as the context line reads it. */
export interface PlannedSessionBrief {
  title: string
  durationMin: number
}

/** The activity as the context line reads it. */
export type RanActivityBrief = Pick<Activity, 'type' | 'durationSec' | 'distanceM'>

/**
 * "Planned: Long run, 2 h 55 min. Ran: 3 h 5 min, 17.5 mi.": the session an activity filled and the
 * activity, in the runner's units. A run or a race with a distance states it; any other activity,
 * and a run with none, states its time only.
 */
export function plannedAgainstRan(
  session: PlannedSessionBrief,
  activity: RanActivityBrief,
  units: Units,
): string {
  const base = {
    session: session.title,
    planned: { kind: 'minutes', min: session.durationMin },
    actual: { kind: 'duration', sec: activity.durationSec },
  } as const
  if (activity.type !== 'run' && activity.type !== 'race') {
    return render(T['activity-page.planned-did'], base, units)
  }
  if (activity.distanceM === null || activity.distanceM <= 0) {
    return render(T['activity-page.planned-ran-no-distance'], base, units)
  }
  return render(
    T['activity-page.planned-ran'],
    { ...base, distance: { kind: 'distance', m: activity.distanceM } },
    units,
  )
}

/**
 * What the plan has on the day of an activity no session is linked to: no plan at all, no session
 * on the day, or a session of the current plan that is not this activity's.
 */
export type PlanOnTheDay = 'no-plan' | 'no-session' | 'other-session'

/** The line for an activity that no session is linked to. */
export function noLinkedSession(onTheDay: PlanOnTheDay, units: Units): string {
  const id = {
    'no-plan': 'activity-page.no-plan',
    'no-session': 'activity-page.no-session-planned',
    'other-session': 'activity-page.not-linked',
  } as const
  return render(T[id[onTheDay]], {}, units)
}

/** The heading of the block. */
export function againstThePlanHeading(units: Units): string {
  return render(T['activity-page.against-heading'], {}, units)
}

/**
 * The label of the elapsed pace: "Pace" alone, or "Elapsed pace" when the moving pace leads and this
 * one stands second, so the two are told apart.
 */
export function paceLabel(movingPaceShown: boolean, units: Units): string {
  return render(T[movingPaceShown ? 'activity-page.elapsed-pace' : 'activity-page.pace'], {}, units)
}

/** The label of the moving pace, which leads when it differs from the elapsed one. */
export function movingPaceLabel(units: Units): string {
  return render(T['activity-page.moving-pace'], {}, units)
}

/** The line for a plan that could not be read. */
export function planNotLoaded(units: Units): string {
  return render(T['activity-page.plan-not-loaded'], {}, units)
}
