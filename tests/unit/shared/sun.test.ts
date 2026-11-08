import { describe, expect, it } from 'vitest'
import { darkMinutesOf, sunAltitudeDeg } from '../../../shared/domain/sun.ts'

const SUNRISE_DEG = -0.833

/** The first minute at or after `fromMs` (searching `spanMin` minutes) at which the sun is above `deg`. */
function firstAbove(fromMs: number, spanMin: number, lat: number, lng: number, deg: number) {
  for (let i = 0; i <= spanMin; i++) {
    const t = fromMs + i * 60_000
    if (sunAltitudeDeg(t, lat, lng) >= deg) return t
  }
  return null
}

function minutesBetween(a: number, b: number): number {
  return Math.abs(a - b) / 60_000
}

describe('sunAltitudeDeg', () => {
  it('stands near the zenith at the equator at noon on the March equinox', () => {
    // Equinox 2026-03-20 14:46 UTC; the sun is over the equator, and 12:00 UTC is solar noon at 0 E
    // give or take the equation of time (about 7 min).
    const alt = sunAltitudeDeg(Date.UTC(2026, 2, 20, 12, 0), 0, 0)
    expect(alt).toBeGreaterThan(87)
    expect(alt).toBeLessThanOrEqual(90)
  })

  it('reaches 90 - lat + 23.44 degrees at solar noon on the June solstice (45 N)', () => {
    let best = -90
    for (let m = 0; m < 1440; m += 5) {
      best = Math.max(best, sunAltitudeDeg(Date.UTC(2026, 5, 21, 0, m), 45, 0))
    }
    expect(best).toBeCloseTo(68.44, 0)
  })

  it('matches published sunrise and sunset for Chicago on the June solstice', () => {
    // timeanddate.com / NOAA table: sunrise 05:15 CDT (10:15 UTC), sunset 20:29 CDT (01:29 UTC).
    const rise = firstAbove(Date.UTC(2026, 5, 21, 8, 0), 360, 41.88, -87.63, SUNRISE_DEG)
    expect(rise).not.toBeNull()
    expect(minutesBetween(rise!, Date.UTC(2026, 5, 21, 10, 15))).toBeLessThanOrEqual(4)
    let set: number | null = null
    for (let t = Date.UTC(2026, 5, 22, 0, 0); t < Date.UTC(2026, 5, 22, 4, 0); t += 60_000) {
      if (sunAltitudeDeg(t, 41.88, -87.63) < SUNRISE_DEG) {
        set = t
        break
      }
    }
    expect(set).not.toBeNull()
    expect(minutesBetween(set!, Date.UTC(2026, 5, 22, 1, 29))).toBeLessThanOrEqual(4)
  })

  it('matches published sunrise for Chicago on the December solstice', () => {
    // NOAA table: sunrise 07:15 CST (13:15 UTC).
    const rise = firstAbove(Date.UTC(2026, 11, 21, 11, 0), 240, 41.88, -87.63, SUNRISE_DEG)
    expect(minutesBetween(rise!, Date.UTC(2026, 11, 21, 13, 15))).toBeLessThanOrEqual(4)
  })
})

describe('darkMinutesOf', () => {
  const chicago = { lat: 41.88, lng: -87.63 }

  it('counts none for a midday run and all of a midnight run', () => {
    const noon = Date.UTC(2026, 5, 21, 17, 0)
    expect(darkMinutesOf(noon, 3600, chicago.lat, chicago.lng, -6)).toBe(0)
    const midnight = Date.UTC(2026, 5, 21, 6, 0)
    expect(darkMinutesOf(midnight, 3600, chicago.lat, chicago.lng, -6)).toBe(60)
  })

  it('counts the part of a run that crosses sunset', () => {
    // Sunset 01:29 UTC; a run from 00:59 UTC for 60 min has about 30 min after sunset, and the
    // civil twilight threshold (about 30 min later) leaves it light.
    const start = Date.UTC(2026, 5, 22, 0, 59)
    const atSunset = darkMinutesOf(start, 3600, chicago.lat, chicago.lng, SUNRISE_DEG)
    expect(atSunset).toBeGreaterThanOrEqual(26)
    expect(atSunset).toBeLessThanOrEqual(34)
    expect(darkMinutesOf(start, 3600, chicago.lat, chicago.lng, -6)).toBe(0)
  })

  it('has no dark in the polar day and all dark in the polar night', () => {
    const june = Date.UTC(2026, 5, 21, 0, 0)
    expect(darkMinutesOf(june, 24 * 3600, 78.2, 15.6, -6)).toBe(0)
    const december = Date.UTC(2026, 11, 21, 0, 0)
    expect(darkMinutesOf(december, 24 * 3600, 78.2, 15.6, SUNRISE_DEG)).toBe(1440)
  })

  it('counts nothing for a span under a minute', () => {
    expect(darkMinutesOf(Date.UTC(2026, 5, 21, 6, 0), 59, 41.88, -87.63, -6)).toBe(0)
  })
})
