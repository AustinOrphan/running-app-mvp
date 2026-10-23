// The sentences of "Make active" and "Restore this plan" (phase 3a design, 5.4 and 5.7): the
// confirm that names what a new plan does to the current one, the note under a goal whose plan was
// archived, the toasts, and the reasons an archived plan cannot come back. The server answers 409
// with the same words, so both sides read from the templates below, spread into `TEMPLATES`.
import type { Units } from '../types.ts'
import { render, tpl, type Template } from './template.ts'

export const GOALS_TEMPLATES = {
  // The confirm that opens when a version-2 plan follows another goal.
  'goals.activate.follows': tpl(
    'The plan follows {current}. Making {next} active builds a new plan for it.',
    { current: 'text', next: 'text' },
    {
      fallback: 'The plan follows another goal. Making this goal active builds a new plan for it.',
    },
  ),
  'goals.activate.archived': tpl(
    'The current plan is archived, not deleted, and targets you set by hand do not carry over.',
  ),
  'goals.activate.build': tpl(
    'Build plan for {goal}',
    { goal: 'text' },
    { shape: 'label', fallback: 'Build plan' },
  ),
  'goals.activate.built': tpl(
    'Plan built for {goal}.',
    { goal: 'text' },
    { fallback: 'The new plan is ready.' },
  ),

  // The note under a goal whose plan was archived, and what restoring it says.
  'goals.restore.note': tpl(
    'The plan for {goal} was archived on {date}.',
    { goal: 'text', date: 'date' },
    { fallback: 'An earlier plan for this goal was archived.' },
  ),
  'goals.restore.button': tpl('Restore this plan', {}, { shape: 'label' }),
  'goals.restore.done': tpl('Plan restored.'),
  'goals.restore.not-updated': tpl(
    'Plan restored as it was archived. Bringing it up to date did not pass the plan checks.',
  ),

  // Why an archived plan cannot be restored.
  'goals.restore.goal-closed': tpl(
    'The goal is finished or dropped, so its plan cannot be restored.',
  ),
  'goals.restore.date-passed': tpl('The race date has passed, so this plan cannot be restored.'),
  'goals.restore.old-plan': tpl(
    'This plan was made by an earlier version of the app, so it cannot be restored.',
  ),
  'goals.restore.already-active': tpl('This plan is already the active plan.'),
} satisfies Record<string, Template>

const T = GOALS_TEMPLATES

/** Names, counts and dates read the same in either unit system. */
const UNITS: Units = 'km'

/** Why an archived plan cannot be restored. */
export type RestoreBlock = 'goal-closed' | 'date-passed' | 'old-plan'

/** The sentence for a plan that cannot be restored. */
export function restoreBlockText(block: RestoreBlock | 'already-active'): string {
  switch (block) {
    case 'goal-closed':
      return render(T['goals.restore.goal-closed'], {}, UNITS)
    case 'date-passed':
      return render(T['goals.restore.date-passed'], {}, UNITS)
    case 'old-plan':
      return render(T['goals.restore.old-plan'], {}, UNITS)
    case 'already-active':
      return render(T['goals.restore.already-active'], {}, UNITS)
  }
}

/** "The plan follows <current>. Making <next> active builds a new plan for it." */
export function activateFollowsText(current: string, next: string): string {
  return render(T['goals.activate.follows'], { current, next }, UNITS)
}

/** The sentence about what happens to the current plan; the same for every goal. */
export const ACTIVATE_ARCHIVED_TEXT = render(T['goals.activate.archived'], {}, UNITS)

export function activateBuildLabel(goal: string): string {
  return render(T['goals.activate.build'], { goal }, UNITS)
}

export function activateBuiltText(goal: string): string {
  return render(T['goals.activate.built'], { goal }, UNITS)
}

/** "The plan for <goal> was archived on 22 Oct." for the day (YYYY-MM-DD) it was archived. */
export function restoreNoteText(goal: string, archivedOn: string): string {
  return render(T['goals.restore.note'], { goal, date: { kind: 'date', iso: archivedOn } }, UNITS)
}

export const RESTORE_BUTTON_LABEL = render(T['goals.restore.button'], {}, UNITS)
export const RESTORE_DONE_TEXT = render(T['goals.restore.done'], {}, UNITS)
export const RESTORE_NOT_UPDATED_TEXT = render(T['goals.restore.not-updated'], {}, UNITS)
