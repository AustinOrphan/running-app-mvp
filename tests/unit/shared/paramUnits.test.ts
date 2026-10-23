import { afterEach, describe, expect, test, vi } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  describeParamRange,
  describeParamValue,
  isMappedUnit,
} from '../../../shared/copy/paramUnits.ts'
import { CopyError } from '../../../shared/copy/template.ts'
import { allParams, P } from '../../../shared/engine/params/index.ts'
import type { Param } from '../../../shared/engine/types.ts'
import type { Units } from '../../../shared/types.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

const UNITS: Units[] = ['km', 'mi']

function param(partial: Partial<Param<unknown>> & { value: unknown }): Param<unknown> {
  return { id: 'x.y', grade: 'D', rule: 'x-1', evidence: [], ...partial }
}
const km = (p: Partial<Param<unknown>> & { value: unknown }) => describeParamValue(param(p), 'km')
const mi = (p: Partial<Param<unknown>> & { value: unknown }) => describeParamValue(param(p), 'mi')

describe('the whole registry', () => {
  const units = [...new Set(allParams().flatMap((p) => (p.unit === undefined ? [] : [p.unit])))]

  test('has units to check', () => {
    expect(units.length).toBeGreaterThan(100)
  })

  test.each(units)('the unit "%s" is mapped', (unit) => {
    expect(isMappedUnit(unit)).toBe(true)
  })

  test('every parameter reads in plain words in both unit systems', () => {
    for (const p of allParams()) {
      for (const system of UNITS) {
        const text = describeParamValue(p, system)
        const where = `${p.id} (${system}): ${text}`
        expect(text, where).not.toBe('')
        expect(text, where).not.toMatch(/NaN|undefined|null|\[object|\{value\}|—/)
        expect(lintText(text), where).toEqual([])
        // The unit follows the setting: no kilometres or metres in miles, and no miles or feet
        // in kilometres.
        if (system === 'mi') expect(text, where).not.toMatch(/\bkm\b|\d m\b/)
        else expect(text, where).not.toMatch(/\bmi\b|\bft\b|\bmph\b/)
        if (p.unit?.startsWith('fraction') === true) expect(text, where).not.toMatch(/fraction/)
        if (p.range) {
          const range = describeParamRange(p, system)
          expect(range, where).not.toBeNull()
          expect(range, where).not.toMatch(/NaN|undefined|null|\[object|\{value\}|—/)
        } else {
          expect(describeParamRange(p, system)).toBeNull()
        }
      }
    }
  })
})

describe('describeParamValue', () => {
  test('a fraction reads as a percentage of what it is a fraction of', () => {
    expect(km({ value: 0.2, unit: 'fraction of duration' })).toBe('20% of the duration')
    expect(describeParamValue(P.flib.fastFinishFraction, 'km')).toBe('20% of the duration')
    expect(km({ value: 0.823, unit: 'fraction of CS' })).toBe('82.3% of critical speed')
    expect(km({ value: 0.1, unit: 'fraction per week' })).toBe('10% per week')
    expect(km({ value: 1.2, unit: 'ratio of actual to planned minutes' })).toBe(
      '120% of planned minutes',
    )
  })

  test('percentages keep their value and gain words', () => {
    expect(km({ value: 5.5, unit: '%' })).toBe('5.5%')
    expect(km({ value: 28, unit: '% grade' })).toBe('28% grade')
    expect(km({ value: 0.35, unit: '% per C WBGT above 15 C' })).toBe(
      '0.35% per °C of WBGT above 15 °C',
    )
  })

  test('distances, weekly volume and paces follow the runner s units', () => {
    expect(km({ value: 21, unit: 'km' })).toBe('21 km')
    expect(mi({ value: 21, unit: 'km' })).toBe('13 mi')
    expect(mi({ value: 25, unit: 'km' })).toBe('15.5 mi')
    expect(km({ value: 32, unit: 'km/week' })).toBe('32 km per week')
    expect(mi({ value: 32, unit: 'km/week' })).toBe('19.9 mi per week')
    expect(km({ value: 420, unit: 'sec/km' })).toBe('7:00 /km')
    expect(mi({ value: 420, unit: 'sec/km' })).toBe('11:16 /mi')
    expect(km({ value: 400, unit: 'm' })).toBe('400 m')
    expect(mi({ value: 400, unit: 'm' })).toBe('0.25 mi')
    expect(mi({ value: 80467, unit: 'm' })).toBe('50 mi')
    expect(km({ value: 12, unit: 'km/h' })).toBe('12 km/h')
    expect(mi({ value: 12, unit: 'km/h' })).toBe('7.5 mph')
    expect(mi({ value: 0.5, unit: 'km/h below CS' })).toBe('0.31 mph below critical speed')
  })

  test('climb, altitude and climb rates read in metres or feet', () => {
    // 'm' is a distance, except for the two parameters that hold an elevation.
    expect(km(param({ id: 'h4.minStepGainM', value: 100, unit: 'm' }))).toBe('100 m')
    expect(mi(param({ id: 'h4.minStepGainM', value: 100, unit: 'm' }))).toBe('328 ft')
    expect(mi(param({ id: 'i12.altitudeFromM', value: 800, unit: 'm' }))).toBe('2625 ft')
    expect(km({ value: 800, unit: 'm/h' })).toBe('800 m per hour')
    expect(mi({ value: 800, unit: 'm/h' })).toBe('2625 ft per hour')
    expect(km({ value: 10, unit: 'm of ascent per km' })).toBe('10 m of ascent per km')
    expect(mi({ value: 10, unit: 'm of ascent per km' })).toBe('53 ft of ascent per mile')
    expect(mi({ value: 15, unit: 'm of climb per km' })).toBe('79 ft of climb per mile')
    expect(mi({ value: 30, unit: 'm of descent per km' })).toBe('158 ft of descent per mile')
    expect(km({ value: 1, unit: '% per m of gain per km' })).toBe('1% per m of gain per km')
    expect(mi({ value: 1, unit: '% per m of gain per km' })).toBe('1% per 5.3 ft of gain per mile')
    expect(mi({ value: 8, unit: '% slower at 161 km in a hot year' })).toBe(
      '8% slower at 100 mi in a hot year',
    )
  })

  test('times, temperatures and clock hours', () => {
    expect(km({ value: 90, unit: 'min' })).toBe('90 min')
    expect(km({ value: 9000, unit: 's' })).toBe('2 h 30 min')
    expect(km({ value: 240, unit: 'sec' })).toBe('4 min')
    expect(km({ value: 20, unit: 'sec' })).toBe('20 s')
    expect(km({ value: 48, unit: 'h' })).toBe('48 h')
    expect(km({ value: 25, unit: 'C' })).toBe('25 °C')
    expect(km({ value: 18, unit: 'C WBGT' })).toBe('18 °C WBGT')
    expect(km({ value: 6, unit: 'hour of day' })).toBe('06:00')
    expect(km({ value: 20, unit: 'hour of day' })).toBe('20:00')
  })

  test('counts are singular for one', () => {
    expect(km({ value: 1, unit: 'days' })).toBe('1 day')
    expect(km({ value: 14, unit: 'days' })).toBe('14 days')
    expect(km({ value: 1, unit: 'years' })).toBe('1 year')
    expect(km({ value: 1, unit: 'trims per week' })).toBe('1 trim per week')
    expect(km({ value: 3, unit: 'efforts' })).toBe('3 efforts')
  })

  test('no unit reads as a plain number, trimmed', () => {
    expect(km({ value: 1.92 })).toBe('1.92')
    expect(km({ value: 1.3333333333333333, unit: 'ratio' })).toBe('a ratio of 1.333')
    expect(km({ value: 1, unit: 'ratio per week' })).toBe('100% of the previous week')
  })

  test('two values are a range, three or more a list', () => {
    expect(km({ value: [28, 32], unit: 'km' })).toBe('28 to 32 km')
    expect(mi({ value: [28, 32], unit: 'km' })).toBe('17.4 to 19.9 mi')
    expect(km({ value: [0.4, 0.59], unit: 'fraction of the pre-taper reference week' })).toBe(
      '40 to 59% of the pre-taper reference week',
    )
    expect(
      km({ value: [0.75, 0.55, 0.35], unit: 'fraction of the pre-taper reference week' }),
    ).toBe('75%, 55%, 35% of the pre-taper reference week')
    expect(km({ value: [0.75, 0.55, 0.35] })).toBe('0.75, 0.55, 0.35')
    expect(km({ value: [1000, 2000, 3500], unit: 'm' })).toBe('1 km, 2 km, 3.5 km')
    expect(km({ value: [400, 5000], unit: 'm' })).toBe('400 m to 5 km')
    expect(km({ value: [7.5, 15], unit: 'C WBGT' })).toBe('7.5 to 15 °C WBGT')
    expect(km({ value: [0, 0], unit: 'CR-10' })).toBe('0 on the CR-10 scale')
    expect(km({ value: [5, 10, 15], unit: 'min of continuous easy running per run' })).toBe(
      '5, 10, 15 min of continuous easy running per run',
    )
  })

  test('a taper sequence is a list, not a range', () => {
    expect(
      km(
        param({
          id: 'k2.twoWeekMultipliers',
          value: [0.65, 0.4],
          unit: 'fraction of the pre-taper reference week',
        }),
      ),
    ).toBe('65%, 40% of the pre-taper reference week')
  })

  test('a range is described with the same words as the value', () => {
    const p = param({ value: 3, range: [2, 4], unit: 'CR-10' })
    expect(describeParamValue(p, 'km')).toBe('3 on the CR-10 scale')
    expect(describeParamRange(p, 'km')).toBe('2 to 4 on the CR-10 scale')
    const q = param({ value: 0.3, range: [0.25, 0.35], unit: 'fraction over any 2-week window' })
    expect(describeParamRange(q, 'km')).toBe('25 to 35% over any 2-week window')
  })

  test('a value that is not numbers still reads without throwing', () => {
    expect(km({ value: 'on', unit: 'days' })).toBe('on')
    expect(km({ value: [[1, 2], [3]], unit: 'min of running and walking per session' })).toBe(
      '1, 2; 3',
    )
    expect(km({ value: [1, Number.NaN] })).toBe('1, —')
  })

  test('an unmapped unit throws under test and keeps the raw unit in production', () => {
    const odd = param({ value: 3, unit: 'furlongs per fortnight' })
    expect(isMappedUnit('furlongs per fortnight')).toBe(false)
    expect(() => describeParamValue(odd, 'km')).toThrow(CopyError)
    expect(() => describeParamValue(odd, 'km')).toThrow(/furlongs per fortnight/)
    vi.stubEnv('NODE_ENV', 'production')
    expect(describeParamValue(odd, 'km')).toBe('3 furlongs per fortnight')
  })
})
