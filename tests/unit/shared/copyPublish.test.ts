import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  httpStatusSentence,
  PUBLISH_TEMPLATES,
  publishSentence,
  rejectedReasonSentence,
  rejectedSentence,
  type PublishSentenceId,
  type PublishTemplateId,
} from '../../../shared/copy/publish.ts'
import { render, sampleSlots, type Template } from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'

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

  it('shows the service words as a slot, outside the lint', () => {
    // A word the lint bans is the service's own and is shown as it came.
    expect(rejectedReasonSentence('Upload failed')).toBe(
      'intervals.icu did not accept the workout: Upload failed',
    )
  })
})
