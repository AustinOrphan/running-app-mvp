import { describe, expect, test } from 'vitest'
import { formatNumber, formatQuantity, quantityIssue } from '../../../shared/copy/quantity.ts'
import type { Quantity } from '../../../shared/engine/types.ts'
import type { Units } from '../../../shared/types.ts'

const UNITS: Units[] = ['km', 'mi']

/** A valid example of every kind, so a new kind without a case here fails the exhaustive check. */
const EXAMPLES: Record<Quantity['kind'], Quantity> = {
  pace: { kind: 'pace', secPerKm: 330 },
  speed: { kind: 'speed', kmh: 12 },
  distance: { kind: 'distance', m: 5000 },
  climb: { kind: 'climb', m: 60 },
  duration: { kind: 'duration', sec: 6300 },
  minutes: { kind: 'minutes', min: 45 },
  bpm: { kind: 'bpm', bpm: 149 },
  percent: { kind: 'percent', pct: 5.5 },
  share: { kind: 'share', fraction: 0.2 },
  count: { kind: 'count', n: 212 },
  temp: { kind: 'temp', c: 24.5 },
  date: { kind: 'date', iso: '2026-10-19' },
  weekday: { kind: 'weekday', iso: '2026-10-19' },
}

describe('formatQuantity', () => {
  test('paces follow the units', () => {
    const q: Quantity = { kind: 'pace', secPerKm: 330 }
    expect(formatQuantity(q, 'km')).toBe('5:30 /km')
    expect(formatQuantity(q, 'mi')).toBe('8:51 /mi')
  })

  test('distances read in km or mi, and short ones in metres', () => {
    const at = (m: number, units: Units) => formatQuantity({ kind: 'distance', m }, units)
    expect(at(5000, 'km')).toBe('5 km')
    expect(at(5000, 'mi')).toBe('3.1 mi')
    expect(at(42195, 'km')).toBe('42.2 km')
    expect(at(42195, 'mi')).toBe('26.2 mi')
    expect(at(1500, 'km')).toBe('1.5 km')
    expect(at(1000, 'km')).toBe('1 km')
    expect(at(999, 'km')).toBe('999 m')
    expect(at(400, 'km')).toBe('400 m')
    expect(at(400, 'mi')).toBe('0.25 mi')
    expect(at(160934, 'mi')).toBe('100 mi')
    expect(at(100000, 'km')).toBe('100 km')
    expect(at(0, 'km')).toBe('0 m')
  })

  test('climb is metres for km and feet for miles', () => {
    expect(formatQuantity({ kind: 'climb', m: 60 }, 'km')).toBe('60 m')
    expect(formatQuantity({ kind: 'climb', m: 60 }, 'mi')).toBe('197 ft')
    expect(formatQuantity({ kind: 'climb', m: -12 }, 'km')).toBe('-12 m')
  })

  test('speeds read in km/h or mph', () => {
    expect(formatQuantity({ kind: 'speed', kmh: 12 }, 'km')).toBe('12 km/h')
    expect(formatQuantity({ kind: 'speed', kmh: 12 }, 'mi')).toBe('7.5 mph')
  })

  test('durations read in seconds, minutes and hours', () => {
    const at = (sec: number) => formatQuantity({ kind: 'duration', sec }, 'km')
    expect(at(20)).toBe('20 s')
    expect(at(90)).toBe('1 min 30 s')
    expect(at(240)).toBe('4 min')
    expect(at(2700)).toBe('45 min')
    expect(at(6300)).toBe('1 h 45 min')
    expect(at(7200)).toBe('2 h')
    expect(at(99600)).toBe('27 h 40 min')
    // Rounding never produces "59 min 60 s".
    expect(at(3599.6)).toBe('1 h')
    expect(at(0)).toBe('0 s')
  })

  test('plan minutes keep minutes', () => {
    expect(formatQuantity({ kind: 'minutes', min: 105 }, 'km')).toBe('105 min')
    expect(formatQuantity({ kind: 'minutes', min: 1.5 }, 'km')).toBe('1.5 min')
  })

  test('heart rate, percentages, shares, counts and temperatures', () => {
    expect(formatQuantity({ kind: 'bpm', bpm: 149 }, 'km')).toBe('149 bpm')
    expect(formatQuantity({ kind: 'bpm', bpm: 10.8 }, 'km')).toBe('10.8 bpm')
    expect(formatQuantity({ kind: 'percent', pct: 5.5 }, 'km')).toBe('5.5%')
    expect(formatQuantity({ kind: 'percent', pct: 13 }, 'km')).toBe('13%')
    expect(formatQuantity({ kind: 'percent', pct: 0.35 }, 'km')).toBe('0.35%')
    expect(formatQuantity({ kind: 'share', fraction: 0.2 }, 'km')).toBe('20%')
    expect(formatQuantity({ kind: 'share', fraction: 0.823 }, 'km')).toBe('82.3%')
    expect(formatQuantity({ kind: 'share', fraction: 1 }, 'km')).toBe('100%')
    expect(formatQuantity({ kind: 'count', n: 212 }, 'km')).toBe('212')
    expect(formatQuantity({ kind: 'temp', c: 24.5 }, 'km')).toBe('24.5 °C')
  })

  test('dates and weekdays never print the ISO form', () => {
    const date = (style?: 'short' | 'weekday' | 'long'): Quantity =>
      style === undefined
        ? { kind: 'date', iso: '2026-10-19' }
        : { kind: 'date', iso: '2026-10-19', style }
    expect(formatQuantity(date(), 'km')).toBe('19 Oct')
    expect(formatQuantity(date('short'), 'km')).toBe('19 Oct')
    expect(formatQuantity(date('weekday'), 'km')).toBe('Mon 19 Oct')
    expect(formatQuantity(date('long'), 'km')).toBe('Mon 19 Oct 2026')
    expect(formatQuantity({ kind: 'weekday', iso: '2026-10-19' }, 'km')).toBe('Mon')
    expect(formatQuantity({ kind: 'weekday', iso: '2026-10-19', style: 'long' }, 'km')).toBe(
      'Monday',
    )
  })

  test('every kind has an example that reads without an ISO date, NaN or undefined', () => {
    for (const units of UNITS) {
      for (const q of Object.values(EXAMPLES)) {
        const text = formatQuantity(q, units)
        expect(text, q.kind).not.toBe('')
        expect(text, q.kind).not.toMatch(/NaN|undefined|null|\d{4}-\d{2}-\d{2}/)
        expect(quantityIssue(q), q.kind).toBeNull()
      }
    }
  })

  test('a value that cannot be shown prints a dash, never NaN or undefined', () => {
    const bad: unknown[] = [
      { kind: 'pace', secPerKm: Number.NaN },
      { kind: 'pace', secPerKm: 0 },
      { kind: 'pace', secPerKm: -5 },
      { kind: 'speed', kmh: Number.POSITIVE_INFINITY },
      { kind: 'distance', m: Number.NaN },
      { kind: 'distance', m: -1 },
      { kind: 'climb', m: Number.NaN },
      { kind: 'duration', sec: -1 },
      { kind: 'duration', sec: Number.NaN },
      { kind: 'minutes', min: Number.NaN },
      { kind: 'bpm', bpm: Number.NEGATIVE_INFINITY },
      { kind: 'percent', pct: Number.NaN },
      { kind: 'share', fraction: Number.NaN },
      { kind: 'count', n: Number.NaN },
      { kind: 'temp', c: Number.NaN },
      { kind: 'date', iso: 'not a date' },
      { kind: 'date', iso: '2026-02-30' },
      { kind: 'date', iso: '2026-10-19T08:00:00Z' },
      { kind: 'weekday', iso: '' },
      { kind: 'pace' },
      { kind: 'pace', secPerKm: '330' },
      { kind: 'nonsense', n: 1 },
      { kind: 'date', iso: undefined },
      null,
      undefined,
      42,
      '5 km',
    ]
    for (const q of bad) {
      for (const units of UNITS) {
        const text = formatQuantity(q as Quantity, units)
        expect(text, JSON.stringify(q)).toBe('—')
        expect(quantityIssue(q), JSON.stringify(q)).not.toBeNull()
      }
    }
  })

  test('an unknown date style falls back to the short form', () => {
    const q = { kind: 'date', iso: '2026-10-19', style: 'odd' } as unknown as Quantity
    expect(formatQuantity(q, 'km')).toBe('19 Oct')
  })
})

describe('formatNumber', () => {
  test('keeps three decimals below 10 and two above, without trailing zeros', () => {
    expect(formatNumber(0.823)).toBe('0.823')
    expect(formatNumber(1.3333333333333333)).toBe('1.333')
    expect(formatNumber(0.35)).toBe('0.35')
    expect(formatNumber(12.34567)).toBe('12.35')
    expect(formatNumber(155.4)).toBe('155.4')
    expect(formatNumber(155.444)).toBe('155.44')
    expect(formatNumber(1013.25)).toBe('1013.25')
    expect(formatNumber(-30.4)).toBe('-30.4')
    expect(formatNumber(5)).toBe('5')
    expect(formatNumber(1000)).toBe('1000')
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(-0)).toBe('0')
  })
})
