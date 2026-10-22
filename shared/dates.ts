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
