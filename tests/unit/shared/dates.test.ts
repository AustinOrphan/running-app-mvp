import { describe, expect, test } from 'vitest'
import {
  addDays,
  daysBetween,
  daysLeftInWeek,
  isIsoDate,
  mondayOf,
  todayIso,
  weekStartsBetween,
} from '../../../shared/dates.ts'

describe('dates', () => {
  test('mondayOf maps every weekday to its Monday', () => {
    expect(mondayOf('2026-10-21')).toBe('2026-10-19') // Wednesday
    expect(mondayOf('2026-10-19')).toBe('2026-10-19') // Monday
    expect(mondayOf('2026-10-25')).toBe('2026-10-19') // Sunday
  })

  test('addDays crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  test('weekStartsBetween is inclusive and stays 7 days apart across DST changes', () => {
    expect(weekStartsBetween('2026-10-21', '2026-11-03')).toEqual([
      '2026-10-19',
      '2026-10-26',
      '2026-11-02',
    ])
    expect(weekStartsBetween('2026-03-02', '2026-03-16')).toEqual([
      '2026-03-02',
      '2026-03-09',
      '2026-03-16',
    ])
    expect(weekStartsBetween('2026-11-03', '2026-10-21')).toEqual([])
  })

  test('daysLeftInWeek counts through Sunday including the date', () => {
    expect(daysLeftInWeek('2026-10-19')).toBe(7)
    expect(daysLeftInWeek('2026-10-21')).toBe(5)
    expect(daysLeftInWeek('2026-10-25')).toBe(1)
  })

  test('todayIso uses the local calendar date, not UTC', () => {
    expect(todayIso(new Date(2026, 9, 21, 23, 59))).toBe('2026-10-21')
    expect(todayIso(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
  })

  test('invalid dates throw RangeError', () => {
    expect(() => mondayOf('2026-02-30')).toThrow(RangeError)
    expect(() => addDays('2026-2-3', 1)).toThrow(RangeError)
  })

  test('daysBetween', () => {
    expect(daysBetween('2026-10-21', '2026-10-24')).toBe(3)
    expect(daysBetween('2026-10-24', '2026-10-21')).toBe(-3)
  })

  test('isIsoDate', () => {
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2026-2-9')).toBe(false)
  })
})
