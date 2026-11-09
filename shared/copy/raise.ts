// The words of the offer to raise the plan to match recent weeks (rule E7), on the weekly review. The
// offer asks and never decides: Raise applies a re-plan under the usual limits, Not now changes
// nothing. A target is a sketch, so nothing here grades the weeks or says what they should have been.
import { render, tpl, type Template } from './template.ts'

export const RAISE_TEMPLATES = {
  'raise.question': tpl('Your recent weeks were above plan. Raise the plan to match?'),
  // The figures: the first week the raise lifts, its target now and once raised, and the rise.
  'raise.figures': tpl(
    'From the week of {date}, the weekly target would be {raised} instead of {current}, {rise} more.',
    { date: 'date', raised: 'minutes', current: 'minutes', rise: 'minutes' },
  ),
  'raise.limits': tpl(
    'The usual weekly steps and limits still apply, and the change can be undone from the Plan page.',
  ),
  'raise.raise': tpl('Raise', {}, { shape: 'label' }),
  'raise.later': tpl('Not now', {}, { shape: 'label' }),
  'raise.done': tpl('Plan raised', {}, { shape: 'label' }),
  // The server refused: what the screen showed no longer stands, and nothing was written.
  'raise.stale-raise': tpl('The plan changed since this was shown; nothing was raised.'),
  'raise.stale-decline': tpl('The plan changed since this was shown; nothing was changed.'),
  'raise.declined': tpl('Plan left as it is', {}, { shape: 'label' }),
} satisfies Record<string, Template>

/** No slot depends on the units, so any units give the same text. */
const STORED_UNITS = 'km'

/** The figures sentence for an offer: "From the week of Mon 14 Dec, the weekly target would be ...". */
export function raiseFigures(offer: {
  fromWeek: string
  currentMin: number
  raisedMin: number
}): string {
  return render(
    RAISE_TEMPLATES['raise.figures'],
    {
      date: { kind: 'date', iso: offer.fromWeek, style: 'weekday' },
      raised: { kind: 'minutes', min: offer.raisedMin },
      current: { kind: 'minutes', min: offer.currentMin },
      rise: { kind: 'minutes', min: offer.raisedMin - offer.currentMin },
    },
    STORED_UNITS,
  )
}
