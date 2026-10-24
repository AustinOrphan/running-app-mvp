// Sentences about revisions, diffs and rest windows (phase 3a design, sections 4.2, 4.5 and 9.6).
// Ids are `<area>.<name>`; every template is spread into `TEMPLATES`, so the copy-lint test renders
// each one. This file holds two sets:
//
// - The window sentences (`window.*`): what a window does to the days around it, the rule behind
//   it and the reasons a request for one is refused. A figure that restates a rule number (the n-3
//   days, the window limits, the run-length range) comes from the Params.
// - The words of the revision log (`revision.*`, ADR 0007): the summary line of a revision and the
//   reason an undo is refused. The helpers fill a template from the figures of the stored diff or
//   write, never from free prose. A summary is stored with its revision, before anyone knows which
//   units the runner reads, so no slot there is a distance, a pace or a climb: dates, counts,
//   minutes and the session's own title read the same in kilometres and in miles.
import { addDays } from '../dates.ts'
import type { DisruptionIssue, DisruptionIssueCode, WindowPlan } from '../engine/disruption.ts'
import { RUN_CAP_MAX_MIN } from '../engine/disruption.ts'
import { P } from '../engine/params/index.ts'
import type { Quantity } from '../engine/types.ts'
import type { SafetyRule, UndoFinding } from '../engine/undoGuard.ts'
import type { ZoneBoundary } from '../engine/zoneChange.ts'
import type { DisruptionReason, UndoReason, Units } from '../types.ts'
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

  // The label of a window in a diff (`PlanDiff.holds`), like the title of a rest day.
  'window.label.rest': tpl('Rest: {reason}', { reason: 'text' }, { shape: 'label' }),
  'window.label.limited': tpl(
    'Runs up to {max}: {reason}',
    { max: 'minutes', reason: 'text' },
    { shape: 'label' },
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

  // The pass line of the plan check for windows: the days under a window that the plan keeps as the
  // window says. One day and several are two templates, as in the data-in-use sentences.
  'window.plan-check': tpl(
    '{days} days under rest windows hold: rest on the held days, runs within their caps, no hard work on easy days, and the return weeks within their share.',
    { days: 'count' },
  ),
  'window.plan-check-one': tpl(
    '1 day under a rest window holds: rest on the held day, a run within its cap, no hard work on an easy day, and the return weeks within their share.',
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

const count = (n: number) => ({ kind: 'count', n }) as const
const minutes = (min: number): Quantity => ({ kind: 'minutes', min })
const day = (iso: string) => ({ kind: 'date', iso, style: 'weekday' }) as const

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

/** The pass line of the plan check for windows, for the number of days a window rules. */
export function windowCheckLine(days: number): string {
  // a count reads the same in either unit system
  return days === 1
    ? render(WINDOW_TEMPLATES['window.plan-check-one'], {}, 'km')
    : render(WINDOW_TEMPLATES['window.plan-check'], { days: count(days) }, 'km')
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

/**
 * The guards of an owner edit of one session (`adjustCheck`): why a move, swap, shorten or skip is
 * refused or qualified, and the label of the one alternative that would work. Each message names
 * its rule where the rule limits the edit. Slots are dates, minutes, shares and the session's own
 * title, so the words read the same in kilometres and in miles.
 */
export const ADJUST_TEMPLATES = {
  // The session cannot be changed at all.
  'adjust.race-skip': tpl('The race day cannot be skipped.'),
  'adjust.race-stays': tpl('The race day stays where it is.'),
  'adjust.past': tpl('A session in the past stays as it was.'),
  'adjust.linked': tpl(
    'This session is linked to an activity, so it stays as it is. Unlink the activity first to change it.',
  ),
  'adjust.settled': tpl('This session is already done, so it stays as it is.'),
  'adjust.skipped': tpl('This session is skipped. Restore it before changing it.'),
  'adjust.not-shortenable': tpl('Only a run can be shortened.'),

  // A move or a swap that has nowhere to go.
  'adjust.other-week': tpl('A session moves within its own week. Re-plan to change weeks.'),
  'adjust.past-date': tpl('A session cannot move to a day that has passed.'),
  'adjust.no-partner': tpl(
    'There is no {title} left this week to swap with. A swap never adds a session or raises load.',
    { title: 'text' },
  ),
  'adjust.partner-unavailable': tpl(
    'That session cannot be swapped with. It must be in the same week, still to run and not linked to an activity.',
  ),

  // A shorten that is not one.
  'adjust.not-shorter': tpl(
    'Shortening only makes a session shorter. Nothing is added to it or to another day.',
  ),
  'adjust.below-minimum': tpl('A run under {min} is not worth scheduling. Skip it instead.', {
    min: 'minutes',
  }),
  'adjust.b2b-stays': tpl(
    '{title} is one day of a back-to-back pair, so it stays on its day (rule H3).',
    {
      title: 'text',
    },
  ),
  'adjust.b2b-day2': tpl('Day 2 of the pair would be longer than day 1 allows (rule H3).'),

  // The new arrangement breaks a limit.
  'adjust.closed-day': tpl('{date} is not a day you run, so {title} cannot go there.', {
    date: 'date',
    title: 'text',
  }),
  'adjust.day-limit': tpl('{title} is {minutes} and {date} allows {max}.', {
    title: 'text',
    minutes: 'minutes',
    date: 'date',
    max: 'minutes',
  }),
  'adjust.one-run': tpl(
    "{date} already has a run; one run a day keeps the week's spacing (rule F1).",
    { date: 'date' },
  ),
  'adjust.hard-spacing': tpl(
    '{title} next to {other} would leave no easy day between two hard sessions (rule F1).',
    { title: 'text', other: 'text' },
  ),
  'adjust.long-run-between': tpl(
    'The long run on {date} would sit between two quality days (rule F3).',
    { date: 'date' },
  ),
  'adjust.rest-window': tpl('Running is on hold on {date}, so {title} cannot go there (rule J9).', {
    date: 'date',
    title: 'text',
  }),
  'adjust.quiet-day': tpl(
    '{date} is for easy running only, so {title} cannot go there (rule J9).',
    {
      date: 'date',
      title: 'text',
    },
  ),
  'adjust.day-cap': tpl('Runs on {date} are held to {max}, and {title} is {minutes} (rule J9).', {
    date: 'date',
    max: 'minutes',
    title: 'text',
    minutes: 'minutes',
  }),
  'adjust.spike-warn': tpl(
    '{title} on {date} is above {limit} of the longest run of the last {days} days. Check that it feels right (rule G-1).',
    { title: 'text', date: 'date', limit: 'share', days: 'count' },
  ),
  'adjust.spike-block': tpl(
    '{title} on {date} would be above {limit} of the longest run of the last {days} days, so it stays as it is (rule G-1).',
    { title: 'text', date: 'date', limit: 'share', days: 'count' },
  ),
  'adjust.weekly-cap': tpl(
    'The week of {date} would hold {minutes} of running, above its {max} target (rules G-2, G-6).',
    { date: 'date', minutes: 'minutes', max: 'minutes' },
  ),

  // The label of the alternative a guard offers.
  'adjust.suggest.swap': tpl(
    'Swap with {title} {minutes} instead',
    { title: 'text', minutes: 'minutes' },
    { shape: 'label' },
  ),
  'adjust.suggest.restore': tpl('Restore it first', {}, { shape: 'label' }),
  'adjust.suggest.skip': tpl('Skip it instead', {}, { shape: 'label' }),
  'adjust.suggest.shorten': tpl(
    'Shorten it to {minutes} first',
    { minutes: 'minutes' },
    { shape: 'label' },
  ),
} satisfies Record<string, Template>

export type AdjustTemplateId = keyof typeof ADJUST_TEMPLATES

export const REVISION_TEMPLATES = {
  // The summary of a re-plan: how many week-level changes it made, then the weekly decision.
  'revision.changes.none': tpl('No changes to the plan.'),
  'revision.changes.one': tpl('1 change across 1 week.'),
  'revision.changes.one-week': tpl('{changes} changes across 1 week.', { changes: 'count' }),
  'revision.changes.many': tpl('{changes} changes across {weeks} weeks.', {
    changes: 'count',
    weeks: 'count',
  }),
  'revision.decision': tpl("Last week's decision: {decision}, next week up to {minutes}.", {
    decision: 'text',
    minutes: 'minutes',
  }),
  // Zero minutes is "no running set", not "up to 0 min".
  'revision.decision-bare': tpl("Last week's decision: {decision}.", { decision: 'text' }),

  // The summary of the owner's edit of one session.
  'revision.owner.skipped': tpl('Skipped {title} on {date}.', { title: 'text', date: 'date' }),
  'revision.owner.restored': tpl('Restored {title} on {date}.', { title: 'text', date: 'date' }),
  'revision.owner.moved': tpl('Moved {title} from {from} to {to}.', {
    title: 'text',
    from: 'date',
    to: 'date',
  }),
  'revision.owner.swapped': tpl('Swapped {title} on {date} with {other} on {otherDate}.', {
    title: 'text',
    date: 'date',
    other: 'text',
    otherDate: 'date',
  }),
  'revision.owner.shortened': tpl('Shortened {title} on {date} from {from} to {to}.', {
    title: 'text',
    date: 'date',
    from: 'minutes',
    to: 'minutes',
  }),

  // The summary of a change to a window (E5): added, changed or removed.
  'revision.window.created': tpl('Added a window ({reason}) from {from} to {to}.', {
    reason: 'text',
    from: 'date',
    to: 'date',
  }),
  'revision.window.updated': tpl('Changed the window ({reason}) to run from {from} to {to}.', {
    reason: 'text',
    from: 'date',
    to: 'date',
  }),
  'revision.window.removed': tpl('Removed the window ({reason}) from {from} to {to}.', {
    reason: 'text',
    from: 'date',
    to: 'date',
  }),

  // The summary of the owner's decision on a zone proposal. The proposed values are in the
  // revision's changes, which the page shows in the runner's units.
  'revision.zone.accepted': tpl('Accepted the proposed {boundary} on {date}.', {
    boundary: 'text',
    date: 'date',
  }),
  'revision.zone.declined': tpl('Declined the proposed {boundary} on {date}.', {
    boundary: 'text',
    date: 'date',
  }),

  // The summary of a new plan.
  'revision.generated': tpl('Plan generated for {goal}: {weeks} weeks, {sessions} sessions.', {
    goal: 'text',
    weeks: 'count',
    sessions: 'count',
  }),

  // The summary of a plan built for another goal (Make active) and of a restored plan.
  'revision.goal-switch': tpl(
    'Plan switched to {goal}: {weeks} weeks, {sessions} sessions.',
    { goal: 'text', weeks: 'count', sessions: 'count' },
    { fallback: 'Plan switched to another goal.' },
  ),
  'revision.plan-restored': tpl('Plan restored.'),

  // Why an undo is refused, for the reasons that need only the revision itself.
  'revision.undo.already-undone': tpl('This update was already undone.'),
  'revision.undo.is-undo': tpl('An undo cannot be undone.'),
  'revision.undo.not-undoable': tpl('This update has nothing to restore.'),
  'revision.undo.window-passed': tpl('The {days}-day window for undoing this update has passed.', {
    days: 'count',
  }),
  'revision.undo.plan-archived': tpl('This plan is archived, so its updates stay as they are.'),

  // Why an undo is refused, for the reasons that name a row, a rule or a check.
  'revision.undo.edited-since.session': tpl(
    '{title} on {date} changed after this update, so it cannot be restored.',
    { title: 'text', date: 'date' },
  ),
  'revision.undo.edited-since.week': tpl(
    'The week of {date} changed after this update, so it cannot be restored.',
    { date: 'date' },
  ),
  'revision.undo.edited-since.plan': tpl(
    'The plan changed after this update, so it cannot be restored.',
  ),
  'revision.undo.edited-since.window': tpl(
    'The window changed after this update, so it cannot be restored.',
  ),
  'revision.undo.session-run': tpl('A run is linked to {title} on {date}, so this update stays.', {
    title: 'text',
    date: 'date',
  }),
  'revision.undo.safety-rule': tpl(
    'This update followed a safety rule that still applies ({topics}), so it stays.',
    { topics: 'text' },
  ),
  // The ids of the checks that failed are machine ids: they travel in `items` and `details`, never
  // in a sentence.
  'revision.undo.checklist': tpl(
    'The earlier plan no longer meets the plan checks, so it cannot be restored.',
  ),

  // Why a new plan was not published (Generate, Regenerate, Make active and a re-plan).
  'revision.checklist-refused': tpl(
    'The plan did not pass the plan checks, so it was not published.',
  ),

  // The summary of an undo, and the answer to a preview that no longer matches the plan.
  'revision.undone': tpl('Undid: {summary}', { summary: 'text' }, { shape: 'label' }),
  'revision.stale-preview': tpl(
    'This preview is out of date. Review the new one before applying it.',
  ),
} satisfies Record<string, Template>

/** No slot of the revision templates depends on the units, so any units give the same text. */
const STORED_UNITS = 'km'

/** "3 changes across 2 weeks." for the week-level changes of a re-plan. */
export function changesSummary(changes: number, weeks: number): string {
  if (changes === 0) return render(REVISION_TEMPLATES['revision.changes.none'], {}, STORED_UNITS)
  if (weeks <= 1) {
    return changes === 1
      ? render(REVISION_TEMPLATES['revision.changes.one'], {}, STORED_UNITS)
      : render(
          REVISION_TEMPLATES['revision.changes.one-week'],
          { changes: count(changes) },
          STORED_UNITS,
        )
  }
  return render(
    REVISION_TEMPLATES['revision.changes.many'],
    { changes: count(changes), weeks: count(weeks) },
    STORED_UNITS,
  )
}

/** The weekly decision a re-plan acted on, and the target it set for the week after. */
export function decisionSummary(decision: string, nextWeekTargetMin: number): string {
  if (Math.round(nextWeekTargetMin) <= 0) {
    return render(REVISION_TEMPLATES['revision.decision-bare'], { decision }, STORED_UNITS)
  }
  return render(
    REVISION_TEMPLATES['revision.decision'],
    { decision, minutes: { kind: 'minutes', min: nextWeekTargetMin } },
    STORED_UNITS,
  )
}

export function skippedSummary(title: string, date: string): string {
  return render(
    REVISION_TEMPLATES['revision.owner.skipped'],
    { title, date: day(date) },
    STORED_UNITS,
  )
}

export function restoredSummary(title: string, date: string): string {
  return render(
    REVISION_TEMPLATES['revision.owner.restored'],
    { title, date: day(date) },
    STORED_UNITS,
  )
}

export function movedSummary(title: string, from: string, to: string): string {
  return render(
    REVISION_TEMPLATES['revision.owner.moved'],
    { title, from: day(from), to: day(to) },
    STORED_UNITS,
  )
}

export function swappedSummary(
  title: string,
  date: string,
  other: string,
  otherDate: string,
): string {
  return render(
    REVISION_TEMPLATES['revision.owner.swapped'],
    { title, date: day(date), other, otherDate: day(otherDate) },
    STORED_UNITS,
  )
}

export function shortenedSummary(
  title: string,
  date: string,
  fromMin: number,
  toMin: number,
): string {
  return render(
    REVISION_TEMPLATES['revision.owner.shortened'],
    {
      title,
      date: day(date),
      from: { kind: 'minutes', min: fromMin },
      to: { kind: 'minutes', min: toMin },
    },
    STORED_UNITS,
  )
}

/**
 * One sentence of the guards of an owner edit (`ADJUST_TEMPLATES`), filled from the figures the
 * guard found. The slots are checked against the template when it renders, as for a window fact.
 */
export function adjustText(
  id: AdjustTemplateId,
  slots: Record<string, Quantity | string> = {},
): string {
  const template: Template = ADJUST_TEMPLATES[id]
  return render(template, slots, STORED_UNITS)
}

/** The zone boundaries as the summary of a zone decision names them. */
export const ZONE_BOUNDARY_WORDS: Record<ZoneBoundary, string> = {
  cs: 'critical speed',
  lt1Pace: 'easy pace limit',
  thresholdPace: 'threshold pace',
  lt1Hr: 'easy heart rate limit',
  hrMax: 'maximum heart rate',
}

/** "Accepted the proposed threshold pace on Fri 23 Oct." */
export function acceptedZoneSummary(boundary: ZoneBoundary, date: string): string {
  return render(
    REVISION_TEMPLATES['revision.zone.accepted'],
    { boundary: ZONE_BOUNDARY_WORDS[boundary], date: day(date) },
    STORED_UNITS,
  )
}

/** "Declined the proposed threshold pace on Fri 23 Oct." */
export function declinedZoneSummary(boundary: ZoneBoundary, date: string): string {
  return render(
    REVISION_TEMPLATES['revision.zone.declined'],
    { boundary: ZONE_BOUNDARY_WORDS[boundary], date: day(date) },
    STORED_UNITS,
  )
}

export function generatedSummary(goal: string, weeks: number, sessions: number): string {
  return render(
    REVISION_TEMPLATES['revision.generated'],
    { goal, weeks: count(weeks), sessions: count(sessions) },
    STORED_UNITS,
  )
}

export function goalSwitchSummary(goal: string, weeks: number, sessions: number): string {
  return render(
    REVISION_TEMPLATES['revision.goal-switch'],
    { goal, weeks: count(weeks), sessions: count(sessions) },
    STORED_UNITS,
  )
}

export function planRestoredSummary(): string {
  return render(REVISION_TEMPLATES['revision.plan-restored'], {}, STORED_UNITS)
}

/** How a reason reads in the summary and the label of a window; no numbers. */
const REASON_WORDS: Record<DisruptionReason, string> = {
  'illness-above-neck': 'illness',
  'illness-below-neck': 'illness',
  niggle: 'niggle',
  'short-on-time': 'short on time',
  travel: 'travel',
}

/** What a revision did to a window. */
export type WindowChangeKind = 'created' | 'updated' | 'removed'

/** "Added a window (illness) from Wed 22 Oct to Fri 24 Oct." for the revision of a window action. */
export function windowRevisionSummary(
  kind: WindowChangeKind,
  window: { reason: DisruptionReason; startDate: string; endDate: string },
): string {
  const slots = {
    reason: REASON_WORDS[window.reason],
    from: day(window.startDate),
    to: day(window.endDate),
  }
  switch (kind) {
    case 'created':
      return render(REVISION_TEMPLATES['revision.window.created'], slots, STORED_UNITS)
    case 'updated':
      return render(REVISION_TEMPLATES['revision.window.updated'], slots, STORED_UNITS)
    case 'removed':
      return render(REVISION_TEMPLATES['revision.window.removed'], slots, STORED_UNITS)
  }
}

/** "Rest: illness" or "Runs up to 30 min: travel": the name of a window in a diff. */
export function windowHoldLabel(window: {
  reason: DisruptionReason
  mode: 'rest' | 'limited'
  maxRunMin: number | null
}): string {
  const reason = REASON_WORDS[window.reason]
  if (window.mode === 'limited' && window.maxRunMin !== null && window.maxRunMin > 0) {
    return render(
      WINDOW_TEMPLATES['window.label.limited'],
      { max: { kind: 'minutes', min: window.maxRunMin }, reason },
      STORED_UNITS,
    )
  }
  return render(WINDOW_TEMPLATES['window.label.rest'], { reason }, STORED_UNITS)
}

/**
 * The message of an undo reason that needs only the revision itself. The reasons that name a row,
 * a rule or a check are built by `describeUndoFinding`.
 */
export function undoReasonMessage(
  code: 'already-undone' | 'is-undo' | 'not-undoable' | 'plan-archived' | 'window-passed',
  undoWindowDays: number,
): string {
  switch (code) {
    case 'already-undone':
      return render(REVISION_TEMPLATES['revision.undo.already-undone'], {}, STORED_UNITS)
    case 'is-undo':
      return render(REVISION_TEMPLATES['revision.undo.is-undo'], {}, STORED_UNITS)
    case 'not-undoable':
      return render(REVISION_TEMPLATES['revision.undo.not-undoable'], {}, STORED_UNITS)
    case 'plan-archived':
      return render(REVISION_TEMPLATES['revision.undo.plan-archived'], {}, STORED_UNITS)
    case 'window-passed':
      return render(
        REVISION_TEMPLATES['revision.undo.window-passed'],
        { days: count(undoWindowDays) },
        STORED_UNITS,
      )
  }
}

/** What each safety rule is about, in the words of a sentence. */
const SAFETY_TOPICS: Record<SafetyRule, string> = {
  'n-1': 'bone pain',
  'n-2': 'pain',
  'n-3': 'illness',
  'n-4': 'energy availability',
}

/** "illness", "pain and illness", "bone pain, pain and illness". */
function topicsOf(rules: readonly string[]): string {
  const topics = rules.map((rule) => SAFETY_TOPICS[rule as SafetyRule] ?? rule)
  if (topics.length <= 1) return topics.join('')
  return `${topics.slice(0, -1).join(', ')} and ${topics[topics.length - 1]!}`
}

/**
 * A refusal of the undo as the API serves it: the finding's code, the row or rules it names and a
 * sentence. A refusal that names a row without its words (a session that no longer exists) gets
 * the plain sentence.
 */
export function describeUndoFinding(finding: UndoFinding, undoWindowDays: number): UndoReason {
  const { code } = finding
  const reason = (message: string): UndoReason => ({
    code,
    message,
    ...(finding.sessionId === undefined ? {} : { sessionId: finding.sessionId }),
    ...(finding.weekStart === undefined ? {} : { weekStart: finding.weekStart }),
    ...(finding.disruptionId === undefined ? {} : { disruptionId: finding.disruptionId }),
    ...(finding.rules === undefined ? {} : { rules: finding.rules }),
    ...(finding.items === undefined ? {} : { items: finding.items }),
  })
  const plain = () =>
    reason(render(REVISION_TEMPLATES['revision.undo.edited-since.plan'], {}, STORED_UNITS))
  switch (code) {
    case 'already-undone':
    case 'is-undo':
    case 'not-undoable':
    case 'plan-archived':
    case 'window-passed':
      return reason(undoReasonMessage(code, undoWindowDays))
    case 'edited-since':
      if (finding.title !== undefined && finding.date !== undefined) {
        return reason(
          render(
            REVISION_TEMPLATES['revision.undo.edited-since.session'],
            { title: finding.title, date: day(finding.date) },
            STORED_UNITS,
          ),
        )
      }
      if (finding.sessionId === undefined && finding.weekStart !== undefined) {
        return reason(
          render(
            REVISION_TEMPLATES['revision.undo.edited-since.week'],
            { date: day(finding.weekStart) },
            STORED_UNITS,
          ),
        )
      }
      if (finding.disruptionId !== undefined) {
        return reason(
          render(REVISION_TEMPLATES['revision.undo.edited-since.window'], {}, STORED_UNITS),
        )
      }
      return plain()
    case 'session-run':
      if (finding.title === undefined || finding.date === undefined) return plain()
      return reason(
        render(
          REVISION_TEMPLATES['revision.undo.session-run'],
          { title: finding.title, date: day(finding.date) },
          STORED_UNITS,
        ),
      )
    case 'safety-rule':
      return reason(
        render(
          REVISION_TEMPLATES['revision.undo.safety-rule'],
          { topics: topicsOf(finding.rules ?? []) },
          STORED_UNITS,
        ),
      )
    case 'checklist':
      return reason(render(REVISION_TEMPLATES['revision.undo.checklist'], {}, STORED_UNITS))
  }
}

/** The summary of an undo: the summary of the update it reverted. */
export function undoneSummary(reverted: string): string {
  return render(REVISION_TEMPLATES['revision.undone'], { summary: reverted }, STORED_UNITS)
}

/** The sentence of the 422 that refuses a plan the quality checklist blocks. */
export function checklistRefusedMessage(): string {
  return render(REVISION_TEMPLATES['revision.checklist-refused'], {}, STORED_UNITS)
}

/** The sentence of a 409 that asks the caller to look at the preview again. */
export function stalePreviewMessage(): string {
  return render(REVISION_TEMPLATES['revision.stale-preview'], {}, STORED_UNITS)
}
