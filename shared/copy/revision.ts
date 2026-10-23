// Sentences about revisions, diffs and rest windows (phase 3a design, sections 4.5 and 9.6). Ids are
// `<area>.<name>`; every template is spread into `TEMPLATES`, so the copy-lint test renders each one.
// This file holds the window sentences (`window.*`): what a window does to the days around it, the
// rule behind it and the reasons a request for one is refused. A figure that restates a rule
// number (the n-3 days, the window limits, the run-length range) comes from the Params.
import { addDays } from '../dates.ts'
import type { DisruptionIssue, DisruptionIssueCode, WindowPlan } from '../engine/disruption.ts'
import { RUN_CAP_MAX_MIN } from '../engine/disruption.ts'
import { P } from '../engine/params/index.ts'
import type { Quantity } from '../engine/types.ts'
import type { DisruptionReason, Units } from '../types.ts'
import { render, tpl, type Template } from './template.ts'

export const WINDOW_TEMPLATES = {
  // What a window does to the days around it, in order.
  'window.rest': tpl('Rest from {from} to {to}.', { from: 'date', to: 'date' }),
  'window.rest-day': tpl('Rest on {date}.', { date: 'date' }),
  'window.limited': tpl('Runs up to {max} from {from} to {to}.', {
    max: 'minutes',
    from: 'date',
    to: 'date',
  }),
  'window.limited-day': tpl('Runs up to {max} on {date}.', { max: 'minutes', date: 'date' }),
  'window.easy-only': tpl('Easy running only from {from} to {to}.', { from: 'date', to: 'date' }),
  'window.easy-only-day': tpl('Easy running only on {date}.', { date: 'date' }),
  'window.back': tpl('Back to the planned week on {date}.', { date: 'date' }),
  'window.restart': tpl(
    'After {days} days without running, the first two weeks back are held to {share} of the week before.',
    { days: 'count', share: 'share' },
  ),

  // The rule behind a window.
  'window.rule-illness': tpl(
    'Running waits until you have had {free}, then {easy} before any hard session.',
    { free: 'text', easy: 'text' },
  ),
  'window.rule-niggle': tpl(
    'There is no symptom-free wait after a niggle. Easy running only for {easy}, then hard sessions return.',
    { easy: 'text' },
  ),

  // Why a request for a window is refused.
  'window.issue.start-invalid': tpl('The first day is not a valid date.'),
  'window.issue.end-invalid': tpl('The last day is not a valid date.'),
  'window.issue.end-before-start': tpl('The last day cannot come before the first day.'),
  'window.issue.too-long': tpl('A window can last up to {days} days.', { days: 'count' }),
  'window.issue.start-too-old': tpl('A window can start up to {days} days ago.', {
    days: 'count',
  }),
  'window.issue.end-after-goal': tpl('A window cannot end after the race.'),
  'window.issue.illness-rest-only': tpl(
    'Illness is rest only. Easy running follows once symptoms have passed.',
  ),
  'window.issue.cap-required': tpl('Choose the longest run for a day.'),
  'window.issue.cap-out-of-range': tpl('The longest run can be {min} to {max}.', {
    min: 'minutes',
    max: 'minutes',
  }),
  'window.issue.cap-on-rest': tpl('A window with no running has no run length.'),
  'window.issue.niggle-only': tpl(
    'Area, pain and a change in how you walk or run apply to a niggle only.',
  ),
  'window.issue.pain-out-of-range': tpl('Pain is a whole number from 0 to 10.'),
} satisfies Record<string, Template>

export type WindowTemplateId = keyof typeof WINDOW_TEMPLATES

/** A window sentence as stored data: a template id and its slots (`renderFact` writes the words). */
export interface WindowFact {
  template: WindowTemplateId
  slots: Record<string, Quantity | string>
}

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]

/** "one symptom-free day", "3 easy days": a count in words up to ten, then in digits. */
function countPhrase(n: number, noun: string): string {
  const word =
    Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n]! : String(n)
  return `${word} ${noun}${n === 1 ? '' : 's'}`
}

const count = (n: number): Quantity => ({ kind: 'count', n })
const minutes = (min: number): Quantity => ({ kind: 'minutes', min })
const day = (iso: string): Quantity => ({ kind: 'date', iso, style: 'weekday' })

/**
 * What a window does to the days around it, as facts in the order the runner meets them: the rest
 * days (an illness includes the symptom-free wait), the capped runs, easy running only, the day
 * the planned week returns, and the restart after a long hold.
 */
