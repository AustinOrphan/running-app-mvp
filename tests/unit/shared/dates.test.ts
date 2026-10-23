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
  isoDateInZone,
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

describe('isoDateInZone', () => {
  const at = (iso: string) => new Date(iso)

  test('reads the calendar date of an instant in the zone asked for', () => {
    const now = at('2026-10-22T03:30:00Z')
    expect(isoDateInZone(now, 'UTC')).toBe('2026-10-22')
    expect(isoDateInZone(now, 'America/Chicago')).toBe('2026-10-21') // 22:30 CDT
    expect(isoDateInZone(now, 'Pacific/Pago_Pago')).toBe('2026-10-21') // 16:30, UTC-11
    expect(isoDateInZone(now, 'Asia/Kolkata')).toBe('2026-10-22') // 09:00, UTC+5:30
    expect(isoDateInZone(now, 'Pacific/Kiritimati')).toBe('2026-10-22') // 17:30, UTC+14
  })

  test('changes the day exactly at local midnight, in a zone with whole-hour offset', () => {
    // Chicago is on daylight time (UTC-5) until 2026-11-01.
    expect(isoDateInZone(at('2026-10-22T04:59:59Z'), 'America/Chicago')).toBe('2026-10-21')
    expect(isoDateInZone(at('2026-10-22T05:00:00Z'), 'America/Chicago')).toBe('2026-10-22')
  })

  test('changes the day exactly at local midnight, in a zone with a half-hour offset', () => {
    expect(isoDateInZone(at('2026-10-21T18:29:59Z'), 'Asia/Kolkata')).toBe('2026-10-21')
    expect(isoDateInZone(at('2026-10-21T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-22')
  })

  test('follows the daylight saving change: the 25-hour day, and midnight on standard time', () => {
    // Clocks in Chicago go back at 07:00 UTC on 2026-11-01 (02:00 CDT becomes 01:00 CST).
    expect(isoDateInZone(at('2026-11-01T04:59:59Z'), 'America/Chicago')).toBe('2026-10-31')
    expect(isoDateInZone(at('2026-11-01T05:00:00Z'), 'America/Chicago')).toBe('2026-11-01')
    expect(isoDateInZone(at('2026-11-01T06:30:00Z'), 'America/Chicago')).toBe('2026-11-01')
    expect(isoDateInZone(at('2026-11-01T07:30:00Z'), 'America/Chicago')).toBe('2026-11-01')
    // Midnight now arrives at 06:00 UTC.
    expect(isoDateInZone(at('2026-11-02T05:59:59Z'), 'America/Chicago')).toBe('2026-11-01')
    expect(isoDateInZone(at('2026-11-02T06:00:00Z'), 'America/Chicago')).toBe('2026-11-02')
  })

  test('crosses the new year and a leap day', () => {
    expect(isoDateInZone(at('2027-01-01T04:59:59Z'), 'America/New_York')).toBe('2026-12-31')
    expect(isoDateInZone(at('2027-01-01T05:00:00Z'), 'America/New_York')).toBe('2027-01-01')
    expect(isoDateInZone(at('2028-02-29T10:00:00Z'), 'Pacific/Auckland')).toBe('2028-02-29')
    expect(isoDateInZone(at('2028-02-28T11:00:00Z'), 'Pacific/Auckland')).toBe('2028-02-29')
  })

  test('is the same whatever zone the machine is in', () => {
    const now = at('2026-10-22T03:30:00Z')
    const machineZone = process.env.TZ
    try {
      const local: string[] = []
      for (const zone of ['Pacific/Pago_Pago', 'UTC', 'Pacific/Kiritimati']) {
        process.env.TZ = zone
        local.push(todayIso(now))
        expect(isoDateInZone(now, 'America/Chicago'), `machine in ${zone}`).toBe('2026-10-21')
        expect(isoDateInZone(now, 'Asia/Kolkata'), `machine in ${zone}`).toBe('2026-10-22')
      }
      // The machine's own day really did move, so the assertions above are not vacuous.
      expect(local).toEqual(['2026-10-21', '2026-10-22', '2026-10-22'])
    } finally {
      if (machineZone === undefined) delete process.env.TZ
      else process.env.TZ = machineZone
    }
  })

  test('returns a padded YYYY-MM-DD that the other date helpers accept', () => {
    const date = isoDateInZone(at('2026-01-05T12:00:00Z'), 'Europe/London')
    expect(date).toBe('2026-01-05')
    expect(isIsoDate(date)).toBe(true)
    expect(mondayOf(date)).toBe('2026-01-05')
  })

  test('throws a RangeError for an unknown zone or an invalid instant', () => {
    expect(() => isoDateInZone(at('2026-10-22T03:30:00Z'), 'Mars/Olympus_Mons')).toThrow(RangeError)
    expect(() => isoDateInZone(at('2026-10-22T03:30:00Z'), '')).toThrow(RangeError)
    expect(() => isoDateInZone(new Date(Number.NaN), 'UTC')).toThrow(RangeError)
  })
})
