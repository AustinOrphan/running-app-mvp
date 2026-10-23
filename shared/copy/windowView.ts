// The words a rest window is shown in while it is live (phase 3a design 9.6): the banner on Plan and
// Today, and the lines of the "Not 100%" preview that need a figure. `revision.ts` words what is
// stored with a window (its summary, the rule behind it, why a request is refused); everything here
// is worded when the window is shown, from the window's own dates and the Params.
//
// Ids are `window-view.<name>`; every template is spread into `TEMPLATES`, so the copy-lint test
// renders each one in both unit systems.
import { addDays } from '../dates.ts'
import type { DisruptionReason, DisruptionView, Units } from '../types.ts'
import { windowRuleFact } from './revision.ts'
import { render, tpl, type Template } from './template.ts'

export const WINDOW_VIEW_TEMPLATES = {
  // The banner: one line for the phase the window is in today.
  'window-view.banner.rest-illness': tpl('Resting for illness until {date}.', { date: 'date' }),
  'window-view.banner.rest-niggle': tpl('Resting for a niggle until {date}.', { date: 'date' }),
  'window-view.banner.rest-travel': tpl('No running while travelling until {date}.', {
    date: 'date',
  }),
  'window-view.banner.rest-short': tpl('No running while short on time until {date}.', {
    date: 'date',
  }),
  'window-view.banner.limited': tpl('{reason}: runs up to {max} until {date}.', {
    reason: 'text',
    max: 'minutes',
    date: 'date',
  }),
  'window-view.banner.gate': tpl('{free} first, then easy running from {date}.', {
    free: 'text',
    date: 'date',
  }),
  'window-view.banner.easy-only': tpl(
    'Easy running only until {until}. Hard sessions return on {date}.',
    { until: 'date', date: 'date' },
  ),
  'window-view.banner.returning': tpl('Return week: up to {max}.', { max: 'minutes' }),
  'window-view.banner.returning-open': tpl(
    'Return week: a gentler build back to the planned week.',
  ),
  'window-view.banner.upcoming': tpl('A window starts on {from} and lasts until {to}.', {
    from: 'date',
    to: 'date',
  }),

  // The preview of a window: the running time it changes, and what it cannot decide for the runner.
  'window-view.minutes-less': tpl(
    'Running time over the next four weeks: {before} becomes {after}. The minutes you rest are not added back.',
    { before: 'text', after: 'text' },
  ),
  'window-view.minutes-more': tpl(
    'Running time over the next four weeks: {before} becomes {after}.',
    {
      before: 'text',
      after: 'text',
    },
  ),
  'window-view.minutes-same': tpl('Running time over the next four weeks stays at {total}.', {
    total: 'text',
  }),
  'window-view.race-day': tpl(
    'The window includes race day. The plan keeps the race; whether to start is your decision.',
  ),

  // What the sheets say when a request does not go through as previewed.
  'window-view.stale': tpl('The plan changed while you were reading. This is the new preview.'),
  'window-view.offline': tpl('You are offline. Nothing was changed.'),
  'window-view.remove-instead': tpl('Remove this rest window instead', {}, { shape: 'label' }),
} satisfies Record<string, Template>

const t = WINDOW_VIEW_TEMPLATES

const day = (iso: string) => ({ kind: 'date', iso, style: 'weekday' }) as const
const mins = (min: number) => ({ kind: 'minutes', min }) as const

/** How a reason heads a banner line that has no sentence of its own: "Travelling: runs up to...". */
const REASON_WORDS: Record<DisruptionReason, string> = {
  'illness-above-neck': 'Ill',
  'illness-below-neck': 'Ill',
  niggle: 'Niggle',
  'short-on-time': 'Short on time',
  travel: 'Travelling',
}

/** The part of a window the banner reads: what `GET /api/plan/disruptions` serves for a date. */
export type BannerWindow = Pick<
  DisruptionView,
  | 'reason'
  | 'mode'
  | 'phase'
  | 'startDate'
  | 'endDate'
  | 'maxRunMin'
  | 'runFrom'
  | 'qualityFrom'
  | 'returnWeekMin'
