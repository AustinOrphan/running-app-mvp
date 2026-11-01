// The words a rest window is shown in while it is live (phase 3a design 9.6): the banner on Plan and
// Today, and the lines of the "Not 100%" preview that need a figure. `revision.ts` words what is
// stored with a window (its summary, the rule behind it, why a request is refused); everything here
// is worded when the window is shown, from the window's own dates and the Params.
//
// Ids are `window-view.<name>`; every template is spread into `TEMPLATES`, so the copy-lint test
// renders each one in both unit systems.
import { addDays } from '../dates.ts'
import type { DisruptionReason, DisruptionView, Units } from '../types.ts'
import { P } from '../engine/params/index.ts'
import { countPhrase, sameWeekHours } from './quantity.ts'
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
  'window-view.banner.returning': tpl('Return week: up to {max}.', { max: 'weekMinutes' }),
  'window-view.banner.returning-open': tpl(
    'Return week: a gentler build back to the planned week.',
  ),
  'window-view.banner.upcoming': tpl('A window starts on {from} and lasts until {to}.', {
    from: 'date',
    to: 'date',
  }),

  // Today's offer after a check-in that reports illness or pain, when no window is in effect: one
  // question and two answers. It creates nothing; "Set one up" opens the "Not 100%" sheet.
  'window-view.prompt.ask': tpl('Set a rest window and a return plan?'),
  'window-view.prompt.yes': tpl('Set one up', {}, { shape: 'label' }),
  'window-view.prompt.later': tpl('Not now', {}, { shape: 'label' }),

  // The entry to the same sheet from the "Not today" sheet, for a runner who is not 100% today.
  'window-view.entry.label': tpl('Not 100%', {}, { shape: 'label' }),
  'window-view.entry.hint': tpl('Tell the plan if you are ill, hurt, short on time or travelling.'),

  // The hint under the last day of a window, by what the window is for: the last day the runner
  // feels it or is away, and what the plan adds after it. An illness has a symptom-free wait and
  // easy days after it (rule n-3), a niggle only easy days (rule j9) and a trip or a busy spell none.
  'window-view.until.illness': tpl(
    'The last day you feel it. The plan adds {free} and {easy} after it.',
    { free: 'text', easy: 'text' },
  ),
  'window-view.until.niggle': tpl('The last day you feel it. The plan adds {easy} after it.', {
    easy: 'text',
  }),
  'window-view.until.travel': tpl('The last day you are away.'),
  'window-view.until.short': tpl('The last day you are short on time.'),
  'window-view.until.change-later': tpl('You can change it later.'),

  // The preview of a window: the running time it changes, and what it cannot decide for the runner.
  'window-view.minutes-less': tpl(
    'Running time over the next four weeks: {before} becomes {after}. The minutes you rest are not added back.',
    { before: 'weekMinutes', after: 'weekMinutes' },
  ),
  'window-view.minutes-more': tpl(
    'Running time over the next four weeks: {before} becomes {after}.',
    {
      before: 'weekMinutes',
      after: 'weekMinutes',
    },
  ),
  'window-view.minutes-same': tpl('Running time over the next four weeks stays at {total}.', {
    total: 'weekMinutes',
  }),
  'window-view.race-day': tpl(
    'The window includes race day. The plan keeps the race; whether to start is your decision.',
  ),

  // The banner's button that ends a window yesterday, and the sheet it opens. The runner of a
  // window for ill health says they are better; any other window ends early.
  'window-view.better.label-health': tpl("I'm better", {}, { shape: 'label' }),
  'window-view.better.label-other': tpl('Finish early', {}, { shape: 'label' }),
  'window-view.better.intro-health': tpl(
    'The window ends yesterday. The return is sized from the days you rested.',
  ),
  'window-view.better.intro-other': tpl('The window ends yesterday. The plan picks up from today.'),

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

/**
 * The hint under the "Until" date of a window of this reason: the last day it is felt or lasts, and
 * what the plan adds after it, with the counts from the n-3 and j9 Params. `changeLater` adds that
 * the date can be changed, for the sheet that creates the window.
 */
