import type { SessionKind } from '../../shared/engine/types.ts'
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

/**
 * The label of a plan week. A week after the race keeps the phase 'race' (no schema change) and
 * carries the 'post-race' flag; every view calls it "After the race", not "Race week".
 */
export function weekPhaseLabel(week: { phase: PlanPhase; flags?: readonly string[] }): string {
  return week.flags?.includes('post-race') === true ? 'After the race' : phaseLabel(week.phase)
}

const kindLabels: Record<SessionKind, string> = {
  easy: 'Easy run',
  recovery: 'Recovery run',
  long: 'Long run',
  'long-fast-finish': 'Long run, fast finish',
  threshold: 'Threshold',
  intervals: 'Intervals',
  'race-pace': 'Race pace',
  strides: 'Strides',
  hills: 'Hills',
  hike: 'Hike',
  b2b: 'Back-to-back',
  strength: 'Strength',
  mobility: 'Mobility',
  rest: 'Rest',
  race: 'Race',
  cross: 'Cross-training',
}

/** A session kind as the Plan page names it: "Long run, fast finish". */
export function sessionKindLabel(kind: SessionKind): string {
  return kindLabels[kind]
}

/** Whether a string names a session kind. */
export function isSessionKind(value: unknown): value is SessionKind {
  return typeof value === 'string' && value in kindLabels
}
