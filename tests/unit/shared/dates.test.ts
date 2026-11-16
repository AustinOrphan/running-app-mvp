import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  addDays,
  clockInZone,
  daysBetween,
  daysLeftInWeek,
  formatLongDate,
  formatShortDate,
  formatWeekday,
  formatWeekdayDate,
  formatWeekdayName,
  instantAtWallTime,
  isIsoDate,
  isoDateInZone,
  localWallTime,
  mondayOf,
  todayIso,
  wallClockFormatter,
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

describe('localWallTime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('writes the hour of an instant in the zone, on a 24-hour clock', () => {
    expect(localWallTime('2026-10-21T18:30:00Z', 'America/Chicago')).toBe('2026-10-21T13:00:00')
    expect(localWallTime('2026-10-21T05:10:00Z', 'America/Chicago')).toBe('2026-10-21T00:00:00')
    expect(localWallTime('2026-10-21T23:59:00Z', 'Asia/Kolkata')).toBe('2026-10-22T05:00:00')
  })

  test('reads an unknown zone as UTC and returns an unreadable instant as it is', () => {
    expect(localWallTime('2026-10-21T18:30:00Z', 'Nowhere/Land')).toBe('2026-10-21T18:00:00')
    expect(localWallTime('not a time', 'America/Chicago')).toBe('not a time')
  })

  test('builds one formatter per zone, however many hours a forecast has', () => {
    const construct = vi.spyOn(Intl, 'DateTimeFormat')
    const zone = 'Pacific/Auckland'
    const start = Date.parse('2026-10-21T00:00:00Z')
    for (let hour = 0; hour < 168; hour += 1) {
      localWallTime(new Date(start + hour * 3_600_000).toISOString(), zone)
    }
    expect(construct).toHaveBeenCalledTimes(1)

    // A second forecast of the same zone builds nothing.
    localWallTime('2026-10-28T00:00:00Z', zone)
    expect(construct).toHaveBeenCalledTimes(1)
  })

  test('hands out the same formatter for a zone, and a zone that does not exist keeps its fallback', () => {
    expect(wallClockFormatter('Europe/Zurich')).toBe(wallClockFormatter('Europe/Zurich'))
    expect(wallClockFormatter('Europe/Zurich')).not.toBe(wallClockFormatter('Europe/Lisbon'))

    const construct = vi.spyOn(Intl, 'DateTimeFormat')
    const first = wallClockFormatter('Nowhere/Else')
    const built = construct.mock.calls.length
    expect(wallClockFormatter('Nowhere/Else')).toBe(first)
    expect(construct).toHaveBeenCalledTimes(built)
  })
})

describe('zone clock', () => {
  const at = (iso: string) => new Date(iso)

  test('clockInZone reads the date, weekday and minute of a zone far from UTC', () => {
    // 2026-11-16 is a Monday.
    expect(clockInZone(at('2026-11-16T12:00:00Z'), 'Pacific/Kiritimati')).toEqual({
      date: '2026-11-17',
      weekday: 2,
      minute: 120,
    })
    expect(clockInZone(at('2026-11-16T05:00:00Z'), 'Pacific/Pago_Pago')).toEqual({
      date: '2026-11-15',
      weekday: 0,
      minute: 1080,
    })
  })

  test('clockInZone handles offsets that are not whole hours', () => {
    expect(clockInZone(at('2026-11-16T20:00:00Z'), 'Asia/Kathmandu')).toEqual({
      date: '2026-11-17',
      weekday: 2,
      minute: 105,
    })
    expect(clockInZone(at('2026-11-16T03:00:00Z'), 'America/St_Johns')).toEqual({
      date: '2026-11-15',
      weekday: 0,
      minute: 1410,
    })
  })

  test('clockInZone follows a half-hour daylight saving change', () => {
    // Lord Howe is +11 in November and +10:30 in July.
    expect(clockInZone(at('2026-11-16T13:30:00Z'), 'Australia/Lord_Howe').minute).toBe(30)
    expect(clockInZone(at('2026-07-15T13:30:00Z'), 'Australia/Lord_Howe')).toEqual({
      date: '2026-07-16',
      weekday: 4,
      minute: 0,
    })
  })

  test('clockInZone gives midnight as minute 0 of the new day, never minute 1440', () => {
    expect(clockInZone(at('2026-11-16T23:00:00Z'), 'Europe/Berlin')).toEqual({
      date: '2026-11-17',
      weekday: 2,
      minute: 0,
    })
  })

  test('instantAtWallTime inverts clockInZone away from a change', () => {
    expect(instantAtWallTime('2026-11-17', 120, 'Pacific/Kiritimati').toISOString()).toBe(
      '2026-11-16T12:00:00.000Z',
    )
    expect(instantAtWallTime('2026-11-17', 105, 'Asia/Kathmandu').toISOString()).toBe(
      '2026-11-16T20:00:00.000Z',
    )
    expect(instantAtWallTime('2026-11-15', 1410, 'America/St_Johns').toISOString()).toBe(
      '2026-11-16T03:00:00.000Z',
    )
    expect(instantAtWallTime('2026-07-16', 0, 'Australia/Lord_Howe').toISOString()).toBe(
      '2026-07-15T13:30:00.000Z',
    )
  })

  test('instantAtWallTime gives the first instant after a spring-forward gap', () => {
    // Berlin 2026-03-29: 02:00 CET becomes 03:00 CEST at 01:00Z.
    expect(instantAtWallTime('2026-03-29', 60, 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T00:00:00.000Z',
    )
    expect(instantAtWallTime('2026-03-29', 150, 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T01:00:00.000Z',
    )
    expect(instantAtWallTime('2026-03-29', 180, 'Europe/Berlin').toISOString()).toBe(
      '2026-03-29T01:00:00.000Z',
    )
  })

  test('instantAtWallTime gives the earlier instant when a fall-back hour repeats', () => {
    // Berlin 2026-10-25: 03:00 CEST becomes 02:00 CET at 01:00Z, so 02:30 happens at 00:30Z and 01:30Z.
    expect(instantAtWallTime('2026-10-25', 150, 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    )
    expect(instantAtWallTime('2026-10-25', 180, 'Europe/Berlin').toISOString()).toBe(
      '2026-10-25T02:00:00.000Z',
    )
  })

  test('the two helpers agree for every minute of a spring-forward day', () => {
    for (let minute = 0; minute < 1440; minute += 15) {
      const instant = instantAtWallTime('2026-03-29', minute, 'Europe/Berlin')
      const clock = clockInZone(instant, 'Europe/Berlin')
      if (minute >= 120 && minute < 180) expect(clock.minute).toBe(180)
      else expect(clock.minute).toBe(minute)
      expect(clock.date).toBe('2026-03-29')
    }
  })

  test('both helpers throw a RangeError for an unknown zone, and clockInZone for an invalid date', () => {
    expect(() => clockInZone(at('2026-11-16T12:00:00Z'), 'Nowhere/Land')).toThrow(RangeError)
    expect(() => instantAtWallTime('2026-11-16', 0, 'Nowhere/Land')).toThrow(RangeError)
    expect(() => clockInZone(new Date('nope'), 'UTC')).toThrow(RangeError)
  })
})
