import { describe, expect, test } from 'vitest'
import {
  formatDistance,
  formatDuration,
  formatPace,
  kmToM,
  milesToM,
  minutesToHours1,
  mToKm,
  mToMiles,
} from '../../../shared/units.ts'

describe('units', () => {
  test('conversions use 1609.344 m per mile', () => {
    expect(milesToM(1)).toBe(1609.344)
    expect(mToMiles(1609.344)).toBe(1)
    expect(kmToM(5)).toBe(5000)
    expect(mToKm(5000)).toBe(5)
  })

  test('formatDuration', () => {
    expect(formatDuration(59)).toBe('0:59')
    expect(formatDuration(125)).toBe('2:05')
    expect(formatDuration(3725)).toBe('1:02:05')
  })

  test('formatPace per unit, and a dash instead of garbage for zero distance', () => {
    expect(formatPace(480, 1609.344, 'mi')).toBe('8:00 /mi')
    expect(formatPace(1500, 5000, 'km')).toBe('5:00 /km')
    expect(formatPace(1500, 0, 'mi')).toBe('—')
  })

  test('formatDistance and minutesToHours1', () => {
    expect(formatDistance(1609.344, 'mi')).toBe('1.00 mi')
    expect(formatDistance(5000, 'km')).toBe('5.00 km')
    expect(minutesToHours1(450)).toBe('7.5')
    expect(minutesToHours1(95)).toBe('1.6')
    expect(minutesToHours1(0)).toBe('0.0')
  })
})
