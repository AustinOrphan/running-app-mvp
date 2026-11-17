import { describe, expect, test } from 'vitest'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import {
  ageFormulaText,
  boundaryOriginText,
  boundarySourceText,
  ZONE_SOURCE_TEMPLATES,
} from '../../../shared/copy/zoneSources.ts'
import type { Boundary } from '../../../shared/engine/types.ts'

const SOURCES: Boundary['source'][] = [
  'tested',
  'cs',
  'dfa',
  'rpe',
  'hrmax-observed',
  'hrmax-age',
  'hrr',
  'profile',
  'own-line',
]

describe('zone source copy', () => {
  test('every template is registered in the one registry the copy lint renders', () => {
    for (const id of Object.keys(ZONE_SOURCE_TEMPLATES)) expect(TEMPLATES).toHaveProperty(id)
  })

  test('every source has a label, and none claims a heart rate the app saw', () => {
    for (const source of SOURCES) {
      const text = boundarySourceText({ source })
      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toMatch(/highest heart rate seen|observed/i)
      assertCleanCopy(text)
    }
  })

  test('says typed for a typed maximum, the formula for an age estimate, accepted for an offer', () => {
    expect(boundarySourceText({ source: 'hrmax-observed' })).toBe(
      'Typed on your profile, as measured in a test or race',
    )
    expect(boundarySourceText({ source: 'profile' })).toBe('Set on your profile')
    expect(boundarySourceText({ source: 'hrmax-age' })).toBe(
      'Estimated from your age (maximum = 208 - 0.7 x age)',
    )
    expect(ageFormulaText()).toBe('208 - 0.7 x age')
    expect(boundarySourceText({ source: 'own-line' })).toMatch(/^From an offer you accepted/)
  })

  test('keeps the training notes of rule A6', () => {
    expect(boundarySourceText({ source: 'cs', fromTraining: true })).toBe(
      'From critical speed (from training)',
    )
    expect(boundarySourceText({ source: 'cs', fromTraining: true, windowWidened: true })).toBe(
      'From critical speed (from training, some older than three months)',
    )
  })

  describe('the day', () => {
    const base = { asOf: '2026-11-17' }

    test('is the profile save for a typed anchor, never the day it was worked out', () => {
      const text = boundaryOriginText({ ...base, source: 'hrmax-observed', since: '2026-11-10' })
      expect(text).toBe(
        'Typed on your profile, as measured in a test or race, profile last saved Tue 10 Nov 2026',
      )
      expect(text).not.toContain('17 Nov')
    })

    test('is the acceptance for an own ceiling', () => {
      expect(boundaryOriginText({ ...base, source: 'own-line', since: '2026-11-12' })).toMatch(
        /, offer accepted Thu 12 Nov 2026$/,
      )
    })

    test('is dropped for a typed anchor with no known day', () => {
      expect(boundaryOriginText({ ...base, source: 'profile' })).toBe('Set on your profile')
      expect(boundaryOriginText({ ...base, source: 'own-line' })).not.toMatch(/\d{4}/)
    })

    test('is the day worked out for a computed boundary', () => {
      expect(boundaryOriginText({ ...base, source: 'cs' })).toBe(
        'From critical speed, as of Tue 17 Nov 2026',
      )
      expect(boundaryOriginText({ ...base, source: 'hrmax-age' })).toMatch(
        /, as of Tue 17 Nov 2026$/,
      )
    })
  })
})
