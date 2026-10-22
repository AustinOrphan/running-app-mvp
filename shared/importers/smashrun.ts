import { isIsoDate } from '../dates.ts'
import type { Units } from '../types.ts'
import { MAX_DISTANCE_M, MAX_DURATION_SEC, MAX_ELEVATION_GAIN_M, MAX_NOTES } from '../limits.ts'
import { kmToM, milesToM } from '../units.ts'
import { parseCsv } from './csv.ts'
import type { ImportRow, RowError } from './csv.ts'

export type { ImportRow, RowError } from './csv.ts'

export interface SmashrunOptions {
  /** Unit of the Distance column (and of elevation: feet for mi, metres for km). Default `mi`. */
  distanceUnit?: Units
  /** The runner's offset east of UTC, in minutes, at a given instant. Default `() => 0`. */
  utcOffsetMinutes?: (instant: Date) => number
}

const COLUMN_COUNT = 26
const M_PER_FOOT = 0.3048

/** Column positions when the file has no header row. */
const DEFAULT_COLUMNS = {
  runId: 0,
  distance: 3,
  durationMs: 4,
  hrAverage: 7,
  hrMax: 8,
  startDate: 10,
  startDateUtc: 11,
  isDeleted: 14,
  elevationGained: 16,
  description: 20,
}
type Columns = typeof DEFAULT_COLUMNS

const HEADER_NAMES: Record<keyof Columns, string> = {
  runId: 'run id',
  distance: 'distance',
  durationMs: 'duration (ms)',
  hrAverage: 'hr average',
  hrMax: 'hr max',
  startDate: 'start date',
  startDateUtc: 'start date (utc)',
  isDeleted: 'is deleted',
  elevationGained: 'elevation gained',
  description: 'description',
}
const REQUIRED: Array<[keyof Columns, string]> = [
  ['runId', 'Run Id'],
  ['distance', 'Distance'],
  ['durationMs', 'Duration (ms)'],
  ['startDate', 'Start Date'],
]

const RUN_ID = /^run id$/i

interface LocalStart {
  date: string
  startTime: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function localStart(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): LocalStart | null {
  const date = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
  if (!isIsoDate(date) || hour > 23 || minute > 59) return null
  return { date, startTime: `${pad(hour)}:${pad(minute)}` }
}

/** `YY/MM/DD H:MM[:SS]`, `YYYY-MM-DD HH:MM[:SS]` or ISO 8601; the literal digits are kept, no offset applied. */
function parseLocalStart(value: string): LocalStart | null {
  const text = value.trim()
  const short = /^(\d{2})\/(\d{2})\/(\d{2}) (\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text)
  if (short)
    return localStart(
      2000 + Number(short[1]),
      Number(short[2]),
      Number(short[3]),
      Number(short[4]),
      Number(short[5]),
    )
  const long =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(
      text,
    )
  if (long)
    return localStart(
      Number(long[1]),
      Number(long[2]),
      Number(long[3]),
      Number(long[4]),
      Number(long[5]),
    )
  return null
}

function parseUtcStart(value: string, offsetMinutes: (instant: Date) => number): LocalStart | null {
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(text))
    return null
  const instant = new Date(text)
  if (Number.isNaN(instant.getTime())) return null
  const local = new Date(instant.getTime() + offsetMinutes(instant) * 60_000)
  return localStart(
    local.getUTCFullYear(),
    local.getUTCMonth() + 1,
    local.getUTCDate(),
    local.getUTCHours(),
    local.getUTCMinutes(),
  )
}

function heartRate(value: string): number | null {
  const n = value.trim() === '' ? NaN : Number(value)
  return Number.isFinite(n) && n >= 30 && n <= 250 ? Math.round(n) : null
}

