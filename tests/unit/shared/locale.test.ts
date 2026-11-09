import { describe, expect, test } from 'vitest'
import { unitsForLocale } from '../../../shared/domain/locale.ts'

describe('unitsForLocale', () => {
  test('en-US gives miles and pounds', () => {
    expect(unitsForLocale('en-US')).toEqual({ units: 'mi', weightUnit: 'lb' })
    expect(unitsForLocale('en-us')).toEqual({ units: 'mi', weightUnit: 'lb' })
  })

  test.each(['en-GB', 'de-DE', 'fr', 'en', 'pt-BR', 'ja-JP'])(
    '%s gives kilometres and kilograms',
    (locale) => {
      expect(unitsForLocale(locale)).toEqual({ units: 'km', weightUnit: 'kg' })
    },
  )

  test('a locale that cannot be read gives kilometres and kilograms', () => {
    expect(unitsForLocale(undefined)).toEqual({ units: 'km', weightUnit: 'kg' })
    expect(unitsForLocale('')).toEqual({ units: 'km', weightUnit: 'kg' })
    expect(unitsForLocale('not a locale!!')).toEqual({ units: 'km', weightUnit: 'kg' })
  })
})
