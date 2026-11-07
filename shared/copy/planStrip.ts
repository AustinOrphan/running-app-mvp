// The strip under the Plan header for a few days after the Monday update, and the mark on the days
// it changed. The words are here so the lint test renders every one; the page picks the template
// from the count and fills the weekday.
import { render, tpl } from './template.ts'
import type { Units } from '../types.ts'

export const PLAN_STRIP_TEMPLATES = {
  'plan.strip.one': tpl('Updated {day}: one session changed.', { day: 'text' }),
  'plan.strip.many': tpl('Updated {day}: {n} sessions changed.', { day: 'text', n: 'count' }),
  'plan.strip.weeks': tpl('Updated {day}: the running time of the weeks ahead changed.', {
    day: 'text',
  }),
  'plan.strip.brief': tpl('See the brief', {}, { shape: 'label' }),
  'plan.strip.label': tpl('The latest plan update', {}, { shape: 'label' }),
  'plan.strip.changed-mark': tpl('Changed', {}, { shape: 'label' }),
} as const

/** The sentence of the strip for an update that changed `sessions` sessions on `day` (a weekday name). */
export function planStripSentence(day: string, sessions: number, units: Units): string {
  if (sessions <= 0) return render(PLAN_STRIP_TEMPLATES['plan.strip.weeks'], { day }, units)
  if (sessions === 1) return render(PLAN_STRIP_TEMPLATES['plan.strip.one'], { day }, units)
  return render(
    PLAN_STRIP_TEMPLATES['plan.strip.many'],
    { day, n: { kind: 'count', n: sessions } },
    units,
  )
}

export function planStripText(
  id: 'plan.strip.brief' | 'plan.strip.label' | 'plan.strip.changed-mark',
  units: Units,
): string {
  return render(PLAN_STRIP_TEMPLATES[id], {}, units)
}