/** Reads a Smashrun CSV export (spec 7.7, 7.13). Every row is a run. */
export function parseSmashrunCsv(
  text: string,
  options: SmashrunOptions = {},
): { rows: ImportRow[]; errors: RowError[] } {
  const metric = options.distanceUnit === 'km'
  const offsetMinutes = options.utcOffsetMinutes ?? (() => 0)
  const records = parseCsv(text)
  const rows: ImportRow[] = []
  const errors: RowError[] = []

  const first = records[0]
  if (!first) return { rows, errors }

  // A header has "Run Id" in its first cell, or its second when an index column leads.
  const headerOffset =
    first[0] !== undefined && RUN_ID.test(first[0].trim())
      ? 0
      : first[1] !== undefined && RUN_ID.test(first[1].trim())
        ? 1
        : -1
  const hasHeader = headerOffset !== -1

  let columns: Columns = DEFAULT_COLUMNS
  let expectedWidth = COLUMN_COUNT
  let dropIndex = false
  if (hasHeader) {
    dropIndex = headerOffset === 1
    const names = first.slice(headerOffset).map((cell) => cell.trim().toLowerCase())
    expectedWidth = names.length
    const found = {} as Columns
    for (const key of Object.keys(HEADER_NAMES) as Array<keyof Columns>)
      found[key] = names.indexOf(HEADER_NAMES[key])
    const missing = REQUIRED.filter(([key]) => found[key] === -1)
    if (missing.length > 0) {
      return {
        rows,
        errors: missing.map(([, label]) => ({
          line: 1,
          reason: `missing required column: ${label}`,
        })),
      }
    }
    columns = found
  }

  records.forEach((original, index) => {
    if (hasHeader && index === 0) return
    const line = index + 1
    let record = original
    // Without a header, a 27th leading integer column is an index and is dropped.
    if (
      hasHeader
        ? dropIndex
        : record.length === COLUMN_COUNT + 1 && /^\d+$/.test((record[0] ?? '').trim())
    ) {
      record = record.slice(1)
    }
    if (record.length !== expectedWidth) {
      errors.push({ line, reason: `expected ${expectedWidth} columns, got ${record.length}` })
      return
    }
    const at = (key: keyof Columns): string =>
      columns[key] === -1 ? '' : (record[columns[key]] ?? '').trim()

    const runId = at('runId')
    if (runId === '') {
      errors.push({ line, reason: 'missing Run Id' })
      return
    }
    if (at('isDeleted').toLowerCase() === 'true') {
      errors.push({ line, reason: 'deleted in Smashrun' })
      return
    }
    const start =
      parseLocalStart(at('startDate')) ?? parseUtcStart(at('startDateUtc'), offsetMinutes)
    if (!start) {
      errors.push({ line, reason: 'unparseable start date' })
      return
    }
    const distance = at('distance') === '' ? NaN : Number(at('distance'))
    const distanceM = Math.round(metric ? kmToM(distance) : milesToM(distance))
    if (!Number.isFinite(distance) || distance <= 0 || distanceM <= 0) {
      errors.push({ line, reason: 'distance must be positive' })
      return
    }
    if (distanceM > MAX_DISTANCE_M) {
      errors.push({ line, reason: 'distance out of range' })
      return
    }
    const durationMs = at('durationMs') === '' ? NaN : Number(at('durationMs'))
    const durationSec = Math.round(durationMs / 1000)
    if (!Number.isFinite(durationMs) || durationSec <= 0) {
      errors.push({ line, reason: 'duration must be positive' })
      return
    }
    if (durationSec > MAX_DURATION_SEC) {
      errors.push({ line, reason: 'duration out of range' })
      return
    }
    const gain = at('elevationGained') === '' ? NaN : Number(at('elevationGained'))
    const gainM =
      Number.isFinite(gain) && gain >= 0 ? Math.round(metric ? gain : gain * M_PER_FOOT) : null

    rows.push({
      providerKey: `smashrun:${runId}`,
      date: start.date,
      startTime: start.startTime,
      durationSec,
      distanceM,
      avgHr: heartRate(at('hrAverage')),
      maxHr: heartRate(at('hrMax')),
      elevationGainM: gainM !== null && gainM <= MAX_ELEVATION_GAIN_M ? gainM : null,
      notes: at('description').slice(0, MAX_NOTES) || null,
    })
  })
  return { rows, errors }
}
