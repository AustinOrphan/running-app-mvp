import { describe, expect, it } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  httpStatusSentence,
  PUBLISH_TEMPLATES,
  publishSentence,
  rejectedReasonSentence,
  rejectedSentence,
  wristChipLabel,
  wristCounts,
  wristItemSentence,
  wristLineSentence,
  wristPlain,
  wristRangeSentence,
  wristSendLabel,
  wristSentence,
  wristShortReason,
  wristStripSentence,
  wristWarningSentence,
  type PublishSentenceId,
  type PublishTemplateId,
  type WristSentenceId,
  type WristWording,
} from '../../../shared/copy/publish.ts'
import { render, sampleSlots, type Template } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import {
  fileRefusalSentence,
  weekLinkLabel,
  workoutLinkLabel,
} from '../../../shared/copy/workouts.ts'
import type { WristItemStatus } from '../../../shared/types.ts'
import { STATUS_MAX_DAYS } from '../../../shared/workouts/horizon.ts'

const ids = Object.keys(PUBLISH_TEMPLATES) as PublishTemplateId[]

describe('the publish templates', () => {
  it.each(ids)('%s is registered, so the shared lint test renders it', (id) => {
    expect(id.startsWith('publish.')).toBe(true)
    expect(TEMPLATES[id]).toBe(PUBLISH_TEMPLATES[id])
  })

  it.each(ids)('%s renders clean, and so does its fallback', (id) => {
    const template: Template = PUBLISH_TEMPLATES[id]
    for (const text of [render(template, sampleSlots(template), 'km'), template.fallback]) {
      expect(lintText(text), text).toEqual([])
      if (template.shape === 'sentence') expect(text, id).toMatch(/\.$/)
    }
  })

  it('words each sentence the publisher stores', () => {
    const fixed: Record<PublishSentenceId, string> = {
      'publish.not-connected': 'intervals.icu is not connected.',
      'publish.unreachable': 'intervals.icu could not be reached.',
      'publish.auth':
        'intervals.icu did not accept the API key. Reconnect it on the Integrations page.',
      'publish.rate-limited': 'intervals.icu asked the app to wait.',
      'publish.event-removed': 'The event was removed in intervals.icu.',
      'publish.no-event': 'intervals.icu did not say which event it created.',
      'publish.unreadable': 'intervals.icu answered with text that could not be read.',
    }
    for (const [id, text] of Object.entries(fixed)) {
      expect(publishSentence(id as PublishSentenceId), id).toBe(text)
    }
    expect(httpStatusSentence(502)).toBe('intervals.icu answered HTTP 502.')
    expect(rejectedSentence(422)).toBe('intervals.icu did not accept the workout (HTTP 422).')
    expect(rejectedReasonSentence('Cannot read step 3')).toBe(
      'intervals.icu did not accept the workout: Cannot read step 3',
    )
  })

  it('words each answer of the wrist routes', () => {
    const fixed: Record<WristSentenceId, string> = {
      'publish.wrist.connect': 'Connect intervals.icu first.',
      'publish.wrist.reconnect': 'Reconnect intervals.icu first.',
      'publish.wrist.off': 'Sending to your watch is off. Turn it on under Integrations.',
      'publish.wrist.remove-failed':
        'The sessions already sent could not be removed from intervals.icu, so it stays connected. Try again, or disconnect without removing them.',
      'publish.wrist.not-found': 'That session is not in the active plan.',
    }
    for (const [id, text] of Object.entries(fixed)) {
      expect(wristSentence(id as WristSentenceId), id).toBe(text)
    }
  })

  it('names the number of days the status route enforces, whatever it is', () => {
    expect(wristRangeSentence(STATUS_MAX_DAYS)).toBe(
      `Ask for at most ${String(STATUS_MAX_DAYS)} days, ending on or after the start.`,
    )
    expect(wristRangeSentence(31)).toBe('Ask for at most 31 days, ending on or after the start.')
  })

  it('shows the service words as a slot, outside the lint', () => {
    // A word the lint bans is the service's own and is shown as it came.
    expect(rejectedReasonSentence('Upload failed')).toBe(
      'intervals.icu did not accept the workout: Upload failed',
    )
  })
})

// ---------------------------------------------------------------------------------------------
// What the runner reads about a session on its way to the watch (design 6.7)
// ---------------------------------------------------------------------------------------------

const STATUSES: WristItemStatus[] = [
  'not-sent',
  'waiting',
  'sent',
  'on-watch',
  'not-delivered',
  'removed',
  'withdrawn',
]
const CODES = [
  'auth',
  'rate-limit',
  'no-threshold',
  'rejected',
  'network',
  'device',
  'not-connected',
  'owner-removed',
] as const

