// The registry of the app's own templates. Every app-authored sentence is an entry here (or in a
// file this one spreads in), and the copy-lint test renders every entry: banned words, undeclared
// or unused slots, more than 160 rendered characters and a missing final stop fail the build, so a
// new template is linted without anyone editing the test.
//
// Ids are `<area>.<name>`. Epics add their own files (`today.ts`, `revision.ts`, ...) and spread
// their templates into `TEMPLATES`.
import { FUEL_TEMPLATES } from '../engine/fuelCopy.ts'
import type { InputFact } from '../engine/types.ts'
import type { Units, WeightUnit } from '../types.ts'
import { ACTIVITY_LIST_TEMPLATES } from './activityList.ts'
import { BRIEF_TEMPLATES } from './briefTemplates.ts'
import { DATA_IN_USE_TEMPLATES } from './dataInUse.ts'
import { DISTANCE_ESTIMATE_TEMPLATES } from './distanceEstimate.ts'
import { EXECUTION_TEMPLATES } from './execution.ts'
import { FUEL_UI_TEMPLATES } from './fuelUi.ts'
import { GOALS_TEMPLATES } from './goals.ts'
import { LOAD_TEMPLATES } from './load.ts'
import { OVERSHOOT_TEMPLATES } from './overshoot.ts'
import { PAGE_TEMPLATES, PROVIDER_TEMPLATES } from './pageCopy.ts'
import { ADJUST_TEMPLATES, REVISION_TEMPLATES, WINDOW_TEMPLATES } from './revision.ts'
import { REVISION_VIEW_TEMPLATES } from './revisionView.ts'
import { SESSION_STATUS_TEMPLATES } from './sessionStatus.ts'
import { STRENGTH_PAGE_TEMPLATES } from './strengthPage.ts'
import { STRENGTH_REVIEW_TEMPLATES } from './strengthReview.ts'
import { STRENGTH_TEMPLATES } from './strengthTemplates.ts'
import { WINDOW_VIEW_TEMPLATES } from './windowView.ts'
import { EXPLAIN_TEMPLATES } from './explainTemplates.ts'
import { PUBLISH_TEMPLATES } from './publish.ts'
import { STANDOUT_TEMPLATES } from './standoutTemplates.ts'
import { CopyError, isCopyStrict, render, tpl, type Template } from './template.ts'
import { SYNC_TEMPLATES } from './sync.ts'
import { TODAY_TEMPLATES } from './today.ts'
import { WORKOUT_TEMPLATES } from './workouts.ts'
import { TRACK_RECORD_TEMPLATES } from './trackRecord.ts'

