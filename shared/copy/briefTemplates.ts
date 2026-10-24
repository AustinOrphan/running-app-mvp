// The sentences of the Monday brief (phase 3a design 8.5 and 8.6): what the last week was, what the
// weekly update did, what the plan noticed, the next key session and the line Today shows. They are
// spread into `TEMPLATES`, so the copy-lint test renders every one.
//
// A stored brief holds template ids, codes and slot values, never a sentence (`BriefFacts`), and
// `briefRender.ts` writes the words when the brief is read, in the runner's units. So an id that a
// stored brief may hold is never renamed and never changes meaning, and no slot is free text apart
// from the runner's own name for a goal: wording that varies (quicker or slower, one change or
// several) is a template of its own.
//
// Tone (rule G5): last week is a figure, not a score. Nothing here says a week fell short, counts
// days in a row or names a shortfall; a lighter week is "eased", a reduction is "easier".
import type { BriefReplanCode, SessionKind } from '../engine/types.ts'
import { tpl, type Template } from './template.ts'

export const BRIEF_TEMPLATES = {
  // The page and its states.
  'brief.title': tpl('Weekly brief', {}, { shape: 'label' }),
  'brief.week-of': tpl('Week of {week}', { week: 'date' }, { shape: 'label' }),
  'brief.heading-changed': tpl('What changed and why', {}, { shape: 'label' }),
  'brief.heading-noticed': tpl('What the plan noticed', {}, { shape: 'label' }),
  'brief.heading-key': tpl('Next key session', {}, { shape: 'label' }),
  'brief.heading-since': tpl('Since this brief', {}, { shape: 'label' }),
  'brief.open': tpl('Open the brief', {}, { shape: 'label' }),
  'brief.earlier': tpl('Earlier brief', {}, { shape: 'label' }),
  'brief.later': tpl('Later brief', {}, { shape: 'label' }),
  'brief.loading': tpl('Loading the brief.'),
  'brief.error': tpl('The brief could not be loaded. Reload the page to try again.'),
  'brief.no-plan': tpl(
    'There is no plan yet, so there is no brief. A brief arrives each Monday once a plan is active.',
  ),
  'brief.none': tpl(
    'There is no brief for the week of {week}.',
    { week: 'date' },
    { fallback: 'There is no brief for that week.' },
  ),
  'brief.not-yet': tpl(
    'The brief for the week of {week} is not ready yet.',
    { week: 'date' },
    { fallback: 'That brief is not ready yet.' },
  ),
  'brief.since-none': tpl('Nothing has changed since this brief.'),

  // Last week, and what the weekly decision made of it.
  'brief.last-week-ran-of': tpl('Last week you ran {actual} of {planned} planned minutes.', {
    actual: 'count',
    planned: 'count',
  }),
  'brief.last-week-ran': tpl('Last week you ran {actual}.', { actual: 'minutes' }),
  'brief.last-week-none': tpl('No running was logged last week.'),
  'brief.decision-progress': tpl('The plan moves on: next week is up to {minutes}.', {
    minutes: 'minutes',
  }),
  'brief.decision-hold': tpl('The plan holds steady: next week is up to {minutes}.', {
    minutes: 'minutes',
  }),
  'brief.decision-reduce': tpl('The plan eases: next week is up to {minutes}.', {
    minutes: 'minutes',
  }),
  'brief.decision-post-race': tpl(
    'The weeks after your race follow a set return schedule: next week is up to {minutes}.',
    { minutes: 'minutes' },
  ),
  // The same four when the suggested minutes are zero (a week with nothing run before it, a week
  // held by a rest window): "up to 0 min" would read as a plan with nothing in it.
  'brief.decision-progress-bare': tpl('The plan moves on to next week.'),
  'brief.decision-hold-bare': tpl('The plan holds steady for next week.'),
  'brief.decision-reduce-bare': tpl('The plan eases next week.'),
  'brief.decision-post-race-bare': tpl('The weeks after your race follow a set return schedule.'),

  // The goal race.
  'brief.countdown-weeks': tpl('Weeks until {name}: {n}.', { name: 'text', n: 'count' }),
  'brief.countdown-days': tpl('Days until {name}: {n}.', { name: 'text', n: 'count' }),
  'brief.countdown-today': tpl('{name} is today.', { name: 'text' }),

  // The finish estimate, once there are two weekly estimates to set side by side.
  'brief.prediction-same': tpl('The finish estimate is about {likely}, the same as a week ago.', {
    likely: 'duration',
  }),
  'brief.prediction-quicker': tpl(
    'The finish estimate is about {likely}, {delta} quicker than a week ago.',
    { likely: 'duration', delta: 'duration' },
  ),
  'brief.prediction-slower': tpl(
    'The finish estimate is about {likely}, {delta} slower than a week ago.',
    { likely: 'duration', delta: 'duration' },
  ),

  // What changed and why. Each cause is the sentence of `cause.*` in `revisionView.ts`.
  'brief.changes-none': tpl('The plan did not change this week.'),
  'brief.changes-one': tpl('The weekly update changed one session.'),
  'brief.changes-many': tpl('The weekly update changed {n} sessions.', { n: 'count' }),
  'brief.changes-weeks': tpl('The weekly update adjusted the running time of the weeks ahead.'),
  'brief.provisional': tpl("The weekly update has not run yet. This brief reads today's plan."),
  // Why the weekly update wrote nothing. The brief says so and does not suggest the runner did
  // anything wrong; the plan stays as it was.
  'brief.replan-goal-passed': tpl(
    'The plan was not updated this week: the goal date has passed. Move the date or choose another goal.',
  ),
  'brief.replan-checklist': tpl(
    'The plan was not updated this week: the new plan did not meet the plan checks, so the current plan stays.',
  ),
  'brief.replan-no-plan': tpl('The plan was not updated this week: there is no active plan.'),
  'brief.replan-not-run': tpl('The plan was not updated this week: the weekly update did not run.'),
  'brief.replan-error': tpl(
    'The plan was not updated this week: the update could not finish, so the current plan stays.',
  ),

  // What the plan noticed. The figure and the day it rests on are slots; the sources are listed
  // beside the fact. Safety comes first, and no sentence grades the week.
  'brief.noticed-empty': tpl('Nothing stood out this week.'),
  'brief.noticed-pain-bone': tpl(
    'Focal bone pain was reported on {date}. Rest, and see the guidance on warning signs.',
    { date: 'date' },
  ),
  'brief.noticed-pain': tpl(
    'Pain of {pain} out of 10 was reported on {date}. See the guidance on warning signs before the next run.',
    { pain: 'count', date: 'date' },
  ),
  'brief.noticed-pain-mild': tpl(
    'Pain of {pain} out of 10 was reported on {date}. Volume holds until it settles.',
    { pain: 'count', date: 'date' },
  ),
  'brief.noticed-illness': tpl(
    'Illness was reported on {date}, which the weekly update takes into account.',
    { date: 'date' },
  ),
  'brief.noticed-reds': tpl(
    'The energy-availability screen showed {n} signs, so progression holds.',
    {
      n: 'count',
    },
  ),
  'brief.noticed-readiness-low': tpl(
    'Readiness signals stayed lower than usual for {days} days or more, so a lighter week may help.',
    { days: 'count' },
  ),
  'brief.noticed-readiness-flag': tpl(
    'A readiness flag was still active at the end of the week, so volume holds.',
  ),
  'brief.noticed-sleep': tpl(
    'Sleep averaged {hours} across {nights} recent nights, under {floor}.',
    {
      hours: 'duration',
      nights: 'count',
      floor: 'duration',
    },
  ),
  'brief.noticed-subjective': tpl(
    'Check-in scores or effort ratings pointed to a harder week than planned.',
  ),
  'brief.noticed-efficiency-down': tpl(
    'On steady runs you cover {pct} less ground per heartbeat than in the weeks before.',
    { pct: 'percent' },
  ),
  'brief.noticed-efficiency-up': tpl(
    'On steady runs you cover {pct} more ground per heartbeat than in the weeks before.',
    { pct: 'percent' },
  ),
  'brief.noticed-longest-distance': tpl(
    'Your {distance} run on {date} was the longest in the last {weeks} weeks.',
    { distance: 'distance', date: 'date', weeks: 'count' },
  ),
  'brief.noticed-longest-duration': tpl(
    'Your {duration} run on {date} was the longest by time in the last {weeks} weeks.',
    { duration: 'duration', date: 'date', weeks: 'count' },
  ),
  'brief.noticed-race-week': tpl('This is race week. Race day is {date}.', { date: 'date' }),
  'brief.noticed-taper': tpl('The taper begins this week, with up to {minutes} of running.', {
    minutes: 'minutes',
  }),
  'brief.noticed-recovery-week': tpl('This is a recovery week, with up to {minutes} of running.', {
    minutes: 'minutes',
  }),

  // The next key session.
  'brief.key-session': tpl(
    '{day}: {what}, {length}.',
    { day: 'date', what: 'text', length: 'minutes' },
    { fallback: 'The next key session could not be shown.' },
  ),
  'brief.key-session-distance': tpl(
    '{day}: {what}, {length}, {distance}.',
    { day: 'date', what: 'text', length: 'minutes', distance: 'distance' },
    { fallback: 'The next key session could not be shown.' },
  ),
  'brief.key-readiness': tpl(
    'Readiness can only make this session easier on the day, never harder.',
  ),
  'brief.key-none': tpl('No key session this week. The week is easy running.'),

  // What a session is called in a sentence, one template for every kind (an exhaustive record
  // below, so a kind the engine adds is a compile error here until it is named).
  'brief.kind-easy': tpl('easy run', {}, { shape: 'label' }),
  'brief.kind-recovery': tpl('recovery run', {}, { shape: 'label' }),
  'brief.kind-long': tpl('long run', {}, { shape: 'label' }),
  'brief.kind-long-fast-finish': tpl('long run with a fast finish', {}, { shape: 'label' }),
  'brief.kind-threshold': tpl('threshold run', {}, { shape: 'label' }),
  'brief.kind-intervals': tpl('intervals', {}, { shape: 'label' }),
  'brief.kind-race-pace': tpl('race-pace run', {}, { shape: 'label' }),
  'brief.kind-strides': tpl('easy run with strides', {}, { shape: 'label' }),
  'brief.kind-hills': tpl('hill repeats', {}, { shape: 'label' }),
  'brief.kind-hike': tpl('hike', {}, { shape: 'label' }),
  'brief.kind-b2b': tpl('back-to-back run', {}, { shape: 'label' }),
  'brief.kind-strength': tpl('strength', {}, { shape: 'label' }),
  'brief.kind-mobility': tpl('mobility', {}, { shape: 'label' }),
  'brief.kind-rest': tpl('rest day', {}, { shape: 'label' }),
  'brief.kind-race': tpl('race', {}, { shape: 'label' }),
  'brief.kind-cross': tpl('cross-training', {}, { shape: 'label' }),
  /** For a kind a newer build may add. */
  'brief.kind-other': tpl('session', {}, { shape: 'label' }),

  // Today's line, in the `brief` slot: how many sessions the update changed and the next key
  // session. A count of one, none and many read differently, and a week with no key session leaves
  // that half out.
  'brief.line-many': tpl(
    'Since last week: {n} changes, next key session {day} ({what}).',
    { n: 'count', day: 'weekday', what: 'text' },
    { fallback: 'Open the weekly brief.' },
  ),
  'brief.line-one': tpl(
    'Since last week: 1 change, next key session {day} ({what}).',
    { day: 'weekday', what: 'text' },
    { fallback: 'Open the weekly brief.' },
  ),
  'brief.line-none': tpl(
    'Since last week: no changes, next key session {day} ({what}).',
    { day: 'weekday', what: 'text' },
    { fallback: 'Open the weekly brief.' },
  ),
  'brief.line-many-no-key': tpl('Since last week: {n} changes, no key session this week.', {
    n: 'count',
  }),
  'brief.line-one-no-key': tpl('Since last week: 1 change, no key session this week.'),
  'brief.line-none-no-key': tpl('Since last week: no changes, no key session this week.'),
} satisfies Record<string, Template>

