// The sentences of a session's assessment (phase 3a design, section 4.5, ADR 0010): how the run
// compared with the plan, in the order the Session sheet and the Review list read them. The engine
// stores a template id and its slots (`StoredAssessment.facts`), never a sentence; the words are
// written when the session is read, so a copy fix reaches the assessments already stored.
//
// Ids are `execution.<name>`. Every id is built in `shared/engine/execution.ts`, where a
// `TemplateId` type keeps the two in step. They are spread into `TEMPLATES`, so the copy-lint test
// renders each one. Nothing here is a distance, a pace or a climb, so the words read the same in
// kilometres and in miles.
import { tpl, type Template } from './template.ts'

export const EXECUTION_TEMPLATES = {
  // Completion: how long the run was against the plan, or that it was another kind of activity.
  'execution.other-kind': tpl('A different kind of activity than the one planned ({session}).', {
    session: 'text',
  }),
  'execution.minutes-of-plan': tpl('{actual} against {planned} planned ({share}).', {
    actual: 'minutes',
    planned: 'minutes',
    share: 'percent',
  }),
  'execution.minutes-done': tpl('{actual} done.', { actual: 'minutes' }),

  // Intensity against the target range.
  'execution.intensity-on': tpl('Intensity stayed in the target range.'),
  'execution.intensity-above': tpl('Intensity ran above the target range.'),
  'execution.intensity-below': tpl('Intensity stayed below the target range.'),

  // Effort against what the kind of session expects. One template per answer, so no word is
  // picked in code; the harder answers say what the rating was when there is one.
  'execution.effort-harder': tpl('Effort felt harder than expected.'),
  'execution.effort-harder-rpe': tpl(
    'Effort felt harder than expected. RPE {rpe} against {low}-{high} expected for this kind.',
    { rpe: 'count', low: 'count', high: 'count' },
  ),
  'execution.effort-much-harder': tpl('Effort felt much harder than expected.'),
  'execution.effort-much-harder-rpe': tpl(
    'Effort felt much harder than expected. RPE {rpe} against {low}-{high} expected for this kind.',
    { rpe: 'count', low: 'count', high: 'count' },
  ),
  'execution.effort-easier': tpl('Effort felt easier than expected.'),
  'execution.effort-much-easier': tpl('Effort felt much easier than expected.'),
  'execution.effort-matched': tpl('Effort matched expectation.'),

  // Conditions and the readings the assessment could not use.
  'execution.warm': tpl(
    'Warm conditions (WBGT about {wbgt}): the heart-rate expectation was raised and pace was not judged.',
    { wbgt: 'temp' },
  ),
  'execution.hr-unqualified': tpl(
    'Heart rate was not used: it does not qualify for this kind of run.',
  ),

  // Pain and the size of the run against the longest of the last days.
  'execution.pain-bone': tpl(
    'Focal bone pain reported. Rest and see the guidance on warning signs.',
  ),
  'execution.pain': tpl(
    'Pain {score} of 10 reported. See the guidance on warning signs before the next run.',
    { score: 'count' },
  ),
  'execution.spike': tpl(
    'Longer or steeper than the longest run of the last {days} days by more than the usual step.',
    { days: 'count' },
  ),
} satisfies Record<string, Template>