export function windowFacts(window: WindowPlan): WindowFact[] {
  const facts: WindowFact[] = []
  if (window.restThrough !== null) {
    facts.push(
      window.startDate === window.restThrough
        ? { template: 'window.rest-day', slots: { date: day(window.startDate) } }
        : {
            template: 'window.rest',
            slots: { from: day(window.startDate), to: day(window.restThrough) },
          },
    )
  } else if (window.maxRunMin !== null) {
    facts.push(
      window.startDate === window.endDate
        ? {
            template: 'window.limited-day',
            slots: { max: minutes(window.maxRunMin), date: day(window.startDate) },
          }
        : {
            template: 'window.limited',
            slots: {
              max: minutes(window.maxRunMin),
              from: day(window.startDate),
              to: day(window.endDate),
            },
          },
    )
  }
  if (window.easyThrough !== null) {
    const from = addDays(window.restThrough ?? window.endDate, 1)
    if (from <= window.easyThrough) {
      facts.push(
        from === window.easyThrough
          ? { template: 'window.easy-only-day', slots: { date: day(from) } }
          : {
              template: 'window.easy-only',
              slots: { from: day(from), to: day(window.easyThrough) },
            },
      )
    }
  }
  const last = [window.endDate, window.restThrough, window.easyThrough].reduce<string>(
    (latest, date) => (date !== null && date > latest ? date : latest),
    window.endDate,
  )
  facts.push({ template: 'window.back', slots: { date: day(addDays(last, 1)) } })
  if (window.restart !== null && window.restart.fraction < 1) {
    facts.push({
      template: 'window.restart',
      slots: {
        days: count(window.restart.layoffDays),
        share: { kind: 'share', fraction: window.restart.fraction },
      },
    })
  }
  return facts
}

/** One fact in the runner's units. */
function renderWindowFact(fact: WindowFact, units: Units): string {
  const template: Template = WINDOW_TEMPLATES[fact.template]
  return render(template, fact.slots, units)
}

/** The sentences of `windowFacts` in the runner's units. */
export function describeWindow(window: WindowPlan, units: Units): string[] {
  return windowFacts(window).map((fact) => renderWindowFact(fact, units))
}

/**
 * The rule behind a reason, with its counts from the Params: the n-3 wait for illness, the easy
 * days after a niggle. Short on time and travel have none.
 */
export function windowRuleFact(reason: DisruptionReason): WindowFact | null {
  if (reason === 'illness-above-neck' || reason === 'illness-below-neck') {
    return {
      template: 'window.rule-illness',
      slots: {
        free: countPhrase(P.n3.illnessSymptomFreeDays.value, 'symptom-free day'),
        easy: countPhrase(P.n3.illnessEasyDaysBeforeIntensity.value, 'easy day'),
      },
    }
  }
  if (reason === 'niggle') {
    return {
      template: 'window.rule-niggle',
      slots: { easy: countPhrase(P.j9.niggleEasyDays.value, 'day') },
    }
  }
  return null
}

const ISSUE_TEMPLATES = {
  'start-invalid': 'window.issue.start-invalid',
  'end-invalid': 'window.issue.end-invalid',
  'end-before-start': 'window.issue.end-before-start',
  'too-long': 'window.issue.too-long',
  'start-too-old': 'window.issue.start-too-old',
  'end-after-goal': 'window.issue.end-after-goal',
  'illness-rest-only': 'window.issue.illness-rest-only',
  'cap-required': 'window.issue.cap-required',
  'cap-out-of-range': 'window.issue.cap-out-of-range',
  'cap-on-rest': 'window.issue.cap-on-rest',
  'niggle-only': 'window.issue.niggle-only',
  'pain-out-of-range': 'window.issue.pain-out-of-range',
} as const satisfies Record<DisruptionIssueCode, WindowTemplateId>

/** The reason a request was refused, as a fact; the limits it names come from the Params. */
export function issueFact(issue: DisruptionIssue): WindowFact {
  const template = ISSUE_TEMPLATES[issue.code]
  switch (issue.code) {
    case 'too-long':
      return { template, slots: { days: count(P.j9.maxWindowDays.value) } }
    case 'start-too-old':
      return { template, slots: { days: count(P.j9.maxBackdateDays.value) } }
    case 'cap-out-of-range':
      return {
        template,
        slots: { min: minutes(P.fplace.easyRunMinMin.value), max: minutes(RUN_CAP_MAX_MIN) },
      }
    default:
      return { template, slots: {} }
  }
}

/** The sentence for a refused request, in the runner's units. */
export function describeIssue(issue: DisruptionIssue, units: Units): string {
  return renderWindowFact(issueFact(issue), units)
}