/** The template that names each kind of session in a sentence. */
export const BRIEF_KIND_IDS = {
  easy: 'brief.kind-easy',
  recovery: 'brief.kind-recovery',
  long: 'brief.kind-long',
  'long-fast-finish': 'brief.kind-long-fast-finish',
  threshold: 'brief.kind-threshold',
  intervals: 'brief.kind-intervals',
  'race-pace': 'brief.kind-race-pace',
  strides: 'brief.kind-strides',
  hills: 'brief.kind-hills',
  hike: 'brief.kind-hike',
  b2b: 'brief.kind-b2b',
  strength: 'brief.kind-strength',
  mobility: 'brief.kind-mobility',
  rest: 'brief.kind-rest',
  race: 'brief.kind-race',
  cross: 'brief.kind-cross',
} as const satisfies Record<SessionKind, keyof typeof BRIEF_TEMPLATES>

/** The sentence for each reason the weekly update wrote nothing. */
export const BRIEF_REPLAN_IDS = {
  'goal-passed': 'brief.replan-goal-passed',
  checklist: 'brief.replan-checklist',
  'no-plan': 'brief.replan-no-plan',
  'not-run': 'brief.replan-not-run',
  error: 'brief.replan-error',
} as const satisfies Record<BriefReplanCode, keyof typeof BRIEF_TEMPLATES>
