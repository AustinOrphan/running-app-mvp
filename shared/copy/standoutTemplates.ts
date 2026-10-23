// The sentences of "What stood out" on a run (phase 3a design 8.5 and 8.6): one template per
// finding, filled from the facts `shared/engine/standout.ts` selects, and the words around the card.
// They are spread into `TEMPLATES`, so the copy-lint test renders every one.
//
// Ids are `standout.<name>` and never change meaning once an activity insight may hold them. A
// stored insight keeps a template id and its slots, never the sentence, and no slot is free text:
// wording that varies (higher or lower, with or without heat) is a template of its own.
//
// Tone (rule G5): a finding states a figure of the run and what it is compared with. It does not
// grade the run, name a shortfall or promise a result.
import { tpl, type Template } from './template.ts'

/**
 * The eleven findings, in the order a run shows them when more than three apply: pain first, then
 * the runner's own effort rating, then heart rate, drift, grade, efficiency, the longest run and
 * the time against the plan. A finding is the last part of an `InputFact` id (`a8.hr-higher`).
 */
export const STANDOUT_KINDS = [
  'pain',
  'effort-harder',
  'effort-easier',
  'hr-higher',
  'hr-lower',
  'drift-more',
  'drift-less',
  'grade',
  'efficiency',
  'longest',
  'completion',
] as const

export type StandoutKind = (typeof STANDOUT_KINDS)[number]

export const STANDOUT_TEMPLATES = {
  // Pain comes first and is worded as the guidance already words it in the plan. The sentence says
  // where the report came from: the run's own rating, or the check-in of its day when that was the
  // higher figure. Only the check-in holds the focal bone flag, so that sentence always names it.
  'standout.pain': tpl(
    'Pain of {pain} out of 10 was reported with this run. See the guidance on warning signs before the next run.',
    { pain: 'count' },
  ),
  'standout.pain-checkin': tpl(
    'Pain of {pain} out of 10 was reported in the check-in on the day of this run. See the guidance on warning signs before the next run.',
    { pain: 'count' },
  ),
  'standout.pain-bone': tpl(
    'Focal bone pain was reported in the check-in on the day of this run. Rest, and see the guidance on warning signs.',
  ),

  // Effort: only the runner's own rating counts, so each sentence names the rating it rests on.
  'standout.effort-harder-rpe': tpl(
    'You rated this run {rpe} out of 10, above the {low} to {high} the plan expects for this kind of session.',
    { rpe: 'count', low: 'count', high: 'count' },
  ),
  'standout.effort-harder-feel': tpl('You said this run felt harder than the plan expects.'),
  'standout.effort-easier-rpe': tpl(
    'You rated this run {rpe} out of 10, below the {low} to {high} the plan expects for this kind of session.',
    { rpe: 'count', low: 'count', high: 'count' },
  ),
  'standout.effort-easier-feel': tpl('You said this run felt easier than the plan expects.'),

  // Heart rate against the runner's own model for this pace; the gap is above wrist-sensor error.
  'standout.hr-higher': tpl('Average heart rate was {bpm} higher than your usual at this pace.', {
    bpm: 'bpm',
  }),
  'standout.hr-lower': tpl('Average heart rate was {bpm} lower than your usual at this pace.', {
    bpm: 'bpm',
  }),
  'standout.hr-higher-heat': tpl(
    'Average heart rate was {bpm} higher than your usual at this pace, even after allowing for the heat.',
    { bpm: 'bpm' },
  ),
  'standout.hr-lower-heat': tpl(
    'Average heart rate was {bpm} lower than your usual at this pace, after allowing for the heat.',
    { bpm: 'bpm' },
  ),

  // Drift on a long, cool run against similar long runs.
  'standout.drift-more': tpl(
    'Pace and heart rate drifted apart by {delta} percentage points more than on {n} similar long runs.',
    { delta: 'count', n: 'count' },
  ),
  'standout.drift-less': tpl(
    'Pace and heart rate drifted apart by {delta} percentage points less than on {n} similar long runs.',
    { delta: 'count', n: 'count' },
  ),

  'standout.grade': tpl('This run climbed {gain} over {distance}, an average grade of {grade}.', {
    gain: 'climb',
    distance: 'distance',
    grade: 'percent',
  }),

  'standout.efficiency-up': tpl(
    'You covered {pct} more distance per heartbeat than on your recent steady runs at a similar pace.',
    { pct: 'percent' },
  ),
  'standout.efficiency-down': tpl(
    'You covered {pct} less distance per heartbeat than on your recent steady runs at a similar pace.',
    { pct: 'percent' },
  ),

  'standout.longest-distance': tpl(
    'At {distance}, this is your longest run in the last {weeks} weeks.',
    { distance: 'distance', weeks: 'count' },
  ),
  'standout.longest-duration': tpl(
    'At {duration}, this is your longest run by time in the last {weeks} weeks.',
    { duration: 'duration', weeks: 'count' },
  ),

  'standout.ran-less': tpl('You ran {actual} of the {planned} planned for this session.', {
    actual: 'minutes',
    planned: 'minutes',
  }),
  'standout.ran-more': tpl(
    'You ran {actual}, longer than the {planned} planned for this session.',
    {
      actual: 'minutes',
      planned: 'minutes',
    },
  ),

  // The card
  'standout.heading': tpl('What stood out', {}, { shape: 'label' }),
  'standout.empty': tpl('Nothing unusual to report on this run.'),
  'standout.error': tpl('What stood out could not be loaded. Reload the page to try again.'),

  // What a Why button names, so the accessible names of a card's buttons tell them apart.
  'standout.subject-pain': tpl('pain', {}, { shape: 'label' }),
  'standout.subject-effort': tpl('effort rating', {}, { shape: 'label' }),
  'standout.subject-hr': tpl('heart rate', {}, { shape: 'label' }),
  'standout.subject-drift': tpl('drift', {}, { shape: 'label' }),
  'standout.subject-grade': tpl('climbing', {}, { shape: 'label' }),
  'standout.subject-efficiency': tpl('efficiency', {}, { shape: 'label' }),
  'standout.subject-longest': tpl('longest run', {}, { shape: 'label' }),
  'standout.subject-completion': tpl('time against the plan', {}, { shape: 'label' }),
} satisfies Record<string, Template>

/** The template that names a finding on its Why button. */
export const STANDOUT_SUBJECT_IDS = {
  pain: 'standout.subject-pain',
  'effort-harder': 'standout.subject-effort',
  'effort-easier': 'standout.subject-effort',
  'hr-higher': 'standout.subject-hr',
  'hr-lower': 'standout.subject-hr',
  'drift-more': 'standout.subject-drift',
  'drift-less': 'standout.subject-drift',
  grade: 'standout.subject-grade',
  efficiency: 'standout.subject-efficiency',
  longest: 'standout.subject-longest',
  completion: 'standout.subject-completion',
} as const satisfies Record<StandoutKind, keyof typeof STANDOUT_TEMPLATES>