function wording(over: Partial<WristWording> = {}): WristWording {
  return {
    status: 'waiting',
    failCode: null,
    failMessage: null,
    deviceMessage: null,
    retryAt: null,
    ...over,
  }
}

describe('the chip of a status', () => {
  it('is a short word for every status the app tells the runner about, and none for a withdrawn run', () => {
    expect(Object.fromEntries(STATUSES.map((status) => [status, wristChipLabel(status)]))).toEqual({
      'not-sent': 'Not sent yet',
      waiting: 'Waiting to send',
      sent: 'Sent to intervals.icu',
      'on-watch': 'On your watch',
      'not-delivered': 'Not delivered',
      removed: 'Removed in intervals.icu',
      withdrawn: null,
    })
  })
})

describe('the sentence behind a status', () => {
  it('words every status and every failure code, clean and short', () => {
    const sentences: string[] = []
    for (const status of STATUSES) {
      sentences.push(wristItemSentence(wording({ status }), '14:20'))
      for (const failCode of CODES) {
        sentences.push(
          wristItemSentence(
            wording({
              status,
              failCode,
              failMessage: 'intervals.icu did not accept the workout (HTTP 422).',
              retryAt: '2026-10-21T14:20:00.000Z',
            }),
            '14:20',
          ),
        )
      }
      sentences.push(
        wristItemSentence(
          wording({ status, deviceMessage: 'Upload to Garmin Connect is off' }),
          '14:20',
        ),
      )
    }
    for (const text of sentences) {
      expect(text, text).not.toBe('')
      expect(lintText(text), text).toEqual([])
      // a sentence and the retry that may follow it
      expect(text.length, text).toBeLessThanOrEqual(COPY_MAX_CHARS + 30)
      expect(text, text).toMatch(/\.$/)
    }
  })

  it('says what spec 6.7 gives as its examples', () => {
    expect(wristItemSentence(wording({ status: 'not-delivered', failCode: 'auth' }), null)).toBe(
      'intervals.icu did not accept the API key. Reconnect it on the Integrations page.',
    )
    expect(
      wristItemSentence(
        wording({ status: 'waiting', failCode: 'rate-limit', retryAt: '2026-10-21T14:20:00.000Z' }),
        '14:20',
      ),
    ).toBe('intervals.icu asked the app to wait. It tries again at 14:20.')
    expect(
      wristItemSentence(
        wording({ status: 'not-delivered', deviceMessage: 'Workout is too long for the watch' }),
        null,
      ),
    ).toBe('Garmin Connect did not take it: Workout is too long for the watch.')
    expect(wristItemSentence(wording({ status: 'removed', failCode: 'owner-removed' }), null)).toBe(
      'You removed this one in intervals.icu, so the app leaves it alone.',
    )
  })

  it('names the retry only while one is due', () => {
    const waiting = wording({ failCode: 'network', retryAt: '2026-10-21T14:20:00.000Z' })
    expect(wristItemSentence(waiting, '14:20')).toBe(
      'intervals.icu could not be reached. It tries again at 14:20.',
    )
    // a failure that waits for the runner has no time to name
    expect(wristItemSentence({ ...waiting, status: 'not-delivered', retryAt: null }, null)).toBe(
      'intervals.icu could not be reached.',
    )
    expect(wristItemSentence(wording({ failCode: 'network' }), '14:20')).toBe(
      'intervals.icu could not be reached.',
    )
  })

  it('shows a rejection as the sentence stored when it happened, and a device message with one full stop', () => {
    const stored = 'intervals.icu did not accept the workout: Cannot read step 3'
    expect(
      wristItemSentence(
        wording({ status: 'not-delivered', failCode: 'rejected', failMessage: stored }),
        null,
      ),
    ).toBe(stored)
    expect(
      wristItemSentence(
        wording({ status: 'not-delivered', deviceMessage: 'No space left...' }),
        null,
      ),
    ).toBe('Garmin Connect did not take it: No space left.')
  })

  it('falls back to the status when a code has no stored sentence', () => {
    expect(
      wristItemSentence(wording({ status: 'not-delivered', failCode: 'rejected' }), null),
    ).toBe('This run did not reach the watch. Send it again, or download the workout file.')
    expect(wristItemSentence(wording({ status: 'sent' }), null)).toBe('intervals.icu has this run.')
    expect(wristItemSentence(wording({ status: 'on-watch' }), null)).toBe(
      'intervals.icu has this run and uploads it to Garmin Connect.',
    )
  })
})

describe('the warnings of a send', () => {
  it('words the three codes an upsert returns, and nothing for one it does not know', () => {
    expect(wristWarningSentence('no-threshold-pace')).toBe(
      'intervals.icu has no running threshold pace yet, so pace targets are written in the text of each step only. Set it in intervals.icu under Settings, Run.',
    )
    for (const code of ['no-max-hr', 'unparsed-steps']) {
      const text = wristWarningSentence(code)!
      expect(text, code).toMatch(/\.$/)
      expect(lintText(text), code).toEqual([])
    }
    expect(wristWarningSentence('something-new')).toBeNull()
  })
})

