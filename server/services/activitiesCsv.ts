// The activity CSV: one builder for `GET /api/activities/export.csv` and for `activities.csv` in the
// full-data archive (`exportArchive.ts`), so the two files cannot drift apart.
import { mToMiles } from '../../shared/units.ts'

export const ACTIVITY_CSV_HEADER = [
  'date',
  'start_time',
  'type',
  'minutes',
  'miles',
  'avg_hr',
  'max_hr',
  'elevation_gain_m',
  'rpe',
  'notes',
  'source',
  'duplicate_status',
] as const

/** The columns of an activity that the CSV reads; a database row and the API's activity both fit. */
export interface CsvActivity {
  date: string
  startTime: string | null
  type: string
  durationSec: number
  distanceM: number | null
  avgHr: number | null
  maxHr: number | null
  elevationGainM: number | null
  rpe: number | null
  notes: string | null
  source: string
  duplicateStatus: string
}

/** One text cell: quoted when needed (RFC 4180) and defused when a spreadsheet would run it. */
function textCell(value: string | null): string {
  if (value === null || value === '') return ''
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

function numberCell(value: number | null, digits?: number): string {
  if (value === null) return ''
  return digits === undefined ? String(value) : value.toFixed(digits)
}

/** The header line, without a line break. */
export function activityCsvHeader(): string {
  return ACTIVITY_CSV_HEADER.join(',')
}

/** One activity as a CSV line, without a line break. Distance is in miles here, whatever the unit setting. */
export function activityCsvLine(a: CsvActivity): string {
  return [
    a.date,
    a.startTime ?? '',
    a.type,
    numberCell(a.durationSec / 60, 2),
    numberCell(a.distanceM === null ? null : mToMiles(a.distanceM), 4),
    numberCell(a.avgHr),
    numberCell(a.maxHr),
    numberCell(a.elevationGainM),
    numberCell(a.rpe),
    textCell(a.notes),
    a.source,
    a.duplicateStatus,
  ].join(',')
}
