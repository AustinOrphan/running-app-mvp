// The "start by" clock of a night session (rule H6, NS1): the time at which to start so that at least
// `h6.darkMinMin` of the session's minutes fall after civil dusk at the home place. Pure: the date,
// the zone, the place and the minutes arrive as data, the sun comes from `shared/domain/sun.ts` and
// the numbers from `P`. It reads the zone of the session's own date, so a day with a clock change is
// right. Shown on the session sheet only; nothing in the plan reads it.
import { clockInZone } from '../dates.ts'
import { duskAfter } from '../domain/sun.ts'
import { P } from './params/index.ts'

const MS_PER_MIN = 60_000

export type NightStart =
  /** No clock: the sun has no dusk on that date at that place (polar day or polar night). */
  | { kind: 'no-dusk' }
  | {
      kind: 'clock'
      /** Minute of the day (0 to 1439) in the runner's zone at which to start. */
      startMin: number
      /** Minute of the day of civil dusk in the runner's zone. */
      duskMin: number
      /** The session's minutes that fall after dusk when it starts at `startMin`. */
      darkMin: number
      /** The session is no longer than `h6.darkMinMin`: all of it is dark from dusk on. */
      allDark: boolean
    }

/**
 * Where a night session of `durationMin` minutes on `date` (the runner's day in `tz`) should start,
 * given the home place. A session longer than `h6.darkMinMin` starts its excess minutes before
 * dusk, so exactly `h6.darkMinMin` minutes are dark; a session no longer than that starts at dusk.
 * Throws a RangeError for an unknown zone.
 */
export function nightStartBy(input: {
  date: string
  tz: string
  lat: number
  lng: number
  durationMin: number
}): NightStart {
  const { date, tz, lat, lng, durationMin } = input
  // The scan starts at the home place's own solar noon of the calendar date (UTC noon less four
  // minutes per degree east), a daylight instant there whatever the zone. The runner's zone only
  // turns the result into a clock. `date` is the runner's training day (D10); it names the calendar
  // date whose evening is read, so a home place far from the zone still gets that date's dusk.
  const noon = Date.parse(`${date}T12:00:00Z`) - lng * 4 * MS_PER_MIN
  const dusk = duskAfter(noon, lat, lng, P.r1.darkSunAltitudeDeg.value)
  if (dusk === null) return { kind: 'no-dusk' }
  const wanted = P.h6.darkMinMin.value
  const allDark = durationMin <= wanted
  const before = allDark ? 0 : Math.round(durationMin) - wanted
  const start = dusk - before * MS_PER_MIN
  return {
    kind: 'clock',
    startMin: clockInZone(new Date(start), tz).minute,
    duskMin: clockInZone(new Date(dusk), tz).minute,
    darkMin: allDark ? Math.round(durationMin) : wanted,
    allDark,
  }
}