describe('the Plan strip', () => {
  it('counts what is on the watch or sent, waiting and not delivered, and leaves empty groups out', () => {
    const items = (...statuses: WristItemStatus[]) => statuses.map((status) => ({ status }))
    const counts = wristCounts([
      ...items('on-watch', 'on-watch', 'sent'),
      ...items('waiting', 'not-sent'),
      ...items('not-delivered', 'removed', 'withdrawn'),
    ])
    expect(counts).toEqual({ sent: 3, waiting: 2, notDelivered: 1 })
    expect(wristStripSentence(counts, 14)).toBe(
      'Watch: next 14 days. 3 on your watch or sent, 2 waiting, 1 not delivered.',
    )
    expect(wristStripSentence({ sent: 11, waiting: 0, notDelivered: 0 }, 14)).toBe(
      'Watch: next 14 days. 11 on your watch or sent.',
    )
    expect(wristStripSentence({ sent: 0, waiting: 0, notDelivered: 0 }, 14)).toBe(
      'Watch: next 14 days. No runs to send.',
    )
  })
})

describe("Today's line", () => {
  it('has one sentence for each state it speaks of, and nothing for a withdrawn run', () => {
    const line = (over: Partial<WristWording & { variant: 'planned' | 'eased' }>) =>
      wristLineSentence({ ...wording(), variant: 'planned', ...over })
    expect(line({ status: 'on-watch' })).toBe('On your watch.')
    expect(line({ status: 'sent' })).toBe('Sent to intervals.icu.')
    expect(line({ status: 'on-watch', variant: 'eased' })).toBe(
      'The watch has the easy version of this run.',
    )
    expect(line({ status: 'sent', variant: 'eased' })).toBe(
      'The watch has the easy version of this run.',
    )
    expect(line({ status: 'waiting' })).toBe('Not on the watch yet: waiting to send.')
    expect(line({ status: 'not-sent' })).toBe('Not on the watch yet: not sent yet.')
    expect(line({ status: 'not-delivered', failCode: 'auth' })).toBe(
      'Not on the watch yet: reconnect intervals.icu.',
    )
    expect(line({ status: 'removed' })).toBe('Not on the watch yet: removed in intervals.icu.')
    expect(line({ status: 'withdrawn' })).toBeNull()
  })

  it('gives every failure code a short reason that passes the lint', () => {
    for (const failCode of CODES) {
      const reason = wristShortReason(wording({ status: 'not-delivered', failCode }))
      expect(reason, failCode).not.toBe('')
      expect(lintText(reason), failCode).toEqual([])
      expect(reason.length, failCode).toBeLessThanOrEqual(40)
    }
    expect(wristShortReason(wording({ status: 'not-delivered', deviceMessage: 'x' }))).toBe(
      'Garmin Connect did not take it',
    )
  })
})

describe('the fixed words of the strip and the sheet', () => {
  it('render clean', () => {
    for (const id of [
      'publish.strip.heading',
      'publish.sheet.heading',
      'publish.sheet.off',
      'publish.sheet.eased',
      'publish.action.send-again',
      'publish.action.integrations',
      'publish.settings.heading',
      'publish.settings.garmin',
      'publish.settings.garmin-help',
    ] as const) {
      expect(lintText(wristPlain(id)), id).toEqual([])
    }
    expect(wristSendLabel(14)).toBe('Send my next 14 days of runs to intervals.icu')
    expect(lintText(wristSendLabel(14))).toEqual([])
    expect(wristPlain('publish.sheet.off')).toBe(
      'Sending to your watch is off. Download the workout file, or turn it on under Integrations.',
    )
    expect(wristPlain('publish.sheet.eased')).toBe(
      "Today's readiness eased this session. The watch has the easy version; this page keeps the plan.",
    )
  })
})

describe('the download refusals', () => {
  it('have the sentence of the route for every reason', () => {
    expect(fileRefusalSentence('rest-advice')).toBe(
      'Rest is the better choice today, so there is no workout file.',
    )
    for (const reason of ['not-a-run', 'settled', 'rest-advice', 'empty'] as const) {
      expect(lintText(fileRefusalSentence(reason)), reason).toEqual([])
    }
    expect(workoutLinkLabel('workout.link.file')).toBe('Download the workout file')
    expect(workoutLinkLabel('workout.link.week')).toBe('Download this week as .zip')
    expect(weekLinkLabel('2026-10-26')).toBe('Download the week of 26 Oct as .zip')
  })
})
