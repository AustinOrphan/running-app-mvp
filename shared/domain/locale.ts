import type { Units, WeightUnit } from '../types.ts'

/**
 * The units a browser locale implies: miles and pounds for the United States (`en-US`), kilometres
 * and kilograms for every other locale and for one that cannot be read. A starting point only; the
 * runner changes either in Settings.
 */
export function unitsForLocale(locale: string | undefined): {
  units: Units
  weightUnit: WeightUnit
} {
  let region: string | undefined
  try {
    region = locale === undefined ? undefined : new Intl.Locale(locale).region
  } catch {
    region = undefined
  }
  return region === 'US' ? { units: 'mi', weightUnit: 'lb' } : { units: 'km', weightUnit: 'kg' }
}
