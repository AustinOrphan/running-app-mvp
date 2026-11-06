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
  'activity-page.against-heading': tpl('Against the plan', {}, { shape: 'label' }),

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

  // No session is linked to the activity. When a session stands on its day the plan does not call
  // the activity that session's, so the line says that and not that nothing was planned.
  'activity-page.no-session-planned': tpl('No session was planned for this day.'),
  'activity-page.not-linked': tpl('This activity is not linked to a planned session.'),
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

/** The line for an activity that no session is linked to; `sessionOnDay` is whether the plan has one on its day. */
export function noLinkedSession(sessionOnDay: boolean, units: Units): string {
  return render(
    sessionOnDay ? T['activity-page.not-linked'] : T['activity-page.no-session-planned'],
    {},
    units,
  )
}

/** The heading of the block. */
export function againstThePlanHeading(units: Units): string {
  return render(T['activity-page.against-heading'], {}, units)
}
