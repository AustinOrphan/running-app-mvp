import { describe, expect, test } from 'vitest'
import { formatQuantity } from '../../../shared/copy/quantity.ts'
import {
  formatDistance,
  formatDuration,
  formatEstimate,
  formatPace,
  kmToM,
  milesToM,
  minutesToHours1,
  mToKm,
  mToMiles,
  roundEstimateSec,
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

describe('finish estimates', () => {
  const hms = (h: number, m = 0, sec = 0) => h * 3600 + m * 60 + sec

  test('roundEstimateSec rounds to the minute below six hours', () => {
    expect(roundEstimateSec(0)).toBe(0)
    expect(roundEstimateSec(29)).toBe(0)
    expect(roundEstimateSec(30)).toBe(60)
    expect(roundEstimateSec(hms(3, 47, 12))).toBe(hms(3, 47))
    expect(roundEstimateSec(hms(3, 47, 31))).toBe(hms(3, 48))
    expect(roundEstimateSec(hms(5, 59, 29))).toBe(hms(5, 59))
    expect(roundEstimateSec(hms(5, 59, 30))).toBe(hms(6))
  })

  test('roundEstimateSec rounds to ten minutes from six hours', () => {
    expect(roundEstimateSec(hms(6))).toBe(hms(6))
    expect(roundEstimateSec(hms(6, 4))).toBe(hms(6))
    expect(roundEstimateSec(hms(6, 6))).toBe(hms(6, 10))
    expect(roundEstimateSec(hms(31, 47, 20))).toBe(hms(31, 50))
    expect(roundEstimateSec(hms(27, 44, 59))).toBe(hms(27, 40))
  })

  test('roundEstimateSec gives NaN for a value that is not a time', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(roundEstimateSec(bad)).toBeNaN()
    }
  })

  test('roundEstimateSec is idempotent', () => {
    for (let sec = 0; sec < hms(40); sec += 997) {
      const once = roundEstimateSec(sec)
      expect(roundEstimateSec(once), String(sec)).toBe(once)
    }
  })

  test('formatEstimate reads as a person says it', () => {
    expect(formatEstimate(hms(0, 48))).toBe('48 min')
    expect(formatEstimate(hms(1))).toBe('1 h')
    expect(formatEstimate(hms(3, 47, 12))).toBe('3 h 47 min')
    expect(formatEstimate(hms(28))).toBe('28 h')
    expect(formatEstimate(hms(0, 0, 10))).toBe('0 min')
  })

  test('formatEstimate prints the finish range of the Today countdown', () => {
    expect(formatEstimate(hms(27, 41, 30))).toBe('27 h 40 min')
    expect(formatEstimate(hms(36, 18, 5))).toBe('36 h 20 min')
    expect(formatEstimate(hms(31, 52, 40))).toBe('31 h 50 min')
  })

  test('formatEstimate shows a dash, never NaN, for a value that is not a time', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -60]) {
      expect(formatEstimate(bad)).toBe('—')
    }
  })

  test('prints the same words as the copy system prints for the rounded duration', () => {
    // From half a minute up; the copy system reads a zero duration "0 s" and this reads "0 min".
    for (let sec = 31; sec < hms(45); sec += 1511) {
      expect(formatEstimate(sec), String(sec)).toBe(
        formatQuantity({ kind: 'duration', sec: roundEstimateSec(sec) }, 'km'),
      )
    }
  })
})
