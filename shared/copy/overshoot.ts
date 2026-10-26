// The words for a week run past its plan (rules g-2, g-6). The engine takes such a week as run and
// stores the minutes run as its target, with the planned minutes in the week's flags; a screen
// shows the plan as it was and the minutes run beside it, as a record. A target is a sketch, not a
// minimum, so nothing here grades the week: it states how far the minutes run lie over the plan.
//
// The figures arrive as minutes and are worded as hours with one decimal, as the Plan table and the
// week meter write them; the difference is worked out here, never on a page. No slot depends on
// the units, so any units give the same text.
import { minutesToHours1 } from '../units.ts'
import { render, tpl, type Template } from './template.ts'

export const OVERSHOOT_TEMPLATES = {
  // Beside the run figure of a week row: the planned figure is the row's target column.
  'overshoot.note': tpl('{over} over the plan', { over: 'text' }, { shape: 'label' }),
  // The caption of Today's week meter, whose tick is the planned figure.
  'overshoot.today': tpl(
    'Ran {ran} of {planned} planned, {over} over',
    { ran: 'text', planned: 'text', over: 'text' },
    { shape: 'label' },
  ),
  // The week editor, where the generated baseline would otherwise read as the raised target.
  'overshoot.planned': tpl(
    'Planned before the week was run: {planned}',
    { planned: 'text' },
    { shape: 'label' },
  ),
} satisfies Record<string, Template>

const STORED_UNITS = 'km'

const hours = (min: number): string => `${minutesToHours1(min)} h`

/**
 * The minutes run beyond the plan, whole minutes, or null when the week was not run past it (a
 * flag that outlives the minutes, such as a run removed since, says nothing).
 */
export function overshootMin(ranMin: number, plannedMin: number): number | null {
  const over = Math.round(ranMin - plannedMin)
  return over > 0 ? over : null
}

/** "1.1 h over the plan", or null when the minutes run do not lie over the plan. */
export function overshootNote(ranMin: number, plannedMin: number): string | null {
  const over = overshootMin(ranMin, plannedMin)
  if (over === null) return null
  return render(OVERSHOOT_TEMPLATES['overshoot.note'], { over: hours(over) }, STORED_UNITS)
}

/** "Ran 2.4 h of 1.3 h planned, 1.1 h over", or null when the minutes run do not lie over the plan. */
export function overshootTodayLine(ranMin: number, plannedMin: number): string | null {
  const over = overshootMin(ranMin, plannedMin)
  if (over === null) return null
  return render(
    OVERSHOOT_TEMPLATES['overshoot.today'],
    { ran: hours(ranMin), planned: hours(plannedMin), over: hours(over) },
    STORED_UNITS,
  )
}

/** "Planned before the week was run: 1.3 h (79 min)". */
export function plannedBaselineLine(plannedMin: number): string {
  return render(
    OVERSHOOT_TEMPLATES['overshoot.planned'],
    { planned: `${hours(plannedMin)} (${String(plannedMin)} min)` },
    STORED_UNITS,
  )
}
