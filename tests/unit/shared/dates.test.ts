import { describe, expect, test, vi } from 'vitest'
import {
  addDays,
  daysBetween,
  daysLeftInWeek,
  formatLongDate,
  formatShortDate,
  formatWeekday,
  formatWeekdayDate,
  formatWeekdayName,
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

describe('date formatting', () => {
  test('en-GB forms', () => {
    expect(formatShortDate('2026-10-19')).toBe('19 Oct')
    expect(formatShortDate('2026-01-01')).toBe('1 Jan')
    expect(formatWeekday('2026-10-19')).toBe('Mon')
    expect(formatWeekdayName('2026-10-19')).toBe('Monday')
    expect(formatWeekdayDate('2026-10-29')).toBe('Thu 29 Oct')
    expect(formatLongDate('2026-10-19')).toBe('Mon 19 Oct 2026')
  })

  // The formatters fix their zone when `shared/dates.ts` loads, so each case sets the process zone
  // first and then imports a fresh copy of the module. A formatter without `timeZone: 'UTC'` would
  // read UTC midnight as the previous evening in Los Angeles. Kiritimati (UTC+14) cannot move a UTC
  // midnight to another day; the case guards against a formatter that anchors the date elsewhere.
  test.each(['America/Los_Angeles', 'Pacific/Kiritimati'])(
    'reads the date in UTC, so the machine zone %s cannot shift the day',
    async (zone) => {
      const original = process.env.TZ
      process.env.TZ = zone
      try {
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
        vi.resetModules()
        const dates = await import('../../../shared/dates.ts')
        expect(dates.formatShortDate('2026-10-19')).toBe('19 Oct')
        expect(dates.formatWeekday('2026-10-19')).toBe('Mon')
        expect(dates.formatWeekdayName('2026-10-19')).toBe('Monday')
        expect(dates.formatWeekdayDate('2026-10-29')).toBe('Thu 29 Oct')
        expect(dates.formatLongDate('2026-10-19')).toBe('Mon 19 Oct 2026')
        expect(dates.formatLongDate('2026-01-01')).toBe('Thu 1 Jan 2026')
      } finally {
        if (original === undefined) delete process.env.TZ
        else process.env.TZ = original
        vi.resetModules()
      }
    },
  )

  test('anything but a real YYYY-MM-DD date throws a RangeError', () => {
    for (const bad of ['', '2026-02-30', '19 Oct', '2026-10-19T08:00:00Z']) {
      expect(() => formatShortDate(bad), bad).toThrow(RangeError)
      expect(() => formatWeekdayName(bad), bad).toThrow(RangeError)
    }
  })
})
