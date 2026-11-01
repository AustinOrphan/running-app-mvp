// Which days the runner has open [rule F5]. One reading for the engine's placement of a week
// (`slotsOf` in micro.ts), the F5 fact of the Why drawer and the fit note of the Generate form, so
// that the days a page counts are the days the plan can use.
import type { Availability } from '../types.ts'

/**
 * Whether a day is open: marked available, and not limited to 0 minutes. A day marked available
 * with a limit of 0 holds no run, so the engine places nothing on it and a count must not include it.
 */
export function isOpenDay(day: Availability[keyof Availability]): boolean {
  return day.available && (day.maxMin === null || day.maxMin > 0)
}

/** The number of open days in the week. */
export function openDayCount(availability: Availability): number {
  return Object.values(availability).filter(isOpenDay).length
}
