// The sentences the intervals.icu publisher stores when a send does not go through (ADR 0008,
// design 6.6 and 6.7). `server/providers/intervalsPublish.ts` renders them where it builds an
// outcome, so a copy fix lives here and every one is rendered by the copy-lint test.
//
// Text intervals.icu returned (the reason of a rejection) is a text slot: it is shown verbatim
// inside the app's own sentence and is outside the lint (ADR 0010).
import { render, tpl, type Template } from './template.ts'

export const PUBLISH_TEMPLATES = {
  'publish.not-connected': tpl('intervals.icu is not connected.'),
  'publish.unreachable': tpl('intervals.icu could not be reached.'),
  'publish.auth': tpl(
    'intervals.icu did not accept the API key. Reconnect it on the Integrations page.',
  ),
  'publish.rate-limited': tpl('intervals.icu asked the app to wait.'),
  'publish.event-removed': tpl('The event was removed in intervals.icu.'),
  'publish.no-event': tpl('intervals.icu did not say which event it created.'),
  'publish.unreadable': tpl('intervals.icu answered with text that could not be read.'),
  'publish.http-status': tpl('intervals.icu answered HTTP {status}.', { status: 'count' }),
  // A 400 or 422: with the reason intervals.icu gave, or without one.
  'publish.rejected-reason': tpl(
    'intervals.icu did not accept the workout: {reason}',
    { reason: 'text' },
    { shape: 'label', fallback: 'intervals.icu did not accept the workout.' },
  ),
  'publish.rejected': tpl('intervals.icu did not accept the workout (HTTP {status}).', {
    status: 'count',
  }),

  // The answers of the wrist routes (design 6.4) and the Today health note about tomorrow.
  'publish.wrist.connect': tpl('Connect intervals.icu first.'),
  'publish.wrist.reconnect': tpl('Reconnect intervals.icu first.'),
  'publish.wrist.off': tpl('Sending to your watch is off. Turn it on under Integrations.'),
  'publish.wrist.remove-failed': tpl(
    'The sessions already sent could not be removed from intervals.icu, so it stays connected. Try again, or disconnect without removing them.',
  ),
  'publish.wrist.range': tpl('Ask for at most 60 days, ending on or after the start.'),
  'publish.wrist.not-found': tpl('That session is not in the active plan.'),
  'publish.wrist.note-tomorrow': tpl(
    "Tomorrow's run is not on the watch yet. Open the plan to send it again or to download the workout file.",
  ),
} satisfies Record<string, Template>

export type PublishTemplateId = keyof typeof PUBLISH_TEMPLATES

/** No slot of the publish templates depends on the units, so any units give the same text. */
const STORED_UNITS = 'km'

/** The sentences that name no figure and no remote text. */
export type PublishSentenceId =
  | 'publish.not-connected'
  | 'publish.unreachable'
  | 'publish.auth'
  | 'publish.rate-limited'
  | 'publish.event-removed'
  | 'publish.no-event'
  | 'publish.unreadable'

export function publishSentence(id: PublishSentenceId): string {
  return render(PUBLISH_TEMPLATES[id], {}, STORED_UNITS)
}

/** The sentences of the wrist routes: what a refused request tells the runner to do. */
export type WristSentenceId =
  | 'publish.wrist.connect'
  | 'publish.wrist.reconnect'
  | 'publish.wrist.off'
  | 'publish.wrist.remove-failed'
  | 'publish.wrist.range'
  | 'publish.wrist.not-found'

export function wristSentence(id: WristSentenceId): string {
  return render(PUBLISH_TEMPLATES[id], {}, STORED_UNITS)
}

/** "intervals.icu answered HTTP 502." */
export function httpStatusSentence(status: number): string {
  return render(
    PUBLISH_TEMPLATES['publish.http-status'],
    { status: { kind: 'count', n: status } },
    STORED_UNITS,
  )
}

/** A rejection with no reason from intervals.icu: "... did not accept the workout (HTTP 422)." */
export function rejectedSentence(status: number): string {
  return render(
    PUBLISH_TEMPLATES['publish.rejected'],
    { status: { kind: 'count', n: status } },
    STORED_UNITS,
  )
}

/** A rejection with the reason intervals.icu gave, quoted as its own words. */
export function rejectedReasonSentence(reason: string): string {
  return render(PUBLISH_TEMPLATES['publish.rejected-reason'], { reason }, STORED_UNITS)
}
