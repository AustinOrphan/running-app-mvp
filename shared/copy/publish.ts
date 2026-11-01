// The sentences the intervals.icu publisher stores when a send does not go through (ADR 0008,
// design 6.6 and 6.7). `server/providers/intervalsPublish.ts` renders them where it builds an
// outcome, so a copy fix lives here and every one is rendered by the copy-lint test.
//
// Text intervals.icu or Garmin Connect returned (the reason of a rejection, a device message) is a
// text slot: it is shown verbatim inside the app's own sentence and is outside the lint (ADR 0010).
//
// The second half of the file is what the runner reads about a session on its way to the watch
// (design 6.7): the chip words, the sentence behind each status and code, the warnings, the Plan
// strip, the sheet section and Today's line. The web renders them through the functions at the
// end, so a status word is never typed in a component.
import type { WristItem, WristItemStatus } from '../types.ts'
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
  'publish.wrist.range': tpl('Ask for at most {days} days, ending on or after the start.', {
    days: 'count',
  }),
  'publish.wrist.not-found': tpl('That session is not in the active plan.'),
  'publish.wrist.note-tomorrow': tpl(
    "Tomorrow's run is not on the watch yet. Open the plan to send it again or to download the workout file.",
  ),

  // The chip of a session: one short word, with the sentence below as its `title`.
  'publish.chip.not-sent': tpl('Not sent yet', {}, { shape: 'label' }),
  'publish.chip.waiting': tpl('Waiting to send', {}, { shape: 'label' }),
  'publish.chip.sent': tpl('Sent to intervals.icu', {}, { shape: 'label' }),
  'publish.chip.on-watch': tpl('On your watch', {}, { shape: 'label' }),
  'publish.chip.not-delivered': tpl('Not delivered', {}, { shape: 'label' }),
  'publish.chip.removed': tpl('Removed in intervals.icu', {}, { shape: 'label' }),

  // The sentence of a status that has no code behind it.
  'publish.status.not-sent': tpl(
    'Sending is on and this run has not been sent yet. The app sends it within a few minutes.',
  ),
  'publish.status.waiting': tpl('The app sends this run by itself.'),
  'publish.status.sent': tpl('intervals.icu has this run.'),
  'publish.status.on-watch': tpl('intervals.icu has this run and uploads it to Garmin Connect.'),
  'publish.status.not-delivered': tpl(
    'This run did not reach the watch. Send it again, or download the workout file.',
  ),
  'publish.status.removed': tpl(
    'You removed this one in intervals.icu, so the app leaves it alone.',
  ),
  'publish.status.withdrawn': tpl('The app took this run off the watch.'),

  // The sentence of a failure code, and what follows it while a retry is due.
  'publish.code.not-connected': tpl(
    'intervals.icu is not connected. Connect it on the Integrations page.',
  ),
  'publish.retry-at': tpl('It tries again at {time}.', { time: 'text' }),
  'publish.device': tpl('Garmin Connect did not take it: {message}.', { message: 'text' }),

  // What the text of an event could not carry (the warning codes of an upsert).
  'publish.warning.no-threshold-pace': tpl(
    'intervals.icu has no running threshold pace yet, so pace targets are written in the text of each step only. Set it in intervals.icu under Settings, Run.',
  ),
  'publish.warning.no-max-hr': tpl(
    'intervals.icu has no maximum heart rate yet, so heart-rate targets are in the text of each step only. Set it in intervals.icu under Settings, Run.',
  ),
  'publish.warning.unparsed-steps': tpl(
    'intervals.icu did not read the steps of this workout, so the watch may show it as one block. The workout file has the steps.',
  ),

  // The strip on the Plan page: "Watch: next 14 days. 11 on your watch or sent, 2 waiting."
  'publish.strip.heading': tpl('Watch', {}, { shape: 'label' }),
  'publish.strip': tpl('Watch: next {days} days. {counts}.', { days: 'count', counts: 'text' }),
  'publish.strip.none': tpl('Watch: next {days} days. No runs to send.', { days: 'count' }),
  'publish.strip.sent': tpl('{n} on your watch or sent', { n: 'count' }, { shape: 'label' }),
  'publish.strip.waiting': tpl('{n} waiting', { n: 'count' }, { shape: 'label' }),
  'publish.strip.not-delivered': tpl('{n} not delivered', { n: 'count' }, { shape: 'label' }),
  // With sending off the strip is one line: this sentence, then the links to the files and to
  // Integrations. The session sheet leaves the explanation to the strip and keeps its one link.
  'publish.strip.off': tpl('Sending to your watch is off.'),

  // The section of the session sheet.
  'publish.sheet.heading': tpl('On your watch', {}, { shape: 'label' }),
  'publish.sheet.eased': tpl(
    "Today's readiness eased this session. The watch has the easy version; this page keeps the plan.",
  ),
  'publish.action.send-again': tpl('Send again', {}, { shape: 'label' }),
  'publish.action.integrations': tpl('Open Integrations', {}, { shape: 'label' }),

  // The settings on the intervals.icu card of the Integrations page: the two choices the sentences
  // "Turn it on under Integrations" and "Sending to your watch is off" send the runner to.
  'publish.settings.heading': tpl('Send sessions to your watch', {}, { shape: 'label' }),
  'publish.settings.send': tpl(
    'Send my next {days} days of runs to intervals.icu',
    { days: 'count' },
    { shape: 'label', fallback: 'Send my next runs to intervals.icu' },
  ),
  'publish.settings.garmin': tpl(
    'intervals.icu uploads planned workouts to my Garmin Connect',
    {},
    { shape: 'label' },
  ),
  'publish.settings.garmin-help': tpl(
    'In intervals.icu open Settings, Garmin Connect, and switch on uploading planned workouts. The app cannot check this.',
  ),
  'publish.settings.last-send': tpl('Last send to intervals.icu: {date} at {time}.', {
    date: 'date',
    time: 'text',
  }),
  'publish.settings.never-sent': tpl('Nothing has been sent to intervals.icu yet.'),
  'publish.settings.sending-now': tpl('Sending to intervals.icu now.'),
  'publish.settings.send-now': tpl('Send now', {}, { shape: 'label' }),
  'publish.settings.dormant': tpl(
    'intervals.icu closes accounts that are not logged in to for a long time. Log in now and then so the plan keeps reaching your watch.',
  ),
  // The offer that comes with turning sending off.
  'publish.settings.off-offer': tpl(
    'New sessions stop going out. Those already in intervals.icu stay there unless they are removed too.',
  ),
  'publish.settings.remove-sent': tpl(
    'Also remove the sessions already sent',
    {},
    { shape: 'label' },
  ),
  'publish.settings.turn-off': tpl('Turn off sending', {}, { shape: 'label' }),
  'publish.settings.keep': tpl('Keep sending', {}, { shape: 'label' }),

  // Disconnecting intervals.icu while sending is on offers the same removal, and a way out when the
  // removal fails (the server answers 409 and keeps the connection, because it needs the key).
  'publish.disconnect.button': tpl('Disconnect', {}, { shape: 'label' }),
  'publish.disconnect.offer': tpl(
    'intervals.icu holds the sessions already sent. They stay there after disconnecting unless they are removed too.',
  ),
  'publish.disconnect.failed': tpl(
    'Not disconnected. The server did not accept the request; try again.',
  ),
  'publish.disconnect.without': tpl('Disconnect without removing them', {}, { shape: 'label' }),
  'publish.disconnect.cancel': tpl('Keep it connected', {}, { shape: 'label' }),

  // The calendar link: a private address for any calendar app, with no account behind it.
  'publish.calendar.heading': tpl('Calendar link', {}, { shape: 'label' }),
  'publish.calendar.privacy': tpl(
    'Anyone with this link can read your session titles and durations. Titles name the kind of run only.',
  ),
  'publish.calendar.window': tpl(
    'The calendar shows the next {calendarDays} days; the watch gets the next {watchDays}.',
    { calendarDays: 'count', watchDays: 'count' },
  ),
  'publish.calendar.proxy': tpl(
    'A reverse proxy in front of this app may log the link, and the app cannot clear that log. Turn the link off to end it.',
  ),
  'publish.calendar.off': tpl('The calendar link is off.'),
  'publish.calendar.on': tpl('The calendar link works. It was made on {date}.', { date: 'date' }),
  'publish.calendar.on-plain': tpl('The calendar link works.'),
  'publish.calendar.not-shown': tpl(
    'The link cannot be shown again. Create a new one to copy it; the old one then stops working.',
  ),
  'publish.calendar.create': tpl('Create calendar link', {}, { shape: 'label' }),
  'publish.calendar.replace': tpl('Create a new link', {}, { shape: 'label' }),
  'publish.calendar.turn-off': tpl('Turn off the link', {}, { shape: 'label' }),
  'publish.calendar.dialog': tpl('Your calendar link', {}, { shape: 'label' }),
  'publish.calendar.shown-once': tpl(
    'This link is shown once. Copy it now or open it in a calendar app; creating another replaces it.',
  ),
  'publish.calendar.address': tpl('Calendar link address', {}, { shape: 'label' }),
  'publish.calendar.copy': tpl('Copy link', {}, { shape: 'label' }),
  'publish.calendar.open': tpl('Open in a calendar app', {}, { shape: 'label' }),
  'publish.calendar.copied': tpl('Link copied', {}, { shape: 'label' }),
  'publish.calendar.copy-failed': tpl(
    'The link could not be copied. Select it and copy it by hand.',
  ),
  'publish.calendar.turned-off': tpl('Calendar link turned off', {}, { shape: 'label' }),
  'publish.calendar.create-failed': tpl('The calendar link was not created. Try again.'),
  'publish.calendar.turn-off-failed': tpl('The calendar link was not turned off. Try again.'),

  // Today's line (the `watch` slot), and the short reason that follows "Not on the watch yet".
  'publish.line.on-watch': tpl('On your watch.'),
  'publish.line.sent': tpl('Sent to intervals.icu.'),
  'publish.line.eased': tpl('The watch has the easy version of this run.'),
  'publish.line.not-yet': tpl('Not on the watch yet: {reason}.', { reason: 'text' }),
  'publish.reason.not-sent': tpl('not sent yet', {}, { shape: 'label' }),
  'publish.reason.waiting': tpl('waiting to send', {}, { shape: 'label' }),
  'publish.reason.not-delivered': tpl('not delivered', {}, { shape: 'label' }),
  'publish.reason.removed': tpl('removed in intervals.icu', {}, { shape: 'label' }),
  'publish.reason.auth': tpl('reconnect intervals.icu', {}, { shape: 'label' }),
  'publish.reason.not-connected': tpl('connect intervals.icu', {}, { shape: 'label' }),
  'publish.reason.rate-limit': tpl('intervals.icu asked the app to wait', {}, { shape: 'label' }),
  'publish.reason.network': tpl('intervals.icu could not be reached', {}, { shape: 'label' }),
  'publish.reason.rejected': tpl('intervals.icu did not accept it', {}, { shape: 'label' }),
  'publish.reason.device': tpl('Garmin Connect did not take it', {}, { shape: 'label' }),
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
  | 'publish.wrist.not-found'