export const TEMPLATES = {
  ...REVISION_TEMPLATES,
  ...REVISION_VIEW_TEMPLATES,
  ...TODAY_TEMPLATES,
  ...EXECUTION_TEMPLATES,
  ...SESSION_STATUS_TEMPLATES,
  ...DATA_IN_USE_TEMPLATES,
  ...DISTANCE_ESTIMATE_TEMPLATES,
  ...FUEL_TEMPLATES,
  ...FUEL_UI_TEMPLATES,
  ...WINDOW_TEMPLATES,
  ...ADJUST_TEMPLATES,
  ...WINDOW_VIEW_TEMPLATES,
  ...ACTIVITY_LIST_TEMPLATES,
  ...EXPLAIN_TEMPLATES,
  ...PUBLISH_TEMPLATES,
  ...GOALS_TEMPLATES,
  ...LOAD_TEMPLATES,
  ...OVERSHOOT_TEMPLATES,
  ...WORKOUT_TEMPLATES,
  ...STANDOUT_TEMPLATES,
  ...TRACK_RECORD_TEMPLATES,
  ...BRIEF_TEMPLATES,
  ...STRENGTH_TEMPLATES,
  ...STRENGTH_PAGE_TEMPLATES,
  ...STRENGTH_REVIEW_TEMPLATES,
  ...PAGE_TEMPLATES,
  ...PROVIDER_TEMPLATES,
  // The why drawer
  'why.intro': tpl(
    'Every number in the plan comes from a rule. Grade A is the strongest evidence; grade D is a conservative default.',
  ),
  'why.loading': tpl('Loading the evidence.'),
  // "From your numbers": the figures the engine read for this subject (phase 3a design 8.6)
  'why.numbers-heading': tpl('From your numbers', {}, { shape: 'label' }),
  'why.numbers-live': tpl(
    'These are the figures the plan read, as of {date}. It reads them again every Monday.',
    { date: 'date' },
    { fallback: 'These are the figures the plan read. It reads them again every Monday.' },
  ),
  'why.numbers-frozen': tpl(
    'These are the figures from {date}, when this was written.',
    { date: 'date' },
    { fallback: 'These are the figures from the day this was written.' },
  ),
  'why.not-enough': tpl('Not enough data yet:', {}, { shape: 'label' }),
  'why.rule-alone': tpl('This rests on the rule alone. It does not use your data.'),
  'why.explain-error': tpl(
    'Your figures could not be loaded. The rule and papers below still apply. Close this panel and open it again to retry.',
  ),
  'why.based-on': tpl('Based on', {}, { shape: 'label' }),
  'why.more-sources': tpl('and {n} more', { n: 'count' }, { fallback: 'and more', shape: 'label' }),
  'why.source-activity': tpl(
    '{label}, {distance}, {date}',
    { label: 'text', distance: 'distance', date: 'date' },
    { fallback: 'A record', shape: 'label' },
  ),
  'why.source-dated': tpl(
    '{label}, {date}',
    { label: 'text', date: 'date' },
    { fallback: 'A record', shape: 'label' },
  ),
  'why.rules-heading': tpl('The rule and its evidence', {}, { shape: 'label' }),
  'why.registry-error': tpl(
    'The parameter registry could not be loaded. Close this panel and open it again to retry.',
  ),
  'why.no-parameter': tpl(
    'No parameter is recorded for {rule}.',
    { rule: 'text' },
    { fallback: 'No parameter is recorded for this rule.' },
  ),
  'why.papers-loading': tpl('Loading papers.'),
  'why.papers-error': tpl(
    'The research base could not be loaded. Papers: {ids}.',
    { ids: 'text' },
    { fallback: 'The research base could not be loaded.' },
  ),
  'why.paper-missing': tpl(
    '{id} is not in the bundled research base.',
    { id: 'text' },
    { fallback: 'A paper is not in the bundled research base.' },
  ),
  'why.footnote': tpl(
    'Decision support for one runner, not medical advice. Stop and see a clinician for pain that persists or worsens.',
  ),

  // The line under the Research heading, and the note of the Research link on the More page
  'research.context': tpl('The papers and rules the plan rests on', {}, { shape: 'label' }),

  // The place of a chart whose code could not be loaded
  'charts.unavailable': tpl('The chart did not load. Reload the page to try again.'),

  // The sync history on the Integrations page
  ...SYNC_TEMPLATES,
} satisfies Record<string, Template>

export type TemplateId = keyof typeof TEMPLATES

/** Shown for a stored fact whose template id is not in the registry (a record from a newer build). */
export const UNKNOWN_FACT_TEXT = 'This figure could not be shown.'

function isTemplateId(id: string): id is TemplateId {
  return Object.hasOwn(TEMPLATES, id)
}

/**
 * The sentence for a stored fact, in the runner's units. A fact keeps a template id and its slots
 * (never prose), so a copy fix reaches old records. Under test an unknown template or a bad slot
 * throws; elsewhere an unknown template reads `UNKNOWN_FACT_TEXT` and a bad slot the template's
 * own fallback. `weightUnit` is the runner's unit for strength loads, read only by a `load` slot.
 */
export function renderFact(
  fact: Pick<InputFact, 'template' | 'slots'>,
  units: Units,
  weightUnit?: WeightUnit,
): string {
  if (!isTemplateId(fact.template)) {
    if (isCopyStrict()) {
      throw new CopyError(`Fact template ${JSON.stringify(fact.template)}`, ['not in TEMPLATES'])
    }
    return UNKNOWN_FACT_TEXT
  }
  const template: Template = TEMPLATES[fact.template]
  return render(template, fact.slots, units, weightUnit)
}
