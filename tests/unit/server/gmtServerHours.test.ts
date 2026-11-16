import { afterEach, describe, expect, test } from 'vitest'
import { gmtServerHours } from '../../api/helpers.ts'

// The forecast fixtures build Open-Meteo GMT stamps from the server zone's midnight. On a
// daylight-saving day the stamps must stay distinct, as real GMT data is.
const original = process.env.TZ

afterEach(() => {
  if (original === undefined) delete process.env.TZ
  else process.env.TZ = original
})

describe('gmtServerHours', () => {
  test.each([
    ['2026-03-08', '2026-03-08T06:00', '2026-03-09T05:00'],
    ['2026-11-01', '2026-11-01T05:00', '2026-11-02T04:00'],
  ])('on the Chicago transition day %s, 48 hours are distinct and hourly', (date, first, next) => {
    process.env.TZ = 'America/Chicago'
    const hours = gmtServerHours(date, 48)
    expect(new Set(hours).size).toBe(48)
    expect(hours[0]).toBe(first)
    const steps = hours.map((h) => Date.parse(`${h}:00Z`))
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]! - steps[i - 1]!).toBe(3_600_000)
    // the next day's midnight is 23 or 25 hours on: the transition day is not 24 hours long
    expect(hours).toContain(next)
  })

  test('starts at the zone midnight outside a transition', () => {
    process.env.TZ = 'Pacific/Kiritimati'
    expect(gmtServerHours('2026-03-10', 2)).toEqual(['2026-03-09T10:00', '2026-03-09T11:00'])
  })
})
