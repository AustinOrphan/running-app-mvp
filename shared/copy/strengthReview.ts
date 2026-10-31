// The words of strength on the Review page and the two prompts of the Strength page (strength design
// 12.2 and 12.4): the line for a lift that moved, the question about a lower weekly count, and the
// note for a week with more sessions than planned. Every sentence is a template, spread into
// `TEMPLATES`, so the shared G5 lint renders each one in both unit systems and both weight units.
//
// The conventions of `strengthTemplates.ts` hold: no digit in a text (a number is a slot, or arrives
// as a word built by `numberWord` or `countPhrase` because a Param may move), no "you", and no
// sentence that calls a week behind, short or missed. A week with fewer sessions than planned reads
// as a question about the plan, never as a score.
import { tpl, type Template } from './template.ts'

export const STRENGTH_REVIEW_TEMPLATES = {
  // ---- The Review page: a lift whose working load moved in the week (design 12.2) ----------------
  'strength.review.moved-list': tpl('Lifts that moved', {}, { shape: 'label' }),
  // "Back squat 110 lb to 115 lb"; a load that went down reads the same way.
  'strength.review.moved': tpl(
    '{exercise} {from} to {to}',
    { exercise: 'text', from: 'load', to: 'load' },
    { shape: 'label', fallback: 'A lift moved' },
  ),

  // ---- The count prompt (design 12.4) -------------------------------------------------------------
  // `planned` reads "Two" (the count the plan asks for now) and `fewer` "one": the count the button
  // plans. The question follows the sentence in the same paragraph.
  'strength.count.line': tpl(
    '{planned} a week is the plan; {fewer} fits a busy stretch too.',
    { planned: 'text', fewer: 'text' },
    { fallback: 'One a week fits a busy stretch too.' },
  ),
  'strength.count.ask': tpl('Plan {fewer} a week?', { fewer: 'text' }, { fallback: 'Plan fewer?' }),
  'strength.count.plan': tpl(
    'Plan {n} a week',
    { n: 'count' },
    { shape: 'label', fallback: 'Plan fewer' },
  ),
  'strength.count.later': tpl('Not now', {}, { shape: 'label' }),
  // `sessions` reads "one strength session". The change is a plan revision at the weekly update
  // (ADR 0007), so the line says when, not that it is done.
  'strength.count.planned': tpl(
    'From the next weekly update the plan asks for {sessions} a week.',
    { sessions: 'text' },
    { fallback: 'The plan asks for fewer sessions from the next weekly update.' },
  ),
  // `weeks` reads "four weeks".
  'strength.count.kept': tpl(
    'Nothing changes. The question stays away for {weeks}.',
    { weeks: 'text' },
    { fallback: 'Nothing changes. The question stays away for a while.' },
  ),
  'strength.count.error': tpl('The choice was not saved. Try again.'),

  // ---- More sessions than planned (design 12.4) -----------------------------------------------------
  // `logged` is at least two here. `lo` and `hi` are the range of `flib.strengthPerWeek`.
  'strength.over.more': tpl(
    '{logged} sessions logged; the plan asks for {planned}. More does not add to the block. The research range is {lo} to {hi} a week.',
    { logged: 'count', planned: 'count', lo: 'count', hi: 'count' },
    { fallback: 'More sessions than the plan asks for do not add to the block.' },
  ),
} satisfies Record<string, Template>

export type StrengthReviewTemplateId = keyof typeof STRENGTH_REVIEW_TEMPLATES
