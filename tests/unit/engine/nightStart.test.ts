import { describe, expect, test } from 'vitest'
import { clockOfMinute, nightStartText } from '../../../shared/copy/nightStart.ts'
import { nightStartBy, type NightStart } from '../../../shared/engine/nightStart.ts'
import { P } from '../../../shared/engine/params/index.ts'

function clockOf(start: NightStart) {
  if (start.kind !== 'clock') throw new Error('expected a clock')
  return start
}

describe('nightStartBy (H6, NS1)', () => {
  test('the Param is a grade D default with a note, under H6', () => {
    expect(P.h6.darkMinMin).toMatchObject({
      id: 'h6.darkMinMin',
      value: 40,
      grade: 'D',
      rule: 'H6',
      unit: 'min',
    })
    expect(P.h6.darkMinMin.note).toMatch(/Default/)
  })

  test('mid-latitude summer: dusk late in the evening, start the excess minutes before it', () => {
    const start = clockOf(
      nightStartBy({
        date: '2027-06-12',
        tz: 'America/Chicago',
        lat: 43.07,
        lng: -89.4,
        durationMin: 120,
      }),
    )
    // Civil dusk at 43 N in mid June is a little after 21:00 daylight time.
    expect(start.duskMin).toBeGreaterThanOrEqual(21 * 60)
    expect(start.duskMin).toBeLessThanOrEqual(21 * 60 + 40)
    expect(start.duskMin - start.startMin).toBe(120 - P.h6.darkMinMin.value)
    expect(start.darkMin).toBe(P.h6.darkMinMin.value)
    expect(start.allDark).toBe(false)
  })

  test('winter: dusk is early, and a southern place reads its own season', () => {
    const north = clockOf(
      nightStartBy({
        date: '2027-12-18',
        tz: 'America/Chicago',
        lat: 43.07,
        lng: -89.4,
        durationMin: 60,
      }),
    )
    expect(north.duskMin).toBeGreaterThanOrEqual(16 * 60 + 30)
    expect(north.duskMin).toBeLessThanOrEqual(17 * 60 + 30)
    const south = clockOf(
      nightStartBy({
        date: '2027-06-12',
        tz: 'Australia/Sydney',
        lat: -33.87,
        lng: 151.2,
        durationMin: 60,
      }),
    )
    // Southern winter: dusk before 18:00.
    expect(south.duskMin).toBeGreaterThanOrEqual(16 * 60 + 30)
    expect(south.duskMin).toBeLessThanOrEqual(18 * 60)
  })

  test('the zone of the date decides the clock: dusk jumps an hour across the change', () => {
    const at = (date: string) =>
      clockOf(nightStartBy({ date, tz: 'America/Chicago', lat: 41.9, lng: -87.6, durationMin: 60 }))
    const before = at('2027-03-13')
    const after = at('2027-03-14')
    // The clocks went forward in the night: the sun moved about two minutes, the clock one hour.
    expect(after.duskMin - before.duskMin).toBeGreaterThanOrEqual(60)
    expect(after.duskMin - before.duskMin).toBeLessThanOrEqual(63)
    // The same holds for the start, an exact 20 minutes before dusk on both days.
    expect(after.duskMin - after.startMin).toBe(20)
    expect(before.duskMin - before.startMin).toBe(20)
  })

  test('a start that falls across the clock change keeps real elapsed minutes', () => {
    // Autumn change in Chicago, 2027-11-07: dusk is about 17:00 standard time, far from the change,
    // so the span from start to dusk is plain minutes.
    const start = clockOf(
      nightStartBy({
        date: '2027-11-07',
        tz: 'America/Chicago',
        lat: 41.9,
        lng: -87.6,
        durationMin: 100,
      }),
    )
    expect(start.duskMin - start.startMin).toBe(60)
  })

  test('a session no longer than the dark minutes starts at dusk, all of it dark', () => {
    for (const durationMin of [30, P.h6.darkMinMin.value]) {
      const start = clockOf(
        nightStartBy({
          date: '2027-09-20',
          tz: 'Europe/Paris',
          lat: 48.85,
          lng: 2.35,
          durationMin,
        }),
      )
      expect(start.startMin).toBe(start.duskMin)
      expect(start.darkMin).toBe(durationMin)
      expect(start.allDark).toBe(true)
    }
  })

  test('polar day and polar night give no clock', () => {
    const polar = (date: string, lat: number) =>
      nightStartBy({ date, tz: 'Europe/Oslo', lat, lng: 19, durationMin: 90 })
    expect(polar('2027-06-21', 70)).toEqual({ kind: 'no-dusk' })
    expect(polar('2027-12-21', 80)).toEqual({ kind: 'no-dusk' })
  })

  test('is deterministic', () => {
    const input = {
      date: '2027-06-12',
      tz: 'America/Chicago',
      lat: 43.07,
      lng: -89.4,
      durationMin: 95,
    }
    expect(nightStartBy(input)).toEqual(nightStartBy(input))
  })
})

describe('nightStartText', () => {
  test('words the clock, the short session, the missing dusk and the missing place', () => {
    const long = nightStartText({
      kind: 'clock',
      startMin: 18 * 60 + 42,
      duskMin: 19 * 60 + 22,
      darkMin: 40,
      allDark: false,
    })
    expect(long.label).toBe('Start by 18:42')
    expect(long.line).toBe('So the last 40 min are after dusk at home, which falls at 19:22.')
    const short = nightStartText({
      kind: 'clock',
      startMin: 19 * 60 + 22,
      duskMin: 19 * 60 + 22,
      darkMin: 30,
      allDark: true,
    })
    expect(short.label).toBe('Start at 19:22')
    expect(short.line).toBe(
      'The session is no longer than 30 min, so all of it is after dusk at home, which falls at 19:22.',
    )
    expect(nightStartText({ kind: 'no-dusk' }).label).toBeNull()
    expect(nightStartText({ kind: 'no-dusk' }).line).toMatch(/no start time/)
    const none = nightStartText(null)
    expect(none.label).toBeNull()
    expect(none.line).toBe('The start time needs the home place on Profile.')
  })

  test('a minute of the day reads as 24-hour HH:MM', () => {
    expect(clockOfMinute(0)).toBe('00:00')
    expect(clockOfMinute(7 * 60 + 5)).toBe('07:05')
    expect(clockOfMinute(23 * 60 + 59)).toBe('23:59')
  })
})
