// The day-numbered x axis of the Trends run panels: their points are runs and windows, not weeks, so
// they sit on a numeric axis whose ticks are the first of a month, named as `monthTicks` names them.
// No chart library here, so a test can read it without loading one.
import { monthStep, tickLabel } from './monthTicks.ts'

const DAY_MS = 86_400_000

/** Whole days since 1970-01-01 of a `YYYY-MM-DD` date. */
export function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
}

/** The `YYYY-MM-DD` date of a day number. */
export function isoOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/**
 * The first of each calendar month from `from` to `to` (both inclusive), every `step` months from
 * January, as day numbers. A range of 26 to 104 weeks names its months, as the weekly charts do.
 */
export function monthStartDays(from: string, to: string, step: number): number[] {
  const last = dayNumber(to)
  const days: number[] = []
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  for (;;) {
    const iso = `${String(year)}-${String(month).padStart(2, '0')}-01`
    const day = dayNumber(iso)
    if (day > last) break
    if (day >= dayNumber(from) && (month - 1) % step === 0) days.push(day)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return days
}

/** The ticks of a range and the label of each: the first of the months it names. */
export function rangeTicks(from: string, to: string): number[] {
  const weeks = Math.round((dayNumber(to) - dayNumber(from)) / 7)
  return monthStartDays(from, to, monthStep(weeks))
}

/** "Mar", or "Jan 26" for a January, as the weekly charts label a month. */
export function dayTickLabel(day: number): string {
  return tickLabel(isoOfDay(day))
}
