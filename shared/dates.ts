// Calendar dates are YYYY-MM-DD strings in the runner's local day. All arithmetic runs on UTC
// timestamps built from those strings, so results do not depend on the machine's timezone or on
// daylight-saving changes. Only todayIso reads local time.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

function toUtcMs(date: string): number | null {
  const match = ISO_DATE.exec(date)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const ms = Date.UTC(year, month - 1, day)
  const check = new Date(ms)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null
  }
  return ms
}

function parse(date: string): number {
  const ms = toUtcMs(date)
  if (ms === null) throw new RangeError(`Invalid date: ${JSON.stringify(date)}`)
  return ms
}

function format(ms: number): string {
  const d = new Date(ms)
  const year = String(d.getUTCFullYear()).padStart(4, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** True for a real calendar date written as YYYY-MM-DD. Never throws. */
export function isIsoDate(value: string): boolean {
  return typeof value === 'string' && toUtcMs(value) !== null
}

export function addDays(date: string, days: number): string {
  return format(parse(date) + days * MS_PER_DAY)
}

/** Days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to) - parse(from)) / MS_PER_DAY)
}

/** The Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  const ms = parse(date)
  const weekday = new Date(ms).getUTCDay() // 0 Sunday .. 6 Saturday
  const sinceMonday = (weekday + 6) % 7
  return format(ms - sinceMonday * MS_PER_DAY)
}

/** The local calendar date of `now`. */
export function todayIso(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * The calendar date of `now` in the IANA zone `tz` ("America/Chicago"), as `YYYY-MM-DD`. Unlike
 * `todayIso` it never reads the machine's zone, so a phone in one zone can compute the server's
 * day in another. Throws a RangeError for an unknown zone or an invalid `now`.
 */
export function isoDateInZone(now: Date, tz: string): string {
  if (Number.isNaN(now.getTime())) throw new RangeError('Invalid date')
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
  } catch {
    throw new RangeError(`Invalid time zone: ${JSON.stringify(tz)}`)
  }
  const part = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`
}

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * The formatter of an IANA zone for `localWallTime`, one per zone for the life of the process: a
 * forecast has 168 hours, and building a formatter costs far more than formatting an hour with it
 * (`shared/importers/files/summarize.ts` caches its formatters the same way). An unknown zone
 * reads as UTC.
 */
export function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = wallClockFormatters.get(timeZone)
  if (cached !== undefined) return cached
  const build = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
    })
  let formatter: Intl.DateTimeFormat
  try {
    formatter = build(timeZone)
  } catch {
    formatter = build('UTC')
  }
  wallClockFormatters.set(timeZone, formatter)
  return formatter
}

/** The wall-clock time `YYYY-MM-DDTHH:00:00` of an instant in an IANA time zone (UTC if unknown). */
export function localWallTime(iso: string, timeZone: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return iso
  const list = wallClockFormatter(timeZone).formatToParts(ms)
  const get = (type: string) => list.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:00:00`
}

/** Mondays from mondayOf(from) to mondayOf(to), inclusive; empty when `from` is after `to`. */
export function weekStartsBetween(from: string, to: string): string[] {
  const first = mondayOf(from)
  const last = mondayOf(to)
  const weeks: string[] = []
  for (let week = first; week <= last; week = addDays(week, 7)) weeks.push(week)
  return weeks
}

/** Days left in the week through Sunday, including `date`: Monday 7, Sunday 1. */
export function daysLeftInWeek(date: string): number {
  return 7 - daysBetween(mondayOf(date), date)
}

// Display formatting. en-GB, read in UTC so the viewer's time zone never shifts the day.

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const weekdayNameFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' })

/** The pieces of a `YYYY-MM-DD` date. Throws a RangeError for anything else. */
function dateParts(iso: string): Record<'weekday' | 'day' | 'month' | 'year', string> {
  const ms = toUtcMs(iso)
  if (ms === null) throw new RangeError(`Invalid date: ${iso}`)
  const result = { weekday: '', day: '', month: '', year: '' }
  for (const part of dateFormat.formatToParts(new Date(ms))) {
    if (part.type in result) result[part.type as keyof typeof result] = part.value
  }
  return result
}

/** "19 Oct" */
export function formatShortDate(iso: string): string {
  const { day, month } = dateParts(iso)
  return `${day} ${month}`
}

/** "Mon" */
export function formatWeekday(iso: string): string {
  return dateParts(iso).weekday
}

/** "Monday" */
export function formatWeekdayName(iso: string): string {
  const ms = toUtcMs(iso)
  if (ms === null) throw new RangeError(`Invalid date: ${iso}`)
  return weekdayNameFormat.format(new Date(ms))
}

/** "Mon 19 Oct" */
export function formatWeekdayDate(iso: string): string {
  const { weekday, day, month } = dateParts(iso)
  return `${weekday} ${day} ${month}`
}

/** "Mon 19 Oct 2026" */
export function formatLongDate(iso: string): string {
  const { weekday, day, month, year } = dateParts(iso)
  return `${weekday} ${day} ${month} ${year}`
}
