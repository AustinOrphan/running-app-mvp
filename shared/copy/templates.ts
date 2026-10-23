// The registry of the app's own templates. Every app-authored sentence is an entry here (or in a
// file this one spreads in), and the copy-lint test renders every entry: banned words, undeclared
// or unused slots, more than 160 rendered characters and a missing final stop fail the build, so a
// new template is linted without anyone editing the test.
//
// Ids are `<area>.<name>`. Epics add their own files (`today.ts`, `revision.ts`, ...) and spread
// their templates into `TEMPLATES`.
import type { InputFact } from '../engine/types.ts'
import type { Units } from '../types.ts'
import { CopyError, isCopyStrict, render, tpl, type Template } from './template.ts'

export const TEMPLATES = {
  // The why drawer
  'why.intro': tpl(
    'Every number in the plan comes from a rule. Grade A is the strongest evidence; grade D is a conservative default.',
  ),
  'why.loading': tpl('Loading the evidence.'),
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
 * own fallback.
 */
export function renderFact(fact: Pick<InputFact, 'template' | 'slots'>, units: Units): string {
  if (!isTemplateId(fact.template)) {
    if (isCopyStrict()) {
      throw new CopyError(`Fact template ${JSON.stringify(fact.template)}`, ['not in TEMPLATES'])
    }
    return UNKNOWN_FACT_TEXT
  }
  const template: Template = TEMPLATES[fact.template]
  return render(template, fact.slots, units)
}
