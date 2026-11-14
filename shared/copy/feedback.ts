// The words of "Send feedback" in Settings (FB1): the row, its states and the plain-text note the
// runner pastes to the person who runs the app. `FEEDBACK_TEMPLATES` is spread into `TEMPLATES`, so
// the G5 lint renders each one. The note holds the page, the build, the time, the browser, the
// plan's id and the time of its last revision, and a blank line for the runner's own words; no
// health data, no activity value, no email.
import { render, tpl } from './template.ts'

export const FEEDBACK_TEMPLATES = {
  'feedback.heading': tpl('Send feedback', {}, { shape: 'label' }),
  'feedback.what': tpl(
    "Copies a note: the page you came from, build, time, browser and, if known, your plan's id and last change. No runs, health data or email.",
  ),
  'feedback.button': tpl('Copy feedback note', {}, { shape: 'label' }),
  'feedback.copied': tpl('Copied', {}, { shape: 'label' }),
  'feedback.fallback': tpl(
    'The clipboard is not available. The note is selected below; copy it by hand.',
  ),
  'feedback.fallback-label': tpl('Feedback note', {}, { shape: 'label' }),
  // The operator replaces this line; nothing reads it from a setting.
  'feedback.where': tpl('Paste this into a message to the person who runs this app.'),
  'feedback.line.page': tpl('Page: {value}', { value: 'text' }, { shape: 'label' }),
  'feedback.line.build': tpl('Build: {value}', { value: 'text' }, { shape: 'label' }),
  'feedback.line.time': tpl('Time: {value}', { value: 'text' }, { shape: 'label' }),
  'feedback.line.browser': tpl('Browser: {value}', { value: 'text' }, { shape: 'label' }),
  'feedback.line.plan': tpl('Plan: {value}', { value: 'text' }, { shape: 'label' }),
  'feedback.line.revised': tpl('Plan last changed: {value}', { value: 'text' }, { shape: 'label' }),
  'feedback.line.words': tpl('What happened:', {}, { shape: 'label' }),
  'feedback.page-none': tpl('none (opened directly)', {}, { shape: 'label' }),
} as const

/** What the note states; every field is a path, an id, an instant or a name, never a figure of a run. */
export interface FeedbackFacts {
  /** The path (no query, no hash) of the page the runner came from, or null. */
  fromPath: string | null
  buildId: string
  /** An ISO instant. */
  at: string
  userAgent: string
  /** The current plan's id, when the page already holds it. */
  planId: string | null
  /** The time of the plan's newest revision, when the page already holds it. */
  planRevisedAt: string | null
}

type LineKey =
  | 'feedback.line.page'
  | 'feedback.line.build'
  | 'feedback.line.time'
  | 'feedback.line.browser'
  | 'feedback.line.plan'
  | 'feedback.line.revised'

/** The note, one fact per line, then a blank line for the runner's words. */
export function feedbackReport(facts: FeedbackFacts): string {
  const line = (key: LineKey, value: string) => render(FEEDBACK_TEMPLATES[key], { value }, 'km')
  const lines = [
    render(FEEDBACK_TEMPLATES['feedback.where'], {}, 'km'),
    '',
    line(
      'feedback.line.page',
      facts.fromPath ?? render(FEEDBACK_TEMPLATES['feedback.page-none'], {}, 'km'),
    ),
    line('feedback.line.build', facts.buildId),
    line('feedback.line.time', facts.at),
    line('feedback.line.browser', facts.userAgent),
  ]
  if (facts.planId !== null) lines.push(line('feedback.line.plan', facts.planId))
  if (facts.planRevisedAt !== null) lines.push(line('feedback.line.revised', facts.planRevisedAt))
  lines.push('', render(FEEDBACK_TEMPLATES['feedback.line.words'], {}, 'km'), '', '')
  return lines.join('\n')
}