export function wristSentence(id: WristSentenceId): string {
  return render(PUBLISH_TEMPLATES[id], {}, STORED_UNITS)
}

/** The 400 of a status range that is too long: "Ask for at most 60 days, ending on or after the start." */
export function wristRangeSentence(maxDays: number): string {
  return render(
    PUBLISH_TEMPLATES['publish.wrist.range'],
    { days: { kind: 'count', n: maxDays } },
    STORED_UNITS,
  )
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

// ---------------------------------------------------------------------------------------------
// What the runner reads about a session on its way to the watch
// ---------------------------------------------------------------------------------------------

/** A template of the publish file that has no slot. */
type PlainTemplateId = {
  [K in PublishTemplateId]: PublishTemplate<K> extends Template<infer S>
    ? [keyof S] extends [never]
      ? K
      : never
    : never
}[PublishTemplateId]
type PublishTemplate<K extends PublishTemplateId> = (typeof PUBLISH_TEMPLATES)[K]

const say = (id: PlainTemplateId): string => render(PUBLISH_TEMPLATES[id], {}, STORED_UNITS)

/** The part of an item the words depend on. */
export type WristWording = Pick<
  WristItem,
  'status' | 'failCode' | 'failMessage' | 'deviceMessage' | 'retryAt'
>

const CHIPS: Record<WristItemStatus, PlainTemplateId | null> = {
  'not-sent': 'publish.chip.not-sent',
  waiting: 'publish.chip.waiting',
  sent: 'publish.chip.sent',
  'on-watch': 'publish.chip.on-watch',
  'not-delivered': 'publish.chip.not-delivered',
  removed: 'publish.chip.removed',
  // The app took it off on purpose (a rest day, a skipped session): nothing to flag.
  withdrawn: null,
}

/** The word on the chip of a status, or null for a status that has no chip. */
export function wristChipLabel(status: WristItemStatus): string | null {
  const id = CHIPS[status]
  return id === null ? null : say(id)
}

/** A device message that already ends in a full stop would double the one the sentence adds. */
const withoutFinalStops = (text: string): string => text.replace(/[.\s]+$/, '')

/** "It tries again at 14:20." while a retry is due, else nothing. */
function retrySentence(item: WristWording, retryTime: string | null): string {
  if (item.status !== 'waiting' || item.retryAt === null || retryTime === null) return ''
  return ` ${render(PUBLISH_TEMPLATES['publish.retry-at'], { time: retryTime }, STORED_UNITS)}`
}

/**
 * The sentence behind a status: the failure code when there is one (with the time of the retry
 * when one is due), else the status itself. The reason intervals.icu gave for refusing a workout
 * was stored whole when it happened (`failMessage`, already a sentence of `publish.rejected-*`),
 * so it is shown as it is. `retryTime` is the clock time of `retryAt` in the runner's day.
 */
export function wristItemSentence(item: WristWording, retryTime: string | null): string {
  if (item.status === 'removed') return say('publish.status.removed')
  if (item.status === 'withdrawn') return say('publish.status.withdrawn')
  if (item.deviceMessage !== null && item.status === 'not-delivered') {
    return render(
      PUBLISH_TEMPLATES['publish.device'],
      { message: withoutFinalStops(item.deviceMessage) },
      STORED_UNITS,
    )
  }
  switch (item.failCode) {
    case 'auth':
      return say('publish.auth')
    case 'not-connected':
      return say('publish.code.not-connected')
    case 'rate-limit':
      return `${say('publish.rate-limited')}${retrySentence(item, retryTime)}`
    case 'network':
      return `${say('publish.unreachable')}${retrySentence(item, retryTime)}`
    case 'device':
    case 'rejected':
    case 'no-threshold':
      if (item.failMessage !== null && item.failMessage !== '') return item.failMessage
      break
  }
  switch (item.status) {
    case 'not-sent':
      return say('publish.status.not-sent')
    case 'waiting':
      return `${say('publish.status.waiting')}${retrySentence(item, retryTime)}`
    case 'sent':
      return say('publish.status.sent')
    case 'on-watch':
      return say('publish.status.on-watch')
    case 'not-delivered':
      return say('publish.status.not-delivered')
  }
}

/** A few words for Today's line: why the run is not on the watch yet. */
export function wristShortReason(item: WristWording): string {
  if (item.status === 'removed') return say('publish.reason.removed')
  if (item.status === 'not-sent') return say('publish.reason.not-sent')
  if (item.deviceMessage !== null && item.status === 'not-delivered') {
    return say('publish.reason.device')
  }
  switch (item.failCode) {
    case 'auth':
      return say('publish.reason.auth')
    case 'not-connected':
      return say('publish.reason.not-connected')
    case 'rate-limit':
      return say('publish.reason.rate-limit')
    case 'network':
      return say('publish.reason.network')
    case 'rejected':
    case 'no-threshold':
      return say('publish.reason.rejected')
    case 'device':
      return say('publish.reason.device')
  }
  return say(item.status === 'waiting' ? 'publish.reason.waiting' : 'publish.reason.not-delivered')
}

/** The sentence of a warning code an upsert returned, or null for a code this build does not know. */
export function wristWarningSentence(code: string): string | null {
  switch (code) {
    case 'no-threshold-pace':
      return say('publish.warning.no-threshold-pace')
    case 'no-max-hr':
      return say('publish.warning.no-max-hr')
    case 'unparsed-steps':
      return say('publish.warning.unparsed-steps')
    default:
      return null
  }
}

/** How many sessions of the window sit in each group of the Plan strip. */
export interface WristCounts {
  sent: number
  waiting: number
  notDelivered: number
}

/** The tally of a window by what it means to the runner; `not-sent` counts as waiting. */
export function wristCounts(items: ReadonlyArray<Pick<WristItem, 'status'>>): WristCounts {
  const counts: WristCounts = { sent: 0, waiting: 0, notDelivered: 0 }
  for (const { status } of items) {
    if (status === 'sent' || status === 'on-watch') counts.sent += 1
    else if (status === 'waiting' || status === 'not-sent') counts.waiting += 1
    else if (status === 'not-delivered') counts.notDelivered += 1
  }
  return counts
}

/**
 * "Watch: next 14 days. 11 on your watch or sent, 2 waiting, 1 not delivered." A group with no
 * session is left out, and a window with none at all says there is nothing to send.
 */
export function wristStripSentence(counts: WristCounts, days: number): string {
  const groups: Array<
    [number, 'publish.strip.sent' | 'publish.strip.waiting' | 'publish.strip.not-delivered']
  > = [
    [counts.sent, 'publish.strip.sent'],
    [counts.waiting, 'publish.strip.waiting'],
    [counts.notDelivered, 'publish.strip.not-delivered'],
  ]
  const parts = groups
    .filter(([n]) => n > 0)
    .map(([n, id]) => render(PUBLISH_TEMPLATES[id], { n: { kind: 'count', n } }, STORED_UNITS))
  const window = { days: { kind: 'count', n: days } } as const
  if (parts.length === 0) {
    return render(PUBLISH_TEMPLATES['publish.strip.none'], window, STORED_UNITS)
  }
  return render(
    PUBLISH_TEMPLATES['publish.strip'],
    { ...window, counts: parts.join(', ') },
    STORED_UNITS,
  )
}

/** Today's line for one session, or null when the line has nothing to say (a withdrawn run). */
export function wristLineSentence(item: WristWording & Pick<WristItem, 'variant'>): string | null {
  switch (item.status) {
    case 'on-watch':
    case 'sent':
      if (item.variant === 'eased') return say('publish.line.eased')
      return say(item.status === 'on-watch' ? 'publish.line.on-watch' : 'publish.line.sent')
    case 'withdrawn':
      return null
    default:
      return render(
        PUBLISH_TEMPLATES['publish.line.not-yet'],
        { reason: wristShortReason(item) },
        STORED_UNITS,
      )
  }
}

/**
 * The fixed words of the Plan strip, the session sheet, the settings, the disconnect choice and the
 * calendar link: headings, notes, labels.
 */
export type WristPlainId =
  | 'publish.strip.heading'
  | 'publish.sheet.heading'
  | 'publish.strip.off'
  | 'publish.sheet.eased'
  | 'publish.action.send-again'
  | 'publish.action.integrations'
  | 'publish.settings.heading'
  | 'publish.settings.garmin'
  | 'publish.settings.garmin-help'
  | 'publish.settings.never-sent'
  | 'publish.settings.sending-now'
  | 'publish.settings.send-now'
  | 'publish.settings.dormant'
  | 'publish.settings.off-offer'
  | 'publish.settings.remove-sent'
  | 'publish.settings.turn-off'
  | 'publish.settings.keep'
  | 'publish.disconnect.button'
  | 'publish.disconnect.offer'
  | 'publish.disconnect.failed'
  | 'publish.disconnect.without'
  | 'publish.disconnect.cancel'
  | 'publish.calendar.heading'
  | 'publish.calendar.privacy'
  | 'publish.calendar.proxy'
  | 'publish.calendar.off'
  | 'publish.calendar.on-plain'
  | 'publish.calendar.not-shown'
  | 'publish.calendar.create'
  | 'publish.calendar.replace'
  | 'publish.calendar.turn-off'
  | 'publish.calendar.dialog'
  | 'publish.calendar.shown-once'
  | 'publish.calendar.address'
  | 'publish.calendar.copy'
  | 'publish.calendar.open'
  | 'publish.calendar.copied'
  | 'publish.calendar.copy-failed'
  | 'publish.calendar.turned-off'
  | 'publish.calendar.create-failed'
  | 'publish.calendar.turn-off-failed'

export function wristPlain(id: WristPlainId): string {
  return say(id)
}

/** "Send my next 14 days of runs to intervals.icu": the label of the switch that turns sending on. */
export function wristSendLabel(days: number): string {
  return render(
    PUBLISH_TEMPLATES['publish.settings.send'],
    { days: { kind: 'count', n: days } },
    STORED_UNITS,
  )
}

/** "Last send to intervals.icu: 13 Jan at 11:00.": `time` is the clock time where the runner is. */
export function wristLastSend(date: string, time: string): string {
  return render(
    PUBLISH_TEMPLATES['publish.settings.last-send'],
    { date: { kind: 'date', iso: date, style: 'short' }, time },
    STORED_UNITS,
  )
}

/** "The calendar link works. It was made on 13 Jan." */
export function calendarOnSentence(madeOn: string): string {
  return render(
    PUBLISH_TEMPLATES['publish.calendar.on'],
    { date: { kind: 'date', iso: madeOn, style: 'short' } },
    STORED_UNITS,
  )
}

/** "The calendar shows the next 28 days; the watch gets the next 14." */
export function calendarWindowSentence(calendarDays: number, watchDays: number): string {
  return render(
    PUBLISH_TEMPLATES['publish.calendar.window'],
    {
      calendarDays: { kind: 'count', n: calendarDays },
      watchDays: { kind: 'count', n: watchDays },
    },
    STORED_UNITS,
  )
}