export function untilHint(
  reason: DisruptionReason,
  units: Units,
  options: { changeLater?: boolean } = {},
): string {
  const say = (text: string): string =>
    options.changeLater === true ? `${text} ${later(units)}` : text
  switch (reason) {
    case 'illness-above-neck':
    case 'illness-below-neck': {
      const fact = windowRuleFact(reason)
      const free =
        typeof fact?.slots['free'] === 'string' ? fact.slots['free'] : 'one symptom-free day'
      const easy = typeof fact?.slots['easy'] === 'string' ? fact.slots['easy'] : 'three easy days'
      // "one symptom-free day" reads "a symptom-free day" in a sentence
      return say(
        render(t['window-view.until.illness'], { free: free.replace(/^one /, 'a '), easy }, units),
      )
    }
    case 'niggle':
      return say(
        render(
          t['window-view.until.niggle'],
          { easy: countPhrase(P.j9.niggleEasyDays.value, 'easy day') },
          units,
        ),
      )
    case 'travel':
      return say(render(t['window-view.until.travel'], {}, units))
    case 'short-on-time':
      return say(render(t['window-view.until.short'], {}, units))
  }
}

const later = (units: Units): string => render(t['window-view.until.change-later'], {}, units)

/** "One symptom-free day", from the n-3 Param. */
function symptomFreeWait(): string {
  const fact = windowRuleFact('illness-above-neck')
  const free = fact?.slots['free']
  const text = typeof free === 'string' ? free : 'A symptom-free day'
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/**
 * The running-time line of a preview: the time the next four weeks hold now and after the action,
 * as hours ("20.3 h becomes 17.4 h"), the unit of a week's total. Only a line that shows time taken
 * away says it is not added back; undoing or shortening a window can give time back, and that
 * line does not.
 */
export function runningTimeLine(figures: { before: number; after: number }, units: Units): string {
  // Totals that read the same at 0.1 h (120 and 119 minutes) are "stays at", not "2.0 h becomes 2.0 h".
  if (figures.before === figures.after || sameWeekHours(figures.before, figures.after)) {
    return render(t['window-view.minutes-same'], { total: mins(figures.after) }, units)
  }
  const slots = { before: mins(figures.before), after: mins(figures.after) }
  return figures.after < figures.before
    ? render(t['window-view.minutes-less'], slots, units)
    : render(t['window-view.minutes-more'], slots, units)
}

/** The race-day warning of a preview: a window over the race day is allowed, and the runner decides. */
export function raceDayLine(units: Units): string {
  return render(t['window-view.race-day'], {}, units)
}

/** A window for ill health: an illness or a niggle. The runner of one is "better", not finished. */
export function isHealthWindow(reason: DisruptionReason): boolean {
  return reason === 'illness-above-neck' || reason === 'illness-below-neck' || reason === 'niggle'
}

/**
 * The words of the action that ends a window yesterday: `title` is both the banner's button and the
 * title of the sheet it opens (the same words, so the dialog is named for the button that opened
 * it), and `intro` is the sentence under the title. Keyed on the window's reason by
 * `isHealthWindow`.
 */
export function betterWords(
  reason: DisruptionReason,
  units: Units,
): { title: string; intro: string } {
  const health = isHealthWindow(reason)
  const title = t[health ? 'window-view.better.label-health' : 'window-view.better.label-other']
  const intro = t[health ? 'window-view.better.intro-health' : 'window-view.better.intro-other']
  return { title: render(title, {}, units), intro: render(intro, {}, units) }
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

/** Today's offer of a rest window: the question, and the answers that open the sheet or wait. */
export function restPromptWords(units: Units): { ask: string; yes: string; later: string } {
  return {
    ask: render(t['window-view.prompt.ask'], {}, units),
    yes: render(t['window-view.prompt.yes'], {}, units),
    later: render(t['window-view.prompt.later'], {}, units),
  }
}

/** The "Not 100%" entry of the "Not today" sheet: its button and the line under it. */
export function notFullEntryWords(units: Units): { label: string; hint: string } {
  return {
    label: render(t['window-view.entry.label'], {}, units),
    hint: render(t['window-view.entry.hint'], {}, units),
  }
}
