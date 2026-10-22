// Server and tests only: uses node:crypto, so web/ must not import this file.
import { createHash } from 'node:crypto'
import { isIsoDate } from '../dates.ts'
import { MAX_DISTANCE_M, MAX_DURATION_SEC, MAX_NOTES } from '../limits.ts'
import { milesToM } from '../units.ts'
import { parseCsv } from './csv.ts'
import type { ImportRow, RowError } from './csv.ts'

export type { ImportRow, RowError } from './csv.ts'

const REQUIRED = ['date', 'minutes', 'miles'] as const

function positive(value: string): number | null {
  const n = value.trim() === '' ? NaN : Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Reads `date,type,minutes,miles,notes` (columns found by header name, any case). Run rows only. */
export function parseGenericCsv(text: string): { rows: ImportRow[]; errors: RowError[] } {
  const records = parseCsv(text)
  const rows: ImportRow[] = []
  const errors: RowError[] = []
  const header = records[0]
  if (!header) return { rows, errors }

  const names = header.map((cell) => cell.trim().toLowerCase())
  const missing = REQUIRED.filter((name) => !names.includes(name))
  if (missing.length > 0) {
    return {
      rows,
      errors: missing.map((name) => ({ line: 1, reason: `missing required column: ${name}` })),
    }
  }
  const cell = (record: string[], name: string): string => {
    const index = names.indexOf(name)
    return index === -1 ? '' : (record[index] ?? '').trim()
  }

  records.slice(1).forEach((record, i) => {
    const line = i + 2
    const type = cell(record, 'type').toLowerCase()
    if (type !== '' && type !== 'run') {
      errors.push({ line, reason: `unsupported type "${type}": only run rows can be imported` })
      return
    }
    const date = cell(record, 'date')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isIsoDate(date)) {
      errors.push({ line, reason: 'date must be YYYY-MM-DD' })
      return
    }
    const minutes = positive(cell(record, 'minutes'))
    if (minutes === null) {
      errors.push({ line, reason: 'minutes must be positive' })
      return
    }
    const miles = positive(cell(record, 'miles'))
    if (miles === null) {
      errors.push({ line, reason: 'miles must be positive' })
      return
    }
    const durationSec = Math.round(minutes * 60)
    if (durationSec <= 0) {
      errors.push({ line, reason: 'minutes must be at least 0.01' })
      return
    }
    if (durationSec > MAX_DURATION_SEC) {
      errors.push({ line, reason: 'minutes out of range' })
      return
    }
    const distanceM = Math.round(milesToM(miles))
    if (distanceM > MAX_DISTANCE_M) {
      errors.push({ line, reason: 'miles out of range' })
      return
    }
    const key = createHash('sha1').update(`${date}|${minutes}|${miles}`).digest('hex')
    rows.push({
      providerKey: `csv:${key}`,
      date,
      startTime: null,
      durationSec,
      distanceM,
      avgHr: null,
      maxHr: null,
      elevationGainM: null,
      notes: cell(record, 'notes').slice(0, MAX_NOTES) || null,
    })
  })
  return { rows, errors }
}