>

/**
 * The one line the banner shows for a window in the phase it is in today, or an empty string for a
 * window that is over. The n-3 count of the symptom-free wait comes from the Params through the
 * rule sentence, so a Param change cannot leave the banner out of step.
 */
export function windowBannerLine(window: BannerWindow, units: Units): string {
  switch (window.phase) {
    case 'upcoming':
      return render(
        t['window-view.banner.upcoming'],
        { from: day(window.startDate), to: day(window.endDate) },
        units,
      )
    case 'resting':
      return restLine(window, units)
    case 'limited':
      if (window.mode === 'limited' && window.maxRunMin !== null) {
        return render(
          t['window-view.banner.limited'],
          {
            reason: REASON_WORDS[window.reason],
            max: mins(window.maxRunMin),
            date: day(window.endDate),
          },
          units,
        )
      }
      return restLine(window, units)
    case 'rest-gate':
      return render(
        t['window-view.banner.gate'],
        { free: symptomFreeWait(), date: day(window.runFrom) },
        units,
      )
    case 'easy-only':
      return render(
        t['window-view.banner.easy-only'],
        { until: day(addDays(window.qualityFrom, -1)), date: day(window.qualityFrom) },
        units,
      )
    case 'returning':
      return window.returnWeekMin === null
        ? render(t['window-view.banner.returning-open'], {}, units)
        : render(t['window-view.banner.returning'], { max: mins(window.returnWeekMin) }, units)
    case 'done':
      return ''
  }
}

function restLine(window: BannerWindow, units: Units): string {
  const date = { date: day(window.endDate) }
  switch (window.reason) {
    case 'illness-above-neck':
    case 'illness-below-neck':
      return render(t['window-view.banner.rest-illness'], date, units)
    case 'niggle':
      return render(t['window-view.banner.rest-niggle'], date, units)
    case 'travel':
      return render(t['window-view.banner.rest-travel'], date, units)
    case 'short-on-time':
      return render(t['window-view.banner.rest-short'], date, units)
  }
}

/** "One symptom-free day", from the n-3 Param. */
function symptomFreeWait(): string {
  const fact = windowRuleFact('illness-above-neck')
  const free = fact?.slots['free']
  const text = typeof free === 'string' ? free : 'A symptom-free day'
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/** "1,240 min": a total of minutes with a thousands separator, for a sum across weeks. */
export function totalMinutesText(min: number): string {
  return `${Math.round(min).toLocaleString('en-US')} min`
}

/**
 * The running-time line of a preview: the minutes the next four weeks hold now and after the
 * action. Only a line that shows minutes taken away says they are not added back; undoing or
 * shortening a window can give minutes back, and that line does not.
 */
export function runningTimeLine(figures: { before: number; after: number }, units: Units): string {
  if (figures.before === figures.after) {
    return render(t['window-view.minutes-same'], { total: totalMinutesText(figures.before) }, units)
  }
  const slots = {
    before: totalMinutesText(figures.before),
    after: totalMinutesText(figures.after),
  }
  return figures.after < figures.before
    ? render(t['window-view.minutes-less'], slots, units)
    : render(t['window-view.minutes-more'], slots, units)
}

/** The race-day warning of a preview: a window over the race day is allowed, and the runner decides. */
export function raceDayLine(units: Units): string {
  return render(t['window-view.race-day'], {}, units)
}

/** The sentence over a preview that replaced the one the runner was reading. */
export function stalePreviewLine(units: Units): string {
  return render(t['window-view.stale'], {}, units)
}

/** The sentence for a request that never reached the server. */
export function offlineLine(units: Units): string {
  return render(t['window-view.offline'], {}, units)
}

/** The button that removes a window when its undo is refused because the window changed since. */
export function removeInsteadLabel(units: Units): string {
  return render(t['window-view.remove-instead'], {}, units)
}
