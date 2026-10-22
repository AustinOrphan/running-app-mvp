import type { PlanPhase } from '../../shared/types.ts'

const parts = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** The pieces of a `YYYY-MM-DD` date, read in UTC so the viewer's time zone never shifts the day. */
function dateParts(iso: string): Record<'weekday' | 'day' | 'month' | 'year', string> {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${iso}`)
  const result = { weekday: '', day: '', month: '', year: '' }
  for (const part of parts.formatToParts(date)) {
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

/** "Mon 19 Oct 2026" */
export function formatLongDate(iso: string): string {
  const { weekday, day, month, year } = dateParts(iso)
  return `${weekday} ${day} ${month} ${year}`
}

const phaseLabels: Record<PlanPhase, string> = {
  restart: 'Restart',
  base1: 'Base 1',
  base2: 'Base 2',
  endurance: 'Endurance',
  specific: 'Specific',
  peak: 'Peak',
  taper: 'Taper',
  race: 'Race week',
  base: 'Base',
  build: 'Build',
}

export function phaseLabel(phase: PlanPhase): string {
  return phaseLabels[phase]
}
