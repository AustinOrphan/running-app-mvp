import { describe, expect, test } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { LOAD_ERROR_TEMPLATES, loadErrorText } from '../../../shared/copy/loadError.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'

describe('loadErrorText', () => {
  test('names what did not load, says what to do and labels the one button', () => {
    expect(loadErrorText('Activities', true)).toEqual({
      title: 'Activities did not load.',
      body: 'The server did not answer. Try again in a moment.',
      retry: 'Try again',
    })
  })

  test('says the device is offline when the browser knows it', () => {
    expect(loadErrorText('The activity', false).body).toBe(
      'This device is offline. Try again once it is connected.',
    )
  })

  test('every template is registered and passes the copy lint', () => {
    for (const [id, template] of Object.entries(LOAD_ERROR_TEMPLATES)) {
      expect(TEMPLATES).toHaveProperty([id])
      expect(lintText(template.text.replace('{what}', 'Activities'))).toEqual([])
    }
  })
})
